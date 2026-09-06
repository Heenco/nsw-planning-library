/**
 * Map a pilot clause reference onto the section id its LEP's own XML uses.
 *
 * The Part 4 pilot names clauses the way a planner writes them -- "4.1A",
 * "Sch 1 item 6" -- while the XML ingest keeps whatever id the legislation's
 * own markup carries. For body clauses the two agree once "sec." is prefixed.
 * For schedules they do not, and they disagree differently in each instrument:
 *
 *   Hornsby   Sch 1 item 6   -> sch.1-sec.6      (the item carries its number)
 *   Randwick  Sch 2 item 1   -> sch.2-sec        (unnumbered; first item)
 *   Randwick  Sch 2 item 7   -> sch.2-sec-oc.7   (unnumbered; ordinal suffix)
 *
 * Both schedule forms are guesses about correspondence, so a caller must
 * corroborate them before moving anything: a rule relocated to a plausible but
 * wrong clause is worse than one that fails to import, because nothing
 * downstream can tell it is in the wrong place. `candidateIds` therefore marks
 * which candidates are inferred, and the caller checks those against the
 * section's heading or text.
 */

/**
 * Section ids that could correspond to `clause`, best first.
 *
 * @param {string} clause  the pilot's clause reference
 * @returns {Array<{ id: string, inferred: boolean }>}
 *   `inferred` is false only for the id the document itself would use, which
 *   needs no corroboration; true means the correspondence was derived and must
 *   be verified before it is trusted.
 */
export function candidateIds(clause) {
  const c = String(clause ?? '').trim()
  if (!c) return []

  const out = [{ id: `sec.${c}`, inferred: false }]

  const m = c.match(/^Sch\s*(\w+)\s*item\s*(\w+)$/i)
  if (m) {
    const [, sch, item] = m
    // The item numbered in its own markup. Hornsby's schedules take this form.
    out.push({ id: `sch.${sch}-sec.${item}`, inferred: true })
    // An unnumbered item, positioned. Randwick's Schedule 2 takes this form:
    // the first item is the bare `-sec` and the rest carry an ordinal, so item
    // N is `-oc.N` -- the ordinal is the item number, not an offset from it.
    out.push({ id: item === '1' ? `sch.${sch}-sec` : `sch.${sch}-sec-oc.${item}`, inferred: true })
  }
  return out
}

/** Comparable form of a heading, for confirming a correspondence. */
export const normHeading = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Whether two headings refer to the same clause.
 *
 * Containment rather than equality, because the pilot prefixes the number onto
 * the heading ("Part 4 Principal development standards") where the XML carries
 * the heading alone.
 */
export function headingsAgree(a, b) {
  const x = normHeading(a)
  const y = normHeading(b)
  if (!x || !y) return false
  return x.includes(y) || y.includes(x)
}

/**
 * Whether a section's text contains a span the pilot grounded in that clause.
 *
 * The fallback corroboration where neither side has a heading to compare --
 * Randwick's Schedule 2 items are unheaded in the pilot. A grounded span is a
 * verbatim quote from the instrument, so finding it in the section's own
 * subtree is direct evidence the two are the same clause, and failing to find
 * it is reason enough to refuse the mapping.
 */
export function textContainsSpan(sectionText, span) {
  const hay = String(sectionText ?? '').replace(/\s+/g, ' ').toLowerCase()
  const needle = String(span ?? '').replace(/\s+/g, ' ').toLowerCase().trim()
  // Very short spans match by accident; they are not evidence of anything.
  if (!hay || needle.length < 25) return false
  return hay.includes(needle)
}
