/**
 * The raw inputs behind each section of /report, for one lot, so the report can be checked.
 *
 * /report reads `nsw.up_property_d_4` through the PROPERTY_SELECT projection and then explains what it
 * finds. This returns the same subjects and explains nothing: the columns as they are, the graph rows as
 * they are, and the name of the column each value came from. Read the two pages side by side and a wrong
 * number on the report is traceable to the column that carried it.
 *
 * IT READS THE REPORT'S PATH, NOT THE TESTING PAGE'S. /testing-spatial-services otherwise reads the
 * `derived` schema, which is a different build of the same subjects. Putting derived numbers under the
 * report's headings would give two answers to one question with nothing to say which is right.
 *
 * BUT IT READS THE TABLE, NOT THE PROJECTION - and that difference is the point. PROPERTY_SELECT carries
 * 123 of the table's 327 columns, and several the report asks for are not among them: every historic_*
 * column, and five of the six maps in its MAP_PROVENANCE list. The report renders those sections behind a
 * v-if on data it can never receive, so they vanish silently and look like a lot with no zoning history.
 * `projected: false` on a field below means exactly that: the value is real, and the report cannot see it.
 *
 * NO LLM. /api/property-report runs an orchestrator and writes prose; this does neither, so it answers in
 * a few hundred milliseconds and returns the same thing every time.
 */
import { withNswClient } from '../../utils/nsw-kg/pool'
import { PROPERTY_SELECT, scrubSentinels } from '../../../shared/property-columns'
import { conditionLabel } from '../../../shared/dcp-scope'
import { resolveSiteRuleScope, fetchSiteRules, siteRuleFunnel } from '../../utils/nsw-kg/site-rules'

/** A value, where it lives, and whether the report's projection carries it. */
export interface InputField {
  label: string
  /** The column in nsw.up_property_d_4. */
  column: string
  /** What /report calls it, when PROPERTY_SELECT renames it. */
  reportName: string | null
  value: string | null
  /** False when PROPERTY_SELECT does not carry this column, so /report always sees undefined. */
  projected: boolean
}

export interface InputSection {
  id: string
  /** The heading as /report prints it, so the two pages can be read together. */
  title: string
  source: string
  /** Set where the source does not cover the whole state, so a blank can be read correctly. */
  coverage: string | null
  fields: InputField[]
  rows: { columns: string[]; values: (string | number | null)[][] } | null
  note: string | null
  /** Fields whose column the report cannot see. A section where this equals the field count is dead. */
  unprojected: number
}

export interface ReportInputsResponse {
  lot: {
    address: string | null; lotSectionPlan: string | null; lga: string | null
    lat: number | null; lon: number | null; cadid: string | null
  } | null
  sections: InputSection[]
  /** How many of the table's columns PROPERTY_SELECT carries. */
  projectedTotal: number
  ms: number
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' || s.toLowerCase() === 'null' ? null : s
}

const splitMulti = (v: unknown): string[] =>
  typeof v === 'string'
    ? v.split(/[;,]/).map(x => x.trim()).filter(x => x && x.toLowerCase() !== 'null')
    : []

/**
 * [label, d_4 column, what /report calls it].
 *
 * Every column here was checked against information_schema, not guessed from the pattern: the table
 * spells riparian land "riparianlandwatercouse", without the second r, and a guess at the correct
 * spelling returns null on every lot while looking perfectly reasonable in the code.
 */
type Spec = [string, string, string | null]


const PROXIMITY: Spec[] = [
  ['Closest school', 'closest_school', null],
  ['Distance to school', 'closest_school_distance', 'closest_school_distance_m'],
  ['Closest hospital', 'closest_hospital', null],
  ['Distance to hospital', 'closest_hospital_distance', 'closest_hospital_distance_m'],
  ['Closest railway station', 'closest_railway_station', null],
  ['Distance to station', 'closest_railway_station_distance', 'closest_railway_station_distance_m'],
]

/** The six maps /report's MAP_PROVENANCE names, with the code column beside each. */
const PROVENANCE: [string, string, string | null][] = [
  ['Zoning map', 'lzn_epi_name_p', null],
  ['Height of Buildings map', 'hob_epi_name', 'hob_sym_code'],
  ['Floor Space Ratio map', 'fsr_epi_name', 'fsr_label'],
  ['Minimum Lot Size map', 'mls_epi_name', 'lsz_sym_code'],
  ['LEP layer', 'lep_lga_name', 'lep_lay_class'],
  ['DCP layer', 'dcp_council_name', 'dcp_plan_type'],
]

