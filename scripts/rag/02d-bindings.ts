/**
 * RAG pilot - stage A of spatial resolution: decide, when the graph is built, how every condition of every claim will be
 * tested on a lot - or record why it cannot be (rag.claim_binding, migration rag-schema-05.sql). Run after 02c-claims.ts.
 *
 *   npx tsx scripts/rag/02d-bindings.ts [--dry]
 *
 * The layers are the app's own registry, nsw.scope_layer (the term -> table / view / lmr / cdc / esa registry entry
 * catalogue that /testing-spatial-services and /cdc-map use), the map polygons the resolver put in nsw.rule_spatial_ref,
 * the cadastre (lot ids) and derived.lot_lga (councils). It also writes rag.area_clause (each map area and the clauses that
 * govern it - directly, or through the frame above them) and rag.coverage (control areas no clause reads, clauses whose
 * area has no polygon, Schedule 1 items with no permission read, measures no reader took). Map areas come from rag.map_polygon, a table this script rebuilds:
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
import { landUseKey } from '../../shared/land-use-key'

const DRY = process.argv.includes('--dry')
/** a map label as stored and compared: lower case, any dash as "-" with no space round it, single spaces */
export const normLabel = (s: string) => s.trim().replace(/^(?:a|an|the)\s+/i, '').replace(/\s*[-\u2013\u2014]\s*/g, '-').replace(/\s+/g, ' ').toLowerCase()
const LABEL = `lower(regexp_replace(regexp_replace(trim(x.l), '\\s*[-\u2013\u2014]\\s*', '-', 'g'), '\\s+', ' ', 'g'))`
const STOP = new Set('a an the of in on or and to as for by any land that is which within meaning under identified area areas following this greater higher than'.split(' '))
const words = (s: string) => s.toLowerCase().replace(/[“”"'’(),.;:—–-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w))
/** the Standard Instrument's zone groups, as the zone codes every plan uses ("a rural, residential or recreation zone") */
const ZONE_GROUPS: [RegExp, string][] = [[/^residential$/i, 'R'], [/^rural$/i, 'RU'], [/^business$/i, 'B'], [/^industrial$/i, 'IN'], [/^employment$/i, 'E'],
  [/^(conservation|environment(?:al)? protection)$/i, 'C'], [/^recreation$/i, 'RE'], [/^special purposes?$/i, 'SP'], [/^waterways?$/i, 'W'], [/^mixed use$/i, 'MU']]
const GROUP_WORDS = 'residential|rural|business|industrial|employment|conservation|environment(?:al)? protection|recreation|special purposes?|waterways?|mixed use'
/** "in a rural, residential, employment, mixed use, special purpose or recreation zone" -> the zone-code groups, and the words matched */
export const zoneGroupsIn = (s: string): { groups: string[]; span: string } | null => {
  const m = s.match(new RegExp(`\\b((?:(?:${GROUP_WORDS})(?:\\s*,\\s*|\\s+or\\s+|\\s+and\\s+)?)+)\\s+zones?\\b`, 'i'))
  if (!m) return null
  const groups = [...m[1]!.matchAll(new RegExp(GROUP_WORDS, 'gi'))].map(g => ZONE_GROUPS.find(([re]) => re.test(g[0]!))?.[1]).filter(Boolean) as string[]
  return groups.length ? { groups: [...new Set(groups)], span: m[0]! } : null
}
/** zone codes named in words: "Zone E1 Local Centre or Zone E2 Commercial Centre", "Zones R2 and R3" */
const zoneCodesIn = (s: string) => [...s.matchAll(/\bZones? ((?:[A-Z]{1,3}\d{1,2}[A-Z]?(?:[ ,]+(?:and |or )?)?(?:[A-Z][a-z]+ ?)*)+)/g)].flatMap(m => m[1]!.match(/\b[A-Z]{1,3}\d{1,2}[A-Z]?\b/g) ?? [])
/** a zone-code pattern for zones named and zone groups ("R" -> any R1, R2 ...) */
const zonePattern = (codes: string[], groups: string[]) => [...codes, ...groups.map(g => `${g}\\d{1,2}[A-Z]?`)].join('|')

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const reg = (await q(`SELECT term, source_kind, source, assume_absent, note FROM nsw.scope_layer`)).rows
    .map(r => ({ ...r, w: [...new Set(words(r.term))] })).filter(r => r.w.length >= 1)
  const lgas = (await q(`SELECT DISTINCT upper(lga_name) n FROM derived.lot_lga WHERE lga_name IS NOT NULL`)).rows.map(r => String(r.n))
  // the land uses every plan's Land Use Table names: an item that is only a use is the proposal's use, not a place
  const vocab = [...new Set((await q(`SELECT DISTINCT land_use FROM nsw.lep_permissibility WHERE land_use IS NOT NULL`)).rows.map(r => landUseKey(String(r.land_use))))]
    .filter(v => v.length > 3).sort((a, b) => b.length - a.length)
  /** the land uses a phrase names, longest first ("information and education facilities" is one use, not two), and the
   *  words left over once they and the joining words are taken out */
  const usesIn = (s: string) => {
    let k = ` ${landUseKey(s).replace(/[,;.:()]/g, ' ').replace(/\s+/g, ' ')} `
    const uses: string[] = []
    for (const v of vocab) if (k.includes(` ${v} `)) { uses.push(v); k = k.split(` ${v} `).join(' ') }
    return { uses, rest: words(k).filter(w => !/^(development|purpose|purposes|other|includ\w*|ancillary|related)$/.test(w)) }
  }
  // ── map polygons: the plans' own epi map layers + the resolver's refs, one view (rag.map_polygon) ─────────────────
  const epiMaps = (await q(`SELECT c.table_name, (SELECT f_geometry_column FROM geometry_columns g WHERE g.f_table_schema = 'epi' AND g.f_table_name = c.table_name LIMIT 1) AS gcol
                              FROM information_schema.columns c WHERE c.table_schema = 'epi' GROUP BY c.table_name
                             HAVING bool_or(column_name = 'epi_name') AND bool_or(column_name = 'map_name') AND bool_or(column_name = 'label') AND bool_or(column_name = 'lay_class')`)).rows
    // not the sheet index (epi_map_tiles: which printed sheet covers where - 32 km2 rectangles with no label, which put every
    // North Sydney lot "inside" its Additional Permitted Uses and Land Reservation Acquisition maps)
    .filter(r => r.gcol && /^[a-z_0-9]+$/.test(r.table_name) && !/map_tiles?$|sheet/.test(r.table_name))
  // one row per (polygon, label): a polygon answers to its label and to its class ("Stream Order 1"), each normalised -
  // lower case, any dash as "-" with no space round it ("14 - 16 Hill Road" = "14–16 Hill Road")
  const view = [
    ...epiMaps.map(r => `SELECT i.document_id, regexp_replace(e.map_name, ' Map$', '') AS map, e.label::text AS label, e.lay_class::text AS alt,
        ST_Transform(e."${r.gcol}", 4283) AS geom, 'epi.${r.table_name}'::text AS source, true AS own
       FROM epi.${r.table_name} e JOIN rag.instrument i ON i.title = e.epi_name WHERE e.map_name IS NOT NULL`),
    // the maps' additional controls, from the feature services (rag.additional_controls, 01c-additional-controls.py): the
    // plan's own layers, which the EPI dump carries only in part
    `SELECT i.document_id, regexp_replace(a.map_name, ' Map$', '') AS map, a.label, a.legis_area AS alt, a.geom, 'rag.additional_controls:' || a.source AS source, true AS own
       FROM rag.additional_controls a JOIN rag.instrument i ON i.title = a.epi_name`,
    `SELECT r.document_id, regexp_replace(r.map_layer, ' Map$', '') AS map, r.value AS label, NULL::text AS alt, ST_Transform(r.geom, 4283) AS geom,
        coalesce(r.geom_source, 'nsw.rule_spatial_ref') AS source, (r.geom_source LIKE 'epi.%') AS own
       FROM nsw.rule_spatial_ref r JOIN rag.instrument i ON i.document_id = r.document_id WHERE r.geom IS NOT NULL`,
  ].join('\n UNION ALL\n')
  const labelled = `SELECT m.document_id, lower(m.map) AS map, ${LABEL} AS label, m.geom, m.source, m.own
                      FROM (${view}) m, LATERAL (SELECT DISTINCT l FROM (VALUES (m.label), (m.alt)) v(l) WHERE nullif(trim(l), '') IS NOT NULL) x`
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
  const polyRows = (await q(`SELECT DISTINCT document_id || '|' || map || '|' || label k, source, own FROM ${DRY ? `(${labelled}) z` : 'rag.map_polygon'}`)).rows
  const polys = new Set(polyRows.map(r => r.k))
  /** the label as the map draws it: the words say "Area B", the layer "B" (or the other way round) - the one held, or null */
  const heldLabel = (doc: string, map: string, label: string) => {
    const n = normLabel(label)
    for (const v of [n, n.replace(/^area /, ''), `area ${n}`]) if (polys.has(`${doc}|${map}|${v}`)) return v
    return null
  }
  // where each (plan, map, label) is drawn: the plan's own layers when it has them (lot facts use only those), else the
  // resolver's refs - what a binding says it is tested against
  const polySrc = new Map<string, string[]>()
  for (const r of polyRows) polySrc.set(r.k, [...(polySrc.get(r.k) ?? []), ...(r.own ? [`+${r.source}`] : [r.source])])
  const srcOf = (k: string) => { const all = polySrc.get(k) ?? []; const own = all.filter(x => x.startsWith('+')).map(x => x.slice(1)); return [...new Set(own.length ? own : all)] }
  console.log(`map polygons: ${epiMaps.length} epi map layers + rag.additional_controls + nsw.rule_spatial_ref -> ${polys.size} (plan, map, label) keys`)
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
  const ZONE_WORDS_RE = /\bZones? (?:[A-Z]{1,3}\d{1,2}[A-Z]?[ ,]*(?:and |or )?)+(?:[A-Z][a-z]+ ?)*/g
  const AREA_RE = /(?:site )?area of (?:at least|not less than) ([\d,]+)\s*(?:square metres|m2|m²)|([\d,]+)\s*(?:square metres|m2|m²) or (?:greater|more)/i
  /** words about the development itself, not the land: what it is, its use, floor area, cost, height, how it was designed,
   *  a building already on the land - or the consent authority's judgement */
  const PROPOSAL_START = /^(does not involve|involves?|involving|is, or will be|will be|is for|is carried out|is a winner|the consent authority|development (?:for the purposes? of|for which|involving|that will)|for the purposes? of|used (?:only )?for|significant alterations|that will result in|on which an? .+? is (?:erected|proposed))/i
  const PROPOSAL_ANY = /\bin height\b|\bheight (?:above ground level (?:\(existing\) )?)?of (?:more|less) than\b|\bheight of at least\b|\bgross floor area\b|\bestimated development cost\b|\bcompetitive design process\b|\bconsent authority (?:considers|is satisfied)\b/i
  /** words that only say "land" - what may be left of an item once its zones, area and map labels are read */
  const LAND_ONLY = /^(is|be|on|at|located|zoned|shown|marked|has|have|site|lot|lots|land|zone|zones)$/
  const bindItem = (c: any, text: string, stem: string) => {
    const [inc, exc] = (() => { const i = text.search(/\bother than\b/i); return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)] })()
    const grp = zoneGroupsIn(inc)
    const zt = [...zoneCodesIn(inc).map(z => `zone:${z}`), ...zoneCodesIn(exc).map(z => `!zone:${z}`), ...(grp ? [`zonegroup:${grp.groups.join('|')}`] : [])]
    // what is left once the zones are taken out: nothing but land words -> the zones are the whole condition
    const rest = words(text.replace(ZONE_WORDS_RE, ' ').replace(grp?.span ?? '\u0000', ' ').replace(/\bother than\b/gi, ' '))
      .filter(w => !/^(is|be|located|zoned|residential|density|low|medium|high|large|lot|general|mixed|use|zone|zones)$/.test(w))
    if (zt.length && !rest.length) return add(c, 'item', text, 'bound', { scope_terms: zt, sources: ['zone'] })
    // a zone named by its code and name alone, as list items in "the following zones- (a) RU1 Primary Production, ..."
    const bare = text.match(/^(?:Zone\s+)?([A-Z]{1,3}\d{1,2}[A-Z]?)\s+[A-Z][A-Za-z-]*(?:\s+(?:and\s+)?[A-Z][A-Za-z-]*)*[.,;]?\s*(?:or|and)?$/)
    if (bare) return add(c, 'item', text, 'bound', { scope_terms: [`zone:${bare[1]}`], sources: ['zone'] })
    // a zone and the uses it lets in ("in Zone R1 General Residential-development for the purposes of business premises,
    // office premises or shops"): the lot in the zone and the proposal one of the uses - all must hold
    const zu = text.match(/^(?:on land |for land )?in (.+?)\s*[—–-]\s*(?:development )?for the purposes? of (.+)$/i)
    if (zu) {
      const z = { codes: zoneCodesIn(zu[1]!), groups: zoneGroupsIn(zu[1]!)?.groups ?? [] }, u = usesIn(zu[2]!)
      if ((z.codes.length || z.groups.length) && u.uses.length && !u.rest.length)
        return add(c, 'item', text, 'bound', { scope_terms: [...z.codes.map(x => `zone:${x}`), ...(z.groups.length ? [`zonegroup:${z.groups.join('|')}`] : []), `use:${u.uses.join('|')}`],
          sources: ['zone', 'the question (the use asked about)'], note: 'the zone and the use: all must hold' })
    }
    // only uses ("hotel or motel accommodation", "for the purposes of attached dwellings, multi dwelling housing or
    // residential flat buildings"): the proposal is one of them - tested against the use asked about
    const onlyUses = usesIn(text.replace(/^(?:development )?for(?: the purposes? of)?\s+/i, ''))
    if (onlyUses.uses.length && !onlyUses.rest.length)
      return add(c, 'item', text, 'bound', { scope_terms: [`use:${onlyUses.uses.join('|')}`], sources: ['the question (the use asked about)'], note: 'the use of the proposed development' })
    const area = text.match(AREA_RE)
    if (area && words(text.replace(area[0], ' ')).filter(w => !/^(has|site)$/.test(w)).length === 0)
      return add(c, 'item', text, 'bound', { scope_terms: [`area>=${Number((area[1] ?? area[2])!.replace(/,/g, ''))}`], sources: ['cadastre.lot'], note: 'the site taken as the lot' })
    // a distance from land in other zones, zone by zone (cl 5.3 "The relevant distance is- (a) for land in a residential
    // zone or Zone SP2 Infrastructure-4 metres from any boundary with land in a Zone E1 Local Centre or ...")
    const zb = text.match(/^for land in (.+?)\s*[—–-]\s*([\d.]+)\s*(?:m|metres) from any boundary with land in (.+?)[,;.]?\s*(?:or|and)?$/i)
    if (zb) {
      const from = { codes: zoneCodesIn(zb[1]!), groups: zoneGroupsIn(zb[1]!)?.groups ?? [] }, to = { codes: zoneCodesIn(zb[3]!), groups: zoneGroupsIn(zb[3]!)?.groups ?? [] }
      if ((from.codes.length || from.groups.length) && (to.codes.length || to.groups.length))
        return add(c, 'item', text, 'bound', { scope_terms: [...from.codes.map(z => `zone:${z}`), ...(from.groups.length ? [`zonegroup:${from.groups.join('|')}`] : []), `nearzone:${Number(zb[2])}|${zonePattern(to.codes, to.groups)}`],
          sources: ['zone', 'epi.epi_land_zoning'], note: 'the zone and the distance: all must hold' })
    }
    // land within a distance of a mapped feature: "land within- 10m of streams identified as "Stream Order 1" on the Riparian
    // Lands and Watercourses Map, or 20m of streams identified as "Stream Order 2" ..." - any one of them
    const near = [...text.matchAll(/(\d[\d.]*)\s*(?:m|metres)\s+of\s+[^“"]*?identified as [“"]([^”"]+)[”"] on the (.+?) Map\b/gi)]
    if (near.length) {
      const keys = near.map(m => ({ m: Number(m[1]), k: `${m[3]!.toLowerCase()}|${heldLabel(c.document_id, m[3]!.toLowerCase(), m[2]!) ?? normLabel(m[2]!)}` }))
      const held = keys.filter(x => polys.has(`${c.document_id}|${x.k}`))
      return add(c, 'item', text, held.length ? 'bound' : 'no_polygon', { scope_terms: held.map(x => `near:${c.document_id}:${x.m}:${x.k}`), sources: [...new Set(held.flatMap(x => srcOf(`${c.document_id}|${x.k}`)))],
        note: held.length < keys.length ? `no polygon for ${keys.filter(x => !held.includes(x)).map(x => x.k).join(', ')}` : 'within the distance of any one' })
    }
    // map labels: "land identified as "Area C" or "Area D" on the Special Provisions Area Map", ""Area 1", "Area 2" ... or
    // "Area 5" on the Additional Local Provisions Map", "is on land identified as ... of the ... Map" - any label. The item
    // may also name zones or a site area ("... Map that has a site area of at least 1,300m2"): all must hold. Words left
    // unread leave the whole item unread - never half-tested
    const maps = [...text.matchAll(/((?:[“"][^”"]+[”"](?:\s*,\s*|\s+or\s+|\s+and\s+)?)+)\s*(?:on|of) the ([A-Z][\w ]*?) Map\b/g)]
    if (maps.length) {
      const keys = [...new Set(maps.flatMap(m => [...m[1]!.matchAll(/[“"]([^”"]+)[”"]/g)].map(l => `${m[2]!.toLowerCase()}|${heldLabel(c.document_id, m[2]!.toLowerCase(), l[1]!) ?? normLabel(l[1]!)}`)))]
      let left = text; for (const m of maps) left = left.replace(m[0], ' ')
      // "that is not on land identified as ...": the lot outside the area
      const negated = /\bnot (?:on|in|within) (?:the )?land\b/i.test(left)
      if (negated) left = left.replace(/\bnot\b/i, ' ')
      // how the map draws it ("shown in red hatching and identified as") says nothing more about the land
      left = left.replace(/\b(?:shown|marked|edged|coloured)\s+(?:in|with|by)?\s*(?:(?:red|blue|green|yellow|purple|orange|black|brown|pink|grey|gray|heavy|thick|broken|dashed)\s+)*(?:hatching|edging|outline|colour|color|cross-hatching|lines?)\b/gi, ' ')
      const a = left.match(AREA_RE); if (a) left = left.replace(a[0], ' ')
      const g = zoneGroupsIn(left), codes = zoneCodesIn(left)
      left = left.replace(ZONE_WORDS_RE, ' ').replace(g?.span ?? '\u0000', ' ')
      // the rest a fact of the proposal ("development that will result in a building with a height of at least 10m on land
      // identified as "MPD" ..."): the area and that fact - outside the area it does not hold, inside it turns on the proposal
      const fact = PROPOSAL_START.test(left.trim()) || PROPOSAL_ANY.test(left) ? norm(left).slice(0, 160) : null
      const unread = fact ? [] : words(left).filter(w => !LAND_ONLY.test(w))
      if (unread.length) return add(c, 'item', text, 'no_match', { note: `the map area is read, these words are not: ${unread.join(' ')}` })
      const held = keys.filter(k => polys.has(`${c.document_id}|${k}`)), missing = keys.filter(k => !held.includes(k))
      if (!held.length) return add(c, 'item', text, 'no_polygon', { note: `no polygon for ${keys.join(', ')}` })
      const other = [...codes.map(z => `zone:${z}`), ...(g ? [`zonegroup:${g.groups.join('|')}`] : []), ...(a ? [`area>=${Number((a[1] ?? a[2])!.replace(/,/g, ''))}`] : []), ...(fact ? [`fact:${fact}`] : [])]
      // outside an area some of whose labels have no polygon cannot be shown - unread rather than guessed
      if (negated && missing.length) return add(c, 'item', text, 'no_polygon', { note: `outside the area, but no polygon for ${missing.join(', ')}` })
      if (negated) return add(c, 'item', text, 'bound', { scope_terms: [...held.map(k => `notmap:${k}`), ...other], sources: [...new Set(held.flatMap(k => srcOf(`${c.document_id}|${k}`)))],
        note: other.length ? 'outside the map area, and the rest: all must hold' : 'outside the map area' })
      // a label with no polygon: the lot outside the others is not "outside" - it may be in that one (unheld: fails closed)
      return add(c, 'item', text, 'bound', { scope_terms: [...held.map(k => `map:${k}`), ...missing.map(k => `unheld:${k}`), ...other],
        sources: [...new Set([...held.flatMap(k => srcOf(`${c.document_id}|${k}`)), ...(other.length ? ['zone / cadastre.lot'] : [])])],
        note: [other.length ? 'the map area and the rest: all must hold' : null, missing.length ? `no polygon for ${missing.join(', ')}` : null].filter(Boolean).join('; ') || null })
    }
    // the development itself, not the land: what it is, its use, its floor area, cost, height, how it was designed, or a
    // building already on the land
    const isUse = usesIn(text).uses.length > 0
    if (PROPOSAL_START.test(text) || PROPOSAL_ANY.test(text))
      return add(c, 'item', text, /consent authority/i.test(text) ? 'discretion' : 'proposal_fact', { note: /consent authority/i.test(text) ? "the consent authority's judgement" : isUse ? 'the use of the proposed development' : 'a fact of the proposed development' })
    bindText(c, 'item', text, stem)
  }

  for (const c of claims) {
    for (const t of c.terms as string[]) {
      if (/^(date:|tenure:|!tenure:|pathway:|proposal:|condition:)|^detached$/.test(t)) add(c, 'term', t, 'proposal_fact', { note: t.startsWith('date:') ? 'the consent date - given with the question' : t.includes('tenure') ? 'the title type' : t.startsWith('pathway:') ? 'the approval pathway' : t.startsWith('condition:') ? `a condition of the permission: ${t.slice(10)}` : 'a fact of the proposal' })
      else if (t.startsWith('discretion:')) add(c, 'term', t, 'discretion', { note: "the consent authority's judgement" })
      else if (t.startsWith('lots:')) add(c, 'term', t, 'bound', { scope_terms: ['lot'], sources: ['cadastre.lot'] })
      else if (t.startsWith('mapped:')) {
        const m = t.slice(7).match(/^(.+) on the (.+?)(?: Map)?$/)
        const map = m?.[2]?.toLowerCase() ?? ''
        // "Area 21A, Area 21B and Area 21C": a list, unless the whole label is one the map draws
        const labels = (m ? m[1]!.split(/\s+or\s+|,\s*/).map(x => x.trim().toLowerCase()) : [])
          .flatMap(l => heldLabel(c.document_id, map, l) || !/\s+and\s+/.test(l) ? [l] : l.split(/\s+and\s+/).map(x => x.trim()))
          .map(l => heldLabel(c.document_id, map, l) ?? l)
        const held = labels.filter(l => polys.has(`${c.document_id}|${map}|${normLabel(l)}`)), missing = labels.filter(l => !held.includes(l))
        // a label with no polygon (Area 21B of "Area 21A, Area 21B and Area 21C"): a lot outside the others may be in it -
        // kept as unheld:, so "not inside" is never concluded from the labels that are drawn
        add(c, 'mapped', t.slice(7), held.length ? 'bound' : 'no_polygon',
          { scope_terms: [...held.map(l => `map:${map}|${l}`), ...(held.length ? missing.map(l => `unheld:${map}|${normLabel(l)}`) : [])], sources: [...new Set(held.flatMap(l => srcOf(`${c.document_id}|${map}|${normLabel(l)}`)))], note: held.length && missing.length ? `no polygon for ${missing.join(', ')}` : null })
      }
      // "within the relevant distance of a boundary between any 2 zones" (cl 5.3): measured on the plan's zoning map
      else if (t.startsWith('nearzone:')) add(c, 'term', t, 'bound', { scope_terms: [t], sources: ['epi.epi_land_zoning'], note: 'the lot within that distance of land in another zone' })
      else bindText(c, 'term', t)
    }
    for (const ex of c.excludes as string[]) {
      if (ex.startsWith('zone:')) { add(c, 'exclude', ex, 'bound', { scope_terms: [ex], sources: ['zone name'] }); continue }
      bindText(c, 'exclude', ex)
    }
    // a frame that names no use, zone, place or condition: unless it is the whole State or plan, its scope was not read -
    // or, when it ends in a list, its condition is the list: bound item by item
    if (c.kind === 'frame' && !c.uses.length && !c.zones.length && !c.terms.length && !c.excludes.length && !(c.requires ?? []).length) {
      const broad = /whole of the State|^the State.?$|land to which this (Plan|Policy) applies|Land Application Map|^all land|^any land|^development$/i.test(c.span ?? '')
      // a Note after the stem's dash is not the stem ("the following rural zones- Note. When this Plan was made ...")
      const stem = norm(c.own_text).replace(/\s+Note\.?\s.*$/, ''), items = kids.get(c.provision_id) ?? []
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
      }
      // a frame about a thing, not a place ("a fire alarm system that can be monitored by ...", "timber paling ... fences",
      // "replacement of an existing awning"): whether it applies is a fact of the proposed development
      else if (!broad && !/\b(land|lots?|zones?|areas?|sites?|map|precincts?|centres?|locality|street|road|catchment|foreshore|council|local government|state)\b/i.test(c.span ?? ''))
        add(c, 'frame', c.span ?? '', 'proposal_fact', { note: 'what the development is - a fact of the proposal, not of the land' })
      else if (!broad) add(c, 'frame', c.span ?? '', 'unscoped', { note: `frame on ${c.local_id}: its scope was not read` })
    }
  }

  const tally = out.reduce((a: Record<string, number>, b) => ({ ...a, [`${b.part}:${b.status}`]: (a[`${b.part}:${b.status}`] ?? 0) + 1 }), {})
  console.log('bindings', out.length, tally)
  for (const st of ['no_match', 'no_data', 'no_polygon', 'unscoped', 'items']) {
    const xs = out.filter(o => o.status === st)
    console.log(`\n${st} (${xs.length}):`); for (const x of xs.slice(0, 25)) console.log('  ', claims.find(c => c.id === x.claim_id)!.local_id.padEnd(26), x.text.slice(0, 120))
  }

  // ── the map areas and the clauses that govern them (rag.area_clause) ─────────────────────────────────
  // every bound map / distance condition ties its area to its clause; a frame ("This clause applies to land identified as
  // "Area 10" ...") ties the area to every rule under the unit it governs (Sch 1 item 10(2): permits ...)
  const meta = (await q(`SELECT c.id, c.kind, c.uses, c.topic, c.comparator, c.value::float8 AS v, c.unit, c.value_source, p.id AS pid, p.local_id, p.document_id, u.local_id AS unit_local
                           FROM rag.claim c JOIN rag.provision p ON p.id = c.provision_id LEFT JOIN rag.provision u ON u.id = c.unit_provision`)).rows
  const metaOf = new Map(meta.map((r: any) => [r.id, r]))
  const roleOf = (c: any) => c.kind === 'permit' ? `permits ${(c.uses ?? []).join(', ') || 'development'}` : c.kind === 'prohibit' ? `prohibits ${(c.uses ?? []).join(', ') || 'development'}`
    : c.kind === 'standard' ? `${c.topic ?? 'standard'} ${c.comparator ?? ''} ${c.v ?? (c.value_source ?? '')}${c.v != null && c.unit ? ` ${c.unit}` : ''}`.replace(/\s+/g, ' ').trim()
    : c.kind === 'frame' ? 'applies to' : c.kind
  const areaRows: any[] = [], seenArea = new Set<string>()
  const pushArea = (r: any) => { const k = `${r.document_id}|${r.map}|${r.label}|${r.claim_id}`; if (!seenArea.has(k)) { seenArea.add(k); areaRows.push(r) } }
  for (const b of out.filter(o => o.status === 'bound')) {
    const c: any = metaOf.get(b.claim_id); if (!c) continue
    for (const t of b.scope_terms as string[]) {
      const mm = t.match(/^map:(.+?)\|(.+)$/), nm = t.match(/^near:[^:]+:([\d.]+):(.+?)\|(.+)$/)
      if (!mm && !nm) continue
      const area = { document_id: c.document_id, map: (mm ? mm[1] : nm![2])!, label: normLabel((mm ? mm[2] : nm![3])!), distance_m: nm ? Number(nm[1]) : null }
      pushArea({ ...area, provision_id: c.pid, claim_id: c.id, claim_kind: c.kind, via_frame: false,
        role: `${b.part === 'exclude' ? 'excluded where: ' : ''}${roleOf(c)}${area.distance_m != null ? ` (within ${area.distance_m} m)` : ''}` })
      if (c.kind === 'frame' && c.unit_local) for (const r of meta)
        if (r.kind !== 'frame' && r.document_id === c.document_id && (r.local_id === c.unit_local || r.local_id.startsWith(c.unit_local + '-')))
          pushArea({ ...area, provision_id: r.pid, claim_id: r.id, claim_kind: r.kind, via_frame: true, role: roleOf(r) })
    }
  }
  const areaKeys = new Set(areaRows.map(r => `${r.document_id}|${r.map}|${r.label}`))
  // every provision that names a drawn area ("... on land identified as "Area C" on the Key Sites Map, the consent authority
  // must consider ...") - a matter to consider, a concurrence, a DCP requirement, a calculation rule, a trigger - is tied to it
  // as 'mention' even where no reader made it a rule, so an area's clauses are complete for any reader of a lot. (A mention
  // does not close the coverage gap: the area is still one no reader bound.)
  const provText = (await q(`SELECT p.id, p.document_id, p.local_id, left(p.own_text, 200) AS o, lower(replace(replace(coalesce(p.own_text, ''), '“', '"'), '”', '"')) AS t
                               FROM rag.provision p JOIN rag.instrument i ON i.document_id = p.document_id WHERE i.kind = 'lep' AND coalesce(p.own_text, '') <> ''`)).rows
  const mentions: any[] = []
  for (const r of provText) for (const m of r.t.matchAll(/((?:"[^"]+"(?:\s*,\s*|\s+or\s+|\s+and\s+)?)+)\s*(?:on|of) the ([a-z][\w ]*?) map\b/g)) {
    const map = m[2]!.trim()
    for (const l of m[1]!.matchAll(/"([^"]+)"/g)) {
      const label = heldLabel(r.document_id, map, l[1]!); if (!label) continue
      mentions.push({ document_id: r.document_id, map, label, provision_id: r.id, local_id: r.local_id })
      if (!areaRows.some(x => x.document_id === r.document_id && x.map === map && x.label === label && x.provision_id === r.id))
        areaRows.push({ document_id: r.document_id, map, label, provision_id: r.id, claim_id: null, claim_kind: 'mention', via_frame: false, distance_m: null,
          role: `names this area: ${String(r.o).replace(/\s+/g, ' ').slice(0, 160)}` })
    }
  }
  // a map whose figure a clause reads whole ("the floor space ratio shown for the land on the Floor Space Ratio Map"): every
  // label on it is governed by that clause
  const wholeMaps = new Set(meta.filter((r: any) => String(r.value_source ?? '').startsWith('map:')).map((r: any) => `${r.document_id}|${String(r.value_source).slice(4).toLowerCase().replace(/ map$/, '')}`))

  // ── coverage: what the build could not tie together (rag.coverage) ────────────────────────────────────
  // the control areas: the plans' own layers of areas a clause is meant to name - additional permitted uses, key sites,
  // local and special provisions, and the maps' additional controls
  const controlAreas = (await q(`
    SELECT i.document_id, lower(regexp_replace(s.map_name, ' Map$', '')) AS map, s.label, s.source
      FROM (SELECT epi_name, map_name, label::text, 'epi.epi_additional_permitted_uses' AS source FROM epi.epi_additional_permitted_uses
            UNION SELECT epi_name, map_name, label::text, 'epi.epi_key_sites' FROM epi.epi_key_sites
            UNION SELECT epi_name, map_name, label::text, 'epi.epi_local_provisions' FROM epi.epi_local_provisions
            UNION SELECT epi_name, map_name, label::text, 'epi.epi_special_provision' FROM epi.epi_special_provision
            UNION SELECT epi_name, map_name, coalesce(label, legis_area), 'rag.additional_controls:' || source FROM rag.additional_controls) s
      JOIN rag.instrument i ON i.title = s.epi_name
     WHERE s.label IS NOT NULL AND s.label <> '<Null>' AND s.map_name IS NOT NULL`).catch(() => ({ rows: [] as any[] }))).rows
  // where the plan's words name the area (the label in quotes, in a provision that names the map), the gap is a reader's;
  // where they do not, the area is one no clause names - the map's own legend, or a clause outside the corpus
  // (a label and its map named together - "“Area 2” on the Key Sites Map" - not each somewhere in the provision)
  const namedIn = (doc: string, map: string, label: string) => { const m = mentions.find(x => x.document_id === doc && x.map === map && x.label === label); return m ? { id: m.provision_id, local_id: m.local_id } : undefined }
  const coverage: any[] = [], seenCov = new Set<string>()
  for (const a of controlAreas) {
    const label = normLabel(String(a.label)), k = `${a.document_id}|${a.map}|${label}`
    if (areaKeys.has(k) || wholeMaps.has(`${a.document_id}|${a.map}`) || seenCov.has(k)) continue
    seenCov.add(k)
    const at: any = namedIn(a.document_id, a.map, label)
    coverage.push({ document_id: a.document_id, check_kind: 'area_no_clause', map: a.map, label, source: a.source, provision_id: at?.id ?? null,
      note: at ? `named in ${at.local_id} - no reader bound it` : 'no provision names this area' })
  }
  for (const b of out.filter(o => o.status === 'no_polygon')) {
    const c: any = metaOf.get(b.claim_id)
    if (c) coverage.push({ document_id: c.document_id, check_kind: 'clause_no_polygon', provision_id: c.pid, note: b.text.slice(0, 300) })
  }
  // bound, but some of the labels it names have no polygon (unheld:) - a lot outside the drawn ones is answered maybe
  for (const b of out.filter(o => o.status === 'bound' && (o.scope_terms as string[]).some(t => t.startsWith('unheld:')))) {
    const c: any = metaOf.get(b.claim_id)
    if (c) coverage.push({ document_id: c.document_id, check_kind: 'clause_no_polygon', provision_id: c.pid,
      note: `${b.text.slice(0, 200)} - no polygon for ${(b.scope_terms as string[]).filter(t => t.startsWith('unheld:')).map(t => t.slice(7).replace('|', ': ')).join(', ')}` })
  }
  // a condition no registered layer answers (no_match), or one registered with no dataset held and not assumed absent
  // (no_data): on a lot it is "could not check"
  for (const b of out.filter(o => o.status === 'no_match' || (o.status === 'no_data' && !o.assume_absent))) {
    const c: any = metaOf.get(b.claim_id)
    if (c) coverage.push({ document_id: c.document_id, check_kind: 'condition_no_layer', provision_id: c.pid, source: b.status === 'no_data' ? b.scope_terms.join(', ') : null,
      note: `${b.part === 'exclude' ? 'excluded if: ' : b.part === 'item' ? 'list item: ' : ''}${b.text.slice(0, 260)}${b.status === 'no_data' ? ` - registered, no dataset held` : ''}` })
  }
  // a frame whose place was not read: every rule under it is unknown on every lot
  for (const b of out.filter(o => o.status === 'unscoped')) {
    const c: any = metaOf.get(b.claim_id)
    if (c) coverage.push({ document_id: c.document_id, check_kind: 'frame_unscoped', provision_id: c.pid, note: b.text.slice(0, 300) })
  }
  // a map label only a source other than the plan's EPI map layers draws (the Additional Controls, a resolver map ref):
  // a gap in the EPI dump, kept on record - with whether the plan has that map in the dump at all
  // (a resolver ref with no map is a site - a street address or a Lot/DP - not a map label)
  if (!DRY) for (const g of (await q(`
      WITH k AS (SELECT document_id, map, label, bool_or(source LIKE 'epi.%') AS in_epi, string_agg(DISTINCT source, ', ') AS sources
                   FROM rag.map_polygon WHERE label IS NOT NULL AND map IS NOT NULL GROUP BY 1, 2, 3)
      SELECT k.document_id, k.map, k.label, k.sources,
             (SELECT count(DISTINCT e.label) FROM rag.map_polygon e WHERE e.document_id = k.document_id AND e.map = k.map AND e.source LIKE 'epi.%')::int AS epi_labels
        FROM k JOIN rag.instrument i ON i.document_id = k.document_id
       WHERE NOT k.in_epi AND i.kind = 'lep' ORDER BY 1, 2, 3`)).rows)
    coverage.push({ document_id: g.document_id, check_kind: 'label_not_in_epi', map: g.map, label: g.label, source: g.sources,
      note: g.epi_labels ? `the plan's EPI layer for this map holds ${g.epi_labels} other label(s), not this one` : 'the EPI dump holds no layer for this map in this plan' })
  // a map amended after the date the text is as at: the amendment that redrew it may have changed clauses the corpus does
  // not hold (each epi layer's commenced_date, the Additional Controls' currency_date)
  const dated = (await q(`SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema = 'epi' AND c.column_name = 'commenced_date'
                             AND c.table_name = ANY($1::text[])`, [epiMaps.map(r => r.table_name)])).rows.map(r => String(r.table_name))
  const newer = [
    ...dated.map(t => `SELECT i.document_id, lower(regexp_replace(e.map_name, ' Map$', '')) AS map, 'epi.${t}' AS source, max(e.commenced_date)::date::text AS at, string_agg(DISTINCT e.amendment, '; ') AS amds
                         FROM epi.${t} e JOIN rag.instrument i ON i.title = e.epi_name WHERE i.as_at IS NOT NULL AND e.commenced_date::date > (i.as_at AT TIME ZONE 'Australia/Sydney')::date GROUP BY 1, 2`),
    `SELECT i.document_id, lower(regexp_replace(a.map_name, ' Map$', '')), 'rag.additional_controls:' || a.source, max(a.currency_date)::date::text, string_agg(DISTINCT a.amendment, '; ')
       FROM rag.additional_controls a JOIN rag.instrument i ON i.title = a.epi_name WHERE i.as_at IS NOT NULL AND a.currency_date::date > (i.as_at AT TIME ZONE 'Australia/Sydney')::date GROUP BY 1, 2, 3`]
  if (!DRY) for (const r of (await q(`SELECT z.*, (i.as_at AT TIME ZONE 'Australia/Sydney')::date::text AS as_at FROM (${newer.join(' UNION ALL ')}) z
                                       JOIN rag.instrument i ON i.document_id = z.document_id ORDER BY 1, 2`).catch(e => { console.log('map currency:', String(e).slice(0, 120)); return { rows: [] as any[] } })).rows)
    coverage.push({ document_id: r.document_id, check_kind: 'map_newer_than_text', map: r.map, label: null, source: r.source,
      note: `amended ${r.at}${r.amds ? ` (${String(r.amds).slice(0, 160)})` : ''} - the text is as at ${r.as_at}` })
  // a Schedule 1 item with words but no permission read
  const schItems =(await q(`SELECT p.id, p.document_id, p.local_id FROM rag.provision p JOIN rag.instrument i ON i.document_id = p.document_id
                              WHERE i.kind = 'lep' AND p.local_id ~ '^sch\.1-sec\.[^-]+$'
                                AND EXISTS (SELECT 1 FROM rag.provision k WHERE k.document_id = p.document_id AND k.local_id LIKE p.local_id || '-%' AND coalesce(k.own_text, '') <> '')`)).rows
  for (const it of schItems)
    if (!meta.some((r: any) => r.kind === 'permit' && r.document_id === it.document_id && r.local_id.startsWith(it.local_id + '-')))
      coverage.push({ document_id: it.document_id, check_kind: 'schedule_item_unread', provision_id: it.id, note: 'no permission read in this item' })
  // the measures no reader took (written by 02c-claims.ts to rag.unread)
  for (const u of (await q(`SELECT u.provision_id, p.document_id, u.span FROM rag.unread u JOIN rag.provision p ON p.id = u.provision_id WHERE u.reader = 'claims'`)).rows)
    coverage.push({ document_id: u.document_id, check_kind: 'figure_unread', provision_id: u.provision_id, note: String(u.span ?? '').slice(0, 300) })
  // per plan, kept with the run so the next build can say what moved: coverage by kind, bindings by status
  const docOfClaim = (id: string) => (metaOf.get(id) as any)?.document_id
  const byPlan: Record<string, Record<string, number>> = {}
  const bump = (doc: string | undefined, k: string) => { if (!doc) return; byPlan[doc] ??= {}; byPlan[doc]![k] = (byPlan[doc]![k] ?? 0) + 1 }
  for (const c of coverage) bump(c.document_id, `coverage:${c.check_kind}`)
  for (const b of out) bump(docOfClaim(b.claim_id), `binding:${b.status}`)
  for (const a of areaRows) bump(a.document_id, 'area_clause')
  const covTally = coverage.reduce((a: Record<string, number>, c) => ({ ...a, [c.check_kind]: (a[c.check_kind] ?? 0) + 1 }), {})
  console.log(`\narea_clause: ${areaRows.length} (map area, clause) links over ${areaKeys.size} areas | coverage`, covTally)
  if (DRY) { await client.end(); return }
  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('bindings', '{}') RETURNING id`)).rows[0].id
  await q(`DELETE FROM rag.claim_binding`)
  await q(`INSERT INTO rag.claim_binding (claim_id, part, text, status, scope_terms, sources, assume_absent, note, run_id)
           SELECT claim_id, part, text, status, scope_terms, sources, assume_absent, note, $2 FROM jsonb_to_recordset($1::jsonb)
             AS x(claim_id uuid, part text, text text, status text, scope_terms text[], sources text[], assume_absent boolean, note text)`, [JSON.stringify(out), run])
  await q(`DELETE FROM rag.area_clause`)
  for (let i = 0; i < areaRows.length; i += 2000)
    await q(`INSERT INTO rag.area_clause (document_id, map, label, provision_id, claim_id, claim_kind, role, via_frame, distance_m, run_id)
             SELECT document_id, map, label, provision_id, claim_id, claim_kind, role, via_frame, distance_m, $2 FROM jsonb_to_recordset($1::jsonb)
               AS x(document_id uuid, map text, label text, provision_id uuid, claim_id uuid, claim_kind text, role text, via_frame boolean, distance_m numeric)`, [JSON.stringify(areaRows.slice(i, i + 2000)), run])
  // its own kinds only: 01d-currency.py writes text_changed_since
  await q(`DELETE FROM rag.coverage WHERE check_kind <> 'text_changed_since'`)
  await q(`INSERT INTO rag.coverage (document_id, check_kind, map, label, provision_id, source, note, run_id)
           SELECT document_id, check_kind, map, label, provision_id, source, note, $2 FROM jsonb_to_recordset($1::jsonb)
             AS x(document_id uuid, check_kind text, map text, label text, provision_id uuid, source text, note text)`, [JSON.stringify(coverage), run])
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ bindings: out.length, by: tally, area_clause: areaRows.length, coverage: covTally, by_plan: byPlan })])
  await q('COMMIT')
  console.log('written', out.length)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
