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
import { clauseAppliesToLot } from '../../../shared/lep-scope'

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

/**
 * The kind of subdivision a clause governs, from the acts across all its rules.
 *
 * Pooled per clause, not read per rule. Randwick's cl 4.1A is the strata
 * clause, but it is two rules: one carrying `act = strata subdivision` with the
 * 275 m2 figure, and one carrying the bare `act = subdivision` where the clause
 * defers to the Lot Size Map. Read separately those became two rows, the same
 * clause listed once as Strata and again as Torrens, which reads as two
 * different pathways when it is one.
 *
 * The qualified act wins because it is the more specific description of what
 * the clause does; a bare "subdivision" says only that it is a subdivision
 * standard, which is already implied.
 */
function subdivisionKind(acts: string[]): string {
  const joined = acts.join(' ').toLowerCase()
  if (joined.includes('strata')) return 'Strata'
  if (joined.includes('community title')) return 'Community title'
  return 'Torrens'
}

export interface Lot {
  zone: string | null
  area_sqm: unknown
  min_lot_size: unknown
  lga_name?: string | null
}

interface LotSizeRow {
  clause: string
  heading: string | null
  value: number | null
  uses: string[] | null
  zones: string[] | null
  acts: string[] | null
}

/** A clause's own scope: its heading, and the applicability of all its rules. */
interface ClauseScope {
  heading: string | null
  rules: Array<{ zones: string[], uses: string[] }>
}

interface LotSizeData {
  rows: LotSizeRow[]
  scope: Map<string, ClauseScope>
}

/**
 * Zone scope gathered over every rule of a clause, not only the ones that state
 * a lot size.
 *
 * Randwick's cl 4.2 keeps its rural zones on a `permission` rule that states no
 * lot size at all. Read from the effect rows alone -- which are filtered to
 * lot_size -- that clause looks unzoned, and "Rural subdivision" turned up on a
 * lot in Maroubra with a subdivision yield printed beside it.
 */
async function fetchClauseScope(client: pg.PoolClient, lgaName: string | null): Promise<Map<string, ClauseScope>> {
  const rows = (await client.query(
    `SELECT r.clause, s.heading,
            coalesce((SELECT array_agg(a.value) FROM nsw.rule_applicability a
                       WHERE a.rule_id = r.id AND a.dimension = 'zone'), '{}') AS zones,
            coalesce((SELECT array_agg(a.value) FROM nsw.rule_applicability a
                       WHERE a.rule_id = r.id AND a.dimension = 'land_use'), '{}') AS uses
       FROM nsw.rule r
       JOIN nsw.document d ON d.id = r.document_id
       LEFT JOIN nsw.section s ON s.id = r.section_id
      WHERE d.doc_type = 'lep'
        AND ($1::text IS NULL OR lower(d.lga_name) = lower($1))`,
    [lgaName],
  )).rows as Array<{ clause: string, heading: string | null, zones: string[], uses: string[] }>

  const out = new Map<string, ClauseScope>()
  for (const r of rows) {
    const key = String(r.clause)
    if (!out.has(key)) out.set(key, { heading: r.heading, rules: [] })
    const entry = out.get(key)!
    if (!entry.heading) entry.heading = r.heading
    entry.rules.push({ zones: r.zones ?? [], uses: r.uses ?? [] })
  }
  return out
}

/**
 * Every minimum-lot-size effect this council's LEP states, with clause scope.
 *
 * Fetched once and evaluated many times, because choosing which use a report is
 * about means testing the lot against each candidate, and doing that with a
 * query per use turns one round trip into four.
 */
async function fetchLotSizeRows(client: pg.PoolClient, lgaName: string | null): Promise<LotSizeRow[]> {
  return (await client.query(
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
    [lgaName],
  )).rows as LotSizeRow[]
}

