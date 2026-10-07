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
function usesIn(t: string, groups: UseGroup[] = []): string[] {
  const out = new Set<string>()
  for (const seg of t.split(/,| or | and /)) for (const u of (matchLandUses(seg) ?? []) as string[]) if (u !== 'dwelling') out.add(u)
  // a defined group of uses named in the text ("development that includes residential development")
  for (const g of groups) if (t.toLowerCase().includes(g.term)) for (const u of g.uses) out.add(u)
  return [...out]
}
/** "residential development means development for the following purposes— (a) attached dwellings, ...": a
 *  term the instrument defines as a list of uses, applying under the division / part / chapter it is defined in. */
interface UseGroup { term: string; uses: string[]; scope: string }
/** The first of the profile's defined-area terms (longest first) named in the text. */
const areaIn = (t: string, areas: string[]) => areas.find(a => t.toLowerCase().includes(a)) ?? null
/**
 * What a section's own words narrow its standards to: a use ("for the purposes of X", "for X—") or a defined
 * area other than the ones the whole clause already applies in.
 */
function qualifierOf(t: string, areas: string[], clauseAreas: string[], groups: UseGroup[] = []): { uses: string[]; area: string | null } {
  const m = t.match(/for the purposes of (.+?)(?:—|\bwith a\b|\bif\b|\bunless\b|$)/i) ?? t.match(/^for (?:a building containing )?(.+?)—/i)
  const area = areaIn(t, areas)
  return { uses: m ? usesIn(m[1]!, groups) : [], area: area && !clauseAreas.includes(area) ? area : null }
}
const UNIT: Record<string, string> = { sqm: 'sqm', metre: 'm', ratio: 'ratio', storeys: 'storeys', dwellings: 'dwellings' }

interface Applic { dimension: string; value: string; polarity: 'applies' | 'excludes'; span: string }
interface Effect {
  effect_type: string; topic: string | null; comparator: string | null; value: number | null; unit: string | null
  value_source: string | null; relative_to: string | null; measured_from: string | null; span: string
  condition_metric?: string | null; condition_lo?: number | null; condition_hi?: number | null; condition_unit?: string | null
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
  if (/\blandscaped area\b/.test(t)) return 'landscaped_area'
  if (/\bfloor areas?\b/.test(t)) return 'floor_area'
  if (/\barea of\b/.test(t)) return 'lot_size'
  if (/\bwide\b/.test(t)) return 'width'
  return null
}

/** A topic narrowed by its own words: "each deep soil zone has minimum dimensions of 3m" is not the zone's share. */
function refineTopic(topic: string | null, text: string): string | null {
  if (!topic) return null
  if (/\bminimum dimensions?\b/i.test(text)) return `${topic}_dimension`
  if (/\blocated at the rear\b/i.test(text)) return `${topic}_rear`
  return topic
}

