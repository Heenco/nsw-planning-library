/**
 * Land use groups as the plan itself defines them - read from its Dictionary in the graph, never listed in code:
 * "residential accommodation means a building or place ... and includes any of the following— (a) attached dwellings,
 * (b) boarding houses, ... but does not include tourist and visitor accommodation or caravan parks."
 * Returns group key -> member keys (both through the caller's land use key, singular).
 */
export function useGroups(dictionary: string, key: (u: string) => string): Record<string, string[]> {
  const t = String(dictionary ?? '').replace(/\s+/g, ' ')
  const out: Record<string, string[]> = {}
  for (const m of t.matchAll(/(?:^|\.\s)([a-z][a-z ’'()-]{2,60}?) means [^.]*?\bincludes any of the following—\s*(.+?)(?=,? but does not include\b|\.\s+[a-z][a-z ’'()-]{2,60}? means\b|$)/g)) {
    const members = m[2]!.split(/\(\w{1,4}\)/).map(x => x.replace(/,?\s*(and|or)?\s*$/i, '').trim()).filter(x => x.length > 2)
    if (members.length) out[key(m[1]!.trim())] = members.map(key)
  }
  return out
}
