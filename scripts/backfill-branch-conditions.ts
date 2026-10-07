/**
 * Give each rule the branch conditions that are ACTUALLY above it, and take away the ones that are not.
 *
 *   npx tsx scripts/backfill-branch-conditions.ts [--doc "Hornsby Local%"] [--clause 4.1C] [--dry] [--no-prune]
 *
 * A clause written as a matrix yields several rules, one per cell, and which cell applies to a lot
 * is decided by branch labels in the clause's own paragraph tree. Extraction read the LEAVES, where
 * the numbers are, and did not carry down the conditions sitting above them. Two failure shapes
 * follow, and this fixes both.
 *
 * UNDER-ASSIGNED - Hornsby LEP cl 4.1C(3):
 *
 *   (3) ... unless the development is on a lot that is at least—
 *       (a) for development in a heritage conservation area—     <- never carried down
 *           (i)  for dual occupancies (attached)—800m2, or
 *           (ii) for dual occupancies (detached)—900m2, or
 *       (b) for other development—                               <- never carried down
 *           (i)  for dual occupancies (attached)—700m2, or
 *           (ii) for dual occupancies (detached)—800m2.
 *
 * Four rules came out with byte-identical scope and four different numbers, so nothing downstream
 * could choose and the page showed all four as "if it applies".
 *
 * OVER-ASSIGNED - Georges River LEP cl 4.1A(2), which is worse because it is wrong rather than
 * merely undecided:
 *
 *   (2) Despite clauses 4.1 and 4.1B, development consent may be granted for the subdivision of land—
 *       (a) in Zone R2, R3 or R4 if— ... at least 300 square metres, or
 *       (b) in the Foreshore Scenic Protection Area if— ... at least 430 square metres.
 *
 * BOTH rules were given BOTH branches' conditions. The 300 rule claimed it needed the foreshore
 * area; the 430 rule claimed it applied in R2 generally. A condition belonging to a sibling branch
 * is not a gap, it is a false statement about the instrument, so it is removed.
 *
 * WHY A BACKFILL AND NOT AN EXTRACTOR FIX. These rules carry src='ai' and point at the CLAUSE, not
 * at the leaf that states the number, so the ancestry link was never recorded and there is nothing
 * in the rule to repair in place. The section tree still holds it, so it is recoverable
 * deterministically, without another model pass.
 *
 * IT GUESSES NOTHING. A branch label it cannot map is reported and skipped. A rule it cannot tie to
 * exactly one leaf is left alone entirely - neither added to nor pruned - because pruning on a guess
 * would delete a true condition.
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
const PRUNE = !argv.includes('--no-prune')
const DOC = flag('--doc') ?? '%'
const CLAUSE = flag('--clause')

interface Cond { dimension: string; value: string; polarity: string }

/**
 * Named land characteristics, each an nsw.scope_layer term so the norms reader resolves it through
 * the `lot.in` fact that already exists rather than a new evaluation path.
 */
const TERMS: { re: RegExp; dimension: string; term: string }[] = [
  { re: /\bin a heritage conservation area\b/i, dimension: 'land_characteristic', term: 'heritage_conservation_area' },
  { re: /\bbush ?fire prone\b/i, dimension: 'land_characteristic', term: 'bushfire' },
  { re: /\bin a (?:flood planning|flood prone)\b/i, dimension: 'land_characteristic', term: 'flood' },
]

const NEG_WORDS = new Set(['not', 'outside', 'excluding', 'except'])
/**
 * Is the term NEGATED where it appears?
 *
 * Hornsby cl 4.1D is why this is mandatory. Its branches are "does not apply to land IN a heritage
 * conservation area unless ... 400/450" and "does not apply to land that is NOT in a heritage
 * conservation area unless ... 350/400". Reading both as "inside one" puts the conservation-area
 * numbers on ordinary land. Only the last THREE words before the term count: "apply to land" is not
 * a negation, "that is not" is. Four was too wide - it reached back into "does not apply".
 */
function negatedBefore(before: string): boolean {
  const w = before.toLowerCase().split(/[^a-z]+/).filter(Boolean).slice(-3)
  return w.some(x => NEG_WORDS.has(x)) || w.join(' ').includes('other than')
}

