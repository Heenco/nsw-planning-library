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
 *                    550 m2); a list under it is a set of conditions (limitations), each with its figures and any
 *                    cross-reference to another instrument read as a sub-question
 *   standards        a figure with a topic ("a maximum floor space ratio of 0.65:1"), a map rule ("shown for the land
 *                    on the Height of Buildings Map"), a "the maximum height of X on land in Zone R3 is 9.5 metres"
 *                    sentence, and every row of a control table (captions -> use, zone, lot-size band, figure)
 */
import 'dotenv/config'
import pg from 'pg'
import { landUseKey } from '../../shared/land-use-key'

const DRY = process.argv.includes('--dry')
interface P { id: string; document_id: string; parent_id: string | null; local_id: string; kind: string; heading: string | null; own_text: string; sort: number; ordinal: number | null; path: string[] }
interface Claim { provision_id: string; kind: string; consent?: string | null; uses?: string[]; zones?: string[]; terms?: string[]; excludes?: string[]; requires?: any[]
  topic?: string | null; comparator?: string | null; value?: number | null; unit?: string | null; value_source?: string | null; band?: any; non_discretionary?: boolean
  unit_provision?: string | null; source: string; span?: string | null; reader: string }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const ZONE = /\bZone\s+([A-Z]{1,2}\d{1,2}[A-Z]?)\b/g
const zoneCodes = (t: string) => [...new Set([...t.matchAll(ZONE)].map(m => m[1]!))]

/** what a figure is about */
function topicOf(t: string): string | null {
  const s = t.toLowerCase()
  if (/floor space ratio/.test(s)) return 'fsr'
  if (/height/.test(s)) return 'height'
  if (/\bwide\b|width|frontage/.test(s)) return 'lot_width'
  if (/lot size|site area|area of (the|each|any) (resulting )?lot|lot must have an area|size of (any|each) lot|area of at least/.test(s)) return 'lot_size'
  if (/floor area/.test(s)) return 'floor_area'
  if (/parking|car space/.test(s)) return 'parking'
  if (/landscap/.test(s)) return 'landscaping'
  return null
}
/** "a maximum ... of 0.65:1" / "no more than 60m2" / "at least 225m2" / "9.5 metres" */
function figureOf(t: string): { comparator: string | null; value: number; unit: string } | null {
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(:1|m2|m²|square metres|metres|m\b|%|spaces?|storeys?)/i); if (!m) return null
  const unit = /:1/.test(m[2]!) ? 'ratio' : /m2|m²|square/i.test(m[2]!) ? 'm2' : /metres|^m$/i.test(m[2]!) ? 'm' : m[2]!.toLowerCase()
  const comparator = /maximum|no more than|not (?:be |to be )?more than|not (?:to )?exceed|must not exceed|up to/i.test(t) ? 'max'
    : /minimum|at least|not (?:be |to be )?less than|no less than/i.test(t) ? 'min' : null
  return { comparator, value: Number(m[1]!.replace(/,/g, '')), unit }
}
/** "dual occupancies or semi-detached dwellings", "a secondary dwelling", "multi dwelling housing or attached dwellings" */
const usesOf = (phrase: string) => norm(phrase).replace(/^(a|an|the)\s+/i, '').split(/,\s*|\s+or\s+|\s+and\s+/)
  .map(u => u.replace(/^(a|an|the)\s+/i, '').trim()).filter(u => u && u.length < 60 && !/\bzone\b|\bland\b/i.test(u)).map(landUseKey)

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const insts = (await q(`SELECT document_id, title, kind FROM rag.instrument`)).rows
  const provs: P[] = (await q(`SELECT id, document_id, parent_id, local_id, kind, heading, coalesce(own_text, '') own_text, sort, ordinal, coalesce(path, '{}') path FROM rag.provision`)).rows
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
  const scopeTerms = [...new Set(terms.map(t => norm(t.heading).toLowerCase()).filter(h => h.split(' ').length >= 3 && !zoneTerms.has(h)))].sort((a, b) => b.length - a.length)
  /** zones, scope terms and sub-questions in a phrase about where / when something applies */
  const scopeOf = (phrase: string) => {
    const zones = zoneCodes(phrase), tms: string[] = [], requires: any[] = []
    for (const [term, z] of zoneTerms) if (new RegExp(`\\bin an? ${term}\\b`, 'i').test(phrase)) zones.push(...z)
    for (const term of scopeTerms) if (new RegExp(`\\b(in|on|within) an? ${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(phrase)) tms.push(term)
    for (const m of phrase.matchAll(/\bif development for the purposes of (.+?) is permissible on the land under another environmental planning instrument/gi))
      requires.push({ permissible: usesOf(m[1]!)[0] })
    // land a map marks ("shown as Area 1 on the Key Sites Map", "identified as "Y1" or "Y2" on the ... Map") and land
    // named by its lot ("Lot 1, DP 433534")
    for (const m of phrase.matchAll(/\b(?:shown|identified|marked) as (.+?) on the ([A-Z][\w ]*? Map)/g)) tms.push(`mapped:${norm(m[1]).replace(/[“”"]/g, '')} on the ${m[2]}`)
    // title type: a community title subdivision is "under the Community Land Development Act"; a strata one is "by the
    // registration of a strata plan" / "for a strata plan scheme"; "but does not apply to ..." excludes it
    const notPart = phrase.match(/\bbut does not apply to (.+)$/i)?.[1] ?? ''
    const own = notPart ? phrase.slice(0, phrase.length - notPart.length) : phrase
    if (/Community Land Development Act/i.test(own)) tms.push('tenure:community')
    if (/strata plan|strata scheme/i.test(own)) tms.push('tenure:strata')
    if (/strata/i.test(notPart)) tms.push('!tenure:strata')
    if (/Community Land Development/i.test(notPart)) tms.push('!tenure:community')
    tms.push(...datesOf(phrase))
    for (const m of phrase.matchAll(/\bLot (\w+),?\s*(?:Section (\w+),?\s*)?DP\s*(\d+)/g)) tms.push(`lot:${m[1]}/${m[2] ?? ''}/DP${m[3]}`)
    return { zones: [...new Set(zones)], terms: tms, requires }
  }

  // ── land use tables: the resolved table, anchored on the zone's item ─────────────────────────────
  for (const inst of insts.filter(i => i.kind === 'lep')) {
    const rows = (await q(`SELECT zone_id, zone_code, land_use, status, basis, derived_from, source_text FROM nsw.lep_permissibility WHERE epi_name = $1 AND level = 'leaf'`, [inst.title])).rows
    const ITEM: Record<string, RegExp> = { permitted_without_consent: /without consent/i, permitted_with_consent: /^permitted with consent/i, prohibited: /^prohibited/i }
    for (const r of rows) {
      const grp = local(inst.document_id, r.zone_id)
      const item = grp ? (kids.get(grp.id) ?? []).find(k => ITEM[r.status]?.test(norm(k.heading))) : null
      if (!item) continue
      add({ provision_id: item.id, kind: r.status === 'prohibited' ? 'prohibit' : 'permit', consent: r.status === 'permitted_without_consent' ? 'without' : r.status === 'prohibited' ? null : 'with',
        uses: [landUseKey(r.land_use)], zones: [r.zone_code], source: 'lep_permissibility', reader: 'land use table',
        span: `${r.basis}: ${r.source_text ?? r.derived_from ?? r.land_use}` })
    }
  }

  // ── frames: from every applies_only_if relation ───────────────────────────────────────────────────
  const frames = (await q(`SELECT from_provision, to_provision, scope FROM rag.relation WHERE kind = 'applies_only_if' AND to_provision IS NOT NULL`)).rows
  for (const f of frames) {
    const phrase = norm(f.scope?.phrase), conds: string[] = f.scope?.conditions ?? []
    const usesM = phrase.match(/^development (?:for the purposes of|involving subdivision for the purposes of) (.+?)(?=\s+(?:on land|in a |in the following|in Zone|if |on a lot|$))/i)
    const s = scopeOf(phrase)
    const condZones = conds.flatMap(zoneCodes)
    // "This section applies only if- (a) ... on or after <date>, or (b) ..." - the dates in the list are alternatives
    const condDates = conds.flatMap(c => datesOf(c))
    const dateTerm = condDates.length ? [`date:${condDates.join('|')}`] : []
    add({ provision_id: f.to_provision, kind: 'frame', unit_provision: f.from_provision, uses: usesM ? usesOf(usesM[1]!) : [],
      zones: [...new Set([...s.zones, ...(/following zones/i.test(phrase) ? condZones : [])])], terms: [...s.terms.filter(x => !/^(consent|combined_da)/.test(x)), ...s.terms.filter(x => /^(consent|combined_da)/.test(x)).map(x => `date:${x}`), ...dateTerm, ...(/subdivision/i.test(phrase) ? ['proposal:subdivision'] : [])],
      requires: s.requires, excludes: /other than the following/i.test(phrase) ? conds.map(c => norm(c).replace(/[,.;]+$/, '')).filter(Boolean) : [],
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

  // ── permissions, consent bars, standards: sentence readers over every provision ─────────────────────
  for (const p of provs) {
    if (['term', 'cell', 'row', 'table', 'group'].includes(p.kind) || p.path.some(x => x.startsWith('pt-cg'))) continue
    const t = norm(p.own_text); if (!t) continue
    const cl = clauseOf(p)
    const ndStem = (x: P | null): boolean => !!x && (/non-discretionary development standards/i.test(x.own_text) || (x.parent_id ? ndStem(byId.get(x.parent_id)!) : false))

    // permissions
    let m = t.match(/^Development for the purposes of (.+?) is permitted with(out)? (?:development )?consent(.*)$/i)
    if (m) {
      const s = scopeOf(m[3]!), unitM = m[3]!.match(/on land to which this (chapter|Part|Division|section|clause) applies/i)
      add({ provision_id: p.id, kind: 'permit', consent: m[2] ? 'without' : 'with', uses: usesOf(m[1]!), zones: s.zones, terms: s.terms, requires: s.requires,
        unit_provision: unitM ? unitOf(unitM[1]!, p)?.id ?? null : null, source: 'text', reader: 'permission', span: t.slice(0, 300) })
      continue
    }
    m = t.match(/^Development to which this (chapter|Part|Division|section|clause) applies may be carried out with(out)? (?:development )?consent/i)
    if (m) { add({ provision_id: p.id, kind: 'permit', consent: m[2] ? 'without' : 'with', unit_provision: unitOf(m[1]!, p)?.id ?? null, source: 'text', reader: 'permission', span: t.slice(0, 300) }); continue }

    // consent bars: a figure is a standard, a list is a set of conditions
    m = t.match(/^Development consent must not be granted (?:to|for) (?:the )?(?:development (?:to which this (chapter|Part|Division|section|clause) applies|for the purposes of (.+?)(?= on | unless|,|$))|(subdivision)[^,]*?)(.*?)(?:unless\b(.*))?$/i)
    if (m) {
      const uses = m[2] ? usesOf(m[2]) : [], s = scopeOf(`${m[4] ?? ''}`), unit = m[1] ? unitOf(m[1], p)?.id ?? null : null
      const tail = norm(m[5] ?? ''), kidsOf = kids.get(p.id) ?? []
      const fig = figureOf(tail)
      if (fig && topicOf(tail)) add({ provision_id: p.id, kind: 'standard', uses, zones: s.zones, terms: s.terms, unit_provision: unit, topic: topicOf(tail), comparator: fig.comparator ?? 'min',
        value: fig.value, unit: fig.unit, value_source: 'text', source: 'text', reader: 'consent bar', span: t.slice(0, 300) })
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
    m = t.match(/^If development for the purposes of (.+?) is permitted under this (?:Plan|Policy)((?: on land[^,]*)?),\s*(.+)$/i)
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
    // a figure with a topic in a leaf ("a maximum floor space ratio of 0.65:1", "for a detached secondary dwelling-a minimum site area of 450m2")
    const f = figureOf(t), topic = topicOf(t)
    // a leaf of a condition list ("... is 22 metres if-", "... unless-", "This clause applies to development on land-")
    // states when something applies, not a standard
    const stem = norm(p.parent_id ? byId.get(p.parent_id)?.own_text : '')
    const conditionList = /\b(if|unless|where|only if)\s*[—-]\s*$/i.test(stem) || /\bapplies (only )?to\b[^—]*[—-]\s*$/i.test(stem)
    if (f && topic && f.comparator && p.kind === 'paragraph' && t.length < 260 && !/^(if|where|in the case)\b/i.test(t) && !conditionList) {
      const forUse = t.match(/^for (?:an? )?(.+?)\s*[—-]/)
      // the stem can name the use: "if the subdivision is of a lot on which there is a dual occupancy-"
      const stemUse = stem.match(/\bon which there is an? (.+?)\s*[—-]\s*$/i)?.[1] ?? stem.match(/\bfor the purposes of (.+?)\s*[—-]\s*$/i)?.[1]
      // and the title type, from the leaf, its stem or the clause's own words ("for a strata plan scheme")
      const tenure = [...(/strata plan|strata scheme/i.test(`${t} ${stem}`) ? ['tenure:strata'] : []), ...(/Community Land Development Act/i.test(`${t} ${stem}`) ? ['tenure:community'] : [])]
      add({ provision_id: p.id, kind: 'standard', topic, comparator: f.comparator, value: f.value, unit: f.unit, uses: forUse ? usesOf(forUse[1]!.replace(/^detached /, '')) : stemUse ? usesOf(stemUse) : [],
        terms: [...tenure, ...(forUse && /detached/i.test(forUse[1]!) ? ['detached'] : []), ...(/resulting lot|subdivision/i.test(`${t} ${stem}`) || /subdivision/i.test(cl?.heading ?? '') ? ['proposal:subdivision'] : [])],
        non_discretionary: ndStem(p), value_source: 'text', unit_provision: cl?.id ?? null, source: 'text', reader: 'standard leaf', span: t.slice(0, 300) })
    }
  }

  // ── control tables: every body row, captions -> scope ─────────────────────────────────────────────
  const bandOf = (s: string) => {
    const lo = s.match(/(≥|>)\s*(\d[\d,.]*)/), hi = s.match(/(≤|<)\s*(\d[\d,.]*)/)
    return lo || hi ? { metric: 'lot_size', lo: lo ? Number(lo[2]!.replace(/,/g, '')) : null, lo_incl: lo?.[1] === '≥', hi: hi ? Number(hi[2]!.replace(/,/g, '')) : null, hi_incl: hi?.[1] === '≤' } : null
  }
  for (const tb of provs.filter(p => p.kind === 'table')) {
    const holder = tb.parent_id ? byId.get(tb.parent_id)! : tb
    if (/^sch\./.test(holder.local_id) && ['part', 'schedule'].includes(holder.kind)) continue      // a register, not a control
    const above: string[] = []
    for (const r of (kids.get(tb.id) ?? []).filter(r => r.kind === 'row' && r.heading !== 'head')) {
      const cells = (kids.get(r.id) ?? []).filter(c => c.kind === 'cell')
      const vals = cells.map((c, i) => { const v = norm(c.own_text) || above[i] || ''; above[i] = v; return { cap: norm(c.heading).toLowerCase(), v, id: c.id } })
      const valueCell = [...vals].reverse().find(v => figureOf(v.v)); if (!valueCell) continue
      const topic = topicOf(valueCell.cap), fig = figureOf(valueCell.v); if (!topic || !fig) continue
      const useCell = vals.find(v => /land use|use|purpose/.test(v.cap)), zoneCell = vals.find(v => /zone/.test(v.cap)), bandCell = vals.find(v => /lot size|site area|area/.test(v.cap) && v !== valueCell)
      add({ provision_id: valueCell.id, kind: 'standard', topic, comparator: /maximum/.test(valueCell.cap) ? 'max' : /minimum/.test(valueCell.cap) ? 'min' : 'max', value: fig.value, unit: fig.unit,
        uses: useCell ? usesOf(useCell.v) : [], zones: zoneCell ? zoneCodes(zoneCell.v.replace(/^(?=[A-Z]{1,2}\d)/, 'Zone ')) : [], band: bandCell ? bandOf(bandCell.v) : null,
        value_source: 'table', unit_provision: clauseOf(holder)?.id ?? null, source: 'text', reader: 'table row', span: vals.map(v => `${v.cap}: ${v.v}`).join('; ') })
    }
  }

  // an exception "Despite subclause (3), ..." is about what (3) is about: its standards take (3)'s title-type terms
  const despite = (await q(`SELECT from_provision, to_provision FROM rag.relation WHERE kind = 'despite' AND to_provision IS NOT NULL`)).rows
  const under = (id: string, root: string) => { for (let x = byId.get(id); x; x = x.parent_id ? byId.get(x.parent_id) : undefined) if (x.id === root) return true; return false }
  for (const d of despite) {
    const from = byId.get(d.from_provision), to = byId.get(d.to_provision); if (!from || !to || from.document_id !== to.document_id || clauseOf(from)?.id !== clauseOf(to)?.id) continue
    const inherited = [...new Set(claims.filter(c => c.kind === 'standard' && under(c.provision_id, to.id)).flatMap(c => (c.terms ?? []).filter(t => t.startsWith('tenure:'))))]
    if (!inherited.length) continue
    for (const c of claims) if (c.kind === 'standard' && under(c.provision_id, from.id)) c.terms = [...new Set([...(c.terms ?? []), ...inherited])]
  }

  // a claim inside an exempt or complying development code binds only on that pathway, never a development application
  for (const c of claims) {
    const code = up(byId.get(c.provision_id)!, x => /complying development|exempt development/i.test(x.heading ?? ''))
    if (code && c.kind !== 'frame') c.terms = [...(c.terms ?? []), `pathway:${/exempt/i.test(code.heading ?? '') ? 'exempt' : 'complying'}`]
  }

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
  await q('COMMIT')
  console.log('written', claims.length)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
