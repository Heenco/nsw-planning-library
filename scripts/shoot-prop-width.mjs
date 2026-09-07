/**
 * Screenshot /prop-width for a list of addresses, into an .xlsx test sheet.
 *
 * Drives headless Edge over the Chrome DevTools Protocol. There is no
 * Playwright or Puppeteer in this project and neither is worth adding for a
 * test artifact, and Edge's own `--screenshot` flag is unusable here: it
 * relies on `--virtual-time-budget`, which never elapses on a page running
 * mapbox-gl's animation loop, so the browser simply hangs. CDP also lets the
 * script wait on the map actually being ready rather than on a fixed timer.
 *
 * Node 24 ships a global WebSocket, so CDP needs no dependency at all.
 *
 * Usage:
 *   node scripts/shoot-prop-width.mjs [--base http://localhost:3000]
 *                                     [--out build/prop-width-tests]
 *                                     [--limit 30] [--route prop-width-gnaf]
 *                                     [--headful]
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]

const DEBUG_PORT = 9333
/** Matches the viewport the page was designed against — panel plus map. */
const VIEWPORT = { width: 1560, height: 940 }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = name => process.argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:3000').replace(/\/+$/, '')
const OUT_DIR = path.resolve(arg('out', 'build/prop-width-tests'))
const LIMIT = Number(arg('limit', '30'))
/** Which page to shoot — /prop-width and /prop-width-gnaf render the same
 *  component over different lot-metrics layers, so both are shot the same way. */
const ROUTE = arg('route', 'prop-width').replace(/^\/+/, '')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── CDP ─────────────────────────────────────────────────────────────────────

/**
 * A minimal CDP client: send a command, await its reply by id.
 *
 * Events are ignored entirely — every wait in this script is a poll on
 * Runtime.evaluate, which is simpler to reason about than an event race and
 * cannot deadlock if the page never fires the event being awaited.
 */
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 60000)
    })
  }

  /** Evaluate in the page and hand back the plain value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result?.value
  }
}

async function launchBrowser() {
  const exe = EDGE_CANDIDATES.find(p => existsSync(p))
  if (!exe) throw new Error(`No Edge or Chrome found. Looked in:\n  ${EDGE_CANDIDATES.join('\n  ')}`)

  const profile = path.join(OUT_DIR, '.browser-profile')
  await rm(profile, { recursive: true, force: true })
  await mkdir(profile, { recursive: true })

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    // mapbox-gl needs WebGL; headless has no GPU, so allow the software path.
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-popup-blocking',
    ...(hasFlag('headful') ? [] : ['--headless=new']),
    'about:blank',
  ]

  const proc = spawn(exe, args, { stdio: 'ignore', detached: false })

  // Wait for the debugging endpoint rather than guessing at a startup delay.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return { proc, exe }
    } catch { /* not up yet */ }
    await sleep(500)
  }
  proc.kill()
  throw new Error('Browser did not open its debugging port')
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  if (!page) throw new Error('No page target in the browser')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })

  const cdp = new CDP(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT, deviceScaleFactor: 1, mobile: false,
  })
  return cdp
}

// ── Page driving ────────────────────────────────────────────────────────────

/**
 * Poll a predicate in the page until it holds.
 *
 * Returns false rather than throwing on timeout: one address that will not
 * settle should cost that row its screenshot, not abort the whole run.
 */
async function waitFor(cdp, expression, { timeout = 30000, interval = 400 } = {}) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try {
      if (await cdp.eval(expression)) return true
    } catch { /* page mid-navigation */ }
    await sleep(interval)
  }
  return false
}

/** The map is up, styled, and has stopped fetching. */
const MAP_READY = `(() => {
  const m = window.__propWidthMap
  return !!m && m.isStyleLoaded() && m.loaded() && !m.isMoving();
})()`

/** The page has picked a lot and the panel is showing it. */
const LOT_SELECTED = `(() => {
  const el = document.querySelector('.detail-title')
  return !!el && !!el.textContent.trim();
})()`

/**
 * Nuxt DevTools floats a button over the page in dev, and it lands in the
 * screenshot. Hidden rather than disabled so the run needs no change to how the
 * dev server was started — the sheet is shot against whatever is already up.
 */
