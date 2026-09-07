/**
 * Build the /prop-width test workbook: one row per address, screenshot inline.
 *
 * Writes the .xlsx by hand rather than pulling in a spreadsheet library. The
 * format is a zip of XML parts and the subset needed here — one sheet, inline
 * strings, a drawing per image — is small and stable, which is a better trade
 * than a dependency carried in package.json for a test artifact.
 *
 * Screenshots go in at full resolution. Downscaling would halve the file but
 * would also cost the frontage labels their legibility, and reading those is
 * the entire point of looking at the sheet.
 *
 * Run scripts/shoot-prop-width.mjs first — this reads its output.
 *
 * Usage: node scripts/build-test-sheet.mjs [--dir build/prop-width-tests]
 *                                          [--name prop-width-gnaf-test-cases]
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

// ── zip ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * Minimal zip writer.
 *
 * XML parts are deflated; PNGs are stored, because they are already compressed
 * and deflating them again costs time for nothing.
 */
function zip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const isPng = name.endsWith('.png')
    const body = isPng ? data : deflateRawSync(data, { level: 9 })
    const method = isPng ? 0 : 8
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0, 6)           // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)          // mod time
    local.writeUInt16LE(0x2821, 12)     // mod date — a fixed 2020-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)          // extra length

    chunks.push(local, nameBuf, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014B50, 0)
    dir.writeUInt16LE(20, 4)            // version made by
    dir.writeUInt16LE(20, 6)            // version needed
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0x2821, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt16LE(0, 30)            // extra
    dir.writeUInt16LE(0, 32)            // comment
    dir.writeUInt16LE(0, 34)            // disk
    dir.writeUInt16LE(0, 36)            // internal attrs
    dir.writeUInt32LE(0, 38)            // external attrs
    dir.writeUInt32LE(offset, 42)       // local header offset
    central.push(dir, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, end])
}

// ── xlsx ────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Excel rejects control characters in a sheet; strip rather than escape.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

const EMU_PER_PX = 9525
/** Displayed size of each screenshot, in px. Source images are 1560x940. */
const IMG_W = 760
const IMG_H = Math.round(760 * (940 / 1560))

const COLUMNS = [
  { key: 'address', header: 'Address', width: 32 },
  { key: 'shot', header: 'Screenshot', width: Math.round((IMG_W - 5) / 7) },
  { key: 'bucket', header: 'Test case', width: 22 },
  { key: 'why', header: 'What to check', width: 44 },
  { key: 'lga', header: 'LGA', width: 11 },
  { key: 'lot', header: 'Lot / plan', width: 16 },
  { key: 'recorded', header: 'Recorded frontages (DB)', width: 40 },
  { key: 'shown', header: 'Frontages the panel listed', width: 40 },
  { key: 'result', header: 'Result', width: 26 },
]

const col = i => String.fromCharCode(65 + i)

/** Header bold on a fill; body wrapped and top-aligned so long lists read. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF7F1D1D"/><name val="Consolas"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function sheetXml(rows) {
  const cols = COLUMNS
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('')

  const header = `<row r="1" ht="26" customHeight="1">${
    COLUMNS.map((c, i) =>
      `<c r="${col(i)}1" s="1" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join('')
  }</row>`

  const body = rows.map((row, r) => {
    const n = r + 2
    const cells = COLUMNS.map((c, i) => {
      if (c.key === 'shot') return `<c r="${col(i)}${n}" s="2"/>`   // the drawing sits over it
      const style = c.key === 'result' ? 3 : 2
      return `<c r="${col(i)}${n}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(row[c.key])}</t></is></c>`
    }).join('')
    return `<row r="${n}" ht="${Math.round(IMG_H * 0.75) + 6}" customHeight="1">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${header}${body}</sheetData>
<drawing r:id="rId1"/>
</worksheet>`
}

/**
 * One anchored picture per row, in the screenshot column.
 *
 * oneCellAnchor with an explicit extent: the image keeps its size regardless of
 * how the reader later resizes the column, which twoCellAnchor would not.
 */
function drawingXml(count) {
  const shotCol = COLUMNS.findIndex(c => c.key === 'shot')
  const pics = Array.from({ length: count }, (_, i) => {
    const id = i + 1
    return `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${shotCol}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${i + 1}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>
<xdr:ext cx="${IMG_W * EMU_PER_PX}" cy="${IMG_H * EMU_PER_PX}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="${id}" name="Screenshot ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${IMG_W * EMU_PER_PX}" cy="${IMG_H * EMU_PER_PX}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${pics}</xdr:wsDr>`
}

function buildWorkbook(rows, images) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="prop-width tests" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`

  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${images.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.png"/>`).join('\n')}
