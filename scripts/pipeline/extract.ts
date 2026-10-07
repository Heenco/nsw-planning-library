/**
 * Step 5 of the rule pipeline (docs/sepp-rule-pipeline.md): extract rules from an instrument's operative
 * sections, span-gated, and run the recall gate.
 *
 *   npx tsx scripts/pipeline/extract.ts --profile housing-sepp-2021 --chapter ch.6         # write (held)
 *   npx tsx scripts/pipeline/extract.ts --profile housing-sepp-2021 --chapter ch.6 --dry
 *   npx tsx scripts/pipeline/extract.ts --profile housing-sepp-2021 --chapter ch.6 --clauses sec.168,sec.170
 *     only those clauses: their rules are upserted, retired and re-audited; the rest of the chapter is untouched
 *     (the orchestrator, step 12, passes the clauses whose sections changed)
 *
 * Deterministic, no model. Reads with the SAME readers the LEP pipeline and the recall verifier use -
 * findNumberCandidates (verifiers/candidates.ts), topicOf / datumOf (lib/dcp-cells.mjs), matchLandUses
 * (lib/si-landuse.mjs) - imported directly, so extraction and the recall gate cannot drift.
 *
 * One rule per clause (key '<instrument>:pipeline:<clause local_id>'), plus one per paragraph that names its
 * own use ("for residential flat buildings—a maximum building height of 22m"). A clause row is often empty
 * (s 168); its words are in its subclauses and paragraphs, which are read and rolled up to the clause.
 *   applicability  from the scope text - a "This section applies to ..." subclause, or a permission sentence:
 *                  zones, land uses, the defined area (LMR area / inner / outer), subdivision, dates
 *   effects        numeric standards from the remaining paragraphs (non-discretionary where the clause is);
 *                  permits_use for a permission; matter_for_consideration; disapplies; a storey cap with its
 *                  height condition ("height of up to 22m unless ... 6 storeys or fewer")
 * Every applicability row and effect carries its source span (a literal substring of the section text).
 * Every rule is publish_state 'held' with frame_rule_id = its most specific frame.
 *
 * RECALL GATE: every number candidate in an operative section of an extracted clause must be claimed by an
 * effect or an applicability/condition, or explained. An unclaimed number is a gating audit_finding.
 * Requirements with no number ("lawful access and frontage to a public road", "must not be a battle-axe
 * lot") are recorded as non-gating findings - they need their own effect kind (later).
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { InstrumentProfile } from '../../profiles/housing-sepp-2021'
import { findNumberCandidates } from '../../server/utils/nsw-kg/verifiers/candidates'
// @ts-expect-error - plain .mjs readers
import { datumOf, topicOf } from '../lib/dcp-cells.mjs'
// @ts-expect-error - plain .mjs readers
import { matchLandUses } from '../lib/si-landuse.mjs'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const CHAPTER = argv.includes('--chapter') ? argv[argv.indexOf('--chapter') + 1] : 'ch.6'
const ONLY = argv.includes('--clauses') ? new Set(argv[argv.indexOf('--clauses') + 1]!.split(',').map(s => s.trim()).filter(Boolean)) : null

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
const ZONE_CODE = '(R[1-5]|E[1-5]|MU1|B[1-8]|SP[1-5]|RU[1-6]|C[1-4])'
/** "Zone R3 Medium Density Residential or R4 High Density Residential": the second code has no "Zone". */
const ZONE = new RegExp(`\\bZone ${ZONE_CODE}\\b|\\b${ZONE_CODE}\\s+(?:General|Low Density|Medium Density|High Density|Large Lot|Local Centre|Commercial|Mixed Use|Neighbourhood|Infrastructure|Metropolitan)`, 'g')
const zonesIn = (t: string) => [...t.matchAll(ZONE)].map(m => ({ code: (m[1] ?? m[2])!, span: m[0] }))
/**
 * Land uses per "or"/"and"/comma segment. matchLandUses keeps the longest match, so in "multi dwelling
 * housing or multi dwelling housing (terraces)" (s 171) it returns only the terraces - reading each
 * segment on its own keeps both.
 */
