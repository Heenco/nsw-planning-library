/**
 * NSW Standard Instrument controlled vocabulary.
 *
 * Ported verbatim from the Part 4 pilot's si_landuse.py, which exists to
 * VALIDATE extracted land uses: a term is accepted only if it is a real SI
 * land use, so paraphrase noise ("higher density development") is rejected
 * while legitimate group terms ("residential accommodation") are kept.
 *
 * Used here to read scope off clause headings deterministically — clause
 * "3.1 Dwelling Houses and Dual Occupancies" names two SI uses, and no
 * model is needed to see that.
 */

export const SI_USES = new Set([
  "agriculture",
  "amusement centre",
  "animal boarding or training establishment",
  "aquaculture",
  "artisan food and drink industry",
  "attached dwelling",
  "backpackers accommodation",
  "bed and breakfast accommodation",
  "boarding house",
  "boat building and repair facility",
  "boat launching ramp",
  "boat shed",
  "build-to-rent",
  "bulky goods premises",
  "business premises",
  "cafe",
  "car park",
  "caravan park",
  "cellar door",
  "cellar door premises",
  "cemetery",
  "centre-based child care facility",
  "charter and tourism boating facility",
  "child care centre",
  "co-living housing",
  "commercial premises",
  "community facility",
  "correctional centre",
  "crematorium",
  "dairy",
  "data centre",
  "depot",
  "distribution centre",
  "dual occupancy",
  "dual occupancy (attached)",
  "dual occupancy (detached)",
  "dwelling",
  "dwelling house",
  "early education and care facility",
  "eco-tourist facility",
  "educational establishment",
  "electricity generating works",
  "emergency services facility",
  "entertainment facility",
  "environmental facility",
  "environmental protection works",
  "extensive agriculture",
  "extractive industry",
  "farm building",
  "farm stay accommodation",
  "flood mitigation works",
  "food and drink premises",
  "forestry",
  "freight transport facility",
  "function centre",
  "funeral chapel",
  "funeral home",
  "garden centre",
  "general industry",
  "group home",
  "group home (permanent)",
  "group home (transitional)",
  "hardware and building supplies",
  "hazardous industry",
  "hazardous storage establishment",
  "health consulting rooms",
  "health services facility",
  "heavy industry",
  "highway service centre",
  "home business",
  "home industry",
  "home occupation",
  "home occupation (sex services)",
  "horticulture",
  "hospital",
  "hostel",
  "hotel or motel accommodation",
  "independent living",
  "industrial retail outlet",
  "information and education facility",
  "intensive livestock agriculture",
  "intensive plant agriculture",
  "jetty",
  "kiosk",
  "landscaping material supplies",
  "large lot residential",
  "light industry",
  "livestock processing industry",
  "manor house",
  "marina",
  "market",
  "medical centre",
  "medium density housing",
  "mixed use development",
  "mooring",
  "multi dwelling housing",
  "multi dwelling housing (terraces)",
  "neighbourhood shop",
  "neighbourhood supermarket",
  "offensive industry",
  "office premises",
  "passenger transport facility",
  "place of public worship",
  "plant nursery",
  "pub",
  "public administration building",
  "recreation area",
  "recreation facility (indoor)",
  "recreation facility (major)",
  "recreation facility (outdoor)",
  "registered club",
  "residential accommodation",
  "residential flat building",
  "resource recovery facility",
  "respite day care centre",
  "restaurant",
  "restaurant or cafe",
  "restricted premises",
  "retail premises",
  "roadside stall",
  "rural industry",
  "rural workers dwelling",
  "school",
  "secondary dwelling",
  "self-storage units",
  "semi-detached dwelling",
  "seniors housing",
  "service station",
  "serviced apartment",
  "sewage treatment plant",
  "sewerage system",
  "sex services premises",
  "shop",
  "shop top housing",
  "shopping centre",
  "small bar",
  "specialised retail premises",
  "take away food and drink premises",
  "telecommunications facility",
  "tertiary institution",
  "timber yard",
  "tourist and visitor accommodation",
  "transport depot",
  "truck depot",
  "vehicle body repair workshop",
  "vehicle repair station",
  "vehicle sales or hire premises",
  "veterinary hospital",
  "viticulture",
  "warehouse",
  "warehouse or distribution centre",
  "waste disposal facility",
  "waste or resource management facility",
  "water recreation structure",
  "water recycling facility",
  "water supply system",
  "wharf or boating facility"
])

export const MAP_LAYERS = new Set([
  "Acid Sulfate Soils Map",
  "Active Street Frontages Map",
  "Additional Permitted Uses Map",
  "Character Areas Map",
  "Class 5 ANEF Map",
  "Coastal Environment Area Map",
  "Coastal Use Area Map",
  "Coastal Vulnerability Area Map",
  "Coastal Wetlands and Littoral Rainforests Area Map",
  "Drinking Water Catchment Map",
  "Flood Planning Map",
  "Floor Space Ratio Map",
  "Foreshore Building Line Map",
  "Greenfield Housing Code Applied Area Map",
  "Groundwater Vulnerability Map",
  "Height of Buildings Map",
  "Heritage Map",
  "Key Sites Map",
  "Land Reservation Acquisition Map",
  "Land Zoning Map",
  "Landslide Risk Map",
  "Lot Size Map",
  "Natural Resources Sensitivity Land Map",
  "Obstacle Limitation Surface Map",
  "Riparian Lands and Watercourses Map",
  "Scenic Protection Map",
  "Sensitive Land Map",
  "Special Character Areas Map",
  "Special Provisions Map",
  "Terrestrial Biodiversity Map",
  "Urban Release Area Map",
  "Wetlands Map"
])

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9() ]+/g, ' ')
  .replace(/\s+/g, ' ').trim()

/**
 * SI land uses named in a heading, longest-match first so
 * "dual occupancy (attached)" wins over "dual occupancy".
 */
/**
 * Crude stem so headings match the dictionary despite number differences:
 * a clause reads "Dual Occupancies" where the SI says "dual occupancy", and
 * "Sex Service Premises" where the SI says "sex services premises".
 * Comparing raw strings misses both.
 */
const stemWord = (w) => {
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y')   // occupancies → occupancy
  if (/ss$/.test(w)) return w                          // business stays business
  if (/s$/.test(w)) return w.slice(0, -1)              // houses → house
  return w
}

const stemPhrase = (s) => norm(s).split(' ').filter(Boolean).map(stemWord).join(' ')

export function matchLandUses(text) {
  if (!text) return []
  const hay = ' ' + stemPhrase(text) + ' '
  const hits = []
  // Longest first, so a specific use wins and its shorter parent is then
  // skipped by the containment test.
  for (const use of [...SI_USES].sort((a, b) => b.length - a.length)) {
    const u = stemPhrase(use)
    if (!u || u.length < 4) continue
    if (hay.includes(' ' + u + ' ') && !hits.some((h) => stemPhrase(h).includes(u))) {
      hits.push(use)
    }
  }
  return hits
}
