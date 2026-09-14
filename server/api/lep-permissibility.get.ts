/**
 * A plan's Land Use Table, as written and as resolved.
 *
 *   /api/lep-permissibility                        → every plan that has one
 *   /api/lep-permissibility?epi=epi-2013-0569      → that plan's zones, with counts
 *   /api/lep-permissibility?epi=…&zone=pt-cg1.Zone_R2
 *                                                  → one zone in full
 *   /api/lep-permissibility?name=Hornsby Local Environmental Plan 2013&code=R2
 *                                                  → the same zone, looked up the
 *                                                    way a property record names it
 *
 * Two tables back this and they answer different questions.
 *
 * nsw.lep_zones is the table as extracted from the instrument: the zone
 * objectives and the item 2, 3 and 4 lists, one row per line, verbatim. It is
 * what a reader of the plan sees, and it names group terms ("Commercial
 * premises") without saying what they cover.
 *
 * nsw.lep_permissibility is that table resolved against the Standard
 * Instrument's term hierarchy. Every leaf term gets a status per zone, and
 * `basis` says how it got it: listed explicitly, inherited from a group term
 * the plan lists, or caught by the "any other development not specified" line.
 * Group terms appear at level=parent with a status rolled up from their
 * children, which is why they are returned separately and never counted with
 * the leaves: a zone would otherwise count "industries" and every industry
 * under it.
 *
 * Neither table has a key or an index. lep_zones was loaded in document order,
 * so the lists are read back by ctid to keep it; a per-zone read is a full scan
 * of ~480k rows and comes back in under 100 ms.
 */

import { withNswClient } from '../utils/nsw-kg/pool'
import type {
  Basis, PlanSummary, ResolvedLeaf, ResolvedParent, Status, ZoneDetail, ZoneSummary,
} from '#shared/lep-permissibility'

/**
 * The one plan that has a Land Use Table but no resolution is the Standard
 * Instrument itself, whose table is the template the others fill in. It has no
 * epi_name anywhere in the database.
 */
const FALLBACK_NAMES: Record<string, string> = {
  'epi-2006-155a': 'Standard Instrument (Local Environmental Plans) Order 2006',
}

/**
 * The order the Standard Instrument lists zone groups in. Older plans still use
 * E1–E4 for environmental zones, which this puts among the employment zones;
 * the zone name tells the two apart on the page.
 */
const ZONE_GROUP_ORDER = ['RU', 'R', 'E', 'B', 'MU', 'IN', 'SP', 'RE', 'C', 'W']

function zoneSortKey(code: string): [number, number, string] {
  const m = code.toUpperCase().match(/^([A-Z]+)(\d*)/)
  const group = m?.[1] ?? code
  const idx = ZONE_GROUP_ORDER.indexOf(group)
  return [idx === -1 ? ZONE_GROUP_ORDER.length : idx, Number(m?.[2] || 0), code]
}

function compareZones(a: { code: string }, b: { code: string }): number {
  const ka = zoneSortKey(a.code)
  const kb = zoneSortKey(b.code)
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
}

/** "inherited:agriculture > agritourism (prohibited)" → its two parts. */
function parseResolvedAgainst(raw: string | null): ResolvedLeaf['resolvedAgainst'] {
  if (!raw) return null
  const m = raw.match(/^inherited:(.+?)\s*\((\w+)\)\s*$/)
  if (!m) return null
  return { chain: m[1]!.trim(), status: m[2] as Status }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const epi = String(query.epi ?? '').trim()
  const name = String(query.name ?? '').trim()
  const zone = String(query.zone ?? '').trim()
  const code = String(query.code ?? '').trim()
  setHeader(event, 'cache-control', 'public, max-age=600')

  if (!epi && !name) return listPlans()

  const epicode = epi || await resolvePlan(name)
  if (!epicode) {
    return { ok: false as const, reason: 'unknown_plan' as const, message: `No Land Use Table for a plan named "${name}".` }
  }

  if (!zone && !code) return listZones(epicode)

  const zoneId = zone || await resolveZone(epicode, code)
  if (!zoneId) {
    return { ok: false as const, reason: 'unknown_zone' as const, message: `No zone ${code} in ${epicode}.` }
  }

  return zoneDetail(epicode, zoneId)
})

// ── By name and code ───────────────────────────────────────────────────────
//
// A property record carries the plan's title and the zone's code, not the
// epicode and zone id the tables are keyed by, so the report looks a zone up
// the way the record names it: ?name=Hornsby Local Environmental Plan 2013&code=R2.

