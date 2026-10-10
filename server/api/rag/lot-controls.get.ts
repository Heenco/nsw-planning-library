/**
 * GET /api/rag/lot-controls?cadid= - what side D (the rag engine, no model) holds about one lot: the plan that governs it
 * and why, the map figures over the whole lot (split where the map splits it), every map area the lot is in with the
 * clauses that govern that area (rag.area_clause - directly, or through the frame above them), and what the build could
 * not tie together for those areas or clauses (rag.coverage), including clauses changed since the text and maps amended
 * after it. The same lot facts (shared/rag/lot-facts.ts) and index the question bank and /api/rag/answer read.
 */
import { ragLotFacts } from '#shared/rag/lot-facts'
import { lepFor } from '#shared/rag/evaluate'
import { labelOf, urlOf } from '#shared/rag/refs'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!/^\d+$/.test(cadid)) throw createError({ statusCode: 400, statusMessage: 'cadid is required (digits)' })
  const q = async (sql: string, p: unknown[] = []) => (await ragQuery(sql, p)).rows
  const E = await ragEngine()
  const lot: any = await ragLotFacts(ragQuery as any, cadid).catch((e: any) => { throw createError({ statusCode: 404, statusMessage: String(e?.message ?? e).slice(0, 200) }) })
  const lep = lepFor(E, lot)
  const docs = new Set(E.insts.filter(i => i.kind !== 'lep' || i.document_id === lep.doc).map(i => i.document_id))
  const mapped = (Array.isArray(lot.mapped) ? lot.mapped : []).filter((m: any) => !m.document_id || docs.has(m.document_id))

  // the clauses that govern each area the lot is in
  const keys = mapped.map((m: any) => `${m.document_id}|${String(m.map).toLowerCase().replace(/ map$/, '')}|${m.label}`)
  const rows = keys.length ? await q(`SELECT a.document_id::text AS d, a.map, a.label, a.role, a.via_frame, a.claim_kind, p.id AS provision_id, p.local_id, coalesce(p.path, '{}') path, p.heading,
                                              i.title, i.kind AS doc_kind, i.source_url
                                         FROM rag.area_clause a JOIN rag.provision p ON p.id = a.provision_id JOIN rag.instrument i ON i.document_id = a.document_id
                                        WHERE (a.document_id::text || '|' || a.map || '|' || a.label) = ANY($1) ORDER BY a.map, a.label, a.via_frame, p.sort`, [keys]) : []
  const cov = await q(`SELECT c.document_id::text AS d, c.check_kind, c.map, c.label, c.source, c.note, p.id::text AS provision_id
                         FROM rag.coverage c LEFT JOIN rag.provision p ON p.id = c.provision_id WHERE c.document_id::text = ANY($1)`, [[...docs]])
  const areas = mapped.map((m: any) => {
    const map = String(m.map).toLowerCase().replace(/ map$/, ''), mine = rows.filter(r => r.d === m.document_id && r.map === map && r.label === m.label)
    return {
      map, label: m.label, share: m.share, plan: E.insts.find(i => i.document_id === m.document_id)?.title ?? null,
      clauses: mine.map(r => ({ label: labelOf(r), url: urlOf(r.source_url, r.local_id), local_id: r.local_id, kind: r.claim_kind, role: r.role, via_frame: r.via_frame, provision_id: r.provision_id })),
      gaps: cov.filter(c => c.d === m.document_id && c.map === map && (c.label === m.label || c.label == null)).map(c => ({ check: c.check_kind, note: c.note, source: c.source })),
    }
  })
  // the areas a clause governs first; map labels no clause names (zone codes, map bands) after, without their gaps
  const governed = areas.filter((a: any) => a.clauses.length), other = areas.filter((a: any) => !a.clauses.length)
  const cited = new Set(governed.flatMap((a: any) => a.clauses.map((c: any) => c.provision_id)))
  const changed = cov.filter(c => c.check_kind === 'text_changed_since').map(c => ({ ...c, cited: c.provision_id ? cited.has(c.provision_id) : false }))
  return {
    cadid, address: lot.address, lot: lot.lot, zone: lot.zone, area_m2: lot.area_m2, frontage_m: lot.frontage_m,
    plan: { title: E.insts.find(i => i.document_id === lep.doc)?.title ?? null, why: lep.why },
    figures: { height_map_m: lot.height_map_m, fsr_map: lot.fsr_map, lot_size_map_m2: lot.lot_size_map_m2, map_split: lot.map_split ?? null },
    areas: governed, otherLabels: other.map((a: any) => ({ map: a.map, label: a.label, share: a.share, gaps: a.gaps.filter((g: any) => g.check === 'area_no_clause') })),
    currency: {
      clausesChanged: changed.filter(c => c.cited).map(c => ({ note: c.note, source: c.source })),
      planClausesChanged: changed.length,
      mapsAmendedAfterText: cov.filter(c => c.check_kind === 'map_newer_than_text' && governed.concat(other).some((a: any) => a.map === c.map)).map(c => ({ map: c.map, source: c.source, note: c.note })),
    },
    ms: Date.now() - started,
  }
})
