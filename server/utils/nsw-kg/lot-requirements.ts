/**
 * Whether this lot satisfies the minimums its own LEP sets for a proposed use,
 * and how far it could be subdivided.
 *
 * The report previously answered both questions with the mapped minimum lot
 * size, which answers neither. That figure is the subdivision standard, and the
 * LEP sets a separate one for the development itself: Hornsby's cl 4.1C wants
 * 700–800 m² for an attached dual occupancy and 800–900 m² for a detached one,
 * while cl 4.1D lets the same pair be *subdivided* at 350–450 m². A reader
 * comparing their area against one figure reaches the wrong conclusion about
 * the other, so the two are separated here and each shown against the clause
 * that actually imposes it.
 *
 * The split comes from the rule's `act` applicability, which the ingest fills
 * with the thing the standard governs — "subdivision", "strata subdivision",
 * "community title subdivision", "erection of a building". That is more
 * reliable than reading the heading: cl 4.1B is headed "Minimum lot size for
 * certain split zone lots", with no "subdivision" in it, and is a subdivision
 * standard. A clause can carry both (cl 4.2 governs erecting a dwelling *and*
 * rural subdivision), in which case it belongs in both answers.
 */

import type pg from 'pg'

export interface LotRequirement {
  clause: string
  heading: string | null
  /** The uses the clause names, empty when it applies to any. */
  uses: string[]
  /** Every minimum this clause states for these uses, ascending. */
  values: number[]
  /** The figure to plan against — the largest, since all of them bind. */
  binding: number
  meets: boolean | null
  /** How far short, in m², when it does not. */
  shortfall: number | null
}

export interface SubdivisionOption {
  /** Empty when the figure comes from the map and no clause was decomposed. */
  clause: string
  heading: string | null
  /** Torrens, Strata, Community title — from the rule's own `act`. */
  kind: string
  uses: string[]
  minLotSize: number | null
  /** True when the figure came from the Lot Size Map rather than the clause. */
  fromMap: boolean
  maxChildLots: number | null
  note: string
}

export interface LotRequirements {
  proposedUse: string
  areaSqm: number | null
  requirements: LotRequirement[]
  subdivision: SubdivisionOption[]
  /**
   * Whether this council's LEP has been decomposed into a rule layer at all.
   *
   * Only Hornsby has one today. Everywhere else the clauses are in the graph as
   * text but their numbers are not extracted, so the pass/fail table has nothing
   * to test and would simply be absent -- which a reader takes as "no minimum
   * applies". The report needs to say the difference out loud, so the flag is
   * carried rather than inferred from an empty list.
   */
  hasRuleLayer: boolean
  /** True only when every requirement that could be tested is satisfied. */
  meetsAll: boolean | null
  /**
   * True when at least one is.
   *
   * Both are needed because a clause states a different minimum per variant of
   * the same use: an 822 m² lot clears cl 4.1C for an attached dual occupancy
   * at 800 m² and misses it for a detached one at 900. Reporting only `meetsAll`
   * turns that into a flat "below minimum", which is the wrong answer to the
   * question the reader is asking.
   */
  meetsAny: boolean | null
}

/**
 * A rule's land use against the proposed one.
 *
 * The instrument qualifies a use wherever the qualification changes the
 * standard — "dual occupancy (attached)" and "dual occupancy (detached)" carry
 * different minimums — so an unqualified proposal of "dual occupancy" matches
 * both, and each variant is reported as its own row rather than collapsed into
 * a single worst-case figure the instrument never states.
 */
function useMatches(ruleUse: string, proposed: string): boolean {
  const a = ruleUse.toLowerCase().trim()
  const b = proposed.toLowerCase().trim()
  return a === b || a.startsWith(`${b} (`) || b.startsWith(`${a} (`)
}

/** The kind of subdivision an `act` names, for the reader. */
function subdivisionKind(acts: string[]): string {
  const joined = acts.join(' ').toLowerCase()
  if (joined.includes('strata')) return 'Strata'
  if (joined.includes('community title')) return 'Community title'
  return 'Torrens'
}

