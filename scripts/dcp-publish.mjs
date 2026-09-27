/**
 * Publish a converted DCP to the library, from one source, with gates.
 *
 * WHY. A document had to be registered in TWO hand-edited places to be readable: an entry in
 * public/instruments.json (what /library lists) and another in DOC_MAP inside
 * app/pages/doc-viewer.vue (what /doc-viewer can open). They already disagree - instruments.json
 * lists 10 DCPs, DOC_MAP holds 8, and neither lists Randwick DCP 2025's .html. At 31 councils
 * that is 62 hand-edits and a guarantee of drift.
 *
 * So: instruments.json becomes the single source, this script writes it, and doc-viewer reads a
 * generated map instead of carrying its own copy.
 *
 * THE GATES. Publishing is the moment a document starts being quoted to a planner, so the checks
 * belong here rather than downstream:
 *
 *   - the .md must exist and be non-trivial. Docling runs with do_ocr = False, so a scanned part
 *     converts to an EMPTY file and the run still exits 0 - Canterbury-Bankstown chapter 11.16 is
 *     57 pages that would do exactly that.
 *   - the .html must exist, because it is the clause-structured form: data-number, data-rubric,
 *     data-part. Without it /doc-viewer has no clause anchors and the rule layer has no rubric to
 *     route on, so a markdown-only publish is a document you can read but not cite.
 *   - every part in the manifest must have downloaded. A plan published while a chapter is missing
 *     reads as complete, which is the failure this whole pipeline keeps finding.
 *
 * Usage:
 *   node scripts/dcp-publish.mjs --slug burwood-dcp [--force] [--dry-run]
 *   node scripts/dcp-publish.mjs --all            publish everything converted
 *   node scripts/dcp-publish.mjs --sync           rewrite the doc-viewer map only
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] }
const DRY = args.includes('--dry-run')
const FORCE = args.includes('--force')

const REPO = process.cwd()
const DCP_DIR = path.join(REPO, 'public', 'EPI', 'DCPs')
const MAN_DIR = path.join(DCP_DIR, 'manifests')
const INSTRUMENTS = path.join(REPO, 'public', 'instruments.json')
const DOCMAP = path.join(DCP_DIR, '_docmap.json')
const MIN_MD_BYTES = 20_000     // a real DCP part is tens of KB; an OCR-less scan is ~0

const exists = async p => { try { return (await stat(p)).size } catch { return 0 } }

/** Find the manifest and index record for a converted slug. */
async function describe(slug) {
  const idx = JSON.parse(await readFile(path.join(MAN_DIR, '_index.json'), 'utf-8'))
  const mdBytes = await exists(path.join(DCP_DIR, `${slug}.md`))
  const htmlBytes = await exists(path.join(DCP_DIR, `${slug}.html`))

  // match the converted slug to an instrument: the .md is named for the output, which may be
  // shorter than the instrument key (burwood-dcp vs burwood-development-control-plan)
  // Match on the index's `folders` array, which already holds every slug both harvest paths
  // produced for an instrument - "randwick-dcp-2025" and "randwick-development-control-plan-2025"
  // are the same plan and a prefix comparison of the two matches neither.
  const inst = idx.instruments.find(i => i.key === slug)
    ?? idx.instruments.find(i => (i.folders ?? []).includes(slug))
    ?? null

  let manifest = null, manifestPath = null
  if (inst) {
    for (const f of inst.manifests ?? []) {
      try {
        manifest = JSON.parse(await readFile(path.join(MAN_DIR, f), 'utf-8'))
        manifestPath = `EPI/DCPs/manifests/${f}`
        break
      } catch { /* try the next */ }
    }
  }
  return { slug, inst, manifest, manifestPath, mdBytes, htmlBytes }
}

function check(d) {
  const fail = []
  if (!d.mdBytes) fail.push('no .md - not converted')
  else if (d.mdBytes < MIN_MD_BYTES) fail.push(`.md is only ${d.mdBytes} bytes - a scanned source converts to nothing`)
  if (!d.htmlBytes) fail.push('no .html - clause anchors and rubrics are missing, so it can be read but not cited')
  // A document converted before this pipeline existed (the Liverpool GCP schedules, Albury) has
  // no harvest manifest. That is a missing attribution, not a reason to unpublish something the
  // library already lists - it is reported and allowed through.
  if (!d.inst) d.warn = 'no harvest manifest: council and currency unknown'
  const missing = (d.manifest?.parts ?? []).filter(p => p.error || !p.bytes)
  if (missing.length) fail.push(`${missing.length} part(s) never downloaded: ${missing.slice(0, 3).map(p => p.part).join(', ')}`)
  return fail
}

