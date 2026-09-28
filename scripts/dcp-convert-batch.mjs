/**
 * Convert every harvested DCP to .md + .html, merge multi-part plans, and publish.
 *
 * Resumable and checkpointed, because this is a multi-hour run and the alternative is restarting
 * it after every interruption. A part whose .md already exists is skipped; progress is appended to
 * a TSV as each instrument completes.
 *
 * TWO THINGS IT DOES THAT A LOOP OVER dcp-convert.mjs WOULD NOT:
 *
 * 1. REUSES THE DOCLING EXTRACTION between the .md and .html runs. dcp-convert.mjs caches to TEMP
 *    but only reads the cache when --docling-json is passed explicitly, so the second format
 *    re-extracts by default. Measured on Burwood: 22m 30s to extract, 14s to re-render. Passing
 *    the cache halves the whole batch.
 *
 * 2. GIVES EACH PART ITS OWN ANCHOR PREFIX. Parts of a multi-part DCP restart clause numbering at
 *    1, so without a prefix every part owns `dcp.2.1` and the winner is whichever converted last -
 *    deep links then land in the wrong chapter. The prefix comes from the manifest's `part` field.
 *
 * Usage:
 *   node scripts/dcp-convert-batch.mjs --councils-file sydney_councils.txt [--limit 3]
 *   node scripts/dcp-convert-batch.mjs --scope citywide --resume
 */
import { execFile } from 'node:child_process'
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] }
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null
const SCOPE = arg('--scope') ?? 'citywide'

const REPO = process.cwd()
const DCP = path.join(REPO, 'public', 'EPI', 'DCPs')
const MAN = path.join(DCP, 'manifests')
const BUILD = path.join(REPO, 'build', 'dcp-batch')
const PROGRESS = path.join(BUILD, 'progress.tsv')
const TEMP = process.env.TEMP || process.env.TMPDIR || '.'

const exists = async p => { try { return (await stat(p)).size } catch { return 0 } }
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')

/** Docling's own cache path for a source file, so both formats share one extraction. */
const doclingCache = pdf =>
  path.join(TEMP, `docling-${path.basename(pdf).replace(/\W+/g, '_')}.json`)

/**
 * The per-part code, read from the manifest rather than derived here.
 *
 * dcp-merge resolves each part as `<anchor_prefix ?? part>.html`, so the converted file has to be
 * named for the same value the merge looks up and the same value the clause anchors use. Deriving
 * it independently in this script is what produced "01-part-a-…" against a merge looking for "A",
 * and every multi-part instrument merged to nothing.
 */
function prefixOf(man, file) {
  const p = (man.parts ?? []).find(x => x.file && path.basename(x.file) === file)
  return p?.anchor_prefix ?? p?.part ?? path.basename(file).replace(/\.pdf$/i, '')
}

async function convert(pdf, out, images, prefix, label) {
  const cache = doclingCache(pdf)
  const a = ['scripts/dcp-convert.mjs', '--in', pdf, '--out', out, '--images', images,
    '--docling-json', cache]
  if (prefix) a.push('--anchor-prefix', prefix)
  if (label) a.push('--part-label', label)
  await run(process.execPath, a, { cwd: REPO, maxBuffer: 1 << 28, timeout: 3 * 3600_000 })
}

