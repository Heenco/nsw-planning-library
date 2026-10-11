/**
 * GET /api/report/additional-controls?cadid= - the LEP maps' Additional Controls the lot sits in (epi.additional_controls),
 * each with what the plan says for that area, for /report-2.
 *
 * An additional control is a mapped area ("Area 5" on the Floor Space Ratio Map) that a clause gives its own standard, in
 * place of or on top of the map's base value. The row names the area and, mostly, the clause ("Clause 4.4 2B (c)"); it
 * rarely carries the figure. The figure is in the clause, so for a plan the library holds (nsw.document by title, its text
 * in nsw.section) the provisions that name the area on that map are read and quoted, with the paragraph they hang from for
 * context. A plan the library does not hold is said to be not held, never guessed.
 *
 * The test is the lot shrunk by 10 cm, as everywhere on /report-2, so an area that only shares the lot's edge drops out.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

const MAPS: Record<string, { map: string; control: string }> = {
  AdditionalControls_FSR: { map: 'Floor Space Ratio Map', control: 'Floor space ratio' },
  AdditionalControls_HOB: { map: 'Height of Buildings Map', control: 'Building height' },
  AdditionalControls_LotSize: { map: 'Lot Size Map', control: 'Minimum lot size' },
  AdditionalControls_LZN: { map: 'Land Zoning Map', control: 'Land zoning' },
}

export interface AcProvision { localId: string; heading: string | null; text: string; stem: string | null; url: string | null }
export interface AdditionalControl {
  source: string
  control: string
  map: string
  plan: string
  /** The map's own label for the area, and the area name the clause uses ("Area 5"). */
  label: string
  area: string | null
  /** The clause the map cites, as written ("Clause 4.4 2B (c)"), and its link. */
  clause: string | null
  clauseUrl: string | null
  value: string | null
  amendment: string | null
  coverPct: number
  /** The plan's provisions that name this area on this map; empty when none are found or the plan is not held. */
  provisions: AcProvision[]
  planHeld: boolean
  /** Where the quote comes from: the RAG (rag.provision) where it holds the plan, else the nsw library. */
  engine?: 'rag' | 'nsw' | null
  /** What the RAG reads in that clause - frames, permits, standards - when engine is 'rag'. */
  claims?: AcClaim[]
  /** Whether the RAG's own map polygons put the lot in this area (null when not asked). */
  ragSeesLot?: boolean | null
  /** The EPI layer the row came from, so the page can tell which of its generic constraints this one resolves. */
  layer?: string
  /** The row's own names - area, label, category - matched against the plans' words (internal; not sent). */
  match?: string[]
}
export interface AcClaim { localId: string; kind: string; consent: string | null; uses: string[]; topic: string | null; value: number | null; unit: string | null; terms: string[]; span: string | null }

/** "AREA 1" / "Area 2 – Refer to Subclause 6.9" -> "Area 2"; "Locality 6" stays; free labels have no area. */
const areaOf = (label: string | null, legisArea: string | null): string | null => {
  const m = String(legisArea || label || '').match(/^\s*((?:area|locality|precinct|site)\s*[0-9a-z]{1,3})\b/i)
  return m ? m[1]!.replace(/\s+/g, ' ').replace(/^(\w)(\w*)/, (_, a, b) => a.toUpperCase() + b.toLowerCase()) : null
}
/** "Clause 4.4 2B (c)", "Clause 4.3(2C)", "Refer to Subclause 6.9" -> "4.4", "4.3", "6.9". */
const clauseNo = (s: string | null): string | null => s?.match(/(?:clause|subclause)\s*(\d+\.\d+[A-Z]*)/i)?.[1] ?? null

