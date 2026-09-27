/**
 * Check every part has a usable text layer BEFORE converting it.
 *
 * WHY. scripts/docling-extract.py runs with do_ocr = False, deliberately - RapidOCR throws
 * std::bad_alloc on large pages on Windows. So a scanned, image-only PDF converts to NOTHING, and
 * it does it silently: the run succeeds, the output is empty, and nobody knows a chapter is
 * missing until someone looks for a control that should be there.
 *
 * Canterbury-Bankstown chapter 11.16 is the case that proves it: 57 pages at 1 char/page, while
 * every other part of that plan runs 707-1,900. It is also the chapter that sets the plan's
 * amendment date, so the newest part of the instrument is the unreadable one.
 *
 * Under ~200 chars/page means no usable text layer - that part needs OCR or a different source.
 *
 * pdftotext emits one form feed PER PAGE INCLUDING THE LAST, so the form-feed count IS the page
 * count. The runbook records adding one and briefly overstating Hornsby as 490 pages against the
 * converter's correct 489.
 *
 * Usage: node scripts/dcp-preflight.mjs <plan-folder> [<plan-folder>...]
 *        node scripts/dcp-preflight.mjs --all          (every folder under DCPs/pdf)
 */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const REPO = process.cwd()
const PDF_DIR = path.join(REPO, 'public', 'EPI', 'DCPs', 'pdf')
const FLOOR = 200

const args = process.argv.slice(2)
if (!args.length) { console.error('usage: dcp-preflight.mjs <plan-folder>... | --all'); process.exit(2) }

async function folders() {
  if (!args.includes('--all')) return args
  const out = []
  for (const e of await readdir(PDF_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('_')) out.push(e.name)
  }
  return out
}

async function main() {
  let totalPages = 0, bad = [], checked = 0
  for (const plan of await folders()) {
    const dir = path.join(PDF_DIR, plan)
    let files
    try { files = (await readdir(dir)).filter(f => f.endsWith('.pdf')) } catch { continue }
    if (!files.length) continue
    console.log(`\n${plan}  (${files.length} parts)`)
    for (const f of files.sort()) {
      const full = path.join(dir, f)
      let txt = ''
      try { txt = (await run('pdftotext', ['-q', full, '-'], { maxBuffer: 1 << 28 })).stdout }
      catch (e) { console.log(`  ${f.slice(0, 54).padEnd(56)} pdftotext FAILED`); bad.push({ plan, f, why: 'pdftotext failed' }); continue }
      // one \f per page including the last: the count IS the page count, do not add one
      const pages = (txt.match(/\f/g) ?? []).length
      const chars = txt.replace(/\s/g, '').length
      const cpp = pages ? Math.round(chars / pages) : 0
      totalPages += pages
      checked++
      const flag = cpp < FLOOR ? '  <-- NO TEXT LAYER' : ''
      if (cpp < FLOOR) bad.push({ plan, f, pages, cpp })
      console.log(`  ${f.slice(0, 54).padEnd(56)} ${String(pages).padStart(4)}pp ${String(cpp).padStart(5)} chars/pp${flag}`)
    }
  }
  console.log(`\n${checked} parts, ${totalPages.toLocaleString()} pages`)
  // Docling runs 1-8 s/page, so the page count is the only honest estimate of the batch
  console.log(`  at 1-8 s/page that is ${(totalPages / 3600).toFixed(1)}-${(totalPages * 8 / 3600).toFixed(1)} hours of conversion`)
  if (bad.length) {
    console.log(`\n  ${bad.length} parts have no usable text layer and will convert to nothing:`)
    for (const b of bad) console.log(`    ${b.plan}/${b.f}  ${b.pages ?? '?'}pp ${b.cpp ?? '?'} chars/pp`)
  } else {
    console.log('  every part has a text layer')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
