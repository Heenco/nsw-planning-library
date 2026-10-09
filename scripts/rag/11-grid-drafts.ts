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
 *   - Ch 6 reaches a lot only inside a low and mid rise housing area and not excluded by s 164 (lot_lmr class 'in').
 *   - R2 permits "Dual occupancies (attached)" (Land Use Table); 4.1C(2) bars dual occupancies in R2 under 550 m2.
 *     Inside an LMR area s 166 permits dual occupancies in R2 and s 8 prevails over 4.1C(2) to the extent of the
 *     inconsistency; s 168(2)(a)'s 450 m2 is non-discretionary. Under 450 m2 neither the LEP nor s 168 supports it, so
 *     the draft is "maybe" with the reason.
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
      if (lmr && area >= 450) return R({ verdict: 'yes', controlling: ['housing:s166'], displaced: area < 550 ? ['randwick:4.1C(2)'] : [], trace: ['s 166: permitted with consent in R2 on land to which Ch 6 applies', area < 550 ? 's 8: prevails over 4.1C(2) (550 m2) to the extent of the inconsistency; s 168(2)(a) 450 m2 non-discretionary is met' : 'lot clears 4.1C(2) 550 m2 as well'] })
      if (lmr) return R({ verdict: 'maybe', controlling: ['housing:s166', 'randwick:4.1C(2)'], unknowns: ['whether s 166 prevails over 4.1C(2) on a lot under the 450 m2 safe harbour of s 168(2)(a)'], trace: ['s 166 permits; 4.1C(2) bars under 550 m2; the lot misses s 168(2)(a) 450 m2 as well'] })
      return area >= 550 ? R({ verdict: 'yes', controlling: ['randwick:Land Use Table R2', 'randwick:4.1C(2)'], trace: ['R2 permits dual occupancies (attached)', 'lot >= 550 m2 (4.1C(2))', 'outside an LMR area: Ch 6 does not reach the lot'] })
        : R({ verdict: 'no', controlling: ['randwick:4.1C(2)'], trace: ['4.1C(2): consent must not be granted for a dual occupancy in R2 under 550 m2', 'outside an LMR area (or excluded): s 166 does not reach the lot'] })
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
