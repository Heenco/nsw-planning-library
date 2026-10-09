/**
 * RAG pilot, Phase 2 - relations: the law's own logic as data (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/02-relations.ts            # rebuild every relation, every topic, the unread list
 *   npx tsx scripts/rag/02-relations.ts --dry      # counts and samples, nothing written
 *
 * Readers, each a generic rule over every provision of both instruments - none names a clause:
 *   structure        part_of, next                                                   basis structure, verified
 *   references       "clause 4.1C(2)", "subclause (3)", "section 166", "Schedule 5", "Part 4", "Chapter 6, Part 2",
 *                    with a cross-instrument reference ("section 3.28 of the Act", "State Environmental Planning Policy
 *                    (X) 2021, section 2.15") resolved only when we hold that instrument     -> refers_to
 *   definitions      each term (02a-terms.py) to every provision in its scope that uses it; plan-wide terms of the LEP
 *                    reach the SEPP through Housing SEPP s 4(2) ("same meaning as in the standard instrument")
 *   overrides        despite / notwithstanding, subject to, does not apply, prevails, in addition to, applies (only)
 *                    to / if, savings ("made, but not finally determined, before ..."), measurement rules ("is not to be
 *                    included in calculating ...")
 *   statute          non-discretionary standards (EP&A Act s 4.15(3)) -> displaces_standard; cl 4.6 -> may_vary
 *                    (minus what 4.6(8) excludes); instrument-level inconsistency rules (Housing SEPP s 8, LEP 1.9)
 *   interpretive     specific over general: a use- or zone-specific standard over the map standard of the same topic
 *                    (status proposed - shown on /rag for confirmation, never assumed)
 *
 * The unread rule (learnt from s 169(2) "applies only if—", which an earlier reader skipped as boilerplate): every
 * trigger phrase a reader sees either becomes a relation or is written to rag.unread. Nothing is skipped in silence.
 */
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const TEXT_KINDS = new Set(['clause', 'subclause', 'paragraph', 'definition', 'objective', 'note', 'term', 'schedule', 'part', 'division', 'chapter', 'row'])
const USES = ['dual occupanc', 'secondary dwelling', 'dwelling house', 'semi-detached', 'multi dwelling housing', 'manor house', 'residential flat building',
  'shop top housing', 'terrace', 'attached dwelling', 'boarding house', 'group home', 'seniors housing', 'co-living']

interface P { id: string; document_id: string; parent_id: string | null; local_id: string; kind: string; heading: string | null; own_text: string; sort: number; ordinal: number | null }
interface Rel { kind: string; from_provision: string; to_provision?: string | null; to_document?: string | null; to_ref?: string | null; scope?: any; basis: string;
  authority_provision?: string | null; span?: string | null; reader: string; status?: string; confidence?: number }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n = 300) => s.length > n ? s.slice(0, n - 1) + '…' : s
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A provision's words without its conditions: "if the land has a street frontage greater than 12 metres—" says when, not what. */
const unconditioned = (t: string) => t.replace(/\b(if|where|unless|in the case of)\b[^—,;:]*[—,;:]/gi, ' ')

/** What a provision governs - read from its own words and its clause heading. */
function topicsOf(t: string, heading: string): string[] {
  const s = `${heading} ${t}`.toLowerCase(), out = new Set<string>()
  if (/floor space ratio|\bfsr\b/.test(s)) out.add('fsr')
  if (/height of buildings?|building height|maximum height|\bheight\b[^.]{0,30}\bm(etres)?\b/.test(s)) out.add('height')
  if (/lot size|lot area|area of (the|each|any) (resulting )?lot|site area|minimum subdivision|size of (the|each|any) lot|\blots?\b[^.;]{0,40}\barea of (at least|not less than)/.test(s)) out.add('lot_size')
  if (/lot width|width of the lot|wide at the front building line|frontage/.test(s)) out.add('lot_width')
  if (/subdivi/.test(s)) out.add('subdivision')
  if (/permitted with(out)? consent|is prohibited|may be carried out with consent|must not be granted (to|for) development for the purposes/.test(s)) out.add('permissibility')
  if (/parking|car space/.test(s)) out.add('parking')
  if (/landscap|deep soil|tree canopy/.test(s)) out.add('landscaping')
  if (/setback/.test(s)) out.add('setback')
  if (/gross floor area|\bfloor area\b/.test(s) && !out.has('fsr')) out.add('floor_area')
  if (/dwelling must be situated on each lot|no more than 1 dwelling|1 dwelling (must|will) be/.test(s)) out.add('dwellings_per_lot')
  if (/heritage/.test(s)) out.add('heritage')
  if (/flood/.test(s)) out.add('flood')
  if (/bush ?fire/.test(s)) out.add('bushfire')
  return [...out]
}
const STANDARD_TOPICS = new Set(['fsr', 'height', 'lot_size', 'lot_width', 'floor_area', 'landscaping', 'setback', 'parking', 'dwellings_per_lot'])
const statesFigure = (t: string) => /\d[\d,.]*\s*(m2|m²|square metres|metres|m\b|:1|%|hectares|ha\b|storeys?|spaces?|dwellings?)/i.test(t)
  || /shown (for the land )?on the [A-Z][\w ]* Map/.test(t)