async function resolvePlan(name: string): Promise<string | null> {
  const res = await withNswClient(client => client.query<{ epicode: string }>(
    `SELECT epicode FROM nsw.lep_permissibility WHERE lower(epi_name) = lower($1) LIMIT 1`,
    [name],
  ))
  return res.rows[0]?.epicode ?? null
}

/**
 * Two plans define a zone inside an incorporated clause as well as in the
 * standard table, with a `pt-inc` id beside the `pt-cg1` one; the standard
 * table sorts first and is the one taken.
 */
async function resolveZone(epicode: string, code: string): Promise<string | null> {
  const res = await withNswClient(client => client.query<{ zone_id: string }>(
    `SELECT zone_id FROM nsw.lep_zones
     WHERE epicode = $1 AND upper(zone_code) = upper($2)
     ORDER BY zone_id LIMIT 1`,
    [epicode, code],
  ))
  return res.rows[0]?.zone_id ?? null
}

// ── Every plan ─────────────────────────────────────────────────────────────

async function listPlans() {
  const rows = await withNswClient(client => client.query<{
    epicode: string, epi_name: string | null, zone_count: number
  }>(
    `SELECT z.epicode, p.epi_name, count(DISTINCT z.zone_id)::int AS zone_count
     FROM nsw.lep_zones z
     LEFT JOIN (SELECT DISTINCT epicode, epi_name FROM nsw.lep_permissibility) p USING (epicode)
     GROUP BY z.epicode, p.epi_name`,
  ))

  const plans: PlanSummary[] = rows.rows.map(r => ({
    epicode: r.epicode,
    name: r.epi_name ?? FALLBACK_NAMES[r.epicode] ?? r.epicode,
    zoneCount: r.zone_count,
    resolved: r.epi_name !== null,
  }))
  plans.sort((a, b) => a.name.localeCompare(b.name))

  return { ok: true as const, planCount: plans.length, plans }
}

// ── One plan's zones ───────────────────────────────────────────────────────

async function listZones(epicode: string) {
  const { name, rows } = await withNswClient(async (client) => {
    const nameRes = await client.query<{ epi_name: string }>(
      `SELECT epi_name FROM nsw.lep_permissibility WHERE epicode = $1 LIMIT 1`, [epicode],
    )
    const zones = await client.query<{
      zone_id: string, zone_code: string, zone_name: string,
      raw_without: number, raw_with: number, raw_prohibited: number, objectives: number,
      res_without: number | null, res_with: number | null, res_prohibited: number | null, res_total: number | null,
    }>(
      `WITH raw AS (
         SELECT zone_id, zone_code, zone_name,
                count(*) FILTER (WHERE land_use_category = 'Permitted Without Consent')::int AS raw_without,
                count(*) FILTER (WHERE land_use_category = 'Permitted With Consent')::int    AS raw_with,
                count(*) FILTER (WHERE land_use_category = 'Prohibited')::int                AS raw_prohibited,
                count(*) FILTER (WHERE land_use_type = 'Objective')::int                     AS objectives
         FROM nsw.lep_zones
         WHERE epicode = $1
         GROUP BY zone_id, zone_code, zone_name
       ),
       res AS (
         SELECT zone_id,
                count(*) FILTER (WHERE status = 'permitted_without_consent')::int AS res_without,
                count(*) FILTER (WHERE status = 'permitted_with_consent')::int    AS res_with,
                count(*) FILTER (WHERE status = 'prohibited')::int                AS res_prohibited,
                count(*)::int                                                     AS res_total
         FROM nsw.lep_permissibility
         WHERE epicode = $1 AND level <> 'parent'
         GROUP BY zone_id
       )
       SELECT raw.*, res.res_without, res.res_with, res.res_prohibited, res.res_total
       FROM raw LEFT JOIN res USING (zone_id)`,
      [epicode],
    )
    return { name: nameRes.rows[0]?.epi_name ?? null, rows: zones.rows }
  })

  if (!rows.length) {
    return { ok: false as const, reason: 'unknown_plan', message: `No Land Use Table for "${epicode}".` }
  }

  const zones: ZoneSummary[] = rows.map(r => ({
    zoneId: r.zone_id,
    code: r.zone_code,
    name: r.zone_name,
    raw: { withoutConsent: r.raw_without, withConsent: r.raw_with, prohibited: r.raw_prohibited, objectives: r.objectives },
    resolved: {
      withoutConsent: r.res_without ?? 0,
      withConsent: r.res_with ?? 0,
      prohibited: r.res_prohibited ?? 0,
      total: r.res_total ?? 0,
    },
  }))
  zones.sort(compareZones)

  return {
    ok: true as const,
    epicode,
    name: name ?? FALLBACK_NAMES[epicode] ?? epicode,
    resolved: name !== null,
    zones,
  }
}

