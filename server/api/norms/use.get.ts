/**
 * GET /api/norms/use - can this land use be carried out on this lot, under the LEP AND the SEPPs?
 *
 *   ?cadid=102537951
 *   &site=secondary dwelling=no          (what the asker knows, same shape as /api/norms/subdivision)
 *
 * One tab per land use that a CDC type or a Pattern Book design turns on - the nine in
 * docs/permissible-use-by-type.md. For each:
 *
 *   answer      the Land Use Table, from the LEP and the SEPPs TOGETHER (shared/norms/facts.ts).
 *               /api/cdc/types and the Pattern Book already join both; what neither does is say
 *               what STANDARDS come with the answer, which is the whole reason this page exists.
 *   because     every instrument that spoke, named - a SEPP permission over an LEP prohibition is
 *               reported as both, never silently merged, because the two say different things.
 *   standards   the lot's own arithmetic against the plan's rules, through shared/norms/engine.ts -
 *               the same reading /subdivision shows, asked of a use instead of a subdivision.
 *
 * WHY NOT /api/norms/at. That route reads nsw.norm, and nsw.norm holds only the subdivision family
 * (324 norms, nothing for a use), so it answers no_permission for every land use on every lot. The
 * Land Use Table is the grant here; the graph's rules supply the standards.
 */
import { evaluate } from '#shared/norms/engine'
import { lotFacts, lotTerm, refHitsFor } from '#shared/norms/facts'
import { graphNorms } from '#shared/norms/from-graph'
import type { Cond, Norm, Question } from '#shared/norms/schema'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'

/**
 * The nine uses, and every spelling the two sources use for each.
 *
 * Straight from docs/permissible-use-by-type.md, which is the union of what the eleven CDC types
 * and the seven Pattern Book categories require. The duplicate spellings are a join detail:
 * nsw.lep_permissibility says "dual occupancies", nsw.sepp_permissible_landuse says "Dual
 * occupancy". Matching is lower-cased through landUseKey.
 */
const USES: { key: string; label: string; terms: string[]; inferred?: string; needs: string[] }[] = [
  { key: 'dual-occupancy', label: 'Dual occupancy',
    terms: ['dual occupancies', 'dual occupancies (attached)', 'dual occupancies (detached)',
            'dual occupancy', 'dual occupancy (attached)', 'dual occupancy (detached)'],
    needs: ['CDC: Dual occupancy', 'Pattern Book: Semis'] },
  { key: 'multi-dwelling-housing', label: 'Multi dwelling housing', terms: ['multi dwelling housing'],
    needs: ['CDC: Multi dwelling housing (terraces)', 'Pattern Book: Terraces, Row Homes'] },
  { key: 'secondary-dwelling', label: 'Secondary dwelling', terms: ['secondary dwellings', 'secondary dwelling'],
    needs: ['CDC: Secondary dwelling'] },
  { key: 'dwelling-house', label: 'Dwelling house', terms: ['dwelling houses', 'dwelling house'],
    needs: ['CDC: Dwelling houses, Rural housing, Inland dwelling houses, Greenfield housing'] },
  { key: 'residential-flat-building', label: 'Residential flat building', terms: ['residential flat buildings'],
    needs: ['Pattern Book: Small, Large and Corner Lot Apartments'] },
  { key: 'manor-house', label: 'Manor house', terms: ['residential flat buildings', 'multi dwelling housing'],
    inferred: '"manor house" is not one of the Standard Instrument\'s 203 terms. A manor house is three or four '
            + 'dwellings in one building, which the instruments reach through either form, so either satisfies it.',
    needs: ['CDC: Manor houses', 'Pattern Book: Manor Homes'] },
  { key: 'farm-building', label: 'Farm building', terms: ['farm buildings'], needs: ['CDC: Inland farm buildings'] },
  { key: 'agritourism', label: 'Agritourism', terms: ['agritourism'], needs: ['CDC: Agritourism'] },
  { key: 'farm-stay-accommodation', label: 'Farm stay accommodation', terms: ['farm stay accommodation'],
    needs: ['CDC: Farm stay accommodation'] },
]

