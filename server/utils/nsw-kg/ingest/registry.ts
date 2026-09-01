// ── Document source registry (database-backed) ──────────────────────────
//
// Replaces the hardcoded SOURCES map in ./sources.ts. Reads nsw.source_registry
// so adding an instrument is a row insert, not a code change.
//
// Transitional behaviour: if a label is missing from the table (or the table
// has not been created yet), we fall back to the static SOURCES map and log
// once. That keeps the existing CLI scripts working before the seed has run.
// Once `scripts/seed-source-registry.ts` has been run against an environment,
// the fallback should never fire there.

import { withNswClient } from '../pool'
import type { DocumentSource } from '../types'
import { SOURCES } from './sources'

/** Extra provenance carried by registry rows but not by DocumentSource. */
export interface SourceProvenance {
  origin?:         'registry' | 'upload' | 'url'
  content_sha256?: string | null
  original_name?:  string | null
  enabled?:        boolean
}

export type RegistrySource = DocumentSource & SourceProvenance

const COLUMNS = `
  label, title, doc_type, scope, hierarchy_level, lga_name,
  source_url, raw_path, raw_format, as_at_date::text AS as_at_date,
  origin, content_sha256, original_name, enabled
`

let warnedFallback = false

function warnFallback(label: string) {
  if (warnedFallback) return
  warnedFallback = true
  console.warn(
    `[registry] "${label}" not found in nsw.source_registry — falling back to the static ` +
    `SOURCES map. Run "npm run seed:sources" to populate the table.`,
  )
}

function rowToSource(r: any): RegistrySource {
  return {
    label:           r.label,
    title:           r.title,
    doc_type:        r.doc_type,
    scope:           r.scope,
    hierarchy_level: Number(r.hierarchy_level),
    lga_name:        r.lga_name,
    source_url:      r.source_url,
    raw_path:        r.raw_path,
    raw_format:      r.raw_format,
    as_at_date:      r.as_at_date,
    origin:          r.origin,
    content_sha256:  r.content_sha256,
    original_name:   r.original_name,
    enabled:         r.enabled,
  }
}

/** True when nsw.source_registry exists. Cached after the first check. */
let tableExists: boolean | null = null

async function hasRegistryTable(): Promise<boolean> {
  if (tableExists !== null) return tableExists
  tableExists = await withNswClient(async (client) => {
    const r = await client.query(
      `SELECT to_regclass('nsw.source_registry') IS NOT NULL AS present`,
    )
    return Boolean(r.rows[0]?.present)
  })
  return tableExists
}

/** Look up one source by label. Falls back to the static map when absent. */
export async function getSource(label: string): Promise<RegistrySource> {
  if (await hasRegistryTable()) {
    const row = await withNswClient(async (client) => {
      const r = await client.query(
        `SELECT ${COLUMNS} FROM nsw.source_registry WHERE label = $1 AND enabled`,
        [label],
      )
      return r.rows[0] ?? null
    })
    if (row) return rowToSource(row)
  }

  const fallback = SOURCES[label]
  if (!fallback) {
    const known = await listSources()
    throw new Error(
      `Unknown document source: ${label}. Known: ${known.join(', ') || '(registry empty)'}`,
    )
  }
  warnFallback(label)
  return { ...fallback, origin: 'registry' }
}

/** All enabled source labels, registry union static map. */
export async function listSources(): Promise<string[]> {
  const labels = new Set<string>()

  if (await hasRegistryTable()) {
    const rows = await withNswClient(async (client) => {
      const r = await client.query(
        `SELECT label FROM nsw.source_registry WHERE enabled ORDER BY label`,
      )
      return r.rows
    })
    for (const r of rows) labels.add(r.label)
  }

  for (const label of Object.keys(SOURCES)) labels.add(label)
  return Array.from(labels).sort()
}

/** Full rows, for the library UI. Registry only — no static fallback. */
export async function listRegistered(): Promise<RegistrySource[]> {
  if (!(await hasRegistryTable())) return []
  const rows = await withNswClient(async (client) => {
    const r = await client.query(
      `SELECT ${COLUMNS} FROM nsw.source_registry ORDER BY doc_type, label`,
    )
    return r.rows
  })
  return rows.map(rowToSource)
}

/** Insert or update one source. Returns the stored row. */
export async function upsertSource(src: RegistrySource): Promise<RegistrySource> {
  const row = await withNswClient(async (client) => {
    const r = await client.query(
      `INSERT INTO nsw.source_registry (
         label, title, doc_type, scope, hierarchy_level, lga_name,
         source_url, raw_path, raw_format, as_at_date,
         origin, content_sha256, original_name, enabled
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (label) DO UPDATE SET
         title           = EXCLUDED.title,
         doc_type        = EXCLUDED.doc_type,
         scope           = EXCLUDED.scope,
         hierarchy_level = EXCLUDED.hierarchy_level,
         lga_name        = EXCLUDED.lga_name,
         source_url      = EXCLUDED.source_url,
         raw_path        = EXCLUDED.raw_path,
         raw_format      = EXCLUDED.raw_format,
         as_at_date      = EXCLUDED.as_at_date,
         origin          = EXCLUDED.origin,
         content_sha256  = EXCLUDED.content_sha256,
         original_name   = EXCLUDED.original_name,
         enabled         = EXCLUDED.enabled,
         updated_at      = now()
       RETURNING ${COLUMNS}`,
      [
        src.label, src.title, src.doc_type, src.scope, src.hierarchy_level,
        src.lga_name, src.source_url, src.raw_path, src.raw_format, src.as_at_date,
        src.origin ?? 'registry', src.content_sha256 ?? null,
        src.original_name ?? null, src.enabled ?? true,
      ],
    )
    return r.rows[0]
  })
  return rowToSource(row)
}

/** Find an existing source by uploaded file checksum (dedupe — A5). */
export async function findByChecksum(sha256: string): Promise<RegistrySource | null> {
  if (!(await hasRegistryTable())) return null
  const row = await withNswClient(async (client) => {
    const r = await client.query(
      `SELECT ${COLUMNS} FROM nsw.source_registry WHERE content_sha256 = $1`,
      [sha256],
    )
    return r.rows[0] ?? null
  })
  return row ? rowToSource(row) : null
}
