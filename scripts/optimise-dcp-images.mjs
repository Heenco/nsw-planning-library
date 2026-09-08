/**
 * Make the DCP page images small enough to ship, and point the documents at
 * them.
 *
 * The extractor writes one PNG per figure straight out of the PDF at source
 * resolution: 3,319 files, 736 MB, one of them 11.4 MB on its own. That is far
 * past what belongs in a git repository, so `public/EPI/DCPs/images/` was
 * ignored — and the consequence was that every image 404'd in production. The
 * viewer's CDN fallback (static.heenco.com) was meant to cover it and is
 * returning 521, so both routes were dead and the deployed DCPs rendered with
 * no figures at all.
 *
 * WebP at the width the viewer actually renders fixes the size problem rather
 * than working around it. The document body is 900 px wide, so 1400 px covers a
 * 1.5x display and anything beyond it was never visible. The whole set comes
 * down to roughly 7% of its original weight, which is committable, and the
 * local path becomes the one that works — leaving the CDN as a genuine fallback
 * instead of the only route.
 *
 * The PNGs stay ignored. They are the intermediate, regenerable from the PDFs
 * by the conversion pipeline; the WebP is the published output, the same
 * division the rest of public/EPI already uses.
 *
 * Only folders that exist locally are touched, and a reference is rewritten
 * only once its .webp is on disk. Seven other councils' documents point at
 * image folders we do not hold — those refs are left spelling .png so they keep
 * using the CDN fallback if that host ever comes back.
 *
 * Usage:
 *   npm i sharp --no-save        # not a project dependency; used only here
 *   node scripts/optimise-dcp-images.mjs [--width 1400] [--quality 82] [--force]
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const IMAGES_DIR = 'public/EPI/DCPs/images'
const DOCS_DIR = 'public/EPI/DCPs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const WIDTH = Number(arg('width', 1400))
const QUALITY = Number(arg('quality', 82))
const FORCE = process.argv.includes('--force')

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('sharp is not installed. Run:  npm i sharp --no-save')
  process.exit(1)
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

// ── convert ─────────────────────────────────────────────────────────────
if (!fs.existsSync(IMAGES_DIR)) {
  console.error(`${IMAGES_DIR} does not exist — nothing to optimise.`)
  process.exit(1)
}

const folders = fs.readdirSync(IMAGES_DIR)
  .filter(d => fs.statSync(path.join(IMAGES_DIR, d)).isDirectory())

let before = 0
let after = 0
let converted = 0
let skipped = 0
let failed = 0

for (const folder of folders) {
  const dir = path.join(IMAGES_DIR, folder)
  const pngs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'))
  process.stdout.write(`${folder}: ${pngs.length} png`)

  for (const file of pngs) {
    const src = path.join(dir, file)
    const dest = src.replace(/\.png$/i, '.webp')
    const srcStat = fs.statSync(src)
    before += srcStat.size

    // Idempotent: an existing .webp newer than its source is left alone, so a
    // re-run after adding one document does not re-encode 3,000 files.
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= srcStat.mtimeMs) {
      after += fs.statSync(dest).size
      skipped++
      continue
    }

    try {
      const buf = await sharp(src)
        .resize({ width: WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer()
      fs.writeFileSync(dest, buf)
      after += buf.length
      converted++
    } catch (e) {
      // A figure that will not decode is reported and left as PNG rather than
      // written half-formed; its reference stays pointing at the .png.
      console.error(`\n  ! ${src}: ${e.message}`)
      failed++
    }
  }
  process.stdout.write(` -> done\n`)
}

console.log(`\nimages: ${converted} converted, ${skipped} already current, ${failed} failed`)
console.log(`size:   ${mb(before)} png -> ${mb(after)} webp  (${(after / before * 100).toFixed(1)}%)`)

// ── repoint the documents ───────────────────────────────────────────────
//
// Only where the .webp is actually on disk. A document naming an image folder
// this checkout does not hold keeps its .png reference and its CDN fallback.
const docs = fs.readdirSync(DOCS_DIR).filter(f => /\.(md|html)$/i.test(f))
let rewritten = 0

for (const file of docs) {
  const p = path.join(DOCS_DIR, file)
  const text = fs.readFileSync(p, 'utf8')
  let hits = 0

  const next = text.replace(/images\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\.png/g, (whole, folder, name) => {
    if (!fs.existsSync(path.join(IMAGES_DIR, folder, `${name}.webp`))) return whole
    hits++
    return `images/${folder}/${name}.webp`
  })

  if (hits) {
    fs.writeFileSync(p, next)
    rewritten++
    console.log(`  ${file}: ${hits} references -> .webp`)
  }
}

console.log(`\ndocuments rewritten: ${rewritten}`)
