/**
 * RAG pilot, Phase 7.2 - Claude's draft rulings for the grid (status 'draft', for Manni to confirm or correct).
 *
 *   npx tsx scripts/rag/11-grid-drafts.ts [--dry]
 *
 * These are ground truth being written, not the system: each ruling is the reading of the clauses quoted in its
 * 'trace', applied to the question's frozen lot facts, and every one goes to the adjudication queue as a draft. They are
 * kept as code so a correction to a reading is made once and re-applied to every lot it touches.
 *
 * Readings (Randwick LEP 2012 and Housing SEPP 2021 text as held in rag.provision):
 *   - Ch 6 applies to the whole State other than the s 164 exclusions (a heritage item among them). Its permissions for
 *     dual occupancies (s 166, R2) need no low and mid rise housing area; s 168's standards and s 170 (multi dwelling
 *     housing) do. [Corrected 2026-10-09: an earlier draft said Ch 6 reaches only LMR areas.]
 *   - Dual occupancy in R2: the use is permitted (s 166, and the R2 table for attached). 4.1C(2)'s 550 m2 is a
 *     development standard, not a prohibition of the use, so s 8 does not simply override it: it governs unless the
 *     non-discretionary s 168(2)(a) 450 m2 displaces it - inside an LMR area, on a lot of at least 450 m2. Otherwise a
 *     lot under 550 m2 needs a cl 4.6 variation: the draft says no, and says why.
 *   - Secondary dwellings: s 50 + s 52(1) wherever a dwelling house is permissible (R2 and R3 both permit them).
 *   - Multi dwelling housing: R3 permits it; R2 only through s 170 inside an LMR area.
 *   - FSR for a dual occupancy (attached): 4.4A(2) rows for R2 (550-600: 0.65, >=600: 0.6), else the map; inside an LMR
 *     area s 168(2)(d) 0.65:1 is a safe harbour, so the answer is the larger of the LEP figure and 0.65.
 *   - Height of a dwelling house: the map in R2; 9.5 m in R3 (4.3(2A), despite 4.3(2)).
 *   - Torrens subdivision of a dual occupancy into 2 lots, consent date unknown: the LEP minimum is the Lot Size Map
 *     (4.1(3)) where the lot is on it; R3 lots are not, and 4.1B(2)'s 325 m2 binds only dwelling houses and
 *     non-residential uses - so no LEP minimum. Inside an LMR area s 169 may apply (only if s 169(2) - the date) with
 *     225 m2 and 6 m frontage per lot: yes if the halves clear the LEP minimum anyway, no if they fail 225 m2 too,
 *     otherwise maybe on the date.
 */
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

