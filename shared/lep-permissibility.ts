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

export interface ResolvedParent {
  use: string
  status: Status
}

export interface ZoneDetail {
  ok: true
  epicode: string
  name: string
  zone: { zoneId: string, code: string, name: string }
  objectives: string[]
  raw: { withoutConsent: string[], withConsent: string[], prohibited: string[] }
  resolved: { runId: string | null, leaves: ResolvedLeaf[], parents: ResolvedParent[] }
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
