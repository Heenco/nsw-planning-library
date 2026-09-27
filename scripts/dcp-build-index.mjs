/**
 * Reconcile the harvested DCPs: fix council attribution, dedupe instruments, classify scope,
 * and write the index that /library and the ingest read.
 *
 * THREE PROBLEMS THIS FIXES, all found by looking at what the harvest produced.
 *
 * 1. COUNCIL ATTRIBUTION WAS A SUBSTRING MATCH. The harvester matched a council name against the
 *    index with `includes` in both directions, so "Sydney" matched "North Sydney" and the City of
 *    Sydney DCP was filed under North Sydney. The library index carries an authoritative
 *    `councils[]` array per document; that is used here instead, and the fuzzy match is gone.
 *
 * 2. ONE INSTRUMENT, TWO FOLDERS. Blacktown DCP 2015 exists as both `blacktown-dcp-2015` (from the
 *    council-scraping path) and `blacktown-development-control-plan-2015` (from the harvest),
 *    because the two paths slugged different strings. Keyed on the library's `publicId`, they
 *    collapse to one.
 *
 * 3. A COUNCIL FOLDER TREE CANNOT HOLD THIS. Five DCPs serve more than one council - the Pattern
 *    Book and Apartment Design Guide cover 128 each, and the Western Sydney Aerotropolis DCP has
 *    genuinely no single owner. That is many-to-many, and a path is one-to-many. So storage stays
 *    keyed by instrument (each document stored once) and the relationship lives in the index.
 *
 * It also classifies scope, because "every document a council has published" is not the same as
 * "this council's DCP", and only the first belongs in the library as such:
 *   statewide     applies to many councils (Pattern Book, Apartment Design Guide)
 *   citywide      the council's principal DCP
 *   site_specific a named precinct, estate or address
 *
 * Usage: node scripts/dcp-build-index.mjs [--write] [--link]
 *   --write   update each manifest's councils/scope in place
 *   --link    also create by-council/ junctions for human browsing (no bytes duplicated)
 */
