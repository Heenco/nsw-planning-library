/**
 * Does the proposed design comply?
 *
 * This is the half of generative design that cannot be delegated to a language
 * model. The model proposes; this module disposes, by measuring the geometry it
 * actually produced against the controls the knowledge graph actually holds.
 * Nothing here asks the model whether it complied — every number is re-derived
 * from the scheme's own coordinates.
 *
 * Two tiers, deliberately kept apart:
 *
 *   hard      geometry we can test exactly — containment inside the buildable
 *             area, ridge height against the cap, masses not interpenetrating,
 *             GFA against the mapped FSR. These decide pass/fail.
 *
 *   advisory  controls read out of DCP prose by the extractor. That extraction
 *             is noisy — the graph holds an FSR effect whose unit is "spaces"
 *             and a floor_area whose unit is "metre" — so these are measured
 *             and reported with their clause, but they never fail a scheme on
 *             their own. Same discipline the envelope generator already applies
 *             to DCP height values.
 *
 * Areas of unions and overlaps are rasterised rather than clipped. Footprints
 * here are arbitrary simple polygons, an exact boolean library is a dependency
 * this app does not have, and at a 200 mm cell the error on a 200 m2 footprint
 * is well under the precision anyone reads these numbers to.
 */

import {
  openRing, closeRing, polygonArea, bbox, footprintBreaches,
  GFA_KINDS, COVERAGE_KINDS,
} from './design-scheme.mjs'
import { pointInRing } from './lot-edges.mjs'

const CELL = 0.2   // metres, raster resolution for union and overlap areas

/** Area covered by at least one of the polygons, and by at least two. */
export function rasterAreas(polys) {
  const rings = polys.map(p => closeRing(p)).filter(r => r.length >= 4)
  if (!rings.length) return { union: 0, overlap: 0 }
  const all = rings.flat()
  const b = bbox(all)
  // A 400 x 400 grid covers an 80 m square at 200 mm; beyond that the cell
  // grows rather than the loop, so a large site cannot stall the request.
  const cell = Math.max(CELL, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 400)
  const cx = Math.max(1, Math.ceil((b.x1 - b.x0) / cell))
  const cy = Math.max(1, Math.ceil((b.y1 - b.y0) / cell))
  let union = 0
  let overlap = 0
  for (let i = 0; i < cx; i++) {
    const x = b.x0 + (i + 0.5) * cell
    for (let j = 0; j < cy; j++) {
      const y = b.y0 + (j + 0.5) * cell
      let hits = 0
      for (const r of rings) if (pointInRing([x, y], r)) hits++
      if (hits >= 1) union += cell * cell
      if (hits >= 2) overlap += cell * cell
    }
  }
  return { union, overlap }
}

/** Area shared by exactly two polygons. */
export function pairOverlapArea(a, b) {
  return rasterAreas([a, b]).overlap
}

/**
 * The most restrictive DCP effect for a topic, inside a plausibility band.
 *
 * The band is what makes a prose-extracted number usable at all: without it a
 * "maximum 1.8 m" that describes a front fence would be read as a site
 * coverage. Every candidate that survived is returned alongside the chosen
 * one, so a reader can see the spread instead of a single unattributed figure.
 */
export function pickControl(controls, { topic, unit, comparator, lo, hi }) {
  const rows = (controls ?? []).filter(c => c.topic === topic
    && (unit == null || c.unit === unit)
    && (comparator == null || c.comparator === comparator)
    && Number.isFinite(Number(c.value))
    && Number(c.value) >= lo && Number(c.value) <= hi)
  if (!rows.length) return null
  const restrictive = comparator === 'lte' || comparator === 'lt'
    ? rows.reduce((a, b) => (Number(b.value) < Number(a.value) ? b : a))
    : rows.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a))
  return {
    value: Number(restrictive.value),
    unit: restrictive.unit,
    clause: restrictive.clause,
    candidates: [...new Set(rows.map(r => Number(r.value)))].sort((a, b) => a - b),
  }
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? Number(n).toFixed(d).replace(/\.0+$/, '') : '—')

/**
 * Measure a scheme against a brief.
 *
 * @returns {{pass: boolean, hardFailures: string[], checks: object[], metrics: object}}
 */
