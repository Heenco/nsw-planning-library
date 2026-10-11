// Drives /pilot in a headless browser: open one instrument, click an unresolved value and a finding,
// and confirm the rows drawer renders what /api/pilot/rows returns. Playwright lives in the npx
// cache on this machine; pass its index.mjs as a file:// URL.
//   node scripts/norms/pilot-page-click.mjs file:///C:/.../node_modules/playwright/index.mjs out.png [Bayside]
import fs from 'node:fs'
const { chromium } = await import(process.argv[2])
const shot = process.argv[3]
const plan = process.argv[4] ?? 'Bayside'
const pw = fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('NUXT_APP_PASSWORD=')).split('=')[1].trim().replace(/^"|"$/g, '')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
// the password middleware reads the header itself and answers 401 without a challenge, so Playwright's
// httpCredentials never fire: send the header on every request instead
const ctx = await browser.newContext({ extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from('user:' + pw).toString('base64') }, viewport: { width: 1500, height: 1000 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)) })
const resp = await page.goto('http://localhost:3000/pilot', { waitUntil: 'domcontentloaded', timeout: 180000 })
console.log('status', resp?.status(), 'title', await page.title(), 'html bytes', (await page.content()).length, 'lp-link in html', (await page.content()).split('lp-link').length - 1)
await page.waitForSelector('button.lp-link', { timeout: 120000 })
// hydration: a click only works once Vue has mounted; wait for the app marker, but do not die on it
await page.waitForFunction(() => document.querySelector('#__nuxt')?.__vue_app__, null, { timeout: 90000 }).catch(() => console.log('no hydration marker after 90 s; errors so far:', errors))
await page.locator('button.lp-link', { hasText: plan }).first().click()
await page.waitForSelector('.lp-detail', { timeout: 30000 })
const unres = page.locator('.lp-detail .lp-row--click').last()
const label = (await unres.innerText()).replace(/\s+/g, ' ')
await unres.click()
try {
  await page.waitForSelector('.lp-drill table tbody tr', { timeout: 60000 })
} catch (e) {
  const drawer = await page.locator('.lp-drill').count() ? (await page.locator('.lp-drill').innerText()).replace(/\s+/g, ' ').slice(0, 400) : '(no drawer rendered)'
  console.log('drawer did not fill. drawer text:', drawer, '| errors:', errors)
  if (shot) await page.screenshot({ path: shot, fullPage: true })
  await browser.close()
  process.exit(1)
}
console.log('clicked:', label, '| drill:', (await page.locator('.lp-drill h2').innerText()).replace(/\s+/g, ' '),
  '| columns:', (await page.locator('.lp-drill thead th').allInnerTexts()).join(','), '| rows shown:', await page.locator('.lp-drill tbody tr').count())
await page.locator('.lp-detail .lp-row--click').first().click()
await page.waitForTimeout(2000)
console.log('finding drill:', (await page.locator('.lp-drill h2').innerText()).replace(/\s+/g, ' '), '| rows:', await page.locator('.lp-drill tbody tr').count())
await page.locator('.lp-detail .lp-cell').first().click()
await page.waitForTimeout(2000)
console.log('scope drill:', (await page.locator('.lp-drill h2').innerText()).replace(/\s+/g, ' '), '| rows:', await page.locator('.lp-drill tbody tr').count())
if (shot) await page.screenshot({ path: shot, fullPage: false })
console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
