/**
 * Harvest DCP source PDFs using PropCode's free library as the index.
 *
 * WHY THIS EXISTS. Onboarding a council by hand means finding its DCP page, reading which
 * instrument is actually in force, enumerating 15-60 part PDFs and getting each past whatever WAF
 * the council bought. Three councils in, that had already produced three different blocking
 * mechanisms and one malformed-URL bug of my own. PropCode publishes a free library that has
 * already done the index-building: one JSON call lists 278 NSW DCPs with the council and the
 * amendment date, and each document page carries its parts.
 *
 * WHAT IT TAKES FROM WHERE, which is the important part:
 *   - the INDEX (which instrument, which parts, what date) comes from PropCode
 *   - the BYTES come from datocms-assets.com, PropCode's own CDN - open, no WAF
 *   - the PROVENANCE recorded for every part is BOTH that CDN url and the council's own
 *     `externalUrl`, because the council is the authoritative publisher and a manifest that cites
 *     only an aggregator cannot be checked against the source.
 *
 * `lastAmended` is triage, not authority. The Planning Portal register taught that lesson - it
 * lists "Hornsby DCP 2013 - 2019" for a council whose plan is HDCP 2024 - and an aggregator can be
 * stale the same way. It is recorded as `index_last_amended`, kept separate from `as_at`, which
 * still has to come from the document's own words per the runbook.
 *
 * Courtesy: paced, and it fetches each document page once. These are public planning instruments,
 * but the bandwidth is someone else's.
 *
 * Usage:
 *   node scripts/dcp-harvest-library.mjs --councils "Hornsby,Ryde"   [--dry-run] [--pace 1500]
 *   node scripts/dcp-harvest-library.mjs --councils-file <file.txt>  [--limit 5]
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] }
const DRY = args.includes('--dry-run')
const PACE = Number(arg('--pace') ?? 1500)
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null

const REPO = process.cwd()
const OUT_PDF = path.join(REPO, 'public', 'EPI', 'DCPs', 'pdf')
const OUT_MAN = path.join(REPO, 'public', 'EPI', 'DCPs', 'manifests')
const LIST = 'https://app.propcode.com.au/api/library/document/nsw?page=1&pageSize=600&all=true'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')

async function councilList() {
  const f = arg('--councils-file')
  if (f) return (await readFile(f, 'utf-8')).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const c = arg('--councils')
  if (!c) { console.error('give --councils "A,B" or --councils-file <path>'); process.exit(2) }
  return c.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * The document page server-renders an `initialDoc` object carrying every part with both urls.
 * Pulling it out of the RSC payload avoids a browser: the payload is escaped JSON inside a script
 * tag, so the braces are matched rather than regexed.
 */
