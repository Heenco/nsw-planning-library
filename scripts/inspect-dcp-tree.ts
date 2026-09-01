/**
 * Inspect the structured-md parser output for the DCPs in public/EPI/DCPs.
 *
 * Offline — reads local markdown only, touches no database.
 *
 *   npx tsx scripts/inspect-dcp-tree.ts                    # all DCPs, summary
 *   npx tsx scripts/inspect-dcp-tree.ts randwick           # one, with detail
 *   npx tsx scripts/inspect-dcp-tree.ts randwick 3.3.2     # show one clause
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  parseStructuredMd, flattenTree, bindingSections, citationPath,
  type ParseStats, type FlatSection,
} from '../server/utils/nsw-kg/parsers/structured-md-parser'

const DCP_DIR = path.join(process.cwd(), 'public', 'EPI', 'DCPs')

function parseFile(file: string) {
  const md = readFileSync(path.join(DCP_DIR, file), 'utf8')
  let stats: ParseStats | undefined
  const { tree } = parseStructuredMd(md, {
    title: file.replace(/\.md$/, ''),
    onStats: (s) => { stats = s },
  })
  const flat = flattenTree(tree)
  return { tree, flat, stats: stats! }
}

function summary() {
  const files = readdirSync(DCP_DIR).filter((f) => f.endsWith('.md')).sort()

  console.log(
    'document'.padEnd(34) +
    'head'.padStart(6) + 'part'.padStart(6) + 'clause'.padStart(8) +
    'rubric'.padStart(8) + 'scope'.padStart(7) + 'toc'.padStart(6) +
    'roots'.padStart(7) + 'depth'.padStart(7) + 'binding'.padStart(9),
  )
  console.log('-'.repeat(98))

  let totals = { headings: 0, binding: 0 }

  for (const f of files) {
    const { flat, stats } = parseFile(f)
    const binding = bindingSections(flat).length
    totals.headings += stats.headings
    totals.binding += binding

    console.log(
      f.replace(/\.md$/, '').slice(0, 33).padEnd(34) +
      String(stats.headings).padStart(6) +
      String(stats.parts).padStart(6) +
      String(stats.clauses).padStart(8) +
      String(stats.rubrics).padStart(8) +
      String(stats.scopes).padStart(7) +
      String(stats.tocDropped).padStart(6) +
      String(stats.rootNodes).padStart(7) +
      String(stats.maxDepth).padStart(7) +
      String(binding).padStart(9),
    )
  }

  console.log('-'.repeat(98))
  console.log(
    `${files.length} documents · ${totals.headings} headings · ` +
    `${totals.binding} binding sections (Controls / Requirements with body text)`,
  )
  console.log(
    '\nroots = top-level nodes. Before this rewrite every heading was a root ' +
    '(depth 0), because\nDocling emits all headings at the same `##` level and ' +
    'the tree was built from hash count.',
  )
}

function detail(match: string, clause?: string) {
  const files = readdirSync(DCP_DIR).filter((f) => f.endsWith('.md') && f.includes(match))
  if (files.length === 0) {
    console.error(`No DCP matching "${match}". Available:`)
    for (const f of readdirSync(DCP_DIR).filter((x) => x.endsWith('.md'))) console.error('  ' + f)
    process.exit(1)
  }

  for (const f of files) {
    const { flat, stats } = parseFile(f)
    console.log(`\n═══ ${f} ═══`)
    console.log(JSON.stringify(stats, null, 2))

    console.log('\n── parts detected ──')
    for (const s of flat.filter((x) => x.block_kind === 'part')) {
      console.log(`  ${s.number}  ${s.heading}`)
    }

    console.log('\n── rubric distribution ──')
    const byRubric = new Map<string, number>()
    for (const s of flat) {
      const k = s.rubric ?? '(none)'
      byRubric.set(k, (byRubric.get(k) ?? 0) + 1)
    }
    for (const [k, v] of [...byRubric].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(14)} ${v}`)
    }

    if (clause) {
      console.log(`\n── sections whose number is ${clause} ──`)
      const hits = flat.filter((s) => s.number === clause)
      if (hits.length === 0) console.log('  (none)')
      for (const h of hits) {
        console.log(`\n  local_id : ${h.local_id}`)
        console.log(`  citation : ${citationPath(flat, h.local_id)}`)
        console.log(`  children :`)
        for (const c of flat.filter((s) => s.parent_local_id === h.local_id)) {
          const label = `${c.block_kind}${c.rubric ? `/${c.rubric}` : ''}`
          console.log(`     ${label.padEnd(18)} ${(c.heading ?? '').slice(0, 44).padEnd(46)} ${c.raw_text.length}ch`)
          console.log(`       → ${citationPath(flat, c.local_id)}`)
        }
      }
    }
  }
}

const [, , match, clause] = process.argv
if (match) detail(match, clause)
else summary()
