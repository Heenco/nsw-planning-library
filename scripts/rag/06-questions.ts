/**
 * RAG pilot, Phase 4.1-4.4 - the question bank, with frozen lot facts (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/06-questions.ts           # rebuild every set (ids are stable: answers keep their question)
 *   npx tsx scripts/rag/06-questions.ts --dry
 *
 * Sets
 *   pilot_key   every pilot.key row for Randwick, as a question; its expected answer is the key's (LEP-only keys say so)
 *   hard_case   the cases learnt this week - 32 Holden St, 62 Carr St and a 450-550 m2 LMR lot: s 169's date condition,
 *               4.1A(4) strata 275, 4.4A vs the FSR map vs s 168(2)(d), secondary dwellings through s 50 / s 52, Ch 6
 *               permissions the LEP does not grant, a manor house whose meaning lives outside the corpus
 *   propcode    the PropCode claims for 32 Holden St recorded in this session's comparison (the PDFs are not on disk, so
 *               these are the claims written down then, not all ~60)
 *   grid        ~15 Randwick lots chosen by rule (zone x area band x inside / outside a low and mid rise housing area,
 *               lowest cadid in each cell, no strata) x 6 questions; expected answers come from adjudication (P7)
 *
 * Expected answers carry a status: 'key' (a pilot key or a ruling Manni stated), 'draft' (Claude's ruling with the
 * clause quote, waiting for Manni) or 'none' (to be adjudicated). Lot facts are frozen with the question so the RAG
 * variants and the engine read the same lot.
 */
import 'dotenv/config'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { ragLotFacts } from '../../shared/rag/lot-facts'
import { shortName } from '../../shared/rag/refs'
import { docLabel } from '../../shared/rag/retrieve'

const DRY = process.argv.includes('--dry')
const uuidOf = (s: string) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }

