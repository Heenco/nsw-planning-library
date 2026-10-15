<!--
  SlopeTerrain - /report-2's "Levels and contours": a north-up plan of the lot and its surroundings with the ground's
  slope shaded in bands, contours, the corner levels, the high and low points and the fall, plus the survey marks nearby.
  Everything comes from /api/report/terrain (NSW 5 m elevation model, survey mark register, cadastre).
-->
<template>
  <div class="st">
    <p v-if="error" class="st-error">{{ error }}</p>
    <p v-else-if="!t" class="st-muted">Reading ground levels from the NSW elevation model…</p>
    <div v-else class="st-grid">
      <figure class="st-plan">
        <svg :viewBox="`0 0 ${pw} ${ph}`" role="img" :aria-label="`Contour plan: the lot falls ${t.levels.fall.toFixed(1)} m toward the ${towardWord}`">
          <defs>
            <clipPath :id="`st-clip-${uid}`"><rect x="0" y="0" :width="pw" :height="ph" /></clipPath>
            <marker :id="`st-arrow-${uid}`" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#1d4ed8" />
            </marker>
          </defs>
          <rect x="0" y="0" :width="pw" :height="ph" class="st-bg" />
          <g :clip-path="`url(#st-clip-${uid})`">
            <!-- slope bands -->
            <rect v-for="(c, i) in cells" :key="`c${i}`" :x="c.x" :y="c.y" :width="c.w" :height="c.h" :fill="BAND_COLORS[c.b]" class="st-cell" />
            <!-- neighbouring lots and roads -->
            <polygon v-for="(n, i) in neighbours" :key="`n${i}`" :points="n.points" class="st-neigh" />
            <path v-for="(r, i) in roads" :key="`r${i}`" :d="r.d" class="st-road" />
            <!-- contours -->
            <path v-for="(c, i) in contourPaths" :key="`k${i}`" :d="c.d" :class="c.major ? 'st-major' : 'st-minor'" />
            <text v-for="(l, i) in contourLabels" :key="`kl${i}`" :x="l.x" :y="l.y" :transform="`rotate(${l.a} ${l.x} ${l.y})`" class="st-klab" text-anchor="middle" dy="3">{{ l.text }}</text>
            <text v-for="(n, i) in neighbourLabels" :key="`nl${i}`" :x="n.x" :y="n.y" class="st-nlab" text-anchor="middle">{{ n.text }}</text>
            <text v-for="(r, i) in roadLabels" :key="`rl${i}`" :x="r.x" :y="r.y" :transform="`rotate(${r.a} ${r.x} ${r.y})`" class="st-rlab" text-anchor="middle" dy="-4">{{ r.text }}</text>
            <!-- the lot -->
            <polygon :points="lotPoints" class="st-lot" />
            <text v-for="(e, i) in edgeLabels" :key="`e${i}`" :x="e.x" :y="e.y" :transform="`rotate(${e.a} ${e.x} ${e.y})`" class="st-elab" text-anchor="middle" dy="3">{{ e.text }}</text>
            <g v-for="(c, i) in cornerLabels" :key="`cr${i}`">
              <circle :cx="c.px" :cy="c.py" r="2.4" class="st-dot" />
              <text :x="c.x" :y="c.y" :text-anchor="c.anchor" :class="['st-rl', c.tag && `st-rl--${c.tag}`]" dy="3">{{ c.text }}</text>
            </g>
            <g v-for="(m, i) in extremes" :key="`x${i}`">
              <path :d="`M${m.px - 4},${m.py - 4} L${m.px + 4},${m.py + 4} M${m.px - 4},${m.py + 4} L${m.px + 4},${m.py - 4}`" :class="`st-x st-x--${m.tag}`" />
              <text :x="m.px + 7" :y="m.py" :class="`st-rl st-rl--${m.tag}`" dy="3">{{ m.text }}</text>
            </g>
            <!-- the fall -->
            <line v-if="arrow" :x1="arrow.x1" :y1="arrow.y1" :x2="arrow.x2" :y2="arrow.y2" class="st-fall" :marker-end="`url(#st-arrow-${uid})`" />
            <text v-if="arrow" :x="arrow.lx" :y="arrow.ly" :transform="`rotate(${arrow.a} ${arrow.lx} ${arrow.ly})`" class="st-falllab" text-anchor="middle" dy="-5">{{ arrow.text }}</text>
            <!-- survey marks -->
            <g v-for="m in marksInFrame" :key="m.id">
              <path :d="`M${m.px},${m.py - 6} L${m.px + 5},${m.py + 3} L${m.px - 5},${m.py + 3} z`" class="st-mark" />
              <text :x="m.px + 8" :y="m.py" class="st-marklab" dy="3">{{ m.id }}{{ m.ahd != null ? ` RL ${m.ahd.toFixed(2)}` : '' }}</text>
            </g>
          </g>
          <!-- north and scale -->
          <g :transform="`translate(${pw - 26}, 16)`">
            <path d="M0,22 L0,0 M-5,8 L0,0 L5,8" class="st-north" />
            <text x="0" y="34" text-anchor="middle" class="st-northlab">N</text>
          </g>
          <g :transform="`translate(12, ${ph - 14})`">
            <rect x="0" y="-5" :width="scaleBar.px / 2" height="5" class="st-sb1" />
            <rect :x="scaleBar.px / 2" y="-5" :width="scaleBar.px / 2" height="5" class="st-sb2" />
            <text x="0" y="-9" class="st-sblab">0</text>
            <text :x="scaleBar.px" y="-9" text-anchor="middle" class="st-sblab">{{ scaleBar.m }} m</text>
          </g>
        </svg>
        <figcaption class="st-cap">
          Contours every {{ fmtM(t.contours.minor) }} (heavier every {{ fmtM(t.contours.major) }}), levels in metres AHD. Shading is the
          slope of the ground; dashed lines are the neighbouring lots and road centrelines.
        </figcaption>
      </figure>

      <div class="st-side">
        <h4>Terrain summary</h4>
        <dl class="st-dl">
          <div><dt>Levels on the lot</dt><dd>RL {{ t.levels.low.rl.toFixed(2) }} – {{ t.levels.high.rl.toFixed(2) }} <span>({{ t.levels.fall.toFixed(1) }} m fall)</span></dd></div>
          <div v-if="t.levels.grade != null"><dt>Overall grade</dt><dd>{{ t.levels.grade.toFixed(1) }}% <span>falling to the {{ towardWord }}</span></dd></div>
          <div v-if="t.levels.slopeMedian != null"><dt>Slope on the lot</dt><dd>median {{ t.levels.slopeMedian.toFixed(1) }}% <span>· steepest {{ t.levels.slopeMax?.toFixed(1) }}%</span></dd></div>
          <div v-if="grade"><dt>Site</dt><dd :style="{ color: grade.color }">{{ grade.name }}</dd></div>
        </dl>
        <p v-if="drainage" :class="t.street?.fallsAway ? 'st-warn' : 'st-ok'">{{ drainage }}</p>

        <h4>Slope analysis</h4>
        <ul class="st-key">
          <li v-for="(b, i) in BAND_LABELS" :key="b">
            <span class="st-sw" :style="{ background: BAND_COLORS[i] }" />{{ b }}
            <span class="st-pct">{{ Math.round((t.levels.shares[i] ?? 0) * 100) }}% of the lot</span>
          </li>
        </ul>

        <h4>Nearby survey marks</h4>
        <p v-if="t.marksNote" class="st-muted">{{ t.marksNote }}</p>
        <p v-else-if="!t.marks.length" class="st-muted">No survey marks within 300 m.</p>
        <table v-else class="st-table">
          <thead><tr><th>Mark</th><th>AHD RL</th><th>Distance</th><th>Class</th></tr></thead>
          <tbody>
            <tr v-for="m in t.marks" :key="m.id">
              <td>{{ m.id }}</td>
              <td>{{ m.ahd != null ? m.ahd.toFixed(2) : '–' }}</td>
              <td>{{ Math.round(m.dist) }} m</td>
              <td :title="m.ahdOrder ? `AHD order ${m.ahdOrder}` : ''">{{ m.ahdClass ?? '–' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p v-if="t" class="st-foot">
      Levels: NSW Spatial Services' state-wide 5 m elevation model (AHD, bare earth from aerial imagery, not LiDAR), sampled every
      {{ fmtM(t.frame.step) }} and smoothed once - expect ±0.5–1 m, and falls on sloping sites tend to read low. Survey marks:
      the NSW survey mark register (a "U" class height is unverified). Boundaries: the NSW cadastre, indicative only. A desktop
      estimate for early design, not a detail or level survey - a registered surveyor's survey is needed before drawings are lodged.
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ cadid: string }>()

/** The section's slope bands and colours - the same cuts as report-2's "how much of the lot is how steep" bar. */
const BAND_COLORS = ['#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#991b1b']
const BAND_LABELS = ['under 5%', '5-10%', '10-15%', '15-20%', '20-25%', 'over 25%']
const GRADES = [
  { upTo: 5, name: 'Flat', color: '#16a34a' }, { upTo: 10, name: 'Gentle', color: '#65a30d' }, { upTo: 15, name: 'Moderate', color: '#ca8a04' },
  { upTo: 25, name: 'Steep', color: '#ea580c' }, { upTo: Infinity, name: 'Very steep', color: '#dc2626' },
]
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']

const uid = Math.random().toString(36).slice(2, 8)
const t = ref<any>(null)
const error = ref('')
watch(() => props.cadid, async (id) => {
  t.value = null
  error.value = ''
  if (!id) return
  try {
    const r = await $fetch<any>('/api/report/terrain', { query: { cadid: id } })
    if (props.cadid === id) t.value = r
  } catch (e: any) {
    if (props.cadid === id) error.value = e?.data?.statusMessage || e?.data?.message || e?.message || 'Could not read the ground levels.'
  }
}, { immediate: true })

const fmtM = (m: number) => `${Number(m.toFixed(2))} m`

// ── the drawing frame: metres -> px, north up ──
const MAX_W = 640, MAX_H = 700
const s = computed(() => (t.value ? Math.min(MAX_W / t.value.frame.W, MAX_H / t.value.frame.H) : 1))
const pw = computed(() => (t.value ? t.value.frame.W * s.value : MAX_W))
const ph = computed(() => (t.value ? t.value.frame.H * s.value : 300))
const X = (x: number) => (x - t.value.frame.x0) * s.value
const Y = (y: number) => (t.value.frame.y0 + t.value.frame.H - y) * s.value
/** text angle along a direction, kept upright */
const upright = (dx: number, dy: number) => { let a = (Math.atan2(dy, dx) * 180) / Math.PI; if (a > 90) a -= 180; if (a < -90) a += 180; return a }

const cells = computed(() => {
  if (!t.value) return []
  const { x0, y0, step } = t.value.frame
  const out: { x: number; y: number; w: number; h: number; b: number }[] = []
  t.value.bands.forEach((row: string, j: number) => {
    let i = 0
    while (i < row.length) {
      const ch = row[i]!
      let k = i
      while (k < row.length && row[k] === ch) k++
      if (ch !== '.') out.push({ x: X(x0 + (i - 0.5) * step), y: Y(y0 + (j + 0.5) * step), w: (k - i) * step * s.value + 0.4, h: step * s.value + 0.4, b: Number(ch) })
      i = k
    }
  })
  return out
})

const pathOf = (flat: number[]) => flat.reduce((d, v, i) => (i % 2 ? d : `${d}${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(flat[i + 1]!).toFixed(1)}`), '')
const contourPaths = computed(() => (t.value?.contours.levels ?? []).map((l: any) => ({ major: l.major, d: l.lines.map(pathOf).join('') })))
const contourLabels = computed(() => (t.value?.contours.levels ?? []).filter((l: any) => l.major).flatMap((l: any) => {
  const line = l.lines.reduce((a: number[], b: number[]) => (b.length > a.length ? b : a), [])
  if (line.length < 4) return []
  const m = Math.floor(line.length / 4) * 2
  const [ax, ay, bx, by] = [line[m - 2] ?? line[m], line[m - 1] ?? line[m + 1], line[m + 2] ?? line[m], line[m + 3] ?? line[m + 1]]
  return [{ x: X(line[m]), y: Y(line[m + 1]), a: upright(X(bx) - X(ax), Y(by) - Y(ay)), text: Number(l.z.toFixed(2)).toString() }]
}))

const neighbours = computed(() => (t.value?.neighbours ?? []).map((n: any) => ({ points: n.ring.map((p: number[]) => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ') })))
const neighbourLabels = computed(() => (t.value?.neighbours ?? []).filter((n: any) => n.adjoins && n.lotId).map((n: any) => {
  const cx = n.ring.reduce((a: number, p: number[]) => a + p[0]!, 0) / n.ring.length, cy = n.ring.reduce((a: number, p: number[]) => a + p[1]!, 0) / n.ring.length
  return { x: X(cx), y: Y(cy), text: n.lotId }
}))
const roads = computed(() => (t.value?.roads ?? []).map((r: any) => ({ d: pathOf(r.line.flat()) })))
const roadLabels = computed(() => {
  if (!t.value) return []
  const seen = new Set<string>()
  return [...t.value.roads].sort((a: any, b: any) => b.line.length - a.line.length).filter((r: any) => r.name && !seen.has(r.name) && seen.add(r.name)).map((r: any) => {
    const m = Math.floor((r.line.length - 1) / 2)
    const a = r.line[m], b = r.line[Math.min(m + 1, r.line.length - 1)]
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    return { x: X(mx), y: Y(my), a: upright(X(b[0]) - X(a[0]), Y(b[1]) - Y(a[1])), text: String(r.name).toUpperCase() }
  })
})

const lotPoints = computed(() => (t.value?.lot.ring ?? []).map((p: number[]) => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' '))
const lotCentre = computed(() => {
  const r = t.value?.lot.ring ?? []
  return r.length ? [r.reduce((a: number, p: number[]) => a + p[0]!, 0) / r.length, r.reduce((a: number, p: number[]) => a + p[1]!, 0) / r.length] : [0, 0]
})
const edgeLabels = computed(() => {
  if (!t.value) return []
  const c = t.value.lot.corners
  return t.value.lot.edges.filter((e: any) => e.length >= 3).map((e: any) => {
    const a = c[e.from], b = c[e.to]
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
    // anticlockwise ring: the outward normal is to the right of the direction of travel
    const off = 9 / s.value // 9 px outside the line, in metres
    const ox = (dy / L) * off, oy = (-dx / L) * off
    const mx = (a.x + b.x) / 2 + ox, my = (a.y + b.y) / 2 + oy
    return { x: X(mx), y: Y(my), a: upright(X(b.x) - X(a.x), Y(b.y) - Y(a.y)), text: e.length.toFixed(2) }
  })
})
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 2.5
const cornerLabels = computed(() => {
  if (!t.value) return []
  const [cx, cy] = lotCentre.value
  return t.value.lot.corners.filter((c: any) => c.rl != null).map((c: any) => {
    const tag = near(c, t.value.levels.high) ? 'high' : near(c, t.value.levels.low) ? 'low' : ''
    const dx = c.x - cx!, dy = c.y - cy!, L = Math.hypot(dx, dy) || 1
    const px = X(c.x), py = Y(c.y)
    return {
      px, py, tag, x: px + (dx / L) * 8, y: py - (dy / L) * 10,
      anchor: dx >= 0 ? 'start' : 'end',
      text: `${tag ? `${tag.toUpperCase()} ` : ''}RL ${c.rl.toFixed(2)}`,
    }
  })
})
const extremes = computed(() => {
  if (!t.value) return []
  const { high, low } = t.value.levels
  return [['high', high], ['low', low]].filter(([, p]: any) => !t.value.lot.corners.some((c: any) => near(c, p)))
    .map(([tag, p]: any) => ({ tag, px: X(p.x), py: Y(p.y), text: `${tag.toUpperCase()} RL ${p.rl.toFixed(2)}` }))
})

const towardWord = computed(() => (t.value?.levels.fallsToward != null ? COMPASS[Math.round((t.value.levels.fallsToward % 360) / 22.5) % 16] : ''))
const arrow = computed(() => {
  const l = t.value?.levels
  if (!l || l.fallsToward == null || l.grade == null || l.grade < 1) return null
  const th = (l.fallsToward * Math.PI) / 180
  const ux = Math.sin(th), uy = Math.cos(th)
  const [cx, cy] = lotCentre.value
  const proj = t.value.lot.ring.map((p: number[]) => (p[0]! - cx!) * ux + (p[1]! - cy!) * uy)
  const lo = Math.min(...proj) * 0.62, hi = Math.max(...proj) * 0.62
  const x1 = X(cx! + ux * lo), y1 = Y(cy! + uy * lo), x2 = X(cx! + ux * hi), y2 = Y(cy! + uy * hi)
  return { x1, y1, x2, y2, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2, a: upright(x2 - x1, y2 - y1), text: `FALL ${l.fall.toFixed(1)} m @ ${l.grade.toFixed(1)}%` }
})

const marksInFrame = computed(() => (t.value?.marks ?? []).filter((m: any) => m.inFrame).map((m: any) => ({ ...m, px: X(m.x), py: Y(m.y) })))
const scaleBar = computed(() => {
  if (!t.value) return { m: 10, px: 50 }
  const target = t.value.frame.W * 0.22
  const m = [2, 5, 10, 20, 50, 100, 200, 500].reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), 10)
  return { m, px: m * s.value }
})
const grade = computed(() => {
  const v = t.value?.levels.slopeMedian
  return v == null ? null : GRADES.find(g => v < g.upTo)!
})
const drainage = computed(() => {
  const st = t.value?.street
  if (!st) return ''
  const road = st.road ? titleRoad(st.road) : 'the street'
  const below = st.rl - t.value.levels.low.rl
  return st.fallsAway
    ? `The lot falls away from ${road}: its low point is about ${below.toFixed(1)} m below the street boundary, so roof and surface water can't drain to the kerb by gravity. Expect to need a drainage easement through a downhill lot, or another approved discharge - an engineer confirms.`
    : `The lot falls toward ${road}, so roof and surface water can usually drain to the kerb by gravity.`
})
function titleRoad(r: string) {
  const types: Record<string, string> = { ST: 'Street', RD: 'Road', AVE: 'Avenue', AV: 'Avenue', CR: 'Crescent', CRES: 'Crescent', DR: 'Drive', PL: 'Place', PDE: 'Parade', HWY: 'Highway', CL: 'Close', CT: 'Court', LN: 'Lane', TCE: 'Terrace', WAY: 'Way', GR: 'Grove', CCT: 'Circuit' }
  return r.toLowerCase().split(/\s+/).map(w => types[w.toUpperCase()] ?? (w[0]?.toUpperCase() + w.slice(1))).join(' ')
}
</script>

<style scoped>
.st { margin-top: 8px; }
.st-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.st-plan { margin: 0; }
.st-plan svg { width: 100%; height: auto; display: block; border: 1px solid var(--line, #e3e7eb); border-radius: 8px; background: #fff; }
.st-bg { fill: #fbfcfd; }
.st-cell { fill-opacity: 0.22; shape-rendering: crispEdges; }
.st-neigh { fill: none; stroke: #94a3b8; stroke-width: 0.9; stroke-dasharray: 4 3; }
.st-road { fill: none; stroke: #64748b; stroke-width: 1; stroke-dasharray: 10 3 2 3; }
.st-minor { fill: none; stroke: #64748b; stroke-opacity: 0.55; stroke-width: 0.6; }
.st-major { fill: none; stroke: #1f2937; stroke-opacity: 0.85; stroke-width: 1.15; }
.st-lot { fill: none; stroke: #0b0f14; stroke-width: 2.2; stroke-linejoin: round; }
.st-klab, .st-elab, .st-rl, .st-rlab, .st-nlab, .st-marklab, .st-falllab {
  paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
.st-klab { font-size: 8.5px; fill: #374151; }
.st-elab { font-size: 9.5px; font-weight: 700; fill: #0b0f14; }
.st-rl { font-size: 9px; fill: #111827; }
.st-rl--high { fill: #b91c1c; font-weight: 700; }
.st-rl--low { fill: #1d4ed8; font-weight: 700; }
.st-dot { fill: #0b0f14; }
.st-x { stroke-width: 1.6; }
.st-x--high { stroke: #b91c1c; }
.st-x--low { stroke: #1d4ed8; }
.st-rlab { font-size: 9px; fill: #475569; letter-spacing: 0.06em; }
.st-nlab { font-size: 8px; fill: #94a3b8; }
.st-fall { stroke: #1d4ed8; stroke-width: 1.8; }
.st-falllab { font-size: 9.5px; font-weight: 700; fill: #1d4ed8; }
.st-mark { fill: none; stroke: #7c3aed; stroke-width: 1.4; }
.st-marklab { font-size: 8.5px; fill: #7c3aed; }
.st-north { fill: none; stroke: #0b0f14; stroke-width: 1.4; }
.st-northlab { font-size: 10px; font-weight: 700; fill: #0b0f14; }
.st-sb1 { fill: #0b0f14; }
.st-sb2 { fill: #fff; stroke: #0b0f14; stroke-width: 0.8; }
.st-sblab { font-size: 8.5px; fill: #0b0f14; }
.st-cap, .st-foot { font-size: 0.75rem; color: var(--muted, #5b6570); margin-top: 6px; line-height: 1.45; }
.st-side h4 { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; color: var(--muted, #5b6570); }
.st-side h4:not(:first-child) { margin-top: 18px; }
.st-dl { margin: 0; display: grid; gap: 6px; }
.st-dl div { display: grid; grid-template-columns: 9.5em 1fr; gap: 8px; font-size: 0.85rem; }
.st-dl dt { color: var(--muted, #5b6570); }
.st-dl dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.st-dl dd span { font-weight: 400; color: var(--muted, #5b6570); }
.st-key { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.82rem; }
.st-key li { display: flex; align-items: center; }
.st-sw { width: 14px; height: 14px; border-radius: 3px; margin-right: 8px; opacity: 0.3; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.st-pct { margin-left: auto; color: var(--muted, #5b6570); font-variant-numeric: tabular-nums; }
.st-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.st-table th { text-align: left; font-weight: 600; color: var(--muted, #5b6570); border-bottom: 1px solid var(--line, #e3e7eb); padding: 4px 6px 4px 0; }
.st-table td { padding: 4px 6px 4px 0; border-bottom: 1px solid var(--line, #e3e7eb); }
.st-warn, .st-ok { font-size: 0.82rem; line-height: 1.45; padding: 8px 10px; border-radius: 6px; margin: 12px 0 0; }
.st-warn { background: var(--open-soft, #fff4e2); border: 1px solid var(--open-line, #f1d39b); }
.st-ok { background: var(--ok-soft, #e9f7ee); border: 1px solid var(--ok-line, #b7e3c6); }
.st-muted { color: var(--muted, #5b6570); font-size: 0.85rem; }
.st-error { color: #b91c1c; font-size: 0.85rem; }
@media (max-width: 860px) { .st-grid { grid-template-columns: 1fr; } }
</style>
