/**
 * The layer lists for /lmr, from the PMTiles manifests (server/utils/sepp-pmtiles.ts):
 *   - every SEPP land application layer, with its feature count, classes, extent and minimum zoom;
 *   - `constraints`: the lmr schema layers (stations, heritage, bushfire, flood, coastal, noise, pipelines).
 * A missing constraints archive is not an error: the SEPP half of the page works without it.
 */
import {
  CONSTRAINT_STYLE, familyOf,
  type ConstraintCatalogue, type LmrCatalogue,
} from '#shared/lmr-layers'
import { manifestFor } from '../../utils/sepp-pmtiles'

export default defineEventHandler(async (event): Promise<LmrCatalogue & { archive: string; constraints: ConstraintCatalogue | null }> => {
  setHeader(event, 'cache-control', 'public, max-age=60')
  const m = await manifestFor('sepp')
  const c = await manifestFor('lmr').catch(() => null)
  return {
    archive: m.archive,
    builtAt: m.builtAt,
    sourceLoadedAt: m.source?.loadedAt ?? null,
    sourceDate: m.source?.sourceDate ?? null,
    layers: m.layers.map(l => ({
      key: l.key,
      group: l.group,
      family: familyOf(l.sepp, l.group),
      sepp: l.sepp,
      epiName: l.epiName,
      layName: l.layName,
      features: l.features,
      classes: l.classes,
      lgas: l.lgas,
      areaKm2: null,
      commenced: l.commenced,
      bbox: l.bbox,
      minZoom: l.minZoom,
    })),
    constraints: c && {
      archive: c.archive,
      builtAt: c.builtAt,
      layers: c.layers
        .filter(l => CONSTRAINT_STYLE[l.key])
        .map(l => ({
          key: l.key,
          table: l.table,
          group: CONSTRAINT_STYLE[l.key]!.group,
          title: CONSTRAINT_STYLE[l.key]!.title,
          geometry: l.geometry,
          features: l.features,
          minZoom: l.minZoom,
          bbox: l.bbox,
          categories: l.categories,
          comment: l.comment,
        })),
    },
  }
})
