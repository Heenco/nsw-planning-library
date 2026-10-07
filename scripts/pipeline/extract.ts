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
/** Uses the instrument names that the closed vocabulary does not hold (profile.extraUses). */
let EXTRA_USES: string[] = []
/** The profile's extra uses a text names, longest first, none inside a longer one found ("non-hosted short-term rental
 *  accommodation" is not also "hosted short-term rental accommodation"). */
function extrasIn(seg0: string): string[] {
  let seg = seg0.toLowerCase()
  const out: string[] = []
  for (const u of [...EXTRA_USES].sort((a, b) => b.length - a.length)) {
    for (const form of [u, u.replace(/y$/, 'ies'), `${u}s`]) {
      if (!seg.includes(form)) continue
      if (!out.includes(u)) out.push(u)
      seg = seg.split(form).join(' ')
    }
  }
  return out
}
/** What a grant sentence grants: the words before its verb; for a change of use, only what the use changes TO
 *  ("change of use ... from serviced apartments to a residential flat building", s 116); and a place the work is in
 *  is not its purpose ("the installation of a fire sprinkler system in a residential care facility", s 91(2)). */
const changeTo = (t: string) => t.match(/\bchange of use\b.*?\bfrom\b.+?\bto\b(.+?)(?:\bif\b|—|$)/i)?.[1] ?? null
const grantPhrase = (t: string) => (changeTo(t) ?? t.replace(/\b(?:may be carried out|is permitted|is exempt development)\b.*$/i, ''))
  .replace(/\b(?:in|within) (?:an?|the) (?!zone\b)[^,]*$/i, '')
function usesIn(t: string, groups: UseGroup[] = []): string[] {
  const out = new Set<string>()
  for (const seg of t.split(/,| or | and /)) {
    for (const u of (matchLandUses(seg) ?? []) as string[]) if (u !== 'dwelling') out.add(u)
    for (const u of extrasIn(seg)) out.add(u)
  }
  // a defined group of uses named in the text ("development that includes residential development")
  for (const g of groups) if (t.toLowerCase().includes(g.term)) for (const u of g.uses) out.add(u)
  return [...out]
}
/** "residential development means development for the following purposes— (a) attached dwellings, ...": a
 *  term the instrument defines as a list of uses, applying under the division / part / chapter it is defined in. */
interface UseGroup { term: string; uses: string[]; scope: string }
/** The first of the profile's defined-area terms (longest first) named in the text. */
const areaIn = (t: string, areas: string[]) => areas.find(a => t.toLowerCase().includes(a)) ?? null
/** Every defined-area term named in the text, longest first, none inside another found one. */
const areasIn = (t: string, areas: string[]) => {
  const out: string[] = []
  for (const a of areas) if (t.toLowerCase().includes(a) && !out.some(o => o.includes(a))) out.push(a)
  return out
}
/**
 * What a section's own words narrow its standards to: a use ("for the purposes of X", "for X—") or a defined
 * area other than the ones the whole clause already applies in.
 */
function qualifierOf(t: string, areas: string[], clauseAreas: string[], groups: UseGroup[] = []): { uses: string[]; area: string | null } {
  // a use named only in "where residential flat buildings are not permitted" is a condition, not the subject
  const t2 = t.replace(/\bwhere [a-z -]+? (?:are|is) not permitted\b/gi, '')
  const m = t2.match(/for the purposes of (.+?)(?:—|\bwith a\b|\bif\b|\bunless\b|$)/i) ?? t2.match(/^for (?:a building containing )?(.+?)—/i)
  const area = areaIn(t, areas)
  return { uses: m ? usesIn(m[1]!, groups) : [], area: area && !clauseAreas.includes(area) ? area : null }
}
const UNIT: Record<string, string> = { sqm: 'sqm', metre: 'm', ratio: 'ratio', storeys: 'storeys', dwellings: 'dwellings' }

interface Applic { dimension: string; value: string; polarity: 'applies' | 'excludes'; span: string; alt_group?: string }
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
  if (/\b(maximum|no more than|not more than|not exceed\w*|up to|or fewer)\b/.test(t)) return 'lte'
  // "no boarding room will have a gross floor area ... of more than 25m2"
  if (/\bno\b[^—]*\bmore than\b/.test(t)) return 'lte'
  // "the boarding house will not have more than 12 boarding rooms", "will not result in a building with a height of
  // more than 9.5m", "a floor space ratio is 1:1 or less"
  if (/\bnot\b[^—]*\bmore than\b/.test(t) || /\bor less\b/.test(t)) return 'lte'
  return null
}

/** When a sentence holds both a minimum and a maximum ("not more than 25m2 and not less than—"), the comparator
 *  is the phrase nearest before the number. */
function comparatorNear(text: string, raw: string): string | null {
  const t = text.toLowerCase()
  if (!(/\b(minimum|at least|not less than)\b/.test(t) && /\b(maximum|not more than|no more than|up to)\b/.test(t))) return null
  const i = t.indexOf(String(raw).toLowerCase())
  if (i < 0) return null
  const last = [...t.slice(Math.max(0, i - 60), i).matchAll(/(minimum|at least|not less than|maximum|no more than|not more than|not exceed|up to)/g)].at(-1)?.[1]
  return !last ? null : /minimum|at least|not less than/.test(last) ? 'gte' : 'lte'
}

/** A number's topic from words that name it outright ("communal living area", "minimum lot size"). */
function topicStrong(text0: string, cand: any): string | null {
  // a zone's name is not a topic ("Zone R2 Low Density Residential—600m2" is a lot size, not a density)
  const text = text0.replace(/\bZone [A-Z]+\d* (?:[A-Z][a-z]+ ?)+/g, '')
  const t = text.toLowerCase()
  if (cand.unit === 'storeys' || /storeys?/.test(t) && cand.unit === 'storeys') return 'storeys'
  if (cand.unit === 'dwellings' || /\bdwellings?\b/.test(t) && /no more than \d+ dwelling/.test(t)) return 'dwellings'
  // rooms of a boarding house / co-living housing
  if (/\b(boarding|private) rooms?\b/.test(t) && /floor area/.test(t)) return 'room_floor_area'
  if (/\boccupied by more than\b|\bused by no more than \d+ occupants\b/.test(t)) return 'occupants_per_room'
  if (/\b(not (have|contain) more than|no more than) \d+ (boarding|private) rooms\b/.test(t)) return 'rooms'
  if (/\bcommunal living areas?\b/.test(t)) return cand.unit === 'sqm' || cand.unit === 'metre' ? 'communal_living_area' : 'communal_living_areas'
  if (/\bcommunal open spaces?\b/.test(t)) return 'communal_open_space'
  if (/\bsurface area of the roof\b/.test(t)) return 'rooftop_equipment_area'
  const surface = t.match(/\bsurface area for an? ([a-z]+)\b/)
  if (surface) return `${surface[1]}_area`
  if (/\bambulance parking\b/.test(t)) return 'ambulance_parking'
  if (/\bbalcon(y|ies)\b/.test(t)) return 'balcony'
  const read = topicOf([text])
  if (read) return read === 'width' ? 'width' : read
  if (/\blandscaped area\b/.test(t)) return 'landscaped_area'
  if (/\bfloor areas?\b/.test(t)) return 'floor_area'
  // last resort: the control named plainly ("all buildings will have a height not exceeding the greater of—")
  if (/\bfloor space ratio\b/.test(t)) return 'fsr'
  if (/\bheight\b/.test(t)) return 'height'
  return null
}
/** ... and from words that only suggest it ("an area of", "wide"), which a naming parent sentence outranks. */
function topicWeak(text: string): string | null {
  const t = text.toLowerCase()
  if (/\barea of\b/.test(t)) return 'lot_size'
  if (/\bwide\b/.test(t)) return 'width'
  return null
}
const topicFor = (text: string, cand: any): string | null => topicStrong(text, cand) ?? topicWeak(text)

