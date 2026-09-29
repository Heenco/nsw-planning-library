/**
 * Clause 1.18(1)(b), per complying development type.
 *
 * USE_FOR_TYPE and INFERRED_USE below are SEED ONLY: they are loaded into cdc.type.land_uses by
 * `npm run build:cdccatalogue`, and nothing reads them at runtime. usesShown() and
 * permissibilitySays() ARE live - they take the terms a row carries, so the page and the route
 * phrase the same rule the same way.
 *
 *   "be permissible, with consent, under an environmental planning instrument applying to the land
 *    on which the development is carried out"
 *
 * Each code's certificate turns on a land use, and this is the map from the type to that use. It
 * lives here rather than in the route because two things read it — `/api/cdc/types`, which decides
 * it per lot, and `/cdc`, which states on each tab what the type is tested against. Two copies of a
 * legal mapping is how a page ends up citing one thing and testing another.
 *
 * WHY BOTH SPELLINGS. The two sources do not agree on the vocabulary: `nsw.lep_permissibility` says
 * "dual occupancies", `nsw.sepp_permissible_landuse` says "Dual occupancy". Every spelling either
 * source uses is listed, and matching is lower-case.
 *
 * WHY THIS IS NOT THE ZONE TEST. The Codes SEPP allows a dual occupancy in R2; whether one is
 * permissible on a particular R2 lot depends on the LEP applying to that land, and 148 LEPs answer
 * differently for the same zone code. Tested on a Lane Cove R2 lot, the zone check passes for
 * multi dwelling housing and this one fails.
 */

/** Type key -> every land-use term that satisfies the clause for it. Empty = deliberately untested. */
export const USE_FOR_TYPE: Record<string, string[]> = {
  'dual-occupancy': ['dual occupancies', 'dual occupancies (attached)', 'dual occupancies (detached)',
                     'dual occupancy', 'dual occupancy (attached)', 'dual occupancy (detached)'],
  'multi-dwelling-housing-terraces': ['multi dwelling housing'],
  'secondary-dwelling': ['secondary dwellings'],
  'dwelling-houses': ['dwelling houses'],
  'rural-housing': ['dwelling houses'],
  'inland-dwelling-houses': ['dwelling houses'],
  'greenfield-housing': ['dwelling houses'],
  'agritourism': ['agritourism'],
  'farm-stay-accommodation': ['farm stay accommodation'],
  'inland-farm-buildings': ['farm buildings'],
  /*
   * "Manor house" is NOT one of the Standard Instrument's 203 terms, so there is nothing to test it
   * against directly. A manor house is three or four dwellings in one building, which the
   * instruments reach through either form — so this passes when the land permits EITHER, and every
   * place it is used says so. An inference, labelled as one.
   */
  'manor-houses': ['residential flat buildings', 'multi dwelling housing'],
  /*
   * Left untested on purpose. None of its twelve requirements is testable yet, and inventing a land
   * use for it would make the least-evidenced type on the page carry the most confident answer.
   */
  'mid-rise-housing-pattern': [],
}

/** Types whose land use is an inference rather than the instrument's own term. */
export const INFERRED_USE = new Set(['manor-houses'])

/** Every term any type needs, so one query can serve all twelve. */
export const ALL_USES = [...new Set(Object.values(USE_FOR_TYPE).flat())]

/**
 * The plain-language terms a reader should see, from the terms a type carries.
 *
 * Takes the list rather than a type key: since the catalogue moved into cdc.type.land_uses, the map
 * above is the SEED for that table and no longer what anything reads at runtime. A helper that still
 * looked the key up here would quietly reintroduce the second source this was moved to remove.
 *
 * The duplicate spellings are a join detail, not something to put on a page: a dual occupancy holds
 * six strings because two sources spell three uses differently.
 */
function baseAndQualifier(u: string): [string, string | null] {
  const m = u.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  const base = (m ? m[1]! : u).trim()
  // "dual occupancies" and "dual occupancy" are the same use; fold on a singular stem
  const stem = base.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')
  return [stem, m ? m[2]!.trim().toLowerCase() : null]
}

export function usesShown(uses: string[]): string[] {
  const groups = new Map<string, { label: string; quals: string[] }>()
  for (const u of uses ?? []) {
    const [stem, qual] = baseAndQualifier(u)
    const g = groups.get(stem) ?? { label: '', quals: [] }
    const plain = u.replace(/\s*\([^)]*\)\s*$/, '').trim()
    // prefer the plural spelling - it is how the Standard Instrument writes them
    if (!g.label || plain.length > g.label.length) g.label = plain
    if (qual && !g.quals.includes(qual)) g.quals.push(qual)
    groups.set(stem, g)
  }
  return [...groups.values()].map(g =>
    g.quals.length ? `${g.label} (including ${g.quals.join(' and ')})` : g.label)
}

/** What the /cdc tab says a type is tested against, or why it is not tested. */
export function permissibilitySays(uses: string[], inferred = false): { says: string; inferred: boolean } {
  const shown = usesShown(uses)
  if (!shown.length) {
    return { says: 'not tested — no Standard Instrument land use matches this code, and guessing '
                 + 'one would put the least-evidenced type on the page behind the most confident answer',
             inferred: false }
  }
  const list = shown.length === 1 ? shown[0]!
    : shown.slice(0, -1).join(', ') + ' or ' + shown[shown.length - 1]!
  return { says: `${list} permissible with consent under an EPI applying to the land`, inferred }
}
