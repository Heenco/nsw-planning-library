/**
 * NSW DCP register — manifest builder and downloader.
 *
 * Every NSW council is required to publish its Development Control Plan on
 * the Planning Portal, which makes
 *
 *     https://www.planningportal.nsw.gov.au/DCP
 *
 * the one complete, authoritative index of NSW DCPs. It is a flat HTML page
 * of `<p><a href="...">Title</a></p>` entries under four <h4> sections
 * (In-Force / Repealed / Superseded / Sydney Harbour Foreshore Maps), with
 * the documents themselves on S3. Unlike council websites — several of
 * which sit behind bot-blocking CDNs — it is reachable with a plain fetch.
 *
 * This replaces the hand-maintained `DCPs copy.csv`, which was a partial
 * PropCode export that ran out alphabetically at "Hawkesbury".
 *
 * ── Currency caveat ────────────────────────────────────────────────────
 * The register is complete in coverage but lags council adoption: it still
 * lists "Hornsby DCP 2013 - 2019" though Hornsby adopted HDCP 2024 in July
 * 2024. The register's own title text is recorded verbatim in the manifest
 * so that staleness is visible rather than silent, and `--check-current`
 * reports entries whose title year looks behind.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *   node scripts/fetch-dcp-register.mjs --refresh
 *       Fetch the register, parse it, write the manifest. No downloads.
 *
 *   node scripts/fetch-dcp-register.mjs --download
 *   node scripts/fetch-dcp-register.mjs --download --only hornsby
 *   node scripts/fetch-dcp-register.mjs --download --status all
 *       Download PDFs. Idempotent and resumable: a file already on disk
 *       with the recorded size is skipped unless --force.
 *
 *   node scripts/fetch-dcp-register.mjs --list --only hornsby
 *   node scripts/fetch-dcp-register.mjs --check-current
 *
 * Flags:
 *   --refresh          re-fetch and re-parse the register HTML
 *   --download         download the selected documents
 *   --list             print the selection and exit
 *   --check-current    flag entries that look superseded by a newer edition
 *   --only <substr>    filter by council/title substring (case-insensitive)
 *   --status <s>       in-force (default) | repealed | superseded | maps | all
 *   --out <dir>        download directory (default public/EPI/DCPs/pdf)
 *   --concurrency <n>  parallel downloads (default 4)
 *   --force            re-download even if the file is already present
 *   --limit <n>        stop after n downloads (useful for a trial run)
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const REGISTER_URL = 'https://www.planningportal.nsw.gov.au/DCP'
const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'public', 'EPI', 'nsw-dcp')
const MANIFEST = path.join(DATA_DIR, 'dcp-register.json')
const CACHE_HTML = path.join(DATA_DIR, 'dcp-register.html')
const DEFAULT_OUT = path.join(ROOT, 'public', 'EPI', 'DCPs', 'pdf')

const UA = 'Mozilla/5.0 (compatible; nsw-planning-library/0.1; +https://github.com/)'

// ── args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const opts = {
  refresh: has('--refresh'),
  download: has('--download'),
  list: has('--list'),
  checkCurrent: has('--check-current'),
  force: has('--force'),
  only: (val('--only', '') || '').toLowerCase(),
  status: (val('--status', 'in-force') || 'in-force').toLowerCase(),
  out: path.resolve(val('--out', DEFAULT_OUT)),
  concurrency: Math.max(1, Number(val('--concurrency', '4')) || 4),
  limit: Number(val('--limit', '0')) || 0,
}

// ── parse ───────────────────────────────────────────────────────────────

/** The four <h4> sections, in page order. Anything before the first is
 *  page chrome; the nested <h2> sub-headings are not section boundaries. */
const SECTIONS = [
  { key: 'in-force',   heading: 'Development Control Plans (In-Force)' },
  { key: 'repealed',   heading: 'Development Control Plans (Repealed)' },
  { key: 'superseded', heading: 'Development Control Plans (Superseded)' },
  { key: 'maps',       heading: 'Sydney Harbour Foreshore Maps' },
]

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Leading council/LGA name, as far as the register's titles allow. Titles
 *  read like "Hornsby DCP 2013 - 2019" or "Blacktown DCP 2015", so the
 *  council is whatever precedes the DCP/plan keyword. */
function councilOf(title) {
  const m = title.match(/^(.*?)\s+(?:DCP|Development Control Plan|Growth Centre|Council)\b/i)
  const raw = (m ? m[1] : title.split(/\s+/).slice(0, 2).join(' ')).trim()
  return raw.replace(/\s+(City|Shire|Regional|Municipal)$/i, '').trim() || title
}

/** Latest 4-digit year mentioned in a title, if any. */
function yearOf(title) {
  const years = title.match(/\b(?:19|20)\d{2}\b/g)
  return years ? Math.max(...years.map(Number)) : null
}

