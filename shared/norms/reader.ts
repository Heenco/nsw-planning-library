/**
 * The clause reader: an instrument's own words (nsw.section, in the graph) -> norms, for ANY instrument - every LEP and
 * SEPP alike. One rule set, no per-clause or per-council code; what it cannot read it keeps, quoted, as `unparsed`.
 *
 * A clause is read as its tree of subclauses and paragraphs:
 *   scope        "This clause applies to ..."            -> conditions on every norm of the clause
 *                "This clause does not apply to ..."     -> NOT those, on every norm
 *                "Subclause (3) does not apply to ... if—" -> NOT those, on subclause (3)'s norms
 *                "This clause applies despite clause 4.1" / "Despite clause 4.1, ..." -> despite clause 4.1
 *   statements   "consent must not be granted for/to X [if Y] [unless Z]"   -> prohibit when X and Y and not Z
 *                "consent may be granted for/to X [if Y]" / "may ... be subdivided ... with consent" -> permit
 *                "the size / area of any (each) (resulting) lot ... not less than | at least N m2 | the Lot Size Map"
 *                "the minimum lot size for X is N"                           -> a lot size standard
 *                "the (primary road) frontage of each resulting lot ... N metres"  -> a width standard
 *                "1 dwelling must / will be situated on each lot"            -> a dwellings-per-lot standard
 *                "the area of the access handle is not to be included ..."  -> how lot size is measured (shown)
 *   lists        a sentence ending "—" takes its paragraphs, joined by their own trailing "and" / "or"
 *
 * Conditions are read phrase by phrase: zones ("Zone R2 ..."), uses (on the lot - "on which a dual occupancy is
 * erected", "used ... for"; or proposed - "proposed to be", "for the purposes of"), map areas ("identified as "S" on
 * the Dual Occupancy Prohibition Map" -> the graph's own polygon for it), tenure (strata / community / Torrens), dates
 * ("before 6 July 2018"), the lot's area and frontage. FAIL CLOSED: once the recognised parts are taken out, any
 * meaningful word left over ("a corner lot", "each dwelling fronts a different road") makes the phrase `unparsed`.
 */
import type { Cond, Effect, Norm } from './schema'

export interface Section { local_id: string; raw_text: string | null; heading?: string | null; route?: string | null }
export interface ReadContext {
  instrument: string
  slug: string
  /** use names the closed Standard Instrument vocabulary recognises in a phrase */
  usesIn: (t: string) => string[]
  /** the graph's place polygons for this clause's rules: label / map layer -> rule_spatial_ref ids */
  places: { id: string; value: string; layer: string | null }[]
  /** scope_layer terms (mapped places) by lower-case term */
  terms: Set<string>
  /** the clause's containers in the instrument, from the graph's section tree: { part: 'ch.3-pt.1', chapter: 'ch.3', ... } */
  container: Record<string, string>
}
/**
 * family: 'subdivision' (read), 'other' (about other development), 'inert' (no rule of its own: not adopted / repealed,
 * an application or definition provision), 'none'. scope: where the clause reaches (its scope and whole-clause
 * exclusions) - so a clause left unread can still be ruled out for a lot it cannot reach.
 */
export interface ClauseRead { norms: Norm[]; family: 'subdivision' | 'other' | 'inert' | 'none'; unread: string[]; zones: string[] | null; scope: Cond | null }

const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()
const operative = (t: unknown) => norm(t).replace(/(^|\s)Notes?(\.|—|:)\s*[\s\S]*$/, '').trim()
const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' }
const isoDate = (d: string) => { const m = d.match(/(\d{1,2}) (\w+) (\d{4})/); return m && MONTHS[m[2]!.toLowerCase()] ? `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, '0')}` : null }
/** the first number in a string: "1,015m2" -> 1015, "740 square metres" -> 740 */
const num = (s: string) => Number((String(s).match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''))
// words a fully read phrase may still contain once its recognised parts are taken out
const FILLER = new Set(('a an the of on in to for from by with which that this is are was were be been being has have had there any each ' +
  'all following land lot lots zone zones subdivision subdivided subdivide development consent clause subclause plan ' +
  'and or other than its it as at being under act law such where if who whose their than more one two separate ' +
  'resulting result created create creating title titles dwelling dwellings erected erect proposed lawfully situated ' +
  'carried out used use purpose purposes registration scheme schemes kind involving would being located forming part ' +
  'containing contain contains comprising').split(' '))