async function publish(slugs) {
  const doc = JSON.parse(await readFile(INSTRUMENTS, 'utf-8'))
  const items = doc.nsw.categories.dcp.items
  const map = {}
  let published = 0, refused = 0

  for (const slug of slugs) {
    const d = await describe(slug)
    const fail = check(d)
    if (d.warn) console.log(`  note     ${slug}  ${d.warn}`)
    if (fail.length && !FORCE) {
      refused++
      console.log(`  REFUSED  ${slug}`)
      for (const f of fail) console.log(`             ${f}`)
      continue
    }
    if (fail.length) console.log(`  forced   ${slug}  (${fail.length} check(s) failed)`)

    const councils = d.inst?.councils ?? []
    const entry = {
      slug,
      title: d.inst?.title ?? d.manifest?.title ?? slug,
      file: `EPI/DCPs/${slug}.md`,
      ...(d.htmlBytes ? { html: `EPI/DCPs/${slug}.html` } : {}),
      ...(d.manifestPath ? { manifest: d.manifestPath } : {}),
      ...(councils.length ? { councils } : {}),
      // as_at is the document's own words where the manifest has it; the aggregator's
      // lastAmended is triage only and is deliberately not published as currency
      ...(d.manifest?.as_at ? { as_at: d.manifest.as_at } : {}),
      // scope and currency travel with the entry so app/utils/instrument-visibility.ts can
      // derive what to list. It used to hold a hardcoded set of two slugs, which is a third
      // registry to remember and the reason a published document still did not appear.
      ...(d.inst?.scope ? { scope: d.inst.scope } : {}),
      ...(d.inst?.last_amended ? { last_amended: d.inst.last_amended } : {}),
    }
    const at = items.findIndex(i => i.slug === slug)
    if (at >= 0) items[at] = { ...items[at], ...entry }
    else items.push(entry)

    map[slug] = {
      title: entry.title,
      lga: councils[0] ?? d.manifest?.lga ?? null,
      mdPath: `/EPI/DCPs/${slug}.md`,
      ...(d.htmlBytes ? { htmlPath: `/EPI/DCPs/${slug}.html` } : {}),
    }
    published++
    console.log(`  ok       ${slug}  ${(d.mdBytes / 1e6).toFixed(1)} MB md`
      + `${d.htmlBytes ? `, ${(d.htmlBytes / 1e6).toFixed(1)} MB html` : ''}`
      + `  ${councils.slice(0, 2).join(', ')}`)
  }

  // keep any legacy entries that were never converted by this pipeline
  for (const i of items) {
    if (!map[i.slug]) {
      map[i.slug] = { title: i.title, lga: i.councils?.[0] ?? null,
        mdPath: '/' + i.file, ...(i.html ? { htmlPath: '/' + i.html } : {}) }
    }
  }
  items.sort((a, b) => a.slug.localeCompare(b.slug))

  if (!DRY) {
    await writeFile(INSTRUMENTS, JSON.stringify(doc, null, 2) + '\n')
    await writeFile(DOCMAP, JSON.stringify({
      _comment: 'Generated by scripts/dcp-publish.mjs from public/instruments.json. '
        + '/doc-viewer reads this instead of a second hand-maintained DOC_MAP.',
      generated_at: new Date().toISOString().slice(0, 10),
      docs: map,
    }, null, 2) + '\n')
  }
  console.log(`\n  ${published} published, ${refused} refused, ${items.length} DCPs in the library`)
  if (DRY) console.log('  dry run - nothing written')
}

async function main() {
  if (args.includes('--all') || args.includes('--sync')) {
    const files = (await readdir(DCP_DIR)).filter(f => f.endsWith('.md'))
    await publish(files.map(f => f.slice(0, -3)))
    return
  }
  const slug = arg('--slug')
  if (!slug) { console.error('usage: --slug <name> | --all | --sync'); process.exit(2) }
  await publish([slug])
}

main().catch(e => { console.error(e); process.exit(1) })
