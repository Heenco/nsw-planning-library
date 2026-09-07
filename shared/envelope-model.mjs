/**
 * Build the planning-envelope geometry for one lot.
 *
 * Plain .mjs so both callers can use it without duplicating the geometry:
 *   - scripts/build-envelope-model.mjs  writes a file and registers it
 *   - server/api/property/envelope.get.ts  serves it on demand
 *
 * On demand matters: there are 73,595 lots in Hornsby and pre-generating a file
 * for each is neither practical nor necessary — the viewer fetches whatever
 * path it is given, so an API route is as good as a file.
 *
 * The output is an envelope, not a design: the surveyed boundary inset by the
 * setback governing each side, capped at the height limit. The solid form drawn
 * inside it is indicative — sized to fit the buildable area and no wider than
 * the frontage — and tests no floor-space, site-coverage or landscaping
 * control, so it answers "what does this lot allow", never "here is a design".
 */

import { lotFrame, localArea, insetRing, inscribedRect, trimAccessHandle } from './lot-frame.mjs'
import { pointInRing } from './lot-edges.mjs'

const LAYERS = ['frame', 'cladding ext', 'cladding int', 'interior', 'roof',
  'floors', 'foundations', 'fixtures', 'other']

const COLLECTIONS = ['', 'Lot', 'Envelope', 'Setback_alternatives', 'Height_limit', 'Massing']

/**
 * Street frontage lengths other than the primary one.
 *
 * `all_frontages` reads "ELDRIDGE:35.03m,FEATHERWOOD:21.51m" and
 * `primary_frontage_length_m` names which of those is the main street. The
 * remainder are secondary frontages, and matching them by length is what lets
 * a corner lot's side street be told apart from a neighbour's boundary.
 */
function otherFrontageLengths(lot) {
  const raw = String(lot?.all_frontages ?? '').trim()
  if (!raw) return []
  const primary = Number(lot?.primary_frontage_length_m) || null
  const lengths = raw.split(',')
    .map(s => Number((s.split(':')[1] ?? '').replace(/[^\d.]/g, '')))
    .filter(n => Number.isFinite(n) && n > 0)
  if (primary == null) return lengths.slice(1)
  let dropped = false
  return lengths.filter((n) => {
    if (!dropped && Math.abs(n - primary) < 0.05) { dropped = true; return false }
    return true
  })
}

/**
 * @param lot      row from nsw.up_property_d_3
 * @param controls rows from nsw.rule_effect (topic setback/height) with `clause`
 * @param ring     exact parcel boundary as [lng, lat] pairs, when available
 */
