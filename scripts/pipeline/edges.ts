/**
 * Step 6 of the rule pipeline (docs/sepp-rule-pipeline.md): permissions and overrides become edges.
 *
 *   npx tsx scripts/pipeline/edges.ts --profile housing-sepp-2021 --chapter ch.6          # write
 *   npx tsx scripts/pipeline/edges.ts --profile housing-sepp-2021 --chapter ch.6 --dry
 *
 * From the routed signals (step 4) on each extracted rule's sections (step 5):
 *   override        "Despite the provisions of another environmental planning instrument, ..." (s 169(1A),
 *                   s 173(1A)) -> prevails_over 'doc_type:lep' and 'doc_type:sepp' (other EPIs; a DCP is not
 *                   an environmental planning instrument). Clause-specific, on top of the instrument frame's
 *                   general s 8(1) edge (step 3).
 *   disapplication  "A requirement specified in another environmental planning instrument or development
 *                   control plan in relation to ... does not apply to development that meets ..." (s 178)
 *                   -> disapplies 'doc_type:lep' and 'doc_type:dcp', scope = the topics and the condition.
 * Edges are owned by their rule: replaced wholesale on each run (authority 'instrument', cross_document).
 *
 * "Done when" also proves the motivating conflict is representable: a SEPP permission for a land use whose
 * frame chain reaches a prevails_over doc_type:lep edge, against an LEP rule that withholds consent for the
 * same land use - Housing SEPP s 166 vs Parramatta LEP 2023 cl 6.11(1).
 */