export async function getLotRequirements(
  client: pg.PoolClient,
  lot: {
    zone: string | null
    area_sqm: unknown
    min_lot_size: unknown
    lga_name?: string | null
  },
  proposedUse: string,
): Promise<LotRequirements> {
  const areaSqm = Number(lot.area_sqm) || null
  const mappedMin = lot.min_lot_size == null ? null : Number(lot.min_lot_size)
  const zones = String(lot.zone ?? '').split(',').map(z => z.trim().toUpperCase()).filter(Boolean)

  const rows = (await client.query(
    `SELECT r.clause, s.heading, e.value::float8 AS value,
            (SELECT array_agg(DISTINCT a.value) FROM nsw.rule_applicability a
              WHERE a.rule_id = r.id AND a.dimension = 'land_use') AS uses,
            (SELECT array_agg(DISTINCT a.value) FROM nsw.rule_applicability a
              WHERE a.rule_id = r.id AND a.dimension = 'zone') AS zones,
            (SELECT array_agg(DISTINCT a.value) FROM nsw.rule_applicability a
              WHERE a.rule_id = r.id AND a.dimension = 'act') AS acts
       FROM nsw.rule r
       JOIN nsw.rule_effect e ON e.rule_id = r.id
       JOIN nsw.document d ON d.id = r.document_id
       LEFT JOIN nsw.section s ON s.id = r.section_id
      WHERE d.doc_type = 'lep'
        AND ($1::text IS NULL OR lower(d.lga_name) = lower($1))
        AND e.topic = 'lot_size'
      ORDER BY r.clause`,
    [lot.lga_name ?? null],
  )).rows as Array<{
    clause: string
    heading: string | null
    value: number | null
    uses: string[] | null
    zones: string[] | null
    acts: string[] | null
  }>

  /*
   * Zone scope is a property of the clause, not of the row.
   *
   * A clause is split across several rules -- one per subclause -- and the
   * ingest attaches the zone list to whichever of them names it. Read row by
   * row, a subclause that inherits its zones from the parent looks unscoped,
   * and "no zone named" means "applies everywhere". That put cl 4.2, Rural
   * subdivision, on an R2 lot. So the zones are pooled per clause first, and
   * every row of the clause is tested against the pool.
   */
  const clauseZones = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = String(r.clause)
    if (!clauseZones.has(key)) clauseZones.set(key, new Set())
    for (const z of r.zones ?? []) clauseZones.get(key)!.add(String(z).toUpperCase())
  }
  const inZone = (clause: string) => {
    const scope = clauseZones.get(String(clause))
    // A clause that names no zone anywhere really does apply across the
    // instrument -- cl 4.1 is one -- so an empty pool passes.
    return !scope?.size || zones.some(z => scope.has(z))
  }

  // A clause naming no use applies to any; one naming uses answers only for
  // those. An unqualified proposal matches every qualified variant of itself.
  const forUse = (ruleUses: string[]) =>
    !ruleUses.length || ruleUses.some(u => useMatches(String(u), proposedUse))

  const requirements = new Map<string, LotRequirement>()
  const subdivision = new Map<string, SubdivisionOption>()

  for (const r of rows) {
    const ruleUses = r.uses ?? []
    const acts = r.acts ?? []
    if (!inZone(r.clause)) continue
    if (!forUse(ruleUses)) continue

    const subActs = acts.filter(a => /subdivi/i.test(String(a)))
    // Fall back to the heading only where the ingest recorded no act at all —
    // cl 4.1C is that case, and it is a development standard either way.
    const isSubdivision = subActs.length > 0
      || (acts.length === 0 && /\bsubdivi/i.test(r.heading ?? ''))
    // A clause that also governs building on the land answers the development
    // question too, even though it is mostly a subdivision standard.
    const isDevelopment = !isSubdivision || acts.some(a => !/subdivi/i.test(String(a)))

    if (isDevelopment && r.value != null) {
      // Keyed on the variant, not the clause: cl 4.1C states one figure for
      // attached and another for detached, and merging them into a single
      // worst case reports a minimum the instrument never sets.
      const key = `${r.clause}|${[...ruleUses].sort().join(',')}`
      const existing = requirements.get(key)
      if (existing) {
        if (!existing.values.includes(r.value)) existing.values.push(r.value)
      } else {
        requirements.set(key, {
          clause: String(r.clause),
          heading: r.heading ?? null,
          uses: [...ruleUses],
          values: [r.value],
          binding: r.value,
          meets: null,
          shortfall: null,
        })
      }
    }

    if (isSubdivision) {
      // Keyed on the kind as well, because cl 4.1A covers both a plain and a
      // strata subdivision and they are different answers to the reader.
      const kind = subdivisionKind(subActs.length ? subActs : acts)
      const key = `${r.clause}|${kind}|${[...ruleUses].sort().join(',')}`
      const existing = subdivision.get(key)
      if (existing) {
        // Several bands on one clause: every child lot has to clear the
        // largest, so that is the one that limits the yield.
        if (r.value != null && (existing.minLotSize == null || r.value > existing.minLotSize)) {
          existing.minLotSize = r.value
          existing.fromMap = false
        }
      } else {
        subdivision.set(key, {
          clause: String(r.clause),
          heading: r.heading ?? null,
          kind,
          uses: [...ruleUses],
          // A clause that states no figure defers to the Lot Size Map, whose
          // value for this lot is on the property record.
          minLotSize: r.value ?? mappedMin,
          fromMap: r.value == null,
          maxChildLots: null,
          note: '',
        })
      }
    }
  }

  const reqList = [...requirements.values()].map((req) => {
    req.values.sort((a, b) => a - b)
    req.binding = req.values[req.values.length - 1]!
    req.meets = areaSqm == null ? null : areaSqm >= req.binding
    req.shortfall = req.meets === false ? Math.round((req.binding - areaSqm!) * 10) / 10 : null
    return req
  }).sort((a, b) => a.clause.localeCompare(b.clause) || a.uses.join().localeCompare(b.uses.join()))

  const subList = [...subdivision.values()].map((o) => {
    // One lot is not a subdivision, it is the lot as it stands. Reporting "1"
    // reads as a yield when it is the opposite finding.
    const lots = areaSqm && o.minLotSize ? Math.floor(areaSqm / o.minLotSize) : null
    o.maxChildLots = lots != null && lots >= 2 ? lots : lots == null ? null : 0
    o.note = o.minLotSize == null
      ? 'This clause takes its figure from the Lot Size Map, and none is mapped for this lot.'
      : o.fromMap
        ? `${o.minLotSize} m² per lot, from the Lot Size Map.`
        : `${o.minLotSize} m² per lot, stated in the clause.`
    return o
  }).sort((a, b) => a.clause.localeCompare(b.clause) || a.kind.localeCompare(b.kind))

  // With no decomposed clause, the Lot Size Map still answers the subdivision
  // question: the figure is on the property record and the arithmetic is the
  // same. Only the clause reference is missing, and the row says so.
  if (!subList.length && mappedMin != null) {
    subList.push({
      clause: '',
      heading: null,
      kind: 'Torrens',
      uses: [],
      minLotSize: mappedMin,
      fromMap: true,
      maxChildLots: areaSqm ? Math.max(0, Math.floor(areaSqm / mappedMin)) : null,
      note: `${mappedMin} m² per lot, from the Lot Size Map.`,
    })
    if (subList[0]!.maxChildLots !== null && subList[0]!.maxChildLots < 2) subList[0]!.maxChildLots = 0
  }

  const testable = reqList.filter(r => r.meets !== null)
  return {
    hasRuleLayer: rows.length > 0,
    proposedUse,
    areaSqm,
    requirements: reqList,
    subdivision: subList,
    meetsAll: testable.length ? testable.every(r => r.meets === true) : null,
    meetsAny: testable.length ? testable.some(r => r.meets === true) : null,
  }
}
