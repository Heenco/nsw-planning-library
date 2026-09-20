/**
 * Vector tiles for /lmr, read out of a PMTiles archive (server/utils/sepp-pmtiles.ts). No tile server and no
 * database: each request is a couple of HTTP range reads against a static file.
 *
 *   /api/lmr/tiles/{z}/{x}/{y}?set=sepp&v=<archive name>    SEPP land application layers (MVT layer "sepp")
 *   /api/lmr/tiles/{z}/{x}/{y}?set=lmr&v=<archive name>     LMR constraints (MVT layer "lmr")
 *   /api/lmr/tiles/{z}/{x}/{y}?set=esa&v=<archive name>     ESA exceptions (MVT layer "esa")
 *   /api/lmr/tiles/{z}/{x}/{y}?set=esa33&v=<archive name>   clause 3.3 state-wide (MVT layer "esa33")
 *   /api/lmr/tiles/{z}/{x}/{y}?set=epi-<group>&v=<archive>  one EPI group (MVT layer "epi")
 *   /api/lmr/tiles/{z}/{x}/{y}?set=cdc-<group>&v=<archive>  one CDC group (MVT layer "cdc")
 *
 * The page shows and hides layers with a map filter on the layer_key property, so a tile URL never changes
 * with the toggles. `v` names the archive, and an archive's tiles never change, so they may be cached for a day.
 */
import { archiveFor, isCdcSet, isEpiSet, type ArchiveSet } from '../../../../../utils/sepp-pmtiles'

export default defineEventHandler(async (event) => {
  const z = Number(getRouterParam(event, 'z'))
  const x = Number(getRouterParam(event, 'x'))
  const y = Number(String(getRouterParam(event, 'y')).replace(/\.(pbf|mvt)$/, ''))
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw createError({ statusCode: 400, statusMessage: 'Bad tile address' })
  }
  const asked = String(getQuery(event).set ?? '')
  const set: ArchiveSet = asked === 'lmr' || asked === 'esa' || asked === 'esa33'
    || isEpiSet(asked) || isCdcSet(asked)
    ? asked as ArchiveSet
    : 'sepp'

  const { pmtiles } = await archiveFor(set)
  const header = await pmtiles.getHeader()
  setHeader(event, 'cache-control', 'public, max-age=86400')
  if (z < header.minZoom || z > header.maxZoom) {
    setResponseStatus(event, 204)
    return null
  }
  const tile = await pmtiles.getZxy(z, x, y)
  if (!tile?.data || tile.data.byteLength === 0) {
    setResponseStatus(event, 204)
    return null
  }
  setHeader(event, 'content-type', 'application/vnd.mapbox-vector-tile')
  // tippecanoe gzips each tile in the archive, but getZxy has already inflated it: these bytes are raw MVT
  return Buffer.from(tile.data)
})
