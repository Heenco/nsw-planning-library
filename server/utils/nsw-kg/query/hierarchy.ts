// ── Stage D — hierarchy filter ─────────────────────────────────────────
//
// For propositions sharing the same subject across different documents,
// the higher-priority document wins (lower hierarchy_level).
// Act = 1 > SEPP = 2 > LEP = 3 > DCP = 4
//
// "Same subject" is determined by normalised string match on the subject
// field. Both propositions must also have the same type (threshold,
// prohibition, etc.) — we don't override a definition with a threshold.
//
// This is a query-time runtime filter. The persistent nsw.priority table
// is NOT touched here.

import type { ExpandedContext, FilteredContext, OverrideDecision, RetrievalCandidate } from './types'

function normalise(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cheap subject equivalence: exact-after-normalise OR substring containment. */
function subjectsEquivalent(a: string, b: string): boolean {
  const na = normalise(a)
  const nb = normalise(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // Allow substring overlap when one subject is a refined version of the other
  if (na.length >= 6 && nb.length >= 6) {
    if (na.includes(nb) || nb.includes(na)) return true
  }
  return false
}

export function applyHierarchyFilter(ctx: ExpandedContext): FilteredContext {
  const all = [...ctx.retrieved, ...ctx.expanded]
  const dropped = new Set<string>()
  const decisions: OverrideDecision[] = []

  for (let i = 0; i < all.length; i++) {
    const a = all[i]!
    if (dropped.has(a.id)) continue
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!
      if (dropped.has(b.id)) continue
      if (a.document_id === b.document_id) continue
      if (a.type !== b.type) continue
      if (!subjectsEquivalent(a.subject, b.subject)) continue

      // Lower hierarchy_level wins. (Act=1 wins over LEP=3.)
      let winner: RetrievalCandidate, loser: RetrievalCandidate
      if (a.document_hierarchy_level < b.document_hierarchy_level) {
        winner = a; loser = b
      } else if (b.document_hierarchy_level < a.document_hierarchy_level) {
        winner = b; loser = a
      } else {
        // Same level — keep both. We don't have a tiebreaker yet.
        continue
      }

      dropped.add(loser.id)
      decisions.push({
        winner_id:      winner.id,
        winner_subject: winner.subject,
        winner_doc:     winner.document_title,
        winner_level:   winner.document_hierarchy_level,
        loser_id:       loser.id,
        loser_subject:  loser.subject,
        loser_doc:      loser.document_title,
        loser_level:    loser.document_hierarchy_level,
        reason:         'hierarchy',
      })
    }
  }

  const kept    = all.filter((c) => !dropped.has(c.id))
  const droppedList = all.filter((c) =>  dropped.has(c.id))

  return { kept, dropped: droppedList, decisions }
}