export default defineEventHandler(async (event): Promise<{ controls: AdditionalControl[]; ms: number }> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  setHeader(event, 'cache-control', 'public, max-age=60')

  /*
   * TWO SOURCES, ONE LIST. The EPI dump already carries most additional controls as polygons stacked in the base tables -
   * marked by legis_ref_area, a label starting "Area", or the zone code CA (about 97% of the FSR areas, 92% of height, 87%
   * of lot size, but only 17% of zoning). epi.additional_controls is the complete copy of the same areas. Both are read
   * and folded into one row per plan, map and area, so nothing either holds is lost and nothing shows twice; the
   * additional_controls row wins where both have it, as it is the fuller record.
   */
  const LOT_SQL = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
      t AS MATERIALIZED (
        SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g, ST_Area(ST_Transform(g0, 3308)) AS area_m2
          FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)`
  const COVER = `100 * ST_Area(ST_Transform(ST_Union(ST_Intersection(ST_ClipByBox2D(a.geom, ST_Envelope(t.g)), t.g)), 3308)) / NULLIF(max(t.area_m2), 0)`
  const base = (source: string, table: string) => `
    SELECT '${source}'::text AS source, a.epi_name::text, a.map_name::text, a.label::text, a.legis_ref_area::text AS legis_area,
           a.legis_ref_clause::text AS legis_clause, a.legis_ref_value::text AS legis_value, a.amendment::text, ${COVER} AS cover_pct
      FROM epi.${table} a, t
     WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g)
       AND (nullif(a.legis_ref_area::text, '<Null>') IS NOT NULL OR a.label::text ~* '^area\\M' OR a.sym_code::text = 'CA')
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`
  const all = (await nswQuery<any>(`${LOT_SQL}
    SELECT a.source, a.epi_name, a.map_name, a.label, a.legis_area, a.legis_clause, a.legis_value, a.amendment, ${COVER} AS cover_pct
      FROM epi.additional_controls a, t
     WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g)
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    UNION ALL ${base('AdditionalControls_FSR', 'epi_floor_space_ratio')}
    UNION ALL ${base('AdditionalControls_HOB', 'epi_height_of_building')}
    UNION ALL ${base('AdditionalControls_LotSize', 'epi_lot_size')}
    UNION ALL ${base('AdditionalControls_LZN', 'epi_land_zoning')}`, [cadid])).rows.filter((r: any) => Number(r.cover_pct) > 0.05)
  // one row per plan, map and area; the first source read (additional_controls) wins
  const seen = new Set<string>()
  const hits = all.filter((r: any) => {
    const k = `${String(r.epi_name).toLowerCase()}|${r.source}|${(areaOf(r.label, r.legis_area) ?? r.label ?? '').toLowerCase()}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const plans = [...new Set(hits.map((h: any) => String(h.epi_name)))]
  const docs = plans.length ? (await nswQuery<any>(`SELECT id, title, source_url FROM nsw.document WHERE title = ANY($1)`, [plans])).rows : []
  const docOf = new Map(docs.map((d: any) => [d.title, d]))

  const controls: AdditionalControl[] = []
  for (const h of hits) {
    const kind = MAPS[h.source] ?? { map: h.map_name ?? '', control: h.map_name ?? 'Additional control' }
    const area = areaOf(h.label, h.legis_area)
    const cited = clauseNo(h.legis_clause) ?? clauseNo(h.label)
    const doc = docOf.get(h.epi_name)
    const url = (local: string) => (doc?.source_url ? `${doc.source_url}#${local}` : null)
    let provisions: AcProvision[] = []
    if (doc && (area || cited)) {
      // the provisions that name the area (as a whole word, so "Area 1" is not "Area 10") and the map, in the cited clause
      // when there is one; with no area to look for, the cited clause itself
      const rows = (await nswQuery<any>(`
        SELECT s.local_id, s.heading, left(regexp_replace(concat_ws(' ', s.raw_text, (SELECT string_agg(c.raw_text, ' ' ORDER BY c.sort_order) FROM nsw.section c WHERE c.document_id = s.document_id AND c.local_id LIKE s.local_id || '-%')), '\\s+', ' ', 'g'), 1600) AS text,
               (SELECT left(regexp_replace(p.raw_text, '\\s+', ' ', 'g'), 400) FROM nsw.section p WHERE p.id = s.parent_id) AS stem
          FROM nsw.section s
         WHERE s.document_id = $1
           AND ($2::text IS NULL OR s.raw_text ~* ('\\m' || $2 || '\\M'))
           AND ($3::text IS NULL OR s.local_id = 'sec.' || $3 OR s.local_id LIKE 'sec.' || $3 || '-%')
           AND ($2::text IS NULL OR $3::text IS NOT NULL OR s.raw_text ILIKE '%' || $4 || '%')
         ORDER BY s.sort_order
         LIMIT 6`, [doc.id, area, cited, kind.map])).rows
      // a cited clause that never names the area (or a label with no area): its own words are still the control
      const got = rows.length ? rows : cited ? (await nswQuery<any>(`
        SELECT s.local_id, s.heading, left(regexp_replace(concat_ws(' ', s.raw_text, (SELECT string_agg(c.raw_text, ' ' ORDER BY c.sort_order) FROM nsw.section c WHERE c.document_id = s.document_id AND c.local_id LIKE s.local_id || '-%')), '\\s+', ' ', 'g'), 1600) AS text, NULL AS stem
          FROM nsw.section s WHERE s.document_id = $1 AND s.local_id = 'sec.' || $2 LIMIT 1`, [doc.id, cited])).rows : []
      provisions = got.filter((r: any) => !got.some((q: any) => q !== r && r.local_id.startsWith(`${q.local_id}-`))).map((r: any) => ({ localId: r.local_id, heading: r.heading ?? null, text: r.text ?? '', stem: r.stem ?? null, url: url(r.local_id) }))
    }
    controls.push({
      source: h.source, control: kind.control, map: kind.map, plan: h.epi_name, label: h.label ?? h.legis_area ?? '', area,
      clause: h.legis_clause ?? null, clauseUrl: cited ? url(`sec.${cited}`) : null, value: h.legis_value ?? null, amendment: h.amendment ?? null,
      coverPct: Math.min(100, Number(h.cover_pct)), provisions, planHeld: !!doc,
    })
  }
  /*
   * ADDITIONAL PERMITTED USES. The map only marks the land; what it permits is the Schedule 1 item (by cl 2.5) that names
   * it - by area ("Area 10" on the Additional Permitted Uses Map) or, where the map's label is the item itself ("33",
   * "Sch 1.27"), by number. The whole item is quoted: its heading, the land it applies to, and what is permitted.
   */
  const apu = (await nswQuery<any>(`${LOT_SQL}
    SELECT a.epi_name::text, a.label::text, a.lay_class::text, a.legis_ref_clause::text AS legis_clause, a.amendment::text, ${COVER} AS cover_pct
      FROM epi.epi_additional_permitted_uses a, t
     WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g)
     GROUP BY 1, 2, 3, 4, 5`, [cadid])).rows.filter((r: any) => Number(r.cover_pct) > 0.05)
  const apuPlans = [...new Set(apu.map((r: any) => String(r.epi_name)))].filter(x => !docOf.has(x))
  if (apuPlans.length) for (const d of (await nswQuery<any>(`SELECT id, title, source_url FROM nsw.document WHERE title = ANY($1)`, [apuPlans])).rows) docOf.set(d.title, d)
  for (const h of apu) {
    const label = String(h.label ?? '').trim()
    const area = areaOf(label, null)
    const item = !area ? label.match(/^(?:sch(?:edule)?\s*1[.\s-]*)?(\d+[A-Z]?)$/i)?.[1] ?? null : null
    const doc = docOf.get(h.epi_name)
    const url = (local: string) => (doc?.source_url ? `${doc.source_url}#${local}` : null)
    let root: string | null = null
    if (doc && area) {
      const hit = (await nswQuery<any>(`SELECT s.local_id FROM nsw.section s WHERE s.document_id = $1 AND s.local_id LIKE 'sch.1-%'
          AND s.raw_text ~* ('\\m' || $2 || '\\M') AND s.raw_text ILIKE '%Additional Permitted Uses Map%' ORDER BY s.sort_order LIMIT 1`, [doc.id, area])).rows[0]
      root = hit ? String(hit.local_id).match(/^sch\.1-sec\.[^-]+/)?.[0] ?? null : null
    } else if (doc && item) root = `sch.1-sec.${item}`
    let provisions: AcProvision[] = []
    if (doc && root) {
      provisions = (await nswQuery<any>(`
        SELECT s.local_id, s.heading,
               left(regexp_replace(concat_ws(' ', s.raw_text, (SELECT string_agg(c.raw_text, ' ' ORDER BY c.sort_order) FROM nsw.section c
                 WHERE c.document_id = s.document_id AND c.local_id LIKE s.local_id || '-%')), '\\s+', ' ', 'g'), 1600) AS text
          FROM nsw.section s WHERE s.document_id = $1 AND s.local_id = $2`, [doc.id, root])).rows
        .map((r: any) => ({ localId: r.local_id, heading: r.heading ?? null, text: r.text ?? '', stem: null, url: url(r.local_id) }))
    }
    controls.push({
      source: 'AdditionalPermittedUses', control: 'Additional permitted use', map: 'Additional Permitted Uses Map', plan: h.epi_name,
      label, area, clause: root ? `Schedule 1, item ${root.replace('sch.1-sec.', '')} (cl 2.5)` : (h.legis_clause ?? 'Clause 2.5, Schedule 1'),
      clauseUrl: root ? url(root) : null, value: null, amendment: h.amendment ?? null,
      coverPct: Math.min(100, Number(h.cover_pct)), provisions, planHeld: !!doc,
    })
  }
  /*
   * LOCAL AND SPECIAL PROVISIONS. Maps of their own (Dual Occupancy Prohibition, Additional Local Provisions, Key Sites,
   * Incentive FSR, a SEPP's Special Provisions Area ...) that a clause gives a rule. Each row is matched to that clause the
   * same way as an area: by its map and its own names - the area, the label, the category - against the plan's words.
   * A row joins the list only when a clause is found; the rest stay in the page's other mapped constraints, unchanged.
   */
  const local = (await nswQuery<any>(`${LOT_SQL}
    SELECT 'epi_local_provisions'::text AS layer, a.epi_name::text, a.map_name::text, a.lay_name::text, a.lay_class::text, a.label::text,
           a.legis_ref_area::text AS legis_area, a.legis_ref_clause::text AS legis_clause, a.amendment::text, ${COVER} AS cover_pct
      FROM epi.epi_local_provisions a, t WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g) GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
    UNION ALL
    SELECT 'epi_special_provision'::text, a.epi_name::text, a.map_name::text, a.lay_name::text, a.lay_class::text, a.label::text,
           a.legis_ref_area::text, a.legis_ref_clause::text, a.amendment::text, ${COVER}
      FROM epi.epi_special_provision a, t WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g) GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`, [cadid]))
    .rows.filter((r: any) => Number(r.cover_pct) > 0.05)
  const clean = (v: unknown) => { const s = v == null ? '' : String(v).trim(); return s && s !== '<Null>' ? s : null }
  const morePlans = [...new Set(local.map((r: any) => String(r.epi_name)))].filter(x => !docOf.has(x))
  if (morePlans.length) for (const d of (await nswQuery<any>(`SELECT id, title, source_url FROM nsw.document WHERE title = ANY($1)`, [morePlans])).rows) docOf.set(d.title, d)
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const h of local) {
    const map = clean(h.map_name)
    if (!map) continue
    // names that can identify the land: an area, a word label (a lone map code like "D" is not one), the category
    const label = clean(h.label), cls = clean(h.lay_class), area = areaOf(h.label, h.legis_area)
    // a map code of two or more characters ("N1", "Y2") names the land too; a single letter or digit is too short to search
    const match = [...new Set([area, clean(h.legis_area), label && label.length >= 2 && !clauseNo(label) ? label : null, cls && !/^[\d.]+$/.test(cls) && !clauseNo(cls) ? cls : null].filter(Boolean) as string[])]
    // the clause may sit in the reference column, or be the label itself ("Clause 7.26" on Parramatta's map)
    const cited = clauseNo(h.legis_clause) ?? clauseNo(h.label) ?? clauseNo(h.lay_class)
    const doc = docOf.get(h.epi_name)
    const url = (l: string) => (doc?.source_url ? `${doc.source_url}#${l}` : null)
    let provisions: AcProvision[] = []
    if (doc) {
      let rows: any[] = []
      for (const nm of match) {
        rows = (await nswQuery<any>(`
          SELECT s.local_id, s.heading, left(regexp_replace(concat_ws(' ', s.raw_text, (SELECT string_agg(c.raw_text, ' ' ORDER BY c.sort_order) FROM nsw.section c WHERE c.document_id = s.document_id AND c.local_id LIKE s.local_id || '-%')), '\\s+', ' ', 'g'), 1600) AS text,
                 (SELECT left(regexp_replace(p.raw_text, '\\s+', ' ', 'g'), 400) FROM nsw.section p WHERE p.id = s.parent_id) AS stem
            FROM nsw.section s
           WHERE s.document_id = $1 AND s.raw_text ~* $2 AND s.raw_text ILIKE '%' || $3 || '%'
           ORDER BY s.sort_order LIMIT 4`, [doc.id, `(^|[^a-z0-9])${escRe(nm)}([^a-z0-9]|$)`, map])).rows
        if (rows.length) break
      }
      if (!rows.length && cited) rows = (await nswQuery<any>(`
        SELECT s.local_id, s.heading, left(regexp_replace(concat_ws(' ', s.raw_text, (SELECT string_agg(c.raw_text, ' ' ORDER BY c.sort_order) FROM nsw.section c WHERE c.document_id = s.document_id AND c.local_id LIKE s.local_id || '-%')), '\\s+', ' ', 'g'), 1600) AS text, NULL AS stem
          FROM nsw.section s WHERE s.document_id = $1 AND s.local_id = 'sec.' || $2 LIMIT 1`, [doc.id, cited])).rows
      // the Dictionary names land but sets no rule for it
      rows = rows.filter((r: any) => !/^dict/.test(r.local_id))
      provisions = rows.filter((r: any) => !rows.some((q: any) => q !== r && r.local_id.startsWith(`${q.local_id}-`)))
        .map((r: any) => ({ localId: r.local_id, heading: r.heading ?? null, text: r.text ?? '', stem: r.stem ?? null, url: url(r.local_id) }))
    }
    controls.push({
      source: h.layer, layer: h.layer, control: map.replace(/ Map$/, ''), map, plan: h.epi_name,
      label: label ?? cls ?? '', area: area ?? match[0] ?? null, match,
      clause: clean(h.legis_clause), clauseUrl: cited ? url(`sec.${cited}`) : provisions[0]?.url ?? null,
      // an incentive or alternative map whose category is the figure ("1.25", "16")
      value: cls && /^[\d.]+$/.test(cls) ? cls : null, amendment: clean(h.amendment),
      coverPct: Math.min(100, Number(h.cover_pct)), provisions, planHeld: !!doc,
    })
  }

  /*
   * THE RAG, WHERE IT HOLDS THE PLAN. Nothing here names a clause: the RAG's frame claims carry the land they apply to as a
   * term - "mapped:Area 10 on the Additional Permitted Uses Map" - built from the same area and map names the EPI row has,
   * so the clause an area belongs to is found by that term. Failing a frame, the RAG provisions that name the area on that
   * map; failing that, the clause the nsw pass found. Each is quoted from rag.provision with every claim the RAG reads in
   * it (what it permits, the standard it sets), and the RAG's own map polygons say whether the engine sees the lot there.
   * A plan the RAG does not hold keeps the nsw library's quote.
   */
  const ragInst = new Map((await nswQuery<any>(`SELECT document_id, title, source_url FROM rag.instrument`).catch(() => ({ rows: [] as any[] }))).rows
    .map((r: any) => [String(r.title), r]))
  const clauseRoot = (l: string) => l.match(/^(sch\.\d+-sec\.[^-]+|sec\.[^-]+)/)?.[1] ?? l
  for (const c of controls) {
    c.engine = c.planHeld ? 'nsw' : null
    const ri = ragInst.get(c.plan)
    if (!ri) continue
    const doc = ri.document_id
    const url = (l: string) => (ri.source_url ? `${ri.source_url}#${l}` : null)
    /*
     * The RAG's frames name land as "mapped:<what> on the <map>". A frame belongs to this row when its map is the row's map
     * and its <what> holds one of the row's own names (area, label, category) as a whole word - "Area 2 or Area 3" holds
     * "Area 3", "an Affordable Housing Contributions Area" holds the category. When none does but the plan uses the map in
     * exactly one clause, that clause is the one.
     */
    const names = (c.match?.length ? c.match : c.area ? [c.area] : []).filter(Boolean)
    const frames = (await nswQuery<any>(`
      SELECT DISTINCT p.local_id, x AS term FROM rag.claim cl JOIN rag.provision p ON p.id = cl.provision_id, unnest(cl.terms) x
       WHERE p.document_id = $1 AND lower(x) LIKE 'mapped:%' AND lower(x) LIKE '% on the ' || lower($2)`, [doc, c.map])).rows
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const holds = (what: string) => names.some(nm => new RegExp(`(^|[^a-z0-9])${esc(nm)}([^a-z0-9]|$)`, 'i').test(what))
    const whatOf = (term: string) => term.slice('mapped:'.length, term.toLowerCase().lastIndexOf(' on the '))
    let roots: string[] = frames.filter((f: any) => holds(whatOf(String(f.term)))).map((f: any) => clauseRoot(f.local_id))
    // only for a row with no name of its own (a lone map code): a named row whose name no frame holds is not that frame's
    if (!roots.length && !names.length) {
      const only = [...new Set(frames.map((f: any) => clauseRoot(f.local_id)))]
      if (only.length === 1) roots = only as string[]
    }
    let textHits: string[] = []
    for (const nm of roots.length ? [] : names) {
      textHits = (await nswQuery<any>(`
        SELECT p.local_id FROM rag.provision p
         WHERE p.document_id = $1 AND p.own_text ~* $2 AND p.own_text ILIKE '%' || $3 || '%'
         ORDER BY p.sort LIMIT 4`, [doc, `(^|[^a-z0-9])${esc(nm)}([^a-z0-9]|$)`, c.map])).rows.map((r: any) => r.local_id)
      if (textHits.length) break
    }
    const anchor = c.clauseUrl?.split('#')[1]
    if (!roots.length && !textHits.length && anchor) roots = [anchor]
    roots = [...new Set(roots)]
    // a definition in the Dictionary names the land but sets no rule for it
    const targets = (roots.length ? roots : textHits).filter(l => !/^dict/.test(l))
    if (!targets.length) continue
    const provs = (await nswQuery<any>(`
      SELECT p.local_id, p.heading,
             left(regexp_replace(concat_ws(' ', p.own_text, (SELECT string_agg(d.own_text, ' ' ORDER BY d.sort) FROM rag.provision d
               WHERE d.document_id = p.document_id AND d.local_id LIKE p.local_id || '-%' AND d.kind NOT IN ('cell', 'term'))), '\\s+', ' ', 'g'), 1800) AS text,
             (SELECT left(regexp_replace(pa.own_text, '\\s+', ' ', 'g'), 400) FROM rag.provision pa WHERE pa.id = p.parent_id) AS stem
        FROM rag.provision p WHERE p.document_id = $1 AND p.local_id = ANY($2) ORDER BY p.sort`, [doc, targets])).rows
    const claims = (await nswQuery<any>(`
      SELECT p.local_id, cl.kind, cl.consent, cl.uses, cl.topic, cl.value::float8 AS value, cl.unit, cl.terms, cl.span
        FROM rag.claim cl JOIN rag.provision p ON p.id = cl.provision_id
       WHERE p.document_id = $1 AND EXISTS (SELECT 1 FROM unnest($2::text[]) r WHERE p.local_id = r OR p.local_id LIKE r || '-%')
       ORDER BY p.sort`, [doc, targets])).rows
    const sees = c.area ? (await nswQuery<any>(`${LOT_SQL}
      SELECT EXISTS (SELECT 1 FROM rag.map_polygon m, t WHERE m.document_id = $2 AND m.map = lower(regexp_replace($3, ' Map$', ''))
        AND m.label = lower($4) AND ST_Intersects(m.geom, ST_Transform(t.g, ST_SRID(m.geom)))) AS s`, [cadid, doc, c.map, c.area])
      .catch(() => ({ rows: [{ s: null }] }))).rows[0]?.s ?? null : null
    // the RAG holds the clause but not its words (some clauses are held as structure only): keep the library's quote
    if (!provs.some((r: any) => String(r.text ?? '').trim()) && !claims.length) continue
    c.engine = 'rag'
    // a whole clause found by its frame carries no stem; a provision found by its words keeps the line it hangs from
    const ragProvs = provs.filter((r: any) => String(r.text ?? '').trim())
      .map((r: any) => ({ localId: r.local_id, heading: r.heading ?? null, text: r.text ?? '', stem: roots.length ? null : (r.stem ?? null), url: url(r.local_id) }))
    if (ragProvs.length) c.provisions = ragProvs
    c.claims = claims.map((r: any) => ({ localId: r.local_id, kind: r.kind, consent: r.consent ?? null, uses: r.uses ?? [], topic: r.topic ?? null,
      value: r.value ?? null, unit: r.unit ?? null, terms: r.terms ?? [], span: r.span ?? null }))
    c.ragSeesLot = sees
    if (!c.clauseUrl) c.clauseUrl = url(targets[0]!)
  }
  // a local or special provision row with no clause found stays among the page's other constraints
  const shown = controls.filter(c => !(c.layer && !c.provisions.length)).map(({ match, ...c }) => c)
  shown.sort((a, b) => a.control.localeCompare(b.control) || b.coverPct - a.coverPct)
  return { controls: shown, ms: Date.now() - started }
})
