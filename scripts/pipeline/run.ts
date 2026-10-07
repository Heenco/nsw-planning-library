/**
 * Step 12 of the rule pipeline (docs/sepp-rule-pipeline.md §7): run the pipeline for whatever changed.
 *
 *   npx tsx scripts/pipeline/run.ts                                   # every profile in profiles/
 *   npx tsx scripts/pipeline/run.ts --profile housing-sepp-2021
 *   ... --dry                     # decide and report only - run no step, write nothing
 *   ... --force                   # rerun every step as if the profile had changed
 *   ... --simulate sec.168-ssec.2 # treat these sections (comma list) as changed in the source - the
 *                                 # done-when test, without touching the graph's text
 *   ... --base <url>              # where the answer keys ask /api/rules/at (default http://localhost:3000)
 *   ... --publish                 # if every gate is green, flip this instrument's held rules to published
 *                                 # (decision D6: only on Manni's say-so)
 *
 * For each profile:
 *   1. source    hash the registered file; due when it differs from source_registry.last_ingested_sha256
 *   2. sections  if due (or simulated): compare the file's sections with the graph's by local_id. Added or
 *                removed sections are a structural change - stage 0 reloads, on purpose - so the run stops.
 *                Changed text is applied only with --update-sections (Q3: it rewrites stage-0 rows, D5).
 *   3. what to run
 *                - the profile or a pipeline script changed since the last completed run (fingerprint), or
 *                  --force: frames, route, terms, extract (each profile chapter), edges - everything
 *                - else sections changed: route, then extract ONLY the clauses holding a changed section
 *                  (--clauses), then edges for those chapters; a changed frame source is a gating finding,
 *                  since frames are hand-written (D3)
 *                - else nothing, and it says so
 *   4. answer keys (step 10) against --base, recorded
 *   5. gate      keys pass and no open gating finding -> eligible (published only with --publish); else held
 * Every run writes one ingest_run (stage_metrics.step 12) with what it decided and why.
 */
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import type { InstrumentProfile } from '../../profiles/housing-sepp-2021'
import { flattenTree, parseNswXml } from '../../server/utils/nsw-kg/parsers/nsw-xml-parser'

const argv = process.argv.slice(2)
const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null)
const DRY = argv.includes('--dry')
const FORCE = argv.includes('--force')
const PUBLISH = argv.includes('--publish')
const UPDATE_SECTIONS = argv.includes('--update-sections')
const BASE = opt('--base') ?? 'http://localhost:3000'
const SIMULATE = (opt('--simulate') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const PROFILES = opt('--profile') ? [opt('--profile')!]
  : readdirSync('profiles').filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''))

/** What decides the rules besides the source: the profile and the step scripts. */
const FINGERPRINT_FILES = (profile: string) => [`profiles/${profile}.ts`, `tests/answer-keys/${profile}.json`,
  ...['frames', 'route', 'extract', 'edges', 'terms'].map(s => `scripts/pipeline/${s}.ts`), 'shared/land-use-key.ts']
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
const sectionHash = (h: string | null | undefined, t: string | null | undefined) => sha(`${norm(h)}\n${norm(t)}`)

/** Run one step script; its output is kept for the log, its last lines echoed. */
function step(label: string, script: string, args: string[]): { ok: boolean; out: string } {
  const cmd = `npx tsx scripts/pipeline/${script} ${args.map(a => (/[\s,]/.test(a) ? `"${a}"` : a)).join(' ')}`
  const t0 = Date.now()
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const verdict = out.trim().split(/\r?\n/).filter(l => /PASS|FAIL/.test(l)).pop() ?? out.trim().split(/\r?\n/).pop() ?? ''
  console.log(`    ${r.status === 0 ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${verdict.trim().slice(0, 110)}`)
  return { ok: r.status === 0, out }
}

/** rule_key -> a hash of what the rule says, for the before/after diff. */
async function snapshot(client: pg.Client, docId: string, instrument: string) {
  const r = await client.query(
    `SELECT r.rule_key, r.publish_state,
            md5(coalesce((SELECT string_agg(a.dimension || '=' || a.value || '/' || a.polarity, ';' ORDER BY a.dimension, a.value, a.polarity)
                            FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '') || '|' ||
                coalesce((SELECT string_agg(e.effect_type || ':' || coalesce(e.topic, '') || coalesce(e.comparator, '') || coalesce(e.value::text, ''), ';'
                                            ORDER BY e.effect_type, e.topic, e.value) FROM nsw.rule_effect e WHERE e.rule_id = r.id), '')) AS h
       FROM nsw.rule r WHERE r.document_id = $1 AND r.rule_key LIKE $2`, [docId, `${instrument}:pipeline:%`])
  return new Map(r.rows.map(x => [x.rule_key as string, `${x.publish_state}|${x.h}`]))
}

