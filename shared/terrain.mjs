/**
 * Ground levels over a lot: the arithmetic behind /api/report/terrain, kept pure so it can be checked on its own.
 *
 * Everything works on a regular grid of levels (metres AHD) in a local metre frame - x east, y north - sampled from the
 * NSW 5 m elevation model. Rows run south to north (row 0 is the southern edge), columns west to east; a missing level
 * is null.
 */

/** A 3x3 binomial (1-2-1) smoothing pass that skips missing cells: takes the 5 m model's cell steps out of the contours. */
export function smoothGrid(z, nx, ny) {
  const w = [1, 2, 1]
  const out = new Array(nx * ny).fill(null)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (z[j * nx + i] == null) continue
      let s = 0, ws = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const v = z[jj * nx + ii]
          if (v == null) continue
          const k = w[di + 1] * w[dj + 1]
          s += v * k; ws += k
        }
      }
      out[j * nx + i] = s / ws
    }
  }
  return out
}

/** Slope at every node, in percent, from central differences (one-sided at an edge or next to a gap). */
export function slopeGrid(z, nx, ny, step) {
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : z[j * nx + i])
  const d = (a, b, c, h) => (a != null && c != null ? (c - a) / (2 * h) : b != null && c != null ? (c - b) / h : a != null && b != null ? (b - a) / h : null)
  const out = new Array(nx * ny).fill(null)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const b = at(i, j)
      if (b == null) continue
      const gx = d(at(i - 1, j), b, at(i + 1, j), step)
      const gy = d(at(i, j - 1), b, at(i, j + 1), step)
      if (gx == null || gy == null) continue
      out[j * nx + i] = Math.hypot(gx, gy) * 100
    }
  }
  return out
}

/**
 * The plane that best fits a set of [x, y, z] points (least squares): its grade in percent and the bearing the ground
 * falls toward (degrees clockwise from north). One number for "which way does the lot fall".
 */
export function fitPlane(points) {
  const n = points.length
  if (n < 3) return null
  let mx = 0, my = 0, mz = 0
  for (const [x, y, z] of points) { mx += x; my += y; mz += z }
  mx /= n; my /= n; mz /= n
  let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0
  for (const [x, y, z] of points) {
    const dx = x - mx, dy = y - my, dz = z - mz
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz
  }
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-9) return null
  const a = (sxz * syy - syz * sxy) / det // dz/dx (east)
  const b = (syz * sxx - sxz * sxy) / det // dz/dy (north)
  const grade = Math.hypot(a, b) * 100
  // downhill is -gradient; bearing measured clockwise from north
  const fallsToward = ((Math.atan2(-a, -b) * 180) / Math.PI + 360) % 360
  return { grade, fallsToward, a, b, centre: [mx, my, mz] }
}

/** "N", "NNE", ... for a bearing. */
export function compass(bearing) {
  const names = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
    'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']
  return names[Math.round(((bearing % 360) + 360) % 360 / 22.5) % 16]
}

/**
 * A contour interval that keeps the drawing readable: about 4 to 40 lines across the frame. The major line is every
 * 4th (or 5th) minor one, as on a survey.
 */
export function contourInterval(relief) {
  const steps = [[0.25, 1], [0.5, 2], [1, 5], [2, 10], [5, 25], [10, 50], [20, 100]]
  for (const [minor, major] of steps) if (relief / minor <= 40) return { minor, major }
  return { minor: 50, major: 250 }
}

/**
 * Contour lines by marching squares, joined into polylines.
 * Returns [{ z, major, lines: [[x, y, x, y, ...], ...] }] in the grid's metre frame (origin x0, y0; spacing step).
 */
export function contours(z, nx, ny, x0, y0, step, { minor, major }) {
  let lo = Infinity, hi = -Infinity
  for (const v of z) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v }
  if (!Number.isFinite(lo) || hi - lo < minor / 4) return []
  const out = []
  const eps = 1e-6
  for (let level = Math.ceil(lo / minor) * minor; level <= hi; level = +(level + minor).toFixed(6)) {
    const segs = []
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = z[j * nx + i], b = z[j * nx + i + 1], c = z[(j + 1) * nx + i + 1], d = z[(j + 1) * nx + i]
        if (a == null || b == null || c == null || d == null) continue
        // corners: a = SW, b = SE, c = NE, d = NW; nudge exact hits so a line never runs through a node
        const A = a === level ? a + eps : a, B = b === level ? b + eps : b, C = c === level ? c + eps : c, D = d === level ? d + eps : d
        const x = x0 + i * step, y = y0 + j * step
        const cross = []
        const edge = (p, q, px, py, qx, qy) => {
          if ((p < level) === (q < level)) return
          const t = (level - p) / (q - p)
          cross.push([px + (qx - px) * t, py + (qy - py) * t])
        }
        edge(A, B, x, y, x + step, y)                 // south
        edge(B, C, x + step, y, x + step, y + step)   // east
        edge(C, D, x + step, y + step, x, y + step)   // north
        edge(D, A, x, y + step, x, y)                 // west
        if (cross.length === 2) segs.push([cross[0], cross[1]])
        else if (cross.length === 4) {
          // saddle (crossings in order S, E, N, W): the centre value decides which pair of opposite corners is joined.
          // Centre on A's side -> A and C connect through the middle, so the lines cut off corners B (S-E) and D (N-W).
          const mid = (A + B + C + D) / 4
          if ((mid < level) === (A < level)) { segs.push([cross[0], cross[1]]); segs.push([cross[2], cross[3]]) }
          else { segs.push([cross[0], cross[3]]); segs.push([cross[1], cross[2]]) }
        }
      }
    }
    if (segs.length) out.push({ z: +level.toFixed(3), major: Math.abs(level / major - Math.round(level / major)) < 1e-6, lines: joinSegments(segs) })
  }
  return out
}

/** Join two-point segments that share endpoints into polylines (flat [x, y, x, y, ...] arrays, rounded to the cm). */
function joinSegments(segs) {
  const key = p => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`
  const ends = new Map()
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i) } })
  const used = new Array(segs.length).fill(false)
  const lines = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = true
    const line = [segs[i][0], segs[i][1]]
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line[line.length - 1] : line[0]
        const next = (ends.get(key(tip)) ?? []).find(k => !used[k])
        if (next == null) break
        used[next] = true
        const [p, q] = segs[next]
        const other = key(p) === key(tip) ? q : p
        if (forward) line.push(other); else line.unshift(other)
      }
    }
    lines.push(line.flatMap(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]))
  }
  return lines
}

/** Point in polygon (ring of [x, y]). */
export function inRing(x, y, ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** Shortest distance from a point to a polyline given as [[x, y], ...]. */
export function distToLine(x, y, line) {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1]
    const dx = bx - ax, dy = by - ay
    const L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
  }
  return best
}

/** Median of a numeric array. */
export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