const HISTORY: Spec[] = [
  ['Zone', 'historic_zone', null],
  ['Class', 'historic_lay_class', null],
  ['Amendment', 'historic_amendment', null],
  ['Commenced', 'historic_commenced_date', null],
  ['Published', 'historic_published_date', null],
]



const ADDITIONAL_CONTROLS: Spec[] = [
  ['Additional zoning', 'addctrl_lzn_label', null],
  ['Additional zoning area', 'addctrl_lzn_area', null],
  ['Additional height', 'addctrl_hob_max_height_m', null],
  ['Additional height clause', 'addctrl_hob_clause', null],
  ['Additional FSR', 'addctrl_fsr_value', null],
  ['Additional FSR clause', 'addctrl_fsr_clause', null],
  ['Additional lot size', 'addctrl_ls_sym_code', null],
]

const IDENT = ['address', 'normalized_address', 'lot_section_plan', 'lga_name', 'propid',
  'centroid_lat', 'centroid_lon', 'planlabel']

const ALL_SPECS = [...PROXIMITY, ...HISTORY, ...ADDITIONAL_CONTROLS,
  ...PROVENANCE.flatMap(([l, a, b]) => (b ? [[l, a, null], [`${l} code`, b, null]] : [[l, a, null]]) as Spec[]),
  ...(['sepp_landuses', 'sepps'].map(c => ['', c, null] as Spec)),
  ...IDENT.map(c => ['', c, null] as Spec)]

const GRAPH_COVERAGE = 'The nsw graph holds 2 of 128 LEPs - Hornsby 2013 and Randwick 2012 - plus '
  + '10 SEPPs and 2 DCPs. Outside those councils this section is empty because nothing has been '
  + 'ingested, not because the lot is unconstrained. 969 audit findings on the build are open and '
  + 'untriaged.'

/**
 * The columns PROPERTY_SELECT actually carries, asked of Postgres rather than kept as a second list.
 *
 * A hand-maintained copy would drift the moment anyone edits the projection, and it would drift
 * silently - the page would keep saying "the report cannot see this" about a column the report had
 * just been given. Running the projection with LIMIT 0 costs one cheap query per process and cannot
 * be wrong.
 */
let projectedCache: Set<string> | null = null
async function projectedColumns(client: any): Promise<Set<string>> {
  if (projectedCache) return projectedCache
  const r = await client.query(`SELECT ${PROPERTY_SELECT} FROM nsw.up_property_d_4 LIMIT 0`)
  projectedCache = new Set<string>(r.fields.map((f: any) => f.name))
  return projectedCache
}

