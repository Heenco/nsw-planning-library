/**
 * The PMTiles archives behind /lmr, served as static files by nginx on the planningai host
 * (runtimeConfig.seppPmtilesBase):
 *
 *   sepp   sepp-land-application.json -> sepp-land-application-<stamp>.pmtiles   MVT layer "sepp"
 *          every SEPP land application layer of epi.epi_land_application (scripts/build-sepp-pmtiles.py)
 *   lmr    lmr-constraints.json       -> lmr-constraints-<stamp>.pmtiles         MVT layer "lmr"
 *          the lmr schema: stations, heritage, bushfire, flood, coastal, noise, pipelines (scripts/build-lmr-pmtiles.py)
 *
 * Each manifest is re-read every MANIFEST_TTL_MS, so a rebuild is picked up without a redeploy. Archive names
 * are unique, so an archive is opened once and its tiles never change; the reader fetches only the byte ranges
 * it needs with HTTP Range requests.
 */
import { FetchSource, PMTiles } from 'pmtiles'
import type { LmrLayer } from '#shared/lmr-layers'

const MANIFEST_TTL_MS = 5 * 60 * 1000

export type ArchiveSet = 'sepp' | 'lmr'

const MANIFEST_FILE: Record<ArchiveSet, string> = {
  sepp: 'sepp-land-application.json',
  lmr: 'lmr-constraints.json',
}

/** The MVT layer name inside each archive. */
export const MVT_LAYER: Record<ArchiveSet, string> = { sepp: 'sepp', lmr: 'lmr' }

export interface SeppManifest {
  archive: string
  builtAt: string
  source: { loadedAt: string | null; sourceDate: string | null } | null
  minZoom: number
  maxZoom: number
  features: number
  layers: (Omit<LmrLayer, 'family' | 'areaKm2'> & { vertices: number })[]
}

export interface ConstraintManifest {
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
  layers: {
    key: string
    table: string
    geometry: 'point' | 'linestring' | 'polygon'
    features: number
    vertices: number
    minZoom: number
    bbox: [number, number, number, number] | null
    categories: { name: string; features: number }[]
    comment: string | null
  }[]
}

type ManifestOf<S extends ArchiveSet> = S extends 'sepp' ? SeppManifest : ConstraintManifest

const manifestCache = new Map<ArchiveSet, { at: number; value: any }>()
const archiveCache = new Map<ArchiveSet, { name: string; pmtiles: PMTiles }>()

function base(): string {
  return String(useRuntimeConfig().seppPmtilesBase || '').replace(/\/+$/, '')
}

export async function manifestFor<S extends ArchiveSet>(set: S): Promise<ManifestOf<S>> {
  const hit = manifestCache.get(set)
  if (hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.value
  try {
    const value = await $fetch<ManifestOf<S>>(`${base()}/${MANIFEST_FILE[set]}`, { timeout: 10_000 })
    manifestCache.set(set, { at: Date.now(), value })
    return value
  } catch (err: any) {
    // a stale manifest beats none while the static host blips
    if (hit) return hit.value
    throw createError({ statusCode: 503, statusMessage: `The ${set} tiles manifest is not reachable at ${base()}: ${err?.message ?? err}` })
  }
}

export async function archiveFor<S extends ArchiveSet>(set: S): Promise<{ manifest: ManifestOf<S>; pmtiles: PMTiles }> {
  const manifest = await manifestFor(set)
  const open = archiveCache.get(set)
  if (open?.name === manifest.archive) return { manifest, pmtiles: open.pmtiles }
  const pmtiles = new PMTiles(new FetchSource(`${base()}/${manifest.archive}`))
  archiveCache.set(set, { name: manifest.archive, pmtiles })
  return { manifest, pmtiles }
}

/** The SEPP archive, kept for the routes written against it. */
export const seppManifest = () => manifestFor('sepp')
export const seppArchive = () => archiveFor('sepp')
