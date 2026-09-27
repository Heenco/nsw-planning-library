/**
 * Download one council's DCP parts, validate each, and write a source manifest.
 *
 * WHY A SCRIPT. The runbook's step 2 is a curl incantation repeated by hand per part. Randwick has
 * 43 parts and Canterbury-Bankstown 65; done by hand that is where provenance gets lost, which is
 * exactly what happened to Hornsby, whose source PDF has no recorded origin.
 *
 * WHAT IT GUARANTEES, per part:
 *   - the browser header set that gets past council bot protection (Sec-Fetch-* are the ones that
 *     matter; a bare user-agent gets 403 from Randwick's Cloudflare)
 *   - redirects followed, because councils publish shortlinks (cb.city/DCP1-1) and the real URL is
 *     what belongs in the manifest
 *   - validation that the bytes are a PDF: a Cloudflare challenge is a valid 200 full of HTML, so
 *     HTTP status alone proves nothing. Checks %PDF magic and a floor on size.
 *   - sha256, bytes and the resolved URL recorded, so a conversion can be reproduced
 *
 * It does NOT decide what the current DCP is. That is step 0 and it is manual - see
 * docs/dcp-onboarding-runbook.md and manifests/_currency-verification.json.
 *
 * Usage:
 *   node scripts/dcp-fetch-parts.mjs --plan <slug> --parts <parts.json> [--dry-run] [--only 1.1]
 *
 * parts.json: { instrument, title, council, lga, commenced, as_at, source_page,
 *               parts: [ { part, title, url } ] }
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] }
const PLAN = arg('--plan')
const PARTS = arg('--parts')
const ONLY = arg('--only')
const DRY = args.includes('--dry-run')
if (!PLAN || !PARTS) {
  console.error('usage: --plan <slug> --parts <parts.json> [--dry-run] [--only <part>]')
  process.exit(2)
}

const REPO = process.cwd()
const PDF_DIR = path.join(REPO, 'public', 'EPI', 'DCPs', 'pdf', PLAN)
const MANIFEST = path.join(REPO, 'public', 'EPI', 'DCPs', 'manifests', `${PLAN}.json`)

/**
 * The header set that gets past council bot protection. Sec-Fetch-* are the ones that matter:
 * Randwick's Cloudflare serves 403 to a bare user-agent and 200 to this.
 */
const headersFor = referer => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  ...(referer ? { Referer: referer } : {}),
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const PACE_MS = Number(arg('--pace') ?? 1200)

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

async function main() {
  const spec = JSON.parse(await readFile(PARTS, 'utf-8'))
  const parts = ONLY ? spec.parts.filter(p => String(p.part) === ONLY) : spec.parts
  console.log(`${spec.title}\n${parts.length} parts -> ${path.relative(REPO, PDF_DIR)}\n`)
  if (!DRY) await mkdir(PDF_DIR, { recursive: true })

  const out = []
  let ok = 0, failed = 0, cached = 0
  for (const [i, p] of parts.entries()) {
    const name = `${slug(p.part || i)}-${slug(p.title).slice(0, 60)}.pdf`
    const dest = path.join(PDF_DIR, name)
    const label = `[${i + 1}/${parts.length}] ${String(p.part).padEnd(6)} ${p.title.slice(0, 46)}`

    // already have it, and it is a valid PDF: skip. Makes the run resumable over ~900 files.
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
    } catch { /* not downloaded yet */ }

    if (DRY) { console.log(`${label}  would fetch ${p.url}`); continue }

    // Pace and retry. 56 rapid requests to Canterbury-Bankstown returned a 599-byte HTML page
    // with HTTP 200 for every single one; the same URLs served the PDF fine a minute later from
    // the same headers. A council publishing ~50 parts will throttle a burst, and over ~900 files
    // across 30 councils that is the difference between a run and a ban.
    let res, buf, magic
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(3000 * attempt)
        res = await fetch(p.url, { headers: headersFor(spec.source_page), redirect: 'follow' })
        buf = Buffer.from(await res.arrayBuffer())
        magic = buf.subarray(0, 4).toString()
        if (res.ok && magic === '%PDF' && buf.length >= 10_000) break
      }
      // A Cloudflare challenge is a 200 with HTML in it, so the status is not the test.
      if (!res.ok || magic !== '%PDF' || buf.length < 10_000) {
        failed++
        console.log(`${label}  FAILED http=${res.status} bytes=${buf.length} magic=${
          JSON.stringify(magic)}`)
        out.push({ part: p.part, title: p.title, url: p.url, error:
          `http=${res.status} bytes=${buf.length} magic=${magic}` })
        continue
      }
      await writeFile(dest, buf)
      ok++
      out.push({
        part: p.part, title: p.title,
        url: p.url,
        resolved_url: res.url !== p.url ? res.url : undefined,   // councils publish shortlinks
        file: `${PLAN}/${name}`, bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
      })
      console.log(`${label}  ${(buf.length / 1e6).toFixed(1)} MB`)
      await sleep(PACE_MS)
    } catch (e) {
      failed++
      out.push({ part: p.part, title: p.title, url: p.url, error: String(e.message || e) })
      console.log(`${label}  ERROR ${String(e.message || e).slice(0, 60)}`)
    }
  }

  console.log(`\n  ${ok} downloaded, ${cached} already held, ${failed} failed`)
  if (DRY) return

  const manifest = {
    instrument: spec.instrument, title: spec.title, council: spec.council, lga: spec.lga,
    kind: 'dcp',
    commenced: spec.commenced, as_at: spec.as_at, date_evidence: spec.date_evidence,
    supersedes: spec.supersedes, savings_provision: spec.savings_provision,
    source_page: spec.source_page,
    retrieved_at: new Date().toISOString().slice(0, 10),
    parts: out,
  }
  await mkdir(path.dirname(MANIFEST), { recursive: true })
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  manifest -> ${path.relative(REPO, MANIFEST)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
