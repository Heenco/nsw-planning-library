<!--
  A dimensioned sketch of one lot, drawn from its surveyed boundary the way a
  survey plan draws it: the street along the bottom, every boundary labelled
  with its length, the frontage picked out and named, the area in the middle,
  and the depth and width the planning controls are tested against drawn as
  dimension lines where they are actually measured.

  Takes the /api/frontage payload. The figures on the dimension lines can be
  supplied by the caller so the sketch and the figures printed beside it read
  from the same record; the geometry only decides where the lines go.

  Nothing here is a map. The map beside it shows the lot in its street; this
  shows the lot as a shape with numbers on it, which is what a setback or a
  minimum-width test is actually about.
-->

<template>
  <svg class="ls" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="ariaLabel">
    <!-- Boundary -->
    <path :d="lotPath" class="ls-lot" />

    <!-- Width lines: at the setback, and at the narrowest point of the core -->
    <g v-for="d in widthLines" :key="d.key" class="ls-dim" :class="`ls-dim--${d.key}`">
      <line :x1="d.x1" :y1="d.y" :x2="d.x2" :y2="d.y" />
      <line :x1="d.x1" :y1="d.y - 4" :x2="d.x1" :y2="d.y + 4" />
      <line :x1="d.x2" :y1="d.y - 4" :x2="d.x2" :y2="d.y + 4" />
      <text :x="(d.x1 + d.x2) / 2" :y="d.y - 5" text-anchor="middle" class="ls-dim-n">{{ d.text }}</text>
      <text v-if="d.sub && d.x2 - d.x1 > 70" :x="(d.x1 + d.x2) / 2" :y="d.y + 11" text-anchor="middle" class="ls-dim-sub">{{ d.sub }}</text>
    </g>

    <!-- Depth line, standing off the lot's right-hand side -->
    <g v-if="depthLine" class="ls-dim ls-dim--depth">
      <line :x1="depthLine.x" :y1="depthLine.y1" :x2="depthLine.x" :y2="depthLine.y2" />
      <line :x1="depthLine.x - 4" :y1="depthLine.y1" :x2="depthLine.x + 4" :y2="depthLine.y1" />
      <line :x1="depthLine.x - 4" :y1="depthLine.y2" :x2="depthLine.x + 4" :y2="depthLine.y2" />
      <text
        :transform="`translate(${depthLine.textX} ${(depthLine.y1 + depthLine.y2) / 2}) rotate(-90)`"
        text-anchor="middle" class="ls-dim-n"
      >{{ depthLine.text }}</text>
      <text
        :transform="`translate(${depthLine.subX} ${(depthLine.y1 + depthLine.y2) / 2}) rotate(-90)`"
        text-anchor="middle" class="ls-dim-sub"
      >{{ depthLine.sub }}</text>
    </g>

    <!-- Frontage runs, in the colours the map uses -->
    <path v-for="r in runPaths" :key="r.key" :d="r.d" class="ls-run" :stroke="r.colour" />

    <!-- Boundary lengths; the frontage's own edges are labelled by the run instead -->
    <text
      v-for="l in edgeLabels" :key="l.key"
      :x="l.x" :y="l.y" text-anchor="middle" dominant-baseline="middle"
      class="ls-edge"
    >{{ l.text }}</text>

    <!-- Road name and length, below each frontage -->
    <g v-for="r in runLabels" :key="r.key">
      <text :x="r.x" :y="r.y" text-anchor="middle" class="ls-road" :fill="r.colour">{{ r.road }}</text>
      <text :x="r.x" :y="r.y + 12" text-anchor="middle" class="ls-road-n" :fill="r.colour">{{ r.text }}</text>
    </g>

    <!-- Handle, on a battle-axe -->
    <text v-if="handleLabel" :x="handleLabel.x" :y="handleLabel.y" text-anchor="middle" class="ls-handle">{{ handleLabel.text }}</text>

    <!-- Area -->
    <text :x="areaAt.x" :y="areaAt.y - 2" text-anchor="middle" class="ls-area">{{ areaText }}</text>
    <text :x="areaAt.x" :y="areaAt.y + 13" text-anchor="middle" class="ls-area-sub">{{ perimeterText }}</text>

    <!-- North arrow -->
    <g class="ls-north" :transform="`translate(${north.cx} ${north.cy})`">
      <line x1="0" y1="0" :x2="north.dx * 14" :y2="north.dy * 14" />
      <polygon :points="north.head" />
      <text :x="north.dx * 24" :y="north.dy * 24 + 3.5" text-anchor="middle" class="ls-north-n">N</text>
    </g>

    <!-- Scale bar -->
    <g class="ls-scale" :transform="`translate(${PAD - 30} ${H - 14})`">
      <line x1="0" y1="0" :x2="scaleBar.px" y2="0" />
      <line x1="0" y1="-3" x2="0" y2="3" />
      <line :x1="scaleBar.px" y1="-3" :x2="scaleBar.px" y2="3" />
      <text :x="scaleBar.px / 2" y="-5" text-anchor="middle">{{ scaleBar.text }}</text>
    </g>
  </svg>