// ── One zone in full ───────────────────────────────────────────────────────

/**
 * Whether the resolved table carries the parent-row columns the resolver
 * writes since 2026-09-14 (named_status, named_source_text). The copy in
 * this database lags the pipeline, so the page has to work either way:
 * without them every group term is reported by its roll-up alone.
 */
let namedColumnsPresent = false
async function hasNamedColumns(client: { query: (q: string) => Promise<{ rowCount: number | null }> }): Promise<boolean> {
  // Only a "yes" is remembered: the columns arrive when the table is copied in
  // under a running server, and a remembered "no" would hide them until restart.
  if (!namedColumnsPresent) {
    const res = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'nsw' AND table_name = 'lep_permissibility' AND column_name = 'named_status'`,
    )
    namedColumnsPresent = (res.rowCount ?? 0) > 0
  }
  return namedColumnsPresent
}

async function zoneDetail(epicode: string, zoneId: string) {
  const { raw, resolved } = await withNswClient(async (client) => {
    const namedCols = (await hasNamedColumns(client))
      ? 'named_status, named_source_text'
      : 'NULL::text AS named_status, NULL::text AS named_source_text'
    const raw = await client.query<{
      zone_code: string, zone_name: string,
      land_use_type: string, land_use_category: string, land_use_description: string,
    }>(
      `SELECT zone_code, zone_name, land_use_type, land_use_category, land_use_description
       FROM nsw.lep_zones
       WHERE epicode = $1 AND zone_id = $2
       ORDER BY ctid`,
      [epicode, zoneId],
    )
    const resolved = await client.query<{
      epi_name: string, land_use: string, level: string, status: Status, basis: Basis,
      inherit_depth: number | null, derived_from: string | null, resolved_against: string | null,
      source_text: string | null, run_id: string | null,
      named_status: Status | null, named_source_text: string | null,
    }>(
      `SELECT epi_name, land_use, level, status, basis, inherit_depth, derived_from,
              resolved_against, source_text, run_id, ${namedCols}
       FROM nsw.lep_permissibility
       WHERE epicode = $1 AND zone_id = $2
       ORDER BY land_use`,
      [epicode, zoneId],
    )
    return { raw: raw.rows, resolved: resolved.rows }
  })

  if (!raw.length) {
    return { ok: false as const, reason: 'unknown_zone', message: `No zone "${zoneId}" in "${epicode}".` }
  }

  const objectives: string[] = []
  const withoutConsent: string[] = []
  const withConsent: string[] = []
  const prohibited: string[] = []
  for (const r of raw) {
    const text = r.land_use_description
    if (r.land_use_type === 'Objective') objectives.push(text)
    else if (r.land_use_category === 'Permitted Without Consent') withoutConsent.push(text)
    else if (r.land_use_category === 'Permitted With Consent') withConsent.push(text)
    else if (r.land_use_category === 'Prohibited') prohibited.push(text)
  }

  const leaves: ResolvedLeaf[] = []
  const parents: ResolvedParent[] = []
  for (const r of resolved) {
    if (r.level === 'parent') {
      parents.push({
        use: r.land_use,
        status: r.status,
        namedStatus: r.named_status ?? null,
        namedSourceText: r.named_source_text ?? null,
      })
      continue
    }
    leaves.push({
      use: r.land_use,
      status: r.status,
      basis: r.basis,
      depth: r.inherit_depth ?? 0,
      derivedFrom: r.derived_from,
      sourceText: r.source_text,
      resolvedAgainst: parseResolvedAgainst(r.resolved_against),
    })
  }

  const out: ZoneDetail = {
    ok: true,
    epicode,
    name: resolved[0]?.epi_name ?? FALLBACK_NAMES[epicode] ?? epicode,
    zone: { zoneId, code: raw[0]!.zone_code, name: raw[0]!.zone_name },
    objectives,
    raw: { withoutConsent, withConsent, prohibited },
    resolved: {
      runId: resolved[0]?.run_id ?? null,
      leaves,
      parents,
    },
  }
  return out
}