function parseRegister(html) {
  // Locate each section's span in the document.
  const bounds = []
  for (const sec of SECTIONS) {
    const re = new RegExp(`<h4[^>]*>\\s*${sec.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h4>`, 'i')
    const m = re.exec(html)
    if (m) bounds.push({ ...sec, start: m.index + m[0].length })
  }
  bounds.sort((a, b) => a.start - b.start)
  bounds.forEach((b, i) => { b.end = i + 1 < bounds.length ? bounds[i + 1].start : html.length })

  const entries = []
  const seenSlug = new Map()

  for (const sec of bounds) {
    const chunk = html.slice(sec.start, sec.end)

    // A section can carry <h2> sub-groups — e.g. "Blacktown City Council
    // Growth Centre Precincts DCP 2010", whose children are titled only
    // "Schedule 1 Alex Avenue Precinct". Those children have no council in
    // their own title, so the enclosing group supplies it.
    const groups = [...chunk.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map((g) => ({ at: g.index, label: stripTags(g[1]) }))
    const groupAt = (pos) => {
      let label = null
      for (const g of groups) { if (g.at < pos) label = g.label; else break }
      return label
    }

    const linkRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = linkRe.exec(chunk)) !== null) {
      const href = decodeEntities(m[1]).trim()
      const title = stripTags(m[2]).replace(/\s*\(PDF\)\s*$/i, '').trim()
      // Footnote markers and stray superscripts surface as one- or
      // two-character anchors; they are not documents.
      if (title.length < 4 || /^\d+$/.test(title)) continue
      // Page chrome and in-page anchors are not documents.
      if (!/^https?:\/\//i.test(href)) continue
      if (/planningportal\.nsw\.gov\.au\/(support-hub|about)/i.test(href)) continue

      const ext = (href.split('?')[0].match(/\.([a-z0-9]{2,4})$/i)?.[1] || 'pdf').toLowerCase()
      // Non-document links occasionally appear (mail redirects, council
      // landing pages). Keep only what looks like a file.
      if (!['pdf', 'zip', 'doc', 'docx'].includes(ext)) continue

      let slug = slugify(title)
      const n = (seenSlug.get(slug) ?? 0) + 1
      seenSlug.set(slug, n)
      if (n > 1) slug = `${slug}-${crypto.createHash('sha1').update(href).digest('hex').slice(0, 6)}`

      // "Schedule 3 East Leppington" names no council; its group heading does.
      const group = groupAt(m.index)
      const selfNamed = !/^(schedule|appendix|part|volume|annexure|amendment|map)\b/i.test(title)
      const council = selfNamed || !group ? councilOf(title) : councilOf(group)

      entries.push({
        slug,
        title,
        group,
        council,
        year: yearOf(title) ?? (group ? yearOf(group) : null),
        status: sec.key,
        url: href,
        ext,
        file: `${slug}.${ext}`,
      })
    }
  }
  return entries
}

// ── fetch helpers ───────────────────────────────────────────────────────

async function fetchWithRetry(url, init = {}, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
        redirect: 'follow',
      })
      if (res.ok) return res
      // 4xx other than 429 will not improve on retry.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status}`)
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    if (i < attempts - 1) await sleep(1000 * 2 ** i)
  }
  throw lastErr
}

async function refreshManifest() {
  process.stdout.write(`Fetching register: ${REGISTER_URL}\n`)
  const res = await fetchWithRetry(REGISTER_URL)
  const html = await res.text()
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CACHE_HTML, html, 'utf8')

  const entries = parseRegister(html)
  const manifest = {
    source: REGISTER_URL,
    fetched_at: new Date().toISOString(),
    count: entries.length,
    entries,
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8')

  const byStatus = {}
  for (const e of entries) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1
  process.stdout.write(`Parsed ${entries.length} documents: ${JSON.stringify(byStatus)}\n`)
  process.stdout.write(`Manifest: ${path.relative(ROOT, MANIFEST)}\n`)
  return manifest
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`No manifest yet — run with --refresh first.`)
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
}

function select(manifest) {
  return manifest.entries.filter((e) => {
    if (opts.status !== 'all' && e.status !== opts.status) return false
    if (opts.only && !(`${e.title} ${e.council}`.toLowerCase().includes(opts.only))) return false
    return true
  })
}

// ── download ────────────────────────────────────────────────────────────