function usesIn(t: string): string[] {
  const out = new Set<string>()
  for (const seg of t.split(/,| or | and /)) for (const u of (matchLandUses(seg) ?? []) as string[]) if (u !== 'dwelling') out.add(u)
  return [...out]
}
/** The first of the profile's defined-area terms (longest first) named in the text. */
const areaIn = (t: string, areas: string[]) => areas.find(a => t.toLowerCase().includes(a)) ?? null
/**
 * What a section's own words narrow its standards to: a use ("for the purposes of X", "for X—") or a defined
 * area other than the ones the whole clause already applies in.
 */
function qualifierOf(t: string, areas: string[], clauseAreas: string[]): { uses: string[]; area: string | null } {
  const m = t.match(/for the purposes of (.+?)(?:—|\bwith a\b|\bif\b|\bunless\b|$)/i) ?? t.match(/^for (?:a building containing )?(.+?)—/i)
  const area = areaIn(t, areas)
  return { uses: m ? usesIn(m[1]!) : [], area: area && !clauseAreas.includes(area) ? area : null }
}
const UNIT: Record<string, string> = { sqm: 'sqm', metre: 'm', ratio: 'ratio', storeys: 'storeys', dwellings: 'dwellings' }

interface Applic { dimension: string; value: string; polarity: 'applies' | 'excludes'; span: string }
interface Effect {
  effect_type: string; topic: string | null; comparator: string | null; value: number | null; unit: string | null
  value_source: string | null; relative_to: string | null; measured_from: string | null; span: string
  condition_metric?: string | null; condition_hi?: number | null; condition_unit?: string | null
  claims: { section: string; value: number }[]
}
interface RuleOut {
  key: string; clause: string; local_id: string; section_id: string; kind: string; role: string; frame: string
  applic: Applic[]; effects: Effect[]
}

function comparatorOf(text: string): string | null {
  const t = text.toLowerCase()
  if (/\b(minimum|at least|not less than)\b/.test(t)) return 'gte'
  if (/\b(maximum|no more than|not more than|not exceed|up to|or fewer)\b/.test(t)) return 'lte'
  return null
}

