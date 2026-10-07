/**
 * Subdivision norms (docs/norms-trial.md, "subdivision section"): build, gate, write.
 *
 *   npx tsx scripts/norms/build-subdivision.ts
 *
 * Writes norms/subdivision/housing-sepp-2021.json and norms/subdivision/lep/<instrument slug>.json:
 *   Housing SEPP  every clause that permits or bars subdivision (s 22, 27, 32, 51, 66A, 70, 90, 108E, 117, 141L, 169,
 *                 173, 185), written here clause by clause; s 169 / 173 carry Chapter 6's s 164 exclusions, read from
 *                 the profile's ch6 frame so the two never disagree
 *   each LEP      the Standard Instrument clauses read from THAT plan's own words: 2.6(1) (subdivision only with
 *                 consent), 2.6(2) (a secondary dwelling split off below the Lot Size Map minimum), 4.1(3) (the Lot Size
 *                 Map minimum) with 4.1(4)'s exclusions - an exclusion it does not recognise is kept as an unparsed
 *                 condition, so 4.1 can only become undecided on it, never silently narrower
 *   + reviewed    local clauses read and reviewed by hand (Randwick 4.1A-4.1D, from the trial)
 *   + unchecked   every other subdivision clause of the plan (heading mentions subdivision or lot size), listed with a
 *                 link so the section can say "N local clauses not yet checked" - never a silent yes
 * Every norm passes the gate (scripts/norms/gate.ts): spans in the clause or its context, vocabulary, numbers.
 */
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import type { Cond, Effect, Norm } from '../../shared/norms/schema'
import profile from '../../profiles/housing-sepp-2021'
import { gateNorm, norm, numbersIn, operative, quantities } from './gate'

