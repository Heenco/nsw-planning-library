/**
 * One key for a Standard Instrument land use however a source spells it: the LEP rule layer stores the
 * plural ("dual occupancies"), the readers return the singular ("dual occupancy"), Land Use Tables mix case.
 * Used by the rule pipeline's edges step and by /api/rules/at, so a SEPP permission and an LEP prohibition
 * for the same use are recognised as the same use.
 */
export function landUseKey(u: string | null | undefined): string {
  return String(u ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/ies\b/g, 'y')
    .replace(/(?<![s])s\b/g, '')
}
