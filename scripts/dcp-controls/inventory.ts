/**
 * What subjects a DCP actually controls, and how much of each — before any model runs.
 *
 *     npx tsx scripts/dcp-controls/inventory.ts hornsby-dcp-2024 randwick-dcp-2025
 *
 * Written because the first runs were all setbacks, and "it works on setbacks" says nothing about a
 * document that also sets parking rates, tree canopy, waste storage, solar access and flood levels. The
 * question this answers is the one that should precede any extraction run: what is in here, in what
 * proportion, and which parts are numeric at all?
 *
 * Deterministic and free — it reads the stage-1 packets and classifies them on the heading and caption
 * text, never on the model. The classification is a COARSE SIGNAL for planning the work, not a
 * substitute for the topic the extractor assigns. Where a packet matches several subjects it is counted
 * under each, because a "landscaped area and deep soil" table genuinely controls both.
 */
import { existsSync } from 'node:fs'
import { packetsFromFile, type Packet } from './packets'

/**
 * Subject patterns, matched against the clause heading, the table caption and the row header — the
 * places a DCP names what it is controlling. Deliberately generous: a false positive costs a line in a
 * planning table, a false negative hides a whole class of control from the plan.
 */
const SUBJECTS: [string, RegExp][] = [
  ['setback', /\bsetback|building line|boundary (setback|clearance)/i],
  ['parking', /\bcar ?park|parking|loading bay|service vehicle|driveway|vehicle (access|crossing)/i],
  ['bicycle', /\bbicycle|bike /i],
  ['height', /\bheight|storey|storeys|rl\b|building envelope/i],
  ['fsr_floorspace', /floor space ratio|\bfsr\b|gross floor area|\bgfa\b|floor area/i],
  ['site_coverage', /site coverage|built upon|building footprint/i],
  ['landscaping', /landscap|planting|garden area|green ?(space|area)/i],
  ['deep_soil', /deep soil|permeab/i],
  ['tree_canopy', /tree canopy|canopy cover|tree protection|vegetation retention/i],
  ['open_space', /open space|private open space|\bpos\b|communal open space|courtyard/i],
  ['lot_size_subdivision', /lot size|subdivision|allotment|lot width|frontage width/i],
  ['solar_access', /solar access|sunlight|overshadow|daylight/i],
  ['privacy', /privacy|overlook|visual separation|acoustic privacy/i],
  ['separation', /building separation|separation distance/i],
  ['ceiling_height', /ceiling height|floor to (floor|ceiling)/i],
  ['stormwater_flood', /stormwater|drainage|flood|overland flow|on-?site detention|\bosd\b|water sensitive/i],
  ['waste', /waste|garbage|bin |recycl/i],
  ['excavation_earthworks', /excavat|earthwork|cut and fill|retaining wall|site regrad/i],
  ['fencing', /fenc|boundary wall|gate/i],
  ['heritage', /heritage|conservation area|archaeolog/i],
  ['bushfire', /bush ?fire|asset protection zone|\bapz\b/i],
  ['contamination', /contaminat|remediat|acid sulfate|salinity/i],
  ['noise_acoustic', /\bnoise|acoustic|sound/i],
  ['accessibility', /accessib|adaptable|disabled|universal design/i],
  ['signage', /signag|advertis/i],
  ['energy_sustainability', /\bbasix|sustainab|energy|thermal|water (re)?use/i],
  ['storage', /storage (area|space)|store room/i],
  ['balcony', /balcon|terrace|verandah|deck/i],
  ['dwelling_mix', /dwelling (mix|density|size)|apartment (mix|size)|unit mix|bedroom/i],
  ['streetscape_character', /streetscape|character|built form|articulation|facade|materials and colours/i],
  ['safety_crime', /crime prevention|\bcpted\b|safety|surveillance/i],
  ['infrastructure_services', /utilit|services|telecommunic|substation|water supply|sewer/i],
]

/** Does the packet state a quantity at all? A control with no number is advice, and that is fine. */
const HAS_NUMBER = /\d/

function subjectsOf(p: Packet): string[] {
  const hay = [
    p.clause.heading ?? '',
    p.clause.chain.join(' '),
    p.table?.caption ?? '',
    p.table?.rowPath.join(' ') ?? '',
    p.table?.colPath.join(' ') ?? '',
  ].join(' · ')
  const hit = SUBJECTS.filter(([, re]) => re.test(hay)).map(([k]) => k)
  // the control text itself only decides when the scaffolding said nothing
  if (!hit.length) {
    const t = p.text
    const fromText = SUBJECTS.filter(([, re]) => re.test(t)).map(([k]) => k)
    return fromText.length ? fromText : ['unclassified']
  }
  return hit
}

interface Tally { packets: number; table: number; numeric: number; clauses: Set<string> }

function tally(packets: Packet[]): Map<string, Tally> {
  const m = new Map<string, Tally>()
  for (const p of packets) {
    for (const s of subjectsOf(p)) {
      if (!m.has(s)) m.set(s, { packets: 0, table: 0, numeric: 0, clauses: new Set() })
      const t = m.get(s)!
      t.packets++
      if (p.kind === 'table') t.table++
      if (HAS_NUMBER.test(p.text)) t.numeric++
      t.clauses.add(p.clause.id)
    }
  }
  return m
}

const slugs = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!slugs.length) {
  console.error('usage: inventory.ts <doc-slug> [<doc-slug> ...]')
  process.exit(1)
}

const all = new Map<string, Map<string, Tally>>()
for (const slug of slugs) {
  const path = `public/EPI/DCPs/${slug}.html`
  if (!existsSync(path)) { console.error(`missing: ${path}`); continue }
  const packets = packetsFromFile(path, slug, {})
  all.set(slug, tally(packets))
  console.log(`${slug}: ${packets.length} packets`)
}

// ── one table, documents as columns ──────────────────────────────────────────
const subjects = [...new Set([...all.values()].flatMap(m => [...m.keys()]))]
  .sort((a, b) => {
    const tot = (s: string) => [...all.values()].reduce((t, m) => t + (m.get(s)?.packets ?? 0), 0)
    return tot(b) - tot(a)
  })

const W = 24
const head = `${'subject'.padEnd(W)}` + slugs.map(s => s.slice(0, 11).padStart(13)).join('') + '    numeric'
console.log(`\n${head}\n${'-'.repeat(head.length)}`)
for (const s of subjects) {
  const cells = slugs.map(sl => {
    const t = all.get(sl)?.get(s)
    return (t ? `${t.packets}` : '·').padStart(13)
  }).join('')
  const num = [...all.values()].reduce((t, m) => t + (m.get(s)?.numeric ?? 0), 0)
  const tot = [...all.values()].reduce((t, m) => t + (m.get(s)?.packets ?? 0), 0)
  console.log(`${s.padEnd(W)}${cells}    ${tot ? `${((100 * num) / tot).toFixed(0)}%` : '-'}`)
}

const grand = slugs.map(sl => [...(all.get(sl)?.values() ?? [])].reduce((t, x) => t + x.packets, 0))
console.log(`${'-'.repeat(head.length)}\n${'(subject hits)'.padEnd(W)}${grand.map(n => String(n).padStart(13)).join('')}`)
console.log('\nA packet matching two subjects is counted under both, so the column sums exceed the packet count.')
