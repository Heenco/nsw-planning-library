/**
 * RAG pilot - stage A of spatial resolution: decide, when the graph is built, how every condition of every claim will be
 * tested on a lot - or record why it cannot be (rag.claim_binding, migration rag-schema-05.sql). Run after 02c-claims.ts.
 *
 *   npx tsx scripts/rag/02d-bindings.ts [--dry]
 *
 * The layers are the app's own registry, nsw.scope_layer (the term -> table / view / lmr / cdc / esa registry entry
 * catalogue that /testing-spatial-services and /cdc-map use), the map polygons the resolver put in nsw.rule_spatial_ref,
 * the cadastre (lot ids) and derived.lot_lga (councils). Map areas come from rag.map_polygon, a table this script rebuilds:
 * the plan's own epi map layers (every epi table with epi_name / map_name / label, read by map name and label - "Area 1" or
 * "Stream Order 1") together with the polygons the resolver put in nsw.rule_spatial_ref; where both have a (plan, map,
 * label), the plan's own layer is the one used (lot facts).
 * A condition's words are matched to registered terms by their
 * content words (every word of the registered term in the condition), so "land in an ANEF contour of 25 or greater or
 * ANEC contour of 20 or greater" binds to "ANEF 25 or ANEC 20 contour". Nothing names a clause.
 *
 * A frame whose condition is a list ("This clause applies to development on land- (a) that has a site area of at least
 * 10,000 square metres, or (b) identified as "DCP required" on the Key Sites Map") is bound item by item (part 'item'),
 * and its own row (status 'items') says how the items combine - 'any' / 'all' from the connectives the snapshot read,
 * 'any' for a list of councils, else 'unknown' (then only all-true or all-false decides). An item is a zone, a site
 * area, a mapped label, a council, a registered layer - or a fact of the proposed development, said as such.
 */
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
/** a map label as stored and compared: lower case, any dash as "-" with no space round it, single spaces */
export const normLabel = (s: string) => s.trim().replace(/\s*[-\u2013\u2014]\s*/g, '-').replace(/\s+/g, ' ').toLowerCase()
const LABEL = `lower(regexp_replace(regexp_replace(trim(x.l), '\\s*[-\u2013\u2014]\\s*', '-', 'g'), '\\s+', ' ', 'g'))`
const STOP = new Set('a an the of in on or and to as for by any land that is which within meaning under identified area areas following this greater higher than'.split(' '))
const words = (s: string) => s.toLowerCase().replace(/[“”"'’(),.;:—–-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w))

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const reg = (await q(`SELECT term, source_kind, source, assume_absent, note FROM nsw.scope_layer`)).rows
    .map(r => ({ ...r, w: [...new Set(words(r.term))] })).filter(r => r.w.length >= 1)
  const lgas = (await q(`SELECT DISTINCT upper(lga_name) n FROM derived.lot_lga WHERE lga_name IS NOT NULL`)).rows.map(r => String(r.n))
  // ── map polygons: the plans' own epi map layers + the resolver's refs, one view (rag.map_polygon) ─────────────────
  const epiMaps = (await q(`SELECT c.table_name, (SELECT f_geometry_column FROM geometry_columns g WHERE g.f_table_schema = 'epi' AND g.f_table_name = c.table_name LIMIT 1) AS gcol
                              FROM information_schema.columns c WHERE c.table_schema = 'epi' GROUP BY c.table_name
                             HAVING bool_or(column_name = 'epi_name') AND bool_or(column_name = 'map_name') AND bool_or(column_name = 'label') AND bool_or(column_name = 'lay_class')`)).rows
    .filter(r => r.gcol && /^[a-z_0-9]+$/.test(r.table_name))
  // one row per (polygon, label): a polygon answers to its label and to its class ("Stream Order 1"), each normalised -
  // lower case, any dash as "-" with no space round it ("14 - 16 Hill Road" = "14–16 Hill Road")
  const view = [
    ...epiMaps.map(r => `SELECT i.document_id, regexp_replace(e.map_name, ' Map$', '') AS map, e.label::text AS label, e.lay_class::text AS alt,
        ST_Transform(e."${r.gcol}", 4283) AS geom, 'epi.${r.table_name}'::text AS source, true AS own
       FROM epi.${r.table_name} e JOIN rag.instrument i ON i.title = e.epi_name WHERE e.map_name IS NOT NULL`),
    `SELECT r.document_id, regexp_replace(r.map_layer, ' Map$', '') AS map, r.value AS label, NULL::text AS alt, ST_Transform(r.geom, 4283) AS geom,
        coalesce(r.geom_source, 'nsw.rule_spatial_ref') AS source, (r.geom_source LIKE 'epi.%') AS own
       FROM nsw.rule_spatial_ref r JOIN rag.instrument i ON i.document_id = r.document_id WHERE r.geom IS NOT NULL`,
  ].join('\n UNION ALL\n')
  const labelled = `SELECT m.document_id, lower(m.map) AS map, ${LABEL} AS label, m.geom, m.source, m.own
                      FROM (${view}) m, LATERAL (SELECT DISTINCT l FROM (VALUES (m.label), (m.alt)) v(l) WHERE l IS NOT NULL) x`
  // a table, not a view: lot facts read it once per lot, and the union over every epi map layer is slow to scan each time
  if (!DRY) {
    // an earlier build made it a view: drop whichever it is
    const kind = (await q(`SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'rag' AND c.relname = 'map_polygon'`)).rows[0]?.relkind
    if (kind) await q(kind === 'v' ? `DROP VIEW rag.map_polygon` : `DROP TABLE rag.map_polygon`)
    await q(`CREATE TABLE rag.map_polygon AS ${labelled}`)
    await q(`CREATE INDEX ON rag.map_polygon USING gist (geom)`)
    await q(`CREATE INDEX ON rag.map_polygon (document_id, map, label)`)
    await q(`ANALYZE rag.map_polygon`)
  }
  // keyed by instrument: map names repeat across LEPs ("Area 1 on the Key Sites Map")
  const polys = new Set((await q(`SELECT DISTINCT document_id || '|' || map || '|' || label k FROM ${DRY ? `(${labelled}) z` : 'rag.map_polygon'}`)).rows.map(r => r.k))
  console.log(`map polygons: ${epiMaps.length} epi map layers + nsw.rule_spatial_ref -> ${polys.size} (plan, map, label) keys`)
  const claims = (await q(`SELECT c.id, c.kind, c.uses, c.zones, c.terms, c.excludes, c.requires, c.span, c.provision_id, p.local_id, p.own_text, p.document_id FROM rag.claim c JOIN rag.provision p ON p.id = c.provision_id`)).rows
  const kids = new Map<string, any[]>()
  for (const k of (await q(`SELECT id, parent_id, own_text, connective FROM rag.provision WHERE parent_id IS NOT NULL AND kind NOT IN ('cell', 'row', 'table', 'term') ORDER BY sort, local_id`)).rows)
    kids.set(k.parent_id, [...(kids.get(k.parent_id) ?? []), k])
  const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
  const out: any[] = []
  const add = (claim: any, part: string, text: string, status: string, extra: any = {}) => out.push({ claim_id: claim.id, part, text, status, scope_terms: [], sources: [], assume_absent: false, note: null, ...extra })

  /** registered terms whose every content word is in the text; a term inside a longer matched term is dropped. A
   *  qualifier in the text the term does not carry ("exclusion area" on the ... Exclusion Map, "draft", "listed in
   *  Schedule 12") rules the term out - it names a different, narrower or opposite layer */
  const QUAL = ['exclusion', 'excluded', 'draft', 'interim', 'deferred', 'accelerated', 'proposed', 'former']
  const quals = (s: string) => { const l = s.toLowerCase(); return [...QUAL.filter(x => new RegExp(`\\b${x}\\b`).test(l)), ...[...l.matchAll(/\bschedule (\w+)\b/g)].map(m => `schedule ${m[1]}`)] }
  const match = (text: string) => {
    const tw = new Set(words(text)), tq = quals(text)
    let hits = reg.filter(r => r.w.every((w: string) => tw.has(w)) && r.w.length >= Math.min(2, words(text).length) && tq.every(x => quals(r.term).includes(x)))
    hits = hits.filter(h => !hits.some(o => o !== h && o.w.length > h.w.length && h.w.every((w: string) => o.w.includes(w)) && o.source_kind === h.source_kind))
    // a label the text quotes ('land identified as "exclusion area" on the ... Map') is matched exactly, however short
    const quoted = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map(m => m[1]!.toLowerCase().trim())
    const exact = reg.filter(r => quoted.includes(String(r.term).toLowerCase()))
    return exact.length ? exact : hits
  }
  const bindText = (claim: any, part: string, text: string, ctx = '') => {
    // a list of councils ("the following local government areas- Bathurst Regional, City of Blue Mountains, ..."), the
    // words "local government areas" in the condition or in the stem it hangs from (ctx)
    if (/local government areas?/i.test(`${ctx} ${text}`)) {
      const named = lgas.filter(n => new RegExp(`\\b${n.replace(/^(CITY OF |THE COUNCIL OF THE )/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
      const rest = text.replace(/the following local government areas?[—-]?/i, '').trim()
      const other = match(rest.replace(new RegExp(named.join('|') || '^$', 'gi'), ''))
      if (named.length) return add(claim, part, text, 'bound', { scope_terms: [...named.map(n => `lga:${n}`), ...other.map(o => o.term)], sources: ['derived.lot_lga', ...other.map(o => o.source)],
        note: other.length ? 'council list and a layer: both must hold' : 'council list' })
    }
    const hits = match(text)
    const live = hits.filter(h => h.source_kind !== 'none')
    // "is near the Sydney (Kingsford Smith) Airport, and is in an ANEF contour of 20 or greater": joined by "and", every
    // layer must hold; otherwise any one is enough
    const all = live.length > 1 && /,?\s+and\s+(is|has|on|in|within)\b/i.test(text)
    if (live.length) return add(claim, part, text, 'bound', { scope_terms: live.map(h => h.term), sources: live.map(h => h.source), note: all ? 'all must hold' : null })
    if (hits.length) return add(claim, part, text, 'no_data', { scope_terms: hits.map(h => h.term), assume_absent: hits.every(h => h.assume_absent), note: hits.map(h => h.note).filter(Boolean).join('; ') || 'registered, no dataset held' })
    add(claim, part, text, 'no_match')
  }

  /** one list item of a frame: a zone, a site area, a mapped label, a council or a registered layer - or a fact of the
   *  development itself ("does not involve the erection of ...", "is, or will be, at least 15 metres in height") */
  const ZONE_CLASS = /\b(residential|rural|business|industrial|employment|conservation|recreation|special purpose|waterway)s? zones?\b/i
  const bindItem = (c: any, text: string, stem: string) => {
    const zoneCodes = (s: string) => [...s.matchAll(/\bZones? ((?:[A-Z]{1,3}\d{1,2}[A-Z]?(?:[ ,]+(?:and |or )?)?)+)/g)].flatMap(m => m[1]!.match(/[A-Z]{1,3}\d{1,2}[A-Z]?/g) ?? [])
    const [inc, exc] = (() => { const i = text.search(/\bother than\b/i); return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)] })()
    const zt = [...zoneCodes(inc).map(z => `zone:${z}`), ...zoneCodes(exc).map(z => `!zone:${z}`), ...(inc.match(ZONE_CLASS) ? [`zoneclass:${inc.match(ZONE_CLASS)![1]!.toLowerCase()}`] : [])]
    // what is left once the zones are taken out: nothing but land words -> the zones are the whole condition
    const rest = words(text.replace(/\bZones? (?:[A-Z]{1,3}\d{1,2}[A-Z]?[ ,]*(?:and |or )?)+(?:[A-Z][a-z]+ ?)*/g, ' ').replace(ZONE_CLASS, ' ').replace(/\bother than\b/gi, ' '))
      .filter(w => !/^(is|be|located|zoned|residential|density|low|medium|high|large|lot|general|mixed|use)$/.test(w))
    if (zt.length && !rest.length) return add(c, 'item', text, 'bound', { scope_terms: zt, sources: ['zone'] })
    const area = text.match(/(?:site )?area of (?:at least|not less than) ([\d,]+) (?:square metres|m2)|([\d,]+) (?:square metres|m2) or (?:greater|more)/i)
    if (area && words(text.replace(area[0], ' ')).filter(w => !/^(has|site)$/.test(w)).length === 0)
      return add(c, 'item', text, 'bound', { scope_terms: [`area>=${Number((area[1] ?? area[2])!.replace(/,/g, ''))}`], sources: ['cadastre.lot'], note: 'the site taken as the lot' })
    const mapped = text.match(/identified as [“"]([^”"]+)[”"] on the (.+?)(?: Map)?\.?$/i)
    if (mapped) {
      const k = `${mapped[2]!.toLowerCase()}|${normLabel(mapped[1]!)}`
      return add(c, 'item', text, polys.has(`${c.document_id}|${k}`) ? 'bound' : 'no_polygon', { scope_terms: polys.has(`${c.document_id}|${k}`) ? [`map:${k}`] : [], sources: polys.has(`${c.document_id}|${k}`) ? ['nsw.rule_spatial_ref'] : [] })
    }
    // the development itself, not the land
    if (/^(does not involve|involves?|is, or will be|will be|is for|is carried out|the consent authority|development for the purposes? of)/i.test(text) || /\bin height\b/i.test(text))
      return add(c, 'item', text, /consent authority/i.test(text) ? 'discretion' : 'proposal_fact', { note: /consent authority/i.test(text) ? "the consent authority's judgement" : 'a fact of the proposed development' })
    bindText(c, 'item', text, stem)
  }

  for (const c of claims) {
    for (const t of c.terms as string[]) {
      if (/^(date:|tenure:|!tenure:|pathway:|proposal:)|^detached$/.test(t)) add(c, 'term', t, 'proposal_fact', { note: t.startsWith('date:') ? 'the consent date - given with the question' : t.includes('tenure') ? 'the title type' : t.startsWith('pathway:') ? 'the approval pathway' : 'a fact of the proposal' })
      else if (t.startsWith('discretion:')) add(c, 'term', t, 'discretion', { note: "the consent authority's judgement" })
      else if (t.startsWith('lots:')) add(c, 'term', t, 'bound', { scope_terms: ['lot'], sources: ['cadastre.lot'] })
      else if (t.startsWith('mapped:')) {
        const m = t.slice(7).match(/^(.+) on the (.+?)(?: Map)?$/)
        const labels = m ? m[1]!.split(/\s+or\s+|,\s*/).map(x => x.trim().toLowerCase()) : []
        const map = m?.[2]?.toLowerCase() ?? ''
        const held = labels.filter(l => polys.has(`${c.document_id}|${map}|${normLabel(l)}`))
        add(c, 'mapped', t.slice(7), held.length === labels.length && labels.length ? 'bound' : held.length ? 'bound' : 'no_polygon',
          { scope_terms: held.map(l => `map:${map}|${l}`), sources: held.length ? ['nsw.rule_spatial_ref'] : [], note: held.length && held.length < labels.length ? `no polygon for ${labels.filter(l => !held.includes(l)).join(', ')}` : null })
      } else bindText(c, 'term', t)
    }
    for (const ex of c.excludes as string[]) {
      if (ex.startsWith('zone:')) { add(c, 'exclude', ex, 'bound', { scope_terms: [ex], sources: ['zone name'] }); continue }
      bindText(c, 'exclude', ex)
    }
    // a frame that names no use, zone, place or condition: unless it is the whole State or plan, its scope was not read -
    // or, when it ends in a list, its condition is the list: bound item by item
    if (c.kind === 'frame' && !c.uses.length && !c.zones.length && !c.terms.length && !c.excludes.length && !(c.requires ?? []).length) {
      const broad = /whole of the State|^the State.?$|land to which this (Plan|Policy) applies|Land Application Map|^all land|^any land|^development$/i.test(c.span ?? '')
      const stem = norm(c.own_text), items = kids.get(c.provision_id) ?? []
      // "whether ... or ..." items restrict nothing ("the total floor area of a building- (a) whether ... before, or ...
      // after, ..., and (b) whether or not ...")
      const open = items.length && items.every(k => /^whether\b/i.test(norm(k.own_text)))
      if (open) continue
      if (!broad && /[—-]\s*$/.test(stem) && items.length) {
        const conns = items.map(k => k.connective).filter(Boolean)
        const comb = /more than one|at least (two|2)/i.test(stem) ? 'unknown'
          : conns.length ? (conns.every((x: string) => x === 'or') ? 'any' : conns.every((x: string) => x === 'and') ? 'all' : 'unknown')
          : /local government areas?/i.test(stem) ? 'any' : 'unknown'
        add(c, 'frame', c.span ?? stem, 'items', { note: comb })
        // an item that is itself a stem carries its own list with it ("is on land that- (i) ..., (ii) ...")
        for (const k of items) bindItem(c, norm([k.own_text, ...(/[—-]\s*$/.test(norm(k.own_text)) ? (kids.get(k.id) ?? []).map(g => g.own_text) : [])].join(' ')).replace(/[,;]\s*(or|and)?$/i, ''), stem)
      } else if (!broad) add(c, 'frame', c.span ?? '', 'unscoped', { note: `frame on ${c.local_id}: its scope was not read` })
    }
  }

  const tally = out.reduce((a: Record<string, number>, b) => ({ ...a, [`${b.part}:${b.status}`]: (a[`${b.part}:${b.status}`] ?? 0) + 1 }), {})
  console.log('bindings', out.length, tally)
  for (const st of ['no_match', 'no_data', 'no_polygon', 'unscoped', 'items']) {
    const xs = out.filter(o => o.status === st)
    console.log(`\n${st} (${xs.length}):`); for (const x of xs.slice(0, 25)) console.log('  ', claims.find(c => c.id === x.claim_id)!.local_id.padEnd(26), x.text.slice(0, 120))
  }
  if (DRY) { await client.end(); return }
  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('bindings', '{}') RETURNING id`)).rows[0].id
  await q(`DELETE FROM rag.claim_binding`)
  await q(`INSERT INTO rag.claim_binding (claim_id, part, text, status, scope_terms, sources, assume_absent, note, run_id)
           SELECT claim_id, part, text, status, scope_terms, sources, assume_absent, note, $2 FROM jsonb_to_recordset($1::jsonb)
             AS x(claim_id uuid, part text, text text, status text, scope_terms text[], sources text[], assume_absent boolean, note text)`, [JSON.stringify(out), run])
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ bindings: out.length, by: tally })])
  await q('COMMIT')
  console.log('written', out.length)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