interface Q { id?: string; set_name: string; cadid?: string | null; clause?: string | null; kind: string; use_term?: string | null; text: string; expected: any; key_ref?: string | null; tags: string[]; lot?: any }

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const LEP = (await q(`SELECT document_id, title FROM rag.instrument WHERE kind = 'lep'`)).rows[0]
  const RANDWICK = LEP.document_id as string
  // the plan as the generated questions name it ("Randwick LEP 2012"), and its council as lmr.lot_lmr records it
  const PLAN_LABEL = docLabel(LEP.title), LGA = shortName(LEP.title).replace(/ LEP$/, '').toUpperCase()

  // ── lot facts, frozen (the recipe is shared/rag/lot-facts.ts, which live endpoints use too) ─────────
  const factCache = new Map<string, any>()
  const facts = async (cadid: string) => {
    if (!factCache.has(cadid)) factCache.set(cadid, await ragLotFacts(q as any, cadid))
    return factCache.get(cadid)
  }
  const where = (l: any) => `${l.address ?? 'lot ' + l.lot} (lot ${l.lot}, ${l.area_m2} m2, Zone ${l.zone})`

  const qs: Q[] = []

  // ── pilot keys ──────────────────────────────────────────────────────────────────────────────────
  for (const k of (await q(`SELECT * FROM pilot.key WHERE document_id = $1 ORDER BY clause, cadid NULLS LAST`, [RANDWICK])).rows) {
    const e = k.expected ?? {}
    if (k.cadid) {
      const l = await facts(k.cadid)
      const subdiv = e.proposal === 'subdivision'
      const text = subdiv
        ? `Under ${PLAN_LABEL}, can ${where(l)} be subdivided into ${e.lots ?? 2} lots?`
        : e.standard ? `Under ${PLAN_LABEL}, what is the maximum ${/^4\.3/.test(k.clause) ? 'building height' : 'floor space ratio'} for ${e.use} on ${where(l)}?`
        : `Under ${PLAN_LABEL}, is development for the purposes of ${e.use} permissible on ${where(l)}?`
      const std = String(e.standard ?? '').match(/^([\w.()]+)=(?:n:)?([\w.]+)$/)
      qs.push({ set_name: 'pilot_key', cadid: k.cadid, clause: k.clause, kind: subdiv ? 'subdivision' : e.standard ? 'standard' : 'permissibility', use_term: e.use ?? null, text, key_ref: k.id, tags: ['lep_only'],
        expected: { status: 'key', source: 'pilot.key', verdict: e.verdict ?? (subdiv && std ? (std[2] === 'true' ? 'yes' : 'no') : null),
          value: std && !['true', 'false'].includes(std[2]!) ? Number(std[2]) : null, controlling: [e.by ?? (std ? std[1] : null)].filter(Boolean).map((c: string) => `randwick:${c}`),
          not_controlling: e.not_by ? [`randwick:${e.not_by}`] : [], note: k.note, raw: e }, lot: l })
    } else {
      const text = e.modality === 'defines' ? `Under ${PLAN_LABEL} clause ${k.clause}, is the 1,000 m2 figure a development standard or part of a definition?`
        : e.rows ? `What does the table in ${PLAN_LABEL} clause ${k.clause} set, and how many rows does it have?`
        : e.scope ? `Which areas on which map does ${PLAN_LABEL} clause ${k.clause} apply to?`
        : `What development standard does ${PLAN_LABEL} clause ${k.clause} set? Give the figure, unit and what it applies to.`
      qs.push({ set_name: 'pilot_key', clause: k.clause, kind: 'extraction', text, key_ref: k.id, tags: ['lep_only', 'no_lot'],
        expected: { status: 'key', source: 'pilot.key', value: e.value ?? null, unit: e.unit ?? null, zone: e.zone ?? null, topic: e.topic ?? null, controlling: [`randwick:${k.clause}`], note: k.note, raw: e } })
    }
  }

  // ── hard cases ──────────────────────────────────────────────────────────────────────────────────
  const HOLDEN = await facts('102790727'), CARR = await facts('102325171')
  // a lot where s 169's date decides: R2, inside an LMR area, 450-549 m2 (two lots of 225-274 m2)
  const midCad = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = '${LGA}' AND zones = '{R2}' AND class = 'in' AND lot_id NOT LIKE '%SP%'
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

  // ── grid: lots chosen by rule ───────────────────────────────────────────────────────────────────
  const BANDS: [number, number][] = [[250, 300], [300, 450], [450, 550], [550, 600], [600, 900]]
  const gridLots: string[] = []
  for (const zone of ['R2', 'R3']) for (const [lo, hi] of zone === 'R2' ? BANDS : [[200, 450], [450, 900]] as [number, number][]) {
    const r = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = '${LGA}' AND zones = $1 AND class = 'in' AND lot_id NOT LIKE '%SP%' AND area_m2 >= $2 AND area_m2 < $3
                         AND cadid::text NOT IN ('102790727', $4) ORDER BY cadid LIMIT 1`, [[zone], lo, hi, midCad])).rows[0]
    if (r) gridLots.push(r.cadid)
  }
  // outside a low and mid rise housing area, and one excluded from it
  for (const [zone, lo, hi] of [['R2', 300, 600], ['R2', 600, 900], ['R3', 200, 450], ['R3', 450, 900]] as [string, number, number][]) {
    const r = (await q(`SELECT l.cadid::text FROM cadastre.lot l JOIN derived.lot_lga g ON g.cadid = l.cadid
                          JOIN LATERAL (SELECT z.sym_code FROM epi.epi_land_zoning z WHERE z.geom && ST_PointOnSurface(l.geom) AND ST_Intersects(z.geom, ST_PointOnSurface(l.geom)) LIMIT 1) z ON true
                         WHERE upper(g.lga_name) = '${LGA}' AND l.lotidstring NOT LIKE '%SP%' AND trim(z.sym_code) = $1
                           AND ST_Area(l.geom::geography) BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM lmr.lot_lmr m WHERE m.cadid = l.cadid)
                           AND l.cadid::text <> '102325171'
                         ORDER BY l.cadid LIMIT 1`, [zone, lo, hi])).rows[0]
    if (r) gridLots.push(r.cadid)
  }
  const exc = (await q(`SELECT cadid::text FROM lmr.lot_lmr WHERE lga = '${LGA}' AND zones = '{R2}' AND class = 'excluded' AND lot_id NOT LIKE '%SP%' AND area_m2 BETWEEN 450 AND 900 ORDER BY cadid LIMIT 1`)).rows[0]
  if (exc) gridLots.push(exc.cadid)
  gridLots.push('102790727', '102325171', midCad)
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
    for (const [k, kind, use, text] of GRID) qs.push({ set_name: 'grid', clause: k, cadid: cad, kind, use_term: use, text: text(l), expected: { status: 'none' }, tags: [l.low_mid_rise_area.band ? 'lmr' : 'not_lmr'], lot: l })
  }

  for (const x of qs) x.id = uuidOf(`rag-q|${x.set_name}|${x.clause ?? ''}|${x.cadid ?? ''}|${x.key_ref ?? ''}|${x.text}`)
  const bySet = qs.reduce((a: Record<string, number>, x) => ({ ...a, [x.set_name]: (a[x.set_name] ?? 0) + 1 }), {})
  console.log('questions', qs.length, bySet, 'grid lots', new Set(gridLots).size)
  for (const l of [...factCache.values()]) console.log(' ', l.cadid, l.lot, l.zone, l.area_m2, 'fsr', l.fsr_map, 'hob', l.height_map_m, 'lsz', l.lot_size_map_m2, l.low_mid_rise_area.band ?? '-', l.low_mid_rise_area.class ?? '', l.heritage ?? '', '|', l.address)
  if (DRY) { await client.end(); return }

  await q('BEGIN')
  await q(`DELETE FROM rag.question WHERE NOT (id = ANY($1::uuid[])) AND NOT EXISTS (SELECT 1 FROM rag.answer a WHERE a.question_id = rag.question.id)`, [qs.map(x => x.id)])
  await q(`INSERT INTO rag.question (id, set_name, document_id, cadid, clause, kind, use_term, text, expected, key_ref, lot_facts, tags)
           SELECT id, set_name, $2, cadid, clause, kind, use_term, text, expected, key_ref, lot, tags FROM jsonb_to_recordset($1::jsonb)
             AS x(id uuid, set_name text, cadid text, clause text, kind text, use_term text, text text, expected jsonb, key_ref uuid, lot jsonb, tags text[])
           ON CONFLICT (id) DO UPDATE SET expected = excluded.expected, lot_facts = excluded.lot_facts, tags = excluded.tags, kind = excluded.kind, use_term = excluded.use_term`,
    [JSON.stringify(qs.map(x => ({ ...x, lot: x.lot ?? null }))), RANDWICK])
  await q(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('questions', '{}', $1, now())`, [JSON.stringify({ questions: qs.length, by_set: bySet })])
  await q('COMMIT')
  console.log('written')
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
