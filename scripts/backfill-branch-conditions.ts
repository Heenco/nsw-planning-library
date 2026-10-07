/**
 * Inherit a clause's BRANCH CONDITIONS onto the rules beneath them.
 *
 *   npx tsx scripts/backfill-branch-conditions.ts [--doc "Hornsby Local%"] [--clause 4.1C] [--dry]
 *
 * THE BUG THIS FIXES. A clause like Hornsby LEP 2013 cl 4.1C(3) is a matrix, not a list:
 *
 *   (3) ... unless the development is on a lot that is at least—
 *       (a) for development in a heritage conservation area—      <- the condition
 *           (i)  for dual occupancies (attached)—800m2, or        <- the number
 *           (ii) for dual occupancies (detached)—900m2, or
 *       (b) for other development—                                <- the condition
 *           (i)  for dual occupancies (attached)—700m2, or
 *           (ii) for dual occupancies (detached)—800m2.
 *
 * Exactly one cell applies to any lot. Extraction read the LEAVES and kept what each leaf's own
 * words said - attached vs detached - but never inherited the condition sitting on its PARENT. The
 * four rules came out with byte-identical applicability and four different numbers, so nothing
 * downstream could choose between them and the page showed all four as "if it applies".
 *
 * WHAT THIS DOES. For every clause whose numeric rules collide - same clause, topic and comparator,
 * identical applicability, different values - it re-reads the clause's own section tree, matches
 * each rule to the leaf paragraph that states its number, walks up to collect the branch labels
 * above it, and writes the missing nsw.rule_applicability rows.
 *
 * WHY A BACKFILL AND NOT AN EXTRACTOR FIX. These rules carry src='ai' and all four point at
 * `sec.4.1C`, the clause - not at the leaf that states the number - so the ancestry link was never
 * recorded and there is nothing in the rule to repair in place. The section tree still holds it, so
 * the condition is recoverable deterministically, without another model pass.
 *
 * IT GUESSES NOTHING. A branch label it cannot map is reported and skipped, never approximated. The
 * only inference it makes is the complement one: where a sibling set has a mapped branch and an
 * "other"/"otherwise" branch, the other branch gets that same condition with polarity 'excludes'.
 * That is what "for other development" means when it sits beside "for development in X".
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const DRY = argv.includes('--dry')
const DOC = flag('--doc') ?? '%'
const CLAUSE = flag('--clause')

/**
 * Branch labels we can read, and the condition each one means.
 *
 * Deliberately small and explicit. A label that matches nothing here is reported as unmapped, which
 * is the honest outcome: a wrong condition is worse than a missing one, because a missing one still
 * shows as "if it applies" while a wrong one quietly answers.
 *
 * `term` is an nsw.scope_layer term, so the norms reader can resolve it against the lot through the
 * `lot.in` fact that already exists - no new evaluation path.
 */
const BRANCH_TERMS: { re: RegExp; dimension: string; term: string }[] = [
  { re: /\bin a heritage conservation area\b/i, dimension: 'land_characteristic', term: 'heritage_conservation_area' },
  { re: /\bis a heritage item\b|\bfor a heritage item\b/i, dimension: 'land_characteristic', term: 'heritage' },
  { re: /\bin a (?:foreshore|scenic protection) area\b/i, dimension: 'land_characteristic', term: 'foreshore' },
  { re: /\bon land in (?:a|the) flood (?:planning|prone)\b/i, dimension: 'land_characteristic', term: 'flood' },
  { re: /\bbush ?fire prone\b/i, dimension: 'land_characteristic', term: 'bushfire' },
]

/** The complement branch: "for other development—", "in any other case—", "otherwise—". */
const OTHER = /^(?:for )?(?:all |any )?other(?: development| case| land)?\b|^otherwise\b|^in any other case\b/i

/** A number in the leaf's own words. Carries the unit so "800m2" and "800 m²" both read. */
const NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(?:m2|m²|square met|ha\b|hectare|m\b)/i

const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()
/** The em-dash the legislation uses is often mojibake in raw_text; treat any dash-ish tail as the branch marker. */
const INTRODUCES = /[-‐-―−:�]\s*$/

