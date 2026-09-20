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
        <span><b>{{ CDC_TESTED_COUNT }}</b> we test</span>
        <span><b>{{ gaps.length }}</b> we do not</span>
        <span><b>{{ CDC_TYPES.length }}</b> codes on top</span>
        <span><b>{{ CDC_UNMAPPED.length }}</b> tests with no clause</span>
      </div>
    </header>

    <section class="cd-sec">
      <p class="cd-note">
        The clause numbers and wording come from the Department's own compilation, not from a reading of
        the instrument: <a :href="CDC_SEPP_URL" target="_blank" rel="noopener">legislation.nsw.gov.au</a>
        refuses automated requests, so nothing here has been checked against
        <code>epi-2008-0572</code> directly. Every clause links out so you can.
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
              <th class="cd-th-x">Tested</th>
              <th>What we read</th>
              <th class="cd-th-src">Source the workbook gives</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in part.rows" :key="r.clause">
              <tr :class="{ 'cd-tr-parent': r.isParent, 'cd-tr-gap': !r.tested && !r.isParent }">
                <td class="cd-clause">
                  <a :href="clauseLink(r.clause)" target="_blank" rel="noopener">{{ r.clause }}</a>
                </td>
                <td class="cd-text">{{ r.text }}</td>
                <td class="cd-td-x">
                  <span v-if="r.isParent" class="cd-dim" :title="r.tested ? 'every paragraph under it is tested' : 'some paragraphs under it are not'">
                    {{ r.tested ? '✓' : 'partly' }}
                  </span>
                  <span v-else-if="r.tested" class="cd-yes" title="we test this">✓</span>
                  <span v-else class="cd-no" title="we do not test this">not tested</span>
                </td>
                <td class="cd-src">
                  <code v-for="s in r.services" :key="s || 'x'">{{ s }}</code>
                </td>
                <td class="cd-src">
                  <a
                    v-for="d in r.sources" :key="d.url" class="cd-link"
                    :href="d.url" :title="d.url" target="_blank" rel="noopener"
                  >{{ d.label }}<i>{{ d.host }}</i></a>
                  <span v-if="r.sourceNote" class="cd-dim cd-avail">{{ r.sourceNote }}</span>
                  <span v-if="!r.sources.length && !r.sourceNote" class="cd-dim">—</span>
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
        <span class="cd-h2-sub">{{ CDC_TYPES.length }} codes · {{ CDC_TYPE_TESTED_COUNT }} of
          {{ CDC_TYPE_REQ_COUNT }} of their requirements tested</span>
      </h2>
      <p class="cd-lead">
        Everything above has to be clear before any of this is reached. Each code then adds its own
        requirements, and this is where the zone, the lot size and the frontage are decided. Sheets 2 to
        13 of the same workbook, one per code.
      </p>

      <div class="cd-tabs">
        <button
          v-for="t in CDC_TYPES" :key="t.key" class="cd-tab"
          :class="{ 'cd-tab--on': t.key === typeKey }" @click="typeKey = t.key"
        >
          <span class="cd-tab-name">{{ t.name }}</span>
          <span class="cd-tab-n" :class="{ 'cd-tab-n--none': !t.testedCount }">
            {{ t.testedCount }}/{{ t.requirements.length }}
          </span>
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
                <th class="cd-th-x">Tested</th>
                <th>What we require</th>
                <th class="cd-th-src">Source the workbook gives</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in type.requirements" :key="r.clause" :class="{ 'cd-tr-gap': !r.tested }">
                <td class="cd-clause">
                  <a v-if="r.href" :href="r.href" target="_blank" rel="noopener">{{ r.clause }}</a>
                  <span v-else>{{ r.clause }}</span>
                </td>
                <td class="cd-text">
                  {{ r.text }}
                  <span v-if="r.subItems.length" class="cd-subs">{{ r.subItems.join(' ') }}</span>
                  <span v-if="r.note" class="cd-rownote">{{ r.note }}</span>
                </td>
                <td class="cd-td-x">
                  <span v-if="r.tested" class="cd-yes" title="we test this">✓</span>
                  <span v-else class="cd-no" title="we do not test this">not tested</span>
                </td>
                <td class="cd-src">
                  <span v-for="b in r.testedBy" :key="b.type + b.column" class="cd-says">
                    {{ b.says }}
                    <i v-if="type.tests.length > 1">{{ variant(b.type) }}</i>
                  </span>
                </td>
                <td class="cd-src">
                  <a
                    v-for="d in r.sources" :key="d.url" class="cd-link"
                    :href="d.url" :title="d.url" target="_blank" rel="noopener"
                  >{{ d.label }}<i>{{ d.host }}</i></a>
                  <span v-if="r.sourceNote" class="cd-dim cd-avail">{{ r.sourceNote }}</span>
                  <span v-if="!r.sources.length && !r.sourceNote" class="cd-dim">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ── our checks with no clause behind them ─────────────────────────── -->
    <section class="cd-sec">
      <h2 class="cd-h2">
        Tests we run that this list does not account for
        <span class="cd-h2-sub">{{ CDC_UNMAPPED.length }}</span>
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
            <tr v-for="u in CDC_UNMAPPED" :key="u.column">
              <td class="cd-text">{{ u.land }}</td>
              <td class="cd-src"><code v-if="u.service">{{ u.service }}</code><span v-else class="cd-dim">—</span></td>
              <td class="cd-src"><code>{{ u.column }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
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
        <li v-if="gaps.length">
          <b>{{ gaps.length }} requirements are not tested at all.</b>
          <span class="cd-dim">{{ gaps.map(g => g.clause).join(', ') }}</span>.
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
  CDC_GENERATED_ON, CDC_REQUIREMENTS, CDC_SEPP_URL, CDC_TESTED_COUNT, CDC_TYPE_REQ_COUNT,
  CDC_TYPE_TESTED_COUNT, CDC_TYPES, CDC_UNMAPPED,
} from '#shared/cdc-criteria'

useHead({ title: 'Complying development prerequisites · Planning Library' })

const requirements = CDC_REQUIREMENTS

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

const parts = computed(() =>
  PARTS.map(p => ({ ...p, rows: requirements.filter(r => p.test(r.clause)) }))
    .filter(p => p.rows.length))

const gaps = computed(() => requirements.filter(r => !r.tested && !r.isParent))

const typeKey = ref(CDC_TYPES[0]?.key ?? '')
const type = computed(() => CDC_TYPES.find(t => t.key === typeKey.value))

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

.cd-watch { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.6rem; max-width: 84ch; }
.cd-watch li { font-size: 0.84rem; color: #334155; }
.cd-dim { color: #94a3b8; }
.cd-foot { margin: 0; font-size: 0.78rem; color: #64748b; }
.cd code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
a { color: #2a78d6; }
</style>