</Relationships>`

  const utf8 = s => Buffer.from(s, 'utf8')
  return zip([
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/styles.xml', data: utf8(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(rows)) },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: utf8(sheetRels) },
    { name: 'xl/drawings/drawing1.xml', data: utf8(drawingXml(images.length)) },
    { name: 'xl/drawings/_rels/drawing1.xml.rels', data: utf8(drawingRels) },
    ...images.map((buf, i) => ({ name: `xl/media/image${i + 1}.png`, data: buf })),
  ])
}

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * Reduce a lot id to `lot|plan` so the two spellings can be compared.
 *
 * The table writes `lot/section/plan` — "101//DP1212206" with no section,
 * "6/26A/DP249046" with one, "//SP16231" for a strata plan where the lot
 * number is genuinely absent. The page's heading reads "Lot 101 DP1212206" or
 * "Lot 6 Sec 26A DP249046".
 *
 * The section is deliberately not part of the key. It only ever appears
 * alongside a lot and plan that already identify the parcel, and matching on it
 * cost nothing but false alarms: an earlier version anchored the lot number to
 * a literal "//" and so read nothing at all from "6/26A/DP249046", reporting a
 * lot the page had opened correctly as the wrong one.
 */
function lotKey(text) {
  const s = String(text ?? '').toUpperCase().trim()
  const plan = (s.match(/\b((?:DP|SP)\d+)\b/) || [])[1] || ''
  const lot = s.includes('/')
    ? s.split('/')[0].trim()                                  // table: lot/section/plan
    : (s.match(/^LOT\s+([0-9A-Z]+)\b/) || [])[1] || ''         // page: "Lot 6 Sec 26A DP…"
  return `${lot}|${plan}`
}

/**
 * What the page showed, against what the table records.
 *
 * The page no longer works out which boundary edge a frontage sits on — the
 * source does not record that — so there is nothing to score for placement.
 * What is left is worth checking and is checked here: that the screenshot is
 * of the right parcel, and that every frontage in `all_frontages` reached the
 * panel.
 */
function verdict(meta, summary) {
  if (!summary?.lot) return 'NO LOT SELECTED'

  const wanted = lotKey(meta.lot_section_plan)
  const got = lotKey(summary.lot)
  if (wanted !== '|' && got !== '|' && wanted !== got) {
    return `WRONG LOT — expected ${meta.lot_section_plan}, page opened ${summary.lot}`
      + `${summary.address && summary.address !== meta.address ? ` (${summary.address})` : ''}`
  }

  const listed = (summary.frontages || []).length
  const recorded = String(meta.all_frontages || '').split(',').filter(Boolean).length

  if (!recorded && !listed) return 'OK — none recorded, none shown'
  if (listed !== recorded) return `CHECK — table records ${recorded}, panel listed ${listed}`
  return `OK — ${listed} frontage${listed === 1 ? '' : 's'} shown as recorded`
}

async function main() {
  const dir = path.resolve(argDir())
  const results = JSON.parse(await readFile(path.join(dir, 'results.json'), 'utf8'))

  const shotDir = path.join(dir, 'screenshots')
  const files = (await readdir(shotDir)).filter(f => f.endsWith('.png')).sort()

  const rows = []
  const images = []
  for (const r of results) {
    // Recorded by the run itself — see the note on shootAll.
    const m = r.meta || {}
    const s = r.summary || {}
    const file = r.file && files.includes(r.file) ? r.file : null
    if (!file) { console.warn(`  no screenshot for ${r.address} — row will be blank`); continue }

    images.push(await readFile(path.join(shotDir, file)))
    rows.push({
      address: r.address,
      shot: '',
      bucket: m.bucket || '',
      why: m.why || '',
      lga: m.lga_name || '',
      lot: m.lot_section_plan || s.lot || '',
      recorded: (m.all_frontages || '—').split(',').join('\n'),
      shown: (s.frontages || []).length
        ? s.frontages.map(f => `${f.road} — ${f.length}${f.matched ? '' : '  (not placed)'}`).join('\n')
        : '—',
      result: verdict(m, s),
    })
  }

  const xlsx = buildWorkbook(rows, images)
  const out = path.join(dir, `${argName()}.xlsx`)
  await writeFile(out, xlsx)
  console.log(`${rows.length} rows -> ${out}  (${(xlsx.length / 1024 / 1024).toFixed(1)} MB)`)
  return out
}

/** Workbook filename, without extension. */
function argName() {
  const i = process.argv.indexOf('--name')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'prop-width-test-cases'
}

function argDir() {
  const i = process.argv.indexOf('--dir')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'build/prop-width-tests'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