</template>

<script setup lang="ts">
type LngLat = [number, number]
type Pt = { x: number, y: number }

interface FrontageRun {
  edges: number[]
  length_m: number
  coords: LngLat[]
  road: string | null
  is_primary?: boolean
}
interface FrontageEdge { index: number, length_m: number, open_m: number }
interface FrontageData {
  ring: LngLat[]
  edges: FrontageEdge[]
  runs: FrontageRun[]
  profile?: Array<{ depth: number, width: number, arms: number }>
  area_sqm?: number | null
  perimeter_m?: number | null
  lot_depth_m?: number | null
  width_at_setback_m?: number | null
  width_setback_depth_m?: number | null
  core_width_min_m?: number | null
  is_battleaxe?: boolean
  handle_length_m?: number | null
  stem_width_m?: number | null
  handle_neck_min_m?: number | null
}

const props = defineProps<{
  data: FrontageData
  /** Figures for the dimension lines, when the caller has a record to read them from. */
  depthM?: number | null
  widthAtSetbackM?: number | null
  coreWidthMinM?: number | null
  areaSqm?: number | null
}>()

const W = 520
const H = 520
const PAD = 64

/** The map's run colours, in run order, so a frontage is the same colour on both. */
const RUN_COLOURS = ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#a855f7']

// ── Geometry: metres, rotated so the street is at the bottom, fitted ──────

const M_PER_DEG_LAT = 110540
const M_PER_DEG_LNG = 111320

const frame = computed(() => {
  const ring = props.data.ring
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const lng0 = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const toM = ([lng, lat]: LngLat): Pt => ({ x: (lng - lng0) * k * M_PER_DEG_LNG, y: (lat - lat0) * M_PER_DEG_LAT })

  const ringM = ring.map(toM)
  const c = centroidOf(ringM)

  // Rotate so the primary frontage's outward side faces down.
  let theta = 0
  const primary = props.data.runs.find(r => r.is_primary) ?? props.data.runs[0]
  if (primary && primary.coords.length > 1) {
    const a = toM(primary.coords[0]!)
    const b = toM(primary.coords[primary.coords.length - 1]!)
    const chord = { x: b.x - a.x, y: b.y - a.y }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    let n = { x: chord.y, y: -chord.x }
    if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y }
    theta = -Math.PI / 2 - Math.atan2(n.y, n.x)
  }
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const rot = (p: Pt): Pt => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })

  const ringR = ringM.map(rot)
  const xs = ringR.map(p => p.x)
  const ys = ringR.map(p => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1), (H - 2 * PAD) / Math.max(maxY - minY, 1))
  const ox = (W - (maxX - minX) * scale) / 2
  const oy = (H - (maxY - minY) * scale) / 2

  // Metres (rotated, y up) → SVG pixels (y down).
  const toSvg = (p: Pt): Pt => ({ x: ox + (p.x - minX) * scale, y: H - oy - (p.y - minY) * scale })
  const place = (ll: LngLat): Pt => toSvg(rot(toM(ll)))

  return { toM, rot, toSvg, place, ringR, scale, theta, bboxR: { minX, maxX, minY, maxY } }
})

/** Points in SVG pixels, one per ring vertex, the closing vertex dropped. */
const ringPx = computed(() => {
  const { ringR, toSvg } = frame.value
  const pts = ringR.map(toSvg)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return Math.hypot(first.x - last.x, first.y - last.y) < 0.01 ? pts.slice(0, -1) : pts
})

const lotPath = computed(() =>
  ringPx.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z',
)

