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
 * Not a NSW Housing Pattern Book design. The massing is a form sized to fit the
 * envelope, so it answers "what does this lot allow", not "here is an approved
 * design".
 */

const LAYERS = ['frame', 'cladding ext', 'cladding int', 'interior', 'roof',
  'floors', 'foundations', 'fixtures', 'other']

const COLLECTIONS = ['', 'Lot', 'Envelope', 'Setback_alternatives', 'Height_limit', 'Massing']

/**
 * @param lot      row from nsw.up_property_d_3
 * @param controls rows from nsw.rule_effect (topic setback/height) with `clause`
 */
export function buildEnvelopeModel(lot, controls = []) {
  const boxes = []

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
    return {
      v: Math.max(...vals.map(c => Number(c.value))),
      clause: vals[0].clause,
      all: [...new Set(vals.map(c => Number(c.value)))].sort((a, b) => a - b),
    }
  }

  const front = worst('front_boundary', 6)
  const rear = worst('rear_boundary', 6)
  const side = worst('side_boundary', 0.9)

  // The lot's mapped HOB is the operative height standard; LEP cl 4.3 sets the
  // control but defers the number to the Height of Buildings Map.
  const dcpMax = controls.filter(c => c.topic === 'height' && c.comparator === 'lte').map(c => Number(c.value))
  const height = Number(lot.hob_max_b_h_m) || (dcpMax.length ? Math.min(...dcpMax) : 8.5)
  const heightSource = Number(lot.hob_max_b_h_m) ? 'HOB map (LEP cl 4.3)' : 'DCP height control'

  // The cadastre gives frontage and depth but not the polygon, so the lot is a
  // rectangle of those dimensions — indicative in plan, exact in the vertical.
  const W = Number(lot.primary_frontage_length_m) || Math.sqrt(Number(lot.area_sqm) || 600)
  const D = Number(lot.lot_depth_m) || ((Number(lot.area_sqm) || 600) / W)

  box(`Lot_${W.toFixed(1)}m_frontage_x_${D.toFixed(1)}m_depth_${Math.round(Number(lot.area_sqm) || 0)}sqm`,
    'Lot', 'foundations', [0, 0, -0.1], [W, D, 0])

  const bx0 = side.v, bx1 = W - side.v, by0 = front.v, by1 = D - rear.v
  const buildable = (bx1 - bx0) > 0 && (by1 - by0) > 0

  if (buildable) {
    cage(`Envelope_front${front.v}m_rear${rear.v}m_side${side.v}m_height${height}m`,
      'Envelope', 'other', [bx0, by0, 0], [bx1, by1, height])

    box(`Setback_front_${front.v}m__DCP_cl_${front.clause}`, 'Envelope', 'other', [bx0, by0 - 0.04, 0], [bx1, by0 + 0.04, 0.35])
    box(`Setback_rear_${rear.v}m__DCP_cl_${rear.clause}`, 'Envelope', 'other', [bx0, by1 - 0.04, 0], [bx1, by1 + 0.04, 0.35])
    box(`Setback_side_${side.v}m_west__DCP_cl_${side.clause}`, 'Envelope', 'other', [bx0 - 0.04, by0, 0], [bx0 + 0.04, by1, 0.35])
    box(`Setback_side_${side.v}m_east__DCP_cl_${side.clause}`, 'Envelope', 'other', [bx1 - 0.04, by0, 0], [bx1 + 0.04, by1, 0.35])
    box(`Height_limit_${height}m__${heightSource.replace(/[^\w.]+/g, '_')}`, 'Height_limit', 'other',
      [bx0, by0, height - 0.03], [bx1, by1, height + 0.03])

    // Front setback is context-dependent; the values not modelled are marked so
    // the envelope does not read as a single certain number.
    for (const alt of front.all.filter(v => v !== front.v)) {
      box(`Setback_front_alternative_${alt}m__DCP_cl_${front.clause}`, 'Setback_alternatives', 'other',
        [bx0, alt - 0.03, 0], [bx1, alt + 0.03, 0.12])
    }

    const storey = Math.min(3.0, (height - 1.0) / 2)
    const my1 = by0 + Math.min(by1 - by0, 16)
    for (const [lvl, z] of [[0, 0], [1, storey]]) {
      box(`Massing_L${lvl}_slab`, 'Massing', 'floors', [bx0, by0, z], [bx1, my1, z + 0.2])
      box(`Massing_L${lvl}_volume`, 'Massing', 'cladding ext', [bx0, by0, z + 0.2], [bx1, my1, z + storey])
    }
    box('Massing_roof', 'Massing', 'roof', [bx0, by0, 2 * storey], [bx1, my1, Math.min(2 * storey + 1.0, height)])
  }

  return {
    model: {
      format: 'craftbot-model',
      version: 1,
      source: `planning envelope — ${lot.address}`,
      collections: COLLECTIONS,
      boxes,
      meshes: [],
      layers: LAYERS,
    },
    meta: {
      address: lot.address, zone: lot.lzn_sym_code_p ?? lot.zone ?? null,
      lotSectionPlan: lot.lot_section_plan ?? null,
      epiName: lot.epi_name ?? null,
      minLotSize: lot.lot_size ?? null,
      area_sqm: lot.area_sqm, width: W, depth: D,
      // How far the frontage x depth rectangle is from the recorded area. The
      // rationale leads with it, because it is the envelope's main caveat.
      areaGap: Number(lot.area_sqm) ? (W * D - Number(lot.area_sqm)) / Number(lot.area_sqm) : 0,
      front: front.v, rear: rear.v, side: side.v, height, heightSource,
      frontClause: front.clause, rearClause: rear.clause, sideClause: side.clause,
      frontAlternatives: front.all, buildable,
      buildableWidth: buildable ? bx1 - bx0 : 0,
      buildableDepth: buildable ? by1 - by0 : 0,
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
export function buildEnvelopeRationale(meta, { landUse = 'dwelling house', storeys = 2 } = {}) {
  const fmt = (n) => Number(n).toFixed(1)
  const pct = Math.abs(meta.areaGap * 100).toFixed(1)
  const footprint = meta.buildableWidth * meta.buildableDepth

  return `# ${meta.address} — planning envelope

**Not a NSW Housing Pattern Book design.** The Pattern Book's dimensions are
published only in its downloadable pattern packs, which this repository does not
hold. The massing here is a two-storey form sized to fit the envelope, so it
answers "what does this lot allow", not "here is an approved design".

## The lot

| | |
|---|---|
| Address | ${meta.address} |
| Lot / plan | ${meta.lotSectionPlan ?? '—'} |
| Zone | ${meta.zone ?? '—'} (${meta.epiName ?? 'LEP'}) |
| Area (recorded) | ${meta.area_sqm ?? '—'} m² |
| Frontage | ${fmt(meta.width)} m |
| Depth | ${fmt(meta.depth)} m |
| Minimum lot size | ${meta.minLotSize ? `${meta.minLotSize} m²` : '—'} |

Drawn as a ${fmt(meta.width)} x ${fmt(meta.depth)} m rectangle, because the
cadastre gives us frontage and depth but not the parcel polygon. That rectangle
is **${pct}%** ${meta.areaGap >= 0 ? 'larger' : 'smaller'} than the recorded
area — a real lot is rarely a rectangle, so read the envelope as indicative in
plan and exact in the vertical.

## Controls applied — ${landUse}, ${storeys} storeys

| Plane | Value | Source |
|---|---|---|
| Front setback | ${meta.front} m${meta.frontAlternatives.length > 1 ? ` (of ${meta.frontAlternatives.join(' / ')})` : ''} | ${clauseRef(meta.frontClause)} |
| Rear setback | ${meta.rear} m | ${clauseRef(meta.rearClause)} |
| Side setback | ${meta.side} m each | ${clauseRef(meta.sideClause)} |
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
${meta.side} each side) exceed this lot's ${fmt(meta.width)} x ${fmt(meta.depth)} m
dimensions. That is a real outcome for small or narrow lots, not an error.`}
`
}

/** A clause that fell back to the built-in default is not a citation. */
function clauseRef(clause) {
  return !clause || clause === 'default'
    ? 'default (no DCP control matched)'
    : `DCP cl ${clause}`
}