export function draft(kind: string, lot: any): any | null {
  const zone = lot.zone, area = Number(lot.area_m2), lmr = lot.low_mid_rise_area?.class === 'in'
  const R = (o: any) => ({ status: 'draft', source: 'Claude draft (11-grid-drafts.ts)', ...o })
  switch (kind) {
    case 'g_dual':
      if (zone === 'R3') return R({ verdict: 'yes', controlling: ['randwick:Land Use Table R3'], trace: ['R3 item 3 permits "Dual occupancies" with consent'] })
      if (zone !== 'R2') return null
    {
      const ch6 = lot.low_mid_rise_area?.class !== 'excluded' && !/item/i.test(lot.heritage ?? '')
      const use = ch6 ? 's 166: dual occupancies permitted with consent in R2 (Ch 6 applies state-wide, less s 164)' : 'R2 table permits dual occupancies (attached); Ch 6 excluded here (s 164)'
      const ctrl = ch6 ? 'housing:s166' : 'randwick:Land Use Table R2'
      if (area >= 550) return R({ verdict: 'yes', controlling: [ctrl], trace: [use, 'lot clears 4.1C(2) 550 m2'] })
      if (lmr && area >= 450) return R({ verdict: 'yes', controlling: [ctrl, 'housing:s168(2)(a)'], displaced: ['randwick:4.1C(2)'],
        trace: [use, '4.1C(2) 550 m2 is a development standard', 's 168(2)(a) 450 m2, non-discretionary in an LMR area, is met: the more onerous 550 m2 cannot be required (s 4.15(3))'] })
      return R({ verdict: 'no', controlling: ['randwick:4.1C(2)'], note: 'unless the 550 m2 standard is varied under cl 4.6',
        trace: [use, `4.1C(2): consent must not be granted under 550 m2 - a development standard`, lmr ? 'the lot misses s 168(2)(a) 450 m2 too, so nothing displaces it' : 'outside an LMR area s 168(2)(a) does not apply, so nothing displaces it'] })
    }
    case 'g_secondary':
      return ['R2', 'R3'].includes(zone) ? R({ verdict: 'yes', controlling: ['housing:s52(1)'], trace: [`${zone} permits dwelling houses, so Ch 3 Pt 1 applies (s 50)`, 's 52(1): with consent, subject to s 52(2)', `the LEP ${zone} table does not list secondary dwellings`] }) : null
    case 'g_mdh':
      if (zone === 'R3') return R({ verdict: 'yes', controlling: ['randwick:Land Use Table R3'], trace: ['R3 item 3 permits multi dwelling housing'] })
      if (zone !== 'R2') return null
      return lmr ? R({ verdict: 'yes', controlling: ['housing:s170'], trace: ['R2 table does not permit it', 's 170: permitted with consent in an LMR area in R2; s 8 prevails'] })
        : R({ verdict: 'no', controlling: ['randwick:Land Use Table R2'], trace: ['R2 item 4: any development not in items 2 or 3 is prohibited', lot.low_mid_rise_area?.class === 'excluded' ? 'excluded from Ch 6 (s 164)' : 'outside an LMR area: s 170 does not reach it'] })
    case 'g_fsr': {
      let lep: number | null = Number(lot.fsr_map), by = 'randwick:4.4(2)'
      if (zone === 'R2' && area >= 550 && area < 600) { lep = 0.65; by = 'randwick:4.4A(2)' }
      if (zone === 'R2' && area >= 600) { lep = 0.6; by = 'randwick:4.4A(2)' }
      const dualProhibited = zone === 'R2' && !lmr && area < 550
      if (dualProhibited) return null                     // the use itself is prohibited: the figure is moot, not scored
      if (lmr && lep < 0.65) return R({ value: 0.65, unit: 'ratio', controlling: ['housing:s168(2)(d)'], displaced: [by], trace: [`LEP: ${lep}:1 (${by.split(':')[1]})`, 's 168(2)(d) 0.65:1 non-discretionary: a more onerous standard cannot be required'] })
      return R({ value: lep, unit: 'ratio', controlling: [by], trace: [`LEP: ${lep}:1 (${by.split(':')[1]})`, lmr ? 's 168(2)(d) 0.65:1 is a safe harbour, not a cap - the LEP permits more' : 'outside an LMR area'] })
    }
    case 'g_height':
      if (zone === 'R3') return R({ value: 9.5, unit: 'm', controlling: ['randwick:4.3(2A)'], displaced: Number(lot.height_map_m) !== 9.5 ? ['randwick:4.3(2)'] : [], trace: ['4.3(2A): despite 4.3(2), a dwelling house in R3 is 9.5 m'] })
      return R({ value: Number(lot.height_map_m), unit: 'm', controlling: ['randwick:4.3(2)'], trace: ['the Height of Buildings Map'] })
    case 'g_subdiv': {
      const half = area / 2, lepMin = zone === 'R2' && lot.lot_size_map_m2 ? Number(lot.lot_size_map_m2) : null
      const s169possible = lmr && ['R1', 'R2', 'R3'].includes(zone) && (lot.frontage_m == null || lot.frontage_m / 2 >= 6) && !lot.battle_axe
      const lepOk = lepMin == null || half >= lepMin
      const base = { controlling: [lepMin ? 'randwick:4.1(3)' : null, s169possible ? 'housing:s169(3)(d)' : null].filter(Boolean) }
      if (lepOk) return R({ ...base, verdict: 'yes', trace: [lepMin ? `each lot ~${Math.round(half)} m2 clears the Lot Size Map ${lepMin} m2` : 'no LEP minimum applies (not on the Lot Size Map; 4.1B(2) binds dwelling houses only)'] })
      if (!s169possible) return R({ ...base, verdict: 'no', trace: [`each lot ~${Math.round(half)} m2 is under the Lot Size Map ${lepMin} m2`, lmr ? 's 169 cannot help: frontage or battle-axe' : 'outside an LMR area: s 169 does not reach it'] })
      if (half < 225) return R({ ...base, verdict: 'no', trace: [`each lot ~${Math.round(half)} m2 is under both ${lepMin} m2 and s 169(3)(d) 225 m2`] })
      return R({ ...base, verdict: 'maybe', unknowns: ['date of the dual occupancy consent (s 169(2))'], values_if: [{ if: 'consent on or after 28 Feb 2025', value: 225 }, { if: 'otherwise', value: lepMin }],
        trace: [`each lot ~${Math.round(half)} m2: over s 169(3)(d) 225 m2, under the Lot Size Map ${lepMin} m2 - the date decides`] })
    }
  }
  return null
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const grid = (await q(`SELECT id, clause, lot_facts, text FROM rag.question WHERE set_name = 'grid'`)).rows
  const tally: Record<string, number> = {}
  const out: { id: string; expected: any }[] = []
  for (const g of grid) {
    const d = draft(g.clause, g.lot_facts)
    const k = d ? `${g.clause}:${d.verdict ?? d.value}` : `${g.clause}:not scored`
    tally[k] = (tally[k] ?? 0) + 1
    out.push({ id: g.id, expected: d ?? { status: 'none', note: 'not scored: the use is prohibited, so the figure is moot' } })
  }
  console.log(Object.entries(tally).sort().map(([k, n]) => `${k} x${n}`).join('\n'))
  if (DRY) { await client.end(); return }
  await q(`UPDATE rag.question q SET expected = x.e FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, e jsonb) WHERE q.id = x.id`, [JSON.stringify(out.map(o => ({ id: o.id, e: o.expected })))])
  console.log('written', out.length)
  await client.end()
}
if (process.argv[1]?.includes('11-grid-drafts')) main().catch(e => { console.error(e); process.exit(1) })
