/**
 * Hatched fills, as the Planning Portal draws them: ESRI simple-fill hatch styles turned into a Mapbox
 * `fill-pattern` image and into a CSS legend swatch that looks the same. Shared by /lmr and /cdc-map.
 */

/** ESRI simple-fill hatch styles, as the renderers name them (esriSFSBackwardDiagonal and so on). */
export type Hatch = 'bdiag' | 'fdiag' | 'vertical' | 'horizontal' | 'dcross'

/** The empty tile a solid feature resolves to, so one data-driven pattern layer can cover every feature. */
export const HATCH_NONE = 'hatch-none'

export const hatchId = (h: Hatch, colour: string) => `hatch-${h}-${colour.replace('#', '')}`

/**
 * A hatch tile: lines of the colour on transparent, 16 px drawn at pixelRatio 2 so the spacing is 8 css px.
 * The lines wrap at the tile edge, so the pattern repeats without a seam.
 */
export function hatchImage(h: Hatch | 'none', colour: string): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  if (h === 'none') return { width: size, height: size, data }
  const n = parseInt(colour.slice(1), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const on = (x: number, y: number): boolean => {
    const d1 = (x - y + size) % size // '\' when drawn top-down
    const d2 = (x + y) % size // '/'
    switch (h) {
      case 'bdiag': return d1 < 2
      case 'fdiag': return d2 < 2
      case 'vertical': return x % size < 2
      case 'horizontal': return y % size < 2
      case 'dcross': return d1 < 2 || d2 < 2
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!on(x, y)) continue
      const i = (y * size + x) * 4
      data[i] = rgb[0]!; data[i + 1] = rgb[1]!; data[i + 2] = rgb[2]!; data[i + 3] = 235
    }
  }
  return { width: size, height: size, data }
}

/** Register a hatch on a map once; returns its image id. */
export function ensureHatch(map: any, h: Hatch, colour: string): string {
  if (!map.hasImage(HATCH_NONE)) map.addImage(HATCH_NONE, hatchImage('none', '#000000'), { pixelRatio: 2 })
  const id = hatchId(h, colour)
  if (!map.hasImage(id)) map.addImage(id, hatchImage(h, colour), { pixelRatio: 2 })
  return id
}

/** CSS background for a hatched legend swatch. Stripes run across the gradient, so 45deg draws '\'. */
export function hatchCss(h: Hatch, colour: string): string {
  const angle = { bdiag: '45deg', fdiag: '135deg', vertical: '90deg', horizontal: '0deg', dcross: '45deg' }[h]
  const lines = `repeating-linear-gradient(${angle}, ${colour} 0 1.5px, transparent 1.5px 4px)`
  return h === 'dcross'
    ? `${lines}, repeating-linear-gradient(135deg, ${colour} 0 1.5px, transparent 1.5px 4px)`
    : lines
}
