/**
 * Add one LEP's clause 4.6 - "Exceptions to development standards" - to the graph.
 *
 * WHY THIS CLAUSE, AND WHY A SCRIPT OF ITS OWN
 *
 * cl 4.6 is the variation mechanism: it is what lets a consent authority approve development that
 * contravenes a development standard, so a resolver that does not carry it will report every
 * standard as absolute. It is also the clause closest to boilerplate across NSW, which makes it the
 * cheapest coverage available - one extraction, many councils.
 *
 * But "closest to boilerplate" is not "identical", and the difference is the point. Measured over
 * the 147 LEP XMLs in Notebooks/Data/lep_xml, every one has a cl 4.6 and there are **119 distinct
 * texts**. The opening - objectives, the power to contravene in (2), the two tests in (3), the
 * record in (4), the rural subdivision bar in (6) - is shared verbatim for ~770 characters. What
 * differs is the exclusion list in subclause (8), and that tail is where a council puts its own
 * hard limits: Parramatta caps height and FSR variation in the City Centre at 5%, Randwick excludes
 * cl 6.16(3)(b), Hornsby excludes neither. Treating the clause as boilerplate loses exactly the
 * part that decides an application.
 *
 * STRUCTURE is parsed by the repo's own `parseNswXml` - the same parser that produced the Hornsby
 * and Randwick copies already in the graph - so all three are byte-comparable. Writing a second
 * XML reader for this would have guaranteed they were not: the first draft of this script quietly
 * dropped the `Note-` label and the trailing note after each list, which is 300 of the 479
 * characters in cl 4.6(3).
 *
 * EFFECTS are declared per council in COUNCIL_EFFECTS, and each is gated on its `span` being a
 * verbatim substring of the subclause it names. A span that does not match aborts the run rather
 * than being corrected, which is the rule the rest of the pipeline enforces.
 *
 * Identity is by `instrument_slug`, never by title: nsw.document has no unique constraint on title,
 * and DELETE-by-title is how a duplicate document gets created (docs/dcp-onboarding-runbook.md).
 * Re-running replaces only this document's cl 4.6 sections and its cl 4.6 rule.
 *
 * Usage:
 *   npx tsx scripts/add-lep-clause-46.ts --epi epi-2023-0117 --lga Parramatta      # dry run
 *   npx tsx scripts/add-lep-clause-46.ts --epi epi-2023-0117 --lga Parramatta --apply
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { flattenTree, parseNswXml } from '../server/utils/nsw-kg/parsers/nsw-xml-parser'

const XML_DIR = process.env.LEP_XML_DIR
  || 'C:\\Users\\manni.kheradmandi\\OneDrive - COSOL GLOBAL\\Notebooks\\Data\\lep_xml'

interface Effect {
  subclause: string
  topic: string
  comparator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between'
  value: number
  unit: string
  relative_to: string
  span: string
}
interface Scope { subclause: string; dimension: string; value: string; polarity: 'applies' | 'excludes'; span: string }
interface Spent { subclause: string; why: string }

/**
 * What each council's cl 4.6 states as an operative limit, beyond the shared boilerplate.
 *
 * Only what is live TODAY. A paragraph the instrument has since switched off goes in `spent` and
 * deliberately produces no effect row - a rule layer that reports a dead provision as live is a
 * false positive, which is the failure class this pipeline exists to avoid.
 */
const COUNCIL_EFFECTS: Record<string, { effects: Effect[]; scope: Scope[]; spent: Spent[] }> = {
  'epi-2023-0117': {
    effects: [
      { subclause: 'sec.4.6-ssec.8-para1.ca', topic: 'height', comparator: 'lte', value: 5,
        unit: 'percent', relative_to: 'the development standard',
        span: 'a development standard relating to the height or floor space ratio of a building by more than 5%' },
      { subclause: 'sec.4.6-ssec.8-para1.ca', topic: 'fsr', comparator: 'lte', value: 5,
        unit: 'percent', relative_to: 'the development standard',
        span: 'a development standard relating to the height or floor space ratio of a building by more than 5%' },
    ],
    scope: [
      { subclause: 'sec.4.6-ssec.8-para1.ca', dimension: 'area_label', value: 'Parramatta City Centre',
        polarity: 'applies', span: 'for Parramatta City Centre' },
    ],
    spent: [
      { subclause: 'sec.4.6-ssec.8-para1.cb',
        why: 'Subclause (8A) reads "Subclause (8)(cb) does not apply from the beginning of 31 July 2024", '
          + 'so the Epping Town Centre "Area D" exclusion of cl 4.4 is no longer operative. Recorded as a '
          + 'note rather than as a rule_effect so the graph does not report a spent provision as live.' },
    ],
  },
}