const HIDE_DEV_CHROME = `(() => {
  if (document.getElementById('shot-css')) return true
  const s = document.createElement('style')
  s.id = 'shot-css'
  s.textContent = \`
    #nuxt-devtools-anchor, #nuxt-devtools-container, nuxt-devtools-frame,
    [id^="nuxt-devtools"], vite-error-overlay { display: none !important; }
  \`
  document.head.appendChild(s)
  return true
})()`

async function shoot(cdp, address, index) {
  const url = `${BASE}/${ROUTE}?address=${encodeURIComponent(address)}`
  await cdp.send('Page.navigate', { url })

  const ready = await waitFor(cdp, MAP_READY, { timeout: 45000 })
  if (!ready) return { ok: false, reason: 'map never became ready' }
  await cdp.eval(HIDE_DEV_CHROME)

  // The deep link searches, flies, then selects — all after the first idle.
  const selected = await waitFor(cdp, LOT_SELECTED, { timeout: 30000 })

  // Labels are placed on the frame after the data lands; give it one beat so
  // the screenshot is not caught mid-render.
  await sleep(1200)
  await waitFor(cdp, MAP_READY, { timeout: 15000 })

  const summary = await cdp.eval(`(() => {
    const t = s => (document.querySelector(s)?.textContent || '').trim()
    const frontages = [...document.querySelectorAll('.frontage')].map(el => ({
      road: (el.querySelector('.frontage-road')?.textContent || '').trim(),
      length: (el.querySelector('.frontage-len')?.textContent || '').trim(),
      note: (el.querySelector('.frontage-tag')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      matched: !el.classList.contains('frontage--unplaced'),
    }))
    const rows = {}
    for (const tr of document.querySelectorAll('.detail-table tr')) {
      const k = (tr.querySelector('th')?.textContent || '').trim()
      const v = (tr.querySelector('td')?.textContent || '').trim()
      if (k) rows[k] = v
    }
    return { lot: t('.detail-title'), address: t('.detail-addr'), frontages, rows }
  })()`)

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${String(index + 1).padStart(2, '0')}-${address.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)}.png`
  await writeFile(path.join(OUT_DIR, 'screenshots', file), Buffer.from(data, 'base64'))

  return { ok: true, file, selected, summary }
}

// ── Entry ───────────────────────────────────────────────────────────────────

/**
 * `cases` are the rows from pickAddresses(..., { withMeta: true }).
 *
 * Each case's database metadata is written straight into results.json rather
 * than left for the sheet builder to look up again. Re-querying meant the sheet
 * described whatever the picker returned the *second* time, and when those two
 * calls disagreed four rows lost their metadata and were scored against
 * nothing. Carrying it through makes the sheet describe the run that was
 * actually shot, whatever the picker does later.
 */
export async function shootAll(cases) {
  await mkdir(path.join(OUT_DIR, 'screenshots'), { recursive: true })

  const { proc } = await launchBrowser()
  const results = []
  try {
    const cdp = await connect()
    for (const [i, meta] of cases.entries()) {
      const address = meta.address
      process.stdout.write(`  [${i + 1}/${cases.length}] ${address} … `)
      let r
      try {
        r = await shoot(cdp, address, i)
      } catch (err) {
        r = { ok: false, reason: String(err.message || err) }
      }
      console.log(r.ok ? (r.selected ? 'ok' : 'ok (no lot selected)') : `FAILED — ${r.reason}`)
      results.push({ address, meta, ...r })
    }
  } finally {
    proc.kill()
  }
  return results
}

// See the note in pick-test-addresses.mjs — a hand-built file:// URL never
// matches import.meta.url when the repo path contains spaces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pickAddresses } = await import('./pick-test-addresses.mjs')
  const cases = await pickAddresses(LIMIT, { withMeta: true })
  console.log(`Shooting ${cases.length} addresses from ${BASE}/${ROUTE}`)
  const results = await shootAll(cases)
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
  const ok = results.filter(r => r.ok).length
  console.log(`\n${ok}/${results.length} captured -> ${OUT_DIR}`)
}