/** The phrase a number sits in: the stretch between the commas / "and"s around it. */
function phraseAround(text: string, raw: string): string {
  const i = text.indexOf(String(raw))
  if (i < 0) return text
  const pre = text.slice(0, i), post = text.slice(i)
  const a = Math.max(pre.lastIndexOf(','), pre.lastIndexOf(' and '), pre.lastIndexOf('—'))
  const bm = post.search(/,| and |—/)
  return text.slice(a < 0 ? 0 : a + 1, bm < 0 ? text.length : i + bm)
}
/** A topic narrowed by its own words: "each deep soil zone has minimum dimensions of 3m" is not the zone's share. */
function refineTopic(topic: string | null, text: string): string | null {
  if (!topic) return null
  if (/\bminimum dimensions?\b/i.test(text)) return `${topic}_dimension`
  if (/\blocated at the rear\b/i.test(text)) return `${topic}_rear`
  return topic
}

/**
 * The shared reader (findNumberCandidates) counts a number only with a comparator or a unit, so "—0.2 parking spaces
 * for each boarding room" was never counted and the recall gate could not miss it. Every other numeral in operative
 * text is counted too - except references ("section 39", "subsection (2)", "Schedule 11") and years ("2021").
 */
function allNumbers(t: string): any[] {
  const known = ((findNumberCandidates(t) ?? []) as any[])
  const out = [...known]
  // not glued to a capital ("items 4E, 4G and 4K" are references), not a count of things listed ("1 or more of")
  // ... and not the second term of a ratio ("0.65:1")
  for (const m of t.matchAll(/(?<![\w.(\/:])(\d+(?:\.\d+)?)(?![\w.]*\))(?![A-Z])(?!\s+or more of\b)/g)) {
    const i = m.index!
    if (known.some(k => Math.abs(Number(k.index ?? -1) - i) <= 2 || (k.index == null && Number(k.value) === Number(m[1])))) continue
    // a reference, or the next number in a list of them ("under section 16, 17 or 18")
    const before = t.slice(Math.max(0, i - 40), i)
    if (/\b(sections?|subsections?|clauses?|schedules?|parts?|chapters?|divisions?|paragraphs?|items?|s|ss|cl|No\.?)\s*(?:[\d()a-z.]+(?:,\s*|\s*[–-]\s*|\s+(?:or|and|to)\s+))*$/i.test(before)) continue
    if (/^(19|20)\d\d$/.test(m[1]!)) continue
    // a Building Code of Australia class ("class 1b or class 2–9", "a class 1a building") or an ISBN
    if (/\bclass(?:es)?\s+(?:\d+[a-z]?(?:\s*[–-]\s*|\s+(?:or|and)\s+(?:class\s+)?|,\s*))*$/i.test(before)) continue
    if (/\bISBN[\d\s-]*$/.test(before)) continue
    if (/^\d+\)/.test(t.slice(i))) continue
    // a period named by reference back to where it is set ("The 14-day period referred to in subsection (1)(c) ...")
    if (/^\d+-day period referred to in\b/i.test(t.slice(i))) continue
    // a date ("on or after 28 February 2025")
    if (/^\d+\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(t.slice(i))) continue
    out.push({ raw: m[1], value: Number(m[1]), index: i, unit: null, comparator_hint: null, category: 'bare' })
  }
  return out
}

/** The provision without a trailing "Example—" or "Note—", which are not part of it; and nothing of a sentence that
 *  only defines a word for the section ("In this section, a storey does not include ... 1.2m above ground"). */
