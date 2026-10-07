/**
 * Step 3 of the rule pipeline (docs/sepp-rule-pipeline.md): write an instrument profile's frames.
 *
 *   npx tsx scripts/pipeline/frames.ts --profile housing-sepp-2021          # write (held) + coverage check
 *   npx tsx scripts/pipeline/frames.ts --profile housing-sepp-2021 --dry    # coverage check only
 *   npx tsx scripts/pipeline/frames.ts --profile housing-sepp-2021 --chapter ch.6
 *
 * Each frame becomes one nsw.rule row (kind 'frame', role 'frame', src 'structural', publish_state 'held'),
 * keyed '<instrument>:frame:<id>' so a re-run updates it in place. Its conditions become rule_applicability
 * rows and its "prevails" becomes rule_edge prevails_over rows to 'doc_type:lep' / 'doc_type:dcp' - both
 * replaced wholesale on each run, since the frame owns them. A child frame points at its parent through
 * rule.frame_rule_id.
 *
 * The coverage check walks every section under the chapter and assigns it the MOST SPECIFIC frame whose
 * `governs` list names the section or one of its ancestors. "Done when" for step 3: every operative clause
 * resolves to exactly one most-specific frame, and the frames have been reviewed.
 */
import 'dotenv/config'
import pg from 'pg'
import type { Frame, InstrumentProfile } from '../../profiles/housing-sepp-2021'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const CHAPTER = argv.includes('--chapter') ? argv[argv.indexOf('--chapter') + 1] : 'ch.6'

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  if (!doc) throw new Error(`no nsw.document ${profile.slug}`)
  const sections = (await client.query(
    `SELECT id, local_id, parent_id, level, heading FROM nsw.section WHERE document_id = $1`, [doc.id])).rows
  const byLocal = new Map(sections.map(s => [s.local_id as string, s]))
  const byId = new Map(sections.map(s => [s.id as string, s]))

  // frames in parent-first order, with depth
  const frames = new Map(profile.frames.map(f => [f.id, f]))
  const depth = (f: Frame): number => (f.parent ? 1 + depth(frames.get(f.parent)!) : 0)
  const ordered = [...profile.frames].sort((a, b) => depth(a) - depth(b))

  const ruleIds = new Map<string, string>()
  if (!DRY) {
    for (const f of ordered) {
      const sec = byLocal.get(f.section)
      if (!sec) throw new Error(`frame ${f.id}: section ${f.section} not in the graph`)
      const parentId = f.parent ? ruleIds.get(f.parent) ?? null : null
      const { rows: [r] } = await client.query(
        `INSERT INTO nsw.rule (document_id, section_id, rule_key, clause, role, kind, src, instrument_rank, precedence,
                               notes, publish_state, valid_from, frame_rule_id)
         VALUES ($1, $2, $3, $4, 'frame', 'frame', 'structural', $5, $6, $7, 'held', $8, $9)
         ON CONFLICT (document_id, rule_key) DO UPDATE SET
           section_id = EXCLUDED.section_id, clause = EXCLUDED.clause, instrument_rank = EXCLUDED.instrument_rank,
           precedence = EXCLUDED.precedence, notes = EXCLUDED.notes, valid_from = EXCLUDED.valid_from,
           frame_rule_id = EXCLUDED.frame_rule_id
         RETURNING id`,
        [doc.id, sec.id, `${profile.instrument}:frame:${f.id}`, f.clause, profile.rank, depth(f),
         `${f.title}${f.note ? ' - ' + f.note : ''}`, f.validFrom ?? null, parentId])
      ruleIds.set(f.id, r.id)
      await client.query(`DELETE FROM nsw.rule_applicability WHERE rule_id = $1`, [r.id])
      for (const c of f.conditions) {
        await client.query(
          `INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span, alt_group)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, c.dimension, c.value, c.polarity, `${c.clause}: ${c.span}`, c.anyOf ?? null])
      }
      await client.query(`DELETE FROM nsw.rule_edge WHERE from_rule_id = $1 AND edge_type = 'prevails_over'`, [r.id])
      for (const over of f.prevails?.over ?? []) {
        await client.query(
          `INSERT INTO nsw.rule_edge (from_rule_id, to_ref, edge_type, authority, scope, source_span, confidence, cross_document)
           VALUES ($1, $2, 'prevails_over', 'instrument', '{"extent": "to the extent of the inconsistency"}'::jsonb, $3, 1.0, true)`,
          [r.id, `doc_type:${over}`, `${f.prevails!.clause}: ${f.prevails!.span}`])
      }
    }
  }

  // ── coverage: every section under the chapter -> its most specific frame ──────────────────────────
  const root = byLocal.get(CHAPTER)
  if (!root) throw new Error(`no section ${CHAPTER}`)
  const ancestors = (s: any): string[] => {
    const out: string[] = []
    for (let x = s; x; x = x.parent_id ? byId.get(x.parent_id) : null) out.push(x.local_id)
    return out
  }
  const under = sections.filter(s => ancestors(s).includes(CHAPTER))
  const rows: { local_id: string; level: string; heading: string; frame: string | null; ties: string[] }[] = []
  for (const s of under) {
    const chain = ancestors(s)
    const hits = profile.frames.filter(f => f.governs.some(g => chain.includes(g)))
    const best = Math.max(-1, ...hits.map(depth))
    const top = hits.filter(f => depth(f) === best)
    rows.push({ local_id: s.local_id, level: s.level, heading: s.heading ?? '', frame: top[0]?.id ?? null,
                ties: top.length > 1 ? top.map(f => f.id) : [] })
  }
  await client.end()

  const clauses = rows.filter(r => r.level === 'clause').sort((a, b) => a.local_id.localeCompare(b.local_id, undefined, { numeric: true }))
  console.log(`${DRY ? '[dry] ' : ''}${profile.frames.length} frames${DRY ? '' : ' written (held)'}; ${under.length} sections under ${CHAPTER}\n`)
  for (const c of clauses) console.log(`  ${c.local_id.padEnd(9)} ${c.heading.slice(0, 70).padEnd(72)} -> ${c.frame ?? 'NO FRAME'}${c.ties.length ? '  TIE ' + c.ties.join(',') : ''}`)
  const noFrame = rows.filter(r => !r.frame).length
  const ties = rows.filter(r => r.ties.length).length
  const tally = new Map<string, number>()
  for (const r of rows) tally.set(r.frame ?? 'none', (tally.get(r.frame ?? 'none') ?? 0) + 1)
  console.log(`\n  sections by frame: ${[...tally].map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`  ${noFrame === 0 && ties === 0 ? 'PASS' : 'FAIL'}: ${noFrame} sections with no frame, ${ties} with more than one most-specific frame`)
}

main().catch((e) => { console.error(e); process.exit(1) })