import 'dotenv/config'
import pg from 'pg'
import type { InstrumentProfile } from '../../profiles/housing-sepp-2021'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const CHAPTER = argv.includes('--chapter') ? argv[argv.indexOf('--chapter') + 1] : 'ch.6'

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
// "dual occupancies" and "dual occupancy" are one land use: the shared key, also used by /api/rules/at
import { landUseKey } from '../../shared/land-use-key'

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  const secs = (await client.query(`SELECT id, parent_id, local_id, raw_text, signals FROM nsw.section WHERE document_id = $1`, [doc.id])).rows
  const byId = new Map(secs.map(s => [s.id as string, s]))
  const under = (s: any, root: string) => { for (let x = s; x; x = x.parent_id ? byId.get(x.parent_id) : null) if (x.local_id === root) return true; return false }

  // clause-level pipeline rules of this chapter (sub-rules share their clause's edges through the clause)
  const rules = (await client.query(
    `SELECT r.id, r.rule_key, r.clause, s.local_id, r.kind
       FROM nsw.rule r JOIN nsw.section s ON s.id = r.section_id
      WHERE r.document_id = $1 AND r.rule_key LIKE $2 AND r.publish_state <> 'retired'`,
    [doc.id, `${profile.instrument}:pipeline:%`])).rows
    .filter(r => r.rule_key.split(':').length === 3 && under(byId.get(secs.find(s => s.local_id === r.local_id)!.id), CHAPTER))

  const planned: { rule: any; edge_type: string; to_ref: string; scope: any; span: string }[] = []
  for (const r of rules) {
    const parts = secs.filter(s => under(s, r.local_id))
    for (const p of parts) {
      const t = norm(p.raw_text)
      const sig = p.signals ?? []
      if (sig.includes('override')) {
        for (const to of ['doc_type:lep', 'doc_type:sepp']) {
          planned.push({ rule: r, edge_type: 'prevails_over', to_ref: to, span: t,
            scope: { extent: 'despite the provisions of another environmental planning instrument', clause: p.local_id } })
        }
      }
      if (sig.includes('disapplication')) {
        const items = parts.filter(x => x.parent_id === p.id).map(x => norm(x.raw_text).replace(/[,.]$/, ''))
        const topics = items.map(i => (/lot size/i.test(i) ? 'lot_size' : /width/i.test(i) ? 'width' : i))
        const when = t.match(/to development that (meets the standards in section [\d()A-Za-z ,or]+?)—/i)?.[1] ?? null
        const tos = [/environmental planning instrument/i.test(t) ? 'doc_type:lep' : null, /development control plan/i.test(t) ? 'doc_type:dcp' : null]
        for (const to of tos.filter(Boolean) as string[]) {
          planned.push({ rule: r, edge_type: 'disapplies', to_ref: to, span: t, scope: { topics, when, clause: p.local_id } })
        }
      }
    }
  }

  if (!DRY) {
    const ids = [...new Set(planned.map(p => p.rule.id))]
    const all = rules.map(r => r.id)
    await client.query(`DELETE FROM nsw.rule_edge WHERE from_rule_id = ANY($1) AND edge_type IN ('prevails_over', 'disapplies')`, [all])
    for (const p of planned) {
      await client.query(
        `INSERT INTO nsw.rule_edge (from_rule_id, to_ref, edge_type, authority, scope, source_span, confidence, cross_document)
         VALUES ($1, $2, $3, 'instrument', $4::jsonb, $5, 1.0, true)`,
        [p.rule.id, p.to_ref, p.edge_type, JSON.stringify(p.scope), p.span])
    }
    void ids
  }

  // ── done-when: the motivating conflict is representable ───────────────────────────────────────
  const perm = (await client.query(
    `SELECT r.rule_key, r.clause, e.topic, r.frame_rule_id
       FROM nsw.rule r JOIN nsw.rule_effect e ON e.rule_id = r.id
      WHERE r.document_id = $1 AND r.kind = 'permission' AND e.effect_type = 'permits_use'`, [doc.id])).rows
  // walk each permission's frame chain to a prevails_over doc_type:lep edge
  const frameChain = async (fid: string | null) => {
    const out: any[] = []
    for (let id = fid; id;) {
      const f = (await client.query(`SELECT id, rule_key, clause, frame_rule_id FROM nsw.rule WHERE id = $1`, [id])).rows[0]
      if (!f) break
      out.push(f); id = f.frame_rule_id
    }
    return out
  }
  const lepBlocks = (await client.query(
    `SELECT d.instrument_slug, r.clause, a.value AS land_use,
            (SELECT string_agg(a2.dimension || '=' || a2.value || coalesce(' on ' || a2.map_layer, ''), '; ')
               FROM nsw.rule_applicability a2 WHERE a2.rule_id = r.id AND a2.polarity = 'applies') AS where_
       FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
       JOIN nsw.rule_applicability a ON a.rule_id = r.id AND a.dimension = 'land_use' AND a.polarity = 'excludes'
      WHERE d.doc_type = 'lep' AND r.publish_state = 'published'
        AND EXISTS (SELECT 1 FROM nsw.rule_applicability c WHERE c.rule_id = r.id AND c.dimension = 'act'
                     AND c.value = 'development consent' AND c.polarity = 'excludes')`)).rows

  const edges = (await client.query(
    `SELECT r.rule_key, e.edge_type, e.to_ref, e.scope FROM nsw.rule_edge e JOIN nsw.rule r ON r.id = e.from_rule_id
      WHERE r.document_id = $1 ORDER BY r.rule_key, e.edge_type, e.to_ref`, [doc.id])).rows

  console.log(`${DRY ? '[dry] ' : ''}${planned.length} edges ${DRY ? 'planned' : 'written'} from ${new Set(planned.map(p => p.rule.rule_key)).size} rules\n`)
  for (const e of edges) console.log(`  ${e.rule_key.padEnd(44)} ${e.edge_type.padEnd(14)} ${e.to_ref.padEnd(14)} ${JSON.stringify(e.scope)}`)

  // the profile's spot checks: conflicts with an LEP that must be resolvable, and edges that must exist
  const ck = profile.checks?.edges ?? { prevailsOverLep: [], conflicts: [] }
  const results: string[] = []
  let pass = true
  for (const cf of ck.conflicts) {
    let resolved = false
    for (const p of perm.filter(p => p.clause === cf.clause)) {
      const chain = await frameChain(p.frame_rule_id)
      const top = chain.find(f => edges.some(e => e.rule_key === f.rule_key && e.edge_type === 'prevails_over' && e.to_ref === 'doc_type:lep'))
      const blocks = lepBlocks.filter(b => b.instrument_slug.startsWith(cf.lep) && landUseKey(b.land_use) === landUseKey(p.topic))
      for (const b of blocks) {
        resolved = !!top
        console.log(`\n  CONFLICT  ${profile.label} s ${p.clause} permits "${p.topic}" (frames: ${chain.map(f => f.clause).join(' <- ')})`
          + `\n            vs ${b.instrument_slug} cl ${b.clause} withholds consent for "${b.land_use}" where ${b.where_}`
          + `\n            resolved by: ${top ? `s ${top.clause} prevails_over doc_type:lep (frame ${top.rule_key})` : 'NOTHING - no prevails edge on the chain'}`)
      }
    }
    if (!resolved) pass = false
    results.push(`${cf.label} representable ${resolved ? 'yes' : 'NO'}`)
  }
  const overrides = edges.filter(e => e.edge_type === 'prevails_over' && e.to_ref === 'doc_type:lep').map(e => e.rule_key)
  for (const suffix of ck.prevailsOverLep) {
    const ok = overrides.some(k => k.endsWith(suffix))
    if (!ok) pass = false
    results.push(`prevails edge on ${suffix} ${ok ? 'yes' : 'NO'}`)
  }
  console.log(`\n  ${pass ? 'PASS' : 'FAIL'}: ${results.join('; ') || 'no profile checks'}`)
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