const leaves = (c: Cond): any[] => 'all' in c ? c.all.flatMap(leaves) : 'any' in c ? c.any.flatMap(leaves) : 'not' in c ? leaves(c.not) : [c]
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = String(q.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const site: Record<string, boolean> = {}
  for (const part of String(q.site ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.lastIndexOf('=')
    if (i > 0) site[part.slice(0, i).trim()] = /^(yes|true|1)$/i.test(part.slice(i + 1).trim())
  }

  const q2 = (sql: string, p?: unknown[]) => nswQuery<any>(sql, p as any[])
  let lot
  try { lot = await lotFacts(q2, cadid, landUseKey) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }

  const lepDoc = (await q2(`SELECT id, title, instrument_slug FROM nsw.document WHERE title = $1 LIMIT 1`, [lot.epi ?? ''])).rows[0]
  /*
   * The clauses a land-use question can turn on.
   *
   * Part 4 is "Principal development standards" and binds development generally, so 4.1/4.3/4.4 are
   * in for every use. Beyond that, only clauses whose heading names the use itself - a height
   * control for dual occupancies is not a control on a farm building.
   */
  const wordsFor = (u: typeof USES[number]) =>
    [...new Set(u.terms.map(x => x.replace(/\s*\([^)]*\)\s*$/, '').replace(/ies$/, 'y').replace(/s$/, '')))]
  /*
   * THE WHOLE LEP, not a shortlist of clauses.
   *
   * This read 4.3, 4.4 and clauses whose heading named the use, which missed every local provision
   * in Part 6 and 7 - exactly where a council puts the controls that bite. The filter is now the
   * plan itself; a clause is handed to the use its HEADING names, and a clause naming no use binds
   * development generally and goes to every tab. One pass for all nine: graphNorms re-reads every
   * section and rule of the plan on each call, so nine calls was nine full scans per request.
   */
  const allWords = [...new Set(USES.flatMap(wordsFor))]
  const unionFilter = 'TRUE'

  const sources = Object.fromEntries((await q2(
    `SELECT DISTINCT ON (title) title, source_url FROM nsw.document WHERE source_url IS NOT NULL ORDER BY title, ingested_at DESC`)).rows
    .map((d: any) => [d.title, d.source_url]))
  const link = (instrument: string, section: string | undefined) => sources[instrument] && section ? `${sources[instrument]}#${section}` : null

  /*
   * The plan's clauses, read once, with each clause's heading so a norm can be handed to the use it
   * names. A clause that names no use (4.3, 4.4) belongs to every use; one that names a use belongs
   * only to that use - a height control for dual occupancies is not a control on a farm building.
   */
  const graph = lepDoc
    ? await graphNorms(q2, lepDoc.id, lepDoc.title, lepDoc.instrument_slug, { clauseFilter: unionFilter, covered: [], assumeKind: null })
    : null
  const headings = new Map<string, string>()
  if (lepDoc) for (const r of (await q2(
    `SELECT local_id, coalesce(heading, '') AS heading FROM nsw.section WHERE document_id = $1 AND level = 'clause'`,
    [lepDoc.id])).rows) headings.set(r.local_id, String(r.heading).toLowerCase())
  const clauseOf = (section: string) => section.replace(/-.*$/, '')
  if (graph) {
    lot.handleRule = graph.handleRule
    const all = graph.norms.flatMap(n => leaves(n.when))
    const termsAsked = [...new Set(all.filter(l => l.fact === 'lot.in').map(l => String(l.value).toLowerCase()))]
    const tested = await Promise.all(termsAsked.map(t => lotTerm(q2, cadid, t, lot!.lga)))
    lot.terms = { ...(lot.terms ?? {}), ...Object.fromEntries(termsAsked.map((t, i) => [t, tested[i]!])) }
    lot.refHits = { ...(lot.refHits ?? {}), ...(await refHitsFor(q2, cadid, graph.refIds)) }
  }

  /*
   * ── THE SEPPs' OWN PERMISSIONS, GATED BY WHERE THEIR CHAPTER REACHES ─────────────────────────
   *
   * This used to read nsw.sepp_permissible_landuse, a flat zone table with no idea where a chapter
   * applies - which is why a heritage-listed R2 lot came back "dual occupancy permitted". The graph
   * holds the real thing: s 166 permits a dual occupancy in R2, and Chapter 6 reaches that land only
   * if s 164(1) and s 163 are satisfied - not a heritage item, not bush fire prone, not a flood
   * planning area, not within 800 m of a Schedule 12 station, in a low and mid rise housing area,
   * and more. All 17 of those exclusions resolve through nsw.scope_layer.
   *
   * WHICH FRAMES BIND WHICH PERMISSION. A frame gates a permission when its part or division
   * contains that permission, or when it sits in a part that contains NO permission of its own -
   * an application part, like Chapter 6 Part 1 (s 163, s 164), whose frames gate the whole chapter.
   * That is read from the structure, not hard-coded: it binds ch6-pt.1 to s 166 without binding
   * Chapter 3's per-division frames to each other.
   */
  const ancestry = `
    WITH RECURSIVE seed AS (
      SELECT r.id AS rule_id, r.clause, r.kind, r.rule_key, r.section_id, d.title AS instrument
        FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
       WHERE d.doc_type = 'sepp' AND r.kind = ANY($1) AND r.section_id IS NOT NULL
         -- the Codes SEPP grants COMPLYING development, a different pathway from the development
         -- consent this page asks about, and it is 160 of the 192 permission rules in the graph.
         -- /cdc answers that question; mixing the two put "3BA.3" beside "s 166" as if they were
         -- alternatives for the same proposal.
         AND d.title NOT ILIKE '%Exempt and Complying%'),
    up AS (
      SELECT z.rule_id, s.id, s.parent_id, s.local_id, s.level FROM seed z JOIN nsw.section s ON s.id = z.section_id
      UNION ALL
      SELECT u.rule_id, s.id, s.parent_id, s.local_id, s.level FROM up u JOIN nsw.section s ON s.id = u.parent_id)
    SELECT z.rule_id, z.clause, z.kind, z.rule_key, z.instrument, s.local_id AS section,
           (SELECT array_agg(lower(a.value)) FROM nsw.rule_applicability a
             WHERE a.rule_id = z.rule_id AND a.dimension = 'land_use' AND a.polarity = 'applies') AS land_uses,
           (SELECT local_id FROM up WHERE up.rule_id = z.rule_id AND up.level = 'chapter' LIMIT 1) AS chapter,
           (SELECT local_id FROM up WHERE up.rule_id = z.rule_id AND up.level = 'part' LIMIT 1) AS part,
           (SELECT coalesce(heading, '') FROM nsw.section x
             WHERE x.local_id = (SELECT local_id FROM up WHERE up.rule_id = z.rule_id AND up.level = 'part' LIMIT 1)
               AND x.document_id = (SELECT document_id FROM nsw.rule WHERE id = z.rule_id)) AS part_heading,
           (SELECT local_id FROM up WHERE up.rule_id = z.rule_id AND up.level = 'division' LIMIT 1) AS division
      FROM seed z JOIN nsw.section s ON s.id = z.section_id`
  const seppRules = (await q2(ancestry, [['permission', 'frame']])).rows
  const perms = seppRules.filter((r: any) => r.kind === 'permission')
  const frames = seppRules.filter((r: any) => r.kind === 'frame')
  /*
   * Which frames gate which permission, read off the instrument's own structure.
   *
   * A frame binds when its part or division contains the permission, or when it sits in the
   * chapter's APPLICATION part - Chapter 6 Part 1 is headed "Preliminary" and holds s 163 and
   * s 164, which gate the whole chapter including s 166 two parts away.
   *
   * The heading is the test, not "a part with no permissions in it": Chapter 3's parts are all
   * housing types ("Secondary dwellings", "Build-to-rent housing"), and that earlier guess bound
   * nine unrelated frames to s 72.
   */
  const APPLICATION_PART = /^(preliminary|application|interpretation)\b/i
  const framesFor = (p: any) => frames.filter((f: any) => f.chapter && f.chapter === p.chapter
    && (f.part === p.part || (f.division && f.division === p.division) || APPLICATION_PART.test(f.part_heading ?? '')))

  /*
   * Only the rules these nine uses actually reach.
   *
   * Every place a rule names costs a spatial query against the lot, and the SEPPs hold permissions
   * for every housing type in the State. Testing all of them was dozens of intersections per
   * request - enough to kill the Nitro worker. The permissions that name one of our nine, plus the
   * frames that gate them, is a handful.
   */
  const wantedUses = new Set(USES.flatMap(u => u.terms).map(x => x.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')))
  const stem = (x: string) => String(x).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')
  const livePerms = perms.filter((p: any) => (p.land_uses ?? []).some((x: string) => wantedUses.has(stem(x))))
  const liveRules = [...new Map([...livePerms, ...livePerms.flatMap(framesFor)].map((r: any) => [r.rule_id, r])).values()]

  const appByRule = new Map<string, { dimension: string; value: string; polarity: string }[]>()
  if (liveRules.length) {
    for (const a of (await q2(
      `SELECT rule_id, dimension, value, polarity FROM nsw.rule_applicability WHERE rule_id = ANY($1)`,
      [liveRules.map((r: any) => r.rule_id)])).rows) {
      appByRule.set(a.rule_id, [...(appByRule.get(a.rule_id) ?? []), a])
    }
  }

  /**
   * Applicability rows to a LIST of named conditions, one per dimension+polarity.
   *
   * Named and separate because the reason matters as much as the verdict. Evaluating the frame as
   * one lump and then listing the leaves that came back false reported the OPPOSITE of the truth:
   * an exclusion is wrapped in `not`, so its leaf reading false means the exclusion did not catch
   * the lot - a pass. Chapter 6 failing on a heritage item was being reported as failing on all
   * seventeen of its exclusions at once.
   */
  const condParts = (rows: { dimension: string; value: string; polarity: string }[], span: string) => {
    const groups = new Map<string, typeof rows>()
    for (const a of rows) {
      if (a.dimension === 'land_use') continue
      groups.set(`${a.dimension}|${a.polarity}`, [...(groups.get(`${a.dimension}|${a.polarity}`) ?? []), a])
    }
    return [...groups.values()].map((g) => {
      const { dimension: d, polarity } = g[0]!
      const ls: Cond[] = g.map((a) => {
        if (d === 'zone') return { fact: 'lot.zone', value: a.value, span } as Cond
        if (d === 'pathway') return { fact: 'proposal.pathway', value: a.value, span } as Cond
        if (['land_characteristic', 'defined_area', 'map_area', 'site_ref', 'tenure', 'lga'].includes(d))
          return { fact: 'lot.in', value: a.value, span } as Cond
        return { fact: 'unparsed', text: `${d.replace(/_/g, ' ')}: ${a.value}`, span } as Cond
      })
      /*
       * An EXCLUDES group splits, an APPLIES group does not.
       *
       * "not (A or B or C)" is the same as "not A and not B and not C", so each exclusion can be
       * reported on its own - and must be, or Chapter 6 failing on a heritage item reads as failing
       * on all eight of its land exclusions at once. An APPLIES group is genuinely alternatives
       * (zone R2 or R3), so it stays one condition.
       */
      if (polarity === 'excludes') {
        return g.map((a, i) => ({ label: `not ${a.value}`, cond: { not: ls[i]! } as Cond }))
      }
      const one: Cond = ls.length === 1 ? ls[0]! : { any: ls }
      return [{ label: g.map(a => a.value).join(' or '), cond: one }]
    }).flat()
  }

  /** The same rows as one condition, for the overall verdict. */
  const condOf = (rows: { dimension: string; value: string; polarity: string }[], span: string): Cond => {
    const groups = new Map<string, typeof rows>()
    for (const a of rows) {
      if (a.dimension === 'land_use') continue      // that is the question, not a condition on it
      groups.set(`${a.dimension}|${a.polarity}`, [...(groups.get(`${a.dimension}|${a.polarity}`) ?? []), a])
    }
    const parts: Cond[] = []
    for (const [, g] of groups) {
      const { dimension: d, polarity } = g[0]!
      const ls: Cond[] = g.map((a) => {
        if (d === 'zone') return { fact: 'lot.zone', value: a.value, span } as Cond
        if (d === 'pathway') return { fact: 'proposal.pathway', value: a.value, span } as Cond
        // every place dimension resolves through nsw.scope_layer, which lot.in reads
        if (['land_characteristic', 'defined_area', 'map_area', 'site_ref', 'tenure', 'lga'].includes(d))
          return { fact: 'lot.in', value: a.value, span } as Cond
        return { fact: 'unparsed', text: `${d.replace(/_/g, ' ')}: ${a.value}`, span } as Cond
      })
      const one: Cond = ls.length === 1 ? ls[0]! : { any: ls }
      parts.push(polarity === 'excludes' ? { not: one } : one)
    }
    return parts.length ? (parts.length === 1 ? parts[0]! : { all: parts }) : { fact: 'unparsed', text: 'no scope recorded', span }
  }

  // the places every SEPP permission and frame names, tested against the lot once
  const seppTerms = [...new Set(liveRules.flatMap((r: any) => (appByRule.get(r.rule_id) ?? [])
    .filter(a => ['land_characteristic', 'defined_area', 'map_area', 'site_ref', 'tenure', 'lga'].includes(a.dimension))
    .map(a => String(a.value).toLowerCase())))]
  const seppTested = await Promise.all(seppTerms.map(x => lotTerm(q2, cadid, x, lot!.lga)))
  lot.terms = { ...(lot.terms ?? {}), ...Object.fromEntries(seppTerms.map((x, i) => [x, seppTested[i]!])) }

  const tabs = []
  for (const u of USES) {
    // ── the grant: the Land Use Table, both instruments ───────────────────────────────────────
    const said = [...new Set(u.terms.map(t => landUseKey(t)))].flatMap(k => (lot!.permits?.[k] ?? []).map(p => ({ ...p, term: k })))
    const lepSaid = said.filter(s => s.source === 'lep')
    const permits = lepSaid.filter(s => /^permitted/.test(s.status))
    const prohibits = lepSaid.filter(s => s.status === 'prohibited')
    const mixed = lepSaid.filter(s => s.status === 'mixed')

    // ── the SEPP side: its own permission clauses, each gated by its chapter's frames ──────────
    const want = new Set(u.terms.map(stem))
    const matched = livePerms.filter((p: any) => (p.land_uses ?? []).some((x: string) => want.has(stem(x))))
    // a permission with NO applicability recorded says nothing about this lot either way; counting
    // it as undecided turned a clear prohibition into a MAYBE on the strength of a missing row
    const unscoped = matched.filter((p: any) => !(appByRule.get(p.rule_id) ?? []).some(a => a.dimension !== 'land_use'))
    const mine = matched.filter((p: any) => !unscoped.includes(p))
    const seppSaid = [...new Map(mine.map((p: any) => {
      const gates = framesFor(p)
      const parts = [
        ...condParts(appByRule.get(p.rule_id) ?? [], p.section).map(x => ({ ...x, from: `s ${p.clause}` })),
        ...gates.flatMap((f: any) => condParts(appByRule.get(f.rule_id) ?? [], f.section).map(x => ({ ...x, from: `s ${f.clause}` }))),
      ]
      const ask = { cadid, site, proposal: { kind: 'use', use: u.terms[0], pathway: 'development_application' } } as Question
      const probe = (c: Cond) => evaluate([{ id: 'x', instrument: p.instrument, clause: p.clause, section: p.section,
        text: '', when: c, then: { permit: 'with_consent' }, author: { by: '', at: '' } } as Norm], ask, lot!, landUseKey).norms[0]!
      // each gate on its own, so the reason names the one that actually bit
      const scored = parts.map(x => ({ ...x, v: probe(x.cond).holds }))
      const r = probe({ all: parts.map(x => x.cond) })
      const failed = scored.filter(x => x.v === false).map(x => `${x.label} (${x.from})`)
      const openLeaves = scored.filter(x => x.v === null).map(x => `${x.label} (${x.from})`)
      return [`${p.instrument}|${p.clause}`, {
        instrument: p.instrument, clause: p.clause, chapter: p.chapter, section: p.section,
        landUse: (p.land_uses ?? []).filter((x: string) => want.has(stem(x))).join(', '), holds: r.holds,
        gates: gates.map((f: any) => f.clause), why: r.holds === true ? 'every gate in the chapter is met here'
          : r.holds === false ? failed.join('; ') : openLeaves.join('; '),
        url: link(p.instrument, p.section),
      }]
    })).values()]

    /*
     * The answer, LEP and SEPPs together.
     *
     * The LEP permitting is certain. Otherwise a SEPP permission counts only if its chapter
     * actually reaches this land - which is now tested rather than assumed, so a heritage-listed
     * R2 lot gets a no from Chapter 6 instead of the flat zone table's yes.
     */
    const seppYes = seppSaid.filter((s: any) => s.holds === true)
    const seppOpen = seppSaid.filter((s: any) => s.holds === null)
    const answer = permits.length || seppYes.length ? 'yes'
      : seppOpen.length || mixed.length ? 'maybe'
      : prohibits.length || seppSaid.length ? 'no' : 'unknown'
    const because = [...new Map(lepSaid.map(s => [`${s.instrument}|${s.status}|${s.term}`,
          { instrument: s.instrument, source: s.source, status: s.status, term: s.term,
            url: sources[s.instrument] ?? null }])).values()]

    // ── the standards that come with it ───────────────────────────────────────────────────────
    let standards: any[] = [], gaps: any[] = [], dependsOn: any[] = []
    if (lepDoc && graph) {
      const words = wordsFor(u)
      /*
       * Whose clause is this? A heading that names A use names WHOSE control it is - "Height of
       * buildings for dual occupancies" is not a control on a farm building. A heading that names
       * no use at all binds development generally, so it belongs to every tab.
       */
      const mine = (section: string) => {
        const h = headings.get(clauseOf(section)) ?? ''
        if (words.some(w => h.includes(w.toLowerCase()))) return true
        return !allWords.some(w => h.includes(w.toLowerCase()))
      }
      const norms = graph.norms.filter(n => mine(n.section))
      const question: Question = { cadid, site, proposal: { kind: 'use', use: u.terms[0] } }
      const o = evaluate(norms, question, lot!, landUseKey)
      const sectionOf = new Map(norms.map(n => [n.id, n.section]))
      standards = o.standards.map(s => ({ ...s, instrument: lepDoc.title, url: link(lepDoc.title, sectionOf.get(s.id)) }))
      dependsOn = o.dependsOn
      const g = { gaps: graph.gaps.filter(x => mine(x.section)) }
      gaps = g.gaps.map(x => ({ clause: x.parts.length ? x.parts.join(', ') : x.clause, section: x.section,
        heading: x.heading, url: link(lepDoc.title, x.section) }))
    }

    tabs.push({ key: u.key, label: u.label, terms: u.terms, inferred: u.inferred ?? null, needs: u.needs,
                answer, because, sepp: seppSaid, standards, dependsOn, gaps,
                seppUnscoped: unscoped.map((p: any) => ({ instrument: p.instrument, clause: p.clause, section: p.section })) })
  }

  /*
   * Every zone the lot touches, not just the one under its point on surface.
   *
   * lotFacts reads a single zone, so a split-zoned lot is answered on half of itself - this one is
   * R2 and R3, and the Land Use Table was read as R2 alone. The answers below still rest on that
   * one zone; this is here so the page can say so rather than let it pass unseen.
   */
  const zones = (await q2(`
    SELECT DISTINCT z.sym_code FROM epi.epi_land_zoning z, cadastre.lot l
     WHERE l.cadid::text = $1 AND z.geom && l.geom AND ST_Intersects(z.geom, l.geom) AND z.sym_code IS NOT NULL
     ORDER BY z.sym_code`, [cadid])).rows.map((r: any) => r.sym_code)

  return {
    ms: Date.now() - started,
    lot: { cadid, lotId: lot.lotId, zone: lot.zone, zones, epi: lot.epi, lga: lot.lga, areaM2: lot.areaM2,
           frontageM: lot.frontageM, lotSizeMinM2: lot.lotSizeMinM2,
           isBattleaxe: lot.isBattleaxe ?? null, handleAreaM2: lot.handleAreaM2 ?? null },
    tabs, sources,
  }
})
