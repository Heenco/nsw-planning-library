import { ref, computed } from 'vue'
import { haversine, pathLength, ringArea, fmtDistance, fmtArea } from '#shared/geo-measure.mjs'

/**
 * The click-to-measure tool: distance along a path, or the area of a ring.
 *
 * Extracted from /map so /prop-width can offer the same tool rather than carry
 * a second copy of it. The geodesic maths already lives in
 * shared/geo-measure.mjs precisely because the property report measures too and
 * all of them have to agree to the metre; keeping the interaction in one place
 * as well means a fix to the drawing or the double-click handling lands
 * everywhere at once.
 *
 * `getMap()` is called rather than the map passed in, because the map is built
 * asynchronously in onMounted and does not exist when the composable is set up.
 *
 * mapbox-gl owns the drawing: the tool keeps a GeoJSON source and four layers,
 * and re-adds them on demand — `setStyle` drops every source, so the caller
 * must call `ensureMeasureLayers()` again after a basemap change.
 */
export type MeasureMode = 'distance' | 'area'

const MEASURE_SRC = 'measure'
const MEASURE_COLOR = '#b45309'

export const MEASURE_LAYERS = [
  'measure::fill', 'measure::line', 'measure::points', 'measure::labels',
]

export function useMeasure(getMap: () => any) {
  const measureMode = ref<MeasureMode | null>(null)
  const measuring = ref(false)
  const measurePoints = ref<[number, number][]>([])
  const measureHover = ref<[number, number] | null>(null)

  const minPoints = computed(() => (measureMode.value === 'area' ? 3 : 2))

  /** Points drawn right now — committed vertices plus the cursor while drawing. */
  const livePoints = computed<[number, number][]>(() =>
    measuring.value && measureHover.value && measurePoints.value.length
      ? [...measurePoints.value, measureHover.value]
      : measurePoints.value,
  )

  const measureTotal = computed(() => {
    const pts = livePoints.value
    if (measureMode.value === 'area') return pts.length < 3 ? '' : fmtArea(ringArea(pts))
    return pts.length < 2 ? '' : fmtDistance(pathLength(pts))
  })

  const measureSecondary = computed(() => {
    const pts = livePoints.value
    if (measureMode.value === 'area') {
      if (pts.length < 3) return ''
      return `${Math.round(ringArea(pts)).toLocaleString()} m² · perimeter ${fmtDistance(pathLength([...pts, pts[0]!]))}`
    }
    if (pts.length < 2) return ''
    return `${pts.length - 1} segment${pts.length > 2 ? 's' : ''}`
  })

  function ensureMeasureLayers() {
    const map = getMap()
    if (!map || map.getSource(MEASURE_SRC)) return
    map.addSource(MEASURE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

    map.addLayer({
      id: 'measure::fill',
      type: 'fill',
      source: MEASURE_SRC,
      filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': MEASURE_COLOR, 'fill-opacity': 0.15 },
    })
    map.addLayer({
      id: 'measure::line',
      type: 'line',
      source: MEASURE_SRC,
      filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': MEASURE_COLOR, 'line-width': 2.2, 'line-dasharray': [2, 1] },
    })
    map.addLayer({
      id: 'measure::points',
      type: 'circle',
      source: MEASURE_SRC,
      filter: ['all', ['==', '$type', 'Point'], ['!has', 'label']],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': MEASURE_COLOR,
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'measure::labels',
      type: 'symbol',
      source: MEASURE_SRC,
      filter: ['all', ['==', '$type', 'Point'], ['has', 'label']],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, -0.9],
        // The measurement the user just drew must be readable even where it
        // crosses a dense pile of other labels.
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#7c2d12', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    })
  }

  function renderMeasure() {
    const src = getMap()?.getSource(MEASURE_SRC)
    if (!src) return

    const pts = livePoints.value
    const closed = measureMode.value === 'area' && pts.length >= 3
    const seq: [number, number][] = closed ? [...pts, pts[0]!] : pts
    const features: any[] = []

    if (seq.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: seq } })
    }
    if (closed) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [seq] } })
    }
    for (const p of measurePoints.value) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })
    }
    // Per-segment length labels at segment midpoints
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!
      const b = seq[i]!
      features.push({
        type: 'Feature',
        properties: { label: fmtDistance(haversine(a, b)) },
        geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
      })
    }

    src.setData({ type: 'FeatureCollection', features })
  }

  /** Measurement graphics belong on top of everything the page draws. */
  function restackMeasure() {
    const map = getMap()
    if (!map) return
    for (const id of MEASURE_LAYERS) if (map.getLayer(id)) map.moveLayer(id)
  }

  function setMeasureCursor(on: boolean) {
    const map = getMap()
    if (!map) return
    map.getCanvas().style.cursor = on ? 'crosshair' : ''
    // Otherwise the second click of a measurement zooms the map in.
    if (on) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }

  function toggleMeasure(mode: MeasureMode) {
    if (measuring.value && measureMode.value === mode) { finishMeasure(); return }
    clearMeasure()
    measureMode.value = mode
    measuring.value = true
    setMeasureCursor(true)
  }

  function finishMeasure() {
    if (!measuring.value) return
    measuring.value = false
    measureHover.value = null
    setMeasureCursor(false)

    // A double-click leaves a duplicate vertex behind — drop it.
    const pts = measurePoints.value
    if (pts.length >= 2 && haversine(pts[pts.length - 1]!, pts[pts.length - 2]!) < 0.5) {
      measurePoints.value = pts.slice(0, -1)
    }
    if (measurePoints.value.length < minPoints.value) clearMeasure()
    else renderMeasure()
  }

  function clearMeasure() {
    measuring.value = false
    measureMode.value = null
    measurePoints.value = []
    measureHover.value = null
    setMeasureCursor(false)
    renderMeasure()
  }

  /**
   * Consume a map click while measuring.
   *
   * Returns true when the click was taken as a vertex, so the caller can skip
   * whatever it would otherwise do with a click.
   */
  function handleMeasureClick(e: any): boolean {
    if (!measuring.value) return false
    measurePoints.value = [...measurePoints.value, [e.lngLat.lng, e.lngLat.lat]]
    renderMeasure()
    return true
  }

  function onMeasureMove(e: any) {
    if (!measuring.value || !measurePoints.value.length) return
    measureHover.value = [e.lngLat.lng, e.lngLat.lat]
    renderMeasure()
  }

  function onMeasureDblClick(e: any) {
    if (!measuring.value) return
    e.preventDefault?.()
    finishMeasure()
  }

  function onMeasureKey(e: KeyboardEvent) {
    if (!measuring.value) return
    if (e.key === 'Enter') { e.preventDefault(); finishMeasure() }
    else if (e.key === 'Escape') { e.preventDefault(); clearMeasure() }
  }

  return {
    measureMode, measuring, measurePoints, minPoints, measureTotal, measureSecondary,
    ensureMeasureLayers, renderMeasure, restackMeasure,
    toggleMeasure, finishMeasure, clearMeasure,
    handleMeasureClick, onMeasureMove, onMeasureDblClick, onMeasureKey,
  }
}