async function main() {
  await mkdir(BUILD, { recursive: true })
  const idx = JSON.parse(await readFile(path.join(MAN, '_index.json'), 'utf-8'))

  let wanted = null
  const cf = arg('--councils-file')
  if (cf) {
    const names = (await readFile(cf, 'utf-8')).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    const n = s => String(s).toLowerCase().replace(/[^a-z]/g, '')
    const set = new Set(names.map(n))
    wanted = i => (i.councils ?? []).some(c => set.has(n(c)))
  }

  let todo = idx.instruments
    .filter(i => i.scope === SCOPE)
    .filter(i => !wanted || wanted(i))
    .sort((a, b) => a.parts - b.parts)          // smallest first: failures surface early and cheap
  if (LIMIT) todo = todo.slice(0, LIMIT)

  if (!(await exists(PROGRESS))) {
    await writeFile(PROGRESS, 'instrument\tparts\tmd\thtml\tseconds\tnote\n', 'utf-8')
  }
  const done = new Set((await readFile(PROGRESS, 'utf-8')).split('\n').slice(1)
    .map(l => l.split('\t')[0]).filter(Boolean))

  console.log(`${todo.length} instruments (${SCOPE})`
    + `${done.size ? `, ${done.size} already done` : ''}\n`)

  for (const [n, inst] of todo.entries()) {
    if (done.has(inst.key)) { console.log(`[${n + 1}/${todo.length}] ${inst.title} — done`); continue }
    const t0 = Date.now()
    const folder = inst.folders[0]
    const dir = path.join(DCP, 'pdf', folder)
    let files
    try { files = (await readdir(dir)).filter(f => f.endsWith('.pdf')).sort() } catch { files = [] }
    if (!files.length) {
      await appendFile(PROGRESS, `${inst.key}\t0\t0\t0\t0\tno pdfs\n`)
      continue
    }

    const manFile = (inst.manifests ?? [])[0]
    const man = manFile ? JSON.parse(await readFile(path.join(MAN, manFile), 'utf-8')) : { parts: [] }
    const partOf = f => (man.parts ?? []).find(p => p.file && path.basename(p.file) === f)?.part

    console.log(`[${n + 1}/${todo.length}] ${inst.title}  (${files.length} parts)`)
    const outSlug = slug(inst.title).slice(0, 60)
    const partDir = path.join(BUILD, outSlug)
    await mkdir(partDir, { recursive: true })

    let ok = 0, bad = 0
    for (const f of files) {
      const pdf = path.join(dir, f)
      const label = partOf(f)
      const prefix = files.length > 1 ? prefixOf(man, f) : ''
      // named for the prefix, because that is what dcp-merge looks for
      const base = path.join(partDir, prefix || f.replace(/\.pdf$/i, ''))
      try {
        if (!(await exists(`${base}.md`))) {
          await convert(pdf, `${base}.md`, outSlug, prefix, label)
        }
        if (!(await exists(`${base}.html`))) {
          await convert(pdf, `${base}.html`, outSlug, prefix, label)
        }
        ok++
        process.stdout.write(`    ${String(ok).padStart(3)}/${files.length} ${f.slice(0, 52)}\r`)
      } catch (e) {
        bad++
        console.log(`\n    FAILED ${f.slice(0, 46)}  ${String(e.message || e).slice(0, 60)}`)
      }
    }

    // Stitch the parts into the one instrument the library lists. A single-part plan has
    // nothing to stitch - its converted output IS the instrument - and dcp-merge takes
    // --manifest and --parts, not --in/--format. The first smoke run got both wrong.
    let mdBytes = 0, htmlBytes = 0
    try {
      if (files.length === 1) {
        const base = path.join(partDir, files[0].replace(/\.pdf$/i, ''))
        // single-part instruments keep the pdf-derived stem: nothing merges them
        for (const fmt of ['md', 'html']) {
          const src = `${base}.${fmt}`
          if (await exists(src)) await copyFile(src, path.join(DCP, `${outSlug}.${fmt}`))
        }
      } else if (manFile) {
        await run(process.execPath, ['scripts/dcp-merge.mjs',
          '--manifest', path.join(MAN, manFile), '--parts', partDir,
          '--out', path.join(DCP, `${outSlug}.html`), '--md'],
        { cwd: REPO, maxBuffer: 1 << 28 })
      }
      mdBytes = await exists(path.join(DCP, `${outSlug}.md`))
      htmlBytes = await exists(path.join(DCP, `${outSlug}.html`))
    } catch (e) {
      console.log(`\n    merge failed: ${String(e.message || e).slice(0, 80)}`)
    }

    const secs = Math.round((Date.now() - t0) / 1000)
    await appendFile(PROGRESS,
      `${inst.key}\t${files.length}\t${mdBytes}\t${htmlBytes}\t${secs}\t${bad ? bad + ' parts failed' : ''}\n`)
    console.log(`\n    ${(mdBytes / 1e6).toFixed(1)} MB md, ${(htmlBytes / 1e6).toFixed(1)} MB html`
      + `, ${secs}s${bad ? `, ${bad} parts failed` : ''}`)

    if (mdBytes) {
      await run(process.execPath, ['scripts/dcp-publish.mjs', '--slug', outSlug], { cwd: REPO })
        .then(r => process.stdout.write('    ' + (r.stdout || '').split('\n')[0] + '\n'))
        .catch(e => console.log('    publish failed:', String(e.message || e).slice(0, 60)))
    }
  }
  console.log(`\nprogress: ${path.relative(REPO, PROGRESS)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