/** The provision without a trailing "Example—" or "Note—", which are not part of it. */
const operativePart = (t: string) => t.replace(/\s(?:Example|Note)s?\s?—[\s\S]*$/, '')

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

  // defined groups of uses, scoped to the division / part / chapter that defines them
  const GROUPS: UseGroup[] = []
  for (const s of secs.filter(s => s.route === 'definition')) {
    const t = norm(s.raw_text)
    for (const m of t.matchAll(/([a-z][a-z -]*?) means development for the following purposes—\s*(.+?)(?=\.\s+[a-z][a-z ,()-]* means |$)/gi)) {
      const container = chain(s).find(x => ['division', 'part', 'chapter'].includes(x.level))
      const uses = usesIn(m[2]!)
      if (container && uses.length) GROUPS.push({ term: m[1]!.trim().toLowerCase(), uses, scope: container.local_id })
    }
  }
  const groupsFor = (s: any) => { const up = chain(s).map(x => x.local_id); return GROUPS.filter(g => up.includes(g.scope)) }
  // the uses a frame's own scope sentence names ("This Part applies to development for the purposes of ...",
  // "This division applies to development that includes residential development"); a rule naming no use of
  // its own inherits them from its frame
  const frameUses = new Map<string, { uses: string[]; span: string }>()
  for (const f of profile.frames) {
    const root = secs.find(s => s.local_id === f.section)
    if (!root) continue
    const texts = [root, ...secs.filter(s => chain(s).includes(root))].map(s => norm(s.raw_text))
      .filter(t => /^this (part|division|chapter) applies to development\b/i.test(t))
    const uses = [...new Set(texts.flatMap(t => usesIn(t.replace(/\bon land\b.*$/i, ''), groupsFor(root))))]
    if (uses.length) frameUses.set(f.id, { uses, span: texts[0]! })
  }
  const inherited = (frameId: string | null) => {
    for (let id = frameId; id; id = profile.frames.find(f => f.id === id)?.parent ?? null) if (frameUses.has(id)) return frameUses.get(id)!
    return null
  }

  const SKIP = profile.skip ?? {}
  // a term found case-insensitively, as the text spells it (spans must be literal substrings)
  const docText = secs.map(s => norm(s.raw_text)).join('\n')
  const literalOf = (a: string) => { const i = docText.toLowerCase().indexOf(a.toLowerCase()); return i < 0 ? a : docText.slice(i, i + a.length) }
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

    // a clause a frame is read from (s 72): the frame owns WHERE it applies - its zones and areas are alternatives
    // held on the frame - so only the uses are read here
    const frameOwned = profile.frames.some(f => f.section === c.local_id)
    const groups = groupsFor(c)
    for (const p of scopeSet) {
      const t = norm(p.raw_text)
      if (!t) continue
      if (!frameOwned) for (const z of zonesIn(t)) addApplic(base, { dimension: 'zone', value: z.code, polarity: 'applies', span: z.span })
      // "development to which this Part applies": the uses are the frame's, whatever else the sentence names
      // ("... including as part of a mixed use development")
      const ownUses = /development to which this (part|division|chapter) applies/i.test(t) ? inherited(base.frame)?.uses ?? [] : usesIn(t, groups)
      for (const u of ownUses) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: t.slice(0, 200) })
      // a zone named by group ("on land in a business zone") with no zone code: not resolved - say so
      const grp = t.match(/\bon land in an? ([a-z ]+?) zone\b/i)
      if (grp && !zonesIn(t).length) findings.push({ kind: 'unresolved_zone_group', gating: false, clause: p.local_id, value: null,
        detail: `"${grp[0]}" names no zone code and the instrument does not define it - the rule is not narrowed to it` })
      const area = frameOwned ? null : areaIn(t, AREAS)
      if (area) addApplic(base, { dimension: 'defined_area', value: area, polarity: 'applies', span: literalOf(area) })
      if (/involving subdivision/i.test(t)) addApplic(base, { dimension: 'dev_type', value: 'subdivision', polarity: 'applies', span: 'involving subdivision' })
      const date = t.match(/on or after (\d{1,2} \w+ \d{4})/i)
      if (date) addApplic(base, { dimension: 'temporal', value: `on or after ${date[1]}`, polarity: 'applies', span: date[0] })
    }
    // no use of its own: the frame's ("This division applies to development that includes residential development")
    if (!base.applic.some(a => a.dimension === 'land_use')) {
      const inh = inherited(base.frame)
      for (const u of inh?.uses ?? []) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: inh!.span })
    }
    // exclusions stated anywhere in the clause ("This section does not apply to strata subdivision.")
    for (const p of operative) {
      const t = norm(p.raw_text)
      const ex = t.match(/^this section does not apply to (.+?)\.?$/i)
      if (ex) addApplic(base, { dimension: 'dev_type', value: ex[1]!.replace(/\.$/, ''), polarity: 'excludes', span: t })
    }

    const out: RuleOut[] = [base]
    const effSections = operative.filter(p => !scopeSet.has(p))
    // a permission's scope is read too: its permission sentence for permits_use, and any number under it
    // ("at least 50 dwellings", s 72(3)(a)) as a condition of the grant
    for (const p of [...effSections, ...(kind === 'permission' ? [...scopeSet] : [])]) {
      const t = norm(p.raw_text)
      // an "Example—" or "Note—" is not part of the provision: its numbers are neither read nor counted
      const tOp = operativePart(t)
      const cands = (findNumberCandidates(tOp) ?? []) as any[]
      for (const cd of cands) candidatesAll.push({ section: p.local_id, clause: c.local_id, value: Number(cd.value), raw: cd.raw })

      // Standards narrowed by their own words - "(3) ... for the purposes of multi dwelling housing
      // (terraces)—", "(2) ... in a low and mid rise housing inner area—", "(b) for residential flat
      // buildings—" - go to their own rule: the nearest use and the nearest area up the chain to the clause,
      // keyed by the deepest section that narrowed it, inheriting the rest of the clause's applicability.
      let target = base
      if (cands.length && !scopeSet.has(p)) {
        const full = chain(p)
        const up = full.slice(0, full.indexOf(c))
        // every level may narrow it: s 74(2)(d)(i) is "in the Eastern Harbour City, ..." (d) AND "within an
        // accessible area" (i); "(ii) otherwise—" is the complement of its earlier siblings' areas
        let uses: string[] = [], keyAt: any = null
        const areas: string[] = [], notAreas: string[] = []
        const clauseAreas = base.applic.filter(a => a.dimension === 'defined_area').map(a => a.value)
        for (const x of up) {
          const xt = norm(x.raw_text)
          const q = qualifierOf(xt, AREAS, clauseAreas, groups)
          if (!uses.length && q.uses.length) { uses = q.uses; keyAt = keyAt ?? x }
          if (q.area && !areas.includes(q.area)) { areas.push(q.area); keyAt = keyAt ?? x }
          if (/^otherwise\b/i.test(xt)) {
            for (const sib of secs.filter(s => s.parent_id === x.parent_id && s.sort_order < x.sort_order)) {
              const a = areaIn(norm(sib.raw_text), AREAS)
              if (a && !notAreas.includes(a) && !clauseAreas.includes(a)) { notAreas.push(a); keyAt = keyAt ?? x }
            }
          }
        }
        if (keyAt) {
          const key = `${base.key}:${keyAt.local_id}`
          let r = out.find(x => x.key === key)
          if (!r) {
            r = { ...base, key, local_id: keyAt.local_id, section_id: keyAt.id, effects: [],
              applic: [...base.applic.filter(a => !(uses.length && a.dimension === 'land_use') && !(areas.length && a.dimension === 'defined_area')),
                       ...uses.map(u => ({ dimension: 'land_use', value: u, polarity: 'applies' as const, span: norm(keyAt.raw_text).slice(0, 200) })),
                       ...areas.map(a => ({ dimension: 'defined_area', value: a, polarity: 'applies' as const, span: literalOf(a) })),
                       ...notAreas.map(a => ({ dimension: 'defined_area', value: a, polarity: 'excludes' as const, span: literalOf(a) }))] }
            out.push(r)
          }
          target = r
        }
      }

      if (kind === 'permission' && scopeRoots.includes(p) && (p.signals ?? []).includes('permission')) {
        // "Development consent may be granted for development to which this Part applies if—": the uses are the
        // ones the clause's scope names
        const named = ((matchLandUses(t) ?? []) as string[]).filter(u => u !== 'dwelling')
        const uses = named.length ? named : /to which this (part|section|division) applies/i.test(t)
          ? base.applic.filter(a => a.dimension === 'land_use').map(a => a.value) : []
        for (const u of uses) {
          target.effects.push({ effect_type: 'permits_use', topic: u, comparator: null, value: null, unit: null,
            value_source: 'sepp_permission', relative_to: null, measured_from: null, span: t, claims: [] })
        }
        if (!cands.length) continue
      } else if (kind === 'permission' && scopeRoots.includes(p) && !cands.length) continue
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
      // ── readers for wording beyond "a minimum X of N" ─────────────────────────────────────────
      const parentT = operativePart(norm(byId.get(p.parent_id)?.raw_text))
      const claimedHere = new Set<number>()
      const nd = role === 'nondiscretionary_standard'
      const push = (e: Partial<Effect>, vals: number[]) => {
        target.effects.push({ effect_type: nd ? 'nondiscretionary_numeric' : 'numeric', topic: null, comparator: null, value: null,
          unit: null, value_source: null, relative_to: null, measured_from: null, span: t, ...e,
          claims: vals.map(v => ({ section: p.local_id, value: v })) } as Effect)
        for (const v of vals) claimedHere.add(v)
      }
      // a bonus on top of another control: "plus an additional floor space ratio of up to 30%"
      for (const m of tOp.matchAll(/plus an additional (floor space ratio|building height) of up to (\d+(?:\.\d+)?)%/gi)) {
        push({ effect_type: 'relative_numeric', topic: /floor/i.test(m[1]!) ? 'fsr' : 'height', comparator: 'lte', value: Number(m[2]),
          unit: 'percent', relative_to: `maximum permissible ${m[1]!.toLowerCase()} for the development on the land` }, [Number(m[2])])
      }
      if (/plus an additional building height that is the same percentage as the additional floor space ratio/i.test(tOp)) {
        push({ effect_type: 'relative_numeric', topic: 'height', comparator: 'lte', unit: 'percent',
          value_source: 'the same percentage as the additional floor space ratio',
          relative_to: 'maximum permissible building height for the development on the land' }, [])
      }
      // a tier of a bonus: "if the affordable housing component is at least 50%—0.5:1" | "between 20% and 50%—Y:1"
      const tier = tOp.match(/^if the (.+?) is (at least|between) (\d+(?:\.\d+)?)%(?: and (\d+(?:\.\d+)?)%)?—\s*(?:(\d+(?:\.\d+)?)|([A-Z])):1/i)
      if (tier && /additional (floor space ratio|building height)/i.test(parentT)) {
        const lo = Number(tier[3]), hi = tier[4] ? Number(tier[4]) : null
        push({ effect_type: 'relative_numeric', topic: /floor/i.test(parentT) ? 'fsr' : 'height', comparator: 'lte',
          value: tier[5] ? Number(tier[5]) : null, unit: 'ratio', value_source: tier[6] ? `${tier[6]}:1, by the section's formula` : null,
          relative_to: 'maximum permissible floor space ratio for the development on the land',
          condition_metric: tier[1]!.toLowerCase().replace(/\s+/g, '_'), condition_lo: lo, condition_hi: hi, condition_unit: 'percent' },
          [lo, ...(hi != null ? [hi] : []), ...(tier[5] ? [Number(tier[5])] : [])])
      }
      // a required share of the development: "The minimum affordable housing component, which must be at least 10%"
      const share = tOp.match(/\b(affordable housing component|tenanted component)\b[^.]*?\bat least (\d+(?:\.\d+)?)%/i)
      if (share && !tier) push({ topic: share[1]!.toLowerCase().replace(/\s+/g, '_'), comparator: 'gte', value: Number(share[2]), unit: 'percent' }, [Number(share[2])])
      // sunlight: "in at least 70% of the dwellings receive at least 3 hours of direct solar access between 9am and 3pm"
      const sun = tOp.match(/at least (\d+(?:\.\d+)?)% of the dwellings receive at least (\d+(?:\.\d+)?) hours? of (?:direct )?solar access(?: between (\d+)\s*am and (\d+)\s*pm)?/i)
      if (sun) push({ topic: 'solar_access', comparator: 'gte', value: Number(sun[2]), unit: 'hours',
        value_source: sun[3] ? `between ${sun[3]}am and ${sun[4]}pm at mid-winter` : null,
        condition_metric: 'share_of_dwellings', condition_lo: Number(sun[1]), condition_unit: 'percent' },
        [Number(sun[1]), Number(sun[2]), ...(sun[3] ? [Number(sun[3]), Number(sun[4])] : [])])
      // a period a condition must hold for: "for a period of at least 15 years"
      const period = tOp.match(/for a period of at least (\d+) years/i)
      if (period) push({ effect_type: 'condition_of_consent', topic: 'period_years', comparator: 'gte', value: Number(period[1]), unit: 'years' }, [Number(period[1])])
      // "for each dwelling containing (at least) 2 bedrooms—": the count is a condition of the value, not the value
      const bed = tOp.match(/containing (at least )?(\d+) bedrooms?/i)
      const bedCond = bed ? { condition_metric: 'bedrooms', condition_lo: Number(bed[2]), condition_hi: bed[1] ? null : Number(bed[2]), condition_unit: 'bedrooms' } : {}
      if (bed) claimedHere.add(Number(bed[2]))
      // "... 115m2 plus 12m2 for each bedroom in addition to 3 bedrooms": an increment per extra bedroom
      const perExtra = tOp.match(/plus (\d+(?:\.\d+)?)\s*m2 for each (\w+) in addition to (\d+) \w+/i)

      for (const cd of cands.filter(cd => !claimedHere.has(Number(cd.value)))) {
        // the number's topic and comparator from its own words, else from the sentence that introduces it
        // ("(b) a minimum landscaped area that is the lesser of— (i) 35m2 per dwelling")
        const own = topicFor(tOp, cd)
        const topic = refineTopic(own ?? topicFor(parentT, cd), tOp)
        const comparator = comparatorOf(tOp) ?? (own ? null : comparatorOf(parentT)) ?? (/\bmust be\b/i.test(t) ? 'gte' : null)
        if (!topic || !comparator) continue
        if (!/\bmust be\b/i.test(t) || comparatorOf(tOp) || comparatorOf(parentT)) { /* stated comparator */ } else {
          findings.push({ kind: 'comparator_inferred', gating: false, clause: p.local_id, value: String(cd.value),
            detail: `"${t}" states no minimum/maximum; read as a minimum (gte)` })
        }
        const datum = datumOf(t)
        const increment = perExtra && Number(perExtra[1]) === Number(cd.value)
        target.effects.push({
          effect_type: increment ? 'relative_numeric' : nd ? 'nondiscretionary_numeric' : 'numeric',
          topic, comparator, value: Number(cd.value),
          unit: /%/.test(cd.raw ?? '') || cd.unit === 'percent' ? (/site area/i.test(tOp) ? 'percent of site area' : 'percent')
            : /per dwelling/i.test(tOp) && (cd.unit === 'sqm') ? 'sqm per dwelling'
            : UNIT[cd.unit] ?? (topic === 'parking' ? 'spaces per dwelling' : cd.unit ?? null),
          value_source: /lesser of/i.test(parentT) ? 'the lesser of the listed amounts' : /greater of/i.test(parentT) ? 'the greater of the listed amounts'
            : parentT.match(/\bfor (dwellings (?:not )?used for [a-z ]+?)—/i)?.[1] ?? null,
          relative_to: increment ? `each ${perExtra![2]} in addition to ${perExtra![3]}` : null,
          measured_from: datum === 'front_boundary' ? 'front_boundary' : null, span: t,
          ...(bed ? bedCond : {}),
          claims: [{ section: p.local_id, value: Number(cd.value) },
                   ...(bed ? [{ section: p.local_id, value: Number(bed[2]) }] : []),
                   ...(increment ? [{ section: p.local_id, value: Number(perExtra![3]) }] : [])] })
      }
      // a count in a condition of consent that is no planning standard ("owned and controlled by 1 person",
      // "operated by 1 managing agent"): recorded as the condition, with its number
      if (role === 'conditional_standard') {
        for (const cd of cands.filter(cd => !topicFor(t, cd) && !target.effects.some(e => e.claims.some(cl => cl.section === p.local_id && cl.value === Number(cd.value))))) {
          target.effects.push({ effect_type: 'condition_of_consent', topic: t.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: 'eq',
            value: Number(cd.value), unit: null, value_source: 'clause_text', relative_to: null, measured_from: null, span: t,
            claims: [{ section: p.local_id, value: Number(cd.value) }] })
        }
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
                                        measured_from, source_span, condition_metric, condition_lo, condition_hi, condition_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [randomUUID(), row.id, e.effect_type, e.topic, e.comparator, e.value, e.unit, e.value_source, e.relative_to,
           e.measured_from, e.span, e.condition_metric ?? null, e.condition_lo ?? null, e.condition_hi ?? null, e.condition_unit ?? null])
      }
    }
    // keys this run's clauses produced last time and not now are retired, not deleted; with --clauses only
    // those clauses' keys ('<prefix><clause>' and '<prefix><clause>:<sub>') are in play
    // ... and only inside this run's chapter: each chapter is extracted on its own, so a chapter-wide run must
    // not retire another chapter's rules
    const prefix = `${profile.instrument}:pipeline:`
    const scopes = ONLY ? [...ONLY].flatMap(c => [`${prefix}${c}`, `${prefix}${c}:%`]) : [`${prefix}%`]
    const inChapter = secs.filter(s => chain(s).some(x => x.local_id === CHAPTER)).map(s => s.id as string)
    await client.query(
      `UPDATE nsw.rule SET publish_state = 'retired', valid_to = current_date
        WHERE document_id = $1 AND rule_key LIKE ANY($2) AND NOT (rule_key = ANY($3)) AND publish_state <> 'retired'
          AND section_id = ANY($4::uuid[])`,
      [doc.id, scopes, keys, inChapter])
    if (ONLY) {
      await client.query(
        `DELETE FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND detail LIKE $3
            AND EXISTS (SELECT 1 FROM unnest($2::text[]) c WHERE clause = c OR clause LIKE c || '-%')`, [doc.id, [...ONLY], `step5 ${CHAPTER}:%`])
    } else {
      await client.query(`DELETE FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND detail LIKE $2`,
        [doc.id, `step5 ${CHAPTER}:%`])
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
      + `${e.measured_from ? ' @' + e.measured_from : ''}${e.condition_metric ? (e.condition_lo != null ? ` [if ${e.condition_metric} ${e.condition_lo}${e.condition_hi != null ? '-' + e.condition_hi : '+'} ${e.condition_unit}]` : ` [if ${e.condition_metric} <= ${e.condition_hi}${e.condition_unit}]`) : ''}${e.relative_to ? ' (' + e.relative_to + ')' : ''}`)
  }
  console.log(`\n  numbers in operative text: ${candidatesAll.length}; claimed ${candidatesAll.length - unclaimed.length}; unclaimed ${unclaimed.length}`)
  for (const u of unclaimed) console.log(`    UNCLAIMED ${u.section}: ${u.raw}`)
  console.log(`  findings: ${findings.length} (${findings.filter(f => f.gating).length} gating)`)
  for (const f of findings.filter(f => !f.gating)) console.log(`    ${f.kind} ${f.clause}: ${f.detail.slice(0, 140)}`)
  // the profile's spot checks: standards a section must yield
  let checksPass = true
  const underChapter = (lid: string) => { const s = secs.find(x => x.local_id === lid); return !!s && chain(s).some(x => x.local_id === CHAPTER) }
  for (const ck of (profile.checks?.extract ?? []).filter(x => underChapter(x.section) && (!ONLY || ONLY.has(x.section)))) {
    const r = rules.find(x => x.local_id === ck.section)
    const got = ck.effects.filter(([t, v]) => r?.effects.some(e => e.topic === t && e.value === v && e.span))
    console.log(`  ${ck.section}: ${got.length}/${ck.effects.length} expected standards extracted with spans`)
    if (got.length !== ck.effects.length) checksPass = false
  }
  console.log(`  ${unclaimed.length === 0 && badSpans.length === 0 && checksPass ? 'PASS' : 'FAIL'}: recall gate + span gate + profile checks`)
}

main().catch((e) => { console.error(e); process.exit(1) })