export function readClause(sections: Section[], clauseSec: string, ctx: ReadContext): ClauseRead {
  const secs = sections.filter(s => s.local_id === clauseSec || s.local_id.startsWith(clauseSec + '-'))
  // a section routed as an aim, objective or definition (where routing ran) has no statement to read
  const text = new Map(secs.map(s => [s.local_id, s.route === 'objective' || s.route === 'definition' ? '' : operative(s.raw_text)]))
  const kids = (id: string) => secs.filter(s => s.local_id.startsWith(id + '-') && !s.local_id.slice(id.length + 1).includes('-'))
  const clauseNo = clauseSec.replace(/^sec\./, '')
  const label = (id: string) => clauseNo + id.slice(clauseSec.length).replace(/-ssec\.(\w+)/, '($1)').replace(/-para\d\.(\w+)/g, '($1)')
  const unread: string[] = []

  // ── a phrase -> a condition ────────────────────────────────────────────────────────────────────
  const phrase = (p0: string, at: string): Cond | null => {
    // "X or for a purpose other than Y": X, or an alternative the reader cannot test - never "X and not Y"
    const orOther = norm(p0).match(/^(.*?)\s+or\s+((?:for |any |a |an |other )*(?:purpose|use|development|land)\b.*?\bother than\b.+)$/i)
    if (orOther && orOther[1]!.trim()) {
      const a = phrase(orOther[1]!, at)
      return { any: [...(a ? [a] : []), { fact: 'unparsed', text: orOther[2]!.trim(), span: norm(p0) } as Cond] }
    }
    // "X other than Y": X and not Y
    const ot = norm(p0).match(/^(.*?)\bother than\b(.+)$/i)
    if (ot && ot[1]!.trim()) {
      const a = phrase(ot[1]!, at), b = phrase(ot[2]!, at)
      const parts0 = [a, b ? { not: b } as Cond : { not: { fact: 'unparsed', text: ot[2]!.trim(), span: norm(p0) } } as Cond].filter(Boolean) as Cond[]
      return parts0.length === 1 ? parts0[0]! : { all: parts0 }
    }
    let p = ' ' + norm(p0).replace(/[—;:]\s*$/, '') + ' '
    const parts: Cond[] = []
    // the kinds of subdivision a phrase names - one subdivision is one kind, so several named are alternatives
    const tenures: string[] = []
    const take = (re: RegExp) => { p = p.replace(re, ' ') }
    const span = norm(p0).replace(/[—;:]\s*$/, '')
    // boilerplate true of every proposal made now, and the clause's own scope reference
    take(/\bthat requires development consent\b/gi); take(/\b(and )?that is carried out after the commencement of this (Plan|Policy)\b/gi)
    take(/\bto which this (clause|subclause|section|Part|Division|Chapter|Plan|Policy) applies\b/gi); take(/\bin relation to (that|the) land\b/gi)
    // "(whether or not ...)" says what does not matter - no condition
    take(/\(whether or not [^)]*\)/gi)
    // land on which a use may lawfully be carried out: the use is permissible on the lot
    const perm = p.match(/\bon which (?:development )?(?:for the purposes? of )?(?:an? )?([a-z][a-z ()-]*?) may (?:lawfully )?be (?:lawfully )?carried out\b/i)
    if (perm && ctx.usesIn(perm[1]!).length) { parts.push({ fact: 'lot.permits', value: ctx.usesIn(perm[1]!)[0], span }); take(new RegExp(perm[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) }
    // a subdivision for lease purposes (Local Government Act 1919, s 289K) - its own kind, not Torrens / strata / community
    if (/\bfor lease purposes\b/i.test(p)) { tenures.push('lease'); take(/\bfor lease purposes\b/gi); take(/\bunder section 289K of the Local Government Act 1919\b/gi) }
    if (/\bshown on the Lot Size Map\b/i.test(p) && !/\bminimum\b/i.test(p)) { parts.push({ fact: 'lot.on_map', value: 'lot_size_map', span }); take(/\b(land )?shown on the Lot Size Map\b/gi) }
    // each resulting lot at least N / the Lot Size Map minimum - a condition on the proposal, tested with the lot's area
    const rls = p.match(/\b(?:size|area) of each (?:of the \d+ )?resulting lots? is not less than (the minimum (?:lot )?size shown[^,.]*?Lot Size Map|[\d,.]+ ?(?:m2|square metres))/i)
      ?? p.match(/\beach resulting lot (?:will|must) have (?:a lot size|an area) of at least ([\d,.]+ ?(?:m2|square metres))/i)
    if (rls) { parts.push(/Lot Size Map/i.test(rls[1]!) ? { fact: 'proposal.resulting_lot_size', cmp: 'gte', n: 0, text: 'lot_size_map', span } : { fact: 'proposal.resulting_lot_size', cmp: 'gte', n: num(rls[1]!), span }); take(new RegExp(rls[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) }
    // development carried out (or to be) under this Part / Chapter / Division of the instrument
    const under = p.match(/\b(?:development|land|a building)\b[^.]*?\b(has been|is|was|will be) carried out under this (Part|Chapter|Division)\b/i)
    if (under) {
      const box = ctx.container[under[2]!.toLowerCase()]
      const ref = box ? `${ctx.slug}:${box}` : null
      parts.push(!ref ? { fact: 'unparsed', text: under[0], span } : /will be/i.test(under[1]!) ? { fact: 'proposal.under', value: ref, span } : { fact: 'site.has', value: 'development', under: ref, span })
      take(/\b(a lot|land|a building)?\s*(on which|resulting from)?\s*development\b[^.]*?\b(has been|is|was|will be) carried out under this (Part|Chapter|Division)\b/gi)
    }
    // each dwelling of a use put on its own lot: the subdivision is for that use, one dwelling per lot
    const sep = p.match(/\b(?:(?:the )?subdivision would result in )?each (?:of the )?dwellings? (?:forming part of|comprising) the ([a-z][a-z ()]*?) (?:being )?(?:located|situated) on (?:a )?separate lots?/i)
      ?? p.match(/\bto create separate titles for each of the dwellings comprising the ([a-z][a-z ()]*[a-z)])/i)
      ?? p.match(/\beach lot resulting from the subdivision will contain a dwelling forming part of the ([a-z][a-z ()]*[a-z)])/i)
    if (sep) { const u = ctx.usesIn(sep[1]!); if (u.length) { parts.push({ fact: 'proposal.use', value: u[0], span }); take(new RegExp(sep[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) } }
    if (/\bprincipal dwelling and the secondary dwelling being situated on separate lots\b/i.test(p)) { parts.push({ fact: 'proposal.separates', value: 'principal dwelling|secondary dwelling', span }); take(/\b(would )?result in the principal dwelling and the secondary dwelling being situated on separate lots\b/gi) }
    // places the graph's term layer maps (low and mid rise housing area, heritage conservation area, ...)
    for (const t of [...ctx.terms].sort((a, b) => b.length - a.length)) {
      if (t.length < 8 || !p.toLowerCase().includes(t)) continue
      parts.push({ fact: 'lot.in', value: t, span })
      p = p.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    }
    // map areas: the graph's own polygon for the place the words name
    for (const m of [...p.matchAll(/(?:identified|shown|marked)(?: [a-z ]+?)? as [“"]?([^”"]+?)[”"]? on the ([A-Z][\w’' -]*? Map)\b/g)]) {
      const lab = m[1]!.trim().toLowerCase(), map = m[2]!.replace(/ Map$/, '').toLowerCase()
      const hits = ctx.places.filter(x => x.value.toLowerCase() === lab || (x.layer ?? '').toLowerCase() === map && x.value.toLowerCase().includes(lab))
      parts.push(hits.length ? { any: hits.map(h => ({ fact: 'lot.on_ref', value: h.id, text: `${m[1]} on the ${m[2]}`, span } as Cond)) }
        : ctx.terms.has(lab) ? { fact: 'lot.in', value: lab, span } : { fact: 'unparsed', text: `${m[1]} on the ${m[2]} (no polygon in the graph)`, span })
      take(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    // zones
    const zones = [...p.matchAll(/\bZones? ([A-Z]{1,2}\d{0,2}[A-Z]?)\b(?: (?:[A-Z][a-z]+|and|or|,)+)?/g)].map(m => m[1]!)
    const zoneList = [...p.matchAll(/\b(?:Zones|and|or|,) ([A-Z]{1,2}\d{0,2}[A-Z]?)\b/g)].map(m => m[1]!).filter(z => /\d/.test(z))
    const allZones = [...new Set([...zones, ...zoneList])]
    if (allZones.length) { parts.push(allZones.length === 1 ? { fact: 'lot.zone', value: allZones[0], span } : { any: allZones.map(z => ({ fact: 'lot.zone', value: z, span } as Cond)) })
      take(/\bZones? [A-Z]{1,2}\d{0,2}[A-Z]?\b( [A-Z][a-z]+)*/g); take(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\b( [A-Z][a-z]+)*/g) }
    // tenure
    if (/\bstrata (plan|subdivision|scheme)|Strata Schemes/i.test(p)) { tenures.push('strata'); take(/\b(strata plan( of subdivision)?|strata subdivision|strata (plan )?schemes?|Strata Schemes [\w ()]*?Act \d{4})\b/gi) }
    if (/Community Land Development Act|community title/i.test(p)) { tenures.push('community'); take(/\b(Community Land Development Act \d{4}|community title( schemes?)?)\b/gi) }
    if (/\bTorrens title\b/i.test(p)) { tenures.push('torrens'); take(/\bTorrens title\b/gi) }
    if (tenures.length) { const ls = tenures.map(v => ({ fact: 'proposal.subdivision_type', value: v, span } as Cond)); parts.push(ls.length === 1 ? ls[0]! : { any: ls }) }
    // dates: an existing use approved before / on or after a date
    const before = p.match(/\b(?:granted|approved|erected|commenced)\b[^.]*?\bbefore (\d{1,2} \w+ \d{4})/i), after = p.match(/\bon or after (\d{1,2} \w+ \d{4})/i)
    const usesHere = ctx.usesIn(p)
    if (before && isoDate(before[1]!)) { parts.push({ fact: 'site.consent_before', value: usesHere[0] ?? 'development', text: isoDate(before[1]!)!, span }); take(/\bbefore \d{1,2} \w+ \d{4}/gi) }
    if (after && isoDate(after[1]!)) { parts.push({ fact: 'site.consent_on_or_after', value: usesHere[0] ?? 'development', text: isoDate(after[1]!)!, span }); take(/\bon or after \d{1,2} \w+ \d{4}/gi) }
    // the lot's own area and frontage
    const area = p.match(/\b(?:area of the lot is|lot (?:that )?is|lot has an area of) (?:at least|not less than) ([\d,.]+)\s*(?:m2|square metres)/i)
    if (area) { parts.push({ fact: 'lot.area_m2', cmp: 'gte', n: num(area[1]!), span }); take(/\b(area of the lot is|lot (that )?is|lot has an area of) (at least|not less than) [\d,.]+\s*(m2|square metres)/gi) }
    const front = p.match(/\bfrontage of the lot\b[^.]*?\b(?:at least|equal to or greater than|not less than) ([\d.]+) ?(?:m|metres)\b/i)
    if (front) { parts.push({ fact: 'lot.frontage_m', cmp: 'gte', n: num(front[1]!), span }); take(/\b(primary road )?frontage of the lot\b[^.]*?\b(at least|equal to or greater than|not less than) [\d.]+ ?(m|metres)\b/gi) }
    // uses: on the lot already, or proposed
    if (usesHere.length && !(before || after)) {
      const onLot = /\bthere is an? \b|\bon which (?:there is|a|an)\b|\b(?:is|was|has been|were) (?:lawfully )?(?:erected|situated|carried out)\b|\bcontain(?:s|ing)?\b|\bused\b(?!.*proposed)/i.test(p)
      const proposed = /\bproposed\b|\bfor the purposes? of\b|\bto be erected\b/i.test(p)
      for (const u of usesHere) {
        const leaves: Cond[] = []
        if (onLot || !proposed) leaves.push({ fact: 'site.has', value: u, span })
        if (proposed) leaves.push({ fact: 'proposal.use', value: u, span })
        parts.push(leaves.length === 1 ? leaves[0]! : { any: leaves })
      }
      const words = usesHere.flatMap(u => [u, u.replace(/y$/, 'ies'), u + 's', u + 'es']).sort((a, b) => b.length - a.length)
      for (const w of words) take(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(\\s*\\((attached|detached)\\))?`, 'gi'))
    }
    // fail closed: a meaningful word left over makes the whole phrase unread
    const left = p.toLowerCase().replace(/[^a-z’' -]/g, ' ').split(/\s+/).filter(w => w && !FILLER.has(w.replace(/[’']s$/, '')) && w.length > 2)
    if (left.length) return parts.length ? { all: [...parts, { fact: 'unparsed', text: span, span }] } : { fact: 'unparsed', text: span, span }
    return parts.length ? (parts.length === 1 ? parts[0]! : { all: parts }) : null
  }
  // a sentence ending "—" with its paragraphs, joined by their own "and" / "or"
  const withKids = (id: string, head: string): Cond | null => {
    const own = phrase(head, id)
    const ks = kids(id).filter(k => text.get(k.local_id))
    if (!/—\s*$/.test(head) || !ks.length) return own
    const items = ks.map(k => { const t = text.get(k.local_id)!; return withKids(k.local_id, t.replace(/,?\s*(and|or)\s*$/i, '').replace(/[,.;]\s*$/, '')) ?? null })
    const zoneOnly = (c: Cond | null): boolean => !!c && ('fact' in c ? c.fact === 'lot.zone' : 'any' in c ? c.any.every(zoneOnly) : false)
    const said = ks.slice(0, -1).map(k => /\bor\s*$/i.test(text.get(k.local_id)!) ? 'or' : /\band\s*$/i.test(text.get(k.local_id)!) ? 'and' : '')
    const joiner = said.includes('or') || (!said.includes('and') && items.every(zoneOnly)) ? 'any' : 'all'
    const list = items.filter(Boolean) as Cond[]
    if (list.length < items.length) list.push({ fact: 'unparsed', text: `a paragraph of ${label(id)}`, span: head })
    const joined: Cond = joiner === 'any' ? { any: list } : { all: list }
    return own ? { all: [own, joined] } : joined
  }

  // ── scope, exclusions, despite ────────────────────────────────────────────────────────────────
  const scope: Cond[] = []
  const exclusions: { target: string | null; cond: Cond }[] = []
  const despiteAll: string[] = []
  const despiteOf = (s: string) => {
    const out: string[] = []
    if (/\bany other provision of this (Plan|Policy|instrument)\b/i.test(s)) out.push('instrument:*')
    if (/\b(the provisions of )?(another|any other) environmental planning instrument\b/i.test(s)) out.push('doc_type:lep')
    for (const m of s.matchAll(/\b(?:clauses?|sections?|subclauses?)\s+((?:[\d.]+[A-Z]*(?:\(\w+\))*(?:,\s*|\s+and\s+|\s+or\s+)?)+)/gi))
      for (const c of m[1]!.split(/,\s*|\s+and\s+|\s+or\s+/).map(x => x.trim()).filter(Boolean)) out.push(`clause:${c.replace(/\(.*$/, '')}`)
    return out
  }
  for (const s of secs) {
    const t = text.get(s.local_id) ?? ''
    const sc = t.match(/^This (?:clause|subclause|section) applies (?:only )?(?:to|if) (.+)$/i)
    if (sc && !/^This (clause|subclause|section) applies despite\b/i.test(t)) { const c = withKids(s.local_id, sc[1]!); if (c) scope.push(c) }
    const ad = t.match(/^This (?:clause|section) applies despite (.+)$/i)
    if (ad) despiteAll.push(...despiteOf(ad[1]!))
    const ex = t.match(/^This (?:clause|subclause|section) does not apply (?:in relation )?to (.+)$/i)
    if (ex) { const c = withKids(s.local_id, ex[1]!); if (c) exclusions.push({ target: null, cond: c }) }
    const ex2 = t.match(/^(?:Subclause|Clause|Section) \(?([\w.]+)\)? does not apply to (.+)$/i)
    if (ex2) { const c = withKids(s.local_id, ex2[2]!); if (c) exclusions.push({ target: ex2[1]!, cond: c }) }
    // "This Part does not allow the subdivision of land within a Crown reserve": the clause's permission stops there
    const na = t.match(/^This (?:Part|Division|Chapter|clause|section) does not (?:allow|permit|authorise) (?:the )?subdivision of (.+?)\.?$/i)
    if (na) { const c = withKids(s.local_id, na[1]!); if (c) exclusions.push({ target: null, cond: c }) }
  }

  // ── statements ─────────────────────────────────────────────────────────────────────────────────
  const norms: Norm[] = []
  let family: ClauseRead['family'] = 'none'
  const add = (s: Section, then: Effect, when: Cond[], despite: string[], tag = '') => {
    const id = `${ctx.slug}:read:${s.local_id}${tag}`
    const sub = s.local_id.match(new RegExp(`^${clauseSec.replace(/\./g, '\\.')}-ssec\\.(\\w+)`))?.[1] ?? null
    const ex = exclusions.filter(e => e.target === null || (sub && e.target.replace(/[()]/g, '') === sub)).map(e => ({ not: e.cond } as Cond))
    norms.push({ id, instrument: ctx.instrument, clause: label(s.local_id), section: s.local_id, text: '', when: { all: [...scope, ...when, ...ex] },
      then, despite: [...new Set([...despite, ...despiteAll])], author: { by: 'clause reader (shared/norms/reader.ts)', at: '' } })
  }
  const SUBJ0 = /\b(subdivi\w+|resulting lot|lot resulting|minimum (?:subdivision )?lot size)\b/i
  const scopeIsSubdivision = secs.some(s => /^This (clause|subclause|section) applies\b/i.test(text.get(s.local_id) ?? '') && SUBJ0.test(text.get(s.local_id) ?? ''))
  const SUBJ = { test: (x: string) => SUBJ0.test(x) || (scopeIsSubdivision && /\bdevelopment to which this (section|clause) applies\b/i.test(x)) }
  // statements that state no rule of their own: aims, definitions, scope (read above), a clause not adopted or repealed,
  // where a Part / Division applies (the graph's frames hold that), other provisions applied to it, and when consent may
  // be granted (timing, not a permission)
  const NOT_A_RULE = [
    /^(The objectives?|In this (clause|section)|This (clause|subclause|section) (applies|does not apply)|(Subclause|Clause|Section) \(?[\w.]+\)? does not apply)\b/i,
    /^[[(]?(not applicable|not adopted|repealed)[\])]?\.?$/i,
    /^This (Part|Division|Subdivision|Chapter|Schedule|Plan|Policy) (also )?(applies|does not apply)\b/i,
    /^This (Part|Division|Chapter|clause|section) does not (allow|permit|authorise) (the )?subdivision of\b/i,
    /^[^.]*?\b(sections?|clauses?) [\d.]+[A-Z]*(?:(?:,\s*| and | or )[\d.]+[A-Z]*)* (also )?apply to\b/i,
    /^(development )?consent for .+? may be granted at any time\b/i,
  ]
  let rules = 0
  // a statement of the clause itself or one of its subclauses, not a paragraph - measured from the clause's own id, which
  // has dashes of its own in a schedule ('sch.1-sec.13')
  const top = (id: string) => id.slice(clauseSec.length).split('-').length <= 2
  // the subject of the last permission - what "such a subdivision" / "such a development consent" refers back to
  let lastSubj: Cond[] = []
  for (const s of secs) {
    const t0 = text.get(s.local_id) ?? ''
    // "Clause 4.1 does not apply to the subdivision of ... if ...": another clause displaced - a rule, not this clause's scope
    if (/^(?:Clause|Section)s? \d[\w.]*(?:(?:,\s*| and | or )\d[\w.]*)* does not apply\b/i.test(t0)) {
      if (top(s.local_id)) { rules++; if (SUBJ.test(t0)) unread.push(label(s.local_id)) }
      continue
    }
    if (!t0 || NOT_A_RULE.some(re => re.test(t0))) continue
    if (top(s.local_id)) rules++
    // "Despite clauses 4.1, 4.1AA and 4.1A, development consent ...": the lead-in runs to the comma before the statement
    const lead = t0.match(/^Despite (.+?),\s+(?=(?:development|the|a|an|land|consent|each|any|subdivision)\b)/i)
    const despite = lead ? despiteOf(lead[1]!) : []
    const t = lead ? t0.slice(lead[0].length) : t0
    const sp = { fact: 'proposal.kind', value: 'subdivision', span: t0 } as Cond
    // must not be granted ... [if ...] [unless ...]
    const ban = t.match(/^(?:development )?consent must not be granted (?:for|to) (.+?)(?: unless (.*))?$/i)
      ?? t.match(/^(?:a|the) (?:council|consent authority) must not grant (?:a )?(?:development )?consent (?:for|to) (.+?)(?: unless (.*))?$/i)
      // "A Council must not grant such a development consent unless ...": the consent the clause has just permitted
      ?? t.match(/^(?:a|the) (?:council|consent authority) must not grant (such (?:a )?(?:development )?consent)(?: unless (.*))?\.?$/i)
    if (ban) {
      const such = /^such\b/i.test(ban[1]!)
      if (!such && !SUBJ.test(ban[1]!)) { family = family === 'none' ? 'other' : family; continue }
      family = 'subdivision'
      // "such a subdivision if ..." - the subject is the last permission's, the rest a condition
      const [, subjText, ifText] = ban[1]!.match(/^(.+?)(?: if (.+))?$/i) ?? [, ban[1]!, undefined]
      const subj = such ? null : phrase(subjText!.replace(/\bthe subdivision of\b/i, ''), s.local_id)
      const ifc = ifText ? phrase(ifText, s.local_id) : null
      const unlessText = ban[2] ?? (/unless—\s*$/.test(t) ? '' : null)
      const unless = unlessText === null ? null : /—\s*$/.test(t) ? withKids(s.local_id, unlessText || '—') : phrase(unlessText, s.local_id)
      add(s, { prohibit: true }, [sp, ...(such ? lastSubj : subj ? [subj] : []), ...(ifc ? [ifc] : []), ...(unless ? [{ not: unless } as Cond] : [])], despite)
      continue
    }
    // "Any prohibition or restriction on the subdivision of land imposed by any other environmental planning instrument
    // ... does not apply to such a subdivision": the clause's permissions apply despite those instruments
    const over = t.match(/^Any (?:prohibition|restriction)(?: or (?:prohibition|restriction))? on (?:the )?subdivision of land imposed by (.+?) does not apply to\b/i)
    if (over) {
      const d = despiteOf(over[1]!)
      for (const n of norms) if ('permit' in n.then) n.despite = [...new Set([...(n.despite ?? []), ...d])]
      if (d.length) { family = 'subdivision'; continue }
    }
    // may be granted ... [if ...] / may ... be subdivided ... with consent
    const grant = t.match(/^(?:development )?consent may be granted (?:for|to) (.+?)(?: if(?: (.*))?)?$/i)
      // "The strata subdivision of land on which ... is permitted with development consent [if ...]"; "... may be carried out
      // [only] with development consent"
      ?? t.match(/^(.+?) (?:is|are) permitted with (?:development )?consent(?: if(?: (.*))?)?\.?$/i)
      ?? t.match(/^(.+?) may be carried out (?:only )?with (?:development )?consent(?: if(?: (.*))?)?\.?$/i)
    // "X may, with development consent, be subdivided"; "X may be subdivided [for Y][,] [but] only with the development
    // consent of the council"; "X may be subdivided— only with ..." followed by the ways it may be (its paragraphs)
    const sm = t.match(/^(.*?)\bmay(?:, with development consent,)? be subdivided\b(—)?(.*)$/i)
    const subd = !!sm && /\bwith (?:the )?(?:development )?consent\b/i.test(t)
    if (grant || subd) {
      // what follows "subdivided" (other than the consent words) still describes the subdivision - kept, never dropped
      const rest = sm ? sm[3]!.replace(/,?\s*(?:but )?only with (?:the )?(?:development )?consent(?: of the (?:council|consent authority))?\.?/i, '').replace(/^[,\s]+|[,.\s]+$/g, '') : ''
      const subj = grant ? grant[1]! : `${sm![1]} ${rest}`
      if (grant && !SUBJ.test(subj)) { family = family === 'none' ? 'other' : family; continue }
      family = 'subdivision'
      const ifc = grant && /\bif—\s*$/.test(t) ? withKids(s.local_id, '—') : grant?.[2] ? phrase(grant[2], s.local_id) : sm?.[2] ? withKids(s.local_id, '—') : null
      const sub = phrase(subj.replace(/\bthe subdivision of\b|\bto subdivide\b/gi, ''), s.local_id)
      lastSubj = [...(sub ? [sub] : []), ...(ifc ? [ifc] : [])]
      add(s, { permit: 'with_consent' }, [sp, ...lastSubj], despite)
      continue
    }
    // standards
    const size = t.match(/\b(?:size|area) of (?:any|each|every)(?: of the \d+)? (?:resulting )?lot\b.*?\b(?:not (?:to )?be less than|must not be less than|at least|equal to or greater than|must have an area of at least)\s+(the minimum (?:lot )?size shown[^.,]*?Lot Size Map|[\d,.]+\s*(?:m2|square metres|hectares|ha))/i)
      ?? t.match(/\bminimum (?:subdivision )?lot size for (.+?) is ([\d,.]+\s*(?:m2|square metres|hectares|ha))/i)
      ?? t.match(/\beach resulting lot must have an area of at least ([\d,.]+\s*(?:m2|square metres|hectares|ha))/i)
    if (size && SUBJ.test(t)) {
      family = 'subdivision'
      const v = size[size.length - 1]!
      const req: Effect = /Lot Size Map/i.test(v) ? { require: { topic: 'resulting_lot_size', cmp: 'gte', from: 'lot_size_map', unit: 'm²', kind: 'development_standard' } }
        : { require: { topic: 'resulting_lot_size', cmp: 'gte', n: num(v) * (/ha|hectare/i.test(v) ? 10000 : 1), unit: 'm²', kind: 'development_standard' } }
      const subj = size.length === 3 && /minimum/i.test(size[0]!) ? phrase(size[1]!, s.local_id) : phrase(t.replace(size[0]!, ''), s.local_id)
      add(s, req, [sp, ...(subj ? [subj] : [])], despite)
      continue
    }
    const width = t.match(/\bfrontage of each (?:resulting )?lot\b[^.]*?\b(?:at least|equal to or greater than|not less than) ([\d.]+) ?(?:m|metres)\b/i)
      ?? t.match(/\beach resulting lot (?:must|will) be (?:at least )?([\d.]+) ?m wide\b/i)
    if (width) { family = 'subdivision'; add(s, { require: { topic: 'resulting_lot_width', cmp: 'gte', n: num(width[1]!), unit: 'm', kind: 'development_standard' } }, [sp], despite); continue }
    const dwell = t.match(/^(1|one) dwelling (?:must|will) be situated on each lot\b/i) ?? t.match(/\beach resulting lot (?:must|will) contain no more than (1|one) dwelling\b/i)
    if (dwell) { family = 'subdivision'; add(s, { require: { topic: 'dwellings_per_resulting_lot', cmp: 'lte', n: 1, unit: 'dwelling', kind: 'development_standard' } }, [sp], despite); continue }
    if (/\baccess handle\b.*\bnot (?:to )?be included\b/i.test(t)) { add(s, { require: { topic: 'graph_standard', cmp: 'eq', unit: 'an access handle is not counted in the lot size', kind: 'condition' } }, [sp], despite); continue }
    // a statement the reader does not recognise - kept as unread (only if it is not a paragraph of something read)
    const parentRead = norms.some(n => s.local_id.startsWith(n.section + '-'))
    if (!parentRead && top(s.local_id) && SUBJ.test(t)) unread.push(label(s.local_id))
  }
  // the zones the clause's own scope names (not under a NOT) - so a lot in another zone is told it does not reach it
  const zl = (c: Cond, neg = false): string[] => 'all' in c ? c.all.flatMap(x => zl(x, neg)) : 'any' in c ? c.any.flatMap(x => zl(x, neg))
    : 'not' in c ? zl(c.not, !neg) : c.fact === 'lot.zone' && !neg ? [String(c.value)] : []
  const zones = [...new Set(scope.flatMap(c => zl(c)))]
  // nothing read and nothing unread: a clause with no rule of its own, or one whose scope is other development
  // ("This section applies to development for the purposes of residential flat buildings ...")
  if (!norms.length && !unread.length) {
    if (!rules && secs.some(s => text.get(s.local_id))) family = 'inert'
    else if (secs.some(s => { const m = (text.get(s.local_id) ?? '').match(/^This (?:clause|section) applies (?:only )?to development for the purposes? of (.+)$/i); return !!m && !SUBJ0.test(m[1]!) })) family = 'other'
  }
  const whole = [...scope, ...exclusions.filter(e => e.target === null).map(e => ({ not: e.cond } as Cond))]
  return { norms, family, unread, zones: zones.length ? zones : null, scope: whole.length ? (whole.length === 1 ? whole[0]! : { all: whole }) : null }
}
