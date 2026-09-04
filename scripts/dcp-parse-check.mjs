/**
 * Check the stage-1 parser against a converted DCP before anything is
 * written to the database.
 *
 * Usage: node scripts/dcp-parse-check.mjs [path.html]
 */

import { readFileSync } from 'node:fs'
import { parseDcpHtml } from './lib/dcp-html-parse.mjs'

const file = process.argv[2] || 'public/EPI/DCPs/hornsby-dcp-2024.html'
const { meta, sections } = parseDcpHtml(readFileSync(file, 'utf8'))
const L = (s = '') => process.stdout.write(s + '\n')

L(`source     : ${meta.source}`)
L(`pages      : ${meta.pages}   generated: ${meta.generated}`)
L(`sections   : ${sections.length}`)

const by = (f) => sections.reduce((m, s) => (m[f(s)] = (m[f(s)] ?? 0) + 1, m), {})
L(`\nby kind    : ${JSON.stringify(by((s) => s.kind))}`)
L(`by rubric  : ${JSON.stringify(by((s) => s.rubric ?? '-'))}`)
L(`parts      : ${new Set(sections.map((s) => s.part).filter(Boolean)).size}`)

const withText = sections.filter((s) => s.text.length > 0)
const withList = sections.filter((s) => s.lists.length > 0)
const withTable = sections.filter((s) => s.tables.length > 0)
const withFig = sections.filter((s) => s.figures.length > 0)
L(`\ncarrying   : ${withText.length} text, ${withList.length} lists, `
  + `${withTable.length} tables, ${withFig.length} figures`)

// The failure mode that ruined the old ingest was oversized sections: one
// heading swallowing 60k characters. Own-text only should keep these small.
const sizes = sections.map((s) => s.text.length + s.lists.join(' ').length).sort((a, b) => b - a)
const bucket = (lo, hi) => sizes.filter((n) => n >= lo && n < hi).length
L(`\nsection size (own text + list items):`)
L(`  0        ${sizes.filter((n) => n === 0).length}`)
L(`  1-500    ${bucket(1, 500)}`)
L(`  500-2k   ${bucket(500, 2000)}`)
L(`  2k-8k    ${bucket(2000, 8000)}`)
L(`  >8k      ${sizes.filter((n) => n >= 8000).length}     <- the old ingest failed 85% of these`)
L(`  largest  ${sizes[0]} chars`)

L(`\ncontrols blocks with content: `
  + `${sections.filter((s) => s.rubric === 'controls' && (s.text || s.lists.length || s.tables.length)).length}`
  + ` / ${sections.filter((s) => s.rubric === 'controls').length}`)

const t = withTable.flatMap((s) => s.tables)
L(`\ntables parsed: ${t.length}`)
L(`  with caption : ${t.filter((x) => x.caption).length}`)
L(`  with headers : ${t.filter((x) => x.headers.length).length}`)
L(`  ragged rows  : ${t.filter((x) => x.rows.some((r) => r.length !== x.headers.length)).length}`)

const sample = t.find((x) => /setback/i.test(x.caption ?? '') && x.rows.length > 2) ?? t[0]
if (sample) {
  L(`\nsample table — ${sample.caption ?? '(no caption)'}`)
  L(`  headers: ${JSON.stringify(sample.headers)}`)
  for (const r of sample.rows.slice(0, 4)) L(`  row    : ${JSON.stringify(r.map((c) => c.slice(0, 34)))}`)
}

const clause = sections.find((s) => s.number === '4.2.1')
if (clause) {
  L(`\nsample clause 4.2.1:`)
  L(`  id=${clause.id} pages ${clause.pageStart}-${clause.pageEnd} part=${clause.part}`)
  const kids = sections.filter((s) => s.id?.startsWith(clause.id + '.'))
  for (const k of kids.slice(0, 4)) {
    L(`    ${String(k.rubric ?? k.kind).padEnd(12)} ${String(k.heading).slice(0, 34).padEnd(35)} `
      + `text=${k.text.length} list=${k.lists.length} tables=${k.tables.length}`)
  }
}
