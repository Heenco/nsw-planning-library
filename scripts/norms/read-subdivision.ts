/**
 * Read every subdivision clause of every instrument in the graph with the clause reader (shared/norms/reader.ts) and
 * write the norms into the graph (nsw.norm, family 'subdivision', author 'clause reader').
 *
 *   npx tsx scripts/norms/read-subdivision.ts --dry               # coverage report, nothing written
 *   npx tsx scripts/norms/read-subdivision.ts --dry --show <slug> <clause>
 *   npx tsx scripts/norms/read-subdivision.ts --dry --inert       # the clauses read as having no rule of their own
 *   npx tsx scripts/norms/read-subdivision.ts                     # write nsw.norm (versioned) + nsw.norm_unchecked
 *
 * Instruments: every LEP, and every SEPP in the graph. A clause is a subdivision clause by its heading ("subdivision",
 * "lot size") or by its own words ("the subdivision of", "be subdivided"). SEPP norms carry their frame - where that
 * part of the SEPP applies - converted from the graph's frame rules (nsw.rule kind 'frame').
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { readClause, type Section } from '../../shared/norms/reader'
import type { Cond, Norm } from '../../shared/norms/schema'
// @ts-expect-error - plain .mjs reader (the closed Standard Instrument land use vocabulary)
import { matchLandUses } from '../lib/si-landuse.mjs'

const DRY = process.argv.includes('--dry')
const INERT = process.argv.includes('--inert')   // list the clauses with no rule of their own
const SHOW = process.argv.includes('--show') ? process.argv.slice(process.argv.indexOf('--show') + 1, process.argv.indexOf('--show') + 3) : null
const FAMILY = 'subdivision'

const leaves = (c: Cond): any[] => 'all' in c ? c.all.flatMap(leaves) : 'any' in c ? c.any.flatMap(leaves) : 'not' in c ? leaves(c.not) : [c]
const usesIn = (t: string) => ((matchLandUses(t) ?? []) as string[]).filter(u => u !== 'dwelling')

/** A frame's conditions (rule_applicability on a kind 'frame' rule) as a condition - fail closed. */
function frameCond(rows: { dimension: string; value: string; polarity: string; alt_group: string | null }[], terms: Set<string>): Cond | null {
  const leaf = (a: typeof rows[number]): Cond => {
    const v = String(a.value), lv = v.toLowerCase()
    switch (a.dimension) {
      case 'zone': return { fact: 'lot.zone', value: v, span: `frame: zone ${v}` }
      case 'defined_area': case 'land_characteristic': case 'map_area': case 'lga':
        return terms.has(lv) ? { fact: 'lot.in', value: lv, span: `frame: ${v}` } : { fact: 'unparsed', text: `${a.dimension.replace(/_/g, ' ')}: ${v}`, span: `frame: ${v}` }
      case 'permissible_under': return lv.startsWith('lep:') ? { fact: 'lot.permits', value: v.slice(4), span: `frame: ${v}` } : { fact: 'unparsed', text: `permissible under ${v}`, span: `frame: ${v}` }
      case 'proponent': return { fact: 'proposal.proponent', value: v, span: `frame: ${v}` }
      // a development application is what the question asks about; any other pathway or proposal fact is unread
      // a pathway: a development application, complying development (a certificate) or exempt development - other
      // wording (a Chapter 7 pattern route) is not a pathway the vocabulary holds
      case 'pathway': return lv === 'development_application' ? { fact: 'proposal.pathway', value: 'development_application', span: `frame: ${v}` }
        : /complying/.test(lv) ? { fact: 'proposal.pathway', value: 'complying_development', span: `frame: ${v}` }
        : /^exempt/.test(lv) ? { fact: 'proposal.pathway', value: 'exempt_development', span: `frame: ${v}` }
        : { fact: 'unparsed', text: `pathway: ${v}`, span: `frame: ${v}` }
      default: return { fact: 'unparsed', text: `${a.dimension.replace(/_/g, ' ')}: ${v}`, span: `frame: ${v}` }
    }
  }
  const plain = rows.filter(r => !r.alt_group).map(r => r.polarity === 'excludes' ? { not: leaf(r) } as Cond : leaf(r))
  // alternatives: 'group#branch' - a group holds when one branch holds; a branch is all of its rows
  const groups = new Map<string, Map<string, typeof rows>>()
  for (const r of rows.filter(r => r.alt_group)) {
    const [g, b] = String(r.alt_group).split('#')
    if (!groups.has(g!)) groups.set(g!, new Map())
    groups.get(g!)!.set(b!, [...(groups.get(g!)!.get(b!) ?? []), r])
  }
  const alts: Cond[] = [...groups.values()].map(bs => ({ any: [...bs.values()].map(rs => ({ all: rs.map(r => r.polarity === 'excludes' ? { not: leaf(r) } as Cond : leaf(r)) } as Cond)) }))
  const all = [...plain, ...alts]
  return all.length ? (all.length === 1 ? all[0]! : { all }) : null
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p?: unknown[]) => client.query(sql, p as any[])
  const terms = new Set<string>((await q(`SELECT lower(term) AS t FROM nsw.scope_layer`)).rows.map(r => r.t))
  const docs = (await q(`SELECT id, title, instrument_slug, doc_type FROM nsw.document WHERE doc_type IN ('lep', 'sepp') ORDER BY doc_type, title`)).rows
  const report: string[] = []
  const tot = { clauses: 0, read: 0, norms: 0, unparsed: 0, leaves: 0, unread: 0, other: 0, inert: 0 }
  for (const d of docs) {
    const secs: (Section & { level: string; id: string; parent_id: string | null })[] = (await q(`SELECT id, parent_id, local_id, raw_text, heading, level, route FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [d.id])).rows
    const byId = new Map(secs.map(s => [s.id, s]))
    // the parts, chapters and divisions a clause sits in - for "carried out under this Part"
    const containerOf = (local: string) => {
      const out: Record<string, string> = {}
      for (let x = secs.find(s => s.local_id === local); x; x = x.parent_id ? byId.get(x.parent_id) : undefined)
        if (['part', 'chapter', 'division'].includes(x.level) && !out[x.level]) out[x.level] = x.local_id
      return out
    }
    if (!secs.length) continue
    // an aims, objectives, definitions or interpretation clause names subdivision but states no rule to apply
    const clauses = secs.filter(s => s.level === 'clause' && !/^(aims?|objects?|objectives|definitions?|interpretation)\b/i.test(s.heading ?? '') && (/subdivi|lot size/i.test(s.heading ?? '')
      || secs.some(x => (x.local_id === s.local_id || x.local_id.startsWith(s.local_id + '-')) && /\bthe subdivision of\b|\bbe subdivided\b/i.test(x.raw_text ?? ''))))
    if (!clauses.length) continue
    // the graph's place polygons, per clause
    const places = (await q(`SELECT sr.id::text AS id, sr.value, sr.map_layer AS layer, s.local_id FROM nsw.rule_spatial_ref sr JOIN nsw.rule r ON r.id = sr.rule_id
      JOIN nsw.section s ON s.id = r.section_id WHERE r.document_id = $1 AND sr.geom IS NOT NULL`, [d.id])).rows
    // SEPP frames: the frame rule of each clause's own graph rules
    // ... and its parents up the chain (ch6-lmr-area -> ch6 -> instrument): every frame's conditions apply
    const frames = d.doc_type === 'sepp' ? (await q(`
      WITH RECURSIVE chain AS (
        SELECT r.id AS rid, f.id AS fid, f.frame_rule_id AS next, f.rule_key, 0 AS depth FROM nsw.rule r JOIN nsw.rule f ON f.id = r.frame_rule_id
         WHERE r.document_id = $1 AND r.publish_state <> 'retired' AND r.kind <> 'frame'
        UNION ALL SELECT c.rid, p.id, p.frame_rule_id, p.rule_key, c.depth + 1 FROM chain c JOIN nsw.rule p ON p.id = c.next)
      SELECT s.local_id, min(c.rule_key) FILTER (WHERE c.depth = 0) AS rule_key,
             coalesce(json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity, 'alt_group', a.alt_group)) FILTER (WHERE a.id IS NOT NULL), '[]') AS conds
        FROM chain c JOIN nsw.rule r ON r.id = c.rid JOIN nsw.section s ON s.id = r.section_id LEFT JOIN nsw.rule_applicability a ON a.rule_id = c.fid
       GROUP BY s.local_id`, [d.id])).rows : []
    const out: Norm[] = []
    const unreadAll: { clause: string; section: string; zones: string[] | null; heading: string | null; when: Cond | null }[] = []
    let read = 0, other = 0
    for (const cl of clauses) {
      const placesHere = places.filter(p => p.local_id === cl.local_id || p.local_id.startsWith(cl.local_id + '-'))
      const r = readClause(secs, cl.local_id, { instrument: d.title, slug: d.instrument_slug, usesIn, places: placesHere, terms, container: containerOf(cl.local_id) })
      tot.clauses++
      if (r.family === 'other') { other++; continue }
      // not adopted / repealed, or an application provision: no rule of its own
      if (r.family === 'inert') { tot.inert++; if (INERT) console.log(`inert  ${d.instrument_slug.slice(0, 40).padEnd(40)} ${cl.local_id.padEnd(10)} ${(cl.heading ?? '').slice(0, 50).padEnd(50)} | ${secs.filter(x => x.local_id === cl.local_id || x.local_id.startsWith(cl.local_id + '-')).map(x => String(x.raw_text ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)[0]?.slice(0, 110) ?? ''}`); continue }
      if (r.norms.length) read++
      // a SEPP clause's frame: where that part applies
      const f = frames.find(x => x.local_id === cl.local_id || x.local_id.startsWith(cl.local_id + '-'))
      const fc = f ? frameCond(f.conds, terms) : null
      // where an unread statement of this clause reaches: the clause's own scope and its frame
      const reach: Cond[] = [r.scope, fc].filter(Boolean) as Cond[]
      const when = reach.length ? (reach.length === 1 ? reach[0]! : { all: reach }) : null
      for (const n of r.norms) {
        if (fc) n.when = { all: [n.when, fc] }
        out.push(n)
      }
      for (const u of r.unread) unreadAll.push({ clause: u, section: cl.local_id, zones: r.zones, heading: cl.heading ?? null, when })
      if (!r.norms.length && r.family !== 'other') unreadAll.push({ clause: cl.local_id.replace('sec.', ''), section: cl.local_id, zones: r.zones, heading: cl.heading ?? null, when })
      if (SHOW && SHOW[0] === d.instrument_slug && `sec.${SHOW[1]}` === cl.local_id) {
        const say = (c: Cond): string => 'all' in c ? `ALL(${c.all.map(say).join(', ')})` : 'any' in c ? `ANY(${c.any.map(say).join(', ')})` : 'not' in c ? `NOT ${say(c.not)}`
          : c.fact === 'unparsed' ? `?«${String(c.text).slice(0, 70)}»` : `${c.fact}${c.value ? '=' + c.value : ''}${c.text && c.fact !== 'lot.on_ref' ? ' ' + c.text : ''}${c.cmp ? ` ${c.cmp} ${c.n}` : ''}`
        for (const n of r.norms) console.log(`  ${n.clause} ${JSON.stringify(n.then)}${n.despite?.length ? ' despite ' + n.despite.join(',') : ''}\n     ${say(n.when)}`)
        console.log('  unread:', r.unread.join(', ') || '-', '| family', r.family, '| frame', f?.rule_key ?? '-')
      }
    }
    const ls = out.flatMap(n => leaves(n.when))
    const un = ls.filter(l => l.fact === 'unparsed').length
    tot.read += read; tot.norms += out.length; tot.unparsed += un; tot.leaves += ls.length; tot.unread += unreadAll.length; tot.other += other
    report.push(`${d.title.slice(0, 55).padEnd(55)} clauses ${String(clauses.length).padStart(3)} read ${String(read).padStart(3)} other ${String(other).padStart(2)} norms ${String(out.length).padStart(3)} unparsed ${String(un).padStart(3)}/${String(ls.length).padStart(3)} unread ${unreadAll.length}`)
    if (!DRY) {
      await q('BEGIN')
      const cur = new Map((await q(`SELECT id, content_sha256 FROM nsw.norm WHERE family = $1 AND document_id = $2 AND valid_to IS NULL AND author ->> 'by' LIKE 'clause reader%'`, [FAMILY, d.id])).rows.map(r => [r.id, r.content_sha256]))
      const seen = new Set<string>()
      for (const n of out) {
        seen.add(n.id)
        const h = createHash('sha256').update(JSON.stringify({ when: n.when, then: n.then, despite: n.despite ?? [] })).digest('hex')
        if (cur.get(n.id) === h) continue
        if (cur.has(n.id)) await q(`UPDATE nsw.norm SET valid_to = now() WHERE id = $1 AND valid_to IS NULL`, [n.id])
        const sid = (await q(`SELECT id FROM nsw.section WHERE document_id = $1 AND local_id = $2`, [d.id, n.section])).rows[0]?.id ?? null
        await q(`INSERT INTO nsw.norm (id, family, document_id, section_id, section, clause, "when", "then", despite, subject_to, author, content_sha256)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10, $11)`,
          [n.id, FAMILY, d.id, sid, n.section, n.clause, JSON.stringify(n.when), JSON.stringify(n.then), n.despite ?? [], JSON.stringify({ by: n.author.by, at: new Date().toISOString() }), h])
      }
      const gone = [...cur.keys()].filter(id => !seen.has(id))
      if (gone.length) await q(`UPDATE nsw.norm SET valid_to = now() WHERE id = ANY($1) AND valid_to IS NULL`, [gone])
      await q(`DELETE FROM nsw.norm_unchecked WHERE family = $1 AND document_id = $2`, [FAMILY, d.id])
      for (const u of unreadAll) await q(`INSERT INTO nsw.norm_unchecked (family, document_id, section, clause, why, zones, "when") VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (family, document_id, section) DO UPDATE SET clause = nsw.norm_unchecked.clause || ', ' || EXCLUDED.clause`,
        [FAMILY, d.id, u.section, u.clause, u.heading ? `${u.heading} - a statement the clause reader does not recognise` : 'a statement the clause reader does not recognise', u.zones, u.when ? JSON.stringify(u.when) : null])
      await q('COMMIT')
    }
  }
  if (!SHOW) console.log(report.join('\n'))
  console.log(`\n${DRY ? '[dry] ' : ''}${tot.clauses} subdivision clauses: ${tot.read} read into ${tot.norms} norms, ${tot.other} about other development, ${tot.inert} with no rule of their own, ${tot.unread} statements unread; `
    + `${tot.unparsed} of ${tot.leaves} conditions unparsed (${(100 * tot.unparsed / Math.max(1, tot.leaves)).toFixed(0)}%)`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
