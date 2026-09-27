/**
 * Fallback downloader for councils that block plain HTTP clients.
 *
 * WHY. Council sites block at three different layers and they need three different answers:
 *   - Canterbury-Bankstown served every URL fine; the failure was ours (a malformed shortlink).
 *   - Randwick's Cloudflare wants the Sec-Fetch-* header set, which dcp-fetch-parts.mjs sends.
 *   - Cumberland returns 403 "Error 54113" (Imperva) to curl and to fetch even with the full
 *     browser header set, because it fingerprints the client rather than reading its headers.
 *
 * Only the third needs a real browser. This drives Edge through Playwright, which is already a
 * dependency of the verification scripts, and saves each part through the browser's own download
 * path so the request is indistinguishable from a person clicking the link.
 *
 * Same contract as dcp-fetch-parts.mjs - same parts.json in, same manifest out, same %PDF and size
 * validation - so a council can be switched between the two without changing anything else.
 *
 * Usage: node scripts/dcp-fetch-browser.mjs --plan <slug> --parts <parts.json> [--pace 1200]
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
// playwright is not a repo dependency (it would add ~300 MB to install for a script most runs
// never touch). Resolve it from PLAYWRIGHT_PATH, else the npx cache the verification scripts use.
const { chromium } = await (async () => {
  try { return await import('playwright') } catch { /* not installed in the repo */ }
  const cache = process.env.PLAYWRIGHT_PATH
  if (!cache) {
    console.error('playwright not found. Set PLAYWRIGHT_PATH to a playwright install, e.g.')
    console.error('  PLAYWRIGHT_PATH=%LOCALAPPDATA%/npm-cache/_npx/<hash>/node_modules/playwright')
    process.exit(2)
  }
  const dir = String(cache).split('\\').join('/')
  return await import(new URL('index.mjs', 'file:///' + dir + '/').href)
})()

const args = process.argv.slice(2)
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] }
const PLAN = arg('--plan')
const PARTS = arg('--parts')
const PACE = Number(arg('--pace') ?? 1200)
if (!PLAN || !PARTS) {
  console.error('usage: --plan <slug> --parts <parts.json> [--pace ms]')
  process.exit(2)
}

const REPO = process.cwd()
const PDF_DIR = path.join(REPO, 'public', 'EPI', 'DCPs', 'pdf', PLAN)
const MANIFEST = path.join(REPO, 'public', 'EPI', 'DCPs', 'manifests', `${PLAN}.json`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

async function main() {
  const spec = JSON.parse(await readFile(PARTS, 'utf-8'))
  await mkdir(PDF_DIR, { recursive: true })
  console.log(`${spec.title}\n${spec.parts.length} parts via browser -> ${path.relative(REPO, PDF_DIR)}\n`)

  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ acceptDownloads: true })
  const page = await ctx.newPage()

  // Visit the DCP page first. An Imperva-style gate sets a cookie on the landing page and refuses
  // direct asset requests that arrive without it.
  if (spec.source_page) {
    await page.goto(spec.source_page, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {})
    await sleep(1500)
  }

  const out = []
  let ok = 0, failed = 0, cached = 0
  for (const [i, p] of spec.parts.entries()) {
    const name = `${slug(p.part || i)}-${slug(p.title).slice(0, 60)}.pdf`
    const dest = path.join(PDF_DIR, name)
    const label = `[${i + 1}/${spec.parts.length}] ${String(p.part).padEnd(6)} ${p.title.slice(0, 44)}`

    try {
      const s = await stat(dest)
      if (s.size > 10_000) {
        const buf = await readFile(dest)
        if (buf.subarray(0, 4).toString() === '%PDF') {
          cached++
          out.push({ part: p.part, title: p.title, url: p.url, file: `${PLAN}/${name}`,
            bytes: s.size, sha256: createHash('sha256').update(buf).digest('hex') })
          console.log(`${label}  cached`)
          continue
        }
      }
    } catch { /* not held yet */ }

    try {
      // request() runs inside the browser context, so it carries the session cookies the gate set
      const res = await ctx.request.get(p.url, { timeout: 90000 })
      const buf = Buffer.from(await res.body())
      const magic = buf.subarray(0, 4).toString()
      if (!res.ok() || magic !== '%PDF' || buf.length < 10_000) {
        failed++
        console.log(`${label}  FAILED http=${res.status()} bytes=${buf.length} magic=${JSON.stringify(magic)}`)
        out.push({ part: p.part, title: p.title, url: p.url,
          error: `http=${res.status()} bytes=${buf.length} magic=${magic}` })
        await sleep(PACE)
        continue
      }
      await writeFile(dest, buf)
      ok++
      out.push({ part: p.part, title: p.title, url: p.url, file: `${PLAN}/${name}`,
        bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
      console.log(`${label}  ${(buf.length / 1e6).toFixed(1)} MB`)
    } catch (e) {
      failed++
      out.push({ part: p.part, title: p.title, url: p.url, error: String(e.message || e) })
      console.log(`${label}  ERROR ${String(e.message || e).slice(0, 60)}`)
    }
    await sleep(PACE)
  }

  await browser.close()
  console.log(`\n  ${ok} downloaded, ${cached} already held, ${failed} failed`)

  const manifest = {
    instrument: spec.instrument, title: spec.title, council: spec.council, lga: spec.lga,
    kind: 'dcp', commenced: spec.commenced, as_at: spec.as_at,
    date_evidence: spec.date_evidence, supersedes: spec.supersedes,
    source_page: spec.source_page, fetched_via: 'browser (playwright/msedge)',
    retrieved_at: new Date().toISOString().slice(0, 10),
    parts: out,
  }
  await mkdir(path.dirname(MANIFEST), { recursive: true })
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  manifest -> ${path.relative(REPO, MANIFEST)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