function evaluate(data: LotSizeData, lot: Lot, proposedUse: string): LotRequirements {
  const { rows, scope } = data
  const areaSqm = Number(lot.area_sqm) || null
  const mappedMin = lot.min_lot_size == null ? null : Number(lot.min_lot_size)

  // Whether the clause reaches this lot at all -- see shared/lep-scope.ts for
  // why this is not a matter of pooling the zones a clause mentions.
  const inZone = (clause: string) => {
    const cs = scope.get(String(clause))
    return clauseAppliesToLot(cs?.rules ?? [], cs?.heading ?? null, lot.zone)
  }

  // A clause naming no use applies to any; one naming uses answers only for
  // those. An unqualified proposal matches every qualified variant of itself.
  const forUse = (ruleUses: string[]) =>
    !ruleUses.length || ruleUses.some(u => useMatches(String(u), proposedUse))

  // Acts pooled per clause, so the kind is settled once for the whole clause.
  const actsByClause = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = String(r.clause)
    if (!actsByClause.has(key)) actsByClause.set(key, new Set())
    for (const a of r.acts ?? []) actsByClause.get(key)!.add(String(a))
  }

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
      const kind = subdivisionKind([...(actsByClause.get(String(r.clause)) ?? [])])
      // Keyed on the clause and the use it names. Not on the kind: that is now
      // a property of the clause, so including it could only ever split one
      // clause into two rows again.
      const key = `${r.clause}|${[...ruleUses].sort().join(',')}`
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

export async function getLotRequirements(
  client: pg.PoolClient,
  lot: Lot,
  proposedUse: string,
): Promise<LotRequirements> {
  const [rows, scope] = await Promise.all([
    fetchLotSizeRows(client, lot.lga_name ?? null),
    fetchClauseScope(client, lot.lga_name ?? null),
  ])
  return evaluate({ rows, scope }, lot, proposedUse)
}

/**
 * The use a report should be written about when the reader has not chosen one.
 *
 * The old default was the least intensive use the zone contemplates, on the
 * reasoning that overstating what a site can take is the more damaging error.
 * On a 949.72 m² R2 lot in Hornsby that produced a report about a dwelling
 * house, and every figure that made the site interesting -- cl 4.1C permitting
 * a dual occupancy, cl 4.1D permitting it to be subdivided into two lots --
 * was filtered out before the reader ever saw it. Silence about a pathway the
 * instrument allows is its own kind of wrong answer.
 *
 * So the default is now the most intensive candidate whose minimum lot size
 * this lot actually clears. That is a tested result rather than an assumption,
 * which is what makes it safe to lead with. Where nothing can be tested -- the
 * council has no rule layer, or none of its clauses name these uses -- it falls
 * back to the least intensive, because an untested claim of the most intensive
 * would be exactly the error the old default was guarding against.
 *
 * `candidates` must be ordered least to most intensive.
 */
export async function pickProposedUse(
  client: pg.PoolClient,
  lot: Lot,
  candidates: string[],
): Promise<{ use: string; tested: boolean; considered: Array<{ use: string; meets: boolean | null }> }> {
  const fallback = candidates[0] ?? 'dwelling house'
  if (candidates.length < 2) return { use: fallback, tested: false, considered: [] }

  const [rows, scope] = await Promise.all([
    fetchLotSizeRows(client, lot.lga_name ?? null),
    fetchClauseScope(client, lot.lga_name ?? null),
  ])
  const considered = candidates.map(use => ({
    use,
    // meetsAny, not meetsAll: cl 4.1C sets 800 m² for an attached dual occupancy
    // and 900 for a detached one, so an 822 m² lot fails the pair and clears the
    // attached variant. Requiring both would scope that report to a dwelling
    // house and bury the one form the lot does support. This does not overstate
    // the site, because the requirements table states the verdict per variant --
    // "Satisfied" beside "Short by 77.5 m²" -- rather than a single headline.
    meets: evaluate({ rows, scope }, lot, use).meetsAny,
  }))

  for (let i = considered.length - 1; i >= 0; i--) {
    if (considered[i]!.meets === true) return { use: considered[i]!.use, tested: true, considered }
  }
  return { use: fallback, tested: false, considered }
}
