<!--
  /rag - the RAG pilot: where it is heading (shared/rag-plan.ts) and what schema `rag` holds right now (/api/rag/status).

  A second pilot beside the CDC session's deterministic one: a structure-aware, navigating RAG over Randwick LEP 2012
  and the Housing SEPP parts that reach its lots, compared with the engine question by question.
-->
<template>
  <div class="rg-page">
    <header class="rg-header">
      <NuxtLink to="/" class="rg-back">&larr; Home</NuxtLink>
      <h1 class="rg-title">RAG pilot</h1>
      <p class="rg-lead">
        A structure-aware, navigating RAG over <strong>Randwick LEP 2012</strong> and the Housing SEPP parts that reach its lots,
        built on what the CDC pilot learnt about the text - stems with their roles, leaves with their connectives, tables as
        cells - and compared with the deterministic engine question by question. The model finds and explains; a deterministic
        resolver decides precedence and writes down why. Plan updated {{ RAG_UPDATED }}; counts live from schema <code>rag</code>.
      </p>
    </header>

    <!-- progress -->
    <section class="rg-progress">
      <div class="rg-bar"><div class="rg-bar-done" :style="{ width: pct + '%' }" /><div class="rg-bar-doing" :style="{ width: pctDoing + '%' }" /></div>
      <p class="rg-count">{{ stepCount.done }} of {{ stepCount.all }} steps done · {{ stepCount.doing }} in progress · {{ stepCount.blocked }} blocked</p>
      <nav class="rg-phases">
        <a v-for="p in RAG_PHASES" :key="p.id" :href="'#' + p.id" class="rg-phase-chip" :class="'rg-phase-chip--' + phaseState(p)">
          <strong>{{ p.id }}</strong> {{ p.title }}
        </a>
      </nav>
    </section>

    <!-- live -->
    <section class="rg-section">
      <h2 class="rg-h2">Live <span class="rg-muted" v-if="status">· measured {{ when(status.measuredAt) }} in {{ status.ms }} ms</span></h2>
      <ClientOnly>
      <p v-if="pending" class="rg-muted">Loading…</p>
      <p v-else-if="error" class="rg-err">Could not load /api/rag/status: {{ error.message }}</p>
      <template v-else-if="status">
        <div class="rg-cards">
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.instruments, 'provisions')) }}</div><div class="rg-card-l">provisions</div></div>
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.relations, 'n')) }}</div><div class="rg-card-l">relations</div></div>
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.chunks, 'n')) }}</div><div class="rg-card-l">chunks</div></div>
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.embeddings, 'n')) }}</div><div class="rg-card-l">embeddings</div></div>
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.questions, 'n')) }}</div><div class="rg-card-l">questions</div></div>
          <div class="rg-card"><div class="rg-card-n">{{ fmt(sum(status.answers, 'n')) }}</div><div class="rg-card-l">RAG answers</div></div>
        </div>

        <h3 class="rg-h3">Corpus</h3>
        <table class="rg-table">
          <thead><tr><th>Instrument</th><th>In scope</th><th class="n">Provisions</th><th class="n">Stems</th><th class="n">Connectives</th><th class="n">Table nodes</th><th>Snapshot</th></tr></thead>
          <tbody>
            <tr v-for="i in status.instruments" :key="i.title">
              <td>{{ i.title }} <span class="rg-tag">{{ i.kind }} · rank {{ i.rank }}</span></td>
              <td class="rg-small">{{ i.scope ? i.scope.join(', ') : 'whole plan' }}</td>
              <td class="n">{{ fmt(i.provisions) }}</td><td class="n">{{ fmt(i.stems) }}</td><td class="n">{{ fmt(i.connectives) }}</td><td class="n">{{ fmt(i.table_nodes) }}</td>
              <td class="rg-small">{{ i.snapshot_at ? when(i.snapshot_at) : '—' }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="rg-h3">Relations by kind <span class="rg-muted">- the law's own logic as data</span></h3>
        <table class="rg-table">
          <thead><tr><th>Kind</th><th>Meaning</th><th class="n">Total</th><th class="n">Verified</th><th class="n">Proposed</th><th class="n">Rejected</th><th class="n">Target unresolved</th></tr></thead>
          <tbody>
            <tr v-for="r in status.relations" :key="r.kind" :class="{ 'rg-dim': !r.n }">
              <td><code>{{ r.kind }}</code></td><td class="rg-small">{{ r.meaning }}</td>
              <td class="n">{{ fmt(r.n) }}</td><td class="n">{{ fmt(r.verified) }}</td><td class="n">{{ fmt(r.proposed) }}</td><td class="n">{{ fmt(r.rejected) }}</td><td class="n">{{ fmt(r.unresolved) }}</td>
            </tr>
          </tbody>
        </table>

        <div class="rg-cols">
          <div>
            <h3 class="rg-h3">Index</h3>
            <p v-if="!status.chunks.length" class="rg-muted">Not built yet (Phase 3).</p>
            <ul class="rg-list"><li v-for="c in status.chunks" :key="c.role">{{ c.role }}: {{ fmt(c.n) }} <span class="rg-muted">({{ fmt(c.with_context) }} with context)</span></li></ul>
            <ul class="rg-list"><li v-for="e in status.embeddings" :key="e.variant + e.model">embeddings {{ e.variant }} · {{ e.model }}: {{ fmt(e.n) }}</li></ul>
          </div>
          <div>
            <h3 class="rg-h3">Questions and answers</h3>
            <p v-if="!status.questions.length" class="rg-muted">No questions yet (Phase 4).</p>
            <ul class="rg-list"><li v-for="qq in status.questions" :key="qq.set_name + qq.kind">{{ qq.set_name }} · {{ qq.kind }}: {{ fmt(qq.n) }}</li></ul>
            <ul class="rg-list">
              <li v-if="status.engine.n">engine answers: {{ fmt(status.engine.n) }} over {{ status.engine.runs }} run(s)</li>
              <li v-for="a in status.answers" :key="a.variant + a.model">{{ a.variant }} · {{ a.model }}: {{ fmt(a.n) }} · avg {{ fmt(a.avg_ms) }} ms · ${{ a.cost ?? 0 }}</li>
              <li v-for="a in status.adjudications" :key="a.status">adjudications {{ a.status }}: {{ fmt(a.n) }}</li>
            </ul>
          </div>
        </div>

        <h3 class="rg-h3">Recent runs</h3>
        <table class="rg-table">
          <thead><tr><th>Stage</th><th>Started</th><th>Took</th><th>Counts</th></tr></thead>
          <tbody>
            <tr v-for="r in status.runs" :key="r.id">
              <td><code>{{ r.stage }}</code></td><td class="rg-small">{{ when(r.started_at) }}</td>
              <td class="rg-small">{{ r.finished_at ? took(r.started_at, r.finished_at) : 'running / failed' }}</td>
              <td class="rg-small rg-mono">{{ short(r.counts) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      </ClientOnly>
    </section>

    <!-- spatial resolution: what the graph can test on a lot (build), and what each answer could and could not check (per lot) -->
    <section class="rg-section" id="spatial">
      <h2 class="rg-h2">Spatial resolution <span class="rg-muted">· resolved when the graph is built, then on each lot - and said plainly where it cannot be</span></h2>
      <ClientOnly>
      <template v-if="status?.bindings">
        <h3 class="rg-h3">1 · Building the graph: every condition a claim depends on, and how it will be tested</h3>
        <p class="rg-muted">From <code>rag.claim_binding</code> (scripts/rag/02d-bindings.ts). A condition is bound to the layers registered in
          <code>nsw.scope_layer</code> (the ones /testing-spatial-services and /cdc-map read), to a council list, or to the polygons
          of a map the clause names. Anything that is not bound is listed here, and on a lot it is answered <em>maybe</em>, never assumed.</p>
        <div class="rg-cards">
          <div v-for="s in BIND_ORDER.filter(s => bindCount(s))" :key="s" class="rg-card" :class="{ 'rg-card--warn': !BIND_OK.includes(s) }">
            <div class="rg-card-n">{{ bindCount(s) }}</div><div class="rg-card-l">{{ BIND_LABEL[s] }}</div>
          </div>
        </div>
        <details v-for="s in BIND_ORDER.filter(s => bindCount(s))" :key="'d' + s" class="rg-bind" :open="!BIND_OK.includes(s)">
          <summary><strong>{{ BIND_LABEL[s] }}</strong> · {{ bindCount(s) }} <span class="rg-muted">- {{ BIND_MEANS[s] }}</span></summary>
          <table class="rg-table">
            <thead><tr><th>Clause</th><th>Condition</th><th>Tested against</th></tr></thead>
            <tbody>
              <tr v-for="(b, i) in status.bindings.filter((b: any) => b.status === s)" :key="i">
                <td class="rg-small"><a v-if="b.url" :href="b.url" target="_blank" rel="noopener">{{ b.label }}</a><span v-else>{{ b.label }}</span>
                  <span class="rg-muted"> · {{ b.claim_kind }} {{ b.part }}</span></td>
                <td class="rg-small">{{ b.text }}</td>
                <td class="rg-small">
                  <code v-for="t in (b.scope_terms ?? [])" :key="t" class="rg-term">{{ t }}</code>
                  <span v-if="b.sources?.length" class="rg-muted"> {{ b.sources.join(', ') }}</span>
                  <span v-if="b.assume_absent" class="rg-muted"> (no dataset: treated as absent, said in the answer)</span>
                  <span v-if="b.note" class="rg-muted"> {{ b.note }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </details>

        <h3 class="rg-h3">2 · Deciding on each lot</h3>
        <template v-if="status.lotChecks">
          <p class="rg-muted">
            Of side D's {{ status.lotChecks.answers }} answers, {{ status.lotChecks.with_checked }} tested at least one condition against lot data and
            <strong>{{ status.lotChecks.with_unchecked }}</strong> rest on a condition no data could settle - those say so in their trace
            ("Could not check") and the answer is <em>maybe</em> on that point, not assumed.</p>
          <div class="rg-cols2">
            <div>
              <p class="rg-k">Could not check · questions affected</p>
              <ul class="rg-list"><li v-for="(c, i) in status.lotChecks.unchecked" :key="i">{{ c.text }} <span class="rg-muted">- {{ c.how }} · {{ c.n }}</span></li></ul>
              <p v-if="!status.lotChecks.unchecked.length" class="rg-muted">None.</p>
            </div>
            <div>
              <p class="rg-k">Checked against data · yes / no across answers</p>
              <ul class="rg-list"><li v-for="(c, i) in status.lotChecks.checked.slice(0, 25)" :key="i">{{ c.text }} <span class="rg-muted">· {{ c.yes }} yes / {{ c.no }} no</span></li></ul>
            </div>
          </div>
        </template>
      </template>
      </ClientOnly>
    </section>

    <!-- results -->
    <section class="rg-section" id="results">
      <h2 class="rg-h2">Results</h2>
      <ClientOnly>
      <template v-if="status">
        <template v-if="status.score">
          <h3 class="rg-h3">Scores · {{ when(status.score.at) }} · against key and draft answers</h3>
          <div class="rg-scroll">
          <table class="rg-table">
            <thead><tr><th>Side</th><th class="n">Answers</th><th class="n">Scored</th><th class="n">Correct</th><th class="n">Confidently wrong</th><th class="n">Abstained</th>
              <th class="n">Cites right clause</th><th class="n">Cites resolve</th><th class="n">Quotes verbatim</th><th class="n">Figure in cited clause</th><th class="n">Unaddressed overrides</th><th class="n">$ / answer</th><th class="n">s</th></tr></thead>
            <tbody>
              <tr v-for="k in SIDES.filter(k => status.score.summary[k])" :key="k">
                <td><strong>{{ k }}</strong> <span class="rg-muted">{{ sideName(k) }}</span></td>
                <td class="n">{{ status.score.summary[k].answers }}</td><td class="n">{{ status.score.summary[k].scored }}</td>
                <td class="n">{{ p(status.score.summary[k].accuracy) }}</td>
                <td class="n" :class="{ 'rg-bad': (status.score.summary[k].confidently_wrong ?? 0) >= 20 }">{{ p(status.score.summary[k].confidently_wrong) }}</td>
                <td class="n">{{ p(status.score.summary[k].abstained) }}</td><td class="n">{{ p(status.score.summary[k].controlling) }}</td>
                <td class="n">{{ p(status.score.summary[k].cites_resolved) }}</td><td class="n">{{ p(status.score.summary[k].quotes_verbatim) }}</td>
                <td class="n">{{ p(status.score.summary[k].figure_in_cited) }}</td><td class="n">{{ status.score.summary[k].unaddressed_overrides_per_answer ?? '—' }}</td>
                <td class="n">{{ status.score.summary[k].cost_per_answer ?? '—' }}</td><td class="n">{{ status.score.summary[k].latency_s ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p class="rg-muted">P is the CDC session's engine (LEP pilot); it answers permissibility and subdivision only - questions it does not answer are not scored for it.
            D is the rag engine with no model (rag.claim + the evaluator). <strong>ground:key</strong> = settled answers (the pilot's keys and Manni's rulings), the independent test;
            <strong>ground:draft</strong> = Claude's draft rulings awaiting confirmation, written with the same readings D encodes, so D's score there is partly circular. By set:</p>
          <div class="rg-scroll">
          <table class="rg-table">
            <thead><tr><th>Set</th><th v-for="k in SIDES" :key="k" class="n">{{ k }}</th></tr></thead>
            <tbody>
              <tr v-for="s in SETS" :key="s">
                <td>{{ s }}</td>
                <td v-for="k in SIDES" :key="k" class="n rg-small">
                  <template v-if="status.score.summary[k + '|' + s]?.scored">{{ p(status.score.summary[k + '|' + s].accuracy) }} <span class="rg-muted">/ {{ p(status.score.summary[k + '|' + s].confidently_wrong) }} cw</span></template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </template>
        <p v-else class="rg-muted">No scores yet - scripts/rag/12-score.ts.</p>

        <div class="rg-cols">
          <div v-if="status.retrieval">
            <h3 class="rg-h3">Retrieval recall · gold clause in the first k</h3>
            <div class="rg-scroll">
            <table class="rg-table">
              <thead><tr><th>Variant</th><th class="n">n</th><th class="n">any@3</th><th class="n">any@8</th><th class="n">all@3</th><th class="n">all@8</th></tr></thead>
              <tbody><tr v-for="(r, v) in status.retrieval.summary" :key="v">
                <td><strong>{{ v }}</strong></td><td class="n">{{ r.n }}</td><td class="n">{{ p100(r['any@3']) }}</td><td class="n">{{ p100(r['any@8']) }}</td><td class="n">{{ p100(r['all@3']) }}</td><td class="n">{{ p100(r['all@8']) }}</td>
              </tr></tbody>
            </table>
            </div>
            <p class="rg-muted">R2 most often misses: {{ status.retrieval.misses.join(', ') }}</p>
          </div>
          <div v-if="status.resolver">
            <h3 class="rg-h3">Resolver precedence keys · {{ status.resolver.pass }} / {{ status.resolver.pass + status.resolver.fail }} pass</h3>
            <ul class="rg-list">
              <li v-for="c in status.resolver.cases" :key="c.id"><strong :class="c.pass ? 'rg-good' : 'rg-bad'">{{ c.id }}</strong> {{ c.verdict }}: {{ JSON.stringify(c.got) }}
                <span v-if="c.trace.length" class="rg-muted"> · {{ c.trace.join(' · ') }}</span></li>
            </ul>
          </div>
        </div>

        <template v-if="status.queue?.length">
          <h3 class="rg-h3">Adjudication queue · drafts for Manni to confirm or correct · most disputed first</h3>
          <article v-for="(a, i) in (showAll ? status.queue : status.queue.slice(0, 12))" :key="i" class="rg-step">
            <div class="rg-step-head"><span class="rg-tag">{{ a.set_name }} {{ a.clause }}</span> <span class="rg-small">{{ a.text }}</span></div>
            <p class="rg-done"><span class="rg-k">Proposed</span>{{ ruling(a.expected) }}
              <span v-if="a.wrong_sides?.length" class="rg-bad"> · disagree: {{ a.wrong_sides.join(', ') }}</span></p>
            <p v-if="a.expected?.trace?.length" class="rg-done rg-small"><span class="rg-k">Why</span>{{ a.expected.trace.join(' → ') }}</p>
            <details v-if="a.quote" class="rg-small"><summary>controlling words</summary><p class="rg-quote">{{ a.quote }}</p></details>
          </article>
          <button v-if="status.queue.length > 12" class="rg-more" @click="showAll = !showAll">{{ showAll ? 'Show fewer' : `Show all ${status.queue.length}` }}</button>
        </template>
      </template>
      </ClientOnly>
    </section>

    <!-- questions: every answer and how it was reached -->
    <section class="rg-section" id="questions">
      <h2 class="rg-h2">Questions <span class="rg-muted">· every side's answer and how it was reached, clause by clause</span></h2>
      <p class="rg-muted">
        <strong>D</strong> the rag engine with no model (claims read from the text → tested on the lot → resolver) ·
        <strong>P</strong> the CDC session's engine (LEP pilot only) · <strong>R3 / L0 / R4</strong> Llama 3.3 writing the answer from retrieved text.
        Expected answers are marked by who wrote them: <em>key</em> (the pilot's keys and Manni's rulings) or <em>draft</em> (Claude's, not yet ruled on).
      </p>
      <ClientOnly>
        <div class="qb-bar">
          <button v-for="s in QSETS" :key="s.id" type="button" class="qb-chip" :class="{ 'qb-chip--on': qset === s.id }" @click="qset = s.id">{{ s.label }}</button>
          <input v-model="qsearch" class="qb-search" placeholder="search question or address">
        </div>
        <p v-if="!qlist" class="rg-muted">Loading questions…</p>
        <div v-else class="qb-list">
          <div v-for="x in shownQs" :key="x.id" class="qb-item" :class="{ 'qb-item--open': openQ === x.id }">
            <button type="button" class="qb-row" @click="toggleQ(x.id)">
              <span class="rg-tag">{{ x.set_name }} {{ x.clause }}</span>
              <span class="qb-text">{{ x.text }}</span>
              <span class="qb-sides">
                <span class="qb-exp" :title="'expected (' + x.status + ')'">exp {{ short2(x.e_verdict, x.e_value, x.e_values) }}<em>{{ x.status === 'key' ? ' key' : x.status === 'draft' ? ' draft' : '' }}</em></span>
                <span v-for="k in ['D', 'P', 'R3', 'L0', 'R4']" :key="k" class="qb-side" :title="k"><b>{{ k }}</b> {{ x.sides[k] ? short2(x.sides[k].verdict, x.sides[k].value) : '–' }}</span>
              </span>
            </button>
            <div v-if="openQ === x.id" class="qb-detail">
              <p v-if="!qdetail[x.id]" class="rg-muted">Loading…</p>
              <template v-else>
                <p v-if="qdetail[x.id].question.lot_facts" class="qb-facts">
                  <b>Lot:</b> {{ factLine(qdetail[x.id].question.lot_facts) }}
                </p>
                <div class="qb-box qb-box--exp">
                  <p class="qb-h">Expected <span class="rg-muted">({{ qdetail[x.id].question.expected?.status }}{{ qdetail[x.id].question.expected?.source ? ' - ' + qdetail[x.id].question.expected.source : qdetail[x.id].question.expected?.status === 'draft' ? ' - Claude, not yet ruled on' : '' }})</span></p>
                  <p>{{ ruling(qdetail[x.id].question.expected) }}</p>
                  <p v-if="qdetail[x.id].question.expected?.trace?.length" class="rg-small">{{ qdetail[x.id].question.expected.trace.join(' → ') }}</p>
                  <p v-if="qdetail[x.id].question.expected?.note" class="rg-small">{{ qdetail[x.id].question.expected.note }}</p>
                </div>

                <div v-for="a in qdetail[x.id].answers.filter((a: any) => a.variant === 'D')" :key="'D'" class="qb-box">
                  <p class="qb-h">D · rag engine, no model</p>
                  <template v-if="a.trace?.explain?.length">
                    <div v-for="(ex, i) in a.trace.explain" :key="i">
                      <p v-if="ex.case" class="rt-k">{{ ex.case }} title</p>
                      <RagTrace :ex="ex" :provisions="qdetail[x.id].provisions" />
                    </div>
                  </template>
                  <template v-else>
                    <p>{{ a.answer?.reasoning }}</p>
                    <p v-if="a.trace?.cited?.length" class="rg-small">from: <RagClause v-for="c in a.trace.cited" :key="c" :id="c" :p="qdetail[x.id].provisions[c]" fallback="?" /></p>
                  </template>
                </div>

                <div class="qb-box">
                  <p class="qb-h">P · CDC engine (LEP pilot)</p>
                  <template v-if="qdetail[x.id].engine">
                    <p><b>{{ qdetail[x.id].engine.verdict }}</b>
                      <template v-if="qdetail[x.id].engine.controlling?.length"> by
                        <template v-for="c in qdetail[x.id].engine.controlling" :key="c">
                          <RagClause v-if="qdetail[x.id].refs['Randwick LEP cl ' + c]" :id="qdetail[x.id].refs['Randwick LEP cl ' + c]" :p="qdetail[x.id].provisions[qdetail[x.id].refs['Randwick LEP cl ' + c]]" :fallback="c" />
                          <span v-else class="rg-tag">{{ c === 'LUT' ? 'Land Use Table' : c }}</span>
                        </template>
                      </template>
                    </p>
                    <p class="rg-small">How: scripts/norms/pilot-key.ts reads the pilot's propositions for Randwick LEP only (the Housing SEPP is not loaded) and evaluates them on the lot.</p>
                  </template>
                  <p v-else class="rg-muted">not run on this question</p>
                </div>

                <div v-for="a in qdetail[x.id].answers.filter((a: any) => a.variant !== 'D' && a.variant !== 'R4u')" :key="a.variant" class="qb-box">
                  <p class="qb-h">{{ a.variant }} · {{ SIDE_NAMES[a.variant] }} <span class="rg-muted">({{ a.model }}, {{ Math.round((a.latency_ms ?? 0) / 1000) }} s, ${{ Number(a.cost_usd ?? 0).toFixed(4) }})</span></p>
                  <p><b>{{ a.answer?.verdict ?? '' }} {{ a.answer?.value ?? '' }}{{ a.answer?.unit ? ' ' + a.answer.unit : '' }}</b>
                    <template v-if="a.answer?.values_if?.length"> · {{ a.answer.values_if.map((v: any) => v.value + ' if ' + v.if).join('; ') }}</template></p>
                  <p class="rg-small">{{ a.answer?.reasoning }}</p>
                  <p v-if="a.answer?.controlling?.length" class="rg-small">cites:
                    <template v-for="c in a.answer.controlling" :key="c">
                      <RagClause v-if="qdetail[x.id].refs[c]" :id="qdetail[x.id].refs[c]" :p="qdetail[x.id].provisions[qdetail[x.id].refs[c]]" :fallback="c" />
                      <span v-else class="qb-bad">{{ c }} (no such provision)</span>{{ ' ' }}
                    </template>
                  </p>
                  <p v-if="a.checks && !a.checks.unparsed" class="rg-small">
                    checks: citations resolve {{ a.checks.cites_resolved }}/{{ a.checks.cites }} ·
                    quotes verbatim {{ a.checks.quotes_verbatim_cited }}/{{ a.checks.quotes }} ·
                    figure in cited clause: <span :class="a.checks.figure_in_cited === false ? 'qb-bad' : ''">{{ a.checks.figure_in_cited == null ? 'n/a' : a.checks.figure_in_cited ? 'yes' : 'NO' }}</span>
                    <template v-if="a.checks.unaddressed_overrides?.length"> · overrides not addressed: <span class="qb-bad">{{ a.checks.unaddressed_overrides.join('; ') }}</span></template>
                  </p>
                  <details v-if="a.retrieved?.length" class="rg-small">
                    <summary>retrieved {{ a.retrieved.length }} chunks</summary>
                    <ul class="rg-list"><li v-for="(r, i) in a.retrieved" :key="i">
                      <RagClause v-if="r.provision_id" :id="r.provision_id" :p="qdetail[x.id].provisions[r.provision_id]" :fallback="r.header" /> <span class="rg-muted">{{ r.why }}</span>
                    </li></ul>
                  </details>
                </div>
              </template>
            </div>
          </div>
          <p v-if="!shownQs.length" class="rg-muted">No question matches.</p>
        </div>
      </ClientOnly>
    </section>

    <!-- plan -->
    <section v-for="p in RAG_PHASES" :id="p.id" :key="p.id" class="rg-section">
      <h2 class="rg-h2"><span class="rg-pid">{{ p.id }}</span> {{ p.title }}</h2>
      <p class="rg-goal">{{ p.goal }}</p>
      <article v-for="s in p.steps" :key="s.id" class="rg-step" :class="'rg-step--' + s.status">
        <div class="rg-step-head">
          <span class="rg-status" :class="'rg-status--' + s.status">{{ s.status }}</span>
          <strong>{{ s.id }}</strong> {{ s.title }}
        </div>
        <p class="rg-done"><span class="rg-k">Done when</span> {{ s.doneWhen }}</p>
        <p v-if="s.result" class="rg-done"><span class="rg-k">Result</span> {{ s.result }}</p>
        <p v-if="s.where?.length" class="rg-where"><code v-for="w in s.where" :key="w">{{ w }}</code></p>
      </article>
    </section>

    <!-- scope, variants, metrics, decisions, open -->
    <section class="rg-section">
      <h2 class="rg-h2">Scope</h2>
      <ul class="rg-list"><li v-for="i in RAG_SCOPE.instruments" :key="i.title"><strong>{{ i.title }}</strong> - {{ i.parts }} <span class="rg-muted">({{ i.source }})</span></li></ul>
      <p class="rg-muted">Out of scope for now: {{ RAG_SCOPE.outOfScope }}</p>
    </section>
    <section class="rg-section rg-cols">
      <div>
        <h2 class="rg-h2">Variants compared</h2>
        <table class="rg-table"><tbody><tr v-for="v in RAG_VARIANTS" :key="v.id"><td><strong>{{ v.id }}</strong></td><td class="rg-small">{{ v.what }}</td></tr></tbody></table>
      </div>
      <div>
        <h2 class="rg-h2">Metrics</h2>
        <table class="rg-table"><tbody><tr v-for="m in RAG_METRICS" :key="m.key"><td><strong>{{ m.key }}</strong></td><td class="rg-small">{{ m.what }}<br><span class="rg-muted">{{ m.why }}</span></td></tr></tbody></table>
      </div>
    </section>
    <section class="rg-section">
      <h2 class="rg-h2">Decisions</h2>
      <table class="rg-table"><tbody><tr v-for="d in RAG_DECISIONS" :key="d.id"><td><strong>{{ d.id }}</strong></td><td>{{ d.decision }}<br><span class="rg-muted">{{ d.why }}</span></td></tr></tbody></table>
    </section>
    <section class="rg-section">
      <h2 class="rg-h2">Open</h2>
      <ul class="rg-list"><li v-for="o in RAG_OPEN" :key="o.q"><strong>{{ o.q }}</strong> - {{ o.note }}</li></ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { RAG_DECISIONS, RAG_METRICS, RAG_OPEN, RAG_PHASES, RAG_SCOPE, RAG_UPDATED, RAG_VARIANTS, type PlanPhase } from '#shared/rag-plan'

useHead({ title: 'RAG pilot · Planning Library' })

const { data: status, pending, error } = await useFetch<any>('/api/rag/status', { server: false, lazy: true })
// rag.claim_binding statuses, in the order the page shows them
const BIND_ORDER = ['bound', 'items', 'no_data', 'no_polygon', 'no_match', 'unscoped', 'proposal_fact', 'discretion']
const BIND_OK = ['bound', 'items', 'proposal_fact', 'discretion']
const BIND_LABEL: Record<string, string> = { bound: 'bound to data', items: 'list frames, read item by item', no_data: 'no dataset held', no_polygon: 'map without polygons', no_match: 'no layer matched',
  unscoped: 'condition not read', proposal_fact: 'a fact about the proposal', discretion: 'the consent authority decides' }
const BIND_MEANS: Record<string, string> = {
  bound: 'tested on every lot against the layers named',
  items: 'a frame whose condition is a list: each item is bound on its own row (above / below), combined any / all as the list says - unknown when the list does not say',
  no_data: 'the term is known but no dataset holds it; on a lot it is "could not check" unless the registry says it is absent everywhere',
  no_polygon: 'the clause names an area on a map whose polygons are not held; on a lot it is "could not check"',
  no_match: 'no registered layer or list answers it; on a lot it is "could not check"',
  unscoped: 'a frame ("land to which ... applies") whose condition was not read into terms; on a lot it is "could not check"',
  proposal_fact: 'answered from the question (date, tenure, number of lots), not from a map',
  discretion: 'a matter for the consent authority: the answer splits on it',
}
const bindCount = (s: string) => (status.value?.bindings ?? []).filter((b: any) => b.status === s).length

const steps = RAG_PHASES.flatMap(p => p.steps)
const stepCount = {
  all: steps.length,
  done: steps.filter(s => s.status === 'done').length,
  doing: steps.filter(s => s.status === 'doing').length,
  blocked: steps.filter(s => s.status === 'blocked').length,
}
const pct = Math.round(100 * stepCount.done / stepCount.all)
const pctDoing = Math.round(100 * stepCount.doing / stepCount.all)
const phaseState = (p: PlanPhase) => p.steps.every(s => s.status === 'done') ? 'done'
  : p.steps.some(s => s.status === 'blocked') ? 'blocked' : p.steps.some(s => s.status !== 'todo') ? 'doing' : 'todo'

const fmt = (n: unknown) => n == null ? '—' : Number(n).toLocaleString('en-AU')
const sum = (rows: any[] | undefined, k: string) => (rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0)
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const took = (a: string, b: string) => { const s = (new Date(b).getTime() - new Date(a).getTime()) / 1000; return s < 90 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(1)} min` }
const short = (o: unknown) => { const t = o ? JSON.stringify(o) : ''; return t.length > 160 ? t.slice(0, 157) + '…' : t }
const showAll = ref(false)

// the question browser: the list once, each question's full answer on demand
const QSETS = [{ id: 'all', label: 'All' }, { id: 'hard_case', label: 'Hard cases' }, { id: 'local', label: 'Additional uses & local controls' },
  { id: 'propcode', label: 'PropCode claims' }, { id: 'pilot_key', label: 'Pilot keys' }, { id: 'grid', label: 'Grid' }]
const qset = ref('all'), qsearch = ref(''), openQ = ref<string | null>(null)
const qdetail = reactive<Record<string, any>>({})
const { data: qlist } = useFetch<any[]>('/api/rag/questions', { server: false, lazy: true })
const shownQs = computed(() => (qlist.value ?? []).filter((x: any) => (qset.value === 'all' || x.set_name === qset.value)
  && (!qsearch.value || x.text.toLowerCase().includes(qsearch.value.toLowerCase()))))
const toggleQ = async (id: string) => {
  openQ.value = openQ.value === id ? null : id
  if (openQ.value && !qdetail[id]) qdetail[id] = await $fetch('/api/rag/question', { query: { id } })
}
const short2 = (v: unknown, val?: unknown, vals?: any) => vals ? Object.values(vals).join(' / ') : v ? String(v).replace('permissible', 'yes').replace('prohibited', 'no').replace('not_answered', '–').replace('conditional', 'yes*') : val != null ? String(val) : '–'
const factLine = (l: any) => [l.address, l.lot, l.area_m2 != null ? `${l.area_m2} m²` : null, l.zone ? `Zone ${l.zone}` : null,
  l.frontage_m != null ? `frontage ${l.frontage_m} m` : null, l.fsr_map != null ? `FSR map ${l.fsr_map}:1` : null, l.height_map_m != null ? `height map ${l.height_map_m} m` : null,
  l.low_mid_rise_area?.band ? `LMR ${l.low_mid_rise_area.band} (${l.low_mid_rise_area.class})` : 'not in an LMR area', l.heritage ? `heritage: ${l.heritage}` : null,
  // a whole-map reference ("land" on the Floor Space Ratio Map) says nothing about the lot - only named areas are shown
  ...(l.mapped ?? []).filter((m: any) => !/^(land|the land)$/i.test(m.label) && m.label.toLowerCase() !== String(m.map).toLowerCase())
    .map((m: any) => `${m.label} on the ${m.map} Map (${Math.round(m.share * 100)}%)`)].filter(Boolean).join(' · ')
const SIDES = ['P', 'D', 'R0', 'R1', 'R2', 'R3', 'L0', 'R4u', 'R4']
// the sets, then the grid by question (dual occupancy, secondary dwelling, multi dwelling housing, FSR, height, subdivision)
const SETS = ['ground:key', 'ground:draft', 'pilot_key', 'hard_case', 'propcode', 'grid', 'g_dual', 'g_secondary', 'g_mdh', 'g_fsr', 'g_height', 'g_subdiv']
const SIDE_NAMES: Record<string, string> = { P: 'CDC engine', D: 'rag engine, no model', R0: 'plain', R1: 'headers', R2: 'contextual', R3: '+ relations', L0: 'long context', R4u: 'agent, unseeded', R4: 'agent + resolver' }
const sideName = (k: string) => SIDE_NAMES[k] ?? ''
const p = (n: unknown) => n == null ? '—' : `${n}%`
const p100 = (n: unknown) => n == null ? '—' : `${Math.round(Number(n) * 100)}%`
/** a proposed answer in one line: the verdict or figure, the case split, the controlling clauses */
const ruling = (e: any) => {
  if (!e) return '—'
  const head = e.values ? Object.entries(e.values).map(([k, v]) => `${v} ${e.unit ?? ''} if ${k}`).join('; ')
    : e.values_if?.length ? e.values_if.map((x: any) => `${x.value} if ${x.if}`).join('; ')
    : [e.verdict, e.value != null ? `${e.value} ${e.unit ?? ''}` : null].filter(Boolean).join(' · ')
  return `${head || '—'}${e.controlling?.length ? ` - ${e.controlling.join(', ')}` : ''} (${e.status})`
}
</script>

<style scoped>
.rg-page { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; color: #0f172a;
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.rg-back { color: #6366f1; text-decoration: none; font-size: 12px; }
.rg-title { margin: 6px 0 4px; font-size: 26px; }
.rg-lead { margin: 0 0 18px; color: #475569; max-width: 82ch; }
.rg-muted { color: #64748b; font-size: 12px; font-weight: 400; }
.rg-err { color: #b91c1c; }
.rg-small { font-size: 12px; color: #334155; }
.rg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

.rg-progress { margin-bottom: 22px; }
.rg-bar { display: flex; height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.rg-bar-done { background: #16a34a; }
.rg-bar-doing { background: #f59e0b; }
.rg-count { color: #475569; font-size: 12px; margin: 6px 0 10px; }
.rg-phases { display: flex; flex-wrap: wrap; gap: 6px; }
.rg-phase-chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid #e2e8f0; text-decoration: none; color: #334155; background: #fff; }
.rg-phase-chip--done { background: #dcfce7; border-color: #bbf7d0; color: #14532d; }
.rg-phase-chip--doing { background: #fef3c7; border-color: #fde68a; color: #78350f; }
.rg-phase-chip--blocked { background: #fee2e2; border-color: #fecaca; color: #7f1d1d; }

.rg-section { border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 18px; }
.rg-h2 { font-size: 17px; margin: 0 0 8px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.rg-h3 { font-size: 12px; margin: 16px 0 6px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.rg-pid { font-size: 12px; background: #0f172a; color: #fff; border-radius: 4px; padding: 1px 6px; }
.rg-goal { margin: 0 0 10px; color: #475569; }

.rg-cards { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 760px) { .rg-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.rg-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #fff; }
.rg-card-n { font-size: 20px; font-weight: 700; }
.rg-card-l { font-size: 11px; color: #64748b; }

.rg-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rg-table th { text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding: 4px 6px; }
.rg-table td { border-bottom: 1px solid #f1f5f9; padding: 5px 6px; vertical-align: top; }
.rg-table .n { text-align: right; font-variant-numeric: tabular-nums; }
.rg-dim td { color: #94a3b8; }
.rg-tag { font-size: 11px; color: #475569; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
.rg-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 760px) { .rg-cols { grid-template-columns: 1fr; } }
.rg-cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 760px) { .rg-cols2 { grid-template-columns: 1fr; } }
.rg-card--warn { border-color: #fcd34d; background: #fffbeb; }
.rg-bind { margin: 8px 0; }
.rg-bind summary { cursor: pointer; font-size: 13px; }
.rg-bind .rg-table { margin-top: 6px; }
.rg-term { font-size: 11px; background: #f1f5f9; padding: 0 4px; border-radius: 3px; margin-right: 4px; }
.rg-list { margin: 0; padding-left: 18px; font-size: 13px; }
.rg-list li { margin-bottom: 3px; }

.rg-step { border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px; background: #fff; }
.rg-step--done { background: #f8fafc; }
.rg-step-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rg-status { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; letter-spacing: .03em; text-transform: uppercase; }
.rg-status--done { background: #dcfce7; color: #14532d; }
.rg-status--doing { background: #fef3c7; color: #78350f; }
.rg-status--todo { background: #f1f5f9; color: #475569; }
.rg-status--blocked { background: #fee2e2; color: #7f1d1d; }
.rg-done { margin: 5px 0 0; font-size: 13px; color: #334155; }
.rg-k { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .03em; margin-right: 4px; }
.rg-where { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 5px; }
.rg-where code { font-size: 11px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #475569; }
.rg-scroll { overflow-x: auto; }
.qb-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
.qb-chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid #e2e8f0; background: #fff; color: #334155; cursor: pointer; }
.qb-chip--on { background: #0f172a; color: #fff; border-color: #0f172a; }
.qb-search { flex: 1 1 200px; min-width: 0; font-size: 12px; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
.qb-list { border-top: 1px solid #e2e8f0; }
.qb-item { border-bottom: 1px solid #f1f5f9; }
.qb-item--open { background: #fcfcfd; }
.qb-row { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: start; text-align: left; padding: 7px 4px; border: 0; background: none; cursor: pointer; font: inherit; color: inherit; }
.qb-row:hover { background: #f8fafc; }
.qb-text { font-size: 13px; overflow-wrap: anywhere; }
.qb-sides { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: #475569; }
.qb-side b, .qb-exp { color: #0f172a; }
.qb-exp em { color: #64748b; font-style: normal; }
.qb-detail { padding: 4px 6px 12px; }
.qb-facts { font-size: 12px; color: #334155; margin: 4px 0 8px; overflow-wrap: anywhere; }
.qb-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: #fff; overflow-wrap: anywhere; }
.qb-box--exp { background: #fffbeb; border-color: #fde68a; }
.qb-box p { margin: 3px 0; }
.qb-h { font-weight: 700; font-size: 13px; }
.qb-bad { color: #b91c1c; }
@media (max-width: 760px) { .qb-row { grid-template-columns: 1fr; } .qb-sides { grid-column: 1; } }
@media (max-width: 760px) { .rg-table { display: block; overflow-x: auto; } }
.rg-list li, .rg-step, .rg-done { overflow-wrap: anywhere; }
.rg-more { font-size: 12px; padding: 5px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; cursor: pointer; }
.rg-good { color: #15803d; }
.rg-bad { color: #b91c1c; }
.rg-quote { white-space: pre-wrap; background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 6px 10px; margin: 6px 0 0; }
</style>