const usesIn = (t: string) => USES.filter(u => t.toLowerCase().includes(u))

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const insts = (await q(`SELECT document_id, title, kind FROM rag.instrument`)).rows
  const docOf = (re: RegExp) => insts.find(i => re.test(i.title))!.document_id as string
  const RANDWICK = docOf(/Randwick/), HOUSING = docOf(/Housing/)
  const provs: P[] = (await q(`SELECT id, document_id, parent_id, local_id, kind, heading, coalesce(own_text, '') own_text, sort, ordinal FROM rag.provision`)).rows
  const byId = new Map(provs.map(p => [p.id, p]))
  const byLocal = new Map(provs.map(p => [`${p.document_id}|${p.local_id}`, p]))
  const kids = new Map<string, P[]>()
  for (const p of provs) if (p.parent_id) { if (!kids.has(p.parent_id)) kids.set(p.parent_id, []); kids.get(p.parent_id)!.push(p) }
  for (const v of kids.values()) v.sort((a, b) => a.sort - b.sort || (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.local_id.localeCompare(b.local_id))
  const up = (p: P, pred: (x: P) => boolean): P | null => { for (let x: P | undefined = p; x; x = x.parent_id ? byId.get(x.parent_id) : undefined) if (pred(x)) return x; return null }
  const clauseOf = (p: P) => up(p, x => x.kind === 'clause' || (x.kind === 'definition' && /^sec\.[^-]+$/.test(x.local_id))) ?? up(p, x => /^(sec|sch)\.[^-]+(-sec\.[^-]+)?$/.test(x.local_id))
  const subclauseOf = (p: P) => up(p, x => /-ssec\.[^-]+$/.test(x.local_id))
  const unitOf = (word: string, p: P): P | null => {
    const w = word.toLowerCase()
    if (w === 'clause' || w === 'section') return clauseOf(p)
    if (w === 'subclause') return subclauseOf(p)
    if (w === 'part') return up(p, x => x.kind === 'part')
    if (w === 'division') return up(p, x => x.kind === 'division')
    if (w === 'chapter') return up(p, x => x.kind === 'chapter')
    if (w === 'schedule') return up(p, x => x.kind === 'schedule')
    return null
  }
  const local = (doc: string, id: string) => byLocal.get(`${doc}|${id}`) ?? null
  const textOf = (p: P) => norm(p.own_text)
  const subtreeText = (p: P, limit = 12): string[] => (kids.get(p.id) ?? []).filter(k => k.kind !== 'term').slice(0, limit).map(k => clip(textOf(k), 200))

  const rels: Rel[] = []
  const unread: { provision_id: string; reader: string; trigger: string; span: string; note?: string }[] = []
  const add = (r: Rel) => rels.push({ status: 'proposed', ...r })

  // ── references ────────────────────────────────────────────────────────────────────────────────
  /** "4.1C(2)(a)" -> sec.4.1C-ssec.2-para1.a (falls back to the deepest one held) */
  const resolveNumber = (doc: string, tok: string, prefix = 'sec.'): P | null => {
    const m = tok.match(/^([\dA-Z.]+?)((?:\([\w]+\))*)$/i); if (!m) return null
    const base = `${prefix}${m[1]}`
    const parts = [...m[2]!.matchAll(/\((\w+)\)/g)].map(x => x[1]!)
    const ids = [base]
    if (parts[0]) ids.push(`${base}-ssec.${parts[0]}`)
    if (parts[1]) ids.push(`${ids[1]}-para1.${parts[1]}`)
    if (parts[2]) ids.push(`${ids[2]}-para2.${parts[2]}`)
    for (const id of ids.reverse()) { const hit = local(doc, id); if (hit) return hit }
    return null
  }
  const EXTERNAL = /(of|under) the (Act|Regulation|Environmental Planning and Assessment (Act|Regulation)[^,;.]*)|(the Act|the Regulation),?\s*$/i
  interface Ref { to?: P | null; doc?: string | null; ref: string }
  /** every reference a phrase makes, resolved where we hold the target */
  const refsIn = (t: string, p: P): Ref[] => {
    const out: Ref[] = []
    const NUM = String.raw`\d+[A-Z]*(?:\.\d+[A-Z]*)*(?:\(\w+\))*`
    for (const m of t.matchAll(new RegExp(String.raw`\b(clauses?|sections?)\s+(${NUM}(?:(?:,\s*|\s+and\s+|\s+or\s+|\s+to\s+)${NUM})*)`, 'gi'))) {
      const before = t.slice(Math.max(0, m.index! - 120), m.index!), after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 60)
      const inst = (before + ' ' + after).match(/State Environmental Planning Policy \(([^)]+)\) (\d{4})|([A-Z][\w ]+ Local Environmental Plan \d{4})/)
      const ext = EXTERNAL.test(after.slice(0, 40)) || /(the Act|the Regulation),?\s*$/i.test(before.slice(-25))
      for (const tok of m[2]!.split(/,\s*|\s+and\s+|\s+or\s+|\s+to\s+/)) {
        if (!tok) continue
        if (ext) { out.push({ ref: `EP&A ${/Regulation/i.test(after + before.slice(-25)) ? 'Regulation' : 'Act'} s ${tok}` }); continue }
        if (inst) {
          const name = inst[0]
          const held = insts.find(i => i.title.startsWith(name.replace(/,$/, '')))
          if (held && held.document_id !== p.document_id) { out.push({ to: resolveNumber(held.document_id, tok), doc: held.document_id, ref: `${name}, ${m[1]} ${tok}` }); continue }
          if (!held) { out.push({ ref: `${name}, ${m[1]} ${tok}` }); continue }
        }
        // a schedule's own sections: "section 4" inside Sch 1 is sch.1-sec.4
        const sch = up(p, x => x.kind === 'schedule')
        const to = (sch && /^section/i.test(m[1]!) ? resolveNumber(p.document_id, tok, `${sch.local_id}-sec.`) : null) ?? resolveNumber(p.document_id, tok)
        out.push({ to, doc: p.document_id, ref: `${m[1]} ${tok}` })
      }
    }
    for (const m of t.matchAll(/\bsub(?:clauses?|sections?)\s+((?:\(\w+\))+(?:(?:,\s*|\s+and\s+|\s+or\s+)(?:\(\w+\))+)*)/gi)) {
      const cl = clauseOf(p); if (!cl) continue
      for (const tok of m[1]!.split(/,\s*|\s+and\s+|\s+or\s+/)) {
        const parts = [...tok.matchAll(/\((\w+)\)/g)].map(x => x[1]!)
        let id = `${cl.local_id}-ssec.${parts[0]}`; if (parts[1]) id += `-para1.${parts[1]}`
        out.push({ to: local(p.document_id, id) ?? local(p.document_id, `${cl.local_id}-ssec.${parts[0]}`), doc: p.document_id, ref: `${/^subs/i.test(m[0]) ? 'subsection' : 'subclause'} ${tok}` })
      }
    }
    for (const m of t.matchAll(/\bSchedule\s+(\d+[A-Z]?)\b/g)) out.push({ to: local(p.document_id, `sch.${m[1]}`), doc: p.document_id, ref: `Schedule ${m[1]}` })
    for (const m of t.matchAll(/\bChapter\s+(\d+[A-Z]?)(?:,\s*Part\s+(\d+[A-Z]?))?/g)) {
      if (/State Environmental Planning Policy \([^)]+\) \d{4},?\s*$/.test(t.slice(Math.max(0, m.index! - 80), m.index!)) && p.document_id !== HOUSING) { out.push({ ref: m[0] }); continue }
      const id = m[2] ? `ch.${m[1]}-pt.${m[2]}` : `ch.${m[1]}`
      const doc = p.document_id === HOUSING || /Housing\)/.test(t) ? HOUSING : p.document_id
      out.push({ to: local(doc, id), doc, ref: m[0] })
    }
    if (p.document_id === RANDWICK) for (const m of t.matchAll(/\bPart\s+(\d+[A-Z]?)\b(?!\s+of\s+the)/g)) out.push({ to: local(RANDWICK, `pt.${m[1]}`), doc: RANDWICK, ref: `Part ${m[1]}` })
    return out
  }

  // ── structure ─────────────────────────────────────────────────────────────────────────────────
  for (const p of provs) {
    if (p.parent_id) add({ kind: 'part_of', from_provision: p.id, to_provision: p.parent_id, basis: 'structure', reader: 'structure', status: 'verified' })
    const sibs = kids.get(p.id) ?? []
    for (let i = 0; i + 1 < sibs.length; i++) if (sibs[i]!.kind !== 'cell' && sibs[i]!.kind !== 'term')
      add({ kind: 'next', from_provision: sibs[i]!.id, to_provision: sibs[i + 1]!.id, basis: 'structure', reader: 'structure', status: 'verified' })
  }

  // ── references (every text provision) ─────────────────────────────────────────────────────────
  for (const p of provs) {
    if (!TEXT_KINDS.has(p.kind)) continue
    const t = textOf(p); if (!t) continue
    const seen = new Set<string>()
    for (const r of refsIn(t, p)) {
      const key = (r.to?.id ?? '') + '|' + r.ref; if (seen.has(key) || r.to?.id === p.id) continue; seen.add(key)
      add({ kind: 'refers_to', from_provision: p.id, to_provision: r.to?.id ?? null, to_document: r.doc ?? null, to_ref: r.to ? null : r.ref,
        basis: 'text', reader: 'references', span: r.ref, status: r.to ? 'verified' : 'proposed' })
    }
  }

  // ── definitions ───────────────────────────────────────────────────────────────────────────────
  const UBIQUITOUS = 150
  const termStats = { terms: 0, edges: 0, ubiquitous: [] as string[], unused: 0 }
  const terms = provs.filter(p => p.kind === 'term')
  const textProvs = provs.filter(p => TEXT_KINDS.has(p.kind) && p.kind !== 'term' && textOf(p))
  const housingDefines = new Set(terms.filter(t => t.document_id === HOUSING).map(t => (t.heading ?? '').toLowerCase()))
  const s4_2 = local(HOUSING, 'sec.4-ssec.2')
  for (const t of terms) {
    termStats.terms++
    const term = norm(t.heading); if (term.length < 3) continue
    const parent = t.parent_id ? byId.get(t.parent_id)! : null
    const planwide = !parent || ['dictionary'].includes(parent.kind) || ['dict', 'sch.10'].includes(parent.local_id)
    const scopeRoot = planwide ? null : (clauseOf(parent!) ?? parent)
    const inScope = (x: P) => x.document_id === t.document_id && (!scopeRoot || x.local_id === scopeRoot.local_id || x.local_id.startsWith(scopeRoot.local_id + '-'))
    const plural = term.endsWith('y') ? term.slice(0, -1) + 'ies' : term + 's'
    const re = new RegExp(String.raw`(^|[^\w])(${esc(term)}|${esc(plural)})([^\w]|$)`, /^[a-z]/.test(term) ? 'i' : '')
    const hits = textProvs.filter(x => inScope(x) && re.test(textOf(x)))
    // the LEP's plan-wide terms reach the SEPP through Housing SEPP s 4(2), where the SEPP does not define the word itself
    const viaS4 = planwide && t.document_id === RANDWICK && !housingDefines.has(term.toLowerCase())
      ? textProvs.filter(x => x.document_id === HOUSING && !/^sch\.(1|2)(-|$)/.test(x.local_id) && re.test(textOf(x))) : []
    if (!hits.length && !viaS4.length) { termStats.unused++; continue }
    if (hits.length + viaS4.length > UBIQUITOUS) { termStats.ubiquitous.push(`${term} (${hits.length + viaS4.length})`); continue }
    for (const x of hits) { add({ kind: 'defines', from_provision: t.id, to_provision: x.id, basis: 'text', reader: 'definitions', span: term, status: 'verified' }); termStats.edges++ }
    for (const x of viaS4) { add({ kind: 'defines', from_provision: t.id, to_provision: x.id, basis: 'statute', authority_provision: s4_2?.id ?? null, reader: 'definitions',
      span: term, scope: { via: 'Housing SEPP s 4(2): same meaning as in the standard instrument', proxy: 'Randwick LEP 2012 Dictionary' } }); termStats.edges++ }
  }

  // ── overrides ─────────────────────────────────────────────────────────────────────────────────
  const INSTRUMENT_WIDE = /\b(any other provision of this (Plan|Policy)|this (Plan|Policy))\b/i
  const OTHER_EPI = /\b(the provisions of )?(another|any other) environmental planning instrument\b/i
  const STRUCTURAL = /^(clauses?|sections?|subclauses?|subsections?|paragraphs?|Parts?|Divisions?|Chapters?|Schedules?|this|the provisions|any other|another|State Environmental Planning Policy|the Act)\b/i
  for (const p of provs) {
    if (!TEXT_KINDS.has(p.kind) || p.kind === 'row') continue
    const t = textOf(p); if (!t) continue
    const fail = (trigger: string, span: string, note?: string) => unread.push({ provision_id: p.id, reader: 'overrides', trigger, span: clip(span, 300), note })

    // despite / notwithstanding (and "This clause applies despite ...")
    for (const m of t.matchAll(/\b(despite|notwithstanding)\s+(.{1,220}?)(?=,\s|—|;|\.\s|\.$|$)/gi)) {
      const phrase = m[2]!
      const whole = /^This (clause|section|subclause|Part|Division|Chapter) applies (despite|notwithstanding)/i.exec(t)
      const from = whole ? (unitOf(whole[1]!, p) ?? p) : p
      const refs = refsIn(phrase, p)
      if (OTHER_EPI.test(phrase)) add({ kind: 'despite', from_provision: from.id, to_document: null, to_ref: 'another environmental planning instrument', basis: 'text', reader: 'overrides',
        span: m[0], scope: { targets: 'other environmental planning instruments' }, authority_provision: p.id })
      else if (INSTRUMENT_WIDE.test(phrase) && !refs.length) add({ kind: 'despite', from_provision: from.id, to_document: p.document_id, to_ref: norm(phrase), basis: 'text', reader: 'overrides',
        span: m[0], scope: { targets: 'any other provision of this instrument' }, authority_provision: p.id })
      else if (refs.length) for (const r of refs) add({ kind: 'despite', from_provision: from.id, to_provision: r.to?.id ?? null, to_document: r.doc ?? null, to_ref: r.to ? null : r.ref,
        basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      else fail(m[1]!.toLowerCase(), m[0], 'no provision or instrument named')
    }

    // subject to - only when it names law ("subject to a condition" is not an override)
    for (const m of t.matchAll(/\bsubject to\s+(.{1,200}?)(?=,\s|—|;|\.\s|\.$|$)/gi)) {
      const phrase = m[1]!
      if (!STRUCTURAL.test(phrase) && !/environmental planning|Policy|Plan\b/.test(phrase)) continue
      const refs = refsIn(phrase, p)
      if (/State environmental planning policy that prevails/i.test(phrase)) add({ kind: 'subject_to', from_provision: p.id, to_document: null, to_ref: 'any SEPP that prevails (EP&A Act s 3.28)',
        basis: 'statute', reader: 'overrides', span: m[0], scope: { targets: 'SEPPs', by: 'EP&A Act s 3.28' }, authority_provision: p.id })
      else if (refs.length) for (const r of refs) add({ kind: 'subject_to', from_provision: p.id, to_provision: r.to?.id ?? null, to_document: r.doc ?? null, to_ref: r.to ? null : r.ref,
        basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      else if (/^the Act\b/i.test(phrase)) add({ kind: 'subject_to', from_provision: p.id, to_document: null, to_ref: 'EP&A Act', basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      else if (/^(the other provisions of|any other provision of) this (Plan|Policy)/i.test(phrase)) add({ kind: 'subject_to', from_provision: p.id, to_document: p.document_id,
        to_ref: 'the other provisions of this instrument', basis: 'text', reader: 'overrides', span: m[0], scope: { targets: 'any other provision of this instrument' }, authority_provision: p.id })
      else if (/^this (clause|section|subclause|Part|Division|Chapter)/i.test(phrase)) {
        const u = unitOf(phrase.split(/\s+/)[1]!, p)
        if (u && u.id !== p.id) add({ kind: 'subject_to', from_provision: p.id, to_provision: u.id, basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      } else fail('subject to', m[0], 'names law but no provision resolved')
    }

    // does not apply
    const DNA = /^(?:(?:However,\s+)?(This|The) (clause|section|subclause|subsection|Part|Division|Chapter|Plan|Policy)|((?:Clause|Section|Subclause|Subsection|Part|Division|Chapter|Schedule)s?\s+[\w.()]+(?:(?:,\s*|\s+and\s+|\s+or\s+)[\w.()]+)*))\s+(?:does|do) not apply\s*(.*)$/i
    const dna = t.match(DNA) ?? t.split(/(?<=\.)\s+(?=[A-Z])/).slice(1).map(x => x.match(DNA)).find(Boolean) ?? null
    if (dna) {
      const when = norm(dna[4] ?? '')
      if (dna[2]) {
        const u = /Plan|Policy/i.test(dna[2]) ? null : unitOf(dna[2] === 'subsection' ? 'subclause' : dna[2], p)
        add({ kind: 'disapplies', from_provision: p.id, to_provision: u?.id ?? null, to_document: u ? null : p.document_id, to_ref: u ? null : `this ${dna[2]}`,
          basis: 'text', reader: 'overrides', span: clip(t, 300), scope: { when: clip(when, 300), conditions: subtreeText(p) }, authority_provision: p.id })
      } else {
        const refs = refsIn(dna[3]!, p)
        if (refs.length) for (const r of refs) add({ kind: 'disapplies', from_provision: p.id, to_provision: r.to?.id ?? null, to_document: r.doc ?? null, to_ref: r.to ? null : r.ref,
          basis: 'text', reader: 'overrides', span: clip(t, 300), scope: { when: clip(when, 300), conditions: subtreeText(p) }, authority_provision: p.id })
        else fail('does not apply', t)
      }
    } else if (/\b(does|do) not apply\b/i.test(t)) {
      const savesForm = /\bapplication[^.]{0,80}?\b(made|lodged)\b[^.]{0,60}?\bbefore\b/i.test(t)
      // standard instrument cl 1.9A: covenants and similar instruments are suspended to the extent needed
      if (/\b(agreement|covenant)s?,? (a |an )?(covenant|or)[^.]{0,40}similar instrument/i.test(t)) {
        add({ kind: 'disapplies', from_provision: p.id, to_document: null, to_ref: 'agreements, covenants and similar instruments that restrict the development', basis: 'text', reader: 'overrides',
          span: clip(t, 300), scope: { extent: 'to the extent necessary to serve that purpose', exceptions: subtreeText(p) }, authority_provision: p.id })
      } else if (savesForm) { /* an amendment's savings provision - read by the savings reader */ } else
      // "The following SEPPs (or provisions) do not apply to the land to which this Plan applies—" and its list
      if (/environmental planning polic(y|ies)[^.]*do not apply/i.test(t) && !(kids.get(p.id) ?? []).length && /—$/.test(t)) fail('does not apply', t, 'the list this sentence introduces is empty in the source (a dangling stem)')
      else if (/environmental planning polic(y|ies)[^.]*do not apply/i.test(t) && (kids.get(p.id) ?? []).length) {
        for (const k of kids.get(p.id)!) add({ kind: 'disapplies', from_provision: p.id, to_document: null, to_ref: clip(textOf(k), 200), basis: 'text', reader: 'overrides',
          span: clip(t, 200), scope: { land: 'land to which this Plan applies' }, authority_provision: p.id })
      } else {
        const refs = refsIn(t, p).filter(r => r.to && r.to.id !== p.id)
        const lead = t.match(/^(.{0,160}?)\b(does|do) not apply\b/i)
        if (refs.length && lead && refsIn(lead[1]!, p).length) for (const r of refsIn(lead[1]!, p)) add({ kind: 'disapplies', from_provision: p.id, to_provision: r.to?.id ?? null,
          to_document: r.doc ?? null, to_ref: r.to ? null : r.ref, basis: 'text', reader: 'overrides', span: clip(t, 300), scope: { conditions: subtreeText(p) }, authority_provision: p.id })
        else if (/^(This|The) [\w ]+? (does|do) not apply/i.test(t) || /does not apply to/i.test(t.slice(0, 200))) {
          const c = clauseOf(p)
          add({ kind: 'disapplies', from_provision: p.id, to_provision: c && c.id !== p.id ? c.id : null, to_document: p.document_id, to_ref: c && c.id !== p.id ? null : 'the provision itself',
            basis: 'text', reader: 'overrides', span: clip(t, 300), scope: { when: clip(t, 300), conditions: subtreeText(p) }, authority_provision: p.id, confidence: 0.6 })
        } else fail('does not apply', t)
      }
    }

    // prevails
    if (/\bprevails?\b/i.test(t)) {
      const ext = t.match(/this (Policy|Plan|clause|section) prevails to the extent of (the|any)? ?inconsistency/i)
      // a phrase ends at a sentence end, not at the point in "section 3.28"
      const over = /that prevails over this (Plan|Policy)/i.test(t) ? null : t.match(/^(.{3,160}?)\s+prevails? over\s+(.{3,160}?)(?:,? to the extent|\.(?=\s|$)|$)/i)
      if (ext && OTHER_EPI.test(t)) add({ kind: 'inconsistency_rule', from_provision: p.id, to_document: null, to_ref: 'another environmental planning instrument', basis: 'statute',
        reader: 'overrides', span: clip(t, 300), scope: { winner: `this ${ext[1]}`, loser: 'another environmental planning instrument', extent: 'inconsistency', unless: /Unless otherwise specified/i.test(t) ? 'otherwise specified in this Policy' : null }, authority_provision: p.id })
      else if (ext) add({ kind: 'prevails_over', from_provision: clauseOf(p)?.id ?? p.id, to_document: p.document_id, to_ref: 'other provisions of this instrument', basis: 'text', reader: 'overrides',
        span: clip(t, 300), scope: { extent: 'inconsistency' }, authority_provision: p.id })
      else if (over) {
        const winRefs = refsIn(over[1]!, p), loseRefs = refsIn(over[2]!, p)
        add({ kind: 'prevails_over', from_provision: winRefs[0]?.to?.id ?? p.id, to_provision: loseRefs[0]?.to?.id ?? null, to_document: loseRefs[0]?.doc ?? null,
          to_ref: loseRefs[0]?.to ? null : norm(over[2]!), basis: 'text', reader: 'overrides', span: clip(t, 300),
          scope: { winner: norm(over[1]!), loser: norm(over[2]!), extent: /extent/i.test(t) ? 'inconsistency' : null }, authority_provision: p.id })
      } else if (/that prevails over this (Plan|Policy)/i.test(t)) { /* LEP 1.9(1) - read by the subject-to reader */ }
      else fail('prevails', t)
    }

    // in addition to
    for (const m of t.matchAll(/\bin addition to(?:,? and (?:does not|do not) (?:limit|derogate from),?)?\s+(.{1,160}?)(?=,\s|;|\.\s|\.$|$)/gi)) {
      const phrase = m[1]!
      if (!STRUCTURAL.test(phrase)) continue
      const refs = refsIn(phrase, p)
      if (refs.length) for (const r of refs) add({ kind: 'in_addition_to', from_provision: p.id, to_provision: r.to?.id ?? null, to_document: r.doc ?? null, to_ref: r.to ? null : r.ref,
        basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      else if (/^any other provision of this/i.test(phrase)) add({ kind: 'in_addition_to', from_provision: p.id, to_document: p.document_id, to_ref: norm(phrase), basis: 'text', reader: 'overrides', span: m[0], authority_provision: p.id })
      else fail('in addition to', m[0])
    }

    // applies (only) to / if - the frames: where a clause, Part or Chapter reaches
    const ap = t.match(/^This (clause|section|subclause|Part|Division|Chapter|Schedule|Plan|Policy) (?:also )?applies (only )?(to|if|where|in relation to|despite)\b\s*(.*)$/i)
    if (ap && ap[3]!.toLowerCase() !== 'despite') {
      const unit = /Plan|Policy/i.test(ap[1]!) ? null : unitOf(ap[1]!, p)
      add({ kind: 'applies_only_if', from_provision: unit?.id ?? p.id, to_provision: p.id, basis: 'text', reader: 'overrides', span: clip(t, 300), authority_provision: p.id,
        scope: { unit: ap[1], only: !!ap[2], form: ap[3], phrase: clip(norm(ap[4]), 300), exceptions: /\bother than\b|\bexcept\b/i.test(t), conditions: subtreeText(p, 30) },
        status: unit || /Plan|Policy/i.test(ap[1]!) ? 'verified' : 'proposed' })
    } else if (/^Applies (only )?(to|if|where|in relation to)\b/i.test(t)) {
      const unit = /-ssec\.[^-]+$/.test(p.local_id) && p.parent_id ? byId.get(p.parent_id)! : p
      add({ kind: 'applies_only_if', from_provision: unit.id, to_provision: p.id, basis: 'text', reader: 'overrides', span: clip(t, 300), authority_provision: p.id,
        scope: { unit: unit.kind, only: /only/i.test(t.slice(0, 14)), form: t.match(/^Applies (?:only )?(\w+)/i)![1], phrase: clip(norm(t.replace(/^Applies (only )?(to|if|where|in relation to)\s*/i, '')), 300), exceptions: /\bother than\b|\bexcept\b/i.test(t), conditions: subtreeText(p, 30) },
        status: 'verified' })
    } else if (/\bapplies only\b/i.test(t)) fail('applies only', t, 'not at the head of the sentence')

    // savings and transitional: applications made before a commencement or a date
    const sv = t.match(/\b(?:development )?application[^.]{0,80}?\b(made|lodged)\b[^.]{0,60}?\bbefore\s+(the commencement[^,.;]*|\d{1,2} \w+ \d{4})/i)
    if (sv) {
      const refs = refsIn(t, p).filter(r => r.to)
      add({ kind: 'saves', from_provision: p.id, to_provision: refs[0]?.to?.id ?? null, to_document: refs[0]?.doc ?? p.document_id, to_ref: refs[0]?.to ? null : 'the instrument (or the amendment named)',
        basis: 'text', reader: 'overrides', span: clip(t, 300), scope: { cutoff: sv[2], applications: 'made but not finally determined before the cut-off' }, authority_provision: p.id })
    }

    // measurement rules
    const mm = t.match(/\b(is|are) not to be (included|counted|taken into account) in (calculating|determining|the calculation of)|\bmust not be included in (calculating|the calculation)|\bis to be (excluded|disregarded)|\bfor the purposes of (calculating|determining)\b|\bis taken to (be|include)\b|\bis to be treated as\b/i)
    if (mm && !sv) {
      const refs = refsIn(t, p).filter(r => r.to && r.to.id !== p.id)
      const target = refs[0]?.to ?? clauseOf(p)
      add({ kind: 'modifies_measurement', from_provision: p.id, to_provision: target && target.id !== p.id ? target.id : null, to_document: p.document_id,
        to_ref: target && target.id !== p.id ? null : 'the clause it sits in', basis: 'text', reader: 'overrides', span: clip(t, 300),
        scope: { rule: clip(t, 300), topics: topicsOf(t, '') }, authority_provision: p.id, confidence: 0.7 })
    }
  }

  // ── topics ────────────────────────────────────────────────────────────────────────────────────
  const topics = new Map<string, string[]>()
  for (const p of provs) {
    if (p.kind === 'cell') continue
    const cl = clauseOf(p)
    topics.set(p.id, topicsOf(textOf(p), `${cl?.heading ?? ''} ${p.heading ?? ''}`))
  }
  const isStandard = (p: P) => statesFigure(textOf(p)) && (topics.get(p.id) ?? []).some(t => STANDARD_TOPICS.has(t))

  // the LEP's development standards: the rag engine's own claims (rag.claim kind standard, scripts/rag/02c-claims.ts) -
  // read from the text, no pilot table. 02c reads the frames this stage writes, so the order is 02 -> 02c -> 02 again;
  // on a first run (no claims yet) the standard-based edges are skipped and the second pass writes them.
  const pilotStd = (await q(`
    SELECT p.local_id, c.topic, c.comparator, c.value::float8 AS value, CASE WHEN c.value_source LIKE 'map:%' THEN 'map' ELSE c.unit END AS unit, c.uses, c.zones, null::uuid AS run_id
      FROM rag.claim c JOIN rag.provision p ON p.id = c.provision_id
     WHERE c.kind = 'standard' AND p.document_id = $1`, [RANDWICK]).catch(() => ({ rows: [] as any[] }))).rows
  const pilotLive = false
  if (!pilotStd.length) console.log('no rag.claim standards yet - run 02c-claims.ts, then this stage again, for displaces_standard / may_vary / more_specific_than')
  const PILOT_TOPIC: Record<string, string> = {}
  // joined on the legislation anchor, not the node id: the pilot re-mints node ids on every rebuild
  const inCode = (p: P) => !!up(p, x => /exempt development|complying development/i.test(x.heading ?? ''))
  const isSubdivision = (p: P) => (topicsOf('', `${clauseOf(p)?.heading ?? ''}`)).includes('subdivision') || /\bsubdivi/i.test(textOf(clauseOf(p) ?? p).slice(0, 200))
  const lepStd = pilotStd.map(r => ({ ...r, prov: local(RANDWICK, r.local_id) ?? undefined, topic: PILOT_TOPIC[r.topic] ?? r.topic }))
    .filter(r => r.prov && STANDARD_TOPICS.has(r.topic) && !inCode(r.prov)
      && [...topicsOf(unconditioned(textOf(r.prov)), ''), ...topicsOf('', clauseOf(r.prov)?.heading ?? '')].includes(r.topic))
  const pilotRun = [...new Set(pilotStd.map(r => r.run_id))]

  // ── statute: non-discretionary standards (EP&A Act s 4.15(3)) ─────────────────────────────────
  const ndStems = provs.filter(p => p.document_id === HOUSING && /non-discretionary development standards/i.test(textOf(p)) && (kids.get(p.id) ?? []).length)
  for (const stem of ndStems) {
    const cl = clauseOf(stem)
    const sectionText = [cl?.heading ?? '', ...provs.filter(x => cl && x.local_id.startsWith(cl.local_id + '-')).map(textOf)].join(' ')
    const uses = usesIn(sectionText)
    for (const leaf of kids.get(stem.id)!) {
      const lt = topics.get(leaf.id) ?? []
      const std = lt.filter(t => STANDARD_TOPICS.has(t)); if (!std.length || !statesFigure(textOf(leaf))) continue
      const stemSub = isSubdivision(stem)
      const targets = lepStd.filter(x => std.includes(x.topic) && isSubdivision(x.prov!) === stemSub && (() => {
        const u = usesIn(((x.uses as string[]) ?? []).join(' ') + ' ' + (x.uses.length ? '' : textOf(x.prov!)))
        return !u.length || u.some(v => uses.includes(v))
      })())
      for (const x of targets) add({ kind: 'displaces_standard', from_provision: leaf.id, to_provision: x.prov!.id, basis: 'statute', reader: 'statute', authority_provision: stem.id,
        span: clip(textOf(leaf), 200), scope: { topic: x.topic, sepp_uses: uses, lep_uses: x.uses, lep_value: x.value, lep_unit: x.unit,
          effect: 'EP&A Act s 4.15(3): complying with this standard prevents the consent authority requiring a more onerous one' }, confidence: 0.7 })
    }
  }

  // ── statute: cl 4.6 - every development standard may be varied, except what 4.6(8) excludes ───
  const c46 = local(RANDWICK, 'sec.4.6')
  if (c46) {
    const excl = provs.filter(x => x.local_id.startsWith('sec.4.6-ssec.8')).flatMap(x => refsIn(textOf(x), x)).map(r => r.to).filter(Boolean) as P[]
    const exclRoots = new Set(excl.map(e => e.local_id))
    const excluded = (x: P) => [...exclRoots].some(r => x.local_id === r || x.local_id.startsWith(r + '-'))
      || (x.document_id === HOUSING && /^sch\.1(-|$)/.test(x.local_id))            // 4.6(8)(a): a standard for complying development
    const housingStd = provs.filter(x => x.document_id === HOUSING && x.kind !== 'term' && isStandard(x))
    const targets46 = [...new Map([...lepStd.map(r => r.prov!), ...housingStd].map(x => [x.id, x])).values()]
    for (const x of targets46) {
      if (excluded(x)) continue
      add({ kind: 'may_vary', from_provision: c46.id, to_provision: x.id, basis: 'statute', reader: 'statute', authority_provision: local(RANDWICK, 'sec.4.6-ssec.2')?.id ?? c46.id,
        span: 'this or any other environmental planning instrument', scope: { excluded_by_4_6_8: [...exclRoots], limit: '4.6(6): subdivision in rural, R5 and C zones' }, confidence: 0.7 })
    }
  }

  // ── interpretive: specific over general (proposed - shown for confirmation) ───────────────────
  // and it is a standard the pilot reads as "the figure on the map" - not a provision that merely mentions the map (2.6(2), 4.2(3))
  const mapStd = new Set(lepStd.filter(r => r.unit === 'map').map(r => r.prov!.id))
  const despiteFrom = new Set(rels.filter(r => r.kind === 'despite').flatMap(r => [r.from_provision, r.authority_provision ?? r.from_provision]))
  const MAPS: Record<string, RegExp> = { fsr: /Floor Space Ratio Map/, height: /Height of Buildings Map/, lot_size: /Lot Size Map/ }
  for (const [topic, map] of Object.entries(MAPS)) {
    for (const doc of [RANDWICK]) {
      // the general standard is the map rule itself - not a provision that is already an exception to it ("Despite clause 4.4, ...")
      const general = provs.filter(p => p.document_id === doc && p.kind !== 'term' && map.test(textOf(p)) && /shown for the land|shown on the/.test(textOf(p)) && (topics.get(p.id) ?? []).includes(topic)
        && !despiteFrom.has(p.id) && mapStd.has(p.id))
      const specific = lepStd.filter(r => r.topic === topic && r.unit !== 'map' && (r.uses.length || r.zones.length || /Zone [A-Z]{1,2}\d/.test(textOf(r.prov!))))
        .map(r => r.prov!).filter(p => p.document_id === doc && !map.test(textOf(p)))
      for (const g of general) for (const s of specific) {
        const gc = clauseOf(g), sc = clauseOf(s)
        if (!gc || !sc || gc.id === sc.id) continue
        add({ kind: 'more_specific_than', from_provision: s.id, to_provision: g.id, basis: 'interpretive', reader: 'specificity', status: 'proposed', confidence: 0.5,
          span: `${sc.local_id} (${usesIn(textOf(s)).join(', ') || 'zone-specific'}) vs ${gc.local_id} (the ${topic} map)`, scope: { topic } })
      }
    }
  }

  // ── dedupe ────────────────────────────────────────────────────────────────────────────────────
  const uniq = new Map<string, Rel>()
  for (const r of rels) uniq.set(`${r.kind}|${r.from_provision}|${r.to_provision ?? ''}|${r.to_ref ?? ''}`, r)
  const final = [...uniq.values()]
  const byKind = final.reduce((a: Record<string, number>, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {})
  const unresolved = final.filter(r => !r.to_provision && !['inconsistency_rule'].includes(r.kind)).reduce((a: Record<string, number>, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {})
  const unreadBy = unread.reduce((a: Record<string, number>, u) => ({ ...a, [u.trigger]: (a[u.trigger] ?? 0) + 1 }), {})
  const topicCount = [...topics.values()].flat().reduce((a: Record<string, number>, t) => ({ ...a, [t]: (a[t] ?? 0) + 1 }), {})
  console.log('relations', final.length, byKind)
  console.log('target unresolved (kept as to_ref)', unresolved)
  console.log('unread', unread.length, unreadBy)
  console.log('terms', { ...termStats, ubiquitous: termStats.ubiquitous.slice(0, 20) })
  console.log('topics', topicCount)
  console.log('LEP standards from the pilot:', lepStd.length, lepStd.reduce((a: Record<string, number>, r) => ({ ...a, [r.topic]: (a[r.topic] ?? 0) + 1 }), {}), 'pilot runs', pilotRun.length)
  if (process.env.RAG_DEBUG) {
    const g = new Map<string, string[]>()
    for (const r of final.filter(r => r.kind === process.env.RAG_DEBUG)) { const f = byId.get(r.from_provision)!.local_id; g.set(f, [...(g.get(f) ?? []), r.to_provision ? byId.get(r.to_provision)!.local_id : `(${r.to_ref})`]) }
    for (const [f, ts] of g) console.log('  ', f.padEnd(30), ts.length, ts.slice(0, 12).join(' '))
  }
  if (process.env.RAG_DEBUG === 'std') {
    for (const r of lepStd) console.log(' LEP', r.prov!.local_id.padEnd(34), r.topic.padEnd(16), String(r.value).padEnd(8), (r.unit ?? '').padEnd(5), isSubdivision(r.prov!) ? 'SUB' : '   ', (r.uses as string[]).join(','), '|', clip(textOf(r.prov!), 110))
    for (const stem of ndStems) for (const leaf of kids.get(stem.id)!) console.log(' ND ', leaf.local_id.padEnd(34), (topics.get(leaf.id) ?? []).join(',').padEnd(24), isSubdivision(stem) ? 'SUB' : '   ', '|', clip(textOf(leaf), 120))
  }
  if (DRY) { await client.end(); return }

  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('relations', $1) RETURNING id`, [JSON.stringify({ ubiquitous_cap: UBIQUITOUS, pilot_proposition_runs: pilotRun, pilot_source: pilotLive ? 'live' : 'frozen', lep_standards: lepStd.length })])).rows[0].id
  await q(`DELETE FROM rag.relation WHERE reader <> 'manual'`)
  if (pilotLive) {
    await q(`DELETE FROM rag.pilot_standard WHERE document_id = $1`, [RANDWICK])
    await q(`INSERT INTO rag.pilot_standard (document_id, local_id, topic, comparator, value, unit, uses, zones, pilot_run, frozen_run)
             SELECT $2, local_id, topic, comparator, value, unit, uses, zones, run_id, $3
               FROM jsonb_to_recordset($1::jsonb) AS x(local_id text, topic text, comparator text, value numeric, unit text, uses text[], zones text[], run_id uuid)`,
      [JSON.stringify(pilotStd), RANDWICK, run])
  }
  await q(`DELETE FROM rag.unread`)
  for (let i = 0; i < final.length; i += 3000) {
    const batch = final.slice(i, i + 3000).map(r => ({ ...r, scope: r.scope ?? null, run_id: run }))
    await q(`INSERT INTO rag.relation (kind, from_provision, to_provision, to_document, to_ref, scope, basis, authority_provision, span, reader, status, confidence, run_id)
             SELECT kind, from_provision, to_provision, to_document, to_ref, scope, basis, authority_provision, span, reader, coalesce(status, 'proposed'), confidence, run_id
               FROM jsonb_to_recordset($1::jsonb) AS x(kind text, from_provision uuid, to_provision uuid, to_document uuid, to_ref text, scope jsonb, basis text,
                    authority_provision uuid, span text, reader text, status text, confidence real, run_id uuid)`, [JSON.stringify(batch)])
  }
  if (unread.length) await q(`INSERT INTO rag.unread (provision_id, reader, trigger, span, note, run_id)
    SELECT provision_id, reader, trigger, span, note, $2 FROM jsonb_to_recordset($1::jsonb) AS x(provision_id uuid, reader text, trigger text, span text, note text)`, [JSON.stringify(unread), run])
  const topicRows = [...topics.entries()].map(([id, t]) => ({ id, t }))
  for (let i = 0; i < topicRows.length; i += 3000)
    await q(`UPDATE rag.provision p SET topics = x.t FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, t text[]) WHERE p.id = x.id`, [JSON.stringify(topicRows.slice(i, i + 3000))])
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ relations: final.length, by_kind: byKind, unresolved, unread: unread.length, unread_by: unreadBy, terms: { ...termStats, ubiquitous: termStats.ubiquitous.length } })])
  await q('COMMIT')
  console.log('written: run', run)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
