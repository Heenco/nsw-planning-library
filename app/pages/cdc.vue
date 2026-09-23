<!--
  /cdc - the complying development prerequisites of the Codes SEPP, clause by clause.

  Ordered the way the instrument is, not the way our columns are. That ordering is the point: read down
  the page and you are reading 1.17A, then 1.18, then 1.19, then 1.19A, then Schedule 5, with our test
  beside each one and a blank where we have none. A list organised around our data would have hidden
  every gap, because a gap is a row we never wrote.

  The clause numbers and the wording come from sheet 1 of the Department workbook; what we test comes
  from "07 - CDC rules". Both are read by scratchpad/gen_cdc.py into shared/cdc-criteria.ts, joined on a
  hand-written map, so no citation here is a guess.
-->

<template>
  <div class="cd">
    <header class="cd-head">
      <div>
        <NuxtLink to="/" class="cd-back">&larr; Home</NuxtLink>
        <h1 class="cd-title">Complying development — the prerequisites, clause by clause</h1>
        <p class="cd-sub">
          Every complying development certificate has to clear these before anything specific to the
          development is considered. This is the list as the Codes SEPP states it, with our test beside
          each clause, and nothing beside the ones we do not test.
        </p>
      </div>
      <div class="cd-stats">
        <span><b>{{ requirements.length }}</b> prerequisites</span>
        <span><b>{{ types.length }}</b> codes on top</span>
        <span><b>{{ untraced.length }}</b> tests with no clause</span>
      </div>
    </header>

    <section class="cd-sec">
      <p class="cd-note">
        The clause numbers and wording come from the Department's compilation. Both halves of this page
        have since been read against the instruments themselves —
        <NuxtLink :to="CDC_INSTRUMENT_DOC">the consolidated Codes SEPP</NuxtLink> in the doc viewer, and
        the Housing SEPP — because the compilation turned out to omit whole subclauses. Two layers
        of correction sit on top of it and each keeps its own colour:
        <b class="cd-add-ink">violet is the general prerequisites</b>, below, and
        <b class="cd-code-ink">blue is the code for the development</b>, further down. Audited
        {{ CDC_AUDITED_ON }} and {{ CDC_TYPES_AUDITED_ON }}.
      </p>
    </section>

    <!-- ── the instrument, in order ──────────────────────────────────────── -->
    <section v-for="part in parts" :key="part.name" class="cd-sec">
      <h2 class="cd-h2">{{ part.name }} <span class="cd-h2-sub">{{ part.lead }}</span></h2>
      <div class="cd-scroll">
        <table class="cd-table">
          <thead>
            <tr>
              <th class="cd-th-clause">Clause</th>
              <th>What the instrument says</th>
              <th>What we read</th>
              <th class="cd-th-src">Source the workbook gives</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in part.rows" :key="r.clause">
              <tr :class="{ 'cd-tr-parent': r.isParent, 'cd-tr-add': r.added }">
                <td class="cd-clause">
                  <a :href="clauseLink(r.clause)" target="_blank" rel="noopener">{{ r.clause }}</a>
                  <span v-if="r.added" class="cd-tag">added from the instrument</span>
                  <span v-else-if="r.fix" class="cd-tag cd-tag--fix">
                    the instrument calls this<b>{{ r.fix.right }}</b>
                  </span>
                </td>
                <td class="cd-text">
                  {{ r.text }}
                  <span v-if="r.added" class="cd-why">{{ r.why }}</span>
                  <span v-else-if="r.fix" class="cd-why">{{ r.fix.why }}</span>
                </td>
                <td class="cd-src">
                  <code v-for="s in r.services || []" :key="s || 'x'">{{ s }}</code>
                  <span v-if="r.added" class="cd-dim">not in the workbook</span>
                </td>
                <td class="cd-src">
                  <template v-if="!r.added">
                    <a
                      v-for="d in r.sources" :key="d.url" class="cd-link"
                      :href="d.url" :title="d.url" target="_blank" rel="noopener"
                    >{{ d.label }}<i>{{ d.host }}</i></a>
                    <span v-if="r.sourceNote" class="cd-dim cd-avail">{{ r.sourceNote }}</span>
                    <span v-if="!r.sources.length && !r.sourceNote" class="cd-dim">—</span>
                  </template>
                  <NuxtLink v-else class="cd-link cd-link--add" :to="CDC_INSTRUMENT_DOC">
                    Codes SEPP<i>read from the instrument</i>
                  </NuxtLink>
                </td>
              </tr>
              <tr v-if="r.divergence" class="cd-tr-note">
                <td />
                <td colspan="4" class="cd-diverge">{{ r.divergence }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── each certificate type, on top of everything above ─────────────── -->
    <section class="cd-sec">
      <h2 class="cd-h2">
        Then the code for the development itself
        <span class="cd-h2-sub">{{ types.length }} codes · {{ typeReqCount }} requirements</span>
      </h2>
      <p class="cd-lead">
        Everything above has to be clear before any of this is reached. Each code then adds its own
        requirements, and this is where the zone, the lot size and the frontage are decided. Sheets 2 to
        13 of the workbook, one per code — and then
        <b class="cd-code-ink">everything in blue, which the workbook does not contain</b>: the
        paragraphs its sheets never transcribed, the citations that do not match the instrument, and,
        where our own rule does something the clause does not, a note saying so.
      </p>

      <div class="cd-tabs">
        <button
          v-for="t in types" :key="t.key" class="cd-tab"
          :class="{ 'cd-tab--on': t.key === typeKey }" @click="typeKey = t.key"
        >
          <span class="cd-tab-name">{{ t.name }}</span>
          <span class="cd-tab-n">{{ tabCount(t) }}</span>
        </button>
      </div>

      <div v-if="type" class="cd-type">
        <div class="cd-type-head">
          <div>
            <h3 class="cd-type-title">{{ type.name }}</h3>
            <p class="cd-type-code">{{ type.code }} · workbook sheet “{{ type.sheet }}”</p>
          </div>
          <p v-if="type.inheritsGeneral" class="cd-inherit">
            + all {{ requirements.length }} prerequisites above
          </p>
        </div>

        <p v-if="type.note" class="cd-type-note">{{ type.note }}</p>

        <p v-if="divergences.length" class="cd-type-diverge">
          <b>{{ divergences.length }}</b>
          {{ divergences.length === 1 ? 'row on this tab is' : 'rows on this tab are' }}
          a rule of ours that the clause does not support, marked below. Those are notebook bugs, not
          page bugs — the clause beside them is cited correctly and our test is what disagrees.
        </p>

        <div v-if="type.tests.length" class="cd-tests">
          <div v-for="te in type.tests" :key="te.key" class="cd-test">
            <span v-if="type.tests.length > 1" class="cd-test-name">{{ variant(te.key) }}</span>
            <span v-else class="cd-test-name">We require</span>
            <span v-for="c in te.checks" :key="c.column" class="cd-pill">{{ c.says }}</span>
          </div>
        </div>
        <p v-else class="cd-type-note cd-type-note--red">We run no test for this one.</p>

        <div class="cd-scroll">
          <table class="cd-table">
            <thead>
              <tr>
                <th class="cd-th-clause">Clause</th>
                <th>What the code says</th>
                <th>What we require</th>
                <th class="cd-th-src">Source the workbook gives</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in typeRows" :key="r.clause">
                <tr :class="{ 'cd-tr-parent': r.isParent, 'cd-tr-code': r.added }">
                  <td class="cd-clause">
                    <a v-if="r.href" :href="r.href" target="_blank" rel="noopener">{{ r.clause }}</a>
                    <span v-else>{{ r.clause }}</span>
                    <span v-if="r.added" class="cd-tag cd-tag--code">not in the workbook</span>
                    <span v-else-if="r.fix" class="cd-tag cd-tag--codefix">
                      the instrument calls this<b>{{ r.fix.right }}</b>
                    </span>
                  </td>
                  <td class="cd-text">
                    {{ r.text }}
                    <span v-if="r.subItems.length" class="cd-subs">{{ r.subItems.join(' ') }}</span>
                    <span v-if="r.note" class="cd-rownote">{{ r.note }}</span>
                    <span v-if="r.added" class="cd-why cd-why--code">{{ r.why }}</span>
                    <span v-else-if="r.fix" class="cd-why cd-why--code">{{ r.fix.why }}</span>
                  </td>
                  <td class="cd-src">
                    <span v-for="b in r.testedBy" :key="b.type + b.column" class="cd-says">
                      {{ b.says }}
                      <i v-if="type.tests.length > 1">{{ variant(b.type) }}</i>
                    </span>
                    <span v-if="r.added" class="cd-dim">not tested</span>
                  </td>
                  <td class="cd-src">
                    <a
                      v-for="d in r.sources" :key="d.url" class="cd-link"
                      :class="{ 'cd-link--code': r.added }"
                      :href="d.url" :title="d.url" target="_blank" rel="noopener"
                    >{{ d.label }}<i>{{ d.host }}</i></a>
                    <span v-if="r.sourceNote" class="cd-dim cd-avail">{{ r.sourceNote }}</span>
                    <span v-if="!r.sources.length && !r.sourceNote" class="cd-dim">—</span>
                  </td>
                </tr>
                <tr v-for="n in r.notes" :key="r.clause + n.kind" class="cd-tr-note">
                  <td />
                  <td colspan="3" :class="n.kind === 'diverge' ? 'cd-diverge' : 'cd-restate'">
                    <b>{{ n.kind === 'diverge' ? 'Our rule' : 'The workbook’s wording' }}</b>
                    {{ n.what }}
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- codes the instrument names that we have no entry for -->
    <section class="cd-sec">
      <h2 class="cd-h2 cd-add-ink">
        Codes the instrument names that are not above
        <span class="cd-h2-sub">{{ missingCodes.length }} of the 15 in clause 1.5(1)</span>
      </h2>
      <p class="cd-lead">
        Clause 1.5(1) defines fifteen complying development codes. The tabs above cover six of them.
        These are the rest, and the prerequisites above still gate them. The Pattern Book Development
        Code has since been read from the instrument — its requirements are on
        <NuxtLink to="/pattern-book">the Pattern Book page</NuxtLink>, beside the designs they gate.
      </p>
      <div class="cd-scroll">
        <table class="cd-table cd-table--add">
          <thead>
            <tr><th class="cd-th-clause">Part</th><th>Code</th><th>What it matters for</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in missingCodes" :key="c.part">
              <td class="cd-clause">
                <a :href="CDC_SEPP_URL" target="_blank" rel="noopener">{{ c.part }}</a>
              </td>
              <td class="cd-text">{{ c.name }}</td>
              <td class="cd-text">
                <span v-if="c.note">{{ c.note }}</span>
                <span v-else class="cd-dim">—</span>
                <NuxtLink v-if="c.page" class="cd-link cd-link--code" :to="c.page">
                  read from the instrument<i>on the Pattern Book page</i>
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── our checks with no clause behind them ─────────────────────────── -->
    <section class="cd-sec">
      <h2 class="cd-h2">
        Tests we run that this list does not account for
        <span class="cd-h2-sub">{{ untraced.length }}</span>
      </h2>
      <p class="cd-lead">
        These are conditions in our notebook with no matching prerequisite in the workbook, and none of
        them appear in the codes above either. Until each is traced to a clause, it is excluding land on
        our authority rather than the instrument's.
      </p>
      <div class="cd-scroll">
        <table class="cd-table">
          <thead>
            <tr><th>Our test</th><th>What we read</th><th>Column</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in untraced" :key="u.column">
              <td class="cd-text">{{ u.land }}</td>
              <td class="cd-src"><code v-if="u.service">{{ u.service }}</code><span v-else class="cd-dim">—</span></td>
              <td class="cd-src"><code>{{ u.column }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="traced.length">
        <h3 class="cd-h3">Since traced to a clause</h3>
        <ul class="cd-traced">
          <li v-for="t in traced" :key="t.check.column">
            <code>{{ t.check.column }}</code>
            <b>{{ t.fix.clause }}</b>
            <span>{{ t.fix.why }}</span>
          </li>
        </ul>
      </template>
    </section>

    <!-- ── why this page and the map count differently ───────────────────── -->
    <section v-if="cat" class="cd-sec">
      <h2 class="cd-h2">
        Why the map shows more than this page
        <span class="cd-h2-sub">{{ requirements.length }} clauses here · {{ cat.live }} layers there</span>
      </h2>
      <p class="cd-lead">
        <NuxtLink to="/cdc-map">The map</NuxtLink> counts <b>datasets</b>; this page counts
        <b>clauses</b>. They are not the same unit and the two sets only partly overlap. One clause can
        need several datasets — clause 1.17A(1)(e)(f), land within 100 metres of a wetland, a rainforest
        or a marine park, takes four on its own — so the {{ cat.general.length }} layers that answer a
        prerequisite cover only {{ cat.clauseCount }} distinct clauses. Meanwhile
        {{ cat.other.length }} of the map's layers answer no prerequisite at all, and
        {{ requirements.length - testedCount }} of the clauses here have no layer, so they appear above
        and nowhere on the map.
      </p>

      <div class="cd-scroll">
        <table class="cd-table">
          <thead>
            <tr>
              <th>What backs the layer</th>
              <th class="cd-th-n">Layers</th>
              <th>Is it one of the {{ requirements.length }}?</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in cat.summary" :key="s.key">
              <td class="cd-text">{{ s.title }}</td>
              <td class="cd-n">{{ s.n }}</td>
              <td class="cd-dim">{{ s.counts }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="cd-h3">The {{ cat.general.length }} layers that answer a prerequisite</h3>
      <div class="cd-scroll">
        <table class="cd-table">
          <thead>
            <tr><th class="cd-th-clause">Clause</th><th>Layers that answer it</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in cat.byClause" :key="c.clause">
              <td class="cd-clause">
                <a :href="clauseLink(c.clause)" target="_blank" rel="noopener">{{ c.clause }}</a>
                <span v-if="c.titles.length > 1" class="cd-tag">{{ c.titles.length }} layers</span>
              </td>
              <td class="cd-text">{{ c.titles.join(' · ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="cd-h3">The {{ cat.other.length }} that do not</h3>
      <div class="cd-scroll">
        <table class="cd-table">
          <thead>
            <tr><th>Why it is on the map</th><th class="cd-th-n">Layers</th><th>Which</th></tr>
          </thead>
          <tbody>
            <tr v-for="g in cat.otherGroups" :key="g.key">
              <td class="cd-text">{{ g.title }}<span class="cd-why">{{ g.lead }}</span></td>
              <td class="cd-n">{{ g.titles.length }}</td>
              <td class="cd-text">{{ g.titles.join(' · ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="cat.noData" class="cd-lead cd-lead--after">
        {{ cat.total }} layers are catalogued and {{ cat.noData }} of them hold no dataset anywhere, so
        the map draws {{ cat.live }}. A gap kept in the catalogue is still worth saying out loud.
      </p>
    </section>

    <section class="cd-sec">
      <h2 class="cd-h2">What to watch</h2>
      <ul class="cd-watch">
        <li>
          <b>The environmentally sensitive area test is only partly built.</b> Clause 1.17A(1)(e) defines
          it in ten paragraphs and we test five of them. Coastal waters, coastal lakes, aquatic reserves
          and marine parks, the 100 metre buffer, and critical habitat are all missing. The
          <NuxtLink to="/esa">environmentally sensitive areas page</NuxtLink> holds most of that data now,
          so the gap is in the rule rather than in what we have.
        </li>
        <li>
          <b>Bush fire is tested far more widely than the clause asks.</b> 1.19A(1)(a) excludes land at
          BAL-40 or in the flame zone. We exclude any bush fire prone land, so properties are being ruled
          out that the clause would allow.
        </li>
        <li>
          <b>Flood and landslide have no clause in this list.</b> Our notebook cites 1.19(1) for both, and
          1.19(1) has no flood or landslide paragraph. They belong to a specific code, so the citation in
          the notebook is wrong even though the check may be right.
        </li>
        <li>
          <b class="cd-code-ink">A minimum lot size is usually the LEP's, not the code's.</b> The inland
          and rural codes reach their own figure only where the LEP is silent
          (<a :href="typeClauseLink('3D.10')" target="_blank" rel="noopener">3D.10(1)(a)</a>,
          <a :href="typeClauseLink('3D.29')" target="_blank" rel="noopener">3D.29(1)(a)</a>,
          <a :href="typeClauseLink('3A.2')" target="_blank" rel="noopener">3A.2(2)</a>), and for terraces and
          manor houses it is the greater of the two. We test the code's figure as a floor on all of them,
          so a lot can pass here and fail the clause. This is the one finding that produces wrong
          <i>yes</i> answers rather than wrong <i>no</i> answers.
        </li>
        <li>
          <b class="cd-code-ink">Secondary dwellings are being allowed in Zone R5.</b> Housing SEPP
          clause 54(1)(a) is “land in a residential zone other than Zone R5 Large Lot
          Residential”. The sheet quotes the dictionary, where a residential zone does include R5,
          and our rule follows the sheet.
        </li>
        <li>
          <b class="cd-code-ink">Agritourism and farm stay are missing a test we already run.</b> Clause
          9.3A rules out landslide risk land for the whole of Part 9. We run the
          <code>landsliderisk</code> column for five other types and not for these two.
        </li>
      </ul>
    </section>

    <section class="cd-sec cd-sec--foot">
      <p class="cd-foot">
        Clauses and wording from the Department workbook <code>CDC Rules - Part 3, 9 &amp; HSEPP</code>,
        tests from <code>07 - CDC rules</code>, generated {{ CDC_GENERATED_ON }}. The same prerequisites
        gate all 22 designs on <NuxtLink to="/pattern-book">the Pattern Book page</NuxtLink>.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CDC_GENERATED_ON, CDC_REQUIREMENTS, CDC_SEPP_URL, CDC_TYPES, CDC_UNMAPPED,
} from '#shared/cdc-criteria'
import {
  CDC_ADDED, CDC_AUDITED_ON, CDC_CLAUSE_FIXES, CDC_INSTRUMENT_DOC, CDC_MISSING_CODES, CDC_TRACED,
} from '#shared/cdc-corrections'
import {
  CDC_TYPES_AUDITED_ON, CDC_TYPE_ADDED, CDC_TYPE_FIXES, CDC_TYPE_NOTES, CDC_TYPE_PARENTS,
  typeClauseLink,
} from '#shared/cdc-type-corrections'

useHead({ title: 'Complying development prerequisites · Planning Library' })

const requirements = CDC_REQUIREMENTS

/**
 * A check the workbook gives no clause for is not the same as a check with no clause: some have since
 * been traced to one in the instrument. CDC_UNMAPPED is generated and stays as it is; the count and the
 * table read from CDC_TRACED, so tracing one is an edit to the corrections file and nothing else.
 */
const TRACED_BY = new Map(CDC_TRACED.map(t => [t.column, t]))
const untraced = computed(() => CDC_UNMAPPED.filter(u => !TRACED_BY.has(u.column)))
const traced = computed(() => CDC_UNMAPPED
  .filter(u => TRACED_BY.has(u.column))
  .map(u => ({ check: u, fix: TRACED_BY.get(u.column)! })))

const testedCount = computed(() => requirements.filter(r => r.tested).length)

/**
 * The one thing on this page that is read live rather than generated.
 *
 * "39 prerequisites here, 66 layers on the map" is the first question anyone asks after seeing both
 * pages, and the answer is that the two count different units: clauses against datasets. Baking the
 * layer numbers into the generated file would put them out of date the next time a layer is added, so
 * this section reads cdc.layers through /api/cdc/layers - the same catalogue the map draws from, with
 * `scope` already worked out by scopeOf() server-side so the two pages cannot classify a layer
 * differently. If the request fails the section simply does not render; nothing else on the page
 * depends on it.
 */
const { data: catalogue } = await useFetch('/api/cdc/layers', { key: 'cdc-layers-reconcile' })

/** How the map's layers stand against this page's clauses. */
const OTHER_GROUPS: { key: string; title: string; lead: string }[] = [
  { key: 'code', title: 'A requirement of one code', lead: 'Part 3, 3B, 3C, 3D or Part 9 - in the codes below, not in the prerequisites above.' },
  { key: 'midrise', title: 'The mid-rise gate', lead: 'Clause 182 of the Housing SEPP, which stands in front of the Pattern Book designs.' },
  { key: 'context', title: 'Context, not a test', lead: 'Facts about the lot. Every lot has a zone; being in one disqualifies nothing.' },
  { key: 'unmapped', title: 'Nothing at all', lead: 'The checks listed above as running on our authority rather than the instrument\'s.' },
]

const cat = computed(() => {
  const rows = (catalogue.value as any)?.layers as any[] | undefined
  if (!rows?.length) return null

  const general = rows.filter(r => r.scope === 'general' || r.scope === 'condition')
  const other = rows.filter(r => !['general', 'condition'].includes(r.scope))

  /*
   * A layer can answer more than one clause, and a clause more than one layer. Only the general
   * prerequisites belong in this table: two of these layers also cite a code or the mid-rise gate -
   * unsewered land is 1.19(1)(j) AND 3B.2(i), heritage conservation areas is 1.19(1)(a) AND 182(d) -
   * and listing those citations here would put a code requirement among the prerequisites.
   */
  const isPrerequisite = (c: string) => /^(1\.1[789]|Schedule)/.test(c)
  const byClause = new Map<string, string[]>()
  for (const r of general) {
    for (const c of ((r.clauses ?? []) as string[]).filter(isPrerequisite)) {
      if (!byClause.has(c)) byClause.set(c, [])
      byClause.get(c)!.push(r.title)
    }
  }

  const summary = [
    { key: 'general', title: 'A general prerequisite of the Codes SEPP', counts: 'Yes' },
    { key: 'condition', title: 'A condition rather than an exclusion', counts: 'Yes — an approval to obtain' },
    ...OTHER_GROUPS.map(g => ({ key: g.key, title: g.title, counts: 'No' })),
  ].map(s => ({ ...s, n: rows.filter(r => r.scope === s.key).length })).filter(s => s.n > 0)

  return {
    total: rows.length,
    live: rows.filter(r => Number(r.features) > 0).length,
    noData: rows.filter(r => !Number(r.features)).length,
    general,
    other,
    clauseCount: byClause.size,
    byClause: [...byClause.entries()]
      .map(([clause, titles]) => ({ clause, titles: [...new Set(titles)].sort() }))
      .sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true })),
    otherGroups: OTHER_GROUPS
      .map(g => ({ ...g, titles: other.filter(r => r.scope === g.key).map(r => r.title).sort() }))
      .filter(g => g.titles.length),
    summary,
  }
})

/** The instrument's own divisions, in its own order. 1.19A before 1.19 so the prefix test is not fooled. */
const PARTS: { name: string; lead: string; test: (clause: string) => boolean }[] = [
  {
    name: 'Clause 1.17A',
    lead: 'applies to complying development under any environmental planning instrument',
    test: c => c.startsWith('1.17A'),
  },
  {
    name: 'Clause 1.18',
    lead: 'applies to complying development under this Policy',
    test: c => c.startsWith('1.18'),
  },
  {
    name: 'Clause 1.19A',
    lead: 'bush fire prone land, for every code except Housing Alterations',
    test: c => c.startsWith('1.19A'),
  },
  {
    name: 'Clause 1.19',
    lead: 'the Housing, Inland, Low Rise Housing Diversity and Pattern Book codes',
    test: c => c.startsWith('1.19') && !c.startsWith('1.19A'),
  },
  {
    name: 'Schedule 5',
    lead: 'land each council has excluded by map',
    test: c => c.startsWith('Schedule'),
  },
]

/**
 * The workbook's rows with the instrument's missing ones woven back in.
 *
 * Order comes from each added row's `after`, not from sorting the clause strings: 1.18(1)(c1) sits
 * between (c) and (c2) in the instrument but between (c) and (c3) alphabetically, so a sort would be
 * wrong in a way that is hard to see. An explicit predecessor cannot drift.
 */
const merged = computed(() => {
  const out: any[] = []
  const pending = [...CDC_ADDED]
  const take = (after: string | null) => {
    for (let i = pending.findIndex(a => a.after === after); i !== -1;
      i = pending.findIndex(a => a.after === after)) {
      const a = pending.splice(i, 1)[0]!
      out.push({ ...a, added: true, isParent: false })
      take(a.clause)
    }
  }
  take(null)
  for (const r of requirements) {
    out.push({ ...r, added: false, fix: CDC_CLAUSE_FIXES.find(f => f.wrong === r.clause) })
    take(r.clause)
  }
  // nothing is dropped silently if an `after` ever stops matching a real clause
  for (const a of pending) out.push({ ...a, added: true, isParent: false })
  return out
})

const parts = computed(() =>
  PARTS.map(p => ({ ...p, rows: merged.value.filter(r => p.test(r.clause)) }))
    .filter(p => p.rows.length))

/**
 * The workbook's twelve sheets. Part 3BA, the thirteenth code, is not here: it is the Pattern Book
 * Development Code, so its requirements sit on /pattern-book beside the designs they gate.
 */
const types = CDC_TYPES

const typeKey = ref(types[0]?.key ?? '')
const type = computed(() => types.find(t => t.key === typeKey.value))

const PARENT_KEYS = new Set(CDC_TYPE_PARENTS.map(p => `${p.type}|${p.clause}`))

/**
 * One code's rows, with the instrument's missing ones woven back in.
 *
 * Same shape as `merged` above and for the same reason: an added row names the clause it follows rather
 * than being sorted into place, because sorting clause strings puts 3B.8(1A) after 3B.8(2) and 3D.4(j)
 * before 3D.4(e). A wrong order here reads as though the instrument were wrong.
 */
const typeRows = computed(() => {
  const t = type.value
  if (!t) return []
  const added = CDC_TYPE_ADDED.filter(a => a.type === t.key)
  const out: any[] = []
  const pending = [...added]
  const take = (after: string | null) => {
    for (let i = pending.findIndex(a => a.after === after); i !== -1;
      i = pending.findIndex(a => a.after === after)) {
      const a = pending.splice(i, 1)[0]!
      out.push({
        ...a,
        added: true,
        isParent: false,
        subItems: [],
        testedBy: [],
        notes: [],
        sources: [{
          url: typeClauseLink(a.clause, a.instrument),
          label: a.instrument === 'housing' ? 'Housing SEPP' : 'Codes SEPP',
          host: 'read from the instrument',
        }],
        sourceNote: null,
        note: null,
        href: typeClauseLink(a.clause, a.instrument),
      })
      take(a.clause)
    }
  }
  take(null)
  for (const r of t.requirements) {
    out.push({
      ...r,
      added: false,
      isParent: PARENT_KEYS.has(`${t.key}|${r.clause}`),
      fix: CDC_TYPE_FIXES.find(f => f.type === t.key && f.wrong === r.clause),
      notes: CDC_TYPE_NOTES.filter(n => n.type === t.key && n.clause === r.clause),
    })
    take(r.clause)
  }
  // nothing is dropped silently if an `after` ever stops matching a real clause
  for (const a of pending) out.push({ ...a, added: true, isParent: false, subItems: [], testedBy: [], notes: [] })
  return out
})

/** What the tab actually shows: the sheet's rows, plus what was added, less the headings. */
function tabCount(t: typeof types[number]) {
  const added = CDC_TYPE_ADDED.filter(a => a.type === t.key).length
  const parents = CDC_TYPE_PARENTS.filter(x => x.type === t.key).length
  return t.requirements.length + added - parents
}

const divergences = computed(() =>
  CDC_TYPE_NOTES.filter(n => n.type === typeKey.value && n.kind === 'diverge'))

/**
 * The requirement count, computed rather than the generated CDC_TYPE_REQ_COUNT, so that adding a row to
 * the corrections file or marking one as a heading moves the number on the page with it.
 */
const typeReqCount = computed(() => types.reduce((n, t) => n + tabCount(t), 0))

const missingCodes = CDC_MISSING_CODES

/**
 * Which of our rules a test belongs to, where one code has several. Only the inland sheet does, and
 * there the zone is the whole difference, so the zone list is the clearest name for the variant.
 */
function variant(key: string) {
  const t = type.value?.tests.find(x => x.key === key)
  const zones = t?.checks.find(c => c.column === 'lzn_sym_code')?.says
  return zones ? zones.replace(/^zone is /, '') : (t?.name ?? key)
}

/** The instrument's anchor format, so a click lands on the clause rather than the top of the page. */
function clauseLink(clause: string) {
  const sec = clause.match(/^(\d+\.\d+[A-Z]?)/)
  return sec ? `${CDC_SEPP_URL}#sec.${sec[1]}` : `${CDC_SEPP_URL}#sch.5`
}
</script>

<style scoped>
.cd {
  min-height: 100vh; background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  padding-bottom: 4rem;
}
.cd-head {
  display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem;
  padding: 1.2rem 1.5rem 1rem; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.cd-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.cd-back:hover { color: #0f172a; }
.cd-title { margin: 0; font-size: 1.4rem; font-weight: 800; color: #0f172a; }
.cd-sub { margin: 0.35rem 0 0; max-width: 72ch; font-size: 0.88rem; color: #475569; }
.cd-stats { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.76rem; color: #64748b; }
.cd-stats b { display: block; font-size: 1.3rem; font-weight: 800; color: #0f172a; }

.cd-sec { margin: 1.6rem 1.5rem 0; }
.cd-sec--foot { margin-top: 2.4rem; }
.cd-h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; margin: 0 0 0.5rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.cd-h2-sub { font-size: 0.78rem; font-weight: 500; color: #64748b; }
.cd-lead { margin: 0 0 0.8rem; max-width: 78ch; font-size: 0.82rem; color: #475569; }
.cd-note { margin: 0; padding: 0.55rem 0.8rem; max-width: 92ch; background: #fffbeb; border-left: 3px solid #d97706; border-radius: 0 8px 8px 0; font-size: 0.78rem; color: #92400e; }

.cd-scroll { overflow-x: auto; }
.cd-table { width: 100%; min-width: 900px; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; font-size: 0.79rem; }
.cd-table thead th { padding: 0.45rem 0.7rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; text-align: left; white-space: nowrap; }
.cd-table td { padding: 0.34rem 0.7rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.cd-th-clause { width: 8.5rem; }
.cd-th-x, .cd-td-x { width: 5.5rem; text-align: center; white-space: nowrap; }
.cd-clause { white-space: nowrap; font-variant-numeric: tabular-nums; }
.cd-clause a { color: #2a78d6; text-decoration: none; font-weight: 700; font-size: 0.76rem; }
.cd-clause a:hover { text-decoration: underline; }
.cd-text { color: #0f172a; }
.cd-tr-parent { background: #f8fafc; }
.cd-tr-parent .cd-text { font-weight: 700; }
.cd-tr-gap .cd-text { color: #64748b; }
.cd-yes { color: #15803d; font-weight: 800; }
.cd-no { color: #b91c1c; font-weight: 700; font-size: 0.7rem; }
.cd-th-src { width: 15rem; }
.cd-link { display: block; font-size: 0.72rem; color: #2a78d6; text-decoration: none; }
.cd-link:hover { text-decoration: underline; }
.cd-link i { font-style: normal; color: #94a3b8; margin-left: 0.3rem; font-size: 0.66rem; }
.cd-src code { display: block; font-size: 0.68rem; color: #64748b; word-break: break-all; }
.cd-avail { display: block; font-size: 0.68rem; }
.cd-tr-note td { border-bottom: 1px solid #f1f5f9; padding-top: 0; }
.cd-diverge { font-size: 0.73rem; color: #92400e; }

/* the codes, one tab each */
.cd-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.8rem; }
.cd-tab {
  display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.6rem;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 999px;
  font: inherit; font-size: 0.76rem; color: #475569; cursor: pointer;
}
.cd-tab:hover { border-color: #94a3b8; color: #0f172a; }
.cd-tab--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.cd-tab-name { font-weight: 600; }
.cd-tab-n { font-size: 0.68rem; font-variant-numeric: tabular-nums; color: #15803d; font-weight: 700; }
.cd-tab--on .cd-tab-n { color: #86efac; }
.cd-tab-n--none { color: #b91c1c; }
.cd-tab--on .cd-tab-n--none { color: #fca5a5; }

.cd-type-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.6rem; }
.cd-type-title { margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.cd-type-code { margin: 0.1rem 0 0; font-size: 0.74rem; color: #64748b; }
.cd-inherit { margin: 0; font-size: 0.73rem; font-weight: 700; color: #15803d; }
.cd-type-note { margin: 0.5rem 0 0; max-width: 86ch; padding: 0.45rem 0.7rem; background: #fffbeb; border-left: 3px solid #d97706; border-radius: 0 8px 8px 0; font-size: 0.76rem; color: #92400e; }
.cd-type-note--red { background: #fef2f2; border-left-color: #b91c1c; color: #991b1b; }

.cd-tests { display: grid; gap: 0.3rem; margin: 0.6rem 0 0.7rem; }
.cd-test { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; }
.cd-test-name { font-size: 0.72rem; font-weight: 700; color: #64748b; margin-right: 0.2rem; }
.cd-pill { padding: 0.1rem 0.45rem; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; font-size: 0.71rem; color: #065f46; }

.cd-subs { display: block; margin-top: 0.15rem; font-size: 0.72rem; color: #64748b; }
.cd-rownote { display: block; margin-top: 0.15rem; font-size: 0.72rem; color: #92400e; }
.cd-says { display: block; font-size: 0.72rem; color: #065f46; }
.cd-says i { font-style: normal; color: #94a3b8; }

.cd-h3 { margin: 1.4rem 0 0.4rem; font-size: 0.9rem; font-weight: 800; color: #0f172a; }
.cd-th-n { text-align: right; white-space: nowrap; }
.cd-n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; white-space: nowrap; }
.cd-lead--after { margin-top: 0.8rem; }
.cd-traced { margin: 0; padding: 0; list-style: none; max-width: 92ch; }
.cd-traced li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem; padding: 0.35rem 0; border-bottom: 1px solid #f1f5f9; font-size: 0.8rem; color: #475569; }
.cd-traced b { color: #7c3aed; }

.cd-watch { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.6rem; max-width: 84ch; }
.cd-watch li { font-size: 0.84rem; color: #334155; }
.cd-dim { color: #94a3b8; }
.cd-foot { margin: 0; font-size: 0.78rem; color: #64748b; }
.cd code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
a { color: #2a78d6; }
/* violet = read from the instrument, not from the Department workbook */
.cd-add-ink { color: #6d28d9; }
.cd-tr-add { background: #faf8ff; }
.cd-tr-add .cd-text { color: #4c1d95; }
.cd-tr-add .cd-clause a { color: #7c3aed; }
.cd-tr-add td { border-left: 0; }
.cd-tr-add td:first-child { box-shadow: inset 3px 0 0 #7c3aed; }
.cd-tag {
  display: block; margin-top: 0.2rem; font-size: 0.62rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em; color: #7c3aed; white-space: normal;
}
.cd-tag--fix { text-transform: none; letter-spacing: 0; font-weight: 500; color: #7c3aed; }
.cd-tag--fix b { display: block; font-weight: 700; font-size: 0.72rem; }
.cd-why {
  display: block; margin-top: 0.3rem; font-size: 0.72rem; line-height: 1.45; color: #6d28d9;
}
.cd-link--add { color: #7c3aed; }
.cd-link--add i { color: #a78bfa; }

/* the per-code audit layer: blue, so it never reads as the general one's violet */
.cd-code-ink { color: #1d4ed8; }
.cd-tr-code { background: #f4f8ff; }
.cd-tr-code .cd-text { color: #1e3a8a; }
.cd-tr-code .cd-clause a { color: #2563eb; }
.cd-tr-code td { border-left: 0; }
.cd-tr-code td:first-child { box-shadow: inset 3px 0 0 #2563eb; }
.cd-tag--code {
  display: block; margin-top: 0.3rem; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; color: #2563eb;
}
.cd-tag--codefix {
  display: block; margin-top: 0.3rem; font-size: 0.66rem; font-weight: 500; color: #2563eb;
  text-transform: none; letter-spacing: 0;
}
.cd-tag--codefix b { display: block; font-weight: 700; font-size: 0.72rem; }
.cd-why--code { color: #1d4ed8; }
.cd-link--code { color: #2563eb; }
.cd-link--code i { color: #93c5fd; }
.cd-restate { font-size: 0.73rem; color: #1d4ed8; }
.cd-restate b, .cd-diverge b { display: block; font-weight: 700; }
.cd-type-diverge {
  margin: 0.5rem 0 0; max-width: 86ch; padding: 0.45rem 0.7rem; background: #fef2f2;
  border-left: 3px solid #b91c1c; border-radius: 0 8px 8px 0; font-size: 0.76rem; color: #991b1b;
}
.cd-type-diverge b { font-size: 0.9rem; }
.cd-table--add { border-color: #ddd6fe; }
.cd-table--add thead th { background: #f5f3ff; border-bottom-color: #ddd6fe; color: #6d28d9; }
</style>