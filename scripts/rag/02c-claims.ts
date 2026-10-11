/**
 * RAG pilot - the rag engine's own claims (rag.claim), read from the instrument text in rag.provision. No pilot table
 * is read. Plan shared/rag-plan.ts; the evaluator that uses them is shared/rag/evaluate.ts.
 *
 *   npx tsx scripts/rag/02c-claims.ts [--dry]
 *
 * Readers - each a drafting pattern of NSW instruments, none naming a clause:
 *   land use table   nsw.lep_permissibility (the resolved Land Use Tables, also behind /testing-spatial-services):
 *                    one permit / prohibit claim per zone x use, anchored on the zone's item in rag
 *   frames           every applies_only_if relation (02-relations.ts): "This Part applies to development for the
 *                    purposes of a secondary dwelling on land in a residential zone if development for the purposes of
 *                    a dwelling house is permissible on the land under another environmental planning instrument" ->
 *                    uses, zones (a defined term that lists zones is expanded), scope terms, sub-questions, exclusions
 *   permissions      "Development for the purposes of X is permitted with (development) consent ... in Zone R2" and
 *                    "Development to which this Part applies may be carried out with consent" (inherits the frame)
 *   consent bars     "Development consent must not be granted ... unless-": a figure in it is a standard (4.1C's
 *                    550 m2); with no figure and no "unless" it is a prohibition of the uses on the land it names
 *                    (Parramatta 6.11(1): dual occupancies on "D" on the Dual Occupancy Prohibition Map); "unless the
 *                    land- (a) ..., or (b) ..." is a prohibition the listed land lifts (each item an exclusion); any
 *                    other list under it is a set of conditions (limitations), each with its figures and any
 *                    cross-reference to another instrument read as a sub-question. On named uses ("... for the erection
 *                    of a dual occupancy unless- (a) ..., (c) the area of the lot ... is at least 450 square metres"):
 *                    a figure on the lot's area or frontage is a standard on the lot ('consent standard'), "attached
 *                    by at least" bars the detached kind, and the rest is a condition on the proposal or the consent
 *                    authority's judgement ('consent condition' - the use stays permissible, subject to it); a nested
 *                    list of lot sizes by place and use (Hornsby 4.1C) is a standard per leaf
 *   lot tables       "Development for a purpose specified in the table ... may be carried out on a lot in a zone
 *                    specified opposite if- (a) the area of the lot is at least 600m2" (Parramatta 4.1C): row x figure
 *   exceptions       "Subclause (3) does not apply ... unless each lot resulting from the subdivision will- be at least
 *                    507.5m2": the subclause's subdivision minimum, claimed on it so its "Despite clause 4.1" applies;
 *                    "Subclause (2) does not apply to land identified as "Area 3" on the Lot Size Map" excludes the area
 *   standards        a figure with a topic ("a maximum floor space ratio of 0.65:1"), a map rule ("shown for the land
 *                    on the Height of Buildings Map"), a "the maximum height of X on land in Zone R3 is 9.5 metres"
 *                    sentence, and every row of a control table (captions -> use, zone, lot-size band, figure)
 */
import 'dotenv/config'
import pg from 'pg'
import { landUseKey } from '../../shared/land-use-key'

const DRY = process.argv.includes('--dry')
interface P { id: string; document_id: string; parent_id: string | null; local_id: string; kind: string; heading: string | null; own_text: string; sort: number; ordinal: number | null; path: string[]; connective?: string | null }
interface Claim { provision_id: string; kind: string; consent?: string | null; uses?: string[]; zones?: string[]; terms?: string[]; excludes?: string[]; requires?: any[]
  topic?: string | null; comparator?: string | null; value?: number | null; unit?: string | null; value_source?: string | null; band?: any; non_discretionary?: boolean
  unit_provision?: string | null; source: string; span?: string | null; reader: string }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
// "Zone R2", and a list "Zones RU1, RU2, RU4 or RU6" / "Zones R1, R2, R3, R4 and RU5"
const ZONE = /\bZones?\s+((?:[A-Z]{1,2}\d{1,2}[A-Z]?)(?:(?:,\s*|\s+(?:and|or)\s+)[A-Z]{1,2}\d{1,2}[A-Z]?)*)\b/g
const zoneCodes = (t: string) => [...new Set([...t.matchAll(ZONE)].flatMap(m => m[1]!.split(/,\s*|\s+(?:and|or)\s+/)))]

/** what a figure is about. The first group are the questions the pilot asks by name; the rest are the measures the
 *  complying development codes set in their tables ("Minimum setback from each side boundary", "Maximum length of built to
 *  boundary wall", "Minimum landscaped area", "Maximum GFA"), each its own topic so a question can ask for it */
function topicOf(t: string): string | null {
  const s = t.toLowerCase()
  if (/floor space ratio/.test(s)) return 'fsr'
  if (/built to boundary|built-to-boundary/.test(s)) return /height/.test(s) ? 'btb_height' : 'btb_length'
  if (/setback/.test(s)) return /primary road|front/.test(s) ? 'setback_primary' : /secondary road/.test(s) ? 'setback_secondary' : /parallel road|lane\b/.test(s) ? 'setback_parallel' : /rear/.test(s) ? (/side/.test(s) ? 'setback_side_rear' : 'setback_rear') : /side/.test(s) ? 'setback_side' : /boundary/.test(s) ? 'setback_boundary' : 'setback'
  if (/garage door/.test(s)) return 'garage_door_width'
  if (/basement/.test(s)) return 'basement_area'
  if (/site coverage/.test(s)) return 'site_coverage'
  if (/footprint/.test(s)) return 'footprint'
  if (/private open space/.test(s)) return 'private_open_space'
  if (/height/.test(s)) return 'height'
  if (/\bwide\b|width|frontage/.test(s)) return 'lot_width'
  if (/lot size|site area|area of (the|each|any) (resulting )?lot|lot must have an area|size of (any|each) lot|(?<!floor )area of at least|\b(lot|site) (that )?(is|will be) at least\b/.test(s)) return 'lot_size'
  if (/floor area|\bgfa\b/.test(s)) return 'floor_area'
  if (/parking|car space/.test(s)) return 'parking'
  if (/landscap/.test(s)) return 'landscaping'
  if (/storeys?\b/.test(s)) return 'storeys'
  return null
}
/** "a maximum ... of 0.65:1" / "no more than 60m2" / "at least 225m2" / "9.5 metres" / "900mm" (0.9 m) / "60% of lot area" */
function figureOf(t: string): { comparator: string | null; value: number; unit: string } | null {
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(:1|m2|m²|square metres|metres|mm\b|m\b|%|spaces?|storeys?)/i); if (!m) return null
  const mm = /^mm$/i.test(m[2]!)
  const unit = /:1/.test(m[2]!) ? 'ratio' : /m2|m²|square/i.test(m[2]!) ? 'm2' : /metres|^mm?$/i.test(m[2]!) ? 'm' : m[2]!.toLowerCase()
  const comparator = /maximum|no more than|not (?:be |to be )?more than|not (?:to )?exceed|must not exceed|up to/i.test(t) ? 'max'
    : /minimum|at least|not (?:be |to be )?less than|no less than/i.test(t) ? 'min' : null
  const value = Number(m[1]!.replace(/,/g, ''))
  return { comparator, value: mm ? value / 1000 : value, unit }
}
/**
 * A table cell's value as the codes write it: "900mm", "8.5m", "60% of lot area", "25% of lot area + 150" (a floor area from
 * the lot's area), "20m or 50% of the depth of the lot, whichever is the lesser" (a setback capped by the lot's depth).
 * The share forms keep the base they are a share of, and the figure the lot gives is worked out when the lot is known.
 */
function cellValue(v: string): { value: number | null; unit: string; comparator: string | null; band: any } | null {
  const s = v.replace(/\s+/g, ' ').trim()
  let m = s.match(/^(\d[\d,.]*)\s*% of (?:the )?(lot area|site area|area of the (?:lot|landholding)|landholding area|parent lot area)(?: \+ (\d[\d,.]*))?/i)
  if (m) return { value: Number(m[1]!.replace(/,/g, '')), unit: '%', comparator: null, band: { relative: 'lot area', add: m[3] ? Number(m[3].replace(/,/g, '')) : null } }
  m = s.match(/^(\d[\d,.]*)\s*(m|mm)\s+or\s+(\d[\d,.]*)\s*% of the depth of the lot, whichever is the (lesser|greater)/i)
  if (m) return { value: Number(m[1]!.replace(/,/g, '')) / (m[2]!.toLowerCase() === 'mm' ? 1000 : 1), unit: 'm', comparator: null, band: { pick: m[4]!.toLowerCase(), relative: 'depth of the lot', pct: Number(m[3]!.replace(/,/g, '')) } }
  const f = figureOf(s); if (!f) return null
  return { value: f.value, unit: f.unit, comparator: f.comparator, band: null }
}
/** "dual occupancies or semi-detached dwellings", "a secondary dwelling", "multi dwelling housing or attached dwellings" */
/**
 * Land described by its lots: "Lot 1, DP 219220", "Lots 1798 and 1799, DP 822244", "Lots 4684–4686, DP 752015",
 * "Lot 1, Section 2, DP 719", "Part of Lot 7020, DP 1058523", "SP 2004". Returns lot ids as cadastre writes them
 * (lot/section/DPnnn); a part of a lot is marked "~" (only part of it is the described land); a strata plan is "SP2004".
 */
function lotsIn(text: string): string[] {
  const out: string[] = []
  const t = text.replace(/[–—]/g, '-')
  for (const m of t.matchAll(/\b(Part of )?Lots? ((?:[\w]+(?:-[\w]+)?)(?:(?:,\s*|\s+and\s+)[\w]+(?:-[\w]+)?)*),?\s*(?:Section (\w+),?\s*)?D\.?P\.?\s*(\d+)/gi)) {
    const nums: string[] = []
    for (const tok of m[2]!.split(/,\s*|\s+and\s+/)) {
      const r = tok.match(/^(\d+)-(\d+)$/)
      if (r && Number(r[2]) - Number(r[1]) < 200) for (let n = Number(r[1]); n <= Number(r[2]); n++) nums.push(String(n))
      else if (tok && !/^section$/i.test(tok)) nums.push(tok)
    }
    for (const n of nums) out.push(`${m[1] ? '~' : ''}${n}/${m[3] ?? ''}/DP${m[4]}`)
  }
  // a strata plan, not a zone: "Zone SP2 Infrastructure", "Zones SP1, SP2 and SP3" are the Standard Instrument's special
  // purpose zones (one digit, after "Zone" or before the zone's name)
  for (const m of t.matchAll(/(?<!\bZones?\s+(?:[A-Z]{1,3}\d{1,2}[A-Z]?(?:,\s*|\s+(?:and|or)\s+))*)\bSP\s*(\d+)(?!\d)(?!\s+(?:[A-Z][a-z]+|Zone))/g)) out.push(`SP${m[1]}`)
  return [...new Set(out)]
}

/** the Standard Instrument land uses (the resolved Land Use Tables' vocabulary), longest first - loaded in main() */
let VOCAB: string[] = []
/**
 * "an animal boarding or training establishment, a stock and sale yard, a veterinary hospital and a function centre" ->
 * the land uses it names. Known terms are matched whole first (so "or" / "and" inside a term - "animal boarding or
 * training establishment", "food and drink premises" - do not split it); what is left is split on commas / and / or.
 */
const usesOf = (phrase: string) => {
  let rest = ` ${landUseKey(norm(phrase).replace(/\b(a|an|the)\s+/gi, ' '))} `
  const found: string[] = []
  for (const v of VOCAB) {
    const re = new RegExp(`(^|[\\s,;(])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,;)])`)
    if (re.test(rest)) { found.push(v); rest = rest.replace(re, '$1 ') }
  }
  const left = rest.split(/,\s*|\s+or\s+|\s+and\s+/).map(u => u.trim()).filter(u => u && u.length > 2 && u.length < 60 && !/\bzone\b|\bland\b|related to|^(other|such)\b/.test(u))
  const words = left.filter(u => !/^(and|or|a|an|the)$/.test(u))
  return [...found, ...(found.length ? words.filter(u => u.split(' ').length <= 4 && !/\b(of|on|at|in|with|to)\b/.test(u)) : words)]
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const insts = (await q(`SELECT document_id, title, kind FROM rag.instrument`)).rows
  // the Land Use Tables' uses and every term the instruments define ("multi dwelling housing (terraces)" is defined in the
  // Housing SEPP, not in any Land Use Table) - matched longest first, so a qualified term is never cut at its bracket
  VOCAB = [...new Set([
    ...(await q(`SELECT DISTINCT land_use FROM nsw.lep_permissibility`)).rows.map(r => landUseKey(r.land_use)),
    ...(await q(`SELECT DISTINCT heading FROM rag.provision WHERE kind = 'term' AND heading IS NOT NULL`)).rows.map(r => landUseKey(r.heading)),
  ])].filter(v => v.length > 3 && v.split(' ').length <= 6).sort((a, b) => b.length - a.length)
  const provs: P[] = (await q(`SELECT id, document_id, parent_id, local_id, kind, heading, coalesce(own_text, '') own_text, sort, ordinal, coalesce(path, '{}') path, connective FROM rag.provision`)).rows
  const byId = new Map(provs.map(p => [p.id, p]))
  const local = (doc: string, id: string) => provs.find(p => p.document_id === doc && p.local_id === id) ?? null
  const kids = new Map<string, P[]>()
  for (const p of provs) if (p.parent_id) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p])
  for (const v of kids.values()) v.sort((a, b) => a.sort - b.sort || (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.local_id.localeCompare(b.local_id))
  const up = (p: P, pred: (x: P) => boolean): P | null => { for (let x: P | undefined = p; x; x = x.parent_id ? byId.get(x.parent_id) : undefined) if (pred(x)) return x; return null }
  const clauseOf = (p: P) => up(p, x => x.kind === 'clause') ?? up(p, x => /^(sec|sch)\.[^-]+$/.test(x.local_id))
  const unitOf = (word: string, p: P) => { const w = word.toLowerCase()
    return w === 'part' ? up(p, x => x.kind === 'part') : w === 'division' ? up(p, x => x.kind === 'division') : w === 'chapter' ? up(p, x => x.kind === 'chapter')
      : w === 'schedule' ? up(p, x => x.kind === 'schedule') : clauseOf(p) }
  const claims: Claim[] = []
  const add = (c: Claim) => claims.push(c)

  /** a date a frame turns on: "development consent was granted ... on or after 28 February 2025" -> date:consent>=2025-02-28;
   *  "a development application made on or after <date> for the subdivision ... and the erection of ..." -> combined_da>=<date> */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const iso = (d: string) => { const m = d.match(/(\d{1,2}) (\w+) (\d{4})/); if (!m) return null; const mo = MONTHS.indexOf(m[2]!.toLowerCase()); return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}` }
  function datesOf(t: string): string[] {
    const out: string[] = []
    for (const m of t.matchAll(/development consent was granted[^.;]*?\b(on or after|before|after)\s+(\d{1,2} \w+ \d{4})/gi)) { const d = iso(m[2]!); if (d) out.push(`consent${/before/i.test(m[1]!) ? '<' : '>='}${d}`) }
    for (const m of t.matchAll(/development application (?:was )?(?:made|lodged) (on or after|before)\s+(\d{1,2} \w+ \d{4})/gi)) { const d = iso(m[2]!); if (d) out.push(`combined_da${/before/i.test(m[1]!) ? '<' : '>='}${d}`) }
    return out
  }

  // defined terms: those that list zones expand to zone codes ("residential zone"); the rest are scope terms
  const terms = provs.filter(p => p.kind === 'term')
  const zoneTerms = new Map<string, string[]>()
  for (const t of terms) { const z = zoneCodes(t.own_text); if (z.length >= 2) zoneTerms.set(norm(t.heading).toLowerCase(), z) }
  // (a defined term that is a map's name - "Lot Size Map", "Additional Permitted Uses Map" - is read by the map readers, never as a place)
  const scopeTerms = [...new Set(terms.map(t => norm(t.heading).toLowerCase()).filter(h => h.split(' ').length >= 3 && !zoneTerms.has(h) && !/ map$/.test(h)))].sort((a, b) => b.length - a.length)
  const lgaTerms = new Map<string, string>()
  for (const t of terms) { const m = norm(t.own_text).match(/\bmeans the local government areas of (.+)$/i); if (m) lgaTerms.set(norm(t.heading).toLowerCase(), `the following local government areas— ${m[1]!.slice(0, 1500)}`) }
  // a term that names a mapped area: "Area 1 means the land identified as "Area 1" on the Height of Buildings Map" (Hornsby
  // 7.1). It is in force within the unit its definition clause names ("In this Part-" its Part, "In this clause-" the
  // clause), else the whole instrument - so another Part's "Area 1" is never read as this one
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // the forms the plans use: "means the land identified as", "the area identified as", "the land, shown as", "the part of
  // Melrose Park North identified as" - one label or several ("“Area 1” or “Area 2”")
  const areaDefs = terms.flatMap(t => {
    const m = norm(t.own_text).match(/\bmeans (?:the )?(?:land|area|part of (?:the )?[A-Z][\w ]*?),? (?:identified|shown|marked|edged|hatched|coloured)(?: [a-z]+)? as ((?:[“"][^”"]+[”"](?:,\s*|\s+(?:or|and)\s+)?)+) on the ([A-Z][\w ]*? Map)/)
    if (!m || !norm(t.heading)) return []
    const labels = [...m[1]!.matchAll(/[“"]([^”"]+)[”"]/g)].map(x => x[1]!.trim())
    const holder = t.parent_id ? byId.get(t.parent_id) : undefined
    const unitWord = norm(holder?.own_text).match(/^In this (Part|Division|clause|section|Schedule|Chapter)\b/i)?.[1]
    const unit = unitWord && holder ? unitOf(unitWord, holder) : null
    // named after "in / on / within / to" ("on land in Area 1", "applies to Parramatta City Centre"), or as the whole
    // phrase's subject ("Parramatta City Centre, other than ...")
    return [{ doc: t.document_id, re: new RegExp(`(?:^\\s*|\\b(?:in|on|within|to)\\s+)(?:land\\s+(?:in|within)\\s+)?(?:the\\s+)?${escRe(norm(t.heading))}(?![\\w])`, 'i'), label: labels.join(' or '), map: m[2]!, unit: unit?.id ?? null }]
  })
  const inUnit = (p: P, unit: string | null) => !unit || !!up(p, x => x.id === unit)
  // the Standard Instrument's zone groups ("on a lot in a residential zone"): the plan's own zones of that group, from its
  // resolved Land Use Table (a plan that defines the words itself is read through zoneTerms instead)
  const ZONE_GROUP: Record<string, RegExp> = { residential: /^R\d/, rural: /^RU\d/, recreation: /^RE\d/, 'special purpose': /^SP\d/, waterway: /^W\d/, industrial: /^IN\d/, conservation: /^C\d/ }
  const planZones = new Map<string, string[]>()
  for (const r of (await q(`SELECT DISTINCT i.document_id, z.zone_code FROM nsw.lep_permissibility z JOIN rag.instrument i ON i.title = z.epi_name`)).rows)
    planZones.set(r.document_id, [...(planZones.get(r.document_id) ?? []), String(r.zone_code)])
  // a plan's group terms ("residential accommodation" includes "shop top housing"), from its own Dictionary: a bar on the
  // group bars each of its members
  const groupsByDoc = new Map<string, Map<string, string[]>>()
  for (const t of provs.filter(p => p.kind === 'term' && p.heading)) {
    const m = norm(t.own_text).split(/\s+Note\.?\s/)[0]!.match(/any of the following\s*[—:-]?\s*(.*)$/i); if (!m) continue
    const members = [...m[1]!.split(/but does not include/i)[0]!.matchAll(/\([a-z]{1,3}\)\s*(.+?)(?=\s*\([a-z]{1,3}\)\s|$)/g)].map(x => landUseKey(x[1]!.replace(/[,;.]?\s*(?:or|and)?\s*$/i, '')))
    if (!members.length) continue
    if (!groupsByDoc.has(t.document_id)) groupsByDoc.set(t.document_id, new Map())
    groupsByDoc.get(t.document_id)!.set(landUseKey(t.heading!), members)
  }
  const withMembers = (doc: string, uses: string[]) => {
    const g = groupsByDoc.get(doc), out = new Set(uses), todo = [...uses]
    while (todo.length) { const u = todo.pop()!; for (const m of g?.get(u) ?? []) if (!out.has(m)) { out.add(m); todo.push(m) } }
    return [...out]
  }
  /** zones, scope terms and sub-questions in a phrase about where / when something applies; `at`, the provision the
   *  phrase is in, lets a defined area ("on land in Area 1") be read as the map area its definition names */
  const scopeOf = (phrase: string, at?: P) => {
    const zones = zoneCodes(phrase), tms: string[] = [], requires: any[] = []
    if (at) for (const d of areaDefs) if (d.doc === at.document_id && inUnit(at, d.unit) && d.re.test(phrase)) tms.push(`mapped:${d.label} on the ${d.map}`)
    for (const [term, z] of zoneTerms) if (new RegExp(`\\bin an? ${term}\\b`, 'i').test(phrase)) zones.push(...z)
    if (at && !zones.length) for (const [g, re] of Object.entries(ZONE_GROUP))
      if (new RegExp(`\\bin an? ${g} zone\\b`, 'i').test(phrase) && !new RegExp(`\\bother than (?:land )?in an? ${g} zone\\b`, 'i').test(phrase)) zones.push(...(planZones.get(at.document_id) ?? []).filter(z => re.test(z)))
    for (const term of scopeTerms) if (new RegExp(`\\b(in|on|within) (?:an? |the )?${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(phrase)) {
      // a defined term that is a list of councils ("inland local government areas means the local government areas of
      // Albury City, Armidale Regional, ...") is bound as that list, not as words no layer holds
      const def = lgaTerms.get(term)
      tms.push(def ?? term)
    }
    for (const m of phrase.matchAll(/\bif development for the purposes? of (.+?) is permissible on the land under another environmental planning instrument/gi))
      requires.push({ permissible: usesOf(m[1]!)[0] })
    // "This clause applies if development for the purposes of an eco-tourist facility is permitted with development consent
    // under this Plan" (cl 5.13, 5.18 in every plan): the land where that use is permissible here - a sub-question
    for (const m of phrase.matchAll(/(?:^|\bif )development for the purposes? of (.+?) is permitted with(?:out)? (?:development )?consent under this Plan/gi))
      if (usesOf(m[1]!).length) requires.push({ permissible: usesOf(m[1]!)[0] })
    // "so much of any land that is within the relevant distance of a boundary between any 2 zones. The relevant distance is
    // 20 metres" (cl 5.3): the lot within that distance of land in another zone, measured on the plan's zoning map. A
    // distance given zone by zone is a list, bound item by item (02d)
    const zb = /\bwithin the relevant distance of a boundary between any (?:2|two) zones\b/i.test(phrase) ? phrase.match(/\brelevant distance is ([\d.]+)\s*(?:m|metres)\b/i) : null
    if (zb) tms.push(`nearzone:${Number(zb[1])}|`)
    // land a map marks ("shown as Area 1 on the Key Sites Map", "identified as "Y1" or "Y2" on the ... Map", and the plans'
    // own slip "identified as "Area 3" of the ... Map") and land named by its lot ("Lot 1, DP 433534")
    for (const m of phrase.matchAll(/\b(?:shown|identified|marked) as (.+?) (?:on|of) the ([A-Z][\w ]*? Map)/g)) tms.push(`mapped:${norm(m[1]).replace(/[“”"]/g, '')} on the ${m[2]}`)
    // "land shown on the Riverstone East Stage 3 Precinct Variation Area Map", "a subdivision of any land shown on the Lot
    // Size Map": any polygon of that map over the lot, whatever its label
    for (const m of phrase.matchAll(/\bland (?:shown|identified) on the ([A-Z][\w ]*? Map)\b/g)) if (!tms.some(t => t.startsWith('mapped:') && t.endsWith(m[1]!))) tms.push(`anymap:${m[1]}`)
    // title type: a community title subdivision is "under the Community Land Development Act"; a strata one is "by the
    // registration of a strata plan" / "for a strata plan scheme"; "but does not apply to ..." excludes it
    const notPart = phrase.match(/\bbut does not apply to (.+)$/i)?.[1] ?? ''
    const own = notPart ? phrase.slice(0, phrase.length - notPart.length) : phrase
    if (/Community Land Development Act/i.test(own)) tms.push('tenure:community')
    if (/strata plan|strata scheme/i.test(own)) tms.push('tenure:strata')
    if (/strata/i.test(notPart)) tms.push('!tenure:strata')
    if (/Community Land Development/i.test(notPart)) tms.push('!tenure:community')
    tms.push(...datesOf(phrase))
    const lots = lotsIn(phrase)
    if (lots.length) tms.push(`lots:${lots.join('|')}`)
    return { zones: [...new Set(zones)], terms: [...new Set(tms)], requires }
  }

  // ── land use tables: the resolved table, anchored on the zone's item ─────────────────────────────
  for (const inst of insts.filter(i => i.kind === 'lep')) {
    const rows = (await q(`SELECT zone_id, zone_code, land_use, status, basis, derived_from, source_text FROM nsw.lep_permissibility WHERE epi_name = $1 AND level = 'leaf'`, [inst.title])).rows
    const ITEM: Record<string, RegExp> = { permitted_without_consent: /without consent/i, permitted_with_consent: /^permitted with consent/i, prohibited: /^prohibited/i }
    const consentOf = (st: string) => st === 'permitted_without_consent' ? 'without' : st === 'prohibited' ? null : 'with'
    // the plan's group terms, from its own Dictionary ("residential accommodation ... includes any of the following- (a)
    // attached dwellings, ..."), up to "but does not include"
    const groups = new Map<string, string[]>()
    for (const t of provs.filter(p => p.document_id === inst.document_id && p.kind === 'term' && p.heading)) {
      const body = norm(t.own_text).split(/\s+Note\.?\s/)[0]!
      const m = body.match(/any of the following\s*[—:-]?\s*(.*)$/i); if (!m) continue
      const tail = m[1]!.split(/but does not include/i)[0]!
      const members = [...tail.matchAll(/\([a-z]{1,3}\)\s*(.+?)(?=\s*\([a-z]{1,3}\)\s|$)/g)].map(x => landUseKey(x[1]!.replace(/[,;.]?\s*(?:or|and)?\s*$/i, '')))
      if (members.length) groups.set(landUseKey(t.heading!), members)
    }
    const membersOf = (g: string) => { const out = new Set<string>(), todo = [...(groups.get(g) ?? [])]; while (todo.length) { const m = todo.pop()!; if (!out.has(m)) { out.add(m); todo.push(...(groups.get(m) ?? [])) } } return out }
    // what each zone's items list in words (D's own reading of the table, beside the resolved rows)
    const literal = new Map<string, { item: P; status: string; uses: string[] }[]>()
    for (const g of provs.filter(p => p.document_id === inst.document_id && /^pt-cg1\.Zone_[A-Z0-9]+$/.test(p.local_id)))
      literal.set(g.local_id.slice('pt-cg1.Zone_'.length), (kids.get(g.id) ?? []).flatMap(k => { const st = Object.keys(ITEM).find(s => ITEM[s]!.test(norm(k.heading))); return st ? [{ item: k, status: st, uses: [...new Set([...usesOf(k.own_text), ...usesOf(k.own_text.replace(/[’‘]/g, "'"))].map(landUseKey))] }] : [] }))
    const listedAs = (zone: string, use: string) => literal.get(zone)?.find(x => x.uses.includes(use))
    const groupPermits = (zone: string, use: string) => literal.get(zone)?.find(x => x.status !== 'prohibited' && x.uses.some(u => membersOf(u).has(use)))
    const have = new Set<string>()
    for (const r of rows) {
      const grp = local(inst.document_id, r.zone_id)
      const item = grp ? (kids.get(grp.id) ?? []).find(k => ITEM[r.status]?.test(norm(k.heading))) : null
      if (!item) continue
      const use = landUseKey(r.land_use), lit = listedAs(r.zone_code, use)
      // the table's own words win over a resolved row that says otherwise
      if (lit && lit.status !== r.status) continue
      // a catch-all prohibition of a use whose group items 2 / 3 list (tank-based aquaculture where "Aquaculture" is
      // permitted): the group's permission stands - the closed vocabulary's subset trap
      const gp = !lit && r.basis === 'catchall' && r.status === 'prohibited' ? groupPermits(r.zone_code, use) : undefined
      if (gp) {
        add({ provision_id: gp.item.id, kind: 'permit', consent: consentOf(gp.status), uses: [use], zones: [r.zone_code], source: 'text', reader: 'land use table (words, by group)',
          span: `a kind of ${gp.uses.find(u => membersOf(u).has(use))}, listed under ${gp.item.heading}` })
        have.add(`${r.zone_code}|${use}`); continue
      }
      have.add(`${r.zone_code}|${use}`)
      add({ provision_id: item.id, kind: r.status === 'prohibited' ? 'prohibit' : 'permit', consent: consentOf(r.status),
        uses: [use], zones: [r.zone_code], source: 'lep_permissibility', reader: 'land use table',
        span: `${r.basis}: ${r.source_text ?? r.derived_from ?? r.land_use}` })
    }
    // every use an item lists in words that the resolved rows do not carry as listed (a group term - "Aquaculture",
    // "Business premises" - is not a leaf row)
    const rowSays = new Set(rows.map(r => `${r.zone_code}|${landUseKey(r.land_use)}|${r.status}`))
    for (const [zone, items] of literal) for (const x of items) for (const use of x.uses) {
      if (rowSays.has(`${zone}|${use}|${x.status}`)) continue               // a resolved row already says the same
      have.add(`${zone}|${use}`)
      add({ provision_id: x.item.id, kind: x.status === 'prohibited' ? 'prohibit' : 'permit', consent: consentOf(x.status), uses: [use], zones: [zone], source: 'text',
        reader: 'land use table (words)', span: `listed under ${x.item.heading}: ${norm(x.item.own_text).slice(0, 200)}` })
    }
    // every member of a group items 2 / 3 list (its own Dictionary's "includes any of the following"), where no row and
    // no listing of its own answers it ("Industries" listed: a light industry is permitted)
    for (const [zone, items] of literal) for (const x of items.filter(x => x.status !== 'prohibited')) for (const g of x.uses) for (const m of membersOf(g)) {
      if (have.has(`${zone}|${m}`) || listedAs(zone, m)) continue
      have.add(`${zone}|${m}`)
      add({ provision_id: x.item.id, kind: 'permit', consent: consentOf(x.status), uses: [m], zones: [zone], source: 'text', reader: 'land use table (words, by group)',
        span: `a kind of ${g}, listed under ${x.item.heading}` })
    }
    // the catch-all sentences: a closed zone ("Any development not specified in item 2 or 3") prohibits, an open one ("Any
    // other development not specified in item 2 or 4") permits, every use the zone's items do not answer - '*', which the
    // evaluator applies only when no listing in the zone matches the use
    for (const [zone, items] of literal) for (const x of items) {
      const t = norm(x.item.own_text)
      if (x.status === 'prohibited' && /Any (?:other )?development not specified in item 2 or 3/i.test(t))
        add({ provision_id: x.item.id, kind: 'prohibit', consent: null, uses: ['*'], zones: [zone], source: 'text', reader: 'land use table (catch-all)', span: 'any development not specified in item 2 or 3' })
      if (x.status === 'permitted_with_consent' && /Any other development not specified in item 2 or 4/i.test(t))
        add({ provision_id: x.item.id, kind: 'permit', consent: 'with', uses: ['*'], zones: [zone], source: 'text', reader: 'land use table (catch-all)', span: 'any other development not specified in item 2 or 4' })
    }
  }

  // ── frames: from every applies_only_if relation ───────────────────────────────────────────────────
  const frames = (await q(`SELECT from_provision, to_provision, scope FROM rag.relation WHERE kind = 'applies_only_if' AND to_provision IS NOT NULL`)).rows
  for (const f of frames) {
    const phrase = norm(f.scope?.phrase), conds: string[] = f.scope?.conditions ?? []
    const usesM = phrase.match(/^development (?:for the purposes? of|involving subdivision for the purposes? of) (.+?)(?=\s+(?:on land|in a |in the following|in Zone|if |on a lot|$))/i)
    // a frame about what is built rather than where ("the erection or alteration of, or an addition to, a dwelling house and
    // any attached development", a code's Division): the uses it names, as defined or listed
    // (only a phrase that opens with the activity: "a subdivision ... that requires development consent" names no use)
    const builtUses = !usesM && /^(?:the )?(?:erection|alteration|addition|construction|demolition|carrying out)\b/i.test(phrase) ? usesOf(phrase).filter(u => VOCAB.includes(u)) : []
    const s = scopeOf(phrase, byId.get(f.to_provision))
    // the land a frame describes may run into its list items and a table of lots ("land at the following-")
    const deep = (id: string): string[] => (kids.get(id) ?? []).flatMap(k => [k.own_text, ...deep(k.id)])
    const allLots = lotsIn([phrase, ...conds, ...deep(f.to_provision)].join(' ; '))
    if (allLots.length) s.terms = [...s.terms.filter(x => !x.startsWith('lots:')), `lots:${allLots.join('|')}`]
    const condZones = conds.flatMap(zoneCodes)
    // "This section applies only if- (a) ... on or after <date>, or (b) ..." - the dates in the list are alternatives
    const condDates = conds.flatMap(c => datesOf(c))
    const dateTerm = condDates.length ? [`date:${condDates.join('|')}`] : []
    add({ provision_id: f.to_provision, kind: 'frame', unit_provision: f.from_provision, uses: usesM ? usesOf(usesM[1]!) : builtUses,
      zones: [...new Set([...s.zones, ...(/following zones/i.test(phrase) ? condZones : [])])], terms: [...s.terms.filter(x => !/^(consent|combined_da)/.test(x)), ...s.terms.filter(x => /^(consent|combined_da)/.test(x)).map(x => `date:${x}`), ...dateTerm, ...(/subdivision/i.test(phrase) ? ['proposal:subdivision'] : [])],
      // "the whole of the State, other than the following- (a) bush fire prone land, ... (e) the following local government
      // areas- (i) Bathurst Regional, ..." - each item whole, a nested list kept with it
      requires: s.requires, excludes: /other than the following/i.test(phrase)
        ? (kids.get(f.to_provision) ?? []).map(k => norm([k.own_text, ...(/[—-]\s*$/.test(norm(k.own_text)) ? (kids.get(k.id) ?? []).map(g => g.own_text) : [])].join(' ')).replace(/[,.;]+$/, '')).filter(x => x.length > 2)
        : [],
      source: 'text', reader: 'frame', span: phrase.slice(0, 300) })
  }

  // ── disapplications: "This section does not apply to strata subdivision", "This clause does not apply in relation to
  //    the subdivision of any land- (a) by the registration of a strata plan ..., (b) ... under the Community Land
  //    Development Act" -> a frame on the unit that excludes those title types ─────────────────────────
  const dis = (await q(`SELECT from_provision, to_provision FROM rag.relation WHERE kind = 'disapplies' AND to_provision IS NOT NULL`)).rows
  for (const d of dis) {
    const from = byId.get(d.from_provision); if (!from) continue
    const text = norm([from.own_text, ...(kids.get(from.id) ?? []).map(k => k.own_text)].join(' '))
    const tail = text.match(/(?:does|do) not apply\b(.*)$/i)?.[1] ?? ''
    const ex = [...(/strata/i.test(tail) ? ['!tenure:strata'] : []), ...(/Community Land Development/i.test(tail) ? ['!tenure:community'] : [])]
    if (ex.length) add({ provision_id: from.id, kind: 'frame', unit_provision: d.to_provision, terms: ex, source: 'text', reader: 'disapplication', span: text.slice(0, 300) })
  }

  // ── the codes of an exempt and complying development policy ─────────────────────────────────────────
  // A code is a Part (or a division of "Exempt Development Codes") headed "... Code"; everything under it is on the
  // pathway its heading says: exempt where the heading says so, complying otherwise. The policy names a code by its
  // heading ("the Housing Code"); "this Policy" names them all
  // (by local id, not kind: the pilot tree gives one Part the kind "note")
  const codeUnits = provs.filter(p => /^pt\.[0-9A-Z]+(?:-div\.[0-9A-Z]+)?$/.test(p.local_id) && /\bCodes?\b/.test(p.heading ?? '') && !/^Code\b/.test(p.heading ?? ''))
  const pathwayOfUnit = (u: P) => /exempt/i.test(u.heading ?? '') || /exempt/i.test(up(u, x => x.kind === 'part' && x.id !== u.id)?.heading ?? '') ? 'exempt' : 'complying'
  const codeOf = (p: P) => up(p, x => codeUnits.includes(x))
  const codesNamed = (phrase: string, doc: string, pathway: string | null) => {
    if (/\bthis Policy\b/i.test(phrase)) return codeUnits.filter(u => u.document_id === doc && (!pathway || pathwayOfUnit(u) === pathway))
    return codeUnits.filter(u => u.document_id === doc && new RegExp(`\\b${escRe(norm(u.heading))}\\b`, 'i').test(phrase))
  }
  /** an item of a code's list that is about the land, not what is built: the registered layers answer it */
  const landItem = (t: string) => /^(development on |on )?(land|a lot|any lot|unsewered|bush fire prone|flood)\b/i.test(t) || /\bon land (that|identified|within|shown)\b/i.test(t)
  const zonesIn = (t: string) => /\bZones?\b/.test(t) ? [...new Set([...t.matchAll(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/g)].map(m => m[1]!))] : []

  // ── permissions, consent bars, standards: sentence readers over every provision ─────────────────────
  // list items a reader of their stem reads (their figure is the stem's standard, never one of their own): "Subclause (3)
  // does not apply unless each lot resulting from the subdivision will- (a) be at least 507.5m2", "... unless the development
  // is on a lot that is at least- (a) for development in a heritage conservation area- (i) for dual occupancies (attached)-
  // 800m2". Marked before the readers run, whatever order the provisions come in
  const SUBDIV_UNLESS = /^Subclause \((\w+)\) (?:does|do) not apply\b(.*?)\bunless each lot resulting from the subdivision will\s*[—–-]?\s*(.*)$/i
  const LOT_STEM = /^the (?:development is on a )?(?:lot|land|site)\b[^—–-]*\bat least\s*[—–-]\s*$/i
  const consentTail = (t: string) => t.replace(/^Despite [^,]+,\s*/i, '').replace(/^(Development consent must not be granted (?:to|for) )(?:the )?(?:erection|carrying out) of (?:an? )?/i, '$1development for the purposes of ')
  const taken = new Set<string>()
  const below = (id: string): string[] => (kids.get(id) ?? []).flatMap(k => [k.id, ...below(k.id)])
  for (const p of provs) {
    const t = norm(p.own_text)
    if (SUBDIV_UNLESS.test(t) || LOT_STEM.test(norm(consentTail(t).match(/^Development consent must not be granted (?:to|for) development for the purposes? of .+? unless\b(.*)$/i)?.[1] ?? '')))
      for (const id of below(p.id)) taken.add(id)
  }
  for (const p of provs) {
    if (['term', 'cell', 'row', 'table', 'group'].includes(p.kind) || p.path.some(x => x.startsWith('pt-cg')) || taken.has(p.id)) continue
    const t = norm(p.own_text); if (!t) continue
    const cl = clauseOf(p)
    const ndStem = (x: P | null): boolean => !!x && (/non-discretionary development standards/i.test(x.own_text) || (x.parent_id ? ndStem(byId.get(x.parent_id)!) : false))

    // ── a code's own three lists ──
    // "The following development is complying development under this code- (a) the erection of a new 1 or 2 storey
    // dwelling house and any attached development, ..." - each item a permission on that pathway, the item's words a
    // condition of it (what is built: a fact of the proposal), on the code unit so the code's frames apply
    let m = t.match(/^The following (?:types of )?development (?:is|are) (complying|exempt) development under this code\s*[—–-]\s*$/i)
    const code = codeOf(p)
    if (m && code) {
      for (const k of kids.get(p.id) ?? []) {
        // an item and its sub-items together ("the erection or alteration of, or addition to- (i) any 1 or 2 storey dual
        // occupancy, manor house or multi dwelling housing (terraces), or (ii) any attached development ...")
        const deepText = (id: string): string[] => (kids.get(id) ?? []).flatMap(g => [norm(g.own_text), ...deepText(g.id)])
        const kt = norm([k.own_text, ...deepText(k.id)].join(' ')).replace(/[,;.]?\s*(?:or|and)?\s*$/i, ''); if (!kt) continue
        // what is built (storeys, attached development) is the question's own subject, carried in the span, never a
        // condition that would leave every answer "maybe"
        // the uses the item names, as defined or listed somewhere (a sentence's other words are not uses)
        add({ provision_id: k.id, kind: 'permit', consent: m[1]!.toLowerCase(), uses: usesOf(kt).filter(u => VOCAB.includes(u)), unit_provision: code.id, source: 'text', reader: 'code permit', span: kt.slice(0, 300) })
      }
      continue
    }
    // "The erection of a new single storey or two storey dwelling house is development specified for this code if the
    // development is erected on a lot- (a) in Zone RU1, RU2, RU4 or RU6 that has an area of at least 4,000m2, or (b) in
    // Zone R5" (3A.2); "Bed and breakfast accommodation is development specified for this code if it is-" (4A.1); "The
    // demolition or removal of the following development, is development specified for this code- (a) a dwelling house,
    // ..." (7.1): a permission on the code's pathway for the subject (or each listed item), each lot condition in the list
    // its own permission's place, the rest a condition the answer lists
    m = t.match(/^(.+?),? (?:is|are) development specified for this code(?:\s+if\b(.*))?\s*[—–-]?\s*$/i)
    if (m && code) {
      const subject = norm(m[1]!), tail = norm(m[2] ?? ''), items = (kids.get(p.id) ?? []).map(k => ({ k, kt: norm(k.own_text).replace(/[,;.]?\s*(?:or|and)?\s*$/i, '') })).filter(x => x.kt.length > 2)
      const subjUses = usesOf(subject).filter(u => VOCAB.includes(u))
      if (/the following development$/i.test(subject) || !subjUses.length && items.length && !tail) {
        // the list names what is specified
        for (const x of items) { const u = usesOf(x.kt).filter(u => VOCAB.includes(u)); if (u.length) add({ provision_id: x.k.id, kind: 'permit', consent: pathwayOfUnit(code), uses: u, unit_provision: code.id, source: 'text', reader: 'code permit', span: x.kt.slice(0, 300) }) }
      } else if (subjUses.length) {
        // the list (or the tail) says where / when: a zone or lot-size item is the permission's own place, else a condition
        const placeItems = items.filter(x => zonesIn(x.kt).length || /\barea of (?:at least|not less than)/i.test(x.kt))
        if (placeItems.length) for (const x of placeItems) {
          const area = x.kt.match(/\barea of (?:at least|not less than) (\d[\d,]*(?:\.\d+)?)\s*(?:m2|m²|square metres)/i)
          add({ provision_id: x.k.id, kind: 'permit', consent: pathwayOfUnit(code), uses: subjUses, zones: zonesIn(x.kt), band: area ? { metric: 'lot_size', lo: Number(area[1]!.replace(/,/g, '')), lo_incl: true, hi: null, hi_incl: false } : null,
            unit_provision: code.id, source: 'text', reader: 'code permit', span: `${subject}: ${x.kt}`.slice(0, 300) })
        }
        else add({ provision_id: p.id, kind: 'permit', consent: pathwayOfUnit(code), uses: subjUses, unit_provision: code.id, source: 'text', reader: 'code permit', span: t.slice(0, 300) })
        for (const x of items.filter(x => !placeItems.includes(x))) add({ provision_id: x.k.id, kind: 'condition', unit_provision: code.id, terms: [`condition:${x.kt.slice(0, 200)}`], source: 'text', reader: 'code condition', span: x.kt.slice(0, 300) })
        if (tail && !items.length) add({ provision_id: p.id, kind: 'condition', unit_provision: code.id, terms: [`condition:${tail.slice(0, 200)}`], source: 'text', reader: 'code condition', span: tail.slice(0, 300) })
      }
      continue
    }
    // "The following development is not complying development under this code- (a) ... roof terrace ..., (c) development on
    // a battle-axe lot, (i) development on unsewered land": land the code does not reach is an exclusion on the code (a
    // frame the layers test); what is built is a condition the answer lists
    m = t.match(/^The following development is not (complying|exempt) development under this code\s*[—–-]\s*$/i)
    if (m && code) {
      const items = (kids.get(p.id) ?? []).map(k => ({ k, kt: norm([k.own_text, ...(kids.get(k.id) ?? []).map(g => g.own_text)].join(' ')).replace(/[,;.]?\s*(?:or|and)?\s*$/i, '') })).filter(x => x.kt.length > 2)
      const land = items.filter(x => landItem(x.kt)), rest = items.filter(x => !landItem(x.kt))
      if (land.length) add({ provision_id: p.id, kind: 'frame', unit_provision: code.id, excludes: land.map(x => x.kt.replace(/^(development )?on /i, '')), source: 'text', reader: 'code exclusion', span: t.slice(0, 300) })
      for (const x of rest) add({ provision_id: x.k.id, kind: 'condition', unit_provision: code.id, terms: [`condition:not ${x.kt.slice(0, 190)}`], source: 'text', reader: 'code condition', span: x.kt.slice(0, 300) })
      continue
    }
    // "Complying development specified for this code may only be carried out on a lot that meets the following
    // requirements- (a) the lot must be in Zone R1, R2, R3, R4 or RU5, (b) the area of the lot must not be less than 200m2,
    // (c) the width of the lot must be at least 6m measured at the building line, (d) there must only be 1 dwelling house
    // on the lot ...": each lot test a frame on the code (all must hold); the rest conditions the answer lists
    m = t.match(/^(?:Complying|Exempt) development (?:specified for|under) this code may only be carried out on a lot that meets the following requirements\s*[—–-]\s*$/i)
    if (m && code) {
      for (const k of kids.get(p.id) ?? []) {
        const kt = norm(k.own_text).replace(/[,;.]?\s*(?:or|and)?\s*$/i, ''); if (!kt) continue
        const z = zonesIn(kt)
        const area = kt.match(/\barea of the lot must (?:not be less than|be at least) (\d[\d,]*(?:\.\d+)?)\s*(?:m2|m²|square metres)/i)
        const width = kt.match(/\bwidth of the lot must be at least (\d[\d,]*(?:\.\d+)?)\s*m\b/i)
        if (z.length && /\bmust be in\b/i.test(kt)) add({ provision_id: k.id, kind: 'frame', unit_provision: code.id, zones: z, source: 'text', reader: 'lot requirement', span: kt.slice(0, 300) })
        else if (area) add({ provision_id: k.id, kind: 'frame', unit_provision: code.id, band: { metric: 'lot_size', lo: Number(area[1]!.replace(/,/g, '')), lo_incl: true, hi: null, hi_incl: false }, source: 'text', reader: 'lot requirement', span: kt.slice(0, 300) })
        else if (width) add({ provision_id: k.id, kind: 'frame', unit_provision: code.id, band: { metric: 'frontage', lo: Number(width[1]!.replace(/,/g, '')), lo_incl: true, hi: null, hi_incl: false }, source: 'text', reader: 'lot requirement', span: kt.slice(0, 300) })
        else add({ provision_id: k.id, kind: 'condition', unit_provision: code.id, terms: [`condition:${kt.slice(0, 200)}`], source: 'text', reader: 'code condition', span: kt.slice(0, 300) })
      }
      continue
    }
    // ── the policy's general requirements for a pathway ──
    // "To be complying development specified for the Housing Code, the Inland Code, ..., the development must not be
    // carried out on- (a) land within a heritage conservation area ..., (b) land that is reserved ..." (1.19); "To be exempt
    // development for the purposes of this Policy, the development- (a) must not be carried out on land that ..." (1.16);
    // "To be complying development for the purposes of this Policy, the development must- (b) be permissible, with consent,
    // under an environmental planning instrument applying to the land" (1.18): each named code (or every code of that
    // pathway) takes the land items as exclusions; a permissibility test is a sub-question to the land's own plan
    m = t.match(/^To be (complying|exempt) development (?:specified for|under|for the purposes? of) (.+?), the development( must(?: not be carried out on)?)?\s*[—–-]?\s*(.*)$/i)
    if (m) {
      const units = codesNamed(m[2]!, p.document_id, m[1]!.toLowerCase())
      const inline = m[3] && /carried out on/i.test(m[3]) && norm(m[4] ?? '') ? [norm(m[4]!)] : []
      const items = inline.length ? inline : (kids.get(p.id) ?? []).map(k => norm([k.own_text, ...(kids.get(k.id) ?? []).map(g => g.own_text)].join(' ')).replace(/[,;.]?\s*(?:or|and)?\s*$/i, '')).filter(x => x.length > 2)
      // the stem may end "the development-" (items "must not be carried out on ...") or "the development must-" (items "not
      // be carried out on ..."): either way the land is what follows "carried out on"
      const land = items.map(x => x.replace(/^(?:must )?not be carried out on /i, '')).filter((x, i) => m![3] && /carried out on/i.test(m![3]) ? true : /^(?:must )?not be carried out on /i.test(items[i]!) || landItem(x))
      const lep = items.some(x => /\bbe permissible,? with (?:development )?consent,? under an environmental planning instrument\b/i.test(x))
      for (const u of units) {
        if (land.length) add({ provision_id: p.id, kind: 'frame', unit_provision: u.id, excludes: land, source: 'text', reader: 'land exclusion', span: t.slice(0, 300) })
        if (lep) add({ provision_id: p.id, kind: 'frame', unit_provision: u.id, terms: ['lep:permissible'], source: 'text', reader: 'policy requirement', span: t.slice(0, 300) })
      }
      if (units.length) continue
    }
    // "Development specified in the Housing Code, the Inland Code, ... is not complying development under that code if it
    // is carried out on land identified ... on a map specified in Schedule 5" (1.19(2), (3A))
    m = t.match(/^Development specified in (.+?) is not (complying|exempt) development under that code if it is carried out on (.+)$/i)
    if (m) {
      const units = codesNamed(m[1]!, p.document_id, m[2]!.toLowerCase())
      const ex = [norm(m[3]!).replace(/[.,;]\s*$/, ''), ...(kids.get(p.id) ?? []).map(k => norm(k.own_text).replace(/[,;.]?\s*(?:or|and)?\s*$/i, '')).filter(x => x.length > 2)]
      for (const u of units) add({ provision_id: p.id, kind: 'frame', unit_provision: u.id, excludes: ex, source: 'text', reader: 'land exclusion', span: t.slice(0, 300) })
      if (units.length) continue
    }

    // permissions
    m = t.match(/^Development for the purposes? of (.+?) is permitted with(out)? (?:development )?consent(.*)$/i)
    if (m) {
      const s = scopeOf(m[3]!, p), unitM = m[3]!.match(/on land to which this (chapter|Part|Division|section|clause) applies/i)
      add({ provision_id: p.id, kind: 'permit', consent: m[2] ? 'without' : 'with', uses: usesOf(m[1]!), zones: s.zones, terms: s.terms, requires: s.requires,
        unit_provision: unitM ? unitOf(unitM[1]!, p)?.id ?? null : null, source: 'text', reader: 'permission', span: t.slice(0, 300) })
      continue
    }
    // "Development for the following purposes is permitted with development consent- (a) boat launching ramps, (b) ..." (the
    // list form, Hornsby / Parramatta Schedule 1): the uses are the list items, the place is the stem's or the item's frame
    m = t.match(/^Development for the following purposes? is permitted with(out)? (?:development )?consent(.*?)\s*[—:-]\s*$/i)
    if (m) {
      const items = (kids.get(p.id) ?? []).map(k => norm(k.own_text).replace(/[,;.]?\s*(?:or|and)?\s*$/i, '')).filter(Boolean)
      const uses = [...new Set(items.flatMap(x => usesOf(x)))]
      if (uses.length) {
        const s = scopeOf(m[2]!, p)
        add({ provision_id: p.id, kind: 'permit', consent: m[1] ? 'without' : 'with', uses, zones: s.zones, terms: s.terms, requires: s.requires, unit_provision: null,
          source: 'text', reader: 'permission', span: `${t.slice(0, 160)} ${items.join('; ')}`.slice(0, 300) })
        continue
      }
    }
    // "The use of no more than 10 rooms in Yurora House for hotel or motel accommodation is permitted with development
    // consent": a permission for the use, on a condition the words state and no dataset holds (a fact of the proposal)
    m = t.match(/^The use of (.+?) for (?:the purposes? of )?(.+?) is permitted with(out)? (?:development )?consent(.*)$/i)
    if (m && usesOf(m[2]!).length) {
      const s = scopeOf(m[4]!, p)
      add({ provision_id: p.id, kind: 'permit', consent: m[3] ? 'without' : 'with', uses: usesOf(m[2]!), zones: s.zones, terms: [...s.terms, `condition:${norm(m[1])}`], requires: s.requires,
        unit_provision: null, source: 'text', reader: 'permission', span: t.slice(0, 300) })
      continue
    }
    m = t.match(/^Development to which this (chapter|Part|Division|section|clause) applies may be carried out with(out)? (?:development )?consent/i)
    if (m) { add({ provision_id: p.id, kind: 'permit', consent: m[2] ? 'without' : 'with', unit_provision: unitOf(m[1]!, p)?.id ?? null, source: 'text', reader: 'permission', span: t.slice(0, 300) }); continue }

    // a discretionary figure: "The consent authority may approve development with a floor space ratio of up to 1.3:1 ...
    // but only if the consent authority is satisfied that-" / "may grant development consent ... with a building height
    // that exceeds the maximum height shown for the land ... by up to 6 metres" - it depends on the consent authority
    m = t.match(/\bmay (?:approve|grant)[^.]*?\bwith an? (floor space ratio|building height|height)\b[^.]*?\b(?:of up to|exceeds? (?:the maximum [a-z ]+? shown for the land[^.]*?)?by up to)\s*([\d.]+)\s*(:1|metres|m\b)/i)
    if (m) {
      const topic = /floor space/i.test(m[1]!) ? 'fsr' : 'height', bump = /exceeds?/i.test(m[0])
      const mapM = t.match(/shown for the land[^.]*?on the ([A-Z][\w ]+? Map)/)
      const why = norm([t.replace(/^.*?\b(only if|if)\b/i, '$1'), ...(kids.get(p.id) ?? []).map(k => k.own_text)].join(' ')).slice(0, 200)
      add({ provision_id: p.id, kind: 'standard', topic, comparator: 'max', value: bump ? null : Number(m[2]), unit: topic === 'fsr' ? 'ratio' : 'm',
        value_source: bump ? `map:${topic === 'height' ? 'Height of Buildings Map' : 'Floor Space Ratio Map'}` : 'text', band: bump ? { add: Number(m[2]), relative: mapM?.[1] ?? null } : null,
        terms: [`discretion:${why}`], unit_provision: cl?.id ?? null, source: 'text', reader: 'discretionary standard', span: t.slice(0, 300) })
      continue
    }
    // a building on a mapped area that may go higher or denser if the consent authority is satisfied: "A building in Area 1
    // may have a height of up to 23.5m if the consent authority is satisfied-" (Hornsby 7.6, 7.7). The area is on the map
    // the clause names; where it names none, on the map of the standard's own topic (a height on the Height of Buildings
    // Map, a floor space ratio on the Floor Space Ratio Map) - that inference is written into the claim's span
    m = t.match(/^(?:A|Any|The) building (?:on land )?(?:in|on|within) (.+?) may have an? (?:building |maximum )?(height|floor space ratio)(?: of)? (?:up to|not more than|not exceeding)\s*([\d.]+)\s*(m\b|metres|:1)(.*)$/i)
    if (m) {
      const topic = /floor space/i.test(m[2]!) ? 'fsr' : 'height'
      const named = m[1]!.match(/^(.+?) on the ([A-Z][\w ]*? Map)$/)
      // a defined term of this instrument for the area ("In this Part- Area 1 means the land identified as "Area 1" on the
      // Height of Buildings Map"): its label and map
      const word = norm(named ? named[1] : m[1]).replace(/[“”"]/g, '')
      const defn = terms.filter(x => x.document_id === p.document_id && norm(x.heading).toLowerCase() === word.toLowerCase())
        .map(x => norm(x.own_text).match(/identified as [“"]([^”"]+)[”"] on the ([A-Z][\w ]*? Map)/)).find(Boolean)
      const map = named ? named[2]! : defn ? defn[2]! : topic === 'height' ? 'Height of Buildings Map' : 'Floor Space Ratio Map'
      const area = (defn ? defn[1]! : word).replace(/^(?:land )?(?:identified|shown|marked) as /i, '')
      const why = norm([m[5]!, ...(kids.get(p.id) ?? []).map(k => k.own_text)].join(' ')).replace(/^\s*if\s*/i, '').slice(0, 200)
      add({ provision_id: p.id, kind: 'standard', topic, comparator: 'max', value: Number(m[3]), unit: topic === 'fsr' ? 'ratio' : 'm', value_source: 'text',
        terms: [`mapped:${area} on the ${map}`, ...(/consent authority/i.test(m[5]!) ? [`discretion:${why}`] : [])], unit_provision: cl?.id ?? null, source: 'text', reader: 'discretionary standard',
        span: `${t.slice(0, 260)}${named ? '' : defn ? ` [${word}: as the Part defines it, on the ${map}]` : ` [the area read on the ${map}: no map named or defined]`}`.slice(0, 300) })
      continue
    }
    // "Development consent under subclause (2) must only be granted in relation to buildings with a frontage to ..." -
    // a limitation on the permission it names (or on the clause's permissions)
    m = t.match(/^Development consent (?:under subclause \((\w+)\) )?(?:must|may) only be granted (.+)$/i)
    if (m) {
      const target = m[1] && cl ? provs.find(x => x.document_id === p.document_id && x.local_id === `${cl.local_id}-ssec.${m![1]}`) : null
      add({ provision_id: p.id, kind: 'condition', unit_provision: target?.id ?? cl?.id ?? null, source: 'text', reader: 'condition', span: t.slice(0, 300) })
      continue
    }
    // "Development consent must not be granted for development on land to which this clause applies unless the consent
    // authority is satisfied that at least 50% of the gross floor area of ... will be used for ..." - a standard on the
    // unit, its figure possibly a share of another quantity
    m = t.match(/^Development consent must not be granted (?:to|for) development on land to which this (chapter|Part|Division|section|clause) applies unless\b(.*)$/i)
    if (m) {
      const tail = norm(m[2]!), fig = figureOf(tail), topic = topicOf(tail)
      if (fig && topic) {
        add({ provision_id: p.id, kind: 'standard', topic, comparator: fig.comparator ?? 'min', value: fig.value, unit: fig.unit, value_source: 'text', unit_provision: unitOf(m[1]!, p)?.id ?? null,
          band: fig.unit === '%' ? { relative: norm(tail.replace(/^.*?%\s*of\s*/, '')).replace(/\s*[—-]\s*$/, '') } : null, source: 'text', reader: 'consent bar', span: t.slice(0, 300) })
        continue
      }
    }
    // an exception to an exception, with its own figures: "Subclause (3) [which lets the land be subdivided despite clause
    // 4.1] does not apply [to land in a heritage conservation area] unless each lot resulting from the subdivision will-
    // (a) for dual occupancies (attached)-be at least 400m2, ..." (Hornsby 4.1D, Ku-ring-gai 4.1B). Each figure is the
    // minimum of the subclause it conditions, so it is claimed on that subclause and takes its relations ("Despite clause
    // 4.1"); its uses are the leaf's, else the use the subclause names ("an existing dual occupancy on the land")
    m = t.match(SUBDIV_UNLESS)
    const target = m && cl ? provs.find(x => x.document_id === p.document_id && x.local_id === `${cl.local_id}-ssec.${m![1]}`) : null
    if (m && target) {
      const land = norm(m[2]), notIn = land.match(/\bthat is not (?:in|on|within) (.+)$/i)
      const sc = scopeOf(notIn ? `in ${notIn[1]}` : land, p)
      const existing = norm(target.own_text).match(/\bthere is an existing (.+?) on the land\b/i)?.[1]
      const base = existing ? usesOf(existing) : []
      const leaves = norm(m[3]) ? [norm(m[3])] : (kids.get(p.id) ?? []).map(k => norm(k.own_text))
      for (const kt of leaves) {
        const lm = kt.match(/^(?:for (?:an? )?(.+?)\s*[—–-]\s*)?be at least (\d[\d,]*(?:\.\d+)?)\s*(m2|m²|square metres)/i); if (!lm) continue
        const lu = lm[1] ? usesOf(lm[1]).filter(u => VOCAB.includes(u)) : []
        add({ provision_id: target.id, kind: 'standard', topic: 'lot_size', comparator: 'min', value: Number(lm[2]!.replace(/,/g, '')), unit: 'm2', uses: lu.length ? lu : base,
          zones: sc.zones, terms: [...(notIn ? [] : sc.terms), 'proposal:subdivision'], excludes: notIn ? sc.terms : [], value_source: 'text', unit_provision: cl!.id,
          source: 'text', reader: 'subdivision standard', span: `${t.slice(0, 160)} ${kt}`.slice(0, 300) })
      }
      continue
    }
    // "Development for a purpose specified in the table to this subclause may be carried out on a lot in a zone specified
    // opposite if- (a) the area of the lot is at least 600m2, and (b) the lot has at least a 15m wide frontage to a public
    // road" (Parramatta 4.1C): each row's use and zones, each figure a standard on the lot
    if (/^Development for a purpose specified in the table to this (?:sub)?clause may be carried out on a lot in a zone specified opposite\b.*\bif\s*[—–-]\s*$/i.test(t)) {
      const table = (kids.get(p.id) ?? []).find(k => k.kind === 'table')
      const rows = table ? (kids.get(table.id) ?? []).filter(r => r.kind === 'row').map(r => (kids.get(r.id) ?? []).filter(c => c.kind === 'cell').map(c => norm(c.own_text))) : []
      const body = rows.filter(r => r.length >= 2 && !/^(land use|use|purpose|development)s?$/i.test(r[0]!))
      for (const k of (kids.get(p.id) ?? []).filter(k => k.kind !== 'table')) {
        const kt = norm(k.own_text), f = figureOf(kt), topic = topicOf(kt)
        if (!f || (topic !== 'lot_size' && topic !== 'lot_width')) continue
        for (const r of body) add({ provision_id: k.id, kind: 'standard', topic, comparator: f.comparator ?? 'min', value: f.value, unit: f.unit, uses: usesOf(r[0]!),
          zones: [...new Set([...r[1]!.matchAll(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/g)].map(x => x[1]!))], value_source: 'text', unit_provision: cl?.id ?? null,
          source: 'text', reader: 'consent standard', span: `${r[0]} in ${r[1]}: ${kt}`.slice(0, 300) })
        taken.add(k.id)
      }
      continue
    }
    // consent bars: a figure is a standard, a list is a set of conditions. "Despite ..., " is a relation (02-relations
    // reads it), and "the erection of X" / "the carrying out of X" is development for the purposes of X
    const tb = consentTail(t)
    m = tb.match(/^Development consent must not be granted (?:to|for) (?:the )?(?:development (?:to which this (chapter|Part|Division|section|clause) applies|for the purposes? of (.+?)(?= on | unless|,|$))|(subdivision)[^,]*?)(.*?)(?:unless\b(.*))?$/i)
    if (m) {
      const uses = m[2] ? usesOf(m[2]) : [], s = scopeOf(`${m[2] ?? ''} ${m[4] ?? ''}`, p), unit = m[1] ? unitOf(m[1], p)?.id ?? null : null
      const tail = norm(m[5] ?? ''), kidsOf = kids.get(p.id) ?? []
      const fig = figureOf(tail)
      // the figure's own words name its topic ("the lot has an area of at least 1,200 square metres and minimum dimensions
      // (width and depth) of at least-" is a lot size, not a width)
      const figTopic = fig ? topicOf(tail.slice(0, (tail.match(/\d[\d,]*(?:\.\d+)?\s*(?::1|m2|m²|square metres|metres|m\b|%)/i)?.index ?? tail.length) + 20)) ?? topicOf(tail) : null
      // a bar on named uses with no figure: outright (nothing after it), or lifted by land the list names ("unless the land-
      // (a) contains a heritage item, or (b) has 2 street frontages, ..."), each item an exclusion - only for an "or" list
      const landList = /^the (land|lot|site)\b/i.test(tail) && kidsOf.length > 0 && kidsOf.every(k => k.connective === 'or' || k === kidsOf[kidsOf.length - 1])
      const named = uses.length > 0 && !m[1] && !m[3], usesX = named ? withMembers(p.document_id, uses) : uses
      // "... on a lot ... if the lot is less than the minimum lot size shown on the Lot Size Map for the land" (Hornsby 6.9(3)):
      // the map's figure is a minimum lot size for the uses
      const lotMap = named ? `${m[4] ?? ''}`.match(/\bif the (?:lot|land|site) is less than the minimum (?:lot )?size shown (?:for the land )?on the ([A-Z][\w ]+? Map)/i) : null
      // a figure the dwellings must stay under ("the gross floor area of at least 1 of the dwellings is less than 200m2")
      const capped = /\bless than\b/i.test(tail) && !/\b(?:not|no) less than\b/i.test(tail)
      if (lotMap) add({ provision_id: p.id, kind: 'standard', uses: usesX, zones: s.zones, terms: s.terms, unit_provision: cl?.id ?? null, topic: 'lot_size', comparator: 'min',
        value_source: `map:${lotMap[1]}`, source: 'text', reader: 'consent standard', span: t.slice(0, 300) })
      else if (fig && figTopic) add({ provision_id: p.id, kind: 'standard', uses, zones: s.zones, terms: s.terms, unit_provision: unit, topic: figTopic, comparator: capped ? 'max' : fig.comparator ?? 'min',
        value: fig.value, unit: fig.unit, value_source: 'text', source: 'text', reader: 'consent bar', span: t.slice(0, 300) })
      // outright: the uses, then only where - land, a zone, a mapped area - and no condition ("if the lot is less than ...",
      // "in a building that contains a dwelling if ...": those are conditions, read below)
      else if (uses.length && !m[3] && !tail && !kidsOf.length && /^\s*(on|in) (land|zone)\b/i.test(m[4] ?? '') && !/\b(if|where|while|unless)\b/i.test(`${m[2] ?? ''} ${m[4] ?? ''}`))
        add({ provision_id: p.id, kind: 'prohibit', uses, zones: s.zones, terms: s.terms, unit_provision: unit, source: 'text', reader: 'consent bar', span: t.slice(0, 300) })
      else if (uses.length && !m[3] && landList)
        add({ provision_id: p.id, kind: 'prohibit', uses, zones: s.zones, terms: s.terms, unit_provision: unit, source: 'text', reader: 'consent bar',
          excludes: kidsOf.map(k => norm([k.own_text, ...(kids.get(k.id) ?? []).map(g => g.own_text)].join(' ')).replace(/[,;.]?\s*(or|and)?$/i, '')).filter(x => x.length > 2),
          span: t.slice(0, 300) })
      else if (named && (LOT_STEM.test(tail) || (!/\bpermitted for an? .+? under another environmental planning instrument/i.test([tail, ...kidsOf.map(k => k.own_text)].join(' ')) && (tail !== '' || kidsOf.length > 0)))) {
        // a bar on named uses lifted by conditions. Each condition is about the lot - a figure on its area or frontage is a
        // standard on the lot ("the area of the lot ... is at least 450 square metres") - or about the proposal, or is the
        // consent authority's judgement: a condition the answer lists, never decides
        const disc = /\bconsent authority (?:is satisfied|is of the opinion|considers|has considered)\b/i.test(tail) ? norm(tail).slice(0, 200) : null
        const consentStd = (k: P, kt: string, uses2: string[], terms: string[], excludes: string[]) => {
          const f = figureOf(kt), topic = topicOf(kt)
          if (disc || !f || (topic !== 'lot_size' && topic !== 'lot_width') || !/^(?:that )?(?:the )?(?:area of the )?(?:lot|land|site)\b/i.test(kt)) return false
          add({ provision_id: k.id, kind: 'standard', topic, comparator: f.comparator ?? 'min', value: f.value, unit: f.unit, uses: uses2, zones: s.zones, terms, excludes,
            value_source: 'text', unit_provision: cl?.id ?? null, source: 'text', reader: 'consent standard', span: `${t.slice(0, 140)} ${kt}`.slice(0, 300) })
          return true
        }
        if (LOT_STEM.test(tail)) {
          // "unless the development is on a lot that is at least- (a) for development in a heritage conservation area- (i) for
          // dual occupancies (attached)-800m2, ... (b) for other development- ..." (Hornsby 4.1C): a nested list of minimum
          // lot sizes - each head a place ("for other development-" is outside its earlier siblings), each leaf a use and its figure
          const walk = (node: P, terms: string[], excludes: string[]) => {
            const seen: string[] = []
            for (const k of kids.get(node.id) ?? []) {
              const kt = norm(k.own_text)
              const leaf = kt.match(/^for (?:an? )?(.+?)\s*[—–-]\s*(?:be )?(?:at least )?(\d[\d,]*(?:\.\d+)?)\s*(m2|m²|square metres)/i)
              if (leaf) {
                const lu = usesOf(leaf[1]!).filter(u => VOCAB.includes(u)), sc = lu.length ? null : scopeOf(leaf[1]!, k)
                add({ provision_id: k.id, kind: 'standard', topic: 'lot_size', comparator: 'min', value: Number(leaf[2]!.replace(/,/g, '')), unit: 'm2', uses: lu.length ? lu : usesX,
                  zones: s.zones, terms: [...terms, ...(sc?.terms ?? [])], excludes, value_source: 'text', unit_provision: cl?.id ?? null, source: 'text', reader: 'consent standard',
                  span: `${t.slice(0, 120)} ${kt}`.slice(0, 300) })
                continue
              }
              const head = kt.match(/^for (.+?)\s*[—–-]\s*$/i); if (!head) continue
              if (/^other development\b/i.test(head[1]!)) walk(k, terms, [...excludes, ...seen])
              else { const sc = scopeOf(head[1]!, k); seen.push(...sc.terms); walk(k, [...terms, ...sc.terms], excludes) }
            }
          }
          walk(p, s.terms, [])
        }
        else for (const k of (kidsOf.length ? kidsOf : [p])) {
          const kt = k === p ? tail : norm([k.own_text, ...(kids.get(k.id) ?? []).map(x => x.own_text)].join(' '))
          if (consentStd(k, kt, usesX, s.terms, [])) continue
          // "the dwellings in the dual occupancy will be attached by at least 80% of the common wall" (North Sydney 6.6(1)(b)):
          // a detached kind of the use can never meet it - barred; for the other kinds it is a fact of the proposal
          if (/\battached by at least\b/i.test(kt)) {
            const det = uses.map(u => `${u} (detached)`).filter(u => VOCAB.includes(u))
            if (det.length) add({ provision_id: k.id, kind: 'prohibit', uses: det, zones: s.zones, terms: s.terms, unit_provision: unit, source: 'text', reader: 'consent bar', span: `${t.slice(0, 140)} ${kt}`.slice(0, 300) })
          }
          add({ provision_id: k.id, kind: 'condition', uses: usesX, zones: s.zones, terms: [...s.terms, ...(disc ? [`discretion:${disc}`] : [])], unit_provision: cl?.id ?? null,
            source: 'text', reader: 'consent condition', span: `${t.slice(0, 140)}${k === p ? '' : ` ${kt}`}`.slice(0, 300) })
        }
      }
      else {
        const leaves = kidsOf.length ? kidsOf : [p]
        for (const k of leaves) {
          const kt = norm([k.own_text, ...(kids.get(k.id) ?? []).map(x => x.own_text)].join(' ')), f = figureOf(kt)
          const xref = kt.match(/permitted for an? (.+?) on the land under another environmental planning instrument/i)
          add({ provision_id: k.id, kind: 'condition', uses, zones: s.zones, terms: [...s.terms, ...(m[3] ? ['proposal:subdivision'] : [])], unit_provision: unit,
            topic: topicOf(kt), comparator: f?.comparator ?? null, value: f?.value ?? null, unit: f?.unit ?? null, value_source: f ? 'text' : null,
            // the cross-reference is a sub-question about another use on this land: its floor area (from a floor-area
            // standard, else FSR x site area), its height, ...
            requires: xref ? [{ standard: topicOf(kt) ?? 'floor_area', use: usesOf(xref[1]!)[0] }] : [],
            source: 'text', reader: 'condition', span: kt.slice(0, 300) })
        }
      }
      continue
    }

    // "If development for the purposes of X is permitted under this Plan, the total floor area ... must not exceed
    // [whichever of the following is the greater-] ..." - a standard on X, its figure in the stem or in each leaf
    m = t.match(/^If development for the purposes? of (.+?) is permitted under this (?:Plan|Policy)((?: on land[^,]*)?),\s*(.+)$/i)
    if (m) {
      const uses = usesOf(m[1]!), where = m[2] ?? '', body = m[3]!, topic = topicOf(body), pick = body.match(/whichever (?:of the following )?is the (greater|lesser)/i)?.[1]?.toLowerCase()
      // "on land other than land in a rural zone": the zones of that defined term are excluded
      const notIn = where.match(/other than land in an? (.+)$/i)?.[1]?.toLowerCase().trim()
      const excludedZones = notIn ? (zoneTerms.get(notIn) ?? [notIn]) : []
      const cmp = /must not exceed|not to exceed|no more than|not .*more than|maximum/i.test(body) ? 'max' : /at least|not less than|minimum/i.test(body) ? 'min' : null
      const leaves = (kids.get(p.id) ?? []).filter(k => figureOf(k.own_text))
      const targets: [P, string][] = leaves.length ? leaves.map(k => [k, norm(k.own_text)]) : figureOf(body) ? [[p, body]] : []
      for (const [k, kt] of targets) {
        const f = figureOf(kt)!
        add({ provision_id: k.id, kind: 'standard', uses, topic, comparator: cmp, value: f.value, unit: f.unit, value_source: 'text', unit_provision: cl?.id ?? null, excludes: excludedZones.map(z => `zone:${z}`),
          band: pick ? { pick, of: p.local_id, relative: /% of/.test(kt) ? norm(kt.replace(/^.*?% of\s*/, '')).replace(/[,.]$/, '') : null } : null,
          source: 'text', reader: 'use standard', span: `${t.slice(0, 200)} ${leaves.length ? '- ' + kt : ''}`.slice(0, 300) })
      }
      if (targets.length) continue
    }

    // map rules
    // the rule itself says the figure binds ("is not to exceed / is not to be less than ... shown ... on the X Map"); a
    // clause that only mentions the map ("a lot ... less than the minimum size shown on the Lot Size Map") is not one
    m = t.match(/(?:is not to exceed|is not to be less than|must not exceed|must not be less than)\s+the\s+(maximum height|floor space ratio|minimum size|maximum floor space ratio)[^.]*?shown (?:for the land )?on the ([A-Z][\w ]+? Map)/i)
    if (m && !/^Despite/i.test(t)) {
      const topic = /height/i.test(m[2]!) ? 'height' : /floor space/i.test(m[2]!) ? 'fsr' : /lot size/i.test(m[2]!) ? 'lot_size' : topicOf(m[1]!)
      const own = t.replace(/\(other than[^)]*\)/gi, '')
      if (topic) add({ provision_id: p.id, kind: 'standard', topic, comparator: topic === 'lot_size' ? 'min' : 'max', value_source: `map:${m[2]}`, unit_provision: cl?.id ?? null,
        terms: [...(/subdivision/i.test(t) ? ['proposal:subdivision'] : []), ...(/strata plan|strata scheme/i.test(own) ? ['tenure:strata'] : []), ...(/Community Land Development Act/i.test(own) ? ['tenure:community'] : [])],
        source: 'text', reader: 'map rule', span: t.slice(0, 300) })
      continue
    }
    // "the maximum height of a dwelling house or semi-detached dwelling on land in Zone R3 ... is 9.5 metres"
    m = t.match(/the (maximum|minimum) (height|floor space ratio|lot size)[^.]*? of (?:a |an )?(.+?) on land in (Zone [A-Z]{1,2}\d[^.]*?) is (\d[\d.]*)\s*(metres|m\b|:1|m2)/i)
    if (m) {
      add({ provision_id: p.id, kind: 'standard', topic: topicOf(m[2]!), comparator: m[1]!.toLowerCase() === 'maximum' ? 'max' : 'min', value: Number(m[5]), unit: /:1/.test(m[6]!) ? 'ratio' : /m2/.test(m[6]!) ? 'm2' : 'm',
        uses: usesOf(m[3]!), zones: zoneCodes(m[4]!), value_source: 'text', unit_provision: cl?.id ?? null, source: 'text', reader: 'standard sentence', span: t.slice(0, 300) })
      continue
    }
    // "The minimum subdivision lot size for any lot resulting from the subdivision of a lot in Zone R3 ... that is being used
    // ... for the purpose of a dwelling house ... is 325 square metres."
    m = t.match(/^The (minimum|maximum) (.{3,80}?) for (.+?) is (\d[\d,]*(?:\.\d+)?)\s*(square metres|m2|metres|m\b|:1)/i)
    if (m && topicOf(m[2]!)) {
      const forUses = [...m[3]!.matchAll(/for the purposes? of (?:an? )?(.+?)(?= or for | that |,|$)/gi)].flatMap(x => usesOf(x[1]!)).filter(u => !/other than/.test(u))
      add({ provision_id: p.id, kind: 'standard', topic: topicOf(m[2]!), comparator: m[1]!.toLowerCase() === 'maximum' ? 'max' : 'min', value: Number(m[4]!.replace(/,/g, '')),
        unit: /:1/.test(m[5]!) ? 'ratio' : /square|m2/i.test(m[5]!) ? 'm2' : 'm', uses: forUses, zones: zoneCodes(m[3]!), value_source: 'text', unit_provision: cl?.id ?? null,
        terms: /subdivision/i.test(t) ? ['proposal:subdivision'] : [], source: 'text', reader: 'standard sentence', span: t.slice(0, 300) })
      continue
    }
    // a figure banded by a condition, under a stem that names the standard: "The maximum height of a building ... is-"
    // (a) "if the land has a street frontage greater than 7 metres but less than 12 metres-16 metres"
    const bstem = norm(p.parent_id ? byId.get(p.parent_id)?.own_text : '')
    if (p.kind === 'paragraph' && /\bis\s*[—-]\s*$/.test(bstem) && topicOf(bstem)) {
      const stem = bstem
      const b = t.match(/^if (?:the )?(?:land|site|lot) has an? ([a-z ]+?) (greater than|more than|at least|not less than|less than|not more than|of)\s*([\d,.]+)\s*(?:square metres|metres|m2|m)?(?:\s+but\s+(less than|not more than)\s*([\d,.]+)\s*(?:square metres|metres|m2|m)?)?\s*[—-]\s*([\d,.]+)\s*(metres|m\b|:1|m2|square metres)/i)
      if (b) {
        const metric = /frontage|width/i.test(b[1]!) ? 'frontage' : /area|size/i.test(b[1]!) ? 'lot_size' : b[1]!.trim()
        const num = (s?: string) => s == null ? null : Number(s.replace(/,/g, ''))
        const lower = /greater|more than|at least|not less/i.test(b[2]!), upper = /less than|not more/i.test(b[2]!)
        const band = { metric, lo: lower ? num(b[3]) : null, lo_incl: /at least|not less/i.test(b[2]!), hi: upper ? num(b[3]) : num(b[5]), hi_incl: /not more/i.test(b[2]! + (b[4] ?? '')) }
        const ss = scopeOf(stem, p)
        add({ provision_id: p.id, kind: 'standard', topic: topicOf(stem), comparator: /maximum/i.test(stem) ? 'max' : /minimum/i.test(stem) ? 'min' : 'max', value: num(b[6])!,
          unit: /:1/.test(b[7]!) ? 'ratio' : /m2|square/i.test(b[7]!) ? 'm2' : 'm', zones: ss.zones, terms: ss.terms, band, value_source: 'text', unit_provision: cl?.id ?? null,
          source: 'text', reader: 'banded standard', span: `${stem.slice(0, 160)} ${t}`.slice(0, 300) })
        continue
      }
    }
    // a figure with a topic in a leaf ("a maximum floor space ratio of 0.65:1", "for a detached secondary dwelling-a minimum site area of 450m2").
    // A figure that says WHERE the standard applies is its condition, not its value: "the gross floor area of each storey ...
    // above a height of 40m will not exceed 700m2" is a 700 m2 floor area for storeys above 40 m
    const condM = t.match(/\b(above|below|over|exceeding|more than|less than)\s+(?:a\s+)?(height|site area|lot size|floor area)\s+of\s+([\d,.]+)\s*(square metres|m2|metres|m)\b/i)
    const tt = condM ? norm(t.replace(condM[0], ' ')) : t
    const condBand = condM ? { metric: /height/i.test(condM[2]!) ? 'height' : /lot|site/i.test(condM[2]!) ? 'lot_size' : 'floor_area',
      ...(/below|less/i.test(condM[1]!) ? { hi: Number(condM[3]!.replace(/,/g, '')) } : { lo: Number(condM[3]!.replace(/,/g, '')) }) } : null
    const stem = norm(p.parent_id ? byId.get(p.parent_id)?.own_text : '')
    // a leaf that is only the figure ("(a) 400m2," under "The area of the parent lot must be at least-", "(b) otherwise-15m"
    // under "The width of the parent lot ... must be at least-"): the stem gives the measure and the direction
    const f0 = figureOf(tt), topic0 = topicOf(tt)
    const stemCmp = /\bat least\b|\bnot (?:be )?less than\b|\bminimum\b/i.test(stem) ? 'min' : /\bnot (?:be )?more than\b|\bmust not exceed\b|\bmaximum\b|\bno more than\b/i.test(stem) ? 'max' : null
    const fromStem = f0 && !f0.comparator && stemCmp && /[—–-]\s*$/.test(stem) && !/\b(if|unless|where)\s*[—–-]\s*$/i.test(stem) && (topic0 ?? topicOf(stem))
    const f = fromStem ? { ...f0!, comparator: stemCmp! } : f0
    // "50% of the minimum landscaped area must be located behind the building line": a share of the measure says where
    // it goes, not how much it is - its own topic, so it never answers for the measure
    const topic1 = fromStem ? (topic0 ?? topicOf(stem)) : topic0
    const topic = topic1 && f?.unit === '%' && new RegExp(`% of the (?:minimum |maximum )?(?:${topic1 === 'landscaping' ? 'landscaped area' : topic1 === 'floor_area' ? '(?:gross )?floor area' : topic1.replace('_', ' ')})`, 'i').test(tt) ? `${topic1}_share` : topic1
    // a leaf of a condition list ("... is 22 metres if-", "... unless-", "This clause applies to development on land-")
    // states when something applies, not a standard
    // - and so does the list of a discretionary grant ("may approve development with a floor space ratio of up to 1.3:1 ... but
    // only if the consent authority is satisfied that- (b) that part ... will have an area of at least 5,000m2"): its items
    // are the conditions of that grant, never standards of their own
    // Every stem up to the clause is read, not only the nearest: "(2) The floor space ratio ... may exceed the ratio shown ...
    // if the building is used for- (b) another land use- (ii) with a floor area at least equal to a floor space ratio of
    // 0.5:1" is a condition of (2)'s exceedance two levels down, never a 0.5:1 maximum (Parramatta 4.4A(2))
    const stems: string[] = []
    for (let x = p.parent_id ? byId.get(p.parent_id) : undefined; x && x.id !== cl?.id; x = x.parent_id ? byId.get(x.parent_id) : undefined) stems.push(norm(x.own_text))
    // (and a list of what a standard does NOT apply to - "do not apply to the following if they are at least 450mm from the
    // boundary- (j) rainwater tanks not more than 1.8m in height": the items are exceptions, never standards)
    const isConditionStem = (s: string) => /\b(if|unless|where|only if)\s*[—-]\s*$/i.test(s) || /\bapplies (only )?to\b[^—]*[—-]\s*$/i.test(s)
      || /\bmay\b[^—]*\b(?:if|only if|unless|provided)\b[^—]*[—-]\s*$/i.test(s) || /\b(?:do|does) not apply to\b[^—]*[—-]\s*$/i.test(s)
    const conditionList = stems.some(isConditionStem)
    if (f && topic && f.comparator && p.kind === 'paragraph' && t.length < 260 && !/^(if|where|in the case)\b/i.test(t) && !conditionList) {
      // "for a detached secondary dwelling-" names a use only when the words are a known land use; "for a lot with an area
      // of at least 450m2 but not more than 900m2-" is a band on the lot, and "for a battle-axe lot-" is neither
      const forM = t.match(/^for (?:an? )?(.+?)\s*[—-]/)
      const forKnown = forM ? usesOf(forM[1]!.replace(/^detached /, '')).filter(u => VOCAB.includes(u)) : []
      const forUse = forKnown.length ? forM : null
      const lotBand = forM?.[1]?.match(/^lot with an area of (at least|more than) ([\d,.]+)\s*m2(?: but (not more than|less than) ([\d,.]+)\s*m2)?/i)
      // the stem can name the use: "if the subdivision is of a lot on which there is a dual occupancy-"
      const stemUse = stem.match(/\bon which there is an? (.+?)\s*[—-]\s*$/i)?.[1] ?? stem.match(/\bfor the purposes? of (.+?)\s*[—-]\s*$/i)?.[1]
      // and the title type, from the leaf, its stem or the clause's own words ("for a strata plan scheme")
      const tenure = [...(/strata plan|strata scheme/i.test(`${t} ${stem}`) ? ['tenure:strata'] : []), ...(/Community Land Development Act/i.test(`${t} ${stem}`) ? ['tenure:community'] : [])]
      add({ provision_id: p.id, kind: 'standard', topic, comparator: f.comparator, value: f.value, unit: f.unit, uses: forUse ? forKnown : stemUse ? usesOf(stemUse) : [],
        band: lotBand ? { metric: 'lot_size', lo: Number(lotBand[2]!.replace(/,/g, '')), lo_incl: /at least/i.test(lotBand[1]!), hi: lotBand[4] ? Number(lotBand[4].replace(/,/g, '')) : null, hi_incl: /not more/i.test(lotBand[3] ?? '') } : condBand,
        terms: [...tenure, ...(forUse && /detached/i.test(forUse[1]!) ? ['detached'] : []), ...(/resulting lot|subdivision/i.test(`${t} ${stem}`) || /subdivision/i.test(cl?.heading ?? '') ? ['proposal:subdivision'] : [])],
        non_discretionary: ndStem(p), value_source: 'text', unit_provision: cl?.id ?? null, source: 'text', reader: 'standard leaf', span: t.slice(0, 300) })
    }
  }

  // ── control tables: every body row, captions -> scope ─────────────────────────────────────────────
  // a band column: "≥ 950m2" / "< 450m2" (the LEPs), "6m–18m", ">18m–24m", ">24m", "200m2–900m2", ">1,500m2", "6–10m" (the
  // codes, by lot width at the building line or by lot area). A lot's width is its primary frontage (the rule every test
  // here uses); a column on another measure (a building height, a primary road setback) is a band the lot's facts do not
  // hold - kept by name, answered "unknown" on a lot
  const bandMetric = (cap: string) => /lot width|width of (?:the )?(?:parent )?lot|lot frontage/i.test(cap) ? 'frontage' : /lot (?:area|size)|site area|landholding area|area of the lot/i.test(cap) ? 'lot_size' : cap.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const bandOf = (s: string, cap = 'lot size') => {
    const metric = bandMetric(cap), n = (x: string) => Number(x.replace(/,/g, ''))
    let m = s.match(/^\s*(≥|>)?\s*(\d[\d,.]*)\s*(?:m2|m²|m|ha)?\s*[–\-]\s*(\d[\d,.]*)\s*(?:m2|m²|m|ha)?\s*$/)
    if (m) return { metric, lo: n(m[2]!), lo_incl: m[1] !== '>', hi: n(m[3]!), hi_incl: true }
    m = s.match(/^\s*(≥|>|more than|at least)\s*(\d[\d,.]*)\s*(?:m2|m²|m|ha)?\s*$/i)
    if (m) return { metric, lo: n(m[2]!), lo_incl: /≥|at least/i.test(m[1]!), hi: null, hi_incl: false }
    m = s.match(/^\s*(≤|<|less than|up to|not more than)\s*(\d[\d,.]*)\s*(?:m2|m²|m|ha)?\s*$/i)
    if (m) return { metric, lo: null, lo_incl: false, hi: n(m[2]!), hi_incl: /≤|up to|not more/i.test(m[1]!) }
    const lo = s.match(/(≥|>)\s*(\d[\d,.]*)/), hi = s.match(/(≤|<)\s*(\d[\d,.]*)/)
    return lo || hi ? { metric, lo: lo ? n(lo[2]!) : null, lo_incl: lo?.[1] === '≥', hi: hi ? n(hi[2]!) : null, hi_incl: hi?.[1] === '≤' } : null
  }
  for (const tb of provs.filter(p => p.kind === 'table')) {
    const holder = tb.parent_id ? byId.get(tb.parent_id)! : tb
    if (/^sch\./.test(holder.local_id) && ['part', 'schedule'].includes(holder.kind)) continue      // a register, not a control
    const above: string[] = []
    for (const r of (kids.get(tb.id) ?? []).filter(r => r.kind === 'row' && r.heading !== 'head')) {
      const cells = (kids.get(r.id) ?? []).filter(c => c.kind === 'cell')
      const vals = cells.map((c, i) => { const v = norm(c.own_text) || above[i] || ''; above[i] = v; return { cap: norm(c.heading).toLowerCase(), v, id: c.id } })
      // the band column: a caption that names a measure of the lot ("Lot width at the building line", "Lot area") with a
      // range in the cell; the value columns are every other cell with a figure (a codes table can carry two or three -
      // "Side A | Side B", "Building height at any point | Minimum required setback")
      const isBandCap = (cap: string) => /^(lot|site|landholding|parent lot)\b.*\b(width|area|size|frontage)\b|^width of|^(building|wall) height|^height of|^setback of|^primary road setback|^building footprint|^land use zone/i.test(cap)
      // the lot's own band first (its width or area); any other band column ("Building height at any point", "Setback of
      // dwelling house from primary road") is a fact of the proposed building the row turns on
      const bandCells = vals.filter(v => isBandCap(v.cap) && bandOf(v.v, v.cap))
      const bandCell = bandCells.find(v => ['frontage', 'lot_size'].includes(bandMetric(v.cap))) ?? bandCells[0]
      const factCells = bandCells.filter(v => v !== bandCell)
      const useCell = vals.find(v => /land use|\buse\b|purpose/.test(v.cap) && !bandCells.includes(v)), zoneCell = vals.find(v => /zone/.test(v.cap) && !bandCells.includes(v))
      // a column of map labels ("Area 3", "Area 6") under a stem that says where they are drawn ("in an area specified in
      // Column 1 ... and identified on the Floor Space Ratio Map", Hornsby 4.4(2A)): each row binds to its area's polygons
      const areaCell = vals.find(v => v !== bandCell && (/^area$/.test(v.cap) || /^area \w+$/i.test(v.v)) && !figureOf(v.v))
      const mapName = areaCell ? norm(holder.own_text).match(/\b(?:identified|shown|marked)\b[^.]*?\bon the ([A-Z][\w ]*? Map)\b/)?.[1] : null
      const holderText = norm(holder.own_text)
      const valueCells = vals.filter(v => !bandCells.includes(v) && v !== useCell && v !== zoneCell && v !== areaCell && cellValue(v.v))
      if (!valueCells.length) continue
      for (const valueCell of valueCells) {
        const cv = cellValue(valueCell.v)!
        // the topic from the column's caption; a bare caption ("Side A") takes the stem's subject ("a setback from each side
        // boundary"), and so does the comparator
        const topic = topicOf(valueCell.cap) ?? topicOf(`${holderText} ${valueCell.cap}`); if (!topic) continue
        const comparator = /maximum/i.test(valueCell.cap) ? 'max' : /minimum/i.test(valueCell.cap) ? 'min' : cv.comparator ?? (/must not exceed|maximum|no more than/i.test(holderText) ? 'max' : /at least|minimum|not less than/i.test(holderText) ? 'min' : 'max')
        add({ provision_id: valueCell.id, kind: 'standard', topic, comparator, value: cv.value, unit: cv.unit,
          uses: useCell ? usesOf(useCell.v) : [], zones: zoneCell ? zoneCodes(zoneCell.v.replace(/^(?=[A-Z]{1,2}\d)/, 'Zone ')) : [], band: bandCell ? bandOf(bandCell.v, bandCell.cap) : cv.band,
          terms: [...(areaCell && mapName ? [`mapped:${areaCell.v} on the ${mapName}`] : []), ...(cv.band && bandCell ? [`formula:${JSON.stringify(cv.band)}`] : []), ...(/side a\b/i.test(valueCell.cap) ? ['side:a'] : /side b\b/i.test(valueCell.cap) ? ['side:b'] : []),
            ...factCells.map(v => `fact:${v.cap} ${v.v}`)],
          value_source: 'table', unit_provision: clauseOf(holder)?.id ?? null, source: 'text', reader: 'table row', span: vals.map(v => `${v.cap}: ${v.v}`).join('; ') })
      }
    }
  }

  // ── where and when a standard applies, from its own words and the stems it hangs from ───────────────
  // "The maximum floor space ratio for all buildings on land identified as "Area 5" on the Floor Space Ratio Map is 6:1 if
  // the consent authority is satisfied ..." (Parramatta 4.4A(5)); "... on land ... identified as "Area C" ... is 2:1 if the
  // site area is at least 2,000m2" (6.21(3)); a table whose subclause says "on land identified as "Area 1" on the Height of
  // Buildings Map must not exceed the height determined in accordance with the table" (4.3(2A)). A standard read with its
  // figure but none of that would hold on every lot of the plan. So each standard with no place of its own takes the map
  // areas and zones its text and its stems (up to the clause) name, a site-area floor as a band, and a consent-authority
  // condition as discretion - the same readers the frames use (scopeOf), so a new plan's wording needs no new rule
  const under = (id: string, root: string) => { for (let x = byId.get(id); x; x = x.parent_id ? byId.get(x.parent_id) : undefined) if (x.id === root) return true; return false }
  // Only the readers that take a figure from a sentence or a cell without reading where it applies; a consent bar, a
  // subdivision exception or a map rule read their own scope and conditions (a "satisfied" in 4.1B(3) is about the
  // existing dual occupancy the question states, not a condition on its figure)
  const BARE = new Set(['standard sentence', 'standard leaf', 'table row', 'use standard', 'banded standard'])
  let placed = 0
  for (const c of claims) {
    if (c.kind !== 'standard' || !BARE.has(c.reader) || (c.terms ?? []).some(t => t.startsWith('mapped:') || t.startsWith('discretion:'))) continue
    const p0 = byId.get(c.provision_id); if (!p0) continue
    const cl = clauseOf(p0)
    const chain: P[] = []
    for (let x: P | undefined = p0; x && x.id !== cl?.id; x = x.parent_id ? byId.get(x.parent_id) : undefined) chain.push(x)
    const own = chain.filter(x => !['cell', 'row', 'table'].includes(x.kind)).map(x => norm(x.own_text)).filter(Boolean)
    if (!own.length) continue
    const text = own.join(' ')
    const sc = scopeOf(text, p0)
    const mapped = sc.terms.filter(t => t.startsWith('mapped:'))
    // the thing the figure is a measure of: "The maximum height of the floor level of the balcony, deck, patio, terrace or
    // verandah is ..." is not a standard on the dwelling house. A sentence (own or stem) that opens with the measure names
    // its subject after "of" / "for"; a subject that is a listed use is that use, one that is any building or development
    // at all is no restriction, and any other is kept by its own words so a question about a use never meets it
    if (!c.uses?.length) {
      // ("The maximum height for a dwelling house ...", "The height of a wall erected within 900mm of a side boundary must not exceed-")
      const subj = own.map(s => s.match(/^The (?:maximum |minimum )?(?:building |gross |site |total )?(?:height|floor area|floor space ratio|setback|landscaped area|width|length|area|footprint|site coverage|number of storeys)(?: of| for) (?:an? |the |all |any )?(.+?)(?= is | must | on a lot| that | shown|,|$)/i)?.[1]).find(Boolean)
      if (subj && !/^(buildings?|development|structures?|works?|lots?|dwellings?)\b/i.test(subj)) {
        const known = usesOf(subj).filter(u => VOCAB.includes(u))
        c.uses = known.length ? known : subj.toLowerCase().split(/,\s*|\s+or\s+|\s+and\s+/).map(x => x.replace(/^(the |an? )/, '').trim()).filter(x => x.length > 2).slice(0, 6)
      }
    }
    // "if the site area is at least 2,000m2": a floor on the lot the figure applies to
    const floor = text.match(/\bif the (?:site|lot) area is (?:at least|not less than|more than) ([\d,]+(?:\.\d+)?)\s*(?:m2|m²|square metres)/i)
    const disc = text.match(/\bif the consent authority is (?:satisfied|of the opinion)\b.*$/i)
    if (!mapped.length && !floor && !disc && !sc.zones.length) continue
    c.terms = [...new Set([...(c.terms ?? []), ...mapped, ...(disc ? [`discretion:${norm(disc[0]).slice(0, 200)}`] : [])])]
    if (!c.zones?.length && sc.zones.length) c.zones = sc.zones
    if (floor && !c.band) c.band = { metric: 'lot_size', lo: Number(floor[1]!.replace(/,/g, '')), lo_incl: !/more than/i.test(floor[0]), hi: null, hi_incl: false }
    placed++
  }
  console.log('standards given their place or condition from their stems:', placed)

  // an exception "Despite subclause (3), ..." is about what (3) is about: its standards take (3)'s title-type terms
  const despite = (await q(`SELECT from_provision, to_provision FROM rag.relation WHERE kind = 'despite' AND to_provision IS NOT NULL`)).rows
  for (const d of despite) {
    const from = byId.get(d.from_provision), to = byId.get(d.to_provision); if (!from || !to || from.document_id !== to.document_id || clauseOf(from)?.id !== clauseOf(to)?.id) continue
    const inherited = [...new Set(claims.filter(c => c.kind === 'standard' && under(c.provision_id, to.id)).flatMap(c => (c.terms ?? []).filter(t => t.startsWith('tenure:'))))]
    if (!inherited.length) continue
    for (const c of claims) if (c.kind === 'standard' && under(c.provision_id, from.id)) c.terms = [...new Set([...(c.terms ?? []), ...inherited])]
  }

  // "Subclause (2) does not apply to land identified as "Area 3" on the Lot Size Map" (Ku-ring-gai 6.6(2A)): the subclause's
  // claims exclude that map area
  for (const d of dis) {
    const from = byId.get(d.from_provision), to = byId.get(d.to_provision); if (!from || !to) continue
    const tail = norm(from.own_text).match(/(?:does|do) not apply to (?:any )?land (?:identified|shown|marked) as (.+?) on the ([A-Z][\w ]*? Map)\.?$/i)
    if (!tail) continue
    const area = `mapped:${norm(tail[1]).replace(/[“”"]/g, '')} on the ${tail[2]}`
    for (const c of claims) if (c.kind !== 'frame' && (c.provision_id === to.id || under(c.provision_id, to.id))) c.excludes = [...new Set([...(c.excludes ?? []), area])]
  }

  // a claim inside an exempt or complying development code binds only on that pathway, never a development application:
  // a Part headed "... Code" of the codes policy, or a schedule headed "complying development" (the Housing SEPP's)
  for (const c of claims) {
    const at = byId.get(c.provision_id)!
    const code = codeOf(at) ?? up(at, x => /complying development|exempt development/i.test(x.heading ?? ''))
    if (code && c.kind !== 'frame' && !(c.terms ?? []).some(t => t.startsWith('pathway:'))) c.terms = [...(c.terms ?? []), `pathway:${codeUnits.includes(code) ? pathwayOfUnit(code) : /exempt/i.test(code.heading ?? '') ? 'exempt' : 'complying'}`]
  }

  // a permission its own sentence makes the consent authority's to give ("... is permitted with development consent if the
  // consent authority is satisfied that- (a) ...", North Sydney Sch 1 item 50): it depends, never a flat yes
  for (const c of claims) {
    if (c.kind !== 'permit' || (c.terms ?? []).some((t: string) => t.startsWith('discretion:'))) continue
    const own = norm(byId.get(c.provision_id)?.own_text)
    const m = own.match(/\b(?:only )?if the consent authority is (?:satisfied|of the opinion)\b.*$/i)
    if (m) c.terms = [...(c.terms ?? []), `discretion:${m[0].slice(0, 200)}`]
  }

  // the figures no reader took: a provision whose words carry a measure (m, m2, :1, %) with no claim on it or under it - so
  // a new instrument's unread sentence forms show at build time, not when a question fails (rag.unread, reader 'claims')
  const claimed = new Set(claims.map(c => c.provision_id))
  const hasClaimBelow = (p: P): boolean => claimed.has(p.id) || (kids.get(p.id) ?? []).some(hasClaimBelow)
  const MEASURE = /\b\d[\d,]*(?:\.\d+)?\s*(?:m2|square metres|metres|m\b|:1|%)/i
  const unreadFigures = provs.filter(p => !['term', 'cell', 'row', 'table', 'group', 'definition', 'objective'].includes(p.kind) && !p.path.some(x => x.startsWith('pt-cg'))
    && MEASURE.test(p.own_text) && !hasClaimBelow(p) && !(p.parent_id && claimed.has(p.parent_id)))
  console.log('figures no reader took:', unreadFigures.length)
  const tally = claims.reduce((a: Record<string, number>, c) => ({ ...a, [`${c.kind}/${c.reader}`]: (a[`${c.kind}/${c.reader}`] ?? 0) + 1 }), {})
  console.log('claims', claims.length, tally)
  const show = (local: string) => { for (const c of claims.filter(c => byId.get(c.provision_id)?.local_id.startsWith(local))) console.log(' ', byId.get(c.provision_id)!.local_id.padEnd(28), c.kind.padEnd(9), JSON.stringify({ uses: c.uses, zones: c.zones, terms: c.terms, req: c.requires, ex: c.excludes?.length, topic: c.topic, cmp: c.comparator, v: c.value, u: c.unit, src: c.value_source, band: c.band, nd: c.non_discretionary, unit: c.unit_provision ? byId.get(c.unit_provision)?.local_id : null }).slice(0, 300)) }
  for (const l of ['sec.50', 'sec.52', 'sec.53', 'sec.166', 'sec.168', 'sec.164', 'sec.4.1C', 'sec.4.3-', 'sec.4.4-', 'sec.4.4A-ssec.2#t1r2']) show(l)
  if (DRY) { await client.end(); return }
  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('claims', '{}') RETURNING id`)).rows[0].id
  await q(`DELETE FROM rag.claim`)
  for (let i = 0; i < claims.length; i += 2000)
    await q(`INSERT INTO rag.claim (provision_id, kind, consent, uses, zones, terms, excludes, requires, topic, comparator, value, unit, value_source, band, non_discretionary, unit_provision, source, span, reader, run_id)
             SELECT provision_id, kind, consent, coalesce(uses, '{}'), coalesce(zones, '{}'), coalesce(terms, '{}'), coalesce(excludes, '{}'), coalesce(requires, '[]'), topic, comparator, value, unit, value_source, band,
                    coalesce(non_discretionary, false), unit_provision, source, span, reader, $2
               FROM jsonb_to_recordset($1::jsonb) AS x(provision_id uuid, kind text, consent text, uses text[], zones text[], terms text[], excludes text[], requires jsonb, topic text, comparator text,
                    value numeric, unit text, value_source text, band jsonb, non_discretionary boolean, unit_provision uuid, source text, span text, reader text)`, [JSON.stringify(claims.slice(i, i + 2000)), run])
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ claims: claims.length, by: tally })])
  await q(`DELETE FROM rag.unread WHERE reader = 'claims'`)
  if (unreadFigures.length) await q(`INSERT INTO rag.unread (provision_id, reader, trigger, span, note, run_id)
           SELECT provision_id, 'claims', 'figure', span, note, $2 FROM jsonb_to_recordset($1::jsonb) AS x(provision_id uuid, span text, note text)`,
    [JSON.stringify(unreadFigures.map(p => ({ provision_id: p.id, span: norm(p.own_text).slice(0, 300), note: 'a measure in the text that no claim reader took' }))), run])
  await q('COMMIT')
  console.log('written', claims.length)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
