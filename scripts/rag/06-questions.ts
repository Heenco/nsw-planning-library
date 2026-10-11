/**
 * RAG pilot, Phase 4.1-4.4 - the question bank, with frozen lot facts (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/06-questions.ts           # rebuild every set (ids are stable: answers keep their question)
 *   npx tsx scripts/rag/06-questions.ts --dry
 *
 * Sets (every LEP in rag.instrument; a question carries the LEP it is about as its document_id)
 *   pilot_key   every pilot.key row of each LEP, as a question; its expected answer is the key's (LEP-only keys say so). A
 *               key shape the generator cannot phrase faithfully becomes a question with no expected answer, the key kept raw
 *   hard_case   (Randwick, hand-written) the cases learnt this week - 32 Holden St, 62 Carr St and a 450-550 m2 LMR lot: s 169's date condition,
 *               4.1A(4) strata 275, 4.4A vs the FSR map vs s 168(2)(d), secondary dwellings through s 50 / s 52, Ch 6
 *               permissions the LEP does not grant, a manor house whose meaning lives outside the corpus
 *   propcode    (Randwick, hand-written) the PropCode claims for 32 Holden St recorded in this session's comparison (the PDFs are not on disk, so
 *               these are the claims written down then, not all ~60)
 *   grid        ~15 lots per LEP chosen by rule (zone x area band x inside / outside a low and mid rise housing area,
 *               lowest cadid in each cell, no strata) x 6 questions; expected answers come from adjudication (P7)
 *
 * Expected answers carry a status: 'key' (a pilot key or a ruling Manni stated), 'draft' (Claude's ruling with the
 * clause quote, waiting for Manni) or 'none' (to be adjudicated). Lot facts are frozen with the question so the RAG
 * variants and the engine read the same lot.
 */
import 'dotenv/config'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ragLotFacts } from '../../shared/rag/lot-facts'
import { shortName } from '../../shared/rag/refs'
import { docLabel } from '../../shared/rag/retrieve'

const DRY = process.argv.includes('--dry')
const uuidOf = (s: string) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }

interface Q { id?: string; set_name: string; document_id?: string; cadid?: string | null; clause?: string | null; kind: string; use_term?: string | null; text: string; expected: any; key_ref?: string | null; tags: string[]; lot?: any }
/** the plan the hand-written sets (hard_case, propcode, local) were written about: they name its lots and clauses */
const HAND_PLAN = 'Randwick Local Environmental Plan 2012'

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const LEPS: { document_id: string; title: string }[] = (await q(`SELECT document_id, title FROM rag.instrument WHERE kind = 'lep' ORDER BY title`)).rows
  const nameOf = (t: string) => shortName(t).replace(/ LEP$/, '')
  // the council as lmr.lot_lmr spells it ("RANDWICK", "CITY OF PARRAMATTA"): matched on the plan's name
  const lgaOf = async (t: string) => (await q(`SELECT DISTINCT lga FROM lmr.lot_lmr WHERE lga ~* $1`, [`(^|[^a-z])${nameOf(t)}([^a-z]|$)`])).rows[0]?.lga as string | undefined
  const HAND = LEPS.find(l => l.title === HAND_PLAN)
  const RANDWICK = HAND?.document_id ?? null
  const LGA = HAND ? await lgaOf(HAND.title) : undefined

  // ── lot facts, frozen (the recipe is shared/rag/lot-facts.ts, which live endpoints use too) ─────────
  const factCache = new Map<string, any>()
  const facts = async (cadid: string) => {
    if (!factCache.has(cadid)) factCache.set(cadid, await ragLotFacts(q as any, cadid))
    return factCache.get(cadid)
  }
  const where = (l: any) => `${l.address ?? 'lot ' + l.lot} (lot ${l.lot}, ${l.area_m2} m2, Zone ${l.zone})`

  const qs: Q[] = []

  // ── pilot keys, every LEP ─────────────────────────────────────────────────────────────────────────
  for (const LEP of LEPS) {
    // the plan as the generated questions name it ("Hornsby LEP 2013"); key citations "<name>:<clause>" (keyedProvision)
    const PLAN_LABEL = docLabel(LEP.title), K = nameOf(LEP.title).toLowerCase()
    for (const k of (await q(`SELECT * FROM pilot.key WHERE document_id = $1 ORDER BY clause, cadid NULLS LAST`, [LEP.document_id])).rows) {
      const e = k.expected ?? {}
      const std = String(e.standard ?? '').match(/^([\w.()]+)=(?:n:)?([\w.]+)$/)
      const bool = !!std && ['true', 'false'].includes(std[2]!)
      if (k.cadid) {
        const l = await facts(k.cadid)
        const subdiv = e.proposal === 'subdivision'
        // a standard the key states as met / not met outside a subdivision ("4.1C(2)(a)=true") has no question this bank asks
        const unread = !subdiv && bool
        const text = subdiv
          ? `Under ${PLAN_LABEL}, can ${where(l)} be subdivided into ${e.lots ?? 2} lots?`
          : std && !bool ? `Under ${PLAN_LABEL}, what is the maximum ${/^4\.3/.test(k.clause) ? 'building height' : 'floor space ratio'} for ${e.use} on ${where(l)}?`
          : `Under ${PLAN_LABEL}, is development for the purposes of ${e.use} permissible on ${where(l)}?`
        // a subdivision's yes / no is whether each lot meets the minimum: the key's standard, where it states one
        const verdict = subdiv && bool ? (std![2] === 'true' ? 'yes' : 'no') : e.verdict ?? null
        const value = std && !bool ? Number(std[2]) : null
        qs.push({ set_name: 'pilot_key', document_id: LEP.document_id, cadid: k.cadid, clause: k.clause, kind: subdiv ? 'subdivision' : std && !bool ? 'standard' : 'permissibility',
          use_term: e.use ?? null, text, key_ref: k.id, tags: ['lep_only'],
          expected: unread || (verdict == null && value == null) ? { status: 'none', source: 'pilot.key', note: `key shape not phrased as a question: ${JSON.stringify(e).slice(0, 200)}`, raw: e }
            : { status: 'key', source: 'pilot.key', verdict, value, controlling: [e.by ?? (std ? std[1] : null)].filter(Boolean).map((c: string) => `${K}:${c}`),
                not_controlling: e.not_by ? [`${K}:${e.not_by}`] : [], note: k.note, raw: e }, lot: l })
      } else {
        const fig = e.no_proposition_with?.value ?? null
        // the land a key names: map areas ("D" on the Dual Occupancy Prohibition Map) and land it excludes ("heritage item")
        const areas = (e.scope ?? []).filter((x: any) => x?.value).map((x: any) => ({ value: String(x.value), map: x.map_layer ?? null, excludes: x.polarity === 'excludes' }))
        const mapsOnly = areas.length > 0 && areas.every((x: any) => x.map && !x.excludes)
        const text = e.modality === 'defines' && fig != null ? `Under ${PLAN_LABEL} clause ${k.clause}, is the ${Number(fig).toLocaleString('en-AU')} ${e.no_proposition_with?.unit === 'sqm' ? 'm2 ' : ''}figure a development standard or part of a definition?`
          : e.rows ? `What does the table in ${PLAN_LABEL} clause ${k.clause} set, and how many rows does it have?`
          : areas.length && e.value != null ? `What development standard does ${PLAN_LABEL} clause ${k.clause} set, and on which mapped area? Give the figure, unit and the area.`
          : mapsOnly ? `Which areas on which map does ${PLAN_LABEL} clause ${k.clause} apply to?`
          : areas.length ? `What land does ${PLAN_LABEL} clause ${k.clause} apply to, and what land does it not apply to?`
          : `What development standard does ${PLAN_LABEL} clause ${k.clause} set? Give the figure, unit and what it applies to.`
        const graded = (e.modality === 'defines' && fig != null) || e.rows || areas.length || e.value != null
        qs.push({ set_name: 'pilot_key', document_id: LEP.document_id, clause: k.clause, kind: 'extraction', text, key_ref: k.id, tags: ['lep_only', 'no_lot'],
          expected: graded ? { status: 'key', source: 'pilot.key', value: e.value ?? null, unit: e.unit ?? null, zone: e.zone ?? null, topic: e.topic ?? null, ...(areas.length ? { areas } : {}),
              controlling: [`${K}:${k.clause}`], note: k.note, raw: e }
            : { status: 'none', source: 'pilot.key', note: `key shape not phrased as a question: ${JSON.stringify(e).slice(0, 200)}`, raw: e } })
      }
    }
  }

  // ── hard cases, PropCode claims, local controls: written about HAND_PLAN's lots, asked only when it is held ────
  let midCad = ''
  if (HAND) {
  const HOLDEN = await facts('102790727'), CARR = await facts('102325171')
  // a lot where s 169's date decides: R2, inside an LMR area, 450-549 m2 (two lots of 225-274 m2)
  midCad = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = '${LGA}' AND zones = '{R2}' AND class = 'in' AND lot_id NOT LIKE '%SP%'
                            AND area_m2 >= 470 AND area_m2 < 540 ORDER BY cadid LIMIT 1`)).rows[0].cadid
  const MID = await facts(midCad)
  const H = (id: string, l: any, kind: string, text: string, expected: any, tags: string[] = [], use: string | null = null) =>
    qs.push({ set_name: 'hard_case', clause: id, cadid: l?.cadid ?? null, kind, use_term: use, text, expected, tags, lot: l })

  H('H1', HOLDEN, 'standard', `What is the maximum floor space ratio for a dual occupancy (attached) on ${where(HOLDEN)}?`,
    { status: 'draft', value: 0.65, unit: 'ratio', controlling: ['housing:s168(2)(d)'], displaced: ['randwick:4.4A(2)', 'randwick:4.4(2)'],
      trace: ['4.4(2) FSR map 0.5:1', '4.4A(2) 0.6:1 for dual occupancies (attached) in R2 on lots >= 600 m2 - more specific than the map', 'Housing SEPP s 168(2)(d) 0.65:1, non-discretionary (EP&A Act s 4.15(3)) in a low and mid rise housing area; s 8 prevails'],
      note: 'holds while the lot is in a low and mid rise housing area (outer band, Maroubra Junction town centre)' }, ['precedence', 'non_discretionary', 'propcode'], 'dual occupancies (attached)')
  H('H2', HOLDEN, 'subdivision', `What is the minimum lot size for a Torrens title subdivision of a dual occupancy into 2 lots on ${where(HOLDEN)}? The date of the dual occupancy consent is not known.`,
    { status: 'key', source: 'Manni 2026-10-09: s 169(2) applies only if consent was granted on or after 28 Feb 2025', verdict: 'maybe',
      values: { 'consent on or after 28 Feb 2025': 225, 'otherwise': 275 }, unit: 'm2', controlling: ['housing:s169(3)(d)', 'randwick:4.1(3)'], depends_on: 'date of the dual occupancy consent - s 169(2)' },
    ['precedence', 'date_condition', 'propcode'], 'dual occupancies')
  H('H3', HOLDEN, 'subdivision', `Development consent for a dual occupancy on ${where(HOLDEN)} was granted on 10 March 2025. What is the minimum size of each lot for a Torrens title subdivision into 2 lots, one dwelling each?`,
    { status: 'key', value: 225, unit: 'm2', controlling: ['housing:s169(3)(d)'], displaced: ['randwick:4.1(3)'], trace: ['s 169(2)(a) holds (consent on or after 28 Feb 2025)', 's 169(1A) applies despite another EPI', 's 169(3)(d) 225 m2, non-discretionary'] },
    ['precedence', 'date_condition'], 'dual occupancies')
  H('H4', HOLDEN, 'subdivision', `Development consent for a dual occupancy on ${where(HOLDEN)} was granted on 1 June 2024, and the subdivision application is separate. What is the minimum size of each lot for a Torrens title subdivision into 2 lots?`,
    { status: 'key', value: 275, unit: 'm2', controlling: ['randwick:4.1(3)'], not_controlling: ['housing:s169(3)(d)'], trace: ['s 169(2) does not hold: consent before 28 Feb 2025 and no combined application', 'Lot Size Map 275 m2 under 4.1(3)'] },
    ['precedence', 'date_condition'], 'dual occupancies')
  H('H5', HOLDEN, 'subdivision', `What is the minimum lot size for a strata subdivision of a dual occupancy on ${where(HOLDEN)}?`,
    { status: 'key', source: 'Manni 2026-10-09: 4.1A(4) gives 275 m2 for strata', value: 275, unit: 'm2', controlling: ['randwick:4.1A(4)(a)'], not_controlling: ['housing:s169(3)(d)'], trace: ['s 169(4): the section does not apply to strata subdivision', '4.1A(4)(a): 275 m2 despite 4.1A(3)'] },
    ['precedence', 'propcode'], 'dual occupancies')
  H('H6', HOLDEN, 'permissibility', `Is a secondary dwelling permissible on ${where(HOLDEN)}?`,
    { status: 'draft', verdict: 'permissible', controlling: ['housing:s52(1)'], trace: ['Randwick R2 Land Use Table does not list secondary dwellings (prohibited under the LEP alone)', 'Housing SEPP s 50: the Part applies where a dwelling house is permissible - it is in R2', 's 52(1): may be carried out with consent, subject to s 52(2)'] },
    ['sepp_override', 'propcode'], 'secondary dwellings')
  H('H7', HOLDEN, 'standard', `Under a development application, what is the maximum total floor area of the principal dwelling and a secondary dwelling together on ${where(HOLDEN)}?`,
    { status: 'draft', value: 0.6, unit: 'ratio (of site area)', controlling: ['housing:s52(2)(b)', 'randwick:4.4A(2)'], displaced: ['randwick:4.4(2)'],
      trace: ['s 52(2)(b): no more than the maximum floor area permitted for a dwelling house under another EPI', '4.4A(2): dwelling houses in R2 on lots > 450 m2 ... (row for this lot size) - more specific than the 0.5:1 map; 4.4A(4) disapplies 4.4(2)'], note: 'PropCode used the map 0.5:1 (325.6 m2)' },
    ['precedence', 'propcode'], 'secondary dwellings')
  H('H8', HOLDEN, 'permissibility', `Is multi dwelling housing permissible on ${where(HOLDEN)}?`,
    { status: 'draft', verdict: 'permissible', controlling: ['housing:s170'], trace: ['Randwick R2 Land Use Table does not list multi dwelling housing', 'Housing SEPP s 170: permitted with consent on land to which Ch 6 applies in a low and mid rise housing area in R2'] },
    ['sepp_override'], 'multi dwelling housing')
  H('H9', HOLDEN, 'permissibility', `Is a manor house permissible on ${where(HOLDEN)}?`,
    { status: 'draft', verdict: 'maybe', controlling: [], note: 'Housing SEPP Sch 10: "manor house has the same meaning as in the Codes SEPP" - outside the corpus. Whether it is multi dwelling housing (s 170) or a residential flat building cannot be read from what is held; an honest answer says so.' },
    ['out_of_corpus', 'propcode'], 'manor houses')
  H('H10', HOLDEN, 'standard', `What is the maximum building height for a dual occupancy on ${where(HOLDEN)}?`,
    { status: 'draft', value: 9.5, unit: 'm', controlling: ['randwick:4.3(2)', 'housing:s168(2)(e)'], note: 'the map and s 168(2)(e) agree' }, ['propcode'], 'dual occupancies')
  H('H11', CARR, 'permissibility', `Is a dual occupancy permissible on ${where(CARR)}?`,
    { status: 'draft', verdict: 'permissible', controlling: ['randwick:Land Use Table R3'], not_controlling: ['randwick:4.1C(2)', 'housing:s168'], note: '4.1C and s 166 are R2 only; R3 permits dual occupancies in its own table; s 168 needs a low and mid rise housing area, which this lot is not in' },
    ['lep_only'], 'dual occupancies')
  H('H12', null, 'precedence', `If Randwick LEP 2012 and the Housing SEPP 2021 are inconsistent, which prevails?`,
    { status: 'draft', verdict: 'Housing SEPP', controlling: ['housing:s8(1)', 'randwick:1.9(1)'], note: 'Housing SEPP s 8(1) unless otherwise specified; LEP 1.9(1) and EP&A Act s 3.28' }, ['precedence', 'no_lot'])
  H('H13', null, 'standard', `Under Randwick LEP 2012, what is the maximum floor space ratio for a dwelling house on a 290 m2 lot in Zone R2 where the Floor Space Ratio Map shows 0.5:1?`,
    { status: 'draft', value: 0.65, unit: 'ratio', controlling: ['randwick:4.4A(2)'], displaced: ['randwick:4.4(2)'], trace: ['4.4A(2) table: dwelling houses, R2, 275-300 m2: 0.65:1', '4.4A(4): 4.4(2) does not apply to a dwelling house in these zones'] },
    ['precedence', 'no_lot', 'lep_only'], 'dwelling houses')
  H('H14', MID, 'permissibility', `Is a dual occupancy permissible on ${where(MID)}?`,
    { status: 'draft', verdict: 'permissible', controlling: ['housing:s166', 'housing:s168(2)(a)'], displaced: ['randwick:4.1C(2)'],
      trace: ['Housing SEPP s 166: dual occupancies permitted with consent in R2 (Ch 6 applies state-wide, less s 164)', '4.1C(2): consent must not be granted under 550 m2 - a development standard', 's 168(2)(a) 450 m2, non-discretionary inside an LMR area, is met: the more onerous 550 m2 cannot be required (EP&A Act s 4.15(3))'],
      note: 'the case the LEP-only engine answers "prohibited"' }, ['precedence', 'sepp_override', 'non_discretionary'], 'dual occupancies')
  H('H15', MID, 'subdivision', `Development consent for a dual occupancy on ${where(MID)} was granted on 3 April 2025. Can the land be subdivided (Torrens title) into 2 lots, one dwelling on each?`,
    { status: 'draft', verdict: 'yes', controlling: ['housing:s169(3)(d)'], displaced: ['randwick:4.1(3)'], note: `two lots of about ${Math.round(MID.area_m2 / 2)} m2: under the 275 m2 Lot Size Map, over s 169(3)(d)'s 225 m2 - the date decides`, trace: ['s 169(2)(a) holds', 's 169(1A) despite another EPI', 's 169(3)(d) 225 m2'] },
    ['precedence', 'date_condition'], 'dual occupancies')

  // ── PropCode claims (as recorded in this session's comparison of the two reports) ─────────────────
  const P = (id: string, text: string, claim: string, expected: any, tags: string[] = []) =>
    qs.push({ set_name: 'propcode', clause: id, cadid: HOLDEN.cadid, kind: expected.kind ?? 'standard', text, expected: { ...expected, propcode_claim: claim }, tags: ['propcode', ...tags], lot: HOLDEN })
  P('PC1', `Which clause sets the 275 m2 minimum for each lot in a strata subdivision of a dual occupancy at ${where(HOLDEN)}, and what does Randwick LEP 2012 clause 4.1A(4)(a) say?`,
    'CDC report: 225 m2, cited to 4.1A(4)(a)', { status: 'key', value: 275, unit: 'm2', controlling: ['randwick:4.1A(4)(a)'], claim_is: 'wrong' })
  P('PC2', `Does the 275 m2 minimum lot size apply to Torrens, community and strata title subdivision of a dual occupancy on ${where(HOLDEN)} alike?`,
    'Rapid Planning Report: 275 m2 applies to all three title types', { status: 'draft', kind: 'subdivision', verdict: 'no', controlling: ['housing:s169(3)(d)', 'randwick:4.1A(4)(a)', 'randwick:4.1(3)'], claim_is: 'wrong',
      note: 'strata 275 (s 169(4) excludes strata); Torrens and community 225 when s 169(2) holds, else the LEP minimum' })
  P('PC3', `What is the minimum lot size for a dual occupancy on ${where(HOLDEN)}?`, 'RPR: 550 m2 (LEP 4.1C) and 450 m2 (SEPP s 168)',
    { status: 'draft', value: 450, unit: 'm2', controlling: ['housing:s168(2)(a)'], displaced: ['randwick:4.1C(2)'], claim_is: 'partly right',
      note: 'both figures exist, but in a low and mid rise housing area the non-discretionary 450 m2 displaces the more onerous 550 m2 (EP&A Act s 4.15(3)); PropCode lists both without saying which binds' })
  P('PC4', `Is a dual occupancy (attached) permissible on ${where(HOLDEN)}?`, 'RPR: yes, LEP and Housing SEPP s 166',
    { status: 'draft', kind: 'permissibility', verdict: 'permissible', controlling: ['randwick:Land Use Table R2', 'housing:s166'], claim_is: 'right' })
  P('PC5', `For a secondary dwelling on ${where(HOLDEN)}, what is the cap on the total floor area of the principal and secondary dwellings, as a floor space ratio?`,
    'CDC report: 325.6 m2 (the map 0.5:1)', { status: 'draft', value: 0.6, unit: 'ratio', controlling: ['randwick:4.4A(2)', 'housing:s52(2)(b)'], claim_is: 'wrong', note: 'about 388 m2 on 645.7 m2' })
  P('PC6', `What floor space ratio applies to a dual occupancy (attached) on ${where(HOLDEN)}: the LEP's 0.6:1 or the Housing SEPP's 0.65:1?`, 'RPR: 0.65:1, the SEPP beats the LEP 0.6:1',
    { status: 'draft', value: 0.65, unit: 'ratio', controlling: ['housing:s168(2)(d)'], claim_is: 'right' })

  // ── additional permitted uses (Schedule 1 through cl 2.5) and local controls on mapped land ───────────
  const LOC = async (id: string, cadid: string, kind: string, use: string, text: (l: any) => string, expected: any, tags: string[]) => {
    const l = await facts(cadid); qs.push({ set_name: 'local', clause: id, cadid, kind, use_term: use, text: text(l), expected: { status: 'draft', ...expected }, tags, lot: l })
  }
  await LOC('L1', '103770654', 'permissibility', 'function centres', l => `Is a function centre permissible on ${where(l)}?`,
    { verdict: 'yes', controlling: ['randwick:Sch 1 s 2'], trace: ['RE1 table: function centres prohibited (catch-all)', 'Sch 1 item 2: a function centre related to Wylies Baths permitted with consent on Lots 1798 and 1799, DP 822244', 'cl 2.5(2): despite the Land Use Table'] }, ['apu'])
  await LOC('L2', '161784773', 'permissibility', 'food and drink premises', l => `Is development for the purposes of food and drink premises permissible on ${where(l)}?`,
    { verdict: 'yes', controlling: ['randwick:Sch 1 s 5'], trace: ['SP2 table: prohibited', 'Sch 1 item 5 permits food and drink premises on Lot 21, DP 1134767', 'item 5(3): only for buildings with a frontage to St Pauls Street'] }, ['apu', 'condition'])
  await LOC('L3', '100113681', 'permissibility', 'registered clubs', l => `Is a registered club permissible on ${where(l)}?`,
    { verdict: 'maybe', controlling: ['randwick:Sch 1 s 7'], note: 'Sch 1 item 7 covers "Part of Lot 7020, DP 1058523" only and no APU map shows which part: depends where on the lot (rule agreed with Manni 2026-10-09)' }, ['apu', 'part_lot'])
  await LOC('L4', '186430962', 'standard', 'dwelling houses', l => `What is the maximum floor space ratio on ${where(l)}?`,
    { verdict: 'maybe', values: { 'otherwise': 0.5, 'cl 6.16(3) satisfied': 1.3 }, unit: 'ratio', controlling: ['randwick:4.4(2)', 'randwick:6.16(3)'], note: 'Key Sites Map Area 1 (Young Street, Randwick): the 0.5:1 map figure, or up to 1.3:1 if the consent authority is satisfied about the recreation land (6.16(3))' }, ['local_control', 'discretion'])
  await LOC('L5', '182478603', 'standard', 'dwelling houses', l => `What is the maximum building height on ${where(l)}?`,
    { verdict: 'maybe', values: { 'otherwise': 24, 'cl 6.21(7) satisfied': 30 }, unit: 'm', controlling: ['randwick:4.3(2)', 'randwick:6.21(7)'], note: 'Y1 on the Alternative Building Heights Map: up to 6 m above the 24 m map height for a competitive design winner with design excellence' }, ['local_control', 'discretion'])
  for (const x of qs) if (!x.document_id) x.document_id = RANDWICK!
  }

  // ── grid: lots chosen by rule, per LEP (its council as lmr.lot_lmr spells it) ─────────────────────
  const BANDS: [number, number][] = [[250, 300], [300, 450], [450, 550], [550, 600], [600, 900]]
  const gridLots: string[] = [], gridDoc = new Map<string, string>()
  for (const LEP of LEPS) {
    const lga = await lgaOf(LEP.title)
    if (!lga) { console.log(`grid: no lmr.lot_lmr council for ${LEP.title} - no grid lots`); continue }
    // the hand-written plan's own lots are asked about already (hard cases), and join its grid at the end
    const hand = LEP.title === HAND_PLAN, inSkip = hand ? ['102790727', midCad] : [], outSkip = hand ? ['102325171'] : []
    const mine: string[] = []
    for (const zone of ['R2', 'R3']) for (const [lo, hi] of zone === 'R2' ? BANDS : [[200, 450], [450, 900]] as [number, number][]) {
      const r = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = $5 AND zones = $1 AND class = 'in' AND lot_id NOT LIKE '%SP%' AND area_m2 >= $2 AND area_m2 < $3
                           AND NOT (cadid::text = ANY($4::text[])) ORDER BY cadid LIMIT 1`, [[zone], lo, hi, inSkip, lga])).rows[0]
      if (r) mine.push(r.cadid)
    }
    // outside a low and mid rise housing area, and one excluded from it
    for (const [zone, lo, hi] of [['R2', 300, 600], ['R2', 600, 900], ['R3', 200, 450], ['R3', 450, 900]] as [string, number, number][]) {
      const r = (await q(`SELECT l.cadid::text FROM cadastre.lot l JOIN derived.lot_lga g ON g.cadid = l.cadid
                            JOIN LATERAL (SELECT z.sym_code FROM epi.epi_land_zoning z WHERE z.geom && ST_PointOnSurface(l.geom) AND ST_Intersects(z.geom, ST_PointOnSurface(l.geom)) LIMIT 1) z ON true
                           WHERE upper(g.lga_name) = $5 AND l.lotidstring NOT LIKE '%SP%' AND trim(z.sym_code) = $1
                             AND ST_Area(l.geom::geography) BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM lmr.lot_lmr m WHERE m.cadid = l.cadid)
                             AND NOT (l.cadid::text = ANY($4::text[]))
                           ORDER BY l.cadid LIMIT 1`, [zone, lo, hi, outSkip, lga])).rows[0]
      if (r) mine.push(r.cadid)
    }
    const exc = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = $1 AND zones = '{R2}' AND class = 'excluded' AND lot_id NOT LIKE '%SP%' AND area_m2 BETWEEN 450 AND 900 ORDER BY cadid LIMIT 1`, [lga])).rows[0]
    if (exc) mine.push(exc.cadid)
    if (hand) mine.push('102790727', '102325171', midCad)
    for (const c of mine) { gridLots.push(c); gridDoc.set(c, LEP.document_id) }
  }
  const GRID: [string, string, string | null, (l: any) => string][] = [
    ['g_dual', 'permissibility', 'dual occupancies', l => `Is a dual occupancy permissible on ${where(l)}?`],
    ['g_secondary', 'permissibility', 'secondary dwellings', l => `Is a secondary dwelling permissible on ${where(l)}?`],
    ['g_mdh', 'permissibility', 'multi dwelling housing', l => `Is multi dwelling housing permissible on ${where(l)}?`],
    ['g_fsr', 'standard', 'dual occupancies (attached)', l => `What is the maximum floor space ratio for a dual occupancy (attached) on ${where(l)}?`],
    ['g_height', 'standard', 'dwelling houses', l => `What is the maximum building height for a dwelling house on ${where(l)}?`],
    ['g_subdiv', 'subdivision', 'dual occupancies', l => `Can ${where(l)} be subdivided (Torrens title) into 2 lots after a dual occupancy is built on it? The date of the dual occupancy consent is not known.`],
  ]
  for (const cad of [...new Set(gridLots)]) {
    const l = await facts(cad)
    for (const [k, kind, use, text] of GRID) qs.push({ set_name: 'grid', document_id: gridDoc.get(cad), clause: k, cadid: cad, kind, use_term: use, text: text(l), expected: { status: 'none' }, tags: [l.low_mid_rise_area.band ? 'lmr' : 'not_lmr'], lot: l })
  }

  // ── area: each map area and a clause that governs it (rag.area_clause, built by 02d), asked on a real lot wholly inside
  //    it - every plan, every area, no list kept by hand. The expected answer is what the index says the clause does
  //    (status 'derived'): a consistency check of lot facts -> map share -> frame -> ruling against the build, NOT an
  //    independent key - it is scored on its own, and every disagreement goes to adjudication
  const TOPIC_Q: Record<string, (use: string, l: any) => string> = {
    height: (u, l) => `What is the maximum building height for a ${u} on ${where(l)}?`,
    fsr: (u, l) => `What is the maximum floor space ratio for a ${u} on ${where(l)}?`,
  }
  for (const LEP of LEPS) {
    // a rule another provision switches off "unless the consent authority is satisfied" (Hornsby 6.13(4)) - its answer depends
    const disapplied = new Set((await q(`SELECT r.to_provision::text AS id FROM rag.relation r JOIN rag.provision f ON f.id = r.from_provision
                                          WHERE r.kind = 'disapplies' AND f.document_id = $1 AND f.own_text ~* $2`, [LEP.document_id, '\\munless\\M'])).rows.map((r: any) => r.id))
    const rows = (await q(`SELECT a.map, a.label, a.claim_kind, a.role, a.via_frame, p.id::text AS pid, p.local_id, c.uses, c.zones, c.terms, c.topic, c.value::float8 AS value, c.unit, c.comparator, c.value_source
                             FROM rag.area_clause a JOIN rag.claim c ON c.id = a.claim_id JOIN rag.provision p ON p.id = a.provision_id
                            WHERE a.document_id = $1 AND a.claim_kind IN ('permit', 'prohibit', 'standard', 'frame') ORDER BY a.map, a.label, p.local_id`, [LEP.document_id])).rows
    const areas = new Map<string, any[]>()
    for (const r of rows) areas.set(`${r.map}|${r.label}`, [...(areas.get(`${r.map}|${r.label}`) ?? []), r])
    // asked of the plan alone ("Under Hornsby LEP 2013, ..."): the check is the plan's own clause, not how a SEPP meets it
    const under = `Under ${shortName(LEP.title)}, `
    let made = 0
    for (const [k, rs] of areas) {
      const [map, label] = k.split('|')
      // lots whose point on surface is in the area (an index probe, not a geometry overlay per lot); the share of the lot
      // inside is then read from its facts - 90% or more, as the evaluator itself requires. The largest first: the check is
      // whether the area reaches the lot, and on a small lot a minimum lot size would decide it instead
      const cands = (await q(`SELECT l.cadid::text FROM rag.map_polygon m JOIN cadastre.lot l ON l.geom && m.geom AND ST_Intersects(m.geom, ST_PointOnSurface(l.geom))
                                WHERE m.document_id = $1 AND m.map = $2 AND m.label = $3 AND l.lotidstring NOT LIKE '%SP%' AND ST_Area(l.geom::geography) > 100
                                ORDER BY ST_Area(l.geom::geography) DESC, l.cadid LIMIT 8`, [LEP.document_id, map, label]).catch(() => ({ rows: [] as any[] }))).rows.map((r: any) => r.cadid as string)
      if (!cands.length) continue
      // the zones a rule or its area's frame names: a lot outside them is not the rule's case
      const frameZones = rs.filter(r => r.claim_kind === 'frame').flatMap(r => r.zones ?? [])
      const lotFor = async (zones: string[]) => {
        for (const cad of cands) {
          const l = await facts(cad)
          if (String(l.epi ?? '').toLowerCase() !== LEP.title.toLowerCase()) continue    // zoned under another plan
          if (zones.length && !zones.includes(String(l.zone))) continue
          const inside = Math.max(0, ...(l.mapped ?? []).filter((x: any) => x.document_id === LEP.document_id && x.map === map && x.label === label).map((x: any) => Number(x.share)))
          if (inside < 0.9) continue
          return l
        }
        return null
      }
      const tag = `${map}|${label}`
      for (const r of rs.filter(r => (r.claim_kind === 'permit' || r.claim_kind === 'prohibit') && r.uses?.length).slice(0, 2)) {
        const l = await lotFor([...new Set([...(r.zones ?? []), ...frameZones])]); if (!l) continue
        const use = r.uses[0]
        // a permission on a condition of the proposal, at the consent authority's judgement, or switched off unless it is satisfied: it depends
        const depends = (r.terms ?? []).some((t: string) => /^(condition|discretion):/.test(t)) || disapplied.has(r.pid)
        qs.push({ set_name: 'area', document_id: LEP.document_id, clause: `${r.local_id}@${tag}`, cadid: l.cadid, kind: 'permissibility', use_term: use,
          text: `${under}is ${/^[aeiou]/i.test(use) ? 'an' : 'a'} ${use} permissible on ${where(l)}?`,
          expected: { status: 'derived', verdict: depends ? 'maybe' : r.claim_kind === 'permit' ? 'yes' : 'no', controlling: [`${nameOf(LEP.title).toLowerCase()}:${r.local_id}`],
            note: `rag.area_clause: ${r.local_id} ${r.role}${r.via_frame ? ' (under the frame)' : ''} - ${label} on the ${map} Map` }, tags: ['area', map], lot: l })
        made++
      }
      // one area-specific figure per topic (two on one topic are cases - not a single expected figure); a figure the consent
      // authority may allow if satisfied is "maybe", never the figure
      // a maximum, asked as a maximum (a minimum - "at least 1:1 of non-residential floor space" - is not the answer to it)
      const stds = rs.filter(r => r.claim_kind === 'standard' && r.comparator === 'max' && r.value != null && TOPIC_Q[r.topic] && !String(r.value_source ?? '').startsWith('map:'))
      for (const topic of [...new Set(stds.map(r => r.topic))]) {
        const of = stds.filter(r => r.topic === topic)
        if (of.length !== 1) continue
        const r = of[0]!, use = r.uses?.[0] ?? 'dwelling house'
        const l = await lotFor([...new Set([...(r.zones ?? []), ...frameZones])]); if (!l) continue
        // at the consent authority's judgement, or switched off unless it is satisfied (Ku-ring-gai 6.15(4)): it depends
        const discretion = (r.terms ?? []).some((t: string) => t.startsWith('discretion:')) || disapplied.has(r.pid)
        qs.push({ set_name: 'area', document_id: LEP.document_id, clause: `${r.local_id}@${tag}`, cadid: l.cadid, kind: 'standard', use_term: use, text: under + TOPIC_Q[topic]!(use, l).replace(/^W/, 'w'),
          expected: { status: 'derived', ...(discretion ? { verdict: 'maybe', values: { 'the consent authority is satisfied': r.value } } : { value: r.value }), unit: r.unit,
            controlling: [`${nameOf(LEP.title).toLowerCase()}:${r.local_id}`], note: `rag.area_clause: ${r.local_id} ${r.role}${discretion ? ' (if the consent authority is satisfied)' : ''} - ${label} on the ${map} Map` },
          tags: ['area', map], lot: l })
        made++
      }
    }
    console.log(`area: ${made} questions for ${nameOf(LEP.title)} over ${areas.size} areas`)
  }

  // ── edge: the hard cases of each plan's own clauses and schedules (scripts/rag/edge-keys.json) - an additional permitted
  //    use, a local clause that bars or conditions a use the table permits, a lot size that differs by kind or area, a
  //    subdivision a clause allows or forbids - written by Claude from the clause words on lots taken from the layers, not
  //    from D. Status 'draft' until Manni confirms; asked of the plan alone
  const edge = JSON.parse(readFileSync(new URL('./edge-keys.json', import.meta.url), 'utf8')).keys as any[]
  const titleDoc = new Map(LEPS.map(l => [l.title, l.document_id]))
  for (const k of edge) {
    const doc = titleDoc.get(k.plan); if (!doc) continue
    const l = await facts(k.cadid), under = `Under ${shortName(k.plan)}, `
    const text = k.kind === 'permissibility' ? `${under}is development for the purposes of ${k.use} permissible on ${where(l)}?`
      : k.kind === 'standard' ? `${under}what is the minimum lot size for development for the purposes of ${k.use} on ${where(l)}?`
      : `${under}can ${where(l)} be subdivided (Torrens title) into 2 lots after development for the purposes of ${k.use} is lawfully built on it?`
    qs.push({ set_name: 'edge', document_id: doc, clause: k.id, cadid: k.cadid, kind: k.kind, use_term: k.use, text,
      expected: { status: 'draft', ...k.expected, note: k.note, key_source: 'Claude, from the clause words (scripts/rag/edge-keys.json)' }, tags: ['edge'], lot: l })
  }
  console.log(`edge: ${edge.length} hand-written cases`)

  // ── keys: every plan's answer keys from sources D does not read (rag.key, written by 06a-keys.py) - the Land Use Table
  //    from the legislation XML (key_lut) and the lot's maps from the live Planning Portal service (key_map). Status 'key':
  //    these are what D's accuracy for a newly onboarded council is measured on
  const at = (l: any) => `${l.address ?? 'lot ' + l.lot} (lot ${l.lot})`
  const MAP_Q: Record<string, (l: any, k: any) => string> = {
    zone: (l, k) => `On the Land Zoning Map, is ${at(l)} in Zone ${k.expected.zone}?`,
    height: l => `What maximum building height does the Height of Buildings Map show for ${at(l)}?`,
    fsr: l => `What maximum floor space ratio does the Floor Space Ratio Map show for ${at(l)}?`,
    lot_size: l => `What minimum lot size does the Lot Size Map show for ${at(l)}?`,
  }
  const keyRows = (await q(`SELECT k.document_id, k.kind, k.cadid, k.subject, k.expected, k.source, k.note, i.title FROM rag.key k JOIN rag.instrument i USING (document_id) ORDER BY i.title, k.kind, k.cadid, k.subject`)
    .catch(() => ({ rows: [] as any[] }))).rows
  for (const k of keyRows) {
    const l = await facts(k.cadid)
    const expected = { status: 'key', ...k.expected, key_source: k.source, note: k.note }
    if (k.kind === 'lut') qs.push({ set_name: 'key_lut', document_id: k.document_id, clause: k.subject, cadid: k.cadid, kind: 'permissibility', use_term: k.subject,
      text: `Under ${shortName(k.title)}, is ${/^[aeiou]/i.test(k.subject) ? 'an' : 'a'} ${k.subject} permissible on ${at(l)}?`, expected, tags: ['key', 'lut'], lot: l })
    else if (k.kind === 'map' && MAP_Q[k.subject]) qs.push({ set_name: 'key_map', document_id: k.document_id, clause: k.subject, cadid: k.cadid, kind: 'map', use_term: null,
      text: MAP_Q[k.subject]!(l, k), expected, tags: ['key', 'map'], lot: l })
    // the complying development codes (06b-keys-codes.py): a cl 1.19 land exclusion the live service draws (asked of the
    // lot's facts), the Housing Code on the lot, and its standards for a dwelling house - asked under the code by name
    else if (k.kind === 'cdc_land') qs.push({ set_name: 'key_cdc_land', document_id: k.document_id, clause: k.subject, cadid: k.cadid, kind: 'layer', use_term: k.subject,
      text: `Is ${at(l)} on land that is ${/^(land |susceptible|flood|bush|acid|drinking|environmentally|heritage)/i.test(k.subject) ? '' : 'a '}${k.subject.replace(/ \(EPI\)$/, '')} (an exclusion under cl 1.19 of the Codes SEPP)?`, expected, tags: ['key', 'cdc'], lot: l })
    else if (k.kind === 'cdc_eligible') qs.push({ set_name: 'key_cdc', document_id: k.document_id, clause: 'Housing Code', cadid: k.cadid, kind: 'permissibility', use_term: k.subject,
      text: `Under ${shortName(k.title)}, can a 1 or 2 storey ${k.subject} be erected on ${at(l)} as complying development under the Housing Code?`, expected, tags: ['key', 'cdc'], lot: l })
    else if (k.kind === 'cdc_standard') {
      const Q: Record<string, string> = { height: 'maximum building height', floor_area: 'maximum gross floor area of all buildings', landscaping: 'minimum landscaped area', setback_side: 'minimum setback from each side boundary', setback_rear: 'minimum setback from the rear boundary' }
      if (Q[k.subject]) qs.push({ set_name: 'key_cdc', document_id: k.document_id, clause: k.subject, cadid: k.cadid, kind: 'standard', use_term: 'dwelling house',
        text: `Under ${shortName(k.title)}, what is the ${Q[k.subject]} for a dwelling house erected as complying development under the Housing Code on ${at(l)}?`, expected, tags: ['key', 'cdc'], lot: l })
    }
  }
  console.log(`keys: ${keyRows.length} (${keyRows.filter(k => k.kind === 'lut').length} Land Use Table, ${keyRows.filter(k => k.kind === 'map').length} map, ${keyRows.filter(k => k.kind.startsWith('cdc')).length} codes)`)

  for (const x of qs) x.id = uuidOf(`rag-q|${x.set_name}|${x.clause ?? ''}|${x.cadid ?? ''}|${x.key_ref ?? ''}|${x.text}`)
  const bySet = qs.reduce((a: Record<string, number>, x) => ({ ...a, [x.set_name]: (a[x.set_name] ?? 0) + 1 }), {})
  const byLep = qs.reduce((a: Record<string, number>, x) => { const t = nameOf(LEPS.find(l => l.document_id === x.document_id)?.title ?? '?'); return { ...a, [t]: (a[t] ?? 0) + 1 } }, {})
  console.log('questions', qs.length, bySet, byLep, 'grid lots', new Set(gridLots).size)
  for (const l of [...factCache.values()]) console.log(' ', l.cadid, l.lot, l.zone, l.area_m2, 'fsr', l.fsr_map, 'hob', l.height_map_m, 'lsz', l.lot_size_map_m2, l.low_mid_rise_area.band ?? '-', l.low_mid_rise_area.class ?? '', l.heritage ?? '', '|', l.address)
  if (DRY) { await client.end(); return }

  await q('BEGIN')
  await q(`DELETE FROM rag.question WHERE NOT (id = ANY($1::uuid[])) AND NOT EXISTS (SELECT 1 FROM rag.answer a WHERE a.question_id = rag.question.id)`, [qs.map(x => x.id)])
  await q(`INSERT INTO rag.question (id, set_name, document_id, cadid, clause, kind, use_term, text, expected, key_ref, lot_facts, tags)
           SELECT id, set_name, document_id, cadid, clause, kind, use_term, text, expected, key_ref, lot, tags FROM jsonb_to_recordset($1::jsonb)
             AS x(id uuid, set_name text, document_id uuid, cadid text, clause text, kind text, use_term text, text text, expected jsonb, key_ref uuid, lot jsonb, tags text[])
           ON CONFLICT (id) DO UPDATE SET expected = excluded.expected, lot_facts = excluded.lot_facts, tags = excluded.tags, kind = excluded.kind, use_term = excluded.use_term,
             document_id = excluded.document_id`,
    [JSON.stringify(qs.map(x => ({ ...x, lot: x.lot ?? null })))])
  // a question no longer asked (its wording changed with the key) keeps its answers but is retired: never scored again
  const retired = (await q(`UPDATE rag.question SET expected = coalesce(expected, '{}'::jsonb) || '{"status": "retired"}'::jsonb
                             WHERE NOT (id = ANY($1::uuid[])) AND coalesce(expected->>'status', '') <> 'retired' RETURNING id`, [qs.map(x => x.id)])).rowCount
  if (retired) console.log('retired (no longer asked):', retired)
  await q(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('questions', '{}', $1, now())`, [JSON.stringify({ questions: qs.length, by_set: bySet, retired })])
  await q('COMMIT')
  console.log('written')
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