function centroidOf(pts: Pt[]): Pt {
  // Shoelace centroid; a degenerate ring falls back to the mean of its points.
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    const w = p.x * q.y - q.x * p.y
    a += w
    cx += (p.x + q.x) * w
    cy += (p.y + q.y) * w
  }
  if (Math.abs(a) < 1e-9) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

function signedArea(pts: Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function inside(pt: Pt, poly: Pt[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** Where a horizontal line at SVG y crosses the boundary, leftmost and rightmost. */
function chordAt(y: number): { x1: number, x2: number } | null {
  const pts = ringPx.value
  const xs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
  }
  if (xs.length < 2) return null
  return { x1: Math.min(...xs), x2: Math.max(...xs) }
}

// ── Frontage runs ──────────────────────────────────────────────────────────

const runEdgeSet = computed(() => new Set(props.data.runs.flatMap(r => r.edges)))

const runPaths = computed(() =>
  props.data.runs
    .filter(r => r.coords.length > 1)
    .map((r, i) => ({
      key: i,
      colour: RUN_COLOURS[i % RUN_COLOURS.length]!,
      d: r.coords.map((ll, j) => {
        const p = frame.value.place(ll)
        return `${j ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      }).join(' '),
    })),
)

/** Outward unit normal of the boundary edge from vertex i to i+1, in SVG pixels. */
function outwardNormal(i: number): Pt {
  const pts = ringPx.value
  const a = pts[i]!
  const b = pts[(i + 1) % pts.length]!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // SVG y points down, so a positive shoelace area here means clockwise on screen.
  const cw = signedArea(pts) > 0
  return cw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len }
}

const runLabels = computed(() =>
  props.data.runs
    .filter(r => r.coords.length > 1)
    .map((r, i) => {
      const pts = r.coords.map(frame.value.place)
      const a = pts[0]!
      const b = pts[pts.length - 1]!
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      // Outward from the lot's centre, so the name sits on the street side.
      const c = centroidPx.value
      let n = { x: mid.x - c.x, y: mid.y - c.y }
      const len = Math.hypot(n.x, n.y) || 1
      n = { x: n.x / len, y: n.y / len }
      return {
        key: i,
        colour: RUN_COLOURS[i % RUN_COLOURS.length]!,
        road: (r.road ?? 'Unnamed road').toUpperCase(),
        text: `${r.length_m.toFixed(2)} m`,
        x: mid.x + n.x * 26,
        y: mid.y + n.y * 26 + 4,
      }
    }),
)

// ── Boundary lengths ───────────────────────────────────────────────────────

/**
 * One label per boundary, and one per run of short segments: a splayed or
 * curved corner arrives as a dozen one-metre edges, which as a dozen labels
 * would bury the four that matter.
 */
const edgeLabels = computed(() => {
  const pts = ringPx.value
  const edges = props.data.edges
  const n = Math.min(pts.length, edges.length)
  if (!n) return []
  const perim = edges.reduce((s, e) => s + e.length_m, 0)
  const minLen = Math.max(2.5, perim * 0.025)

  const out: Array<{ key: string, x: number, y: number, text: string }> = []
  let i = 0
  while (i < n) {
    if (runEdgeSet.value.has(i)) { i++; continue }
    const e = edges[i]!
    if (e.length_m >= minLen) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const nn = outwardNormal(i)
      out.push({ key: `e${i}`, x: (a.x + b.x) / 2 + nn.x * 15, y: (a.y + b.y) / 2 + nn.y * 15, text: fmtM(e.length_m) })
      i++
      continue
    }
    // Gather the run of short edges that follows.
    let j = i
    let total = 0
    while (j < n && !runEdgeSet.value.has(j) && edges[j]!.length_m < minLen) { total += edges[j]!.length_m; j++ }
    if (total >= 1.5) {
      const midIdx = Math.floor((i + j) / 2)
      const a = pts[midIdx]!
      const nn = outwardNormal(Math.min(midIdx, n - 1))
      out.push({ key: `g${i}`, x: a.x + nn.x * 16, y: a.y + nn.y * 16, text: fmtM(total) })
    }
    i = j
  }
  return out
})

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(2) : m.toFixed(1)} m`
}

// ── Dimension lines ────────────────────────────────────────────────────────

/** The frontage's y in SVG pixels: the mean of the primary run's vertices, else the lot's bottom. */
const frontageY = computed(() => {
  const primary = props.data.runs.find(r => r.is_primary) ?? props.data.runs[0]
  if (primary && primary.coords.length) {
    const ys = primary.coords.map(ll => frame.value.place(ll).y)
    return ys.reduce((s, y) => s + y, 0) / ys.length
  }
  return Math.max(...ringPx.value.map(p => p.y))
})

const pxPerM = computed(() => frame.value.scale)

/**
 * The depth line stands off whichever side has no street on it. A corner lot's
 * second frontage runs up one side with its name beside it, and the line and
 * the name cannot share that side.
 */
const depthSide = computed<'left' | 'right'>(() => {
  const c = centroidPx.value
  const rightBusy = props.data.runs
    .filter(r => !r.is_primary && r.coords.length)
    .some(r => r.coords.reduce((s, ll) => s + frame.value.place(ll).x, 0) / r.coords.length > c.x)
  return rightBusy ? 'left' : 'right'
})

const depthLine = computed(() => {
  const depth = props.depthM ?? props.data.lot_depth_m
  if (!depth || !props.data.runs.length) return null
  const y1 = frontageY.value
  const y2 = y1 - depth * pxPerM.value
  const xs = ringPx.value.map(p => p.x)
  const right = depthSide.value === 'right'
  const x = right ? Math.max(...xs) + 18 : Math.min(...xs) - 18
  const dir = right ? 1 : -1
  return { x, y1, y2, text: fmtM(depth), sub: 'depth', textX: x + dir * 10, subX: x + dir * 21 }
})

const widthLines = computed(() => {
  const out: Array<{ key: string, y: number, x1: number, x2: number, text: string, sub: string }> = []
  if (!props.data.runs.length) return out

  const setbackDepth = props.data.width_setback_depth_m ?? 4.5
  const wSet = props.widthAtSetbackM ?? props.data.width_at_setback_m
  if (wSet) {
    const y = frontageY.value - setbackDepth * pxPerM.value
    const chord = chordAt(y)
    if (chord) out.push({ key: 'setback', y, ...chord, text: fmtM(wSet), sub: `at ${setbackDepth} m setback` })
  }

  // Where the record's narrowest core width was measured: the sweep point whose
  // width is closest to it, past the handle. Not the sweep's own minimum, which
  // on a lot that tapers to a point is the last half-metre of the tip.
  const wMin = props.coreWidthMinM ?? props.data.core_width_min_m
  const profile = props.data.profile ?? []
  if (wMin && profile.length) {
    const handle = props.data.handle_length_m ?? 0
    const core = profile.filter(p => p.depth > handle + 0.5 && p.width > 0.5)
    const at = core.reduce<typeof core[number] | null>(
      (m, p) => (!m || Math.abs(p.width - wMin) < Math.abs(m.width - wMin) ? p : m), null,
    )
    // Drawn only where it says something the setback line does not: a lot
    // that is narrowest at its street is already described by the frontage
    // and setback figures, and a line a few pixels above them is just clutter.
    const nearFront = at ? at.depth < setbackDepth + 2 : true
    const sameAsSetback = wSet != null && Math.abs(wMin - wSet) < 0.25
    if (at && !nearFront && !sameAsSetback && Math.abs(at.width - wMin) < Math.max(0.5, wMin * 0.1)) {
      const y = frontageY.value - at.depth * pxPerM.value
      const clash = out.some(d => Math.abs(d.y - y) < 30)
      const chord = chordAt(y)
      if (chord && !clash) out.push({ key: 'narrowest', y, ...chord, text: fmtM(wMin), sub: 'narrowest' })
    }
  }
  return out
})

const handleLabel = computed(() => {
  if (!props.data.is_battleaxe || !props.data.handle_length_m) return null
  const y = frontageY.value - (props.data.handle_length_m / 2) * pxPerM.value
  const chord = chordAt(y)
  if (!chord) return null
  const w = props.data.stem_width_m ?? props.data.handle_neck_min_m
  return {
    x: (chord.x1 + chord.x2) / 2,
    y,
    text: w ? `handle ${fmtM(w)} × ${fmtM(props.data.handle_length_m)}` : 'handle',
  }
})

// ── Area, north, scale ─────────────────────────────────────────────────────

const centroidPx = computed(() => centroidOf(ringPx.value))

/** The centroid, unless the shape puts it outside itself, then the widest chord's middle. */
const areaAt = computed(() => {
  const c = centroidPx.value
  if (inside(c, ringPx.value)) return c
  const profile = props.data.profile ?? []
  const widest = profile.reduce<typeof profile[number] | null>((m, p) => (!m || p.width > m.width ? p : m), null)
  if (widest) {
    const y = frontageY.value - widest.depth * pxPerM.value
    const chord = chordAt(y)
    if (chord) return { x: (chord.x1 + chord.x2) / 2, y }
  }
  return c
})

const areaText = computed(() => {
  const a = props.areaSqm ?? props.data.area_sqm
  return a ? `${Math.round(a).toLocaleString()} m²` : ''
})
const perimeterText = computed(() => {
  const p = props.data.perimeter_m
  return p ? `${p.toFixed(1)} m around` : ''
})

const north = computed(() => {
  const { theta } = frame.value
  // North is (0, 1) in metres; rotate, then flip for SVG.
  const dx = -Math.sin(theta)
  const dy = -Math.cos(theta)
  const cx = PAD - 18
  const cy = PAD - 18
  const tip = { x: dx * 18, y: dy * 18 }
  const px = -dy
  const py = dx
  const head = [
    `${tip.x.toFixed(1)},${tip.y.toFixed(1)}`,
    `${(dx * 10 + px * 4).toFixed(1)},${(dy * 10 + py * 4).toFixed(1)}`,
    `${(dx * 10 - px * 4).toFixed(1)},${(dy * 10 - py * 4).toFixed(1)}`,
  ].join(' ')
  return { cx, cy, dx, dy, head }
})

const scaleBar = computed(() => {
  const candidates = [1, 2, 5, 10, 20, 50, 100]
  const m = candidates.find(c => c * pxPerM.value >= 48) ?? 100
  return { px: m * pxPerM.value, text: `${m} m` }
})

const ariaLabel = computed(() => {
  const parts = [`Lot sketch, ${areaText.value}`]
  for (const r of props.data.runs) parts.push(`${r.road ?? 'unnamed road'} frontage ${r.length_m.toFixed(2)} m`)
  if (depthLine.value) parts.push(`depth ${depthLine.value.text}`)
  return parts.join(', ')
})
</script>

<style scoped>
.ls {
  display: block;
  width: 100%;
  height: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
}
.ls-lot {
  fill: #f0fdf4;
  stroke: #334155;
  stroke-width: 1.4;
  stroke-linejoin: round;
}
.ls-run {
  fill: none;
  stroke-width: 4.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.95;
}
.ls-edge {
  font-size: 10.5px;
  font-weight: 600;
  fill: #475569;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 3;
  stroke-linejoin: round;
}
.ls-road {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 3;
  stroke-linejoin: round;
}
.ls-road-n {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 3;
  stroke-linejoin: round;
}
.ls-dim line {
  stroke: #ea580c;
  stroke-width: 1;
}
.ls-dim--setback line:first-child,
.ls-dim--narrowest line:first-child { stroke-dasharray: 3 3; }
.ls-dim-n {
  font-size: 10.5px;
  font-weight: 700;
  fill: #c2410c;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: #f0fdf4;
  stroke-width: 3;
  stroke-linejoin: round;
}
.ls-dim-sub {
  font-size: 8.5px;
  font-weight: 500;
  fill: #ea580c;
  paint-order: stroke;
  stroke: #f0fdf4;
  stroke-width: 3;
  stroke-linejoin: round;
}
.ls-dim--depth .ls-dim-n,
.ls-dim--depth .ls-dim-sub { stroke: #fff; }
.ls-handle {
  font-size: 9px;
  font-weight: 600;
  fill: #b45309;
  paint-order: stroke;
  stroke: #f0fdf4;
  stroke-width: 3;
}
.ls-area {
  font-size: 17px;
  font-weight: 800;
  fill: #0f172a;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: #f0fdf4;
  stroke-width: 4;
  stroke-linejoin: round;
}
.ls-area-sub {
  font-size: 9.5px;
  font-weight: 500;
  fill: #64748b;
  paint-order: stroke;
  stroke: #f0fdf4;
  stroke-width: 3;
}
.ls-north line { stroke: #0f172a; stroke-width: 1.2; }
.ls-north polygon { fill: #0f172a; }
.ls-north-n { font-size: 9px; font-weight: 800; fill: #0f172a; }
.ls-scale line { stroke: #64748b; stroke-width: 1; }
.ls-scale text { font-size: 8.5px; fill: #64748b; font-weight: 600; }
</style>
