<!--
  The small lot map from the /datasources traces, as a component: the lot in
  blue over its neighbouring parcels, the address point, the way point on the
  road, and the access line between them - plus, optionally, the frontage runs.

  Extracted from DsAddressTrace so /testing-spatial-services draws the same
  picture the traces do rather than an approximation of it. Same projection,
  same marks, same colours: a lot looks identical on both pages.

  Nothing here is a map in the map sense. There is no basemap and no scale bar;
  it is the parcel fabric around one lot, fitted into a box with a little air
  around it, which is what makes access and frontage legible.
-->

<template>
  <figure class="lm">
    <svg v-if="map" :viewBox="`0 0 ${MW} ${MH}`" class="lm-svg" role="img" :aria-label="label">
      <defs>
        <clipPath :id="clipId"><rect :width="MW" :height="MH" /></clipPath>
      </defs>
      <g :clip-path="`url(#${clipId})`">
        <path v-for="(d, i) in map.neighbours" :key="`n${i}`" :d="d" class="lm-neighbour" />
        <path v-for="lot in map.lots" :key="lot.cadid" :d="lot.d" class="lm-lot" />
        <path
          v-for="(r, i) in map.runs" :key="`r${i}`" :d="r.d"
          class="lm-run" :class="{ 'lm-run--primary': r.primary }"
        />
        <line v-if="map.way && map.point" :x1="map.point[0]" :y1="map.point[1]" :x2="map.way[0]" :y2="map.way[1]" class="lm-access" />
        <rect v-if="map.way" :x="map.way[0] - 4" :y="map.way[1] - 4" width="8" height="8" class="lm-way" />
        <circle v-if="map.point" :cx="map.point[0]" :cy="map.point[1]" r="6" class="lm-point" />
      </g>
    </svg>
    <p v-else class="lm-empty">No shape to draw.</p>
    <figcaption class="lm-legend">
      <span><i class="lm-key lm-key--lot" />lot shape</span>
      <span v-if="point"><i class="lm-key lm-key--point" />address point</span>
      <span v-if="waypoint"><i class="lm-key lm-key--way" />road access</span>
      <span v-if="neighbours?.length"><i class="lm-key lm-key--neighbour" />neighbouring lots</span>
      <span v-if="runs?.some(r => !r.primary)"><i class="lm-key lm-key--run" />frontage</span>
      <span v-if="runs?.some(r => r.primary)"><i class="lm-key lm-key--primary" />primary frontage</span>
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GeoJsonGeometry } from '#shared/datasources-nsw'

type LngLat = [number, number]

const props = defineProps<{
  lots: { cadid: string; geometry: GeoJsonGeometry }[]
  neighbours?: GeoJsonGeometry[]
  point?: { lon: number; lat: number } | null
  waypoint?: { lon: number; lat: number } | null
  /** Frontage runs as lng/lat linework; drawn over the lot outline. */
  runs?: { coords: LngLat[]; primary?: boolean }[]
  label?: string
}>()

const MW = 360
const MH = 300
const PAD = 18
const clipId = `lm-clip-${Math.random().toString(36).slice(2, 8)}`
const label = computed(() => props.label ?? 'Lot shape, neighbouring lots and road access')

function rings(g: GeoJsonGeometry): number[][][] {
  if (g.type === 'Polygon') return g.coordinates as number[][][]
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).flat()
  return []
}

/**
 * Fit the lot, its point and its way point into the box with air around them.
 * The neighbours are deliberately NOT part of the fit: they are context, and a
 * large neighbour would shrink the lot to a speck. The 1.35 is the same
 * zoom-out the traces use, so the same lot fills the same share of the box.
 */
const map = computed(() => {
  const focus: number[][] = []
  props.lots.forEach(l => rings(l.geometry).forEach(ring => focus.push(...ring)))
  if (props.point) focus.push([props.point.lon, props.point.lat])
  if (props.waypoint) focus.push([props.waypoint.lon, props.waypoint.lat])
  if (!focus.length) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of focus) {
    minX = Math.min(minX, x!); maxX = Math.max(maxX, x!)
    minY = Math.min(minY, y!); maxY = Math.max(maxY, y!)
  }
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180)
  const spanX = Math.max((maxX - minX) * kx, 0.00008)
  const spanY = Math.max(maxY - minY, 0.00008)
  const scale = Math.min((MW - 2 * PAD) / (spanX * 1.35), (MH - 2 * PAD) / (spanY * 1.35))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const px = (lon: number, lat: number): [number, number] => [MW / 2 + (lon - cx) * kx * scale, MH / 2 - (lat - cy) * scale]
  const path = (g: GeoJsonGeometry) =>
    rings(g).map(ring => ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${px(lon!, lat!).map(v => v.toFixed(1)).join(',')}`).join('') + 'Z').join('')
  const line = (coords: LngLat[]) =>
    coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${px(lon, lat).map(v => v.toFixed(1)).join(',')}`).join('')

  return {
    neighbours: (props.neighbours ?? []).map(path),
    lots: props.lots.map(l => ({ cadid: l.cadid, d: path(l.geometry) })),
    runs: (props.runs ?? []).filter(r => r.coords.length > 1).map(r => ({ d: line(r.coords), primary: !!r.primary })),
    point: props.point ? px(props.point.lon, props.point.lat) : null,
    way: props.waypoint ? px(props.waypoint.lon, props.waypoint.lat) : null,
  }
})
</script>

<style scoped>
.lm { margin: 0; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.6rem; }
.lm-svg { display: block; width: 100%; height: auto; background: #f8fafc; border-radius: 8px; }
.lm-neighbour { fill: #fff; stroke: #cbd5e1; stroke-width: 1; fill-rule: evenodd; }
.lm-lot { fill: rgba(42, 120, 214, 0.18); stroke: #2a78d6; stroke-width: 2; fill-rule: evenodd; }
.lm-run { fill: none; stroke: #2563eb; stroke-width: 3.5; stroke-linecap: round; }
.lm-run--primary { stroke: #e11d48; stroke-width: 4.5; }
.lm-access { stroke: #0f172a; stroke-width: 1.5; stroke-dasharray: 4 3; }
.lm-way { fill: #fff; stroke: #0f172a; stroke-width: 2; }
.lm-point { fill: #eb6834; stroke: #fff; stroke-width: 2; }
.lm-empty { margin: 0; padding: 2rem; text-align: center; color: #64748b; font-size: 0.85rem; }
.lm-legend { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; margin-top: 0.5rem; font-size: 0.72rem; color: #475569; }
.lm-legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
.lm-key { display: inline-block; width: 12px; height: 12px; }
.lm-key--lot { background: rgba(42, 120, 214, 0.18); border: 2px solid #2a78d6; }
.lm-key--point { border-radius: 50%; background: #eb6834; }
.lm-key--way { border: 2px solid #0f172a; background: #fff; width: 9px; height: 9px; }
.lm-key--neighbour { border: 1px solid #cbd5e1; background: #fff; }
.lm-key--run { height: 3px; background: #2563eb; border-radius: 2px; }
.lm-key--primary { height: 4px; background: #e11d48; border-radius: 2px; }
</style>
