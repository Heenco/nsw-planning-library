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
 *                                     [--limit 30] [--per-bucket 10]
 *                                     [--route prop-width-gnaf]
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
/** Ten of every lot type rather than a weighted sheet; see pick-test-addresses. */
const PER_BUCKET = Number(arg('per-bucket', '0'))
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

/**
 * /frontage is not /prop-width with a different layer under it.
 *
 * It deep-links by lot rather than address, because it answers a question about
 * one parcel's boundaries and an address does not name a parcel. It settles in
 * two stages - the map style first, then the cadastre fetch and the topology
 * pass over it - so a map-idle test alone would shoot an empty panel. And it
 * names its panel `fr-*`, sharing no selector with the other page.
 *
 * What it must not differ in is the shape it reports. build-test-sheet.mjs
 * scores every row from { lot, address, frontages, rows } and should not have
 * to know which page produced it, so the reader below rebuilds exactly that.
 */
const IS_FRONTAGE = ROUTE === 'frontage'

/** The map is up, styled, and has stopped fetching. */
const PROP_WIDTH_READY = `(() => {
  const m = window.__propWidthMap
  return !!m && m.isStyleLoaded() && m.loaded() && !m.isMoving();
})()`

/**
 * Ready means the map has settled *and* the run has finished - landed on data,
 * or on a stated reason there is none. Without the second half the shot races
 * the fetch and catches a blank panel.
 */
const FRONTAGE_READY = `(() => {
  const m = window.__frontageMap
  if (!m || !m.isStyleLoaded() || !m.loaded() || m.isMoving()) return false;
  const st = (window.__frontageState && window.__frontageState()) || null;
  if (!st) return false;
  return st.pending === false && (st.hasData || !!st.error || !!st.miss);
})()`

const MAP_READY = IS_FRONTAGE ? FRONTAGE_READY : PROP_WIDTH_READY

/** The page has picked a lot and the panel is showing it. */
const PROP_WIDTH_SELECTED = `(() => {
  const el = document.querySelector('.detail-title')
  return !!el && !!el.textContent.trim();
})()`

const FRONTAGE_SELECTED = `(() => {
  const st = (window.__frontageState && window.__frontageState()) || null;
  return !!st && st.hasData === true;
})()`

const LOT_SELECTED = IS_FRONTAGE ? FRONTAGE_SELECTED : PROP_WIDTH_SELECTED

/**
 * Read the frontage panel back into the shape the sheet builder expects.
 *
 * Every run this page lists is placed on the boundary by construction - it is
 * derived from the boundary - so `matched` is always true; the interesting
 * disagreement is with the recorded count, which the sheet already scores.
 * Runs beyond the counted street frontage carry the page's own note instead.
 */
const FRONTAGE_SUMMARY = `(() => {
  const txt = el => ((el && el.textContent) || '').trim();
  const clean = s => s.split(' ').filter(Boolean).join(' ');
  const st = (window.__frontageState && window.__frontageState()) || {};
  const frontages = [...document.querySelectorAll('.fr-run')].map((el) => {
    const roadEl = el.querySelector('.fr-run-road');
    const dot = roadEl && roadEl.querySelector('.fr-primary-dot');
    let road = txt(roadEl);
    if (dot) road = road.split(txt(dot)).join('').trim();
    return {
      road: clean(road),
      length: clean(txt(el.querySelector('.fr-run-len'))),
      note: clean(txt(el.querySelector('.fr-tag'))),
      matched: true,
    };
  });
  const rows = {};
  for (const d of document.querySelectorAll('.fr-dims > div')) {
    const k = clean(txt(d.querySelector('dt')));
    const v = clean(txt(d.querySelector('dd')));
    if (k) rows[k] = rows[k] ? rows[k] + ' / ' + v : v;
  }
  const bad = clean(txt(document.querySelector('.fr-msg--bad')));
  return { lot: st.lotId || '', address: '', frontages, rows, note: bad };
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

async function shoot(cdp, meta, index) {
  const address = meta.address
  // /frontage keys on the parcel, /prop-width on the address it was found by.
  // Falling back to the address on a lot with no plan would silently shoot the
  // page's default lot, so a missing plan is an error rather than a guess.
  const link = IS_FRONTAGE
    ? (meta.lot_section_plan
        ? `?lot=${encodeURIComponent(meta.lot_section_plan)}`
        : null)
    : `?address=${encodeURIComponent(address)}`
  if (link === null) return { ok: false, reason: 'no lot_section_plan to deep-link' }
  const url = `${BASE}/${ROUTE}${link}`
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

  const summary = await cdp.eval(IS_FRONTAGE ? FRONTAGE_SUMMARY : `(() => {
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
        r = await shoot(cdp, meta, i)
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
  const cases = await pickAddresses(LIMIT, { withMeta: true, perBucket: PER_BUCKET })
  console.log(`Shooting ${cases.length} addresses from ${BASE}/${ROUTE}`)
  const results = await shootAll(cases)
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
  const ok = results.filter(r => r.ok).length
  console.log(`\n${ok}/${results.length} captured -> ${OUT_DIR}`)
}