import { mkdir, readFile, readdir, writeFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const LINK = args.includes('--link')

const REPO = process.cwd()
const MAN_DIR = path.join(REPO, 'public', 'EPI', 'DCPs', 'manifests')
const PDF_DIR = path.join(REPO, 'public', 'EPI', 'DCPs', 'pdf')
const INDEX = path.join(MAN_DIR, '_index.json')
const LIST = 'https://app.propcode.com.au/api/library/document/nsw?page=1&pageSize=600&all=true'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')

/** A document that many councils share is state-wide guidance, not any council's DCP. */
const STATEWIDE_AT = 10

/** Named precinct, estate, road or address in the title: a site control, not a city-wide plan. */
const SITE_WORDS = /\b(precinct|estate|renewal|release area|town centre|city centre|village|park|corridor|road|street|avenue|site|stage \d|urban|aerotropolis|growth centre)\b/i
const CITYWIDE = /\b(development control plan|dcp)\b/i

async function main() {
  const index = await (await fetch(LIST, { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json()
  const byPublicId = new Map(index.map(d => [d.publicId, d]))
  const byName = new Map(index.map(d => [slug(d.name), d]))

  const files = (await readdir(MAN_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'))
  const docs = new Map()          // publicId (or slug) -> record
  const orphans = []

  for (const f of files) {
    const m = JSON.parse(await readFile(path.join(MAN_DIR, f), 'utf-8'))
    const folder = m.instrument ?? path.basename(f, '.json')
    // Match the library record by name; the manifest slug and the library publicId differ
    // between the two harvest paths, which is what produced the duplicate folders.
    const lib = byName.get(slug(m.title ?? '')) ?? byPublicId.get(folder) ?? null
    const key = lib?.publicId ?? folder
    const councils = lib ? lib.councils.map(c => c.name).sort()
      : (m.lga ? [m.lga] : [])          // council-scraped manifests carry a single lga
    if (!lib) orphans.push({ file: f, title: m.title })

    const scope = councils.length >= STATEWIDE_AT ? 'statewide'
      : (SITE_WORDS.test(m.title ?? '') && !/^(?!.*\b(city|shire|council)\b).*$/i.test('')) ? 'site_specific'
        : CITYWIDE.test(m.title ?? '') && !SITE_WORDS.test(m.title ?? '') ? 'citywide'
          : 'site_specific'

    const parts = (m.parts ?? []).filter(p => p.file)
    const prev = docs.get(key)
    const rec = {
      key,
      title: m.title ?? lib?.name ?? folder,
      folders: [...new Set([...(prev?.folders ?? []), folder])],
      manifests: [...new Set([...(prev?.manifests ?? []), f])],
      councils, scope,
      last_amended: lib?.lastAmended ?? null,
      as_at: m.as_at ?? null,                 // still from the document's own words, per the runbook
      parts: Math.max(prev?.parts ?? 0, parts.length),
      bytes: Math.max(prev?.bytes ?? 0, parts.reduce((a, p) => a + (p.bytes ?? 0), 0)),
      source_page: m.source_page ?? lib?.externalUrl ?? null,
    }
    docs.set(key, rec)
  }

  const all = [...docs.values()].sort((a, b) => a.title.localeCompare(b.title))
  const dupes = all.filter(d => d.folders.length > 1)
  const byCouncil = new Map()
  for (const d of all) for (const c of d.councils) {
    if (!byCouncil.has(c)) byCouncil.set(c, [])
    byCouncil.get(c).push({ key: d.key, title: d.title, scope: d.scope, last_amended: d.last_amended })
  }

  const counts = all.reduce((a, d) => (a[d.scope] = (a[d.scope] ?? 0) + 1, a), {})
  console.log(`${files.length} manifests -> ${all.length} distinct instruments`)
  console.log('  scope:', counts)
  console.log(`  ${dupes.length} instruments had more than one folder:`)
  for (const d of dupes) console.log(`    ${d.title.slice(0, 50)}  <-  ${d.folders.join(' , ')}`)
  console.log(`  ${orphans.length} manifests not found in the library index`)
  for (const o of orphans.slice(0, 6)) console.log(`    ${o.file}  ${String(o.title).slice(0, 44)}`)

  console.log(`\n  ${byCouncil.size} councils. Principal (city-wide) DCP per council:`)
  for (const [c, ds] of [...byCouncil].sort()) {
    const city = ds.filter(d => d.scope === 'citywide')
      .sort((a, b) => String(b.last_amended).localeCompare(String(a.last_amended)))
    if (city.length) {
      console.log(`    ${c.slice(0, 22).padEnd(24)} ${city[0].last_amended}  ${city[0].title.slice(0, 44)}`
        + (city.length > 1 ? `   (+${city.length - 1} more city-wide)` : ''))
    } else {
      console.log(`    ${c.slice(0, 22).padEnd(24)} -- no city-wide DCP identified (${ds.length} docs)`)
    }
  }

  if (WRITE) {
    await writeFile(INDEX, JSON.stringify({
      _comment: 'Generated by scripts/dcp-build-index.mjs. Council attribution comes from the '
        + 'library index\'s councils[] array, not from name matching. Storage is keyed by '
        + 'instrument because five DCPs serve more than one council and a path cannot hold '
        + 'many-to-many.',
      generated_at: new Date().toISOString().slice(0, 10),
      instruments: all,
      by_council: Object.fromEntries([...byCouncil].sort()),
    }, null, 2) + '\n')
    console.log(`\n  index -> ${path.relative(REPO, INDEX)}`)

    for (const d of all) {
      for (const f of d.manifests) {
        const p = path.join(MAN_DIR, f)
        const m = JSON.parse(await readFile(p, 'utf-8'))
        m.councils = d.councils            // array: a document can serve several
        m.scope = d.scope
        delete m.council                   // single-value field was the fuzzy match's output
        delete m.lga
        await writeFile(p, JSON.stringify(m, null, 2) + '\n')
      }
    }
    console.log(`  rewrote councils/scope on ${files.length} manifests`)
  }

  if (LINK) {
    const root = path.join(PDF_DIR, '_by-council')
    await rm(root, { recursive: true, force: true })
    let n = 0
    for (const [c, ds] of byCouncil) {
      const dir = path.join(root, slug(c))
      await mkdir(dir, { recursive: true })
      for (const d of ds) {
        const rec = docs.get(d.key)
        for (const folder of rec.folders) {
          await symlink(path.join(PDF_DIR, folder), path.join(dir, folder), 'junction')
            .then(() => n++).catch(() => {})
        }
      }
    }
    console.log(`  ${n} junctions under ${path.relative(REPO, root)} (no bytes duplicated)`)
  }
  if (!WRITE) console.log('\n  dry run - pass --write to update manifests and emit the index')
}

main().catch(e => { console.error(e); process.exit(1) })
