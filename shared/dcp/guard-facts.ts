/**
 * The DCP guard resolvers — one place, used by both the pipeline script (scripts/dcp-controls/resolve.ts)
 * and the live engine (shared/rag/lot-facts.ts). Two copies of this would drift, and the drift would be
 * invisible: the script would report a lot as fronting a designated road and the report would not.
 *
 * A DCP binds its controls to facts the LEP tier never needed — which road class the lot fronts, which
 * suburb it is in, whether a named address matches. Those arrive as scope terms shaped `<guard>:<literal>`,
 * a namespace that cannot collide with the rag engine's own prefixes (`lga:`, `map:`, `zone:`, `near:`,
 * `fact:`, `use:`) or with a bare nsw.scope_layer name.
 *
 * FAIL CLOSED. `holds: null` means the data cannot answer the guard, and the engine must leave the control
 * undecided rather than treat it as met. Every resolver here either answers or abstains; none guesses.
 */
export type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>

export interface GuardFact { holds: boolean | null; why: string }

export interface Resolver {
  /** the tables behind it, recorded on the binding so a wrong answer can be traced to a source */
  sources: string[]
  /** one row, one column `v`, given a cadid */
  sql: string
  /** what the engine should say about the answer's reliability */
  caveat?: string
}

/** A guard appears here only when a table can answer it for an arbitrary lot. */
export const RESOLVERS: Record<string, Resolver> = {
  zone: {
    sources: ['epi.epi_land_zoning'],
    sql: `SELECT z.sym_code v FROM cadastre.lot l JOIN epi.epi_land_zoning z ON ST_Intersects(z.geom, ST_Centroid(l.geom))
          WHERE l.cadid::text = $1 LIMIT 1`,
  },
  lot_area: {
    sources: ['derived.lot_frontage'],
    sql: `SELECT area_sqm::text v FROM derived.lot_frontage WHERE cadid::text = $1 LIMIT 1`,
  },
  frontage_length: {
    sources: ['derived.lot_frontage'],
    sql: `SELECT primary_frontage_length_m::text v FROM derived.lot_frontage WHERE cadid::text = $1 LIMIT 1`,
  },
  lot_width: {
    // lot width in every eligibility test is the primary frontage, not a width measured at the setback line
    sources: ['derived.lot_frontage'],
    sql: `SELECT primary_frontage_length_m::text v FROM derived.lot_frontage WHERE cadid::text = $1 LIMIT 1`,
    caveat: 'lot width is read as the primary frontage length',
  },
  is_corner: {
    sources: ['derived.lot_frontage'],
    sql: `SELECT is_corner_lot::text v FROM derived.lot_frontage WHERE cadid::text = $1 LIMIT 1`,
  },
  locality: {
    sources: ['derived.lot_address'],
    sql: `SELECT suburb v FROM derived.lot_address WHERE cadid::text = $1 AND suburb IS NOT NULL LIMIT 1`,
  },
  road_name: {
    sources: ['derived.lot_frontage_run'],
    sql: `SELECT string_agg(DISTINCT road_name, ' | ') v FROM derived.lot_frontage_run
          WHERE cadid::text = $1 AND road_name IS NOT NULL`,
  },
  frontage_road_class: {
    sources: ['dcp.designated_road', 'derived.lot_frontage_run', 'derived.lot_address'],
    // Designated when a frontage road is on the list of the plan that governs THIS lot's council.
    // Without the LGA scope every Boundary Road in NSW matches Hornsby's designated Boundary Road.
    sql: `SELECT CASE WHEN EXISTS (
            SELECT 1
              FROM derived.lot_frontage_run f
              JOIN derived.lot_address  a   ON a.cadid = f.cadid
              JOIN nsw.document         doc ON upper(doc.lga_name) = upper(a.lga_name) AND doc.doc_type = 'dcp'
              JOIN dcp.designated_road  d   ON d.document_id = doc.id
                                           AND d.road_name_norm = upper(f.road_name)
             WHERE f.cadid::text = $1
          ) THEN 'designated' ELSE 'local' END v`,
    caveat: 'name-only match within the LGA; From/To extents are not geometry yet',
  },
  heritage: {
    sources: ['epi.epi_heritage'],
    sql: `SELECT (count(*) > 0)::text v FROM cadastre.lot l JOIN epi.epi_heritage h ON ST_Intersects(h.geom, l.geom)
          WHERE l.cadid::text = $1`,
  },
  heritage_area: {
    sources: ['epi.epi_heritage'],
    sql: `SELECT string_agg(DISTINCT h.h_name, ' | ') v FROM cadastre.lot l JOIN epi.epi_heritage h ON ST_Intersects(h.geom, l.geom)
          WHERE l.cadid::text = $1 AND h.h_name IS NOT NULL`,
  },
  site_ref: {
    sources: ['derived.lot_address'],
    sql: `SELECT string_agg(DISTINCT formatted_address, ' | ') v FROM derived.lot_address WHERE cadid::text = $1`,
    caveat: 'the plan writes compound site references; the literal needs splitting and range expansion',
  },
}

/** A scope term this module owns, e.g. `frontage_road_class:designated roads`. */
export const isGuardTerm = (t: string): boolean => {
  const i = t.indexOf(':')
  return i > 0 && Object.prototype.hasOwnProperty.call(RESOLVERS, t.slice(0, i))
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Does the lot's fact satisfy the plan's literal? The two are written by different authors — the plan says
 * "local roads", the resolver says "local" — so the comparison is deliberately loose in ONE direction only:
 * either side may contain the other, after dropping a trailing plural. It never treats "no answer" as a match.
 */
export function matches(fact: string, literal: string): boolean {
  const f = squash(fact), l = squash(literal)
  if (!l || l === 'any') return true
  const depl = (x: string) => x.replace(/s$/, '')
  return f.split(' | ').some(part => {
    const p = squash(part)
    return p === l || p.includes(l) || l.includes(p) || depl(p) === depl(l) || l.includes(depl(p)) || p.includes(depl(l))
  })
}

/**
 * Answer every `<guard>:<literal>` term for one lot. Terms whose guard has no resolver, and terms whose
 * resolver returns nothing, come back `holds: null` — the engine reads that as "cannot say".
 */
export async function dcpGuardFacts(q: Query, cadid: string, terms: string[]): Promise<Record<string, GuardFact>> {
  const out: Record<string, GuardFact> = {}
  const wanted = terms.filter(isGuardTerm)
  if (!wanted.length) return out

  // one query per distinct guard, not per term: a document can bind twenty literals to one guard
  const byGuard = new Map<string, string[]>()
  for (const t of wanted) {
    const g = t.slice(0, t.indexOf(':'))
    byGuard.set(g, [...(byGuard.get(g) ?? []), t])
  }

  for (const [guard, ts] of byGuard) {
    const r = RESOLVERS[guard]!
    let fact: string | null = null, failed: string | null = null
    try { fact = (await q(r.sql, [cadid])).rows[0]?.v ?? null }
    catch (e) { failed = String((e as Error).message).slice(0, 80) }
    for (const t of ts) {
      const literal = t.slice(t.indexOf(':') + 1)
      if (failed) { out[t] = { holds: null, why: `${guard}: query failed (${failed})` }; continue }
      if (fact == null) { out[t] = { holds: null, why: `${guard}: no data for this lot` }; continue }
      const holds = matches(fact, literal)
      out[t] = {
        holds,
        why: `${guard} is ${fact}${holds ? '' : `, not ${literal}`}${r.caveat ? ` — ${r.caveat}` : ''}`,
      }
    }
  }
  return out
}