const operativePart = (t: string) => /^In this (section|subsection|Division|Part|Chapter)(, [a-z ]+ (does not include|includes|means)\b|\s*—\s*[a-z -]+ (means|has the same meaning)\b)/i.test(t)
  ? '' : t.replace(/\s(?:Example|Note)s?\s?—[\s\S]*$/, '')

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  EXTRA_USES = (profile.extraUses ?? []).map(u => u.toLowerCase())
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  const secs = (await client.query(
    `SELECT id, parent_id, local_id, level, heading, raw_text, route, signals, sort_order
       FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [doc.id])).rows
  // a permission phrase that is a condition, not a grant ("(i) is permitted with development consent on the land under
  // Chapter 5 ...", s 42(1)(a)(i); "the development is permitted with development consent under ...", s 183)
  for (const s of secs) {
    if ((s.signals ?? []).includes('permission') && /^(the development )?is permitted\b/i.test(norm(s.raw_text)))
      s.signals = s.signals.filter((x: string) => x !== 'permission')
    // ... nor is exempt work whose purpose names no land use ("Development for the purposes of landscaping and
    // gardening is exempt development if ...", s 31; "Development for a purpose specified in ... Schedule 1 that is
    // carried out within the boundaries of an existing group home", s 63): works, not a grant of the frame's use
    const works = norm(s.raw_text).match(/^development for (?:the purposes? of (.+?)|a purpose specified in .+?)(?= is exempt\b| carried out\b| that is\b| may be\b|,|$)/i)
    if ((s.signals ?? []).includes('permission') && works && /\bexempt development\b/i.test(norm(s.raw_text)) && !usesIn(works[1] ?? '').length)
      s.signals = s.signals.filter((x: string) => x !== 'permission')
  }
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
      // the profile may read a group wider than the unit defining it (profile.useGroupScopes)
      const term = m[1]!.trim().toLowerCase()
      if (container && uses.length) GROUPS.push({ term, uses, scope: profile.useGroupScopes?.[term] ?? container.local_id })
    }
  }
  const groupsFor = (s: any) => { const up = chain(s).map(x => x.local_id); return GROUPS.filter(g => up.includes(g.scope)) }

  // zone groups the instrument defines ("relevant residential zone— (a) means the following— (i) Zone R1 ...", s 151;
  // "residential zone means the following land use zones ...", s 49) - an entry conditional on a council or a centre
  // ("for land in the Canterbury-Bankstown local government area—Zone B2") is left out and reported
  const ZGROUPS: { term: string; codes: string[]; scope: string | null }[] =
    Object.entries(profile.zoneGroups ?? {}).map(([term, codes]) => ({ term: term.toLowerCase(), codes, scope: null }))
  // (a dash inside parentheses - "State Environmental Planning Policy (Precincts—Regional) 2021" - is not the heading's dash)
  const lgaConditional = /for land in (?:the )?(?:[^—(]|\([^)]*\))+?—\s*Zone [A-Z]+\d* (?:[A-Z][a-z]+ ?)+/g
  for (const s0 of secs.filter(s => s.route === 'definition')) {
    const t = norm(s0.raw_text)
    for (const m of t.matchAll(/([a-z][a-z ]*? zone)\s*(?:—\s*\(a\)\s*)?means the following(?: land use zones)?(?: or an equivalent land use zone)?—\s*(.+?)(?=\(b\) includes|\.\s+[A-Za-z][A-Za-z ]+? (?:means|has)\b|$)/gi)) {
      const container = chain(s0).find(x => ['division', 'part', 'chapter'].includes(x.level))
      const codes = zonesIn(m[2]!.replace(lgaConditional, '')).map(z => z.code)
      if (container && codes.length) ZGROUPS.push({ term: m[1]!.trim().toLowerCase(), codes: [...new Set(codes)], scope: container.local_id })
    }
  }
  /** Zone codes for the groups a text names, longest term first, none inside a longer one found. */
  const zoneGroupsIn = (t: string, at: any) => {
    const up = chain(at).map(x => x.local_id)
    const hits: { term: string; codes: string[] }[] = []
    for (const g of ZGROUPS.filter(g => !g.scope || up.includes(g.scope)).sort((a, b) => b.term.length - a.term.length))
      if (new RegExp(`\\b${g.term}\\b`, 'i').test(t) && !hits.some(h => h.term.includes(g.term))) hits.push(g)
    return hits
  }
  // the uses a frame's own scope sentence names ("This Part applies to development for the purposes of ...",
  // "This division applies to development that includes residential development"); a rule naming no use of
  // its own inherits them from its frame
  const frameUses = new Map<string, { uses: string[]; span: string }>()
  for (const f of profile.frames) {
    const root = secs.find(s => s.local_id === f.section)
    if (!root) continue
    const texts = [root, ...secs.filter(s => chain(s).includes(root))].map(s => norm(s.raw_text))
      // ... or the frame's own permission sentence ("Development for the purposes of boarding houses may be carried out
      // with consent on land on which ...", s 23(1))
      .filter(t => /^this (part|division|chapter) applies to development\b/i.test(t)
        || (f.section === root.local_id && /^development for the purposes of .+? (may be carried out|is permitted)\b/i.test(t)))
    // ... or a listed scope ("This chapter applies to the following— (a) development for the purposes of residential flat
    // buildings, ... (c) mixed use development with a residential accommodation component that does not include boarding
    // houses ...", s 144(2)): each item's own use - its head, not what qualifies it
    const lists = [root, ...secs.filter(s => chain(s).includes(root))]
      .filter(s => /^this (part|division|chapter) applies to the following—\s*$/i.test(norm(s.raw_text)))
    const listed = lists.flatMap(l => secs.filter(s => s.parent_id === l.id))
      .map(s => norm(s.raw_text).replace(/^development for the purposes of /i, '').split(/\s(?:with|that|which|other than|unless|including)\b|,/i)[0]!)
    const uses = [...new Set([...texts.flatMap(t => usesIn(t.replace(/\bon land\b.*$/i, ''), groupsFor(root))),
                              ...listed.flatMap(t => usesIn(t, groupsFor(root)))])]
    const listSpan = lists.length ? norm(lists[0]!.raw_text) : null
    if (uses.length) { frameUses.set(f.id, { uses, span: texts[0] ?? listSpan! }); continue }
    // ... else from the single permission sentence among the clauses it governs ("Development for the purposes of
    // seniors housing may be carried out with development consent—", s 81); two or more different grants = no guess
    const roots = f.governs.map(g => secs.find(s => s.local_id === g)).filter(Boolean)
    const grants = secs.filter(s => roots.some(r => chain(s).includes(r)))
      .map(s => norm(s.raw_text)).filter(t => /^development for the purposes of .+? (may be carried out|is permitted)\b/i.test(t))
      .map(t => ({ t, uses: usesIn(t.replace(/\b(may be carried out|is permitted)\b.*$/i, ''), groupsFor(root)) })).filter(g => g.uses.length)
    const distinct = [...new Set(grants.map(g => g.uses.slice().sort().join('|')))]
    if (distinct.length === 1) frameUses.set(f.id, { uses: grants[0]!.uses, span: grants[0]!.t })
  }
  // a chapter frame whose routes are its child frames (Chapter 7: s 183(1)-(3)) takes their uses together - never the
  // instrument's root frame, which would hand every use to every rule
  for (const f of profile.frames.filter(f => f.parent && !frameUses.has(f.id))) {
    const kids = profile.frames.filter(k => k.parent === f.id && frameUses.has(k.id))
    if (kids.length) frameUses.set(f.id, { uses: [...new Set(kids.flatMap(k => frameUses.get(k.id)!.uses))], span: frameUses.get(kids[0]!.id)!.span })
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
  const explained: { section: string; value: number }[] = []
  const skipped: string[] = []

  for (const c of clauses) {
    // a clause left out on purpose is recorded with its reason, so coverage can tell it from one nobody read
    if (SKIP[c.local_id]) {
      skipped.push(`${c.local_id}: ${SKIP[c.local_id]}`)
      findings.push({ kind: 'clause_skipped', gating: false, clause: c.local_id, value: null, detail: `${c.local_id} left out: ${SKIP[c.local_id]}` })
      continue
    }
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
    const scopeInto = (r: RuleOut, p: any, t: string) => {
      const plainT = t.replace(lgaConditional, '')
      if (plainT !== t) findings.push({ kind: 'lga_conditional_zone', gating: false, clause: p.local_id, value: null,
        detail: `"${(t.match(lgaConditional) ?? [''])[0]}" - a zone allowed only in one council or centre is not modelled; left out` })
      if (!frameOwned) {
        for (const z of zonesIn(plainT)) addApplic(r, { dimension: 'zone', value: z.code, polarity: 'applies', span: z.span })
        for (const g of zoneGroupsIn(plainT, p)) for (const code of g.codes) addApplic(r, { dimension: 'zone', value: code, polarity: 'applies', span: literalOf(g.term) })
      }
    }
    const permRoots = scopeRoots.filter(p => (p.signals ?? []).includes('permission'))
    const split = permRoots.length >= 2
    const subSet = (root: any) => parts.filter(x => x === root || chain(x).includes(root))
    for (const p of scopeSet) {
      const t = norm(p.raw_text)
      if (!t) continue
      if (split && permRoots.some(r => subSet(r).includes(p))) continue
      scopeInto(base, p, t)
      // under a grant that names its own uses, a use in a condition is not granted ("... is exempt development if—
      // ... (iv) is not in a hospital", s 141Q; "other than ... Zone RU3 Forestry", s 141F)
      const root = permRoots.find(r => r !== p && chain(p).includes(r))
      const rootNames = root && usesIn(norm(root.raw_text).replace(/\b(?:may be carried out|is permitted|is exempt development)\b.*$/i, ''), groups).length
      // "development to which this Part applies": the uses are the frame's, whatever else the sentence names
      // ("... including as part of a mixed use development")
      const ownUses = rootNames ? [] : /development to which this (part|division|chapter) applies/i.test(t) ? inherited(base.frame)?.uses ?? []
        : changeTo(t) ? usesIn(changeTo(t)!, groups) : usesIn(t, groups)
      for (const u of ownUses) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: t.slice(0, 200) })
      // a zone named by group ("on land in a business zone") with no zone code: not resolved - say so
      const grp = t.match(/\bon land in an? ([a-z ]+?) zone\b/i)
      if (grp && !zonesIn(t).length && !zoneGroupsIn(t, p).length) findings.push({ kind: 'unresolved_zone_group', gating: false, clause: p.local_id, value: null,
        detail: `"${grp[0]}" names no zone code and the instrument does not define it - the rule is not narrowed to it` })
      // an area in a condition's own heading ("(b) for a dwelling located in a prescribed area—... 180 days") narrows
      // that condition, not the grant (read with the condition, below)
      const headArea = root && t.includes('—') && areaIn(t.slice(0, t.indexOf('—')), AREAS)
      const area = frameOwned || headArea ? null : areaIn(t, AREAS)
      if (area) addApplic(base, { dimension: 'defined_area', value: area, polarity: 'applies', span: literalOf(area) })
      if (/involving subdivision/i.test(t)) addApplic(base, { dimension: 'dev_type', value: 'subdivision', polarity: 'applies', span: 'involving subdivision' })
      const date = t.match(/on or after (\d{1,2} \w+ \d{4})/i)
      if (date) addApplic(base, { dimension: 'temporal', value: `on or after ${date[1]}`, polarity: 'applies', span: date[0] })
    }
    // several grants in one clause: each its own rule with its own scope
    const permRules: RuleOut[] = []
    if (split) {
      for (const root of permRoots) {
        const r: RuleOut = { ...base, key: `${base.key}:${root.local_id}`, local_id: root.local_id, section_id: root.id, applic: [], effects: [] }
        for (const x of subSet(root)) {
          const xt = norm(x.raw_text)
          if (!xt) continue
          scopeInto(r, x, xt)
          const area = frameOwned ? null : areaIn(xt, AREAS)
          if (area) addApplic(r, { dimension: 'defined_area', value: area, polarity: 'applies', span: literalOf(area) })
        }
        const rt = norm(root.raw_text)
        // the grant's subject: its uses, or "The strata subdivision of land ... is permitted" (s 185) - which keeps the
        // frame's uses as the development it is about
        const sub = /^the (strata )?subdivision of land\b/i.test(rt) ? (/strata/i.test(rt) ? 'strata subdivision' : 'subdivision') : null
        const granted = sub ? [sub] : usesIn(rt, groups)
        const about = sub ? inherited(base.frame)?.uses ?? [] : granted
        for (const u of about) addApplic(r, { dimension: 'land_use', value: u, polarity: 'applies', span: sub ? inherited(base.frame)!.span : rt.slice(0, 200) })
        for (const u of granted) {
          r.effects.push({ effect_type: 'permits_use', topic: u, comparator: null, value: null, unit: null, value_source: 'sepp_permission',
            relative_to: null, measured_from: null, span: rt, claims: [] })
        }
        permRules.push(r)
      }
    }
    // no use of its own: the frame's ("This division applies to development that includes residential development")
    if (!base.applic.some(a => a.dimension === 'land_use')) {
      const inh = inherited(base.frame)
      for (const u of inh?.uses ?? []) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: inh!.span })
    }
    // ... else the uses its own bar names ("Development consent must not be granted to development for the purposes of
    // residential flat buildings, ... unless", s 159), or those of the section it says it follows ("Development to which
    // section 156 applies", s 157)
    if (!base.applic.some(a => a.dimension === 'land_use')) {
      for (const p of operative) {
        const t = norm(p.raw_text)
        const bar = t.match(/^development consent must not be granted (?:to|for) development for the purposes of (.+?)(?: on (?:a lot|land)\b| in a\b| unless\b|,|$)/i)
        const follows = t.match(/^development to which section (\d+[A-Z]*) applies\b/i)
        const uses = bar ? usesIn(bar[1]!, groups)
          : follows ? (rules.find(r => r.local_id === `sec.${follows[1]}`)?.applic.filter(a => a.dimension === 'land_use').map(a => a.value) ?? []) : []
        for (const u of uses) addApplic(base, { dimension: 'land_use', value: u, polarity: 'applies', span: bar ? t.slice(0, 200) : t })
      }
    }
    // exclusions stated anywhere in the clause ("This section does not apply to strata subdivision.")
    for (const p of operative) {
      const t = norm(p.raw_text)
      const ex = t.match(/^this section does not apply to (?!the extent\b)(.+?)\.?$/i)
      if (ex) addApplic(base, { dimension: 'dev_type', value: ex[1]!.replace(/\.$/, ''), polarity: 'excludes', span: t })
    }

    const out: RuleOut[] = [base, ...permRules]
    const consumed = new Set<string>()
    for (const r of permRules) for (const x of subSet(parts.find(p => p.id === r.section_id))) if (x.id !== r.section_id || !allNumbers(operativePart(norm(x.raw_text))).length) consumed.add(x.id)
    // a scope sentence ending "if—" lists conditions on the rule; those with a number ("all buildings will have a height
    // not exceeding the greater of— (i) 11m", s 42(1)(b)-(f)) are read like standards
    const ifScope = scopeRoots.filter(r => /\bif—\s*$/.test(norm(r.raw_text)))
    const numericUnderIf = (p: any) => ifScope.some(r => p !== r && chain(p).includes(r))
      && parts.filter(x => x === p || chain(x).includes(p)).some(x => allNumbers(operativePart(norm(x.raw_text))).length)
    const effSections = operative.filter(p => !scopeSet.has(p) || numericUnderIf(p))
    // a permission's scope is read too: its permission sentence for permits_use, and any number under it
    // ("at least 50 dwellings", s 72(3)(a)) as a condition of the grant
    for (const p of [...new Set([...effSections, ...(kind === 'permission' ? [...scopeSet] : [])])]) {
      const t = norm(p.raw_text)
      // an "Example—" or "Note—" is not part of the provision: its numbers are neither read nor counted
      const tOp = operativePart(t)
      const cands = allNumbers(tOp)
      if (consumed.has(p.id)) continue
      for (const cd of cands) candidatesAll.push({ section: p.local_id, clause: c.local_id, value: Number(cd.value), raw: cd.raw })

      // A prohibition by place: "Development for the purposes of a boarding house must not be carried out on land in
      // Zone R2 ... unless— (a) for land in <area>—<requirement>, or (b) otherwise—<requirement>" (s 23(2)). Its own
      // rule: the use prohibited in the zone, with the exceptions as a negated group of branches ('!unless#a', ...).
      if ((p.signals ?? []).includes('land_prohibition')) {
        const head = tOp.split(/\bunless\b/i)[0]!
        const uses = usesIn(head, groups)
        const r: RuleOut = { ...base, key: `${base.key}:${p.local_id}`, local_id: p.local_id, section_id: p.id, kind: 'prohibition',
          role: 'prohibition', effects: [],
          applic: [...base.applic.filter(a => a.dimension !== 'land_use' && a.dimension !== 'zone'),
                   ...uses.map(u => ({ dimension: 'land_use', value: u, polarity: 'applies' as const, span: head.slice(0, 200) })),
                   ...zonesIn(head).map(z => ({ dimension: 'zone', value: z.code, polarity: 'applies' as const, span: z.span }))] }
        for (const u of uses) r.effects.push({ effect_type: 'prohibits_use', topic: u, comparator: null, value: null, unit: null,
          value_source: 'sepp_prohibition', relative_to: null, measured_from: null, span: t, claims: [] })
        const kids = secs.filter(s => s.parent_id === p.id)
        const heads: string[][] = []
        kids.forEach((k, i) => {
          const kt = operativePart(norm(k.raw_text))
          const cut = kt.indexOf('—')
          const kh = cut < 0 ? '' : kt.slice(0, cut), req = cut < 0 ? kt : kt.slice(cut + 1)
          const headAreas = areasIn(kh, AREAS)
          heads.push(headAreas)
          const otherwise = /^otherwise\b/i.test(kt)
          const rows: [string, 'applies' | 'excludes'][] = [
            ...(otherwise ? heads.slice(0, i).flat().map(a => [a, 'excludes'] as [string, 'excludes']) : headAreas.map(a => [a, 'applies'] as [string, 'applies'])),
            ...areasIn(req, AREAS).filter(a => !headAreas.includes(a)).map(a => [a, 'applies'] as [string, 'applies'])]
          for (const [a, pol] of rows) r.applic.push({ dimension: 'defined_area', value: a, polarity: pol, span: literalOf(a), alt_group: `!unless#${String.fromCharCode(97 + i)}` })
          consumed.add(k.id)
          // the kids' numbers are counted, and explained when they sit inside a matched term ("within 800m walking ...")
          for (const cd of allNumbers(kt)) {
            candidatesAll.push({ section: k.local_id, clause: c.local_id, value: Number(cd.value), raw: cd.raw })
            if (rows.some(([a]) => literalOf(a).includes(String(cd.raw)))) explained.push({ section: k.local_id, value: Number(cd.value) })
          }
        })
        out.push(r)
        continue
      }

      // a condition of consent with no number, in a "consent must not be granted ... unless ... satisfied that—" list
      // ("adequate bathroom, kitchen and laundry facilities", "will be in an accessible area")
      const upTexts = chain(p).slice(1, chain(p).indexOf(c) + 1).map(x => operativePart(norm(x.raw_text)))
      // ... but not when the list is what the bar is about ("must not be granted for development for the following
      // purposes ... unless ...—  (a) residential flat buildings", s 176(2))
      const qualitative = !cands.length && role === 'conditional_standard' && !/—\s*$/.test(tOp) && !!tOp
        && upTexts.some(u => /must not be granted\b[^—]*\bunless\b/i.test(u) && !/\bthe following (purposes|development)\b/i.test(u))

      // Standards narrowed by their own words - "(3) ... for the purposes of multi dwelling housing
      // (terraces)—", "(2) ... in a low and mid rise housing inner area—", "(b) for residential flat
      // buildings—" - go to their own rule: the nearest use and the nearest area up the chain to the clause,
      // keyed by the deepest section that narrowed it, inheriting the rest of the clause's applicability.
      let target = base
      // a numbered condition of a grant narrowed by its own heading's area ("for a dwelling located in a prescribed
      // area—the dwelling is not used ... for more than 180 days", s 112(1)(b)): its own rule, in that area
      const condArea = scopeSet.has(p) && numericUnderIf(p) && tOp.includes('—') ? areaIn(tOp.slice(0, tOp.indexOf('—')), AREAS) : null
      if (condArea && cands.length) {
        const key = `${base.key}:${p.local_id}`
        let r = out.find(x => x.key === key)
        if (!r) {
          r = { ...base, key, local_id: p.local_id, section_id: p.id, kind: 'standard', role: 'conditional_standard', effects: [],
            applic: [...base.applic.filter(a => a.dimension !== 'defined_area'),
                     { dimension: 'defined_area', value: condArea, polarity: 'applies' as const, span: literalOf(condArea) }] }
          out.push(r)
        }
        target = r
      } else if ((cands.length || qualitative) && !scopeSet.has(p)) {
        const full = chain(p)
        const up = full.slice(0, full.indexOf(c))
        // every level may narrow it: s 74(2)(d)(i) is "in the Eastern Harbour City, ..." (d) AND "within an
        // accessible area" (i); "(ii) otherwise—" is the complement of its earlier siblings' areas
        let uses: string[] = [], keyAt: any = null
        const areas: string[] = [], notAreas: string[] = []
        // a zone in a paragraph's heading ("for development on land in Zone R2 Low Density Residential—600m2"), and
        // "otherwise—" / "for development on other land—" as the complement of the earlier siblings' heading zones
        const zonesQ: { code: string; span: string }[] = [], notZones: { code: string; span: string }[] = []
        const props: string[] = [], notProps: string[] = []
        const lepNot: string[] = []
        let lepNotSpan = ''
        const PROP = /\b(?:made by(?:, or made by a person jointly with,)?|carried out by or on behalf of) (a social housing provider or Landcom|a relevant authority|the [A-Z][\w ]+?)\s*(?:—|,|$)/
        const headOf = (s: string) => (s.includes('—') ? s.slice(0, s.indexOf('—')) : '')
        const clauseAreas = base.applic.filter(a => a.dimension === 'defined_area').map(a => a.value)
        for (const x of up) {
          const xt = norm(x.raw_text)
          const q = qualifierOf(xt, AREAS, clauseAreas, groups)
          if (!uses.length && q.uses.length) { uses = q.uses; keyAt = keyAt ?? x }
          if (q.area && !areas.includes(q.area)) { areas.push(q.area); keyAt = keyAt ?? x }
          for (const z of zonesIn(headOf(xt))) if (!zonesQ.some(q => q.code === z.code)) { zonesQ.push(z); keyAt = keyAt ?? x }
          // a zone group the profile defines ("in a residential zone"), and "where residential flat buildings are not
          // permitted" as a condition on the LEP's own table
          for (const [g, codes] of Object.entries(profile.zoneGroups ?? {})) {
            if (new RegExp(`\\bin an? ${g}\\b`, 'i').test(headOf(xt))) for (const code of codes)
              if (!zonesQ.some(q => q.code === code)) { zonesQ.push({ code, span: literalOf(g) }); keyAt = keyAt ?? x }
          }
          const notPermitted = headOf(xt).match(/\bwhere ([a-z -]+?) (?:are|is) not permitted\b/i)
          if (notPermitted) for (const u of usesIn(notPermitted[1]!)) if (!lepNot.includes(u)) { lepNot.push(u); lepNotSpan = notPermitted[0]; keyAt = keyAt ?? x }
          const pm = headOf(xt).match(PROP)
          if (pm && !props.includes(pm[1]!)) { props.push(pm[1]!); keyAt = keyAt ?? x }
          const notPara = xt.match(/^if paragraph \((\w+)\) does not apply—/i)
          if (notPara) {
            const sib = secs.find(s => s.parent_id === x.parent_id && new RegExp(`para\\d+\\.${notPara[1]}$`).test(s.local_id))
            const sm = sib ? headOf(norm(sib.raw_text)).match(PROP) : null
            if (sm && !notProps.includes(sm[1]!)) { notProps.push(sm[1]!); keyAt = keyAt ?? x }
          }
          if (/^(otherwise|for development on other land)\b/i.test(xt)) {
            for (const sib of secs.filter(s => s.parent_id === x.parent_id && s.sort_order < x.sort_order)) {
              const st = norm(sib.raw_text)
              const a = areaIn(st, AREAS)
              if (a && !notAreas.includes(a) && !clauseAreas.includes(a)) { notAreas.push(a); keyAt = keyAt ?? x }
              for (const z of zonesIn(headOf(st))) if (!notZones.some(q => q.code === z.code)) { notZones.push(z); keyAt = keyAt ?? x }
            }
          }
        }
        if (!uses.length && !base.applic.some(a => a.dimension === 'land_use')) {
          const own = usesIn(tOp.split(/\bis\b/)[0]!.replace(/\bwhere [a-z -]+? (?:are|is) not permitted\b/gi, ''), groups)
          const kids = /—\s*$/.test(tOp) ? secs.filter(s => s.parent_id === p.id).flatMap(k => usesIn(norm(k.raw_text), groups)) : []
          uses = [...new Set([...own, ...kids])]
          if (uses.length) keyAt = keyAt ?? p
        }
        if (keyAt) {
          const key = `${base.key}:${keyAt.local_id}`
          let r = out.find(x => x.key === key)
          if (!r) {
            r = { ...base, key, local_id: keyAt.local_id, section_id: keyAt.id, effects: [],
              applic: [...base.applic.filter(a => !(uses.length && a.dimension === 'land_use') && !(areas.length && a.dimension === 'defined_area')
                                                  && !(zonesQ.length && a.dimension === 'zone')),
                       ...zonesQ.map(z => ({ dimension: 'zone', value: z.code, polarity: 'applies' as const, span: z.span })),
                       ...props.map(v => ({ dimension: 'proponent', value: v, polarity: 'applies' as const, span: v })),
                       ...lepNot.map(u => ({ dimension: 'permissible_under', value: `lep:${u}`, polarity: 'excludes' as const, span: lepNotSpan })),
                       ...notProps.map(v => ({ dimension: 'proponent', value: v, polarity: 'excludes' as const, span: v })),
                       ...notZones.map(z => ({ dimension: 'zone', value: z.code, polarity: 'excludes' as const, span: z.span })),
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
        const named = changeTo(t) ? usesIn(changeTo(t)!) : [...new Set([...((matchLandUses(t) ?? []) as string[]).filter(u => u !== 'dwelling'),
          ...extrasIn(grantPhrase(t))])]
        const uses = named.length ? named : /to which this (part|section|division) applies/i.test(t)
          ? base.applic.filter(a => a.dimension === 'land_use').map(a => a.value)
          : /^the (strata )?subdivision of land\b/i.test(t) ? [/strata/i.test(t) ? 'strata subdivision' : 'subdivision'] : []
        for (const u of uses) {
          target.effects.push({ effect_type: 'permits_use', topic: u, comparator: null, value: null, unit: null,
            value_source: 'sepp_permission', relative_to: null, measured_from: null, span: t, claims: [] })
        }
        if (!cands.length) continue
      } else if (kind === 'permission' && scopeRoots.includes(p) && !cands.length) continue
      if (kind === 'matters' || ((p.signals ?? []).includes('consideration') && !cands.length)) {
        const g = t.match(/consider(?:ed)? the (.+?)(?:,| published|$)/i)
        // a list's heading ("... unless the consent authority has considered the following—") is not itself a matter: its
        // items are, each in its own words ("(b) the Apartment Design Guide,", s 147(1))
        if (/—\s*$/.test(tOp) && secs.some(s => s.parent_id === p.id)) continue
        const listItem = /—\s*$/.test(operativePart(norm(byId.get(p.parent_id)?.raw_text)))
        const item = listItem ? tOp.replace(/[,.;]\s*(?:and|or)?\s*$/i, '').trim() : ''
        // a time the matter is bounded by: "any advice received from a design review panel within 14 days after ..."
        const days = tOp.match(/\bwithin (\d+) days\b/i)
        target.effects.push({ effect_type: 'matter_for_consideration', topic: g && !/^following—/i.test(g[1]!) ? g[1]!.trim() : item || 'see clause',
          comparator: days ? 'lte' : null, value: days ? Number(days[1]) : null, unit: days ? 'days' : null, value_source: 'clause_text',
          relative_to: null, measured_from: null, span: t, claims: days ? [{ section: p.local_id, value: Number(days[1]) }] : [] })
        continue
      }
      if (kind === 'disapplication') {
        if (!(p.signals ?? []).includes('disapplication')) continue
        const ref = t.match(/meets the standards in section ([\d()A-Za-z ,or]+?)—/i)
        // "A requirement ... specified in a development control plan ... has no effect if the Apartment Design Guide also
        // specifies a requirement ... in relation to the same matter" (s 149)
        const dcp = /specified in a development control plan\b.*\bhas no effect if the Apartment Design Guide\b/i.test(t)
        const items = parts.filter(x => chain(x).includes(p) && x !== p).map(x => norm(x.raw_text).replace(/[,.]$/, ''))
        for (const it of items.length ? items : ['see clause']) {
          target.effects.push({ effect_type: 'disapplies', topic: /lot size/i.test(it) ? 'lot_size' : /width/i.test(it) ? 'width' : it,
            comparator: null, value: null, unit: null, value_source: 'clause_text',
            relative_to: ref ? `meets s ${ref[1]!.trim()}` : dcp ? 'a development control plan, where the Apartment Design Guide covers the same matter' : null,
            measured_from: null, span: t, claims: [] })
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
      // "an additional 30% of the maximum permissible floor space ratio if ... used only for the boarding house"
      for (const m of tOp.matchAll(/\ban additional (\d+(?:\.\d+)?)% of the maximum permissible (floor space ratio|building height)/gi)) {
        push({ effect_type: 'relative_numeric', topic: /floor/i.test(m[2]!) ? 'fsr' : 'height', comparator: 'lte', value: Number(m[1]),
          unit: 'percent', relative_to: `maximum permissible ${m[2]!.toLowerCase()}` }, [Number(m[1])])
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
      // "at least 2% of the gross floor area of the building will be used for affordable housing" (s 156)
      const ahShare = tOp.match(/\bat least (\d+(?:\.\d+)?)% of the gross floor area\b[^.]*?\bused for affordable housing\b/i)
      if (ahShare) push({ effect_type: role === 'conditional_standard' ? 'condition_of_consent' : 'numeric', topic: 'affordable_housing_share',
        comparator: 'gte', value: Number(ahShare[1]), unit: 'percent of gross floor area' }, [Number(ahShare[1])])
      // "Development consent may be granted ... despite a minimum lot size restriction" (s 158)
      if (/\bdespite a minimum lot size restriction\b/i.test(tOp))
        target.effects.push({ effect_type: 'disapplies', topic: 'lot_size', comparator: null, value: null, unit: null, value_source: 'clause_text',
          relative_to: 'a minimum lot size in another instrument', measured_from: null, span: t, claims: [] })
      // sunlight: "in at least 70% of the dwellings receive at least 3 hours of direct solar access between 9am and 3pm"
      const sun = tOp.match(/at least (\d+(?:\.\d+)?)% of the dwellings receive at least (\d+(?:\.\d+)?) hours? of (?:direct )?solar access(?: between (\d+)\s*am and (\d+)\s*pm)?/i)
      if (sun) push({ topic: 'solar_access', comparator: 'gte', value: Number(sun[2]), unit: 'hours',
        value_source: sun[3] ? `between ${sun[3]}am and ${sun[4]}pm at mid-winter` : null,
        condition_metric: 'share_of_dwellings', condition_lo: Number(sun[1]), condition_unit: 'percent' },
        [Number(sun[1]), Number(sun[2]), ...(sun[3] ? [Number(sun[3]), Number(sun[4])] : [])])
      // "at least 3 hours of direct solar access (will be) provided between 9am and 3pm at mid-winter in at least 1
      // communal living area"
      const sun2 = tOp.match(/at least (\d+(?:\.\d+)?) hours? of (?:direct )?solar access (?:will be )?(?:provided )?between (\d+)\s*am and (\d+)\s*pm at mid-winter in at least (\d+) ([a-z ]+?)[,.;]?(?: and)?$/i)
      if (sun2 && !sun) push({ topic: 'solar_access', comparator: 'gte', value: Number(sun2[1]), unit: 'hours',
        value_source: `between ${sun2[2]}am and ${sun2[3]}pm at mid-winter`,
        condition_metric: sun2[5]!.trim().replace(/s$/, '').replace(/\s+/g, '_') + 's', condition_lo: Number(sun2[4]), condition_unit: 'count' },
        [Number(sun2[1]), Number(sun2[2]), Number(sun2[3]), Number(sun2[4])])
      // a height threshold: a heading "... having a height of more than 9.5m—" (its number is a condition, explained) makes
      // its children conditional on it; so does the head of the number's own sentence ("if ... more than 9.5m ...—11.5m")
      const HEIGHT_OVER = /height of more than (\d+(?:\.\d+)?)\s*m\b/i
      const dash = tOp.indexOf('—')
      const ownHead = dash > 0 && dash < tOp.length - 1 ? tOp.slice(0, dash) : ''
      const headerOver = /—\s*$/.test(tOp) ? tOp.match(HEIGHT_OVER) : null
      if (headerOver) claimedHere.add(Number(headerOver[1]))
      const parentOver = /—\s*$/.test(parentT) ? parentT.match(HEIGHT_OVER) : null
      const ownOver = ownHead.match(HEIGHT_OVER)
      if (ownOver) claimedHere.add(Number(ownOver[1]))
      const over = ownOver ?? parentOver
      const heightCond = over ? { condition_metric: 'height', condition_lo: Number(over[1]), condition_unit: 'm' } : {}
      const overClaim = ownOver ? [{ section: p.local_id, value: Number(ownOver[1]) }] : []
      // "a height of not more than 3.8m above the maximum permissible building height"
      const above3 = tOp.match(/(\d+(?:\.\d+)?)\s*m above the maximum permissible building height/i)
      if (above3) push({ effect_type: 'relative_numeric', topic: 'height', comparator: 'lte', value: Number(above3[1]), unit: 'm',
        relative_to: 'maximum permissible building height' }, [Number(above3[1])])
      // a rate: "at least 1 parking space for every 10 beds", "for every 2 employees who are on duty", "for every 5 dwellings"
      for (const m of tOp.matchAll(/(\d+(?:\.\d+)?) parking spaces? for (?:every|each) (\d+ )?((?:boarding |private )?[a-z]+)/gi)) {
        const per = m[2] ? Number(m[2]) : null
        const stated = comparatorOf(tOp) ?? comparatorOf(parentT)
        if (!stated) findings.push({ kind: 'comparator_inferred', gating: false, clause: p.local_id, value: m[1]!,
          detail: `"${t}" states no minimum/maximum; a parking rate is read as a minimum (gte)` })
        push({ topic: 'parking', comparator: stated ?? 'gte', value: Number(m[1]), unit: `spaces per ${per ? per + ' ' : ''}${m[3]!.toLowerCase()}` },
          [Number(m[1]), ...(per != null ? [per] : [])])
      }
      // "within 50km of a 24-hour health services facility": a distance condition (the "24-hour" describes the facility)
      const km = tOp.match(/within (\d+(?:\.\d+)?)\s*km of (?:an? )?((?:(\d+)-hour )?[a-z -]+?)(?:,|\.|;| and|$)/i)
      if (km) push({ effect_type: 'condition_of_consent', topic: `distance to ${km[2]!.trim()}`, comparator: 'lte', value: Number(km[1]), unit: 'km' },
        [Number(km[1]), ...(km[3] ? [Number(km[3])] : [])])
      // times of day in a condition ("at least once between 8am and 12pm each day"): part of the requirement's words
      const times = [...tOp.matchAll(/\b(\d{1,2})\s*(am|pm)\b/gi)]
      if (times.length && role === 'conditional_standard' && !/solar access/i.test(tOp)) {
        push({ effect_type: 'condition_of_consent', topic: tOp.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: null, value: null,
          value_source: times.map(m => m[0]).join(', ') }, times.map(m => Number(m[1])))
      }
      // a cap on days in a period: "not used for ... for more than 180 days in a 365-day period"
      const dayCap = tOp.match(/\bfor more than (\d+) days in an? (\d+)-day period\b/i)
      if (dayCap) push({ effect_type: 'numeric', topic: `days_per_${dayCap[2]}_day_period`, comparator: 'lte', value: Number(dayCap[1]), unit: 'days' },
        [Number(dayCap[1]), Number(dayCap[2])])
      // "a period of 21 consecutive days or more ... must not be counted"
      const consec = tOp.match(/\b(\d+) consecutive days( or more)?/i)
      if (consec) push({ effect_type: 'condition_of_consent', topic: tOp.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: consec[2] ? 'gte' : null,
        value: Number(consec[1]), unit: 'consecutive days', value_source: 'clause_text' }, [Number(consec[1])])
      // a time limit in years: "within 5 years of the natural disaster occurring", "after the day that is 5 years from ..."
      const years = tOp.match(/\b(?:within|that is) (\d+) years (?:of|from|after)\b/i)
      if (years) push({ effect_type: 'condition_of_consent', topic: tOp.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: 'lte',
        value: Number(years[1]), unit: 'years', value_source: 'clause_text' }, [Number(years[1])])
      // a cap on rooms: "does not result in more than 10 bedrooms on a site", "no more than 5 bedrooms"
      const roomCap = tOp.match(/\b(?:not result in|no|not) more than (\d+) bedrooms\b/i)
      if (roomCap) push({ effect_type: 'condition_of_consent', topic: 'bedrooms', comparator: 'lte', value: Number(roomCap[1]), unit: 'bedrooms' },
        [Number(roomCap[1])])
      // a cap as a share of another control: "the maximum floor space ratio must not exceed 130% of the maximum permissible
      // floor space ratio for the development on the land" (s 12A(2))
      const capOf = tOp.match(/\bmust not exceed (\d+(?:\.\d+)?)% of the maximum permissible (floor space ratio|building height)\b/i)
      if (capOf) push({ effect_type: 'relative_numeric', topic: /floor/i.test(capOf[2]!) ? 'fsr' : 'height', comparator: 'lte', value: Number(capOf[1]),
        unit: 'percent', relative_to: `maximum permissible ${capOf[2]!.toLowerCase()}`,
        value_source: /\bmore than one relevant provision\b/i.test(tOp) ? 'when the additional floor space ratio of more than one relevant provision is used' : null },
        [Number(capOf[1])])
      // a standard set by a guideline: "the car parking for the building must be equal to, or greater than, the recommended
      // minimum amount of car parking specified in Part 3J of the Apartment Design Guide" (s 148(2)(a))
      const byGuide = tOp.match(/^the (.+?) (?:for|of) (?:the|each) [a-z ]+? must be equal to, or (greater|less) than, the (recommended (?:minimum|maximum) [a-z ]+?) specified in (Part [\dA-Z]+ of the [A-Z][\w ]+?)[,.;]?(?: and| or)?$/i)
      if (byGuide) push({ effect_type: 'relative_numeric', topic: byGuide[1]!.toLowerCase().replace(/\s+/g, '_'), comparator: byGuide[2]!.toLowerCase() === 'greater' ? 'gte' : 'lte',
        value: null, unit: null, relative_to: `the ${byGuide[3]} in ${byGuide[4]}` }, [])
      // a period to act in: "responses ... received within 21 days after the notice is given"
      const days = tOp.match(/within (\d+) days\b/i)
      if (days) push({ effect_type: 'condition_of_consent', topic: 'response_period_days', comparator: 'lte', value: Number(days[1]), unit: 'days' }, [Number(days[1])])
      // gradients and other ratios in a condition ("not more than 1:14", "1:12 for a maximum length of 15m")
      if (role === 'conditional_standard' && !/floor space ratio/i.test(tOp)) {
        for (const m of tOp.matchAll(/\b(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\b/g)) {
          const len = tOp.slice(m.index! + m[0].length).match(/^ for a maximum length of (\d+(?:\.\d+)?)\s*m/i)
          push({ effect_type: 'condition_of_consent', topic: /gradient/i.test(tOp + ' ' + parentT) ? 'gradient' : 'ratio', comparator: 'lte',
            value: Number(m[2]), unit: `1:${m[2]}`, value_source: len ? `for a maximum length of ${len[1]}m` : null },
            [Number(m[1]), Number(m[2]), ...(len ? [Number(len[1])] : [])])
        }
      }
      // a requirement that applies above a size: "if the boarding house has at least 3 storeys—the building will comply
      // with the minimum building separation distances specified in the Apartment Design Guide"
      const above = tOp.match(/^if the [a-z -]+? (?:has|contains|will have|results in a building with) (at least|more than) (\d+) (storeys|dwellings|boarding rooms|private rooms)—\s*(.+?)[,.;]?(?: and| or)?$/i)
      if (above) {
        const consider = upTexts.some(u => /\bconsiders? whether\b/i.test(u))
        // the requirement's own numbers ("an angle of 45 degrees") belong to it
        const reqNums = (allNumbers(above[4]!) as any[]).map(x => Number(x.value))
        push({ effect_type: consider ? 'matter_for_consideration' : 'condition_of_consent', topic: above[4]!, comparator: null, value: null,
          value_source: 'clause_text', condition_metric: above[3]!.toLowerCase().replace(/\s+/g, '_'),
          condition_lo: Number(above[2]) + (/more than/i.test(above[1]!) ? 1 : 0), condition_unit: above[3]!.toLowerCase() }, [Number(above[2]), ...reqNums])
      }
      // a period a condition must hold for: "for a period of at least 15 years"
      const period = tOp.match(/for a period of at least (\d+) years/i)
      if (period) push({ effect_type: 'condition_of_consent', topic: 'period_years', comparator: 'gte', value: Number(period[1]), unit: 'years' }, [Number(period[1])])
      // "for each dwelling containing (at least) 2 bedrooms—", "for a boarding house containing more than 6 boarding
      // rooms—": the count is a condition of the value, not the value - read in the paragraph or its heading
      const ROOMS = /containing (at least |more than )?(\d+)( or more)? (bedrooms?|boarding rooms?|private rooms?)/i
      const bedOwn = tOp.match(ROOMS), bed = bedOwn ?? parentT.match(ROOMS)
      const bedCond = bed ? { condition_metric: bed[4]!.toLowerCase().replace(/s$/, '').replace(/\s+/g, '_') + 's',
        condition_lo: Number(bed[2]) + (/more than/i.test(bed[1] ?? '') ? 1 : 0),
        condition_hi: bed[1] || bed[3] ? null : Number(bed[2]), condition_unit: bed[4]!.toLowerCase().replace(/s$/, '') + 's' } : {}
      if (bedOwn) claimedHere.add(Number(bedOwn[2]))
      // "for a boarding room intended to be used by a single resident—12m2" / "otherwise—16m2"
      const SINGLE = /intended to be used by a single (resident|occupant)/i
      const single = SINGLE.test(tOp)
      const notSingle = /^otherwise\b/i.test(tOp) && secs.some(s => s.parent_id === p.parent_id && s.sort_order < p.sort_order && SINGLE.test(norm(s.raw_text)))
      const occCond = single ? { condition_metric: 'occupants', condition_lo: 1, condition_hi: 1, condition_unit: 'occupants' }
        : notSingle ? { condition_metric: 'occupants', condition_lo: 2, condition_hi: null, condition_unit: 'occupants' } : {}
      // "... 115m2 plus 12m2 for each bedroom in addition to 3 bedrooms" / "30m2 ... plus at least a further 2m2 for each
      // boarding room in excess of 6 boarding rooms": an increment per extra room
      const perExtra = tOp.match(/plus (?:at least )?(?:a further )?(\d+(?:\.\d+)?)\s*m2 for each (\w+(?: room)?) in (?:addition to|excess of) (\d+) \w+/i)
      // "Development consent must not be granted for the subdivision of a boarding house."
      const noSub = tOp.match(/^development consent must not be granted for the subdivision of (.+?)(?: into separate lots)?\.?$/i)
      if (noSub) {
        const zs = zonesIn(noSub[1]!)
        let r2 = target
        if (zs.length) {
          r2 = { ...base, key: `${base.key}:${p.local_id}`, local_id: p.local_id, section_id: p.id, effects: [],
            applic: [...base.applic.filter(a => a.dimension !== 'zone'), ...zs.map(z => ({ dimension: 'zone', value: z.code, polarity: 'applies' as const, span: z.span }))] }
          out.push(r2)
        }
        r2.effects.push({ effect_type: 'prohibits_use', topic: 'subdivision', comparator: null, value: null, unit: null,
          value_source: `of ${noSub[1]}`, relative_to: null, measured_from: null, span: t, claims: [] })
      }

      for (const cd of cands.filter(cd => !claimedHere.has(Number(cd.value)))) {
        // the number's topic and comparator from its own words, else from the sentence that introduces it
        // ("(b) a minimum landscaped area that is the lesser of— (i) 35m2 per dwelling")
        const ownStrong = topicStrong(tOp, cd)
        const own = ownStrong ?? topicWeak(tOp)
        // refined on the number's own phrase when the paragraph holds several (s 107(2)(f): share, dimension, rear)
        const topic0 = refineTopic(ownStrong ?? topicStrong(parentT, cd) ?? topicWeak(tOp) ?? topicWeak(parentT),
          cands.length > 1 ? phraseAround(tOp, cd.raw) : tOp)
        // a unitless number naming how many of a thing ("at least 1 private open space with minimum dimensions of 3m")
        const afterNum = tOp.slice(tOp.indexOf(String(cd.raw)) + String(cd.raw).length)
        const isCount = !cd.unit && /^\s+[a-z]/i.test(afterNum)
          && !/^\s+(per\b|percent|storeys?|hours?|m\b|metres?|dwellings?|bedrooms?|parking|beds?|employees?|boarding|private room|occupants?|adult)/i.test(afterNum)
        const topic = isCount && topic0 && topic0 !== 'parking' && !/s$/.test(topic0) ? topic0.replace(/_dimension$/, '') + '_count' : topic0
        // a parking rate with no comparator anywhere ("—0.2 parking spaces for each private room", s 68(2)(e)) is a
        // minimum - read as one and recorded
        const parkingBare = topic === 'parking' && !comparatorOf(tOp) && !comparatorOf(parentT)
        const comparator = comparatorNear(tOp, cd.raw) ?? comparatorOf(tOp) ?? (own && !/—/.test(tOp) ? null : comparatorOf(parentT))
          ?? (/\bmust be\b/i.test(t) || parkingBare ? 'gte' : null)
        if (!topic || !comparator) continue
        if (parkingBare) {
          findings.push({ kind: 'comparator_inferred', gating: false, clause: p.local_id, value: String(cd.value),
            detail: `"${t}" states no minimum/maximum; a parking rate is read as a minimum (gte)` })
        } else if (!/\bmust be\b/i.test(t) || comparatorOf(tOp) || comparatorOf(parentT)) { /* stated comparator */ } else {
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
            : cd.unit === 'sqm' && /\bfor every (bed|dwelling|bedroom|resident)\b/i.test(tOp) ? `sqm per ${tOp.match(/\bfor every (\w+)/i)![1]!.toLowerCase()}`
            : topic === 'parking' && /for each (boarding|private) room/i.test(tOp) ? `spaces per ${/boarding/i.test(tOp) ? 'boarding' : 'private'} room`
            : UNIT[cd.unit] ?? (topic === 'parking' ? 'spaces per dwelling' : cd.unit ?? null),
          value_source: /lesser of/i.test(parentT) ? 'the lesser of the listed amounts' : /greater of/i.test(parentT) ? 'the greater of the listed amounts'
            : parentT.match(/\bfor (dwellings (?:not )?used for [a-z ]+?)—/i)?.[1] ?? null,
          relative_to: increment ? `each ${perExtra![2]} in addition to ${perExtra![3]}` : null,
          measured_from: datum === 'front_boundary' ? 'front_boundary' : null, span: t,
          ...(bed ? bedCond : {}), ...occCond, ...(!bed && !single && !notSingle ? heightCond : {}),
          claims: [{ section: p.local_id, value: Number(cd.value) }, ...overClaim,
                   ...(bedOwn ? [{ section: p.local_id, value: Number(bedOwn[2]) }] : []),
                   ...(increment ? [{ section: p.local_id, value: Number(perExtra![3]) }] : [])] })
      }
      // a number read only as a condition (a heading "containing 6 boarding rooms—") is explained, not unclaimed
      for (const cd of cands) {
        const v = Number(cd.value)
        if (claimedHere.has(v) && !target.effects.some(e => e.claims.some(cl => cl.section === p.local_id && cl.value === v)))
          explained.push({ section: p.local_id, value: v })
      }
      if (qualitative) {
        const consider = upTexts.some(u => /\bconsiders? whether\b/i.test(u))
        target.effects.push({ effect_type: consider ? 'matter_for_consideration' : 'condition_of_consent',
          topic: tOp.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: null, value: null, unit: null, value_source: 'clause_text',
          relative_to: null, measured_from: null, span: t, claims: [] })
      }
      // a count in a condition of consent that is no planning standard ("owned and controlled by 1 person",
      // "operated by 1 managing agent"): recorded as the condition, with its number
      if (role === 'conditional_standard') {
        for (const cd of cands.filter(cd => !topicFor(t, cd) && !target.effects.some(e => e.claims.some(cl => cl.section === p.local_id && cl.value === Number(cd.value))))) {
          target.effects.push({ effect_type: 'condition_of_consent', topic: t.replace(/[,.;]\s*(and|or)?$/i, ''), comparator: comparatorOf(tOp) ?? 'eq',
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
  const claimed = new Set([...rules.flatMap(r => r.effects.flatMap(e => e.claims.map(cl => `${cl.section}|${cl.value}`))),
                           ...explained.map(x => `${x.section}|${x.value}`)])
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
        await client.query(`INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span, alt_group)
                            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [row.id, a.dimension, a.value, a.polarity, a.span, a.alt_group ?? null])
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
