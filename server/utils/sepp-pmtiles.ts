/**
 * The PMTiles archives behind /lmr, served as static files by nginx on the planningai host
 * (runtimeConfig.seppPmtilesBase):
 *
 *   sepp   sepp-land-application.json -> sepp-land-application-<stamp>.pmtiles   MVT layer "sepp"
 *          every SEPP land application layer of epi.epi_land_application (scripts/build-sepp-pmtiles.py)
 *   lmr    lmr-constraints.json       -> lmr-constraints-<stamp>.pmtiles         MVT layer "lmr"
 *          the lmr schema: stations, heritage, bushfire, flood, coastal, noise, pipelines (scripts/build-lmr-pmtiles.py)
 *   esa    esa-exceptions.json        -> esa-exceptions-<stamp>.pmtiles          MVT layer "esa"
 *          the additional clause 3.3 environmentally sensitive areas (scripts/build-esa-pmtiles.py)
 *   esa33  esa-clause33.json          -> esa-clause33-<stamp>.pmtiles           MVT layer "esa33"
 *          the state-wide half of clause 3.3, one layer per item (scripts/build-esa33-pmtiles.py)
 *
 * Each manifest is re-read every MANIFEST_TTL_MS, so a rebuild is picked up without a redeploy. Archive names
 * are unique, so an archive is opened once and its tiles never change; the reader fetches only the byte ranges
 * it needs with HTTP Range requests.
 */
import { FetchSource, PMTiles } from 'pmtiles'
import type { LmrLayer } from '#shared/lmr-layers'

const MANIFEST_TTL_MS = 5 * 60 * 1000

/** The EPI schema is tiled in groups, smallest first; see scripts/build-epi-pmtiles.py. */
export const EPI_GROUPS = ['hazard', 'resources', 'principal', 'development', 'biodiversity', 'application'] as const
export type EpiGroup = (typeof EPI_GROUPS)[number]
export type EpiSet = `epi-${EpiGroup}`

/** The CDC schema is tiled the same way, in the groups the page already shows; see build-cdc-pmtiles.py. */
export const CDC_GROUPS = ['heritage', 'code', 'land', 'water', 'hazard', 'nature'] as const
export type CdcGroup = (typeof CDC_GROUPS)[number]
export type CdcSet = `cdc-${CdcGroup}`

export type ArchiveSet = 'sepp' | 'lmr' | 'esa' | 'esa33' | EpiSet | CdcSet

export const isEpiSet = (s: string): s is EpiSet =>
  s.startsWith('epi-') && (EPI_GROUPS as readonly string[]).includes(s.slice(4))

export const isCdcSet = (s: string): s is CdcSet =>
  s.startsWith('cdc-') && (CDC_GROUPS as readonly string[]).includes(s.slice(4))

const MANIFEST_FILE: Record<ArchiveSet, string> = {
  sepp: 'sepp-land-application.json',
  lmr: 'lmr-constraints.json',
  esa: 'esa-exceptions.json',
  esa33: 'esa-clause33.json',
  ...Object.fromEntries(EPI_GROUPS.map(g => [`epi-${g}`, `epi-${g}.json`])) as Record<EpiSet, string>,
  ...Object.fromEntries(CDC_GROUPS.map(g => [`cdc-${g}`, `cdc-${g}.json`])) as Record<CdcSet, string>,
}

/** The MVT layer name inside each archive. Every EPI archive uses the same one, so the page needs one style. */
export const MVT_LAYER: Record<ArchiveSet, string> = {
  sepp: 'sepp', lmr: 'lmr', esa: 'esa', esa33: 'esa33',
  ...Object.fromEntries(EPI_GROUPS.map(g => [`epi-${g}`, 'epi'])) as Record<EpiSet, string>,
  ...Object.fromEntries(CDC_GROUPS.map(g => [`cdc-${g}`, 'cdc'])) as Record<CdcSet, string>,
}

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

export interface EsaManifest {
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
  /** One entry per exception item, with the extent the page zooms to. */
  items: { id: number; lep: string; ref: string; tier: string; bbox: [number, number, number, number]; km2: number | null }[]
}