const argv = process.argv.slice(2)
const arg = (k: string, d: string | null = null) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const APPLY = argv.includes('--apply')
const EPI = arg('epi')
if (!EPI) { process.stderr.write('need --epi\n'); process.exit(1) }
const XML = arg('xml', path.join(XML_DIR, `${EPI}.xml`))!

async function main() {
  if (!fs.existsSync(XML)) { process.stderr.write(`no XML at ${XML}\n`); process.exit(1) }
  const parsed = parseNswXml(fs.readFileSync(XML, 'utf8'))
  const TITLE = arg('title', parsed.title)!
  const LGA = arg('lga', null)
  if (!LGA) { process.stderr.write('need --lga\n'); process.exit(1) }
  const slug = TITLE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const sections = flattenTree(parsed.tree)
    .filter(s => s.local_id === 'sec.4.6' || s.local_id.startsWith('sec.4.6-'))
  if (!sections.length) { process.stderr.write('no clause 4.6 in that XML\n'); process.exit(1) }

  const byId = new Map(sections.map(s => [s.local_id, s]))
  const whole = sections.map(s => s.raw_text).join(' ').replace(/\s+/g, ' ').trim()

  process.stdout.write(`${TITLE}\n${EPI}  consolidation ${parsed.consolidation_id ?? '?'}`
    + `  published ${parsed.publication_date ?? '?'}\n`
    + `${sections.length} sections, ${whole.length} chars\n\n`)
  for (const s of sections) {
    process.stdout.write(`  ${s.local_id.padEnd(32)} ${s.level.padEnd(10)} `
      + `${(s.number ?? '').padEnd(7)}${s.raw_text.slice(0, 70)}\n`)
  }

  const spec = COUNCIL_EFFECTS[EPI] ?? { effects: [], scope: [], spent: [] }

  const fail: string[] = []
  for (const e of [...spec.effects, ...spec.scope]) {
    const sec = byId.get(e.subclause)
    const hay = (sec?.raw_text ?? '').replace(/\s+/g, ' ')
    if (!hay.includes(e.span.replace(/\s+/g, ' '))) fail.push(`${e.subclause}: ${e.span.slice(0, 64)}…`)
  }
  if (fail.length) {
    process.stderr.write('\nSPAN GATE FAILED - not verbatim in the subclause they name:\n')
    for (const f of fail) process.stderr.write(`  ${f}\n`)
    process.stderr.write('nothing written.\n')
    process.exit(1)
  }
  process.stdout.write(`\nspan gate: ${spec.effects.length + spec.scope.length} spans, all verbatim\n`)
  for (const s of spec.spent) process.stdout.write(`spent (no effect row): ${s.subclause}\n  ${s.why}\n`)

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 300_000 })
  await db.connect()
  try {
    const { rows: peers } = await db.query(
      `SELECT d.title, string_agg(s.raw_text, ' ' ORDER BY s.sort_order) AS txt
         FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id
        WHERE d.doc_type = 'lep' AND (s.local_id = 'sec.4.6' OR s.local_id LIKE 'sec.4.6-%')
          AND d.instrument_slug <> $1
        GROUP BY d.title ORDER BY d.title`, [slug])
    process.stdout.write('\nagainst the LEPs already in the graph:\n')
    for (const p of peers) {
      const theirs = String(p.txt).replace(/\s+/g, ' ').trim()
      let i = 0
      while (i < Math.min(theirs.length, whole.length) && theirs[i] === whole[i]) i++
      process.stdout.write(`  ${p.title.padEnd(42)} identical for ${String(i).padStart(5)} chars`
        + `  (theirs ${theirs.length}, ours ${whole.length})\n`)
      if (i < Math.min(theirs.length, whole.length)) {
        process.stdout.write(`      theirs: …${theirs.slice(i, i + 90)}\n`)
        process.stdout.write(`      ours  : …${whole.slice(i, i + 90)}\n`)
      }
    }

    if (!APPLY) { process.stdout.write('\n--apply not given; nothing written\n'); return }

    await db.query('BEGIN')
    const { rows: [doc] } = await db.query(
      `INSERT INTO nsw.document (title, doc_type, scope, hierarchy_level, lga_name, source_url,
                                 raw_path, as_at_date, consolidation_id, ingest_model,
                                 ingest_provider, instrument_slug, pending_parts)
       VALUES ($1,'lep','local',3,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,
               'add-lep-clause-46.ts','deterministic',$7,$8)
       ON CONFLICT (instrument_slug) DO UPDATE
         SET consolidation_id = COALESCE(nsw.document.consolidation_id, EXCLUDED.consolidation_id)
       RETURNING id`,
      // deliberately narrow: an existing row may have come from a full stage-0 ingest, and this
      // script must not stamp "only clause 4.6 is in the graph" over a document that holds it all
      [TITLE, LGA, `https://legislation.nsw.gov.au/view/html/inforce/current/${EPI}`, XML,
        parsed.publication_date, parsed.consolidation_id, slug,
        ['Only clause 4.6 is in the graph. The rest of this LEP has not been ingested.']])

    /**
     * Sections are only inserted when the document does not already have them.
     *
     * A full stage-0 ingest (`ingest-nsw.ts --doc <label> --stage0-only`) owns the whole section
     * tree, and clause 4.6 is part of it. Deleting and reinserting just this clause would strip its
     * parent_id - the parent is Part 4, which is not in this script's filtered set - and orphan the
     * clause from its Part. So: reuse what is there, and only build the subtree when this script is
     * the one bringing the document into existence.
     */
    const { rows: existing } = await db.query(
      `SELECT local_id, id FROM nsw.section
        WHERE document_id = $1 AND (local_id = 'sec.4.6' OR local_id LIKE 'sec.4.6-%')`, [doc.id])
    const ids = new Map<string, string>(existing.map((r: any) => [r.local_id, r.id]))
    if (ids.size) {
      process.stdout.write(`reusing ${ids.size} clause 4.6 sections already in the document\n`)
    } else {
      for (const s of sections) {
        const { rows: [row] } = await db.query(
          `INSERT INTO nsw.section (document_id, parent_id, local_id, level, number, heading,
                                    raw_text, depth, sort_order, source_file, page)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [doc.id, s.parent_local_id ? ids.get(s.parent_local_id) ?? null : null, s.local_id,
            s.level, s.number, s.heading, s.raw_text, s.depth, s.sort_order, XML, s.page])
        ids.set(s.local_id, row.id)
      }
    }

    await db.query('DELETE FROM nsw.rule WHERE document_id = $1 AND rule_key = $2',
      [doc.id, `${EPI}:c:4.6`])
    const { rows: [rule] } = await db.query(
      `INSERT INTO nsw.rule (document_id, section_id, rule_key, clause, role, kind, src,
                             instrument_rank, precedence, provision_ref, part, notes)
       VALUES ($1,$2,$3,'4.6','variation_mechanism','test','structural',20,40,'cl 4.6','Part 4',$4)
       RETURNING id`,
      [doc.id, ids.get('sec.4.6'), `${EPI}:c:4.6`,
        spec.spent.map(s => `${s.subclause}: ${s.why}`).join(' ') || null])

    for (const e of spec.effects) {
      await db.query(
        `INSERT INTO nsw.rule_effect (rule_id, effect_type, topic, comparator, value, unit,
                                      relative_to, source_span)
         VALUES ($1,'numeric',$2,$3,$4,$5,$6,$7)`,
        [rule.id, e.topic, e.comparator, e.value, e.unit, e.relative_to, e.span])
    }
    for (const a of spec.scope) {
      await db.query(
        `INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [rule.id, a.dimension, a.value, a.polarity, a.span])
    }
    await db.query('COMMIT')

    const { rows: [n] } = await db.query(
      `SELECT (SELECT count(*) FROM nsw.section WHERE document_id=$1) secs,
              (SELECT count(*) FROM nsw.rule_effect WHERE rule_id=$2) effects,
              (SELECT count(*) FROM nsw.rule_applicability WHERE rule_id=$2) scope`,
      [doc.id, rule.id])
    process.stdout.write(`\nwrote ${n.secs} sections, 1 rule, ${n.effects} effects, ${n.scope} applicability\n`)
  } catch (e: any) {
    await db.query('ROLLBACK').catch(() => {})
    process.stderr.write(`\nFAILED: ${e.message}\nnothing written.\n`)
    process.exitCode = 1
  } finally {
    await db.end()
  }
}

main()