function extractInitialDoc(html) {
  // The key is ESCAPED in the RSC payload - the page contains initialDoc\\":{ - so searching for
  // the quoted form finds nothing. Match the bare identifier, brace-match from there (braces are
  // not escaped), then unescape once before parsing.
  const i = html.indexOf('initialDoc')
  if (i < 0) return null
  let depth = 0, start = -1
  for (let j = i; j < html.length; j++) {
    const ch = html[j]
    if (ch === '{') { if (depth === 0) start = j; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const raw = html.slice(start, j + 1)
        for (const cand of [raw.replace(/\\"/g, '"'), raw]) {
          try {
            const o = JSON.parse(cand)
            if (o && Array.isArray(o.files)) return o
          } catch { /* try the next form */ }
        }
        return null
      }
    }
  }
  return null
}

async function main() {
  const wanted = await councilList()
  console.log(`fetching the NSW library index…`)
  const all = await (await fetch(LIST, { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json()
  const dcps = all.filter(d => d.type === 'dcp')

  // Pattern Book is state-wide and attached to many councils; it is not a council DCP and
  // picking "most recently amended" without excluding it makes it every council's answer.
  const isCouncilDcp = d => !/pattern book/i.test(d.name)

  const picks = []
  for (const w of wanted) {
    const mine = dcps.filter(d => isCouncilDcp(d)
      && d.councils.some(c => norm(c.name) === norm(w) || norm(c.name).includes(norm(w))
        || norm(w).includes(norm(c.name))))
    if (!mine.length) { console.log(`  ${w}: no DCP in the index`); continue }
    for (const d of mine) picks.push({ council: w, doc: d })
  }
  const todo = LIMIT ? picks.slice(0, LIMIT) : picks
  console.log(`${todo.length} documents across ${wanted.length} councils\n`)

  let files = 0, bytes = 0, failed = 0
  for (const [i, { council, doc }] of todo.entries()) {
    const head = `[${i + 1}/${todo.length}] ${council} · ${doc.name}`
    const page = `https://app.propcode.com.au/library/document/nsw/${doc.publicId}/file/1`
    let info = null
    try {
      const html = await (await fetch(page, { headers: { 'User-Agent': UA } })).text()
      info = extractInitialDoc(html)
    } catch (e) { /* reported below */ }
    if (!info?.files?.length) {
      failed++
      console.log(`${head}\n    could not read its file list`)
      await sleep(PACE)
      continue
    }
    console.log(`${head}  (${info.files.length} parts, amended ${doc.lastAmended})`)

    const plan = slug(doc.name)
    const dir = path.join(OUT_PDF, plan)
    if (!DRY) await mkdir(dir, { recursive: true })
    const parts = []
    for (const f of info.files.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const name = `${String(f.order ?? 0).padStart(2, '0')}-${slug(f.name).slice(0, 62)}.pdf`
      const dest = path.join(dir, name)
      const row = { part: f.name, order: f.order, file: `${plan}/${name}`,
        url: f.fileUrl, council_url: f.externalUrl }
      try {
        const s = await stat(dest)
        if (s.size > 10_000) {
          const buf = await readFile(dest)
          if (buf.subarray(0, 4).toString() === '%PDF') {
            parts.push({ ...row, bytes: s.size,
              sha256: createHash('sha256').update(buf).digest('hex') })
            console.log(`    cached   ${f.name.slice(0, 54)}`)
            continue
          }
        }
      } catch { /* not held */ }
      if (DRY) { console.log(`    would   ${f.name.slice(0, 54)}`); parts.push(row); continue }
      try {
        const res = await fetch(f.fileUrl, { headers: { 'User-Agent': UA } })
        const buf = Buffer.from(await res.arrayBuffer())
        // status is not the test: a challenge or error page is a valid 200 full of HTML
        if (!res.ok || buf.subarray(0, 4).toString() !== '%PDF' || buf.length < 10_000) {
          failed++
          parts.push({ ...row, error: `http=${res.status} bytes=${buf.length}` })
          console.log(`    FAILED  ${f.name.slice(0, 44)} http=${res.status} bytes=${buf.length}`)
        } else {
          await writeFile(dest, buf)
          files++; bytes += buf.length
          parts.push({ ...row, bytes: buf.length,
            sha256: createHash('sha256').update(buf).digest('hex') })
          console.log(`    ${(buf.length / 1e6).toFixed(1).padStart(5)} MB  ${f.name.slice(0, 50)}`)
        }
      } catch (e) {
        failed++
        parts.push({ ...row, error: String(e.message || e) })
        console.log(`    ERROR   ${f.name.slice(0, 44)} ${String(e.message || e).slice(0, 40)}`)
      }
      await sleep(PACE)
    }

    if (!DRY) {
      await mkdir(OUT_MAN, { recursive: true })
      await writeFile(path.join(OUT_MAN, `${plan}.json`), JSON.stringify({
        instrument: plan, title: doc.name, council: council, lga: council, kind: 'dcp',
        // triage, not authority - `as_at` still comes from the document's own words
        index_last_amended: doc.lastAmended,
        index_source: 'PropCode free library (app.propcode.com.au/library/nsw)',
        source_page: info.externalUrl ?? null,
        bytes_from: 'datocms-assets.com (PropCode CDN); council_url on each part is the publisher',
        retrieved_at: new Date().toISOString().slice(0, 10),
        parts,
      }, null, 2) + '\n')
    }
    await sleep(PACE)
  }

  console.log(`\n  ${files} files, ${(bytes / 1e9).toFixed(2)} GB, ${failed} failed`)
}

main().catch(e => { console.error(e); process.exit(1) })