/** The state-wide clause 3.3 archive: one entry per registered item, tiled or not. */
export interface Esa33Manifest {
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
  layers: {
    key: string
    paragraph: string | null
    item: string
    table: string
    provenance: 'epi' | 'download' | 'derived' | 'gap'
    source: string | null
    verified: boolean
    note: string | null
    /** false when the layer is in the database but deliberately not drawn (see ESA33_SKIP). */
    tiled: boolean
    features: number
    vertices: number
    minZoom: number
    bbox: [number, number, number, number] | null
    geometry: 'point' | 'linestring' | 'polygon' | null
    categories: { name: string; features: number }[]
  }[]
}

/** One EPI group's archive: the tables it holds, each drawn as one map layer. */
export interface EpiLayer {
  key: string
  group: EpiGroup
  table: string
  rows: number
  vertices: number
  features: number
  minZoom: number
  bbox: [number, number, number, number] | null
  geometry: 'point' | 'linestring' | 'polygon' | null
  categories: { name: string; features: number }[]
  /** How many instruments draw this layer, counted while the build streams. Absent in older archives. */
  plans?: number
  /** The map names the layer is published under, biggest first. Absent in older archives. */
  maps?: { name: string; features: number }[]
  comment: string | null
}

export interface EpiManifest {
  group: EpiGroup
  label: string
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
  layers: EpiLayer[]
}

/**
 * epi-layers.json: what the page reads. The build rewrites it after every group, so a run that stopped
 * half way lists only the groups that finished rather than promising layers no archive can serve.
 */
export interface EpiIndex {
  builtAt: string
  groupOrder: EpiGroup[]
  groups: Record<string, { label: string; archive: string; builtAt: string; minZoom: number; maxZoom: number; features: number }>
  layers: (EpiLayer & { archive: string })[]
}

/** One layer of the cdc schema as the tile build describes it. */
export interface CdcTileLayer {
  key: string
  title: string
  group: string
  groupTitle: string
  clauses: string[]
  columnTested: string | null
  note: string | null
  kind: string
  sourceKind: string
  source: string
  filter: string | null
  features: number
  minZoom: number
  bbox: [number, number, number, number] | null
  categories: { name: string; features: number }[]
}

export interface CdcManifest {
  group: string
  label: string
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
  layers: CdcTileLayer[]
}

/** cdc-layers.json, rewritten after every group so a partial build still serves what finished. */
export interface CdcIndex {
  builtAt: string
  groupOrder: CdcGroup[]
  groups: Record<string, { label: string; archive: string; builtAt: string; minZoom: number; maxZoom: number; features: number }>
  layers: (CdcTileLayer & { archive: string })[]
}

type ManifestOf<S extends ArchiveSet> =
  S extends 'sepp' ? SeppManifest
    : S extends 'esa' ? EsaManifest
      : S extends 'esa33' ? Esa33Manifest
        : S extends EpiSet ? EpiManifest
          : S extends CdcSet ? CdcManifest
            : ConstraintManifest

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

let epiIndexCache: { at: number; value: EpiIndex } | null = null

/** The EPI index, cached like the manifests. Returns null rather than throwing when no build exists yet. */
export async function epiIndex(): Promise<EpiIndex | null> {
  if (epiIndexCache && Date.now() - epiIndexCache.at < MANIFEST_TTL_MS) return epiIndexCache.value
  try {
    const value = await $fetch<EpiIndex>(`${base()}/epi-layers.json`, { timeout: 10_000 })
    epiIndexCache = { at: Date.now(), value }
    return value
  } catch {
    return epiIndexCache?.value ?? null
  }
}

let cdcIndexCache: { at: number; value: CdcIndex } | null = null

/** The CDC index. Null rather than a throw when no build exists yet: the page still lists the layers. */
export async function cdcIndex(): Promise<CdcIndex | null> {
  if (cdcIndexCache && Date.now() - cdcIndexCache.at < MANIFEST_TTL_MS) return cdcIndexCache.value
  try {
    const value = await $fetch<CdcIndex>(`${base()}/cdc-layers.json`, { timeout: 10_000 })
    cdcIndexCache = { at: Date.now(), value }
    return value
  } catch {
    return cdcIndexCache?.value ?? null
  }
}
