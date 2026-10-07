/**
 * Norms read from the nsw graph's own rules (nsw.rule + rule_applicability + rule_effect + rule_spatial_ref +
 * rule_edge), for ANY plan - one mapping, no per-clause or per-council code.
 *
 * A clause's rules are often fragments: a scope-only rule ("This clause applies to land in Zone R2 ... used for
 * residential accommodation" - applicability, no effect) and an effect rule ("not less than the minimum size shown on
 * the Lot Size Map" - effect, no scope). Within one clause, every scope-only rule's applicability is inherited by the
 * clause's effect rules, unless the effect rule carries that dimension itself.
 *
 *   applicability                 -> condition (fail closed: what the mapping cannot read stays `unparsed`)
 *     zone                          lot.zone (rows of one dimension are alternatives; excludes = none of them)
 *     act subdivision / strata ...  proposal.kind subdivision (+ subdivision_type)
 *     tenure strata / community / torrens   proposal.subdivision_type
 *     land_use X                    X on the lot or proposed (site.has / proposal.use; groups per the SI dictionary)
 *     dev_type residential          residential accommodation on the lot or proposed; other dev_types unparsed
 *     area_label / site_ref / map   the lot against the rule's own polygons in rule_spatial_ref (none = unparsed)
 *     anything else                 unparsed
 *   effect (numeric)              -> a standard
 *     lot_size gte N / unit map     resulting lot size >= N / >= the Lot Size Map minimum
 *     frontage_width / width        resulting lot width >= N
 *     other / unspecified           shown as the graph has it - "value not extracted" when it has none
 *   rule_edge overrides / relaxes / disapplies -> `despite` every norm of the target clause ('clause:4.1')
 *
 * `covered` sections are read by the Standard Instrument reader (2.6(1)-(2), 4.1(2)-(4)); the graph's rules in them are
 * not read twice. A clause (or the uncovered part of one) whose rules carry no effect is a gap - reported with what the
 * graph does hold, never passed as clear.
 */
import type { Cond, Effect, Norm } from './schema'

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>

export interface GraphGap { clause: string; section: string; heading: string | null; parts: string[]; rules: number; zones: string[] | null }

const NOT_ADOPTED = /^\s*[[(]?\s*(not applicable|not adopted|repealed)\s*[\])]?\.?\s*$/i
const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()

