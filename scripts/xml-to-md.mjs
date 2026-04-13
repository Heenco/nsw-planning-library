/**
 * Convert NSW SEPP XML to structured markdown for LLM ingest
 * Usage: node scripts/sepp-xml-to-md.mjs <xml-path> <output-md-path>
 */

import { readFileSync, writeFileSync } from 'node:fs'

const [, , xmlPath, outPath] = process.argv
if (!xmlPath || !outPath) {
  console.error('Usage: node sepp-xml-to-md.mjs <xml> <output.md>')
  process.exit(1)
}

const xml = readFileSync(xmlPath, 'utf-8')

function cleanText(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// Extract heading text from a block
function extractHeading(block) {
  const m = block.match(/<heading[^>]*>([\s\S]*?)<\/heading>/i)
  return m ? cleanText(m[1]) : ''
}

// Extract all body text excluding headings
function extractBody(block) {
  // Remove heading elements entirely
  const noHeadings = block.replace(/<heading[^>]*>[\s\S]*?<\/heading>/gi, '')
  return cleanText(noHeadings)
}

const lines = []

// Match top-level chapters (SEPPs) or parts (LEPs) — same shape, different label
const chapterRe = /<level[^>]+type="(?:chapter|part)"[^>]*>([\s\S]*?)(?=<level[^>]+type="(?:chapter|part)"|$)/g
let chapterMatch

while ((chapterMatch = chapterRe.exec(xml)) !== null) {
  const chapterBlock = chapterMatch[1]
  const chapterHeading = extractHeading(chapterBlock)
  if (chapterHeading) lines.push(`\n# ${chapterHeading}\n`)

  // Match clauses within chapter
  const clauseRe = /<level[^>]+type="clause"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)(?=<level[^>]+type="clause"|$)/g
  let clauseMatch

  while ((clauseMatch = clauseRe.exec(chapterBlock)) !== null) {
    const clauseId = clauseMatch[1]
    const clauseBlock = clauseMatch[2]
    const clauseHeading = extractHeading(clauseBlock)
    const clauseBody = extractBody(clauseBlock)

    if (clauseHeading) lines.push(`\n## ${clauseHeading} [${clauseId}]\n`)
    if (clauseBody.length > 30) lines.push(clauseBody + '\n')
  }
}

// Fallback: if no chapters matched, extract all clauses directly
if (lines.length < 5) {
  const clauseRe = /<level[^>]+type="clause"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)(?=<level[^>]+type="clause"|$)/g
  let clauseMatch
  while ((clauseMatch = clauseRe.exec(xml)) !== null) {
    const clauseId = clauseMatch[1]
    const clauseBlock = clauseMatch[2]
    const clauseHeading = extractHeading(clauseBlock)
    const clauseBody = extractBody(clauseBlock)
    if (clauseHeading) lines.push(`\n## ${clauseHeading} [${clauseId}]\n`)
    if (clauseBody.length > 30) lines.push(clauseBody + '\n')
  }
}

const md = lines.join('\n')
writeFileSync(outPath, md, 'utf-8')
console.log(`Written ${md.length} chars, ~${lines.length} sections to ${outPath}`)
