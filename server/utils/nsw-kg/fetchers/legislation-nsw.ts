// ── legislation.nsw.gov.au fetcher ──────────────────────────────────────
//
// Reads NSW legislation XML for a given EPI ID. Prefers the local cache
// in public/EPI/xml/ or public/EPI/SEPP/, falls back to fetching from
// legislation.nsw.gov.au at a pinned consolidation date.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(process.cwd())

export interface FetchedXml {
  xml:               string
  source_url:        string
  raw_path:          string
  consolidation_id?: string
}

/** Locate a cached XML for an EPI ID, or fetch from legislation.nsw.gov.au.
 *  Search order:
 *    1. Explicit `localPath` if provided
 *    2. public/EPI/xml/<epiId>.xml
 *    3. public/EPI/SEPP/<epiId>_*.xml (the date-suffixed cache used for SEPPs)
 *    4. fetch from https://legislation.nsw.gov.au/export/xml/<asAtDate>/<epiId>
 */
export async function fetchLegislationXml(opts: {
  epiId:     string                  // e.g. 'epi-2010-0433'
  asAtDate:  string                  // e.g. '2026-04-07'
  localPath?: string                 // override
}): Promise<FetchedXml> {
  const { epiId, asAtDate, localPath } = opts

  // 1. Explicit override
  if (localPath && existsSync(localPath)) {
    const xml = await readFile(localPath, 'utf8')
    return {
      xml,
      source_url: `https://legislation.nsw.gov.au/view/whole/html/inforce/${asAtDate}/${epiId}`,
      raw_path: localPath,
    }
  }

  // 2. Standard cache: public/EPI/xml/<epiId>.xml
  const standardCache = path.join(REPO_ROOT, 'public', 'EPI', 'xml', `${epiId}.xml`)
  if (existsSync(standardCache)) {
    const xml = await readFile(standardCache, 'utf8')
    return {
      xml,
      source_url: `https://legislation.nsw.gov.au/view/whole/html/inforce/${asAtDate}/${epiId}`,
      raw_path: standardCache,
    }
  }

  // 3. Date-suffixed SEPP cache: public/EPI/SEPP/<epiId>_<date>.xml
  const seppDir = path.join(REPO_ROOT, 'public', 'EPI', 'SEPP')
  if (existsSync(seppDir)) {
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(seppDir)
    const match = files
      .filter(f => f.startsWith(`${epiId}_`) && f.endsWith('.xml'))
      .sort()
      .pop() // most recent
    if (match) {
      const fullPath = path.join(seppDir, match)
      const xml = await readFile(fullPath, 'utf8')
      // Extract date from filename like 'epi-2021-0714_2026-03-23.xml'
      const dateMatch = match.match(/_(\d{4}-\d{2}-\d{2})\.xml$/)
      return {
        xml,
        source_url: `https://legislation.nsw.gov.au/view/whole/html/inforce/${asAtDate}/${epiId}`,
        raw_path: fullPath,
        consolidation_id: dateMatch?.[1],
      }
    }
  }

  // 4. Live fetch
  const url = `https://legislation.nsw.gov.au/export/xml/${asAtDate}/${epiId}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'heenco-nsw-kg-v2/0.1 (research)' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  const xml = await res.text()
  return {
    xml,
    source_url: url,
    raw_path: '',  // not cached locally on this run
  }
}