const OUT = 'norms/subdivision'
const AUTHOR = { by: 'claude-opus-5-5 (in session)', at: '2026-10-07' }
const L = (fact: string, span: string, extra: Record<string, unknown> = {}): Cond => ({ fact, span, ...extra } as any)
const SUB = (span: string) => L('proposal.kind', span, { value: 'subdivision' })

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p?: unknown[]) => client.query(sql, p as any[])
  mkdirSync(`${OUT}/lep`, { recursive: true })
  let findings = 0

  // ── Housing SEPP ─────────────────────────────────────────────────────────────────────────────
  const H = 'State Environmental Planning Policy (Housing) 2021'
  const hs = 'housing-sepp-2021'
  const hSecs = (await q(`SELECT s.local_id, s.raw_text, s.route FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id WHERE d.title = $1`, [H])).rows
  const s164 = profile.frames.find(f => f.id === 'ch6')!.conditions.filter(c => c.clause.startsWith('164') && c.polarity === 'excludes')
  // the profile's spans were written for the old pipeline ("(i) Bathurst Regional", " , Chapter 2"): quote the words as
  // the graph stores them - the span as written, else without the space before a comma, else up to its dash
  const t164 = hSecs.filter(s => s.local_id === 'sec.164' || s.local_id.startsWith('sec.164-')).map(s => norm(s.raw_text)).join(' ')
  const literal = (span: string) => [span, span.replace(/ ,/g, ','), span.replace(/"([^"]*)"/g, '“$1”'),
    span.split('—')[0]!.trim() + '—', span.split('—')[0]!.trim()]
    .find(x => x.length > 12 && t164.includes(x)) ?? span
  const notExcluded: Cond = { all: s164.map(c => ({ not: L('lot.in', literal(c.span), { value: c.value }) })) }
  const r123 = (span: (z: string) => string): Cond => ({ any: ['R1 General Residential', 'R2 Low Density Residential', 'R3 Medium Density Residential']
    .map(z => L('lot.zone', span(z), { value: z.slice(0, 2) })) })
  const lmrSubdivision = (clause: string, use: string, purposeSpan: string, consentSpan: string, daSpan: string): Cond => ({ all: [
    SUB(purposeSpan),
    L('proposal.use', purposeSpan, { value: use }),
    { not: L('proposal.subdivision_type', 'This section does not apply to strata subdivision.', { value: 'strata' }) },
    r123(z => `Zone ${z}`),
    L('lot.in', 'on land in a low and mid rise housing area', { value: 'low and mid rise housing area' }),
    notExcluded,
    { any: [
      L('site.consent_on_or_after', consentSpan, { value: use, text: '2025-02-28' }),
      L('proposal.also_erects', daSpan, { value: use }),
    ] },
  ] })
  const ban = (clause: string, section: string, when: Cond, extra: Partial<Norm> = {}): any => ({ id: `${hs}:${clause}`, clause, section, when, then: { prohibit: true }, author: AUTHOR, ...extra })
  const grant = (clause: string, section: string, when: Cond, extra: Partial<Norm> = {}): any => ({ id: `${hs}:${clause}`, clause, section, when, then: { permit: 'with_consent' }, author: AUTHOR, ...extra })
  const std = (clause: string, section: string, when: Cond, require: any, extra: Partial<Norm> = {}): any => ({ id: `${hs}:${clause}`, clause, section, when, then: { require }, author: AUTHOR, ...extra })
  const lmr169 = lmrSubdivision('169', 'dual occupancy', 'subdivision for the purposes of dual occupancies',
    'development consent was granted for the dual occupancy on or after 28 February 2025',
    'the development results from a development application made on or after 28 February 2025 for the subdivision of the land and the erection of a dual occupancy on the land')
  const lmr173 = lmrSubdivision('173', 'multi dwelling housing (terraces)', 'subdivision for the purposes of multi dwelling housing (terraces)',
    'development consent was granted for the multi dwelling housing (terraces) on or after 28 February 2025',
    'the development results from a development application made on or after 28 February 2025 for the subdivision of the land and the erection of multi dwelling housing (terraces) on the land')
  const housing: any[] = [
    grant('22', 'sec.22', { all: [SUB('may be subdivided with development consent'),
      L('site.has', 'Land on which development has been carried out under this division', { value: 'development', under: `${hs}:ch.2-pt.2-div.1` })] }),
    ban('27', 'sec.27', { all: [SUB('the subdivision of a boarding house'), L('site.has', 'the subdivision of a boarding house', { value: 'boarding house' })] }),
    ban('32', 'sec.32', { all: [SUB('the subdivision of a boarding house'), L('site.has', 'the subdivision of a boarding house', { value: 'boarding house' })] }),
    ban('51', 'sec.51', { all: [SUB('the subdivision of a lot'), L('site.has', 'a lot on which development has been carried out under this Part', { value: 'secondary dwelling', under: `${hs}:ch.3-pt.1` })] }),
    ban('66A', 'sec.66A', { all: [SUB('the subdivision of group homes'), L('site.has', 'the subdivision of group homes', { value: 'group home' })] }, { despite: ['doc_type:lep'] }),
    ban('70', 'sec.70', { all: [SUB('the subdivision of co-living housing into separate lots'), L('site.has', 'the subdivision of co-living housing into separate lots', { value: 'co-living housing' })] }),
    grant('90(1)', 'sec.90-ssec.1', { all: [SUB('may be granted for the subdivision of land'), { any: [
      L('site.has', 'land on which development is carried out under this Part', { value: 'seniors housing', under: `${hs}:ch.3-pt.5` }),
      L('proposal.under', 'including before the development under this part is carried out', { value: `${hs}:ch.3-pt.5` })] }] }),
    ban('90(2)', 'sec.90-ssec.2', { all: [SUB('the subdivision of a building resulting from development carried out under this Part'),
      L('site.has', 'a building resulting from development carried out under this Part', { value: 'seniors housing', under: `${hs}:ch.3-pt.5` }),
      { any: [L('lot.zone', 'Zone E2 Commercial Centre', { value: 'E2' }), L('lot.zone', 'Zone B3 Commercial Core', { value: 'B3' })] }] }),
    ban('108E', 'sec.108E', { all: [SUB('the subdivision of seniors housing'), L('site.has', 'the subdivision of seniors housing', { value: 'seniors housing', under: `${hs}:ch.3-pt.5-div.8` })] },
      { review: 's 108E sits in Div 8 (seniors housing by relevant authorities); read as seniors housing developed under that Division.' } as any),
    grant('117', 'sec.117', { all: [SUB('may be subdivided with development consent'),
      L('site.has', 'A residential flat building or shop top housing resulting from a development consent granted under this Part', { value: 'residential flat building', under: `${hs}:ch.3-pt.7` })] },
      { review: 'Shop top housing under Pt 7 is the same grant; the vocabulary takes one use per leaf - add it when a case needs it.' } as any),
    ban('141L', 'sec.141L', { all: [SUB('Development consent must not be granted to the subdivision of the following land'), { any: [
      L('site.has', 'land on which construction workers accommodation is erected', { value: 'construction workers accommodation' }),
      L('site.approved_or_pending', 'land in relation to which there is a development consent in force for the erection of construction workers accommodation', { value: 'construction workers accommodation' }),
      L('site.approved_or_pending', 'land in relation to which a development application for development for the purposes of construction workers accommodation has been made but not finally determined', { value: 'construction workers accommodation' })] }] }),
    grant('169(1A)', 'sec.169-ssec.1A', lmr169, { despite: ['doc_type:lep'] }),
    std('169(3)(a)', 'sec.169-ssec.3-para1.a', lmr169, { topic: 'dwellings_per_resulting_lot', cmp: 'lte', n: 1, unit: 'dwelling', kind: 'non_discretionary' }),
    std('169(3)(b)', 'sec.169-ssec.3-para1.b', lmr169, { topic: 'resulting_lot_width', cmp: 'gte', n: 6, unit: 'm', kind: 'non_discretionary' }),
    std('169(3)(c)', 'sec.169-ssec.3-para1.c', lmr169, { topic: 'road_frontage', cmp: 'eq', kind: 'non_discretionary' }),
    std('169(3)(d)', 'sec.169-ssec.3-para1.d', lmr169, { topic: 'resulting_lot_size', cmp: 'gte', n: 225, unit: 'm²', kind: 'non_discretionary' }),
    std('169(3)(e)', 'sec.169-ssec.3-para1.e', lmr169, { topic: 'not_battle_axe', cmp: 'eq', kind: 'non_discretionary' }),
    grant('173(1A)', 'sec.173-ssec.1A', lmr173, { despite: ['doc_type:lep'] }),
    std('173(3)(a)', 'sec.173-ssec.3-para1.a', lmr173, { topic: 'dwellings_per_resulting_lot', cmp: 'lte', n: 1, unit: 'dwelling', kind: 'non_discretionary' }),
    std('173(3)(b)', 'sec.173-ssec.3-para1.b', lmr173, { topic: 'resulting_lot_width', cmp: 'gte', n: 6, unit: 'm', kind: 'non_discretionary' },
      { review: '"must be 6m wide at the front building line" (s 169 says "at least") - read as a minimum.' } as any),
    std('173(3)(c)', 'sec.173-ssec.3-para1.c', lmr173, { topic: 'road_frontage', cmp: 'eq', kind: 'non_discretionary' }),
    std('173(3)(d)', 'sec.173-ssec.3-para1.d', lmr173, { topic: 'resulting_lot_size', cmp: 'gte', n: 165, unit: 'm²', kind: 'non_discretionary' }),
  ]
  housing.push(
    // s 78: a matter for consideration on the subdivision of an RFB consented under Pt 4 (build-to-rent) - shown, never decides
    std('78', 'sec.78', { all: [SUB('development involving the subdivision of a residential flat building'),
      L('site.has', 'a residential flat building for which consent has been granted under this Part', { value: 'residential flat building', under: `${hs}:ch.3-pt.4` })] },
      { topic: 'matter_for_consideration', cmp: 'eq', kind: 'condition', unit: 'the relevant provisions of the Apartment Design Guide' }),
    // s 124: manufactured home estate land - community title (or a lease subdivision, not in the vocabulary) with consent,
    // despite any other instrument's prohibition (124(3)); 124(2) and (4) as the conditions they are
    grant('124(1)', 'sec.124-ssec.1', { all: [SUB('may be subdivided— only with the development consent of the council'),
      L('site.has', 'Land on which development for the purposes of a manufactured home estate may be lawfully carried out', { value: 'manufactured home estate' }),
      { any: [L('proposal.subdivision_type', 'under the Community Land Development Act 1989', { value: 'community' }),
              L('unparsed', 'under section 289K of the Local Government Act 1919 for lease purposes', { text: 'a subdivision for lease purposes' })] },
      { not: L('unparsed', 'if any of the lots intended to be created by the proposed subdivision would contravene a requirement of the Local Government (Manufactured Home Estates) Transitional Regulation 1993', { text: 'a lot contravenes the Manufactured Home Estates Transitional Regulation 1993' }) },
      { not: L('unparsed', 'This Part does not allow the subdivision of land within a Crown reserve.', { text: 'the land is within a Crown reserve' }) }] },
      { despite: ['doc_type:lep'] }),
    // s 132: caravan parks - a subdivision for lease purposes only (not a Torrens, strata or community subdivision)
    grant('132(1)', 'sec.132-ssec.1', { all: [SUB('Land may be subdivided for lease purposes'),
      L('site.has', 'Land may be subdivided for lease purposes', { value: 'caravan park' }),
      L('unparsed', 'for lease purposes under section 289K of the Local Government Act 1919', { text: 'a subdivision for lease purposes' })] },
      { despite: ['doc_type:lep'] }),
  )
  // s 185 from the trial's reviewed norms
  const trialH = JSON.parse(readFileSync('norms/trial/reviewed/housing-sepp-2021.json', 'utf8'))
  housing.push(...trialH.norms.filter((n: any) => /^housing-sepp-2021:185/.test(n.id)))
  const hContext: Record<string, string[]> = { 'sec.169': ['sec.164', 'sec.163'], 'sec.173': ['sec.164', 'sec.163'], 'sec.90': ['sec.90'] }
  const hUnchecked: any[] = []
  findings += write(`${OUT}/housing-sepp-2021.json`, H, hs, housing, hSecs, hContext, hUnchecked)

  // ── every LEP ────────────────────────────────────────────────────────────────────────────────
  const docs = (await q(`SELECT id, title, instrument_slug FROM nsw.document WHERE doc_type = 'lep' ORDER BY title`)).rows
  const summary: string[] = []
  for (const d of docs) {
    const secs = (await q(`SELECT local_id, heading, raw_text, route, level FROM nsw.section WHERE document_id = $1`, [d.id])).rows
    const under = (root: string) => secs.filter(s => s.local_id === root || s.local_id.startsWith(root + '-'))
    const text = (root: string) => under(root).map(s => norm(s.raw_text)).join(' ')
    const find = (root: string, re: RegExp) => text(root).match(re)?.[0] ?? null
    const slug = d.instrument_slug as string
    const ns: any[] = []
    const unchecked: { clause: string; section: string; why: string }[] = []
    // 2.6(1)
    const s261 = find('sec.2.6', /may be subdivided, but only with development consent/i)
    if (s261) ns.push({ id: `${slug}:2.6(1)`, clause: '2.6(1)', section: 'sec.2.6-ssec.1', when: SUB(s261), then: { permit: 'with_consent' }, author: AUTHOR })
    // 2.6(2)
    const a = find('sec.2.6', /for the subdivision of land on which a secondary dwelling is situated/i)
    const b = find('sec.2.6', /result in the principal dwelling and the secondary dwelling being situated on separate lots/i)
    const c = find('sec.2.6', /unless the resulting lots are not less than the minimum size shown on the Lot Size Map in relation to that land/i)
    if (a && b && c) ns.push({ id: `${slug}:2.6(2)`, clause: '2.6(2)', section: 'sec.2.6-ssec.2', then: { prohibit: true }, author: AUTHOR,
      when: { all: [SUB('for the subdivision of land'), L('site.has', 'land on which a secondary dwelling is situated', { value: 'secondary dwelling' }),
        L('proposal.separates', b, { value: 'principal dwelling|secondary dwelling' }),
        { not: L('unparsed', c, { text: 'every resulting lot meets the Lot Size Map minimum' }) }] } })
    // 4.1(3) + 4.1(4)
    const s413 = find('sec.4.1', /The size of any lot resulting from a subdivision of land to which this clause applies is not to be less than the minimum size shown on the Lot Size Map in relation to that land/i)
    if (s413) {
      const excl: Cond[] = []
      const paras = under('sec.4.1').filter(s => /^sec\.4\.1-ssec\.4-para1\.\w+$/.test(s.local_id))
      const head4 = norm(under('sec.4.1').find(s => s.local_id === 'sec.4.1-ssec.4')?.raw_text)
      const items = paras.length ? paras.map(p => norm(p.raw_text).replace(/[,.]?\s*(or|and)?$/i, '')) : head4 ? [head4] : []
      for (const it of items) {
        if (/strata plan|strata schemes?/i.test(it) && !/community/i.test(it)) excl.push({ not: L('proposal.subdivision_type', it, { value: 'strata' }) })
        else if (/community land/i.test(it) && !/strata/i.test(it)) excl.push({ not: L('proposal.subdivision_type', it, { value: 'community' }) })
        else if (/strata/i.test(it) && /community/i.test(it)) excl.push({ not: L('proposal.subdivision_type', it, { value: 'strata' }) }, { not: L('proposal.subdivision_type', it, { value: 'community' }) })
        else excl.push({ not: L('unparsed', it, { text: it }) })
      }
      const appl = find('sec.4.1', /a subdivision of any land shown on the Lot Size Map/i) ?? find('sec.4.1', /shown on the Lot Size Map/i)!
      ns.push({ id: `${slug}:4.1(3)`, clause: '4.1(3)', section: 'sec.4.1-ssec.3', author: AUTHOR,
        when: { all: [SUB(appl), L('lot.on_map', find('sec.4.1', /shown on the Lot Size Map/i)!, { value: 'lot_size_map' }), ...excl] },
        then: { require: { topic: 'resulting_lot_size', cmp: 'gte', from: 'lot_size_map', unit: 'm²', kind: 'development_standard' } } })
    }
    // everything else - local clauses, local subclauses, a 2.6 / 4.1 not in Standard Instrument words - is read from the
    // graph's own rules at request time (shared/norms/from-graph.ts), which also reports what it cannot read
    // the sections each Standard Instrument norm read, so the graph's rules in them are not read twice
    const covered = [...new Set([
      ...(s261 ? ['sec.2.6-ssec.1'] : []), ...(a && b && c ? ['sec.2.6-ssec.2'] : []),
      ...(s413 ? under('sec.4.1').filter(s => /^sec\.4\.1-ssec\.[1-4]$/.test(s.local_id)).map(s => s.local_id) : []),
    ])]
    findings += write(`${OUT}/lep/${slug}.json`, d.title, slug, ns, secs, {}, unchecked, covered)
    summary.push(`${d.title}: ${ns.length} Standard Instrument norms; reads ${covered.join(', ') || 'nothing'}`)
  }
  console.log(summary.join('\n'))
  console.log(`\n${findings ? 'FAIL' : 'PASS'}: ${findings} gate findings`)
  await client.end()

  function write(file: string, instrument: string, slug: string, raw: any[], secs: any[], context: Record<string, string[]>,
                 unchecked: { clause: string; section: string; why: string }[], covered: string[] = []): number {
    const under = (root: string) => secs.filter((s: any) => s.local_id === root || s.local_id.startsWith(root + '-'))
    const ids = new Set(raw.map(n => n.id).concat(['doc_type:lep']))
    const out: Norm[] = []
    let f = 0
    for (const n of raw) {
      const clause = n.section.replace(/-.*$/, '')
      const t = under(clause).map((s: any) => norm(s.raw_text)).join(' ')
      const ctx = (context[clause] ?? []).flatMap(c => under(c).map((s: any) => norm(s.raw_text))).join(' ')
      const { norm: g, notes } = gateNorm({ ...n, instrument }, t, ctx, ids)
      for (const x of notes) console.log(`  GATE ${x}`)
      f += notes.length
      out.push(g)
    }
    // numbers: each clause's quantities are used by its norms
    const byClause = new Map<string, Norm[]>()
    for (const n of out) byClause.set(n.section.replace(/-.*$/, ''), [...(byClause.get(n.section.replace(/-.*$/, '')) ?? []), n])
    // ... over the sections the norms were read from (a clause's other subclauses are listed as unchecked, not passed)
    const unread = (sid: string) => unchecked.some(u => sid === u.section || sid.startsWith(u.section + '-'))
      || (covered.length > 0 && !covered.some(c => sid === c || sid.startsWith(c + '-')))
    for (const [clause, ns] of byClause) {
      const used = new Set(numbersIn(ns).concat([2025, 28]))  // "28 February 2025" is a date the leaves carry as text
      const qs = quantities(under(clause).filter((s: any) => s.route !== 'objective' && !unread(s.local_id)).map((s: any) => operative(s.raw_text)).join(' '))
      for (const v of [...new Set(qs)].filter(v => !used.has(v))) { console.log(`  GATE ${slug} ${clause}: the number ${v} is used by no norm`); f++ }
    }
    writeFileSync(file, JSON.stringify({ instrument, slug, covered, unchecked, norms: out.map(n => ({ ...n, text: undefined })) }, null, 1))
    return f
  }
}
main().catch(e => { console.error(e); process.exit(1) })