export async function graphNorms(query: Query, documentId: string, instrument: string, slug: string,
  opts: { clauseFilter: string; covered: string[] }): Promise<{ norms: Norm[]; gaps: GraphGap[]; refIds: string[];
    handleRule: { clauses: string[]; exceptZones: string[] } | null }> {
  const isCovered = (local: string) => opts.covered.some(c => local === c || local.startsWith(c + '-'))
  const clauses = (await query(`SELECT local_id, heading FROM nsw.section WHERE document_id = $1 AND level = 'clause' AND (${opts.clauseFilter})`, [documentId])).rows
  const sections = (await query(`
    SELECT s.local_id, s.route, s.raw_text, cl.local_id AS clause_sec FROM nsw.section s
      JOIN nsw.section cl ON cl.document_id = s.document_id AND cl.level = 'clause' AND (s.local_id = cl.local_id OR s.local_id LIKE cl.local_id || '-%')
     WHERE s.document_id = $1 AND cl.local_id = ANY($2)`, [documentId, clauses.map(c => c.local_id)])).rows
  const rules = (await query(`
    SELECT r.id, r.clause, r.kind, s.local_id AS section, cl.local_id AS clause_sec,
           coalesce((SELECT json_agg(json_build_object('d', a.dimension, 'v', a.value, 'p', a.polarity))
                       FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS app,
           coalesce((SELECT json_agg(json_build_object('type', e.effect_type, 'topic', e.topic, 'cmp', e.comparator, 'value', e.value,
                                                        'unit', e.unit, 'span', e.source_span))
                       FROM nsw.rule_effect e WHERE e.rule_id = r.id), '[]') AS eff,
           coalesce((SELECT json_agg(json_build_object('id', sr.id, 'value', sr.value, 'layer', sr.map_layer, 'polarity', sr.polarity))
                       FROM nsw.rule_spatial_ref sr WHERE sr.rule_id = r.id AND sr.geom IS NOT NULL), '[]') AS refs,
           coalesce((SELECT json_agg(json_build_object('type', e.edge_type, 'to', (SELECT r2.clause FROM nsw.rule r2 WHERE r2.id = e.to_rule_id)))
                       FROM nsw.rule_edge e WHERE e.from_rule_id = r.id), '[]') AS edges
      FROM nsw.rule r JOIN nsw.section s ON s.id = r.section_id
      JOIN nsw.section cl ON cl.document_id = r.document_id AND cl.level = 'clause' AND (s.local_id = cl.local_id OR s.local_id LIKE cl.local_id || '-%')
     WHERE r.document_id = $1 AND r.publish_state <> 'retired' AND cl.local_id = ANY($2)
     ORDER BY s.local_id`, [documentId, clauses.map(c => c.local_id)])).rows.filter(r => !isCovered(r.section))

  /*
   * "the area of the access handle is not to be included in calculating the lot size"
   *
   * This is not a standard of its own - it is a rule about the ARITHMETIC of every other lot-size
   * standard in the plan, which is why it kept showing as "not tested here" while the lot sizes
   * beside it were computed on the gross area including the handle.
   *
   * Hornsby cl 4.1(3A) excepts RU1, RU2, RU4 and C3; cl 4.1A(4) and 4.1AA(3A) except nothing. The
   * carve-out is read from the clause's own child paragraphs, so no council's zone list is written
   * into the code.
   */
  const HANDLE = /access handle\s+(?:is|must)\s+not\s+(?:to\s+)?be\s+(?:included|counted)/i
  const handleSecs = sections.filter(s => HANDLE.test(norm(s.raw_text)))
  // the subclause that carries it - "sec.4.1-ssec.3A" is cl 4.1(3A), which is how the row is labelled
  const clauseLabel = (localId: string) => {
    const [head, sub2] = String(localId).replace('sec.', '').split('-ssec.')
    return sub2 ? `${head}(${sub2.split('-')[0]})` : head!
  }
  const handleRule = handleSecs.length
    ? { clauses: [...new Set(handleSecs.map(s => clauseLabel(s.local_id)))],
        exceptZones: [...new Set(handleSecs.flatMap(h => /\bexcept\b/i.test(norm(h.raw_text))
          ? sections.filter(s => s.local_id.startsWith(h.local_id + '-'))
              .flatMap(s => [...norm(s.raw_text).matchAll(/\bZone ([A-Z]{1,2}\d{0,2}[A-Z]?)\b/g)].map(m => m[1]!))
          : []))] }
    : null

  const refIds: string[] = []
  const leafFor = (r: any, a: { d: string; v: string }): Cond => {
    const v = norm(a.v), lv = v.toLowerCase(), s = r.section
    switch (a.d) {
      case 'zone': return /^[A-Z]{1,2}\d{0,2}[A-Z]?$/.test(v) ? { fact: 'lot.zone', value: v, span: s } : { fact: 'unparsed', text: `zone ${v}`, span: s }
      case 'act': {
        if (!/^(strata |community title )?subdivision$/.test(lv)) return { fact: 'unparsed', text: `act: ${v}`, span: s }
        const kind: Cond = { fact: 'proposal.kind', value: 'subdivision', span: s }
        return lv === 'subdivision' ? kind : { all: [kind, { fact: 'proposal.subdivision_type', value: lv.startsWith('strata') ? 'strata' : 'community', span: s }] }
      }
      case 'tenure':
        return /strata/.test(lv) ? { fact: 'proposal.subdivision_type', value: 'strata', span: s }
          : /community/.test(lv) ? { fact: 'proposal.subdivision_type', value: 'community', span: s }
          : /torrens/.test(lv) ? { fact: 'proposal.subdivision_type', value: 'torrens', span: s }
          : { fact: 'unparsed', text: `tenure: ${v}`, span: s }
      case 'land_use': return { any: [{ fact: 'site.has', value: v, span: s }, { fact: 'proposal.use', value: v, span: s }] }
      /*
       * A branch condition - "for development in a heritage conservation area" - carried onto the
       * rules beneath it by scripts/backfill-branch-conditions.ts. The value is an nsw.scope_layer
       * term, so it resolves through the `lot.in` fact that already exists rather than a new path;
       * a term with no scope_layer row answers null, which keeps the norm undecided rather than
       * clear. Without this the four cells of a matrix clause are indistinguishable.
       */
      case 'land_characteristic': return { fact: 'lot.in', value: lv, span: s }
      case 'dev_type': return lv === 'residential'
        ? { any: [{ fact: 'site.has', value: 'residential accommodation', span: s }, { fact: 'proposal.use', value: 'residential accommodation', span: s }] }
        : { fact: 'unparsed', text: `development type: ${v}`, span: s }
      default: return { fact: 'unparsed', text: `${a.d.replace(/_/g, ' ')}: ${v}`, span: s }
    }
  }
  const placeOf = (r: any, refs: any[], polarity: string, label: string): Cond => {
    const hits = refs.filter(x => (x.polarity ?? 'applies') === polarity)
    if (!hits.length) return { fact: 'unparsed', text: `${label} (no polygon in the graph)`, span: r.section }
    refIds.push(...hits.map(x => x.id))
    const one: Cond = { any: hits.map(x => ({ fact: 'lot.on_ref', value: x.id, text: `${x.value}${x.layer ? ` (${x.layer} map)` : ''}`, span: r.section } as Cond)) }
    return one
  }
  const conditionOf = (r: any, rows: { d: string; v: string; p: string; refs?: any[] }[]): Cond => {
    const groups = new Map<string, typeof rows>()
    for (const a of rows) groups.set(`${a.d}|${a.p}`, [...(groups.get(`${a.d}|${a.p}`) ?? []), a])
    const parts: Cond[] = []
    for (const [, g] of groups) {
      const { d, p } = g[0]!
      if (/^(area_label|site_ref|map_area)$/.test(d)) {
        const refs = g.flatMap(a => a.refs ?? [])
        const c = placeOf(r, refs, p === 'excludes' ? 'excludes' : 'applies', `${d.replace(/_/g, ' ')}: ${g.map(a => a.v).join(' / ')}`)
        parts.push(c)
        continue
      }
      const ls = g.map(a => leafFor(r, a))
      const one: Cond = ls.length === 1 ? ls[0]! : { any: ls }
      parts.push(p === 'excludes' ? { not: one } : one)
    }
    // the clause was chosen as a subdivision clause: if no row says the act, it is about subdivision
    if (!rows.some(a => a.d === 'act')) parts.unshift({ fact: 'proposal.kind', value: 'subdivision', span: r.section })
    return parts.length === 1 ? parts[0]! : { all: parts }
  }
  const effectOf = (e: any): Effect | null => {
    if (e.type !== 'numeric') return null
    const t = String(e.topic ?? '')
    const cmp = (['lt', 'lte', 'eq', 'gte', 'gt'].includes(e.cmp) ? e.cmp : 'gte') as any
    const n = e.value == null ? undefined : Number(e.value) * (/^ha$|hectare/i.test(String(e.unit ?? '')) ? 10000 : 1)
    if (t === 'lot_size' && e.unit === 'map') return { require: { topic: 'resulting_lot_size', cmp: 'gte', from: 'lot_size_map', unit: 'm²', kind: 'development_standard' } }
    if (t === 'lot_size' && n != null && (cmp === 'gte' || cmp === 'gt')) return { require: { topic: 'resulting_lot_size', cmp, n, unit: 'm²', kind: 'development_standard' } }
    if ((t === 'frontage_width' || t === 'width') && n != null) return { require: { topic: 'resulting_lot_width', cmp, n, unit: 'm', kind: 'development_standard' } }
    return { require: { topic: 'graph_standard', cmp, n, unit: `${t && t !== 'unspecified' ? t.replace(/_/g, ' ') : 'value not extracted'}${e.unit ? ` (${e.unit})` : ''}`, kind: 'development_standard' } }
  }

  const norms: (Norm & { _edges?: any[] })[] = []
  const idsByClause = new Map<string, string[]>()
  const gaps: GraphGap[] = []
  for (const cl of clauses) {
    const rs = rules.filter(r => r.clause_sec === cl.local_id)
    const own = sections.filter(s => s.clause_sec === cl.local_id && !isCovered(s.local_id))
    // sections with words of their own - routed operative where routing ran (step 4 has only run on SEPPs), else any
    // section that is not an objective, a definition, empty or "[Not adopted]"
    const operative = own.filter(s => {
      const t = norm(s.raw_text)
      if (!t || NOT_ADOPTED.test(t)) return false
      if (s.route) return s.route === 'operative'
      return !/^The objectives? of this clause (is|are)\b|^In this clause\b.*\bmeans\b/i.test(t) && !/^to [a-z]/.test(t)
    })
    const wholeText = own.map(s => norm(s.raw_text)).join(' ')
    if (!operative.length || (own.length && NOT_ADOPTED.test(wholeText))) continue      // nothing left to read, or not adopted
    const scopeRows = rs.filter(r => !(r.eff as any[]).some(e => effectOf(e))).flatMap(r => (r.app as any[]).map(a => ({ ...a, refs: r.refs })))
    const effRules = rs.filter(r => (r.eff as any[]).some(e => effectOf(e)))
    const clauseNo = cl.local_id.replace('sec.', '')
    if (!effRules.length) {
      // zones the graph's own scope rows name; else the clause's "This clause applies to ..." sentence
      let zones: string[] | null = [...new Set(scopeRows.filter(a => a.d === 'zone' && a.p === 'applies').map(a => String(a.v)))]
      if (!zones.length) {
        const scope = operative.find(s => /^This (clause|subclause) applies (only )?to\b/i.test(norm(s.raw_text)))
        const words = scope ? own.filter(s => s.local_id === scope.local_id || s.local_id.startsWith(scope.local_id + '-')).map(s => norm(s.raw_text)).join(' ') : ''
        zones = scope && !/\b(other than|except|does not apply)\b/i.test(words) ? [...new Set([...words.matchAll(/\bZone ([A-Z]{1,2}\d{0,2}[A-Z]?)\b/g)].map(m => m[1]!))] : []
      }
      gaps.push({ clause: clauseNo, section: cl.local_id, heading: cl.heading, rules: rs.length, zones: zones.length ? zones : null,
                  // where the Standard Instrument reader took part of the clause: the subclauses left over
                  parts: opts.covered.some(c => c.startsWith(cl.local_id))
                    ? [...new Set(operative.map(s => s.local_id.startsWith(`${cl.local_id}-ssec.`) ? s.local_id.slice(cl.local_id.length + 6).split('-')[0] : '')
                        .filter(Boolean).map(x => `${clauseNo}(${x})`))] : [] })
      continue
    }
    for (const r of effRules) {
      const ownRows = (r.app as any[]).map(a => ({ ...a, refs: r.refs }))
      const ownDims = new Set(ownRows.map(a => a.d))
      // fail closed: most of the graph's rule fragments are incomplete (scope and effect split, values missing), so a norm
      // read from them is never decisive on its own - its standards show "if it applies", never "met"
      const when: Cond = { all: [conditionOf(r, [...ownRows, ...scopeRows.filter(a => !ownDims.has(a.d))]),
        { fact: 'unparsed', text: "the graph's rule for this clause, its scope as extracted - not checked against the clause's words", span: r.section }] }
      ;(r.eff as any[]).forEach((e, i) => {
        const then = effectOf(e)
        if (!then) return
        // several rules of one clause point at the SAME section (Hornsby cl 4.1C has four, all on
        // sec.4.1C), so a section-keyed id collided - byId then returned one norm for every row and
        // anything keyed by norm id, `despite` included, silently read the wrong one
        const id = `${slug}:graph:${r.section}:${String(r.id).slice(0, 8)}:${i}`
        idsByClause.set(clauseNo, [...(idsByClause.get(clauseNo) ?? []), id])
        norms.push({ id, instrument, clause: r.clause, section: r.section, text: '', when, then, despite: [],
          author: { by: 'nsw graph (nsw.rule)', at: '' }, review: e.span ? `graph: "${norm(e.span).slice(0, 160)}"` : undefined, _edges: r.edges })
      })
    }
  }
  // overrides / relaxes / disapplies: despite every norm of the target clause, graph-read or Standard Instrument-read
  for (const n of norms) {
    for (const e of n._edges ?? []) if (['overrides', 'relaxes', 'disapplies'].includes(e.type) && e.to) {
      const target = String(e.to).replace(/\(.*$/, '').trim()
      n.despite = [...new Set([...(n.despite ?? []), ...(idsByClause.get(target) ?? []), `clause:${target}`])]
    }
    delete n._edges
  }
  return { norms, gaps, refIds: [...new Set(refIds)], handleRule }
}