export function checkScheme(scheme, brief) {
  const checks = []
  const masses = scheme.masses ?? []
  const add = (c) => { checks.push(c); return c }

  // -- metrics the checks are built from --
  const gfa = masses
    .filter(m => GFA_KINDS.has(m.kind))
    .reduce((s, m) => s + polygonArea(m.footprint), 0)
  const groundPolys = masses
    .filter(m => COVERAGE_KINDS.has(m.kind) && Number(m.z0) < 0.5)
    .map(m => openRing(m.footprint))
  const coverage = rasterAreas(groundPolys).union
  const openByKind = {}
  for (const o of scheme.open_space ?? []) {
    (openByKind[o.kind] ??= []).push(openRing(o.polygon))
  }
  const areaOf = (kinds) => rasterAreas(kinds.flatMap(k => openByKind[k] ?? [])).union
  const landscapedArea = areaOf(['landscaped', 'deep_soil', 'private_open_space', 'communal'])
  const deepSoilArea = areaOf(['deep_soil'])
  const ridge = Math.max(
    0,
    ...masses.map(m => Number(m.z1) || 0),
    ...(scheme.roofs ?? []).map(r => Number(r.ridge_height) || 0),
  )
  const storeys = new Set(masses.filter(m => GFA_KINDS.has(m.kind))
    .map(m => (Number.isFinite(Number(m.storey)) ? Number(m.storey) : Math.round(Number(m.z0) / 3)))).size
  const siteArea = Number(brief.siteArea) || 0

  // -- hard: everything sits inside the buildable area --
  if (brief.buildablePolygon?.length >= 3) {
    const breaches = []
    for (const m of masses) {
      // A basement is below ground and is governed by its own excavation
      // controls, not by the setback plane the envelope draws.
      if (m.kind === 'basement') continue
      const b = footprintBreaches(m.footprint, brief.buildablePolygon)
      if (b.length) breaches.push({ name: m.name, worst: Math.max(...b.map(p => p.overhang)), points: b.length })
    }
    const worst = breaches.length ? Math.max(...breaches.map(b => b.worst)) : 0
    add({
      id: 'envelope',
      tier: 'hard',
      label: 'Inside the buildable area',
      required: `front ${brief.setbacks.front} m / rear ${brief.setbacks.rear} m / side ${brief.setbacks.side} m`,
      actual: breaches.length ? `${breaches.length} mass(es) cross the setback line by up to ${fmt(worst, 2)} m` : 'all masses within',
      status: breaches.length ? 'fail' : 'pass',
      clause: `DCP cl ${brief.setbackClauses.front} / ${brief.setbackClauses.rear} / ${brief.setbackClauses.side}`,
      detail: breaches.map(b => `${b.name} overhangs by ${fmt(b.worst, 2)} m at ${b.points} corner(s)`),
    })
  } else {
    add({
      id: 'envelope',
      tier: 'hard',
      label: 'Inside the buildable area',
      required: 'setback envelope',
      actual: 'no buildable area could be derived for this lot',
      status: 'na',
      detail: [],
    })
  }

  // -- hard: nothing crosses the title boundary --
  if (brief.lotPolygon?.length >= 3) {
    const out = masses
      .map(m => ({ name: m.name, b: footprintBreaches(m.footprint, brief.lotPolygon, 0.05) }))
      .filter(r => r.b.length)
    add({
      id: 'title',
      tier: 'hard',
      label: 'Inside the title boundary',
      required: `${Math.round(siteArea)} m2 parcel`,
      actual: out.length ? `${out.length} mass(es) outside the parcel` : 'all masses within',
      status: out.length ? 'fail' : 'pass',
      clause: brief.geometrySource,
      detail: out.map(r => `${r.name} leaves the lot by ${fmt(Math.max(...r.b.map(p => p.overhang)), 2)} m`),
    })
  }

  // -- hard: height --
  add({
    id: 'height',
    tier: 'hard',
    label: 'Building height',
    required: `${fmt(brief.height)} m`,
    actual: `${fmt(ridge, 2)} m to the highest point`,
    status: ridge <= brief.height + 0.01 ? 'pass' : 'fail',
    clause: brief.heightSource,
    detail: ridge > brief.height
      ? [`over by ${fmt(ridge - brief.height, 2)} m`]
      : [`${fmt(brief.height - ridge, 2)} m of headroom left`],
  })

  // -- hard: masses must not interpenetrate --
  const clashes = []
  for (let i = 0; i < masses.length; i++) {
    for (let j = i + 1; j < masses.length; j++) {
      const a = masses[i]
      const b = masses[j]
      // Only volumes that share a height range can clash; two floors of the
      // same house are meant to sit on top of one another.
      const zOverlap = Math.min(Number(a.z1), Number(b.z1)) - Math.max(Number(a.z0), Number(b.z0))
      if (zOverlap <= 0.05) continue
      const area = pairOverlapArea(openRing(a.footprint), openRing(b.footprint))
      if (area > 1) clashes.push(`${a.name} and ${b.name} share ${fmt(area)} m2 of plan at the same level`)
    }
  }
  add({
    id: 'clash',
    tier: 'hard',
    label: 'Volumes do not interpenetrate',
    required: 'no shared volume',
    actual: clashes.length ? `${clashes.length} clash(es)` : 'clear',
    status: clashes.length ? 'fail' : 'pass',
    detail: clashes,
  })

  // -- hard where the FSR is mapped: floor space --
  if (brief.fsr) {
    const cap = brief.fsr * siteArea
    add({
      id: 'fsr',
      tier: 'hard',
      label: 'Gross floor area',
      required: `${Math.round(cap)} m2 (FSR ${brief.fsr}:1 on ${Math.round(siteArea)} m2)`,
      actual: `${Math.round(gfa)} m2 (${(gfa / siteArea).toFixed(2)}:1)`,
      status: gfa <= cap * 1.001 ? 'pass' : 'fail',
      clause: 'LEP cl 4.4 — Floor Space Ratio Map',
      detail: [gfa <= cap
        ? `${Math.round(cap - gfa)} m2 of floor space unused`
        : `${Math.round(gfa - cap)} m2 over the cap`],
    })
  } else {
    const dcpFsr = pickControl(brief.controls, { topic: 'fsr', unit: 'ratio', comparator: 'lte', lo: 0.1, hi: 6 })
    add({
      id: 'fsr',
      tier: 'advisory',
      label: 'Gross floor area',
      required: dcpFsr ? `${Math.round(dcpFsr.value * siteArea)} m2 (DCP FSR ${dcpFsr.value}:1)` : 'no FSR mapped for this lot',
      actual: `${Math.round(gfa)} m2 (${siteArea ? (gfa / siteArea).toFixed(2) : '—'}:1)`,
      status: dcpFsr ? (gfa <= dcpFsr.value * siteArea ? 'pass' : 'warn') : 'na',
      clause: dcpFsr ? `DCP cl ${dcpFsr.clause}` : null,
      detail: dcpFsr
        ? [`DCP ratios found for this scope: ${dcpFsr.candidates.join(', ')}`]
        : ['The Floor Space Ratio Map does not give this lot a ratio, so floor space is uncapped by FSR.'],
    })
  }

  // -- advisory: site coverage, landscaping, deep soil, private open space --
  const cov = pickControl(brief.controls, { topic: 'site_coverage', unit: 'percent', comparator: 'lte', lo: 20, hi: 80 })
  add({
    id: 'site_coverage',
    tier: 'advisory',
    label: 'Site coverage',
    required: cov ? `${cov.value}% max` : 'no numeric control extracted',
    actual: siteArea ? `${(coverage / siteArea * 100).toFixed(1)}% (${Math.round(coverage)} m2)` : '—',
    status: cov ? (coverage / siteArea * 100 <= cov.value ? 'pass' : 'warn') : 'na',
    clause: cov ? `DCP cl ${cov.clause}` : null,
    detail: cov && cov.candidates.length > 1 ? [`other extracted values: ${cov.candidates.join(', ')}%`] : [],
  })

  const land = pickControl(brief.controls, { topic: 'landscaping', unit: 'percent', comparator: 'gte', lo: 10, hi: 70 })
  add({
    id: 'landscaping',
    tier: 'advisory',
    label: 'Landscaped area',
    required: land ? `${land.value}% min` : 'no numeric control extracted',
    actual: siteArea ? `${(landscapedArea / siteArea * 100).toFixed(1)}% (${Math.round(landscapedArea)} m2)` : '—',
    status: land ? (landscapedArea / siteArea * 100 >= land.value ? 'pass' : 'warn') : 'na',
    clause: land ? `DCP cl ${land.clause}` : null,
    detail: land && land.candidates.length > 1 ? [`other extracted values: ${land.candidates.join(', ')}%`] : [],
  })

  const soil = pickControl(brief.controls, { topic: 'deep_soil', unit: 'percent', comparator: 'gte', lo: 5, hi: 40 })
  if (soil || deepSoilArea > 0) {
    add({
      id: 'deep_soil',
      tier: 'advisory',
      label: 'Deep soil',
      required: soil ? `${soil.value}% min` : 'no numeric control extracted',
      actual: siteArea ? `${(deepSoilArea / siteArea * 100).toFixed(1)}% (${Math.round(deepSoilArea)} m2)` : '—',
      status: soil ? (deepSoilArea / siteArea * 100 >= soil.value ? 'pass' : 'warn') : 'na',
      clause: soil ? `DCP cl ${soil.clause}` : null,
      detail: [],
    })
  }

  const pos = pickControl(brief.controls, { topic: 'open_space', unit: 'sqm', comparator: 'gte', lo: 8, hi: 200 })
  const posAreas = (openByKind.private_open_space ?? []).map(p => polygonArea(p))
  add({
    id: 'private_open_space',
    tier: 'advisory',
    label: 'Private open space',
    required: pos ? `${pos.value} m2 per dwelling` : 'no numeric control extracted',
    actual: posAreas.length
      ? `${posAreas.map(a => `${Math.round(a)} m2`).join(', ')} across ${posAreas.length} area(s)`
      : 'none nominated',
    status: pos
      ? (posAreas.length && posAreas.every(a => a >= pos.value) ? 'pass' : 'warn')
      : (posAreas.length ? 'pass' : 'na'),
    clause: pos ? `DCP cl ${pos.clause}` : null,
    detail: pos && pos.candidates.length > 1 ? [`other extracted values: ${pos.candidates.join(', ')} m2`] : [],
  })

  // -- advisory: parking --
  const park = (scheme.parking ?? []).length
  const parkControl = pickControl(brief.controls, { topic: 'parking', unit: 'spaces', comparator: 'gte', lo: 1, hi: 4 })
  add({
    id: 'parking',
    tier: 'advisory',
    label: 'Off-street parking',
    required: parkControl ? `${parkControl.value} space(s) per dwelling` : 'no numeric rate extracted',
    actual: `${park} space(s) drawn`,
    status: parkControl
      ? (park >= parkControl.value * Math.max(1, (scheme.dwellings ?? []).length) ? 'pass' : 'warn')
      : 'na',
    clause: parkControl ? `DCP cl ${parkControl.clause}` : null,
    detail: [],
  })

  const hardFailures = checks.filter(c => c.tier === 'hard' && c.status === 'fail')

  return {
    pass: hardFailures.length === 0,
    hardFailures: hardFailures.flatMap(c => [`${c.label}: ${c.actual}`, ...c.detail]),
    checks,
    metrics: {
      gfa: Math.round(gfa),
      fsrAchieved: siteArea ? Number((gfa / siteArea).toFixed(2)) : null,
      coverage: Math.round(coverage),
      coveragePct: siteArea ? Number((coverage / siteArea * 100).toFixed(1)) : null,
      landscapedArea: Math.round(landscapedArea),
      landscapedPct: siteArea ? Number((landscapedArea / siteArea * 100).toFixed(1)) : null,
      deepSoilArea: Math.round(deepSoilArea),
      ridgeHeight: Number(ridge.toFixed(2)),
      storeys,
      dwellings: (scheme.dwellings ?? []).length || null,
      masses: masses.length,
      parkingSpaces: park,
    },
  }
}
