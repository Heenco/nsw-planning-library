/**
 * Whether an LEP clause reaches a particular lot.
 *
 * The rule layer records zone applicability per *rule*, and a clause is several
 * rules -- one per subclause. That makes "which zones does this clause apply
 * in?" ambiguous, and getting it wrong is visible either way: pooling every
 * zone a clause mentions dropped Randwick's cl 4.3, the Height of Buildings
 * clause, from an R2 lot because one of its subclauses is R3-specific; not
 * filtering at all put "Rural subdivision" on a lot in Maroubra.
 *
 * Two clauses show why no single structural test settles it. These have exactly
 * the same shape:
 *
 *   Hornsby  cl 4.2  Rural subdivision    { act, land_use=dwelling, zone=RU1..RU6 }
 *                                          { act }                     <- no zone
 *   Randwick cl 4.3  Height of buildings  { land_use=dwelling house, zone=R3 }
 *                                          { act }                     <- no zone
 *
 * One applies only on rural land; the other applies everywhere and merely says
 * something extra about R3. Nothing in the applicability distinguishes them.
 * The instrument does, in the clause's own name, so that is what is read here.
 */

export interface ClauseRule {
  /** Zones this rule names, empty when it names none. */
  zones: string[]
  /** Land uses this rule names, empty when it names none. */
  uses: string[]
}

/** The lot's zones, split -- `lzn_sym_code_p` can read "RU2, C3". */
export function lotZones(zone: string | null | undefined): string[] {
  return String(zone ?? '').split(',').map(z => z.trim().toUpperCase()).filter(Boolean)
}

/** True for a zone code the Standard Instrument treats as rural. */
export function isRuralZone(code: string): boolean {
  return /^RU\d*$/i.test(code.trim())
}

/**
 * Zones that scope the clause itself, as opposed to one of its sub-provisions.
 *
 * A rule that names a land use is answering a narrower question than the clause
 * -- "for a dwelling house in R3, the height is..." -- so the zones on it bound
 * that answer, not the clause. Only unqualified rules speak for the clause, and
 * if none of them names a zone the clause is unzoned and reaches every lot.
 */
export function clauseZoneScope(rules: ClauseRule[]): string[] {
  const scope = new Set<string>()
  for (const r of rules) {
    if (r.uses.length) continue
    for (const z of r.zones) scope.add(z.trim().toUpperCase())
  }
  return [...scope]
}

/**
 * Whether `clause` applies to a lot in `zone`.
 *
 * `heading` is the clause's own heading in the instrument. It is consulted for
 * one thing only: a clause the plan names as rural subdivision does not reach
 * suburban land, and that fact survives nowhere else in the graph.
 */
export function clauseAppliesToLot(
  rules: ClauseRule[],
  heading: string | null | undefined,
  zone: string | null | undefined,
): boolean {
  const zones = lotZones(zone)

  // A clause named for rural land, on a lot in no rural zone. Randwick has no
  // rural zone at all, so its cl 4.2 can never apply there; Hornsby has several,
  // and on one of those lots this test passes and the clause is reported.
  if (/\brural\b/i.test(String(heading ?? '')) && !zones.some(isRuralZone)) return false

  const scope = clauseZoneScope(rules)
  if (!scope.length) return true
  return zones.some(z => scope.includes(z))
}