export function buildEnvelopeModel(lot, controls = [], ring = null) {
  const boxes = []
  const meshes = []

  /**
   * A vertical prism over a closed 2D ring, as a mesh.
   *
   * The model format carries `meshes` alongside `boxes` and the viewer
   * triangulates arbitrary faces, so a real parcel needs no approximation —
   * it does not have to be squared off into a bounding rectangle.
   */
  const prism = (name, collection, layer, pts, z0, z1) => {
    const ring2d = pts.slice(0, pts.length - 1)   // drop the repeated closing point
    const n = ring2d.length
    const verts = []
    for (const [x, y] of ring2d) verts.push(x, y, z0)
    for (const [x, y] of ring2d) verts.push(x, y, z1)
    const faces = [
      [...Array(n).keys()].reverse(),                       // base, wound downward
      [...Array(n).keys()].map((i) => i + n),               // top
    ]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      faces.push([i, j, j + n, i + n])
    }
    meshes.push({ name, collection: COLLECTIONS.indexOf(collection), layer, verts, faces })
  }

  /** A thin slab lying along one boundary edge, for labelling that edge. */
  const edgeMarker = (name, collection, layer, a, b, t, z0, z1) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    const nx = (-dy / len) * t
    const ny = (dx / len) * t
    prism(name, collection, layer,
      [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny],
        [a[0] + nx, a[1] + ny]],
      z0, z1)
  }

  const box = (name, collection, layer, [x0, y0, z0], [x1, y1, z1]) => {
    const h = (a, b) => Math.abs(b - a) / 2
    const c = (a, b) => (a + b) / 2
    boxes.push([name, COLLECTIONS.indexOf(collection),
      h(x0, x1), 0, 0, c(x0, x1),
      0, h(y0, y1), 0, c(y0, y1),
      0, 0, h(z0, z1), c(z0, z1),
      LAYERS.indexOf(layer)])
  }

  const cage = (prefix, collection, layer, [x0, y0, z0], [x1, y1, z1], t = 0.06) => {
    for (const [yy, yl] of [[y0, 'front'], [y1, 'rear']]) {
      for (const [zz, zl] of [[z0, 'base'], [z1, 'top']]) {
        box(`${prefix}_${yl}_${zl}_rail`, collection, layer, [x0, yy - t, zz - t], [x1, yy + t, zz + t])
      }
    }
    for (const [xx, xl] of [[x0, 'left'], [x1, 'right']]) {
      for (const [zz, zl] of [[z0, 'base'], [z1, 'top']]) {
        box(`${prefix}_${xl}_${zl}_rail`, collection, layer, [xx - t, y0, zz - t], [xx + t, y1, zz + t])
      }
      for (const [yy, yl] of [[y0, 'front'], [y1, 'rear']]) {
        box(`${prefix}_${xl}_${yl}_post`, collection, layer, [xx - t, yy - t, z0], [xx + t, yy + t, z1])
      }
    }
  }

  /** Most restrictive minimum for a boundary — the plane that actually binds. */
  const worst = (from, fallback) => {
    const vals = controls.filter(c => c.topic === 'setback'
      && c.measured_from === from && (c.comparator === 'gte' || c.comparator === 'gt'))
    if (!vals.length) return { v: fallback, clause: 'default', all: [] }
    // The clause cited has to be the one that produced the number shown.
    // Reading it off vals[0] labelled the binding setback with whichever
    // clause happened to sort first, so a 1.5 m side setback could be
    // attributed to a clause that says 0.9 m.
    const winner = vals.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a))
    return {
      v: Number(winner.value),
      clause: winner.clause,
      all: [...new Set(vals.map(c => Number(c.value)))].sort((a, b) => a - b),
    }
  }

  const front = worst('front_boundary', 6)
  const rear = worst('rear_boundary', 6)
  const side = worst('side_boundary', 0.9)
  // A corner lot has two street frontages, and the second is governed by its
  // own control — Hornsby records 3 m and 4.5 m secondary setbacks that were
  // being ignored entirely, so a corner lot was modelled as though its side
  // street were a neighbour's fence. Falls back to the side setback where the
  // DCP states none, which is the status quo rather than a guess.
  const secondary = worst('secondary_boundary', side.v)

  /** Recorded in up_property_d_3; shapes how the buildable area is derived. */
  const isBattleaxe = lot.is_battleaxe === true || lot.is_battleaxe === 'true'

  // Height: the lower of the mapped HOB and any DCP height control.
  //
  // LEP cl 4.3 sets the control but defers the number to the Height of
  // Buildings Map, so the HOB is the primary standard. It is not necessarily
  // the binding one — a DCP can be stricter — and the previous logic consulted
  // the DCP only when the HOB was absent, so a lower DCP height was ignored.
  //
  // A DCP height is only believed inside a plausible band for a building.
  // The extractor tags any "maximum height" as topic=height, and the ingested
  // values include 1.5, 2.2, 3 and 4 m (fence, wall and ceiling heights) and a
  // stray 72. Taking the minimum without this guard would cap a house at
  // 1.5 m — far worse than ignoring the DCP entirely. Values outside the band
  // are recorded rather than silently dropped.
  const HEIGHT_MIN_M = 4.5      // below a single storey plus roof: not a building cap
  const HEIGHT_MAX_M = 40

  const dcpHeightRows = controls.filter(c => c.topic === 'height' && c.comparator === 'lte'
    && Number.isFinite(Number(c.value)))
  const plausible = dcpHeightRows.filter(c => Number(c.value) >= HEIGHT_MIN_M && Number(c.value) <= HEIGHT_MAX_M)
  const implausible = dcpHeightRows.filter(c => !plausible.includes(c)).map(c => Number(c.value))

  const dcpHeightRow = plausible.length
    ? plausible.reduce((a, b) => (Number(b.value) < Number(a.value) ? b : a))
    : null
  const dcpHeight = dcpHeightRow ? Number(dcpHeightRow.value) : null
  const hobHeight = Number(lot.hob_max_b_h_m) || null

  const candidates = [
    hobHeight != null ? { v: hobHeight, src: 'HOB map (LEP cl 4.3)' } : null,
    dcpHeight != null ? { v: dcpHeight, src: `DCP cl ${dcpHeightRow.clause}` } : null,
  ].filter(Boolean)
  const chosen = candidates.length
    ? candidates.reduce((a, b) => (b.v < a.v ? b : a))
    : { v: 8.5, src: 'default (no height standard mapped)' }
  const height = chosen.v
  const heightSource = chosen.src

  // The lot footprint. With the real boundary the parcel is drawn as it is;
  // without it the lot falls back to a frontage x depth rectangle, which is
  // indicative in plan and exact only in the vertical.
  const frame = ring ? lotFrame(ring, { frontageLength: lot.primary_frontage_length_m }) : null
  const usingRealBoundary = !!frame

  const W = frame ? frame.width : (Number(lot.primary_frontage_length_m) || Math.sqrt(Number(lot.area_sqm) || 600))
  const D = frame ? frame.depth : (Number(lot.lot_depth_m) || ((Number(lot.area_sqm) || 600) / W))

  // The access handle of a battle-axe is drawn as a long thin spike and can
  // hold nothing, so the model works from the body of the lot. Detected from
  // the shape rather than the `is_battleaxe` flag, which is false on lots that
  // plainly have one.
  const handle = frame ? trimAccessHandle(frame.points) : null
  const bodyPoints = handle ? handle.body : null
  const handleTrimmed = !!(handle && handle.trimmed)

  if (frame) {
    // A prism of the surveyed parcel, 100 mm thick.
    prism(`Lot_${Math.round(localArea(bodyPoints))}sqm_${frame.sides}_sides__NSW_cadastre`,
      'Lot', 'foundations', bodyPoints, -0.1, 0)
  } else {
    box(`Lot_${W.toFixed(1)}m_frontage_x_${D.toFixed(1)}m_depth_${Math.round(Number(lot.area_sqm) || 0)}sqm`,
      'Lot', 'foundations', [0, 0, -0.1], [W, D, 0])
  }

  // The buildable area, inset from each boundary by the setback that governs
  // it. On the real boundary that is a true inset of the parcel; the
  // rectangle path keeps the axis-aligned inset it always used.
  let insetPoints = null
  let insetApprox = false
  let massing = null          // the indicative form actually drawn, if any
  let massingStoreys = 0
  const edgeRoles = []
  if (frame) {
    // Which boundary an edge is follows from which side of the lot it lies
    // on: the frame already put the frontage on +X, so the edge nearest y=0
    // is the front, nearest y=D the rear, and the remaining edges are sides.
    // Nearest-bound beats a pure direction test, which mis-classified every
    // splayed or curved boundary.
    const n = bodyPoints.length - 1
    for (let i = 0; i < n; i++) {
      const a = bodyPoints[i]
      const b = bodyPoints[(i + 1) % n]
      const my = (a[1] + b[1]) / 2
      const mx = (a[0] + b[0]) / 2
      edgeRoles.push([
        { role: 'front', gap: my },
        { role: 'rear', gap: D - my },
        { role: 'side', gap: Math.min(mx, W - mx) },
      ].reduce((p, q) => (q.gap < p.gap ? q : p)).role)
    }

    // Each other recorded street frontage claims exactly one side edge — the
    // closest in length. Matching every edge within a tolerance labelled both
    // sides of a rectangular corner lot "secondary", because its two side
    // boundaries are the same length; only one of them is the side street.
    for (const L of otherFrontageLengths(lot)) {
      let bestI = -1
      let bestDiff = Infinity
      for (let i = 0; i < n; i++) {
        if (edgeRoles[i] !== 'side') continue
        const a = bodyPoints[i]
        const b = bodyPoints[(i + 1) % n]
        const diff = Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - L)
        if (diff < bestDiff) { bestDiff = diff; bestI = i }
      }
      if (bestI >= 0 && bestDiff <= Math.max(1, L * 0.08)) edgeRoles[bestI] = 'secondary'
    }

    const setbackFor = { front: front.v, rear: rear.v, side: side.v, secondary: secondary.v }
    // A battle-axe lot is a building area joined to the street by a narrow
    // access handle. Insetting the whole parcel insets the handle too, and a
    // 3-4 m handle less two side setbacks collapses to a sliver a few hundred
    // millimetres wide — which is the thin spike the viewer was drawing off
    // the side of the envelope. The handle is access, not building area, so on
    // these lots the buildable area comes from the largest rectangle that fits
    // inside the parcel, which lands in the body of the lot and ignores the
    // handle by construction.
    const candidate = (isBattleaxe || handleTrimmed)
      ? null
      : insetRing(bodyPoints, (i) => setbackFor[edgeRoles[i]] ?? side.v)
    // Validate hard. Offsetting each edge and re-intersecting neighbours is
    // exact only for a convex ring; on a reflex corner the offset lines cross
    // and the result folds inside out. A folded polygon's shoelace area is
    // *small*, so an area test alone accepts it — 100 Galston Road produced a
    // 12 m² ring whose bounding box was 103 m deep on a 33 m lot, which is
    // what the viewer was drawing. Every inset vertex must therefore lie
    // inside the parcel, and the area must be a believable fraction of it.
    if (candidate) {
      const a0 = localArea(bodyPoints)
      const a1 = localArea(candidate)
      const inside = candidate.every((p) => pointInRing(p, bodyPoints))
      if (inside && a1 > a0 * 0.02 && a1 < a0) insetPoints = candidate
    }

    // A concave parcel that cannot be offset cleanly still deserves a real
    // buildable area rather than the bounding-box rectangle: take the largest
    // rectangle that fits inside the parcel and inset that instead. The
    // footprint stays the surveyed boundary either way.
    if (!insetPoints) {
      const fitLot = inscribedRect(bodyPoints, { maxDepth: Infinity })
      if (fitLot) {
        const rx0 = fitLot.x0 + side.v
        const rx1 = fitLot.x1 - side.v
        const ry0 = fitLot.y0 + front.v
        const ry1 = fitLot.y1 - rear.v
        if (rx1 - rx0 > 1 && ry1 - ry0 > 1) {
          insetPoints = [[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1], [rx0, ry0]]
          edgeRoles.length = 0
          edgeRoles.push('front', 'side', 'rear', 'side')
          insetApprox = true
        }
      }
    }
  }

  const bx0 = side.v, bx1 = W - side.v, by0 = front.v, by1 = D - rear.v
  // With a surveyed boundary and no buildable area, there is nothing to draw:
  // falling through to the bounding-box cage would invent an envelope the
  // setbacks do not leave. 15 The Serpentine's body is 10.9 m deep and its
  // front and rear setbacks total 12 m, so the honest output is no envelope.
  const buildable = insetPoints ? true : (!frame && (bx1 - bx0) > 0 && (by1 - by0) > 0)

  if (buildable) {
    if (insetPoints) {
      // The buildable volume as the parcel actually shapes it. Drawn as a
      // translucent solid rather than a wire cage because an irregular prism
      // reads as a shape, where a cage of arbitrary edges reads as noise.
      prism(`Envelope_front${front.v}m_rear${rear.v}m_side${side.v}m_height${height}m__true_boundary`,
        'Envelope', 'other', insetPoints, 0, height)
    } else {
      cage(`Envelope_front${front.v}m_rear${rear.v}m_side${side.v}m_height${height}m`,
        'Envelope', 'other', [bx0, by0, 0], [bx1, by1, height])
    }

    if (insetPoints) {
      // One marker per real boundary, named for the control that set it, so
      // the reader can see which clause pushed which edge in — a corner lot's
      // secondary frontage is visibly different from its side boundary.
      const by = { front, rear, side, secondary }
      for (let i = 0; i < insetPoints.length - 1; i++) {
        const role = edgeRoles[i] ?? 'side'
        const c = by[role] ?? side
        edgeMarker(`Setback_${role}_${c.v}m__DCP_cl_${c.clause}`, 'Envelope', 'other',
          insetPoints[i], insetPoints[i + 1], 0.04, 0, 0.35)
      }
    } else {
      box(`Setback_front_${front.v}m__DCP_cl_${front.clause}`, 'Envelope', 'other', [bx0, by0 - 0.04, 0], [bx1, by0 + 0.04, 0.35])
      box(`Setback_rear_${rear.v}m__DCP_cl_${rear.clause}`, 'Envelope', 'other', [bx0, by1 - 0.04, 0], [bx1, by1 + 0.04, 0.35])
      box(`Setback_side_${side.v}m_west__DCP_cl_${side.clause}`, 'Envelope', 'other', [bx0 - 0.04, by0, 0], [bx0 + 0.04, by1, 0.35])
      box(`Setback_side_${side.v}m_east__DCP_cl_${side.clause}`, 'Envelope', 'other', [bx1 - 0.04, by0, 0], [bx1 + 0.04, by1, 0.35])
    }
    // The height plane caps the buildable area, so it takes that shape.
    if (insetPoints) {
      prism(`Height_limit_${height}m__${heightSource.replace(/[^\w.]+/g, '_')}`, 'Height_limit', 'other',
        insetPoints, height - 0.03, height + 0.03)
    } else {
      box(`Height_limit_${height}m__${heightSource.replace(/[^\w.]+/g, '_')}`, 'Height_limit', 'other',
        [bx0, by0, height - 0.03], [bx1, by1, height + 0.03])
    }

    // Front setback is context-dependent; the values not modelled are marked so
    // the envelope does not read as a single certain number.
    // Spanned across the buildable area rather than the bounding box, so an
    // alternative front setback reads as a line on the lot instead of one
    // floating past its side boundaries.
    const altX = insetPoints
      ? [Math.min(...insetPoints.map(p => p[0])), Math.max(...insetPoints.map(p => p[0]))]
      : [bx0, bx1]
    for (const alt of front.all.filter(v => v !== front.v)) {
      box(`Setback_front_alternative_${alt}m__DCP_cl_${front.clause}`, 'Setback_alternatives', 'other',
        [altX[0], alt - 0.03, 0], [altX[1], alt + 0.03, 0.12])
    }

    // Indicative massing.
    //
    // Sized to fit *inside* the buildable area, not inside its bounding box.
    // Taking the bounding box gave 307 Galston Road — 42.9 m of frontage, but
    // a 59.1 m wide bounding box on a splayed boundary — a 56 m wide building
    // that hung outside its own lot, which is what made the model look broken.
    // Width is additionally capped at the frontage, since a dwelling cannot be
    // wider than the street boundary it addresses.
    const storey = Math.min(3.0, (height - 1.0) / 2)
    const storeys = Math.max(1, Math.floor((height - 1.0) / storey))
    const hasSecondary = edgeRoles.includes('secondary')
    // On a battle-axe the recorded frontage is the width of the access handle,
    // not of any building face — capping the massing by it produced a 6 m wide
    // house on an 18 m wide buildable area. The buildable area is the only
    // constraint that means anything on these lots.
    const frontageCap = (frame && !isBattleaxe && !handleTrimmed)
      ? Math.max(6, frame.frontageLength - side.v - (hasSecondary ? secondary.v : side.v))
      : (frame ? Infinity : (bx1 - bx0))

    // No bounding-box fallback when the real boundary is in play: a box sized
    // from the bounding box of a parcel we actually have is guaranteed to be
    // wrong, and drawing nothing is the honest answer.
    massing = insetPoints
      ? inscribedRect(insetPoints, { maxDepth: 16, maxWidth: frontageCap })
      : (frame ? null : { x0: bx0, x1: bx1, y0: by0, y1: by0 + Math.min(by1 - by0, 16) })
    const fit = massing

    if (fit) {
      massingStoreys = Math.min(storeys, 2)
      for (let lvl = 0; lvl < massingStoreys; lvl++) {
        const z = lvl * storey
        box(`Massing_L${lvl}_slab`, 'Massing', 'floors', [fit.x0, fit.y0, z], [fit.x1, fit.y1, z + 0.2])
        box(`Massing_L${lvl}_volume`, 'Massing', 'cladding ext', [fit.x0, fit.y0, z + 0.2], [fit.x1, fit.y1, z + storey])
      }
      const roofBase = Math.min(storeys, 2) * storey
      box('Massing_roof', 'Massing', 'roof', [fit.x0, fit.y0, roofBase],
        [fit.x1, fit.y1, Math.min(roofBase + 1.0, height)])
    }
  }

  return {
    model: {
      format: 'craftbot-model',
      version: 1,
      source: `planning envelope — ${lot.address}`,
      collections: COLLECTIONS,
      boxes,
      meshes,
      layers: LAYERS,
    },
    meta: {
      address: lot.address, zone: lot.lzn_sym_code_p ?? lot.zone ?? null,
      lotSectionPlan: lot.lot_section_plan ?? null,
      epiName: lot.epi_name ?? null,
      minLotSize: lot.lot_size ?? null,
      area_sqm: lot.area_sqm, width: W, depth: D,
      // Where the footprint came from, so the rationale can say plainly
      // whether the plan geometry is surveyed or a stand-in.
      geometrySource: usingRealBoundary ? 'NSW cadastre (SIX Maps)' : 'frontage x depth rectangle',
      realBoundary: usingRealBoundary,
      boundarySides: frame ? frame.sides : null,
      trueInset: !!insetPoints && !insetApprox,
      insetApprox,
      isBattleaxe,
      polygonArea: frame ? localArea(bodyPoints) : null,
      parcelArea: frame ? localArea(frame.points) : null,
      handleTrimmed,
      buildableBodyWidth: bodyPoints ? Math.max(...bodyPoints.map(p => p[0])) - Math.min(...bodyPoints.map(p => p[0])) : W,
      buildableBodyDepth: bodyPoints ? Math.max(...bodyPoints.map(p => p[1])) - Math.min(...bodyPoints.map(p => p[1])) : D,
      // How far the frontage x depth rectangle is from the recorded area. The
      // rationale leads with it, because it is the envelope's main caveat.
      areaGap: usingRealBoundary
        ? (Number(lot.area_sqm) ? (localArea(frame.points) - Number(lot.area_sqm)) / Number(lot.area_sqm) : 0)
        : (Number(lot.area_sqm) ? (W * D - Number(lot.area_sqm)) / Number(lot.area_sqm) : 0),
      front: front.v, rear: rear.v, side: side.v, secondary: secondary.v, height, heightSource,
      // Both height standards, so the viewer can say which one binds and by
      // how much rather than presenting a single unattributed number.
      heightHob: hobHeight, heightDcp: dcpHeight,
      heightDcpClause: dcpHeightRow ? dcpHeightRow.clause : null,
      heightIgnored: implausible,
      secondaryClause: secondary.clause,
      isCornerLot: !!lot.is_corner_lot,
      secondaryFrontages: otherFrontageLengths(lot),
      edgeRoles,
      frontageMatchError: frame ? frame.frontageMatchError : null,
      frontageLength: frame ? frame.frontageLength : Number(lot.primary_frontage_length_m) || null,
      // The recorded figures, kept beside the measured ones so the rationale
      // can show a disagreement instead of quietly presenting one of them.
      recordedFrontage: Number(lot.primary_frontage_length_m) || null,
      recordedDepth: Number(lot.lot_depth_m) || null,
      minLotSizeUnits: lot.lot_size_units ?? null,
      frontClause: front.clause, rearClause: rear.clause, sideClause: side.clause,
      frontAlternatives: front.all, buildable,
      buildableWidth: buildable ? bx1 - bx0 : 0,
      buildableDepth: buildable ? by1 - by0 : 0,
      massingStoreys,
      massingWidth: massing ? massing.width ?? (massing.x1 - massing.x0) : 0,
      massingDepth: massing ? massing.depth ?? (massing.y1 - massing.y0) : 0,
      // The two rings, in the local metric frame the whole model is built in,
      // for callers that need to design *inside* the envelope rather than only
      // draw it. Kept last: the envelope route trims them before writing the
      // meta into a response header.
      lotPolygon: bodyPoints ?? null,
      buildablePolygon: insetPoints ?? null,
    },
  }
}