/** What a branch label means, or null when nothing here reads it. */
function readLabel(t: string): Cond[] | null {
  for (const m of TERMS) {
    const hit = m.re.exec(t)
    if (hit) return [{ dimension: m.dimension, value: m.term, polarity: negatedBefore(t.slice(0, hit.index)) ? 'excludes' : 'applies' }]
  }
  // "in Zone R2 Low Density Residential, Zone R3 ... or Zone R4 ... if—" - alternatives, one dimension
  const zones = [...new Set([...t.matchAll(/\bZone ([A-Z]{1,2}\d{0,2}[A-Z]?)\b/g)].map(m => m[1]!))]
  if (zones.length) return zones.map(z => ({ dimension: 'zone', value: z, polarity: 'applies' }))
  // "in the Foreshore Scenic Protection Area as identified on the ... Map"
  const area = /\bin the ([A-Z][A-Za-z'’ ]*? Area)\b/.exec(t)
  if (area) return [{ dimension: 'area_label', value: area[1]!.trim(), polarity: 'applies' }]
  return null
}

/** The complement branch: "for other development—", "in any other case—", "otherwise—". */
const OTHER = /^(?:for )?(?:all |any )?other(?: development| case| land)?\b|^otherwise\b|^in any other case\b/i

/** A number in the leaf's own words, with its unit so "800m2" and "300 square metres" both read. */
const NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(?:m2|m²|square met|ha\b|hectare|metres\b|m\b)/i

const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()
/** The legislation's em-dash is often mojibake in raw_text; any dash-ish tail marks a branch. */
const INTRODUCES = /[-‐-―−:�]\s*$/
const same = (a: Cond, b: Cond) => a.dimension === b.dimension && a.value === b.value && a.polarity === b.polarity

async function main() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const url = /^DATABASE_URL=(.+)$/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))![1]!.trim()
  const db = new Client({ connectionString: url })
  await db.connect()

  // ── 1. the collisions: same clause, topic and comparator, same scope, different numbers ───────
  const groups = (await db.query(`
    WITH sig AS (
      SELECT r.id, r.document_id, r.clause, r.section_id, e.value::text AS value,
             e.topic, e.comparator,
             coalesce((SELECT string_agg(a.dimension||'='||a.value, '|' ORDER BY a.dimension, a.value)
                         FROM nsw.rule_applicability a
                        WHERE a.rule_id = r.id AND a.polarity = 'applies'), '~none~') AS app
        FROM nsw.rule r
        JOIN nsw.document d ON d.id = r.document_id
        JOIN nsw.rule_effect e ON e.rule_id = r.id
       WHERE e.value IS NOT NULL AND d.title LIKE $1 AND ($2::text IS NULL OR r.clause = $2)
         -- ONE EFFECT PER RULE, or this corrupts data.
         -- Applicability hangs off the RULE, so a rule carrying two numbers cannot be given two
         -- different scopes. Georges River cl 4.1A(2) is ONE rule with both 300 and 430 on it:
         -- pruning for the 300 branch and then for the 430 branch left it with neither branch's
         -- conditions and both branches' numbers. 754 rules are shaped this way. They need
         -- splitting into one rule per effect first, which is its own piece of work.
         AND (SELECT count(*) FROM nsw.rule_effect e2 WHERE e2.rule_id = r.id AND e2.value IS NOT NULL) = 1)
    SELECT document_id, clause,
           json_agg(json_build_object('rule_id', id, 'value', value, 'section_id', section_id)) AS rules
      FROM sig
     GROUP BY document_id, clause, topic, comparator, app
    HAVING count(DISTINCT value) > 1
     ORDER BY clause`, [DOC, CLAUSE ?? null])).rows

  const multi = (await db.query(`
    SELECT count(DISTINCT r.id)::int AS n FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
     WHERE d.title LIKE $1 AND ($2::text IS NULL OR r.clause = $2)
       AND (SELECT count(*) FROM nsw.rule_effect e2 WHERE e2.rule_id = r.id AND e2.value IS NOT NULL) > 1`,
    [DOC, CLAUSE ?? null])).rows[0].n
  console.log(`${groups.length} colliding group(s)${CLAUSE ? ` for clause ${CLAUSE}` : ''}`)
  if (multi) console.log(`${multi} rule(s) skipped: two or more numbers on one rule, so scope cannot be split per number`)
  console.log()
  let added = 0, pruned = 0
  const unmapped = new Map<string, number>()
  const unmatched: string[] = []

  for (const g of groups) {
    const docTitle: string = (await db.query(`SELECT title FROM nsw.document WHERE id = $1`, [g.document_id])).rows[0]?.title ?? '?'
    const shortDoc = docTitle.replace(' Local Environmental Plan', ' LEP')
    const clauseSec = (await db.query(`SELECT local_id FROM nsw.section WHERE id = $1`, [g.rules[0].section_id])).rows[0]
    if (!clauseSec) continue
    const base = String(clauseSec.local_id).replace(/(-ssec\..*|-para.*)$/, '')
    const tree = (await db.query(`
      SELECT id, local_id, raw_text FROM nsw.section
       WHERE document_id = $1 AND (local_id = $2 OR local_id LIKE $2 || '-%') ORDER BY sort_order`,
      [g.document_id, base])).rows
    if (tree.length < 2) continue

    const ancestorsOf = (localId: string) => tree.filter(s => s.local_id !== localId && localId.startsWith(s.local_id + '-'))
    const hasChild = (s: any) => tree.some(x => x.local_id.startsWith(s.local_id + '-'))
    // a branch label introduces children and states no number of its own
    const labels = tree.filter(s => {
      const t = norm(s.raw_text)
      return t.length > 0 && hasChild(s) && !NUMBER.test(t) && INTRODUCES.test(t)
    })
    if (!labels.length) continue

    const parentOf = (localId: string) => ancestorsOf(localId).slice(-1)[0]?.local_id ?? base
    const condOf = (label: any): Cond[] | null => {
      const t = norm(label.raw_text)
      const direct = readLabel(t)
      if (direct) return direct
      if (OTHER.test(t.replace(/^\(?[a-z0-9]+\)?\s*/i, ''))) {
        // the complement of whichever sibling IS mapped, mirrored: "not in X" against its "in X"
        for (const sib of labels) {
          if (sib.local_id === label.local_id || parentOf(sib.local_id) !== parentOf(label.local_id)) continue
          const sc = readLabel(norm(sib.raw_text))
          if (sc) return sc.map(c => ({ ...c, polarity: c.polarity === 'applies' ? 'excludes' : 'applies' }))
        }
      }
      const key = `${shortDoc} ${g.clause}: ${t.slice(0, 95)}`
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1)
      return null
    }

    for (const r of g.rules) {
      const own = (await db.query(
        `SELECT dimension, value, polarity FROM nsw.rule_applicability WHERE rule_id = $1`, [r.rule_id])).rows
      // the qualifier the rule already carries separates two leaves stating the SAME number
      const quals = own.filter((a: any) => a.dimension === 'land_use')
        .map((a: any) => /\(([^)]+)\)/.exec(String(a.value))?.[1]?.toLowerCase()).filter(Boolean) as string[]
      const want = Number(r.value)
      const leaves = tree.filter(s => {
        const t = norm(s.raw_text)
        const m = NUMBER.exec(t)
        if (!m || Number(m[1]!.replace(/,/g, '')) !== want) return false
        return !quals.length || quals.some(q => t.toLowerCase().includes(`(${q})`))
      })
      if (leaves.length !== 1) {
        unmatched.push(`${shortDoc} ${g.clause} value ${r.value}: ${leaves.length} leaves matched`)
        continue
      }

      // ── 2. what IS above this leaf, and what belongs to a sibling branch instead ───────────────
      const ancestorIds = new Set(ancestorsOf(leaves[0]!.local_id).map(a => a.local_id))
      const mine: Cond[] = []
      for (const anc of labels.filter(l => ancestorIds.has(l.local_id))) mine.push(...(condOf(anc) ?? []))
      const theirs: Cond[] = []
      for (const l of labels) {
        if (ancestorIds.has(l.local_id)) continue
        for (const c of condOf(l) ?? []) if (!mine.some(m => same(m, c))) theirs.push(c)
      }

      for (const c of mine) {
        if (own.some((o: any) => same(o as Cond, c))) continue
        console.log(`  + ${shortDoc} ${g.clause} ${String(r.value).padStart(6)}  ${c.dimension}=${c.value} (${c.polarity})`)
        if (!DRY) await db.query(`
          INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span)
          SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM nsw.rule_applicability
             WHERE rule_id = $1 AND dimension = $2 AND value = $3 AND polarity = $4)`,
          [r.rule_id, c.dimension, c.value, c.polarity, norm(leaves[0]!.raw_text).slice(0, 200)])
        added++
      }
      if (!PRUNE) continue
      for (const c of theirs) {
        if (!own.some((o: any) => same(o as Cond, c))) continue
        console.log(`  - ${shortDoc} ${g.clause} ${String(r.value).padStart(6)}  ${c.dimension}=${c.value} (${c.polarity})  belongs to another branch`)
        if (!DRY) await db.query(
          `DELETE FROM nsw.rule_applicability WHERE rule_id = $1 AND dimension = $2 AND value = $3 AND polarity = $4`,
          [r.rule_id, c.dimension, c.value, c.polarity])
        pruned++
      }
    }
  }

  console.log(`\n${DRY ? 'would add' : 'added'} ${added}, ${DRY ? 'would remove' : 'removed'} ${pruned}`)
  if (unmatched.length) {
    console.log(`\n${unmatched.length} rule(s) not tied to one leaf - left untouched:`)
    for (const u of [...new Set(unmatched)].slice(0, 12)) console.log('   ' + u)
  }
  if (unmapped.size) {
    console.log(`\n${unmapped.size} branch label(s) with no mapping - left undecided, by design:`)
    for (const [t, n] of [...unmapped].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   ${n}x  ${t}`)
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