function topicFor(text: string, cand: any): string | null {
  const t = text.toLowerCase()
  if (cand.unit === 'storeys' || /storeys?/.test(t) && cand.unit === 'storeys') return 'storeys'
  if (cand.unit === 'dwellings' || /\bdwellings?\b/.test(t) && /no more than \d+ dwelling/.test(t)) return 'dwellings'
  const read = topicOf([text])
  if (read) return read === 'width' ? 'width' : read
  if (/\barea of\b/.test(t)) return 'lot_size'
  if (/\bwide\b/.test(t)) return 'width'
  return null
}

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  const secs = (await client.query(
    `SELECT id, parent_id, local_id, level, heading, raw_text, route, signals, sort_order
       FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [doc.id])).rows
  const byId = new Map(secs.map(s => [s.id as string, s]))
  const chain = (s: any) => { const out: any[] = []; for (let x = s; x; x = x.parent_id ? byId.get(x.parent_id) : null) out.push(x); return out }
  const frames = (await client.query(
    `SELECT id, rule_key FROM nsw.rule WHERE document_id = $1 AND kind = 'frame'`, [doc.id])).rows
  const frameId = new Map(frames.map(f => [String(f.rule_key).split(':frame:')[1], f.id as string]))
  const depth = (id: string): number => { const f = profile.frames.find(x => x.id === id)!; return f.parent ? 1 + depth(f.parent) : 0 }
  const frameOf = (s: any) => {
    const up = chain(s).map(x => x.local_id)
    const hits = profile.frames.filter(f => f.governs.some(g => up.includes(g)))
    return hits.sort((a, b) => depth(b.id) - depth(a.id))[0]?.id ?? null
  }

  const SKIP = profile.skip ?? {}
  // the instrument's defined areas come from its term registry, longest first ("... inner area" before "... area")
  const AREAS = profile.terms.filter(t => t.dimension === 'defined_area').map(t => t.term.toLowerCase())
    .sort((a, b) => b.length - a.length)
  const clauses = secs.filter(s => s.level === 'clause' && chain(s).some(x => x.local_id === CHAPTER)
    && (!ONLY || ONLY.has(s.local_id)))
  const rules: RuleOut[] = []
  const findings: { kind: string; gating: boolean; clause: string; value: string | null; detail: string }[] = []
  const candidatesAll: { section: string; clause: string; value: number; raw: string }[] = []
  const skipped: string[] = []

  for (const c of clauses) {
    if (SKIP[c.local_id]) { skipped.push(`${c.local_id}: ${SKIP[c.local_id]}`); continue }
    const parts = [c, ...secs.filter(s => s.id !== c.id && chain(s).includes(c))]
    const operative = parts.filter(p => p.route === 'operative')
    if (!operative.length) { skipped.push(`${c.local_id}: no operative text (route ${c.route})`); continue }
    const sig = new Set(parts.flatMap(p => p.signals ?? []))
    const clauseNumbers = operative.reduce((n, p) => n + ((findNumberCandidates(norm(p.raw_text)) ?? []) as any[]).length, 0)
    const kind = sig.has('permission') ? 'permission' : sig.has('disapplication') ? 'disapplication'
      : sig.has('consideration') && !sig.has('nondiscretionary_heading') && clauseNumbers === 0 ? 'matters' : 'standard'
    const role = kind === 'permission' ? 'permission' : kind === 'disapplication' ? 'disapplication'
      : kind === 'matters' ? 'matters_for_consideration'
      : sig.has('nondiscretionary_heading') ? 'nondiscretionary_standard'
      : sig.has('prohibition') ? 'conditional_standard' : 'controls'
    const clauseNo = c.local_id.replace(/^sec\./, '')

    // scope text: "This section applies ..." subclauses (with their paragraphs) and permission sentences
    const isScope = (p: any) => {
      const t = norm(p.raw_text)
      return /^this (section|part|division) applies/i.test(t) || (p.signals ?? []).includes('permission')
        || /^this section applies only if/i.test(t)
    }
    const scopeRoots = operative.filter(isScope)
    const scopeSet = new Set<any>(scopeRoots)
    for (const p of parts) if (chain(p).some(x => scopeRoots.includes(x))) scopeSet.add(p)

    const base: RuleOut = { key: `${profile.instrument}:pipeline:${c.local_id}`, clause: clauseNo, local_id: c.local_id,
      section_id: c.id, kind, role, frame: frameOf(c), applic: [], effects: [] }
    const addApplic = (r: RuleOut, a: Applic) => { if (!r.applic.some(x => x.dimension === a.dimension && x.value === a.value && x.polarity === a.polarity)) r.applic.push(a) }

    for (const p of scopeSet) {
      const t = norm(p.raw_text)
      if (!t) continue
      for (const z of zonesIn(t)) addApplic(base, { dimension: 'zone', value: z.code, polarity: 'applies', span: z.span })
      for (const u of usesIn(t)) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: t.slice(0, 200) })
      const area = areaIn(t, AREAS)
      if (area) addApplic(base, { dimension: 'defined_area', value: area, polarity: 'applies', span: area })
      if (/involving subdivision/i.test(t)) addApplic(base, { dimension: 'dev_type', value: 'subdivision', polarity: 'applies', span: 'involving subdivision' })
      const date = t.match(/on or after (\d{1,2} \w+ \d{4})/i)
      if (date) addApplic(base, { dimension: 'temporal', value: `on or after ${date[1]}`, polarity: 'applies', span: date[0] })
    }
    // exclusions stated anywhere in the clause ("This section does not apply to strata subdivision.")
    for (const p of operative) {
      const t = norm(p.raw_text)
      const ex = t.match(/^this section does not apply to (.+?)\.?$/i)
      if (ex) addApplic(base, { dimension: 'dev_type', value: ex[1]!.replace(/\.$/, ''), polarity: 'excludes', span: t })
    }

    const out: RuleOut[] = [base]
    const effSections = operative.filter(p => !scopeSet.has(p))
    for (const p of [...effSections, ...(kind === 'permission' ? scopeRoots : [])]) {
      const t = norm(p.raw_text)
      const cands = (findNumberCandidates(t) ?? []) as any[]
      for (const cd of cands) candidatesAll.push({ section: p.local_id, clause: c.local_id, value: Number(cd.value), raw: cd.raw })

      // Standards narrowed by their own words - "(3) ... for the purposes of multi dwelling housing
      // (terraces)—", "(2) ... in a low and mid rise housing inner area—", "(b) for residential flat
      // buildings—" - go to their own rule: the nearest use and the nearest area up the chain to the clause,
      // keyed by the deepest section that narrowed it, inheriting the rest of the clause's applicability.
      let target = base
      if (cands.length && !scopeSet.has(p)) {
        const full = chain(p)
        const up = full.slice(0, full.indexOf(c))
        let uses: string[] = [], area: string | null = null, keyAt: any = null
        for (const x of up) {
          const q = qualifierOf(norm(x.raw_text), AREAS, base.applic.filter(a => a.dimension === 'defined_area').map(a => a.value))
          if (!uses.length && q.uses.length) { uses = q.uses; keyAt = keyAt ?? x }
          if (!area && q.area) { area = q.area; keyAt = keyAt ?? x }
        }
        if (keyAt) {
          const key = `${base.key}:${keyAt.local_id}`
          let r = out.find(x => x.key === key)
          if (!r) {
            r = { ...base, key, local_id: keyAt.local_id, section_id: keyAt.id, effects: [],
              applic: [...base.applic.filter(a => !(uses.length && a.dimension === 'land_use') && !(area && a.dimension === 'defined_area')),
                       ...uses.map(u => ({ dimension: 'land_use', value: u, polarity: 'applies' as const, span: norm(keyAt.raw_text).slice(0, 200) })),
                       ...(area ? [{ dimension: 'defined_area', value: area, polarity: 'applies' as const, span: area }] : [])] }
            out.push(r)
          }
          target = r
        }
      }

      if (kind === 'permission' && scopeRoots.includes(p)) {
        for (const u of (matchLandUses(t) ?? []) as string[]) {
          if (u === 'dwelling') continue
          target.effects.push({ effect_type: 'permits_use', topic: u, comparator: null, value: null, unit: null,
            value_source: 'sepp_permission', relative_to: null, measured_from: null, span: t, claims: [] })
        }
        continue
      }
      if (kind === 'matters' || ((p.signals ?? []).includes('consideration') && !cands.length)) {
        const g = t.match(/consider(?:ed)? the (.+?)(?:,| published|$)/i)
        target.effects.push({ effect_type: 'matter_for_consideration', topic: g ? g[1]!.trim() : 'see clause', comparator: null,
          value: null, unit: null, value_source: 'clause_text', relative_to: null, measured_from: null, span: t, claims: [] })
        continue
      }
      if (kind === 'disapplication') {
        if (!(p.signals ?? []).includes('disapplication')) continue
        const ref = t.match(/meets the standards in section ([\d()A-Za-z ,or]+?)—/i)
        const items = parts.filter(x => chain(x).includes(p) && x !== p).map(x => norm(x.raw_text).replace(/[,.]$/, ''))
        for (const it of items.length ? items : ['see clause']) {
          target.effects.push({ effect_type: 'disapplies', topic: /lot size/i.test(it) ? 'lot_size' : /width/i.test(it) ? 'width' : it,
            comparator: null, value: null, unit: null, value_source: 'clause_text',
            relative_to: ref ? `meets s ${ref[1]!.trim()}` : null, measured_from: null, span: t, claims: [] })
        }
        continue
      }
      // a storey cap conditional on height: "height of up to 22m unless ... 6 storeys or fewer"
      const storeys = cands.find(x => x.unit === 'storeys')
      const metres = cands.find(x => x.unit === 'metre')
      if (storeys && metres && /up to/i.test(t)) {
        target.effects.push({ effect_type: 'numeric', topic: 'storeys', comparator: 'lte', value: Number(storeys.value), unit: 'storeys',
          value_source: null, relative_to: null, measured_from: null, span: t,
          condition_metric: 'height', condition_hi: Number(metres.value), condition_unit: 'm',
          claims: [{ section: p.local_id, value: Number(storeys.value) }, { section: p.local_id, value: Number(metres.value) }] })
        continue
      }
      for (const cd of cands) {
        const topic = topicFor(t, cd)
        const comparator = comparatorOf(t) ?? (/\bmust be\b/i.test(t) ? 'gte' : null)
        if (!topic || !comparator) continue
        if (!/\bmust be\b/i.test(t) || comparatorOf(t)) { /* stated comparator */ } else {
          findings.push({ kind: 'comparator_inferred', gating: false, clause: p.local_id, value: String(cd.value),
            detail: `"${t}" states no minimum/maximum; read as a minimum (gte)` })
        }
        const datum = datumOf(t)
        target.effects.push({
          effect_type: role === 'nondiscretionary_standard' ? 'nondiscretionary_numeric' : 'numeric',
          topic, comparator, value: Number(cd.value), unit: UNIT[cd.unit] ?? (topic === 'parking' ? 'spaces per dwelling' : cd.unit ?? null),
          value_source: null, relative_to: null,
          measured_from: datum === 'front_boundary' ? 'front_boundary' : null, span: t,
          claims: [{ section: p.local_id, value: Number(cd.value) }] })
      }
      if (!cands.length && /must (have|not be)|lawful access/i.test(t) && role === 'nondiscretionary_standard') {
        findings.push({ kind: 'qualitative_requirement', gating: false, clause: p.local_id, value: null,
          detail: `no number to extract: "${t}" - needs a non-numeric requirement effect` })
      }
    }
    rules.push(...out)
  }

  // ── recall gate ─────────────────────────────────────────────────────────────────────────────────
  const claimed = new Set(rules.flatMap(r => r.effects.flatMap(e => e.claims.map(cl => `${cl.section}|${cl.value}`))))
  const unclaimed = candidatesAll.filter(cd => !claimed.has(`${cd.section}|${cd.value}`))
  for (const u of unclaimed) findings.push({ kind: 'unclaimed_number', gating: true, clause: u.section, value: String(u.value),
    detail: `"${u.raw}" in an operative section of ${u.clause} is not claimed by any effect` })

  // span gate: every span must be a literal substring of the text it came from
  const textOf = new Map(secs.map(s => [s.local_id as string, norm(s.raw_text)]))
  const allText = [...textOf.values()].join('\n')
  const badSpans = rules.flatMap(r => [...r.applic.map(a => a.span), ...r.effects.map(e => e.span)]).filter(sp => !allText.includes(sp))
  for (const b of badSpans) findings.push({ kind: 'span_not_in_text', gating: true, clause: null as any, value: null, detail: b.slice(0, 200) })

  // ── write ───────────────────────────────────────────────────────────────────────────────────────
  const runId = randomUUID()
  if (!DRY) {
    await client.query(
      `INSERT INTO nsw.ingest_run (id, document_id, doc_label, status, started_at, stage_metrics)
       VALUES ($1, $2, $3, 'running', now(), $4)`,
      [runId, doc.id, profile.label, JSON.stringify({ step: 5, script: 'scripts/pipeline/extract.ts', chapter: CHAPTER,
                                                       clauses: ONLY ? [...ONLY] : 'all' })])
    const keys: string[] = []
    for (const r of rules) {
      keys.push(r.key)
      const { rows: [row] } = await client.query(
        `INSERT INTO nsw.rule (document_id, section_id, rule_key, clause, role, kind, src, instrument_rank, precedence,
                               notes, publish_state, frame_rule_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'rubric', $7, 0, $8, 'held', $9)
         ON CONFLICT (document_id, rule_key) DO UPDATE SET
           section_id = EXCLUDED.section_id, clause = EXCLUDED.clause, role = EXCLUDED.role, kind = EXCLUDED.kind,
           instrument_rank = EXCLUDED.instrument_rank, notes = EXCLUDED.notes, frame_rule_id = EXCLUDED.frame_rule_id,
           publish_state = CASE WHEN nsw.rule.publish_state = 'retired' THEN 'held' ELSE nsw.rule.publish_state END,
           valid_to = NULL
         RETURNING id`,
        [doc.id, r.section_id, r.key, r.clause, r.role, r.kind, profile.rank,
         `pipeline step 5 (${CHAPTER}); frame ${r.frame}`, r.frame ? frameId.get(r.frame) ?? null : null])
      await client.query(`DELETE FROM nsw.rule_applicability WHERE rule_id = $1`, [row.id])
      await client.query(`DELETE FROM nsw.rule_effect WHERE rule_id = $1`, [row.id])
      for (const a of r.applic) {
        await client.query(`INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span)
                            VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [row.id, a.dimension, a.value, a.polarity, a.span])
      }
      for (const e of r.effects) {
        await client.query(
          `INSERT INTO nsw.rule_effect (id, rule_id, effect_type, topic, comparator, value, unit, value_source, relative_to,
                                        measured_from, source_span, condition_metric, condition_hi, condition_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [randomUUID(), row.id, e.effect_type, e.topic, e.comparator, e.value, e.unit, e.value_source, e.relative_to,
           e.measured_from, e.span, e.condition_metric ?? null, e.condition_hi ?? null, e.condition_unit ?? null])
      }
    }
    // keys this run's clauses produced last time and not now are retired, not deleted; with --clauses only
    // those clauses' keys ('<prefix><clause>' and '<prefix><clause>:<sub>') are in play
    const prefix = `${profile.instrument}:pipeline:`
    const scopes = ONLY ? [...ONLY].flatMap(c => [`${prefix}${c}`, `${prefix}${c}:%`]) : [`${prefix}%`]
    await client.query(
      `UPDATE nsw.rule SET publish_state = 'retired', valid_to = current_date
        WHERE document_id = $1 AND rule_key LIKE ANY($2) AND NOT (rule_key = ANY($3)) AND publish_state <> 'retired'
          AND section_id IN (SELECT id FROM nsw.section WHERE document_id = $1)`,
      [doc.id, scopes, keys])
    if (ONLY) {
      await client.query(
        `DELETE FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND detail LIKE 'step5%'
            AND EXISTS (SELECT 1 FROM unnest($2::text[]) c WHERE clause = c OR clause LIKE c || '-%')`, [doc.id, [...ONLY]])
    } else {
      await client.query(`DELETE FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND detail LIKE 'step5%'`, [doc.id])
    }
    for (const f of findings) {
      await client.query(
        `INSERT INTO nsw.audit_finding (id, document_id, run_id, kind, gating, clause, value, detail, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')`,
        [randomUUID(), doc.id, runId, f.kind, f.gating, f.clause, f.value, `step5 ${CHAPTER}: ${f.detail}`])
    }
    const gating = findings.filter(f => f.gating).length
    await client.query(
      `UPDATE nsw.ingest_run SET status = $2, finished_at = now(), totals = $3 WHERE id = $1`,
      [runId, gating ? 'failed' : 'success', JSON.stringify({ rules: rules.length,
        effects: rules.reduce((n, r) => n + r.effects.length, 0), applicability: rules.reduce((n, r) => n + r.applic.length, 0),
        numbers: candidatesAll.length, unclaimed: unclaimed.length, findings: findings.length, gating })])
  }
  await client.end()

  // ── report ──────────────────────────────────────────────────────────────────────────────────────
  console.log(`${DRY ? '[dry] ' : ''}${rules.length} rules from ${CHAPTER} (${skipped.length} clauses skipped)`)
  for (const s of skipped) console.log(`  skip ${s}`)
  for (const r of rules) {
    console.log(`\n  ${r.local_id}  ${r.kind}/${r.role}  frame ${r.frame}`)
    console.log(`     applies: ${r.applic.map(a => `${a.polarity === 'excludes' ? 'NOT ' : ''}${a.dimension}=${a.value}`).join('; ') || '-'}`)
    for (const e of r.effects) console.log(`     ${e.effect_type} ${e.topic ?? ''} ${e.comparator ?? ''} ${e.value ?? ''} ${e.unit ?? ''}`
      + `${e.measured_from ? ' @' + e.measured_from : ''}${e.condition_metric ? ` [if ${e.condition_metric} <= ${e.condition_hi}${e.condition_unit}]` : ''}${e.relative_to ? ' (' + e.relative_to + ')' : ''}`)
  }
  console.log(`\n  numbers in operative text: ${candidatesAll.length}; claimed ${candidatesAll.length - unclaimed.length}; unclaimed ${unclaimed.length}`)
  for (const u of unclaimed) console.log(`    UNCLAIMED ${u.section}: ${u.raw}`)
  console.log(`  findings: ${findings.length} (${findings.filter(f => f.gating).length} gating)`)
  for (const f of findings.filter(f => !f.gating)) console.log(`    ${f.kind} ${f.clause}: ${f.detail.slice(0, 140)}`)
  // the profile's spot checks: standards a section must yield
  let checksPass = true
  for (const ck of (profile.checks?.extract ?? []).filter(x => !ONLY || ONLY.has(x.section))) {
    const r = rules.find(x => x.local_id === ck.section)
    const got = ck.effects.filter(([t, v]) => r?.effects.some(e => e.topic === t && e.value === v && e.span))
    console.log(`  ${ck.section}: ${got.length}/${ck.effects.length} expected standards extracted with spans`)
    if (got.length !== ck.effects.length) checksPass = false
  }
  console.log(`  ${unclaimed.length === 0 && badSpans.length === 0 && checksPass ? 'PASS' : 'FAIL'}: recall gate + span gate + profile checks`)
}

main().catch((e) => { console.error(e); process.exit(1) })