export { LAYERS, COLLECTIONS }

/**
 * The design-rationale document shown beside the model in the viewer.
 *
 * Lives here rather than in the build script so the batch path and the on-demand
 * API describe the same envelope in the same words — the numbers in this
 * document have to be the ones the geometry was actually built from.
 *
 * @param meta  the `meta` returned by buildEnvelopeModel
 */
/**
 * @param opts.landUse  every use the controls were drawn from, not just the
 *   first. The query matches `lower(value) = ANY(uses)`, so the setbacks are
 *   the worst case across all of them; naming only `uses[0]` claimed the
 *   figures were a dwelling house's when a dual occupancy's could have set
 *   them.
 * @param opts.generalOnly  true when no rule named a use and the controls are
 *   the ones general to their part of the DCP.
 */
export function buildEnvelopeRationale(meta, { landUse = 'dwelling house', storeys = 2, generalOnly = false } = {}) {
  const fmt = (n) => Number(n).toFixed(1)
  const pct = Math.abs(meta.areaGap * 100).toFixed(1)
  const footprint = meta.buildableWidth * meta.buildableDepth

  return `# ${meta.address} — planning envelope

**This is an envelope, not a design.** It shows the space this lot's planning
controls leave available — the surveyed boundary, inset by the setback that
governs each side, capped at the height limit. What could be built inside that
space is an architectural question this model does not answer.

${meta.massingStoreys
    ? `The solid form inside it is indicative only: a ${fmt(meta.massingWidth)} × ${fmt(meta.massingDepth)} m
${meta.massingStoreys === 1 ? 'single-storey' : `${meta.massingStoreys}-storey`} block, sized to fit within the buildable area and no
wider than the frontage. It is drawn to make the envelope legible, and carries
no floor-space, site-coverage or landscaping test — so it is not a proposal,
and its bulk is not evidence that this much floor area is permitted.`
    : `No indicative form is drawn: no sensible rectangle fits inside the buildable
area on this lot, which is itself the useful finding. The envelope above is
still the space the controls leave.`}

## The lot

| | |
|---|---|
| Address | ${meta.address} |
| Lot / plan | ${meta.lotSectionPlan ?? '—'} |
| Zone | ${meta.zone ?? '—'} (${meta.epiName ?? 'LEP'}) |
| Area (recorded) | ${meta.area_sqm ?? '—'} m² |
| Frontage | ${fmt(meta.frontageLength)} m${meta.recordedFrontage && Math.abs(meta.recordedFrontage - meta.frontageLength) > 0.5 ? ` (recorded ${fmt(meta.recordedFrontage)} m)` : ''} |
| Depth | ${fmt(meta.recordedDepth ?? meta.depth)} m |
| Minimum lot size | ${meta.minLotSize ? `${meta.minLotSize} ${meta.minLotSizeUnits || 'm²'}` : '—'} |

${meta.realBoundary
    ? `Drawn from the surveyed parcel boundary — ${meta.boundarySides} sides from the
NSW cadastre, enclosing ${Math.round(meta.polygonArea)} m² against a recorded
${meta.area_sqm} m² (**${pct}%**). The footprint is the real lot, not a stand-in
rectangle, so the plan is as accurate as the vertical.${meta.insetApprox
      ? `

The buildable area is the largest rectangle that fits inside that boundary,
inset by the setbacks. Offsetting each boundary individually folded on this
lot's shape, and a folded outline is worse than a conservative one.`
      : `

The buildable area is the parcel itself, inset boundary by boundary.`}${meta.handleTrimmed
      ? `

Its **access handle is excluded**: the parcel encloses ${Math.round(meta.parcelArea)} m², of which
${Math.round(meta.polygonArea)} m² is the body that can be built on. A handle a few metres wide,
less a side setback each side, leaves a sliver nothing can occupy, and drawing
it would overstate the developable land.${meta.isBattleaxe
        ? ' The lot is recorded as a battle-axe.'
        : ' The lot is not recorded as a battle-axe, but is shaped like one.'}`
      : ''}`
    : `Drawn as a ${fmt(meta.width)} x ${fmt(meta.depth)} m rectangle: the surveyed
boundary could not be retrieved${meta.geometryNote ? ` (${meta.geometryNote})` : ''}, so the
lot falls back to its recorded frontage and depth. That rectangle is **${pct}%**
${meta.areaGap >= 0 ? 'larger' : 'smaller'} than the recorded area — a real lot is
rarely a rectangle, so read this envelope as indicative in plan and exact in the
vertical.`}

## Controls applied — ${landUse}, ${storeys} storeys
${generalOnly
    ? `
No rule in this DCP names one of those uses, so these are the controls general
to their part of the plan. Read them as the baseline for the part, not as
use-specific standards.
`
    : ''}

| Plane | Value | Source |
|---|---|---|
| Front setback | ${meta.front} m${meta.frontAlternatives.length > 1 ? ` (of ${meta.frontAlternatives.join(' / ')})` : ''} | ${clauseRef(meta.frontClause)} |
| Rear setback | ${meta.rear} m | ${clauseRef(meta.rearClause)} |
| Side setback | ${meta.side} m each | ${clauseRef(meta.sideClause)} |${meta.edgeRoles?.includes('secondary')
    ? `\n| Secondary frontage | ${meta.secondary} m | ${clauseRef(meta.secondaryClause)} |`
    : ''}
| Height | ${meta.height} m | ${meta.heightSource} |

Height comes from this lot's mapped HOB value where the pipeline resolved one —
LEP cl 4.3 sets the standard but defers the number to the Height of Buildings
Map, so the mapped value is the operative figure.

${meta.buildable
  ? `## Result

Buildable footprint **${fmt(meta.buildableWidth)} x ${fmt(meta.buildableDepth)} m**
= ${Math.round(footprint)} m², which is ${Math.round(footprint / (meta.width * meta.depth) * 100)}%
of the ${fmt(meta.width)} x ${fmt(meta.depth)} m rectangle it was drawn in.

Measured against the drawn rectangle, not the recorded ${meta.area_sqm ?? '—'} m²:
the two are different denominators, and on a lot where the rectangle overstates
the parcel the second figure would exceed 100%.${Math.abs(meta.areaGap) > 0.25 ? `
Here the rectangle is ${pct}% ${meta.areaGap >= 0 ? 'larger' : 'smaller'} than the
recorded area, so treat the footprint as an upper bound rather than a figure to
design to.` : ''}`
  : `## Result

**No buildable envelope.** The setbacks (${meta.front} front, ${meta.rear} rear,
${meta.side} each side) exceed the ${fmt(meta.buildableBodyWidth)} x ${fmt(meta.buildableBodyDepth)} m
dimensions. That is a real outcome for small or narrow lots, not an error.`}
`
}

/** A clause that fell back to the built-in default is not a citation. */
function clauseRef(clause) {
  return !clause || clause === 'default'
    ? 'default (no DCP control matched)'
    : `DCP cl ${clause}`
}