function diff(a: Map<string, string>, b: Map<string, string>) {
  const added = [...b.keys()].filter(k => !a.has(k))
  const changed = [...b.keys()].filter(k => a.has(k) && a.get(k) !== b.get(k))
  const unchanged = [...b.keys()].filter(k => a.get(k) === b.get(k)).length
  return { added, changed, unchanged }
}

async function runProfile(client: pg.Client, name: string) {
  const started = new Date()
  const profile: InstrumentProfile = (await import(`../../profiles/${name}.ts`)).default
  const doc = (await client.query(`SELECT id, title FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  if (!doc) { console.log(`  ${name}: no document ${profile.slug} in the graph - load it first (stage 0)`); return }
  const reg = (await client.query(
    `SELECT label, raw_path, content_sha256, last_ingested_sha256, last_ingested_at FROM nsw.source_registry WHERE document_id = $1`,
    [doc.id])).rows[0]
  console.log(`\n${doc.title} (${name})`)
  const metrics: any = { step: 12, script: 'scripts/pipeline/run.ts', profile: name, dry: DRY, force: FORCE, simulate: SIMULATE }
  const finish = async (status: 'success' | 'failed', outcome: string, extra: any = {}) => {
    Object.assign(metrics, { outcome, ...extra })
    console.log(`  => ${outcome}`)
    if (!DRY) {
      await client.query(
        `INSERT INTO nsw.ingest_run (id, document_id, doc_label, status, started_at, finished_at, stage_metrics)
         VALUES ($1, $2, $3, $4, $5, now(), $6)`, [randomUUID(), doc.id, profile.label, status, started, JSON.stringify(metrics)])
    }
  }
  const gatingFinding = async (kind: string, clause: string | null, detail: string) => {
    if (DRY) return
    await client.query(
      `INSERT INTO nsw.audit_finding (id, document_id, kind, gating, clause, value, detail, status)
       VALUES ($1, $2, $3, true, $4, null, $5, 'open')`, [randomUUID(), doc.id, kind, clause, `step12: ${detail}`])
  }

  // 1. source
  if (!reg?.raw_path || !existsSync(reg.raw_path)) return finish('failed', `source file not registered or missing (${reg?.raw_path ?? 'none'})`)
  const file = readFileSync(reg.raw_path)
  const fileSha = sha(file)
  const due = fileSha !== reg.last_ingested_sha256
  if (fileSha !== reg.content_sha256 && !DRY) step('registry (step 1)', 'registry.ts', [])
  metrics.source = { sha256: fileSha, due, lastIngestedAt: reg.last_ingested_at }
  console.log(`  source     ${due ? 'DUE - the file differs from the copy last ingested' : `current (ingested ${new Date(reg.last_ingested_at).toISOString().slice(0, 10)})`}`)

  // fingerprint of the profile + step scripts, against the last completed (non-dry) run
  const fingerprint = sha(FINGERPRINT_FILES(name).filter(existsSync).map(f => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\u0000'))
  const last = (await client.query(
    `SELECT stage_metrics->>'fingerprint' AS fp, started_at FROM nsw.ingest_run
      WHERE document_id = $1 AND stage_metrics->>'step' = '12' AND NOT coalesce((stage_metrics->>'dry')::boolean, false)
        AND stage_metrics->>'fingerprint' IS NOT NULL AND stage_metrics->>'outcome' NOT LIKE 'stopped%'
      ORDER BY started_at DESC LIMIT 1`, [doc.id])).rows[0]
  const profileChanged = !last || last.fp !== fingerprint
  metrics.fingerprint = fingerprint
  console.log(`  profile    ${!last ? 'no completed run yet' : profileChanged ? 'CHANGED since the last run (profile, answer keys or a step script)' : `unchanged since ${new Date(last.started_at).toISOString().slice(0, 16)}`}`)

  // 2. sections
  let changed: string[] = []
  if (due || SIMULATE.length) {
    const flat = flattenTree(parseNswXml(file.toString('utf8')).tree)
    const fileSec = new Map(flat.map(s => [s.local_id, s]))
    const db = (await client.query(`SELECT id, local_id, heading, raw_text FROM nsw.section WHERE document_id = $1`, [doc.id])).rows
    const dbSec = new Map(db.map(s => [s.local_id as string, s]))
    const added = [...fileSec.keys()].filter(k => !dbSec.has(k))
    const removed = [...dbSec.keys()].filter(k => !fileSec.has(k))
    const textChanged = [...fileSec.keys()].filter(k => dbSec.has(k)
      && sectionHash(fileSec.get(k)!.heading, fileSec.get(k)!.raw_text) !== sectionHash(dbSec.get(k).heading, dbSec.get(k).raw_text))
    metrics.sections = { file: fileSec.size, graph: dbSec.size, changed: textChanged.length, added: added.length, removed: removed.length, simulated: SIMULATE }
    console.log(`  sections   file ${fileSec.size}, graph ${dbSec.size}: ${textChanged.length} changed, ${added.length} added, ${removed.length} removed`
      + (SIMULATE.length ? `; simulated as changed: ${SIMULATE.join(', ')}` : ''))
    if (added.length || removed.length) {
      await gatingFinding('structural_change', null, `${added.length} sections added, ${removed.length} removed in the source - reload with stage 0 (scripts/ingest-nsw.ts --stage0-only), then rerun`)
      return finish('failed', 'stopped: structural change in the source (sections added or removed)', { added: added.slice(0, 20), removed: removed.slice(0, 20) })
    }
    if (textChanged.length && !UPDATE_SECTIONS) {
      await gatingFinding('section_text_changed', null, `${textChanged.length} sections changed: ${textChanged.slice(0, 10).join(', ')} - rerun with --update-sections (Q3)`)
      return finish('failed', `stopped: ${textChanged.length} sections changed in the source; updating section text needs --update-sections (Q3)`, { changed: textChanged })
    }
    if (textChanged.length && !DRY) {
      for (const k of textChanged) {
        const f = fileSec.get(k)!
        await client.query(`UPDATE nsw.section SET heading = $2, raw_text = $3, content_sha256 = $4 WHERE id = $1`,
          [dbSec.get(k).id, f.heading, f.raw_text, sectionHash(f.heading, f.raw_text)])
      }
    }
    for (const k of SIMULATE) if (!dbSec.has(k)) return finish('failed', `--simulate ${k}: no such section`)
    changed = [...new Set([...textChanged, ...SIMULATE])]
  }

  // 3. what to run
  const secs = (await client.query(`SELECT id, parent_id, local_id, level FROM nsw.section WHERE document_id = $1`, [doc.id])).rows
  const byId = new Map(secs.map(s => [s.id as string, s]))
  const byLocal = new Map(secs.map(s => [s.local_id as string, s]))
  const up = (lid: string) => { const out: any[] = []; for (let x = byLocal.get(lid); x; x = x.parent_id ? byId.get(x.parent_id) : null) out.push(x); return out }
  // each changed section -> its clause and chapter; only clauses inside the profile's chapters are extracted
  const work = new Map<string, Set<string>>()
  const outside: string[] = []
  for (const lid of changed) {
    const chain = up(lid)
    const clause = chain.find(x => x.level === 'clause')?.local_id
    const chapter = chain.map(x => x.local_id).find(x => profile.chapters.includes(x))
    if (!clause || !chapter) { outside.push(lid); continue }
    if (!work.has(chapter)) work.set(chapter, new Set())
    work.get(chapter)!.add(clause)
  }
  const frameHit = profile.frames.filter(f => changed.some(lid => lid === f.section || up(lid).some(x => x.local_id === f.section)))
  const full = profileChanged || FORCE
  metrics.plan = { full, chapters: Object.fromEntries([...work].map(([k, v]) => [k, [...v]])), outsideChapters: outside,
                   frameSourcesChanged: frameHit.map(f => f.clause) }

  if (!full && !changed.length) {
    console.log('  plan       nothing changed - no step run')
    if (due && !DRY) await client.query(`UPDATE nsw.source_registry SET last_ingested_sha256 = $2, last_ingested_at = now() WHERE label = $1`, [reg.label, fileSha])
    return finish('success', 'noop: nothing changed since the last run')
  }
  console.log(`  plan       ${full ? `FULL rerun (${FORCE ? '--force' : 'profile changed'}) of ${profile.chapters.join(', ')}`
    : `${changed.length} changed section(s) -> clauses ${[...work].map(([ch, cl]) => `${ch}: ${[...cl].join(', ')}`).join('; ') || 'none in an extracted chapter'}`}`
    + (outside.length ? `; ${outside.length} outside ${profile.chapters.join('/')} (not extracted yet)` : ''))
  if (frameHit.length) {
    console.log(`  frames     source of ${frameHit.map(f => `s ${f.clause}`).join(', ')} changed - the hand-written frame needs review (D3)`)
    for (const f of frameHit) await gatingFinding('frame_source_changed', f.clause, `the section a frame is read from (${f.section}) changed - review frame "${f.id}" in profiles/${name}.ts`)
  }
  if (DRY) return finish('success', 'dry: plan only')

  const before = await snapshot(client, doc.id, profile.instrument)
  const p = ['--profile', name]
  const results: { step: string; ok: boolean }[] = []
  const go = (label: string, script: string, args: string[]) => results.push({ step: label, ok: step(label, script, args).ok })
  if (full) {
    for (const ch of profile.chapters) go(`frames ${ch} (step 3)`, 'frames.ts', [...p, '--chapter', ch])
    go('route (step 4)', 'route.ts', p)
    for (const ch of profile.chapters) go(`extract ${ch} (step 5)`, 'extract.ts', [...p, '--chapter', ch])
    for (const ch of profile.chapters) go(`edges ${ch} (step 6)`, 'edges.ts', [...p, '--chapter', ch])
    go('terms (step 7)', 'terms.ts', p)
  } else if (work.size) {
    go('route (step 4)', 'route.ts', p)
    for (const [ch, cl] of work) go(`extract ${ch} ${[...cl].join(',')}`.slice(0, 30), 'extract.ts', [...p, '--chapter', ch, '--clauses', [...cl].join(',')])
    for (const ch of work.keys()) go(`edges ${ch} (step 6)`, 'edges.ts', [...p, '--chapter', ch])
  }
  const after = await snapshot(client, doc.id, profile.instrument)
  const d = diff(before, after)
  metrics.rules = { before: before.size, after: after.size, added: d.added, changed: d.changed, unchanged: d.unchanged }
  console.log(`  rules      ${after.size} pipeline rules: ${d.added.length} added, ${d.changed.length} changed, ${d.unchanged} unchanged`
    + (d.changed.length ? ` (${d.changed.map(k => k.split(':pipeline:')[1]).join(', ')})` : ''))

  // 4. answer keys (step 10)
  const keys = existsSync(`tests/answer-keys/${name}.json`)
    ? step('answer keys (step 10)', 'answer-keys.ts', [...p, '--record', '--base', BASE]) : null
  const keysLine = keys?.out.match(/(\d+)\/(\d+) cases pass/)
  // the harness ends with a line that is exactly PASS or FAIL
  metrics.answerKeys = keys ? { ok: keys.ok && keys.out.trim().split(/\r?\n/).pop()?.trim() === 'PASS',
                                pass: keysLine ? Number(keysLine[1]) : null, cases: keysLine ? Number(keysLine[2]) : null } : null

  // 5. gate
  const gating = Number((await client.query(
    `SELECT count(*) FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND gating`, [doc.id])).rows[0].count)
  const stepsOk = results.every(r => r.ok)
  const keysOk = !!metrics.answerKeys?.ok
  metrics.gate = { stepsOk, keysOk, gatingFindings: gating }
  console.log(`  gate       steps ${stepsOk ? 'ok' : 'FAILED: ' + results.filter(r => !r.ok).map(r => r.step).join(', ')}; `
    + `answer keys ${keys ? (keysOk ? `${metrics.answerKeys.pass}/${metrics.answerKeys.cases} pass` : 'FAIL') : 'none'}; ${gating} open gating finding(s)`)
  if (!stepsOk || !keysOk || gating) return finish('failed', 'held: a gate is not green')

  if (due) await client.query(`UPDATE nsw.source_registry SET last_ingested_sha256 = $2, last_ingested_at = now() WHERE label = $1`, [reg.label, fileSha])
  if (PUBLISH) {
    const n = (await client.query(`UPDATE nsw.rule SET publish_state = 'published' WHERE document_id = $1 AND publish_state = 'held'
                                     AND (rule_key LIKE $2 OR kind = 'frame')`, [doc.id, `${profile.instrument}:%`])).rowCount
    return finish('success', `published: ${n} rules`)
  }
  return finish('success', 'eligible: every gate green - held until run with --publish (D6)')
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  console.log(`SEPP rule pipeline${DRY ? ' [dry]' : ''} - ${PROFILES.length} profile(s), answer keys against ${BASE}`)
  for (const p of PROFILES) await runProfile(client, p)
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