async function main() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8')
  const url = /^DATABASE_URL=(.+)$/m.exec(env)![1]!.trim()
  const db = new Client({ connectionString: url })
  await db.connect()

  // ── 1. the collisions: same clause, topic and comparator, same scope, different numbers ────────
  const groups = (await db.query(`
    WITH sig AS (
      SELECT r.id, r.document_id, r.clause, r.section_id, e.id AS effect_id,
             e.topic, e.comparator, e.value::text AS value, e.unit,
             coalesce((SELECT string_agg(a.dimension||'='||a.value, '|' ORDER BY a.dimension, a.value)
                         FROM nsw.rule_applicability a
                        WHERE a.rule_id = r.id AND a.polarity = 'applies'), '~none~') AS app
        FROM nsw.rule r
        JOIN nsw.document d ON d.id = r.document_id
        JOIN nsw.rule_effect e ON e.rule_id = r.id
       WHERE e.value IS NOT NULL AND d.title LIKE $1 AND ($2::text IS NULL OR r.clause = $2))
    SELECT document_id, clause, topic, comparator, app,
           json_agg(json_build_object('rule_id', id, 'value', value, 'section_id', section_id)) AS rules
      FROM sig
     GROUP BY document_id, clause, topic, comparator, app
    HAVING count(DISTINCT value) > 1
     ORDER BY clause`, [DOC, CLAUSE ?? null])).rows

  console.log(`${groups.length} colliding group(s)${CLAUSE ? ` for clause ${CLAUSE}` : ''}${DOC !== '%' ? ` in ${DOC}` : ''}\n`)

  let written = 0
  const unmapped = new Map<string, number>()
  const unmatched: string[] = []

  for (const g of groups) {
    // ── 2. the clause's own section tree ────────────────────────────────────────────────────────
    const clauseSec = (await db.query(
      `SELECT local_id FROM nsw.section WHERE id = $1`, [g.rules[0].section_id])).rows[0]
    if (!clauseSec) continue
    const base = String(clauseSec.local_id).replace(/(-ssec\..*|-para.*)$/, '')
    const tree = (await db.query(`
      SELECT id, local_id, raw_text FROM nsw.section
       WHERE document_id = $1 AND (local_id = $2 OR local_id LIKE $2 || '-%')
       ORDER BY sort_order`, [g.document_id, base])).rows
    if (tree.length < 2) continue

    // a section's ancestors, by the local_id path the ingest builds ("...-para1.a-para2.i")
    const ancestorsOf = (localId: string) =>
      tree.filter(s => s.local_id !== localId && localId.startsWith(s.local_id + '-'))

    // ── 3. branch labels: a node that introduces children and states no number of its own ───────
    const hasChild = (s: any) => tree.some(x => x.local_id.startsWith(s.local_id + '-'))
    const labels = tree.filter(s => {
      const t = norm(s.raw_text)
      return t.length > 0 && hasChild(s) && !NUMBER.test(t) && INTRODUCES.test(t)
    })
    if (!labels.length) continue

    /** A label to its condition, or null. Siblings are needed for the "other" complement. */
    const condOf = (label: any): { dimension: string; value: string; polarity: string } | null => {
      const t = norm(label.raw_text)
      for (const m of BRANCH_TERMS) if (m.re.test(t)) return { dimension: m.dimension, value: m.term, polarity: 'applies' }
      if (OTHER.test(t.replace(/^\(?[a-z0-9]+\)?\s*/i, ''))) {
        // the complement of whichever sibling IS mapped
        const parent = ancestorsOf(label.local_id).slice(-1)[0]?.local_id ?? base
        for (const sib of labels) {
          if (sib.local_id === label.local_id) continue
          if (!sib.local_id.startsWith(parent + '-')) continue
          const st = norm(sib.raw_text)
          for (const m of BRANCH_TERMS) if (m.re.test(st)) return { dimension: m.dimension, value: m.term, polarity: 'excludes' }
        }
      }
      const key = t.slice(0, 90)
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1)
      return null
    }

    // ── 4. match each rule to the leaf that states its number ───────────────────────────────────
    for (const r of g.rules) {
      const own = (await db.query(
        `SELECT dimension, value FROM nsw.rule_applicability WHERE rule_id = $1 AND polarity = 'applies'`,
        [r.rule_id])).rows
      // the qualifier the rule already carries - "(attached)" / "(detached)" - is what separates two
      // leaves that state the SAME number under different branches
      const quals = own.filter(a => a.dimension === 'land_use')
        .map(a => /\(([^)]+)\)/.exec(String(a.value))?.[1]?.toLowerCase()).filter(Boolean) as string[]
      const want = Number(r.value)

      const leaves = tree.filter(s => {
        const t = norm(s.raw_text)
        const m = NUMBER.exec(t)
        if (!m || Number(m[1]!.replace(/,/g, '')) !== want) return false
        return !quals.length || quals.some(q => t.toLowerCase().includes(`(${q})`))
      })
      if (leaves.length !== 1) {
        unmatched.push(`${g.clause} value ${r.value}${quals.length ? ` (${quals.join('/')})` : ''}: ${leaves.length} leaves matched`)
        continue
      }

      // ── 5. inherit every branch label above that leaf ─────────────────────────────────────────
      for (const anc of ancestorsOf(leaves[0]!.local_id)) {
        if (!labels.some(l => l.local_id === anc.local_id)) continue
        const cond = condOf(anc)
        if (!cond) continue
        const span = norm(anc.raw_text).slice(0, 200)
        console.log(`  ${g.clause} ${String(r.value).padStart(5)}${g.unit ?? ''}  ->  ${cond.dimension}=${cond.value} (${cond.polarity})`)
        console.log(`        from ${anc.local_id}: "${span}"`)
        if (!DRY) {
          await db.query(`
            INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span)
            SELECT $1, $2, $3, $4, $5
             WHERE NOT EXISTS (SELECT 1 FROM nsw.rule_applicability
                                WHERE rule_id = $1 AND dimension = $2 AND value = $3 AND polarity = $4)`,
            [r.rule_id, cond.dimension, cond.value, cond.polarity, span])
        }
        written++
      }
    }
  }

  console.log(`\n${DRY ? 'would write' : 'wrote'} ${written} applicability row(s)`)
  if (unmatched.length) {
    console.log(`\n${unmatched.length} rule(s) could not be tied to one leaf:`)
    for (const u of unmatched.slice(0, 15)) console.log('   ' + u)
  }
  if (unmapped.size) {
    console.log(`\n${unmapped.size} branch label(s) with no mapping - these stay undecided, by design:`)
    for (const [t, n] of [...unmapped].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   ${n}x  "${t}"`)
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
