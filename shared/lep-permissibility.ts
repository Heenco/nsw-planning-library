/**
 * Shapes shared by /api/lep-permissibility and the /permissibility page.
 *
 * The vocabulary is the resolver's, carried through unchanged so the page can
 * say exactly what the table says. `mixed` only ever appears on a group term,
 * whose children disagree; `rolled_up` is likewise only a group term's basis.
 */

export type Status = 'permitted_without_consent' | 'permitted_with_consent' | 'prohibited' | 'mixed'
export type Basis = 'explicit' | 'inherited' | 'catchall' | 'rolled_up' | 'verbatim'

export interface PlanSummary {
  epicode: string
  name: string
  zoneCount: number
  /** False for a plan that is in lep_zones but was never resolved. */
  resolved: boolean
}

export interface ZoneSummary {
  zoneId: string
  code: string
  name: string
  /** Lines in the table as written. */
  raw: { withoutConsent: number, withConsent: number, prohibited: number, objectives: number }
  /** Leaf terms after resolution; every count is zero for an unresolved plan. */
  resolved: { withoutConsent: number, withConsent: number, prohibited: number, total: number }
}

export interface ResolvedLeaf {
  use: string
  status: Status
  basis: Basis
  /** Hops from the listed group term down to this leaf; 0 when listed itself. */
  depth: number
  /** The group-term chain this status came through, e.g. "industries > heavy industries". */
  derivedFrom: string | null
  /** The line in the plan this traces back to, capitalised as written. */
  sourceText: string | null
  /** For an explicit listing that beat an inherited status: what it beat. */
  resolvedAgainst: { chain: string, status: Status } | null
}

/**
 * A group term carries two answers, because two questions are being asked.
 * `status` is rolled up from its members: permitted when every one is, mixed
 * when they disagree. `namedStatus` is what the plan says about the term
 * itself, the item it is listed in, and null when the plan never names it.
 * They disagree in both directions: Randwick R3 permits business premises and
 * prohibits funeral homes, a member (named permitted, members mixed); many
 * plans prohibit warehouse or distribution centres and permit local
 * distribution premises, its only member (named prohibited, members
 * permitted). Read `namedStatus` first.
 */
export interface ResolvedParent {
  use: string
  status: Status
  namedStatus: Status | null
  /** The line the plan names it on, as written. */
  namedSourceText: string | null
  /**
   * The leaf terms this group term stands for, from the resolver's hierarchy
   * table, each with its status in this zone. Empty when the hierarchy has
   * not been copied across yet.
   */
  members: Array<{ use: string, status: Status | null }>
}

/**
 * The zone's permitted list the way notebook 09G writes it into the property
 * table's `permissible_uses`: every permitted leaf, plus each group term the
 * rule admits. `current` follows the rule 09G used until 2026-09-14, a group
 * term only when every member is permitted; `proposed` follows the corrected
 * rule, the plan's own word on the term when it has one, else the roll-up.
 * `added` and `removed` are the difference, which is exactly what the change
 * does to a lot in this zone.
 */
export interface PermissibleList {
  current: string[]
  proposed: string[]
  added: string[]
  removed: string[]
}

export interface ZoneDetail {
  ok: true
  epicode: string
  name: string
  zone: { zoneId: string, code: string, name: string }
  objectives: string[]
  raw: { withoutConsent: string[], withConsent: string[], prohibited: string[] }
  resolved: { runId: string | null, leaves: ResolvedLeaf[], parents: ResolvedParent[] }
  permissibleList: PermissibleList
}

export const STATUS_LABEL: Record<Status, string> = {
  permitted_without_consent: 'Permitted without consent',
  permitted_with_consent: 'Permitted with consent',
  prohibited: 'Prohibited',
  mixed: 'Mixed',
}

export const BASIS_LABEL: Record<Basis, string> = {
  explicit: 'Listed explicitly',
  inherited: 'Inherited from a group term',
  catchall: 'Caught by the catch-all line',
  verbatim: 'As written, not a Standard Instrument term',
  rolled_up: 'Rolled up from its children',
}