async function downloadOne(entry, outDir, log) {
  const dest = path.join(outDir, entry.file)
  const prior = log[entry.slug]

  if (!opts.force && fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    if (size > 0 && (!prior?.bytes || prior.bytes === size)) {
      return { slug: entry.slug, status: 'skipped', bytes: size }
    }
  }

  const res = await fetchWithRetry(entry.url)
  const buf = Buffer.from(await res.arrayBuffer())
  const type = res.headers.get('content-type') || ''

  // A CDN block or a council "page not found" returns 200 with HTML, which
  // would otherwise be written out as a .pdf and poison the conversion step.
  if (/text\/html/i.test(type) || buf.subarray(0, 5).toString('latin1') === '<!DOC') {
    return { slug: entry.slug, status: 'not-a-document', contentType: type, bytes: buf.length }
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(dest, buf)
  return {
    slug: entry.slug,
    status: 'downloaded',
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    contentType: type,
    fetched_at: new Date().toISOString(),
  }
}

/** Bounded-concurrency map that keeps going when one item fails. */
async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await worker(items[i], i)
      } catch (err) {
        results[i] = { slug: items[i].slug, status: 'failed', error: String(err.message || err) }
      }
    }
  })
  await Promise.all(runners)
  return results
}

async function downloadAll(entries) {
  const logPath = path.join(opts.out, 'download-log.json')
  const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : {}
  const todo = opts.limit ? entries.slice(0, opts.limit) : entries

  process.stdout.write(`Downloading ${todo.length} documents to ${path.relative(ROOT, opts.out)} (concurrency ${opts.concurrency})\n`)

  let done = 0
  const results = await pool(todo, opts.concurrency, async (entry) => {
    const r = await downloadOne(entry, opts.out, log)
    log[entry.slug] = { ...r, url: entry.url, title: entry.title }
    done++
    process.stdout.write(`  [${String(done).padStart(3)}/${todo.length}] ${r.status.padEnd(14)} ${entry.slug}\n`)
    return r
  })

  fs.mkdirSync(opts.out, { recursive: true })
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8')

  const tally = {}
  for (const r of results) tally[r?.status ?? 'unknown'] = (tally[r?.status ?? 'unknown'] ?? 0) + 1
  process.stdout.write(`\nDone: ${JSON.stringify(tally)}\n`)
  const failed = results.filter((r) => r?.status === 'failed' || r?.status === 'not-a-document')
  if (failed.length) {
    process.stdout.write(`\nNeeds attention (${failed.length}):\n`)
    for (const f of failed) process.stdout.write(`  ${f.status}  ${f.slug}  ${f.error ?? f.contentType ?? ''}\n`)
  }
  process.stdout.write(`Log: ${path.relative(ROOT, logPath)}\n`)
}

// ── currency check ──────────────────────────────────────────────────────

/** The register lags adoption. Where the same council appears in both the
 *  in-force and superseded lists, or where a newer edition is named in a
 *  later entry, the in-force row may not be the current instrument. */
function checkCurrent(manifest) {
  const inForce = manifest.entries.filter((e) => e.status === 'in-force')
  const byCouncil = new Map()
  for (const e of manifest.entries) {
    const k = e.council.toLowerCase()
    if (!byCouncil.has(k)) byCouncil.set(k, [])
    byCouncil.get(k).push(e)
  }

  const flagged = []
  for (const e of inForce) {
    const siblings = byCouncil.get(e.council.toLowerCase()) ?? []
    const newer = siblings.filter((s) => s.year && e.year && s.year > e.year)
    if (newer.length) flagged.push({ entry: e, newer })
  }

  process.stdout.write(`In-force entries: ${inForce.length}\n`)
  process.stdout.write(`Entries with a newer-dated sibling in the register: ${flagged.length}\n\n`)
  for (const f of flagged.slice(0, 40)) {
    process.stdout.write(`  ${f.entry.title}  (${f.entry.year})\n`)
    for (const n of f.newer) process.stdout.write(`      newer: ${n.title} [${n.status}]\n`)
  }
  process.stdout.write(`\nNote: the register cannot detect editions it has not yet published —\n`)
  process.stdout.write(`e.g. Hornsby DCP 2024 is absent, so Hornsby still shows as 2013.\n`)
}

// ── main ────────────────────────────────────────────────────────────────

const manifest = opts.refresh || !fs.existsSync(MANIFEST)
  ? await refreshManifest()
  : loadManifest()

if (opts.checkCurrent) {
  checkCurrent(manifest)
} else {
  const selection = select(manifest)
  if (opts.list || (!opts.download && !opts.refresh)) {
    process.stdout.write(`${selection.length} document(s) [status=${opts.status}${opts.only ? `, only=${opts.only}` : ''}]\n\n`)
    for (const e of selection.slice(0, 60)) {
      process.stdout.write(`  ${e.slug}\n      ${e.title}\n      ${e.url}\n`)
    }
    if (selection.length > 60) process.stdout.write(`  … and ${selection.length - 60} more\n`)
  } else if (opts.download) {
    if (!selection.length) {
      process.stdout.write('Nothing selected.\n')
    } else {
      await downloadAll(selection)
    }
  }
}