export default defineEventHandler(async (event): Promise<ReportInputsResponse> => {
  const q = getQuery(event)
  const address = str(q.address)
  const lsp = str(q.lot)
  const cadid = str(q.cadid)
  if (!address && !lsp && !cadid) {
    throw createError({ statusCode: 400, statusMessage: 'Give address, lot or cadid' })
  }
  setHeader(event, 'cache-control', 'public, max-age=60')
  const started = Date.now()

  const out = await withNswClient(async (client) => {
    // which columns exist, so a rename in the warehouse surfaces as a missing field rather than a 500
    const have = new Set((await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'nsw' AND table_name = 'up_property_d_4'`)).rows.map((r: any) => r.column_name))

    const wanted = [...new Set(ALL_SPECS.map(([, c]) => c))].filter(c => have.has(c))

    /*
     * up_property_d_4 has no cadid. The testing page opens lots by cadid, so it is resolved through
     * cadastre.lot.lotidstring, which matches lot_section_plan exactly. d_4 carries one row per
     * ADDRESS, so a strata lot has many rows behind one cadid and this takes the first.
     */
    let key = address || lsp
    let by: 'address' | 'lot_section_plan' = address ? 'address' : 'lot_section_plan'
    if (!key && cadid) {
      const l = await client.query(
        'SELECT lotidstring FROM cadastre.lot WHERE cadid = $1 LIMIT 1', [cadid])
      key = l.rows[0]?.lotidstring ?? null
      by = 'lot_section_plan'
      if (!key) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })
    }

    const where = `${by} = $1`
    const r = await client.query(
      `SELECT ${wanted.map(c => `"${c}"`).join(', ')} FROM nsw.up_property_d_4
        WHERE ${where} LIMIT 1`, [key])
    const p: any = r.rows[0]
    if (!p) return null

    const projected = await projectedColumns(client)

    /*
     * "Can the report see this" is a question about the VALUE, not the spelling. PROPERTY_SELECT
     * renames as it projects - fsr_fsr AS fsr_value, h_name AS heritage_name - so testing the raw
     * column name against the projection's output names marks every renamed column invisible and
     * cries wolf on half the page. The alias counts.
     */
    const canSee = (column: string, reportName: string | null) =>
      projected.has(column) || (reportName != null && projected.has(reportName))

    const mk = ([label, column, reportName]: Spec): InputField => ({
      label, column, reportName,
      value: str(p[column]),
      projected: canSee(column, reportName),
    })
    const section = (id: string, title: string, source: string, specs: Spec[],
      note: string | null, coverage: string | null = null): InputSection => {
      const fields = specs.filter(([, c]) => have.has(c)).map(mk)
      return { id, title, source, coverage, fields, rows: null, note,
        unprojected: fields.filter(f => !f.projected).length }
    }

    const sections: InputSection[] = []
    const D4 = 'nsw.up_property_d_4'

    sections.push(section('ri-proximity', 'Proximity & Amenity', D4, PROXIMITY,
      'Straight-line distances written by the enrichment build, not walking distance.'))

    // zoning history is four parallel comma-separated columns read positionally
    const zones = splitMulti(p.historic_zone)
    sections.push({
      id: 'ri-zoning-history', title: 'Zoning history', source: D4, coverage: null,
      fields: HISTORY.filter(([, c]) => have.has(c)).map(mk),
      rows: {
        columns: ['Zone', 'Class', 'Amendment', 'Commenced'],
        values: zones.map((z, i) => [z,
          splitMulti(p.historic_lay_class)[i] ?? null,
          splitMulti(p.historic_amendment)[i] ?? null,
          splitMulti(p.historic_commenced_date)[i] ?? null]),
      },
      note: 'Four parallel comma-separated columns read positionally, so a ragged row is a '
        + 'mis-aligned join in the enrichment rather than a real amendment.',
      unprojected: HISTORY.filter(([, c, a]) => have.has(c) && !canSee(c, a)).length,
    })

    const provRows = PROVENANCE
      .filter(([, col]) => have.has(col) && str(p[col]) != null)
      .map(([label, col, code]) => [label, col, str(p[col]),
        code && have.has(code) ? str(p[code]) : null,
        canSee(col, null) ? 'yes' : 'no'])
    sections.push({
      id: 'ri-map-provenance', title: 'Source maps & instruments', source: D4, coverage: null,
      fields: PROVENANCE.map(([l, c]) => mk([l, c, null])).filter(f => have.has(f.column)),
      rows: { columns: ['Standard', 'Column', 'Instrument', 'Code', 'Report can see it'],
        values: provRows },
      note: 'Which instrument each mapped standard was read off. Two standards naming different '
        + 'instruments on one lot is normal - a SEPP can override an LEP.',
      unprojected: PROVENANCE.filter(([, c]) => have.has(c) && !canSee(c, null)).length,
    })

    sections.push(section('ri-additional-controls', 'Additional controls on part of the lot', D4,
      ADDITIONAL_CONTROLS,
      'Set where the lot crosses a boundary on one of the standard maps, so a second control '
      + 'applies to part of it.'))

    const sepp = [...new Set(splitMulti(p.sepp_landuses))].sort()
    sections.push({
      id: 'ri-sepp-uses', title: 'Uses Permitted via SEPP', source: `${D4}.sepp_landuses`,
      coverage: 'Joined on zone alone, so it does not narrow by the SEPP\'s own land application map.',
      fields: [mk(['SEPPs naming this lot', 'sepps', null])],
      rows: { columns: ['Use'], values: sepp.map(u => [u]) },
      note: null, unprojected: 0,
    })

    // ── the graph-backed sections ───────────────────────────────────────────
    const lga = str(p.lga_name)
    /*
     * Key Numerical Rules: the report's own scope and query (site-rules.ts), run against the report's
     * own row - PROPERTY_SELECT, not the raw columns above - so each row here is a row the report
     * received. The count in the heading is the report's: rows collapse into one control per
     * topic, datum, unit, clause, comparator and condition, and subdivision rows are left to
     * Lot Requirements.
     */
    const rp = scrubSentinels((await client.query(
      `SELECT ${PROPERTY_SELECT} FROM nsw.up_property_d_4 WHERE ${where} LIMIT 1`, [key])).rows[0] ?? null)
    const scope = await resolveSiteRuleScope(client, rp)
    const [siteRules, funnel] = await Promise.all([
      fetchSiteRules(client, scope, rp.lga_name),
      siteRuleFunnel(client, scope, rp.lga_name),
    ])
    const TOPIC_ORDER = ['setback', 'height', 'fsr', 'floor_area', 'site_coverage', 'lot_size', 'width',
      'landscaping', 'deep_soil', 'open_space', 'parking', 'density', 'privacy', 'solar_access']
    const topicRank = (t: string) => { const i = TOPIC_ORDER.indexOf(t); return i < 0 ? 99 : i }
    const shown = siteRules.filter(r => r.applies_to !== 'subdivision')
    const controls = new Set(shown.map(r => [r.topic, r.measured_from ?? r.relative_to ?? '',
      r.unit ?? '', r.clause, r.comparator ?? '', conditionLabel(r)].join('|'))).size
    const subdivision = siteRules.length - shown.length
    const ruleRows = [...siteRules].sort((x, y) => topicRank(x.topic) - topicRank(y.topic)
      || String(x.clause).localeCompare(String(y.clause), undefined, { numeric: true })
      || Number(x.value) - Number(y.value))
    sections.push({
      id: 'ri-rules', title: `Key Numerical Rules (${controls})`, source: 'nsw.rule_effect via site-rules.ts',
      coverage: GRAPH_COVERAGE,
      fields: [],
      rows: {
        columns: ['Topic', 'Clause', 'Axis', 'Applies to', 'Comparator', 'Value', 'Unit', 'Datum',
          'Applies when', 'Section', 'Document'],
        values: ruleRows.map((r: any) => [r.topic, r.clause, r.axis, r.applies_to, str(r.comparator),
          r.value == null ? null : Number(r.value), str(r.unit), str(r.measured_from ?? r.relative_to),
          str(conditionLabel(r)), str(r.section_heading), r.source_document]),
      },
      note: `Proposed use ${scope.proposedUse} (picked the way the report picks it when none is chosen). `
        + `Land uses in scope: ${scope.landUses.join(', ') || 'none'}. `
        + `Development types: ${scope.devTypes.join(', ') || 'none'}. `
        + `Of the council DCP's ${funnel.effects} effects, ${funnel.noValue} carry no value, `
        + `${funnel.offTopic} have a topic the table does not render, ${funnel.outOfScope} name neither `
        + `these uses nor these development types, and ${funnel.kept} reach the report. `
        + `Those give ${siteRules.length} rows (an effect matched through two scopes is two rows, and DISTINCT merges effects `
        + `that read identically); `
        + `${subdivision} are subdivision controls shown under Lot Requirements, and the other `
        + `${shown.length} collapse into the ${controls} controls in the heading. `
        + 'The report\'s use and development-type pickers re-scope its table through /api/frontage-dcp, '
        + 'which narrows to the one use chosen, so after a pick the report can show fewer.',
      unprojected: 0,
    })

    const docs = await client.query(
      `SELECT doc_type, title, lga_name, as_at_date, commenced_date, ingested_at
         FROM nsw.document
        WHERE lga_name IS NULL OR upper(lga_name) = upper($1)
        ORDER BY hierarchy_level, title`, [lga ?? ''])
    sections.push({
      id: 'ri-governing-docs', title: 'Governing Planning Documents', source: 'nsw.document',
      coverage: GRAPH_COVERAGE, fields: [],
      rows: {
        columns: ['Type', 'Title', 'LGA', 'As at', 'Commenced', 'Ingested'],
        values: docs.rows.map((d: any) => [d.doc_type, d.title, str(d.lga_name),
          str(d.as_at_date), str(d.commenced_date), (str(d.ingested_at) ?? '').slice(0, 10) || null]),
      },
      note: 'A SEPP has no LGA, so every lot gets all ten. Only the LEP and DCP rows are specific '
        + 'to this council.',
      unprojected: 0,
    })

    return {
      lot: {
        address: str(p.address), lotSectionPlan: str(p.lot_section_plan), lga,
        cadid: cadid ?? null,
        lat: p.centroid_lat == null ? null : Number(p.centroid_lat),
        lon: p.centroid_lon == null ? null : Number(p.centroid_lon),
      },
      sections,
      projectedTotal: projected.size,
    }
  })

  if (!out) throw createError({ statusCode: 404, statusMessage: 'No property found' })
  return { ...out, ms: Date.now() - started }
})

