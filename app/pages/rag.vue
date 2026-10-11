<!--
  /rag - the RAG pilot: where it is heading (shared/rag-plan.ts) and what schema `rag` holds right now (/api/rag/status).

  A second pilot beside the CDC session's deterministic one: the rag engine (no model) and RAG variants over the LEPs in
  scripts/rag/corpus.json and the Housing SEPP parts that reach their lots. One plan at a time (?lep=).
-->
<template>
  <div class="rg-page">
    <header class="rg-header">
      <NuxtLink to="/" class="rg-back">&larr; Home</NuxtLink>
      <h1 class="rg-title">RAG pilot</h1>
      <p class="rg-lead">
        Planning questions about real lots, answered from the text of each LEP and the Housing SEPP: by the rag engine with no
        model (<strong>D</strong>), by RAG variants that let a model write the answer (<strong>R0-R4, L0</strong>), and - for
        comparison only - by the CDC engine (<strong>P</strong>). Pick a plan; everything below is for that plan.
      </p>
    </header>

    <!-- the plan this page is about: every section below follows it (?lep= in the URL) -->
    <nav class="rg-plans" aria-label="Plan">
      <ClientOnly>
        <button type="button" class="rg-plan" :class="{ 'rg-plan--on': !plan }" @click="plan = ''">All plans</button>
        <button v-for="l in plans" :key="l" type="button" class="rg-plan" :class="{ 'rg-plan--on': plan === l }" @click="plan = l">{{ shortPlan(l) }}</button>
      </ClientOnly>
      <span class="rg-plan-links"><a href="#results">Results</a> · <a href="#questions">Questions</a> · <a href="#spatial">Spatial</a> · <a href="#pipeline">Pipeline</a> · <a href="#corpus">Corpus &amp; runs</a> · <a href="#about">About the pilot</a></span>
    </nav>


    <!-- results -->
    <section class="rg-section" id="results">
      <h2 class="rg-h2">Results <span class="rg-muted">· {{ plan ? shortPlan(plan) : 'all plans' }}</span></h2>
      <ClientOnly>
      <template v-if="status">
        <template v-if="status.score && SIDES.some(k => S(k))">
          <h3 class="rg-h3">Scores · {{ when(status.score.at) }} · against key and draft answers</h3>
          <div class="rg-scroll">
          <table class="rg-table">
            <thead><tr><th>Side</th><th class="n">Answers</th><th class="n">Scored</th><th class="n">Correct</th><th class="n">Confidently wrong</th><th class="n">Abstained</th>
              <th class="n">Cites right clause</th><th class="n">Cites resolve</th><th class="n">Quotes verbatim</th><th class="n">Figure in cited clause</th><th class="n">Unaddressed overrides</th><th class="n">$ / answer</th><th class="n">s</th></tr></thead>
            <tbody>
              <tr v-for="k in SIDES.filter(k => S(k))" :key="k">
                <td><strong>{{ k }}</strong> <span class="rg-muted">{{ sideName(k) }}</span></td>
                <td class="n">{{ S(k).answers }}</td><td class="n">{{ S(k).scored }}</td>
                <td class="n">{{ p(S(k).accuracy) }}</td>
                <td class="n" :class="{ 'rg-bad': (S(k).confidently_wrong ?? 0) >= 20 }">{{ p(S(k).confidently_wrong) }}</td>
                <td class="n">{{ p(S(k).abstained) }}</td><td class="n">{{ p(S(k).controlling) }}</td>
                <td class="n">{{ p(S(k).cites_resolved) }}</td><td class="n">{{ p(S(k).quotes_verbatim) }}</td>
                <td class="n">{{ p(S(k).figure_in_cited) }}</td><td class="n">{{ S(k).unaddressed_overrides_per_answer ?? '—' }}</td>
                <td class="n">{{ S(k).cost_per_answer ?? '—' }}</td><td class="n">{{ S(k).latency_s ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p class="rg-muted">P is the CDC session's engine (LEP pilot); it answers permissibility and subdivision only - questions it does not answer are not scored for it.
            D is the rag engine with no model (rag.claim + the evaluator). <strong>ground:key</strong> = settled answers (the pilot's keys and Manni's rulings), the independent test;
            <strong>ground:draft</strong> = Claude's draft rulings awaiting confirmation, written with the same readings D encodes, so D's score there is partly circular.
            <template v-if="plan && !S('D|hard_case')"> This plan's only keys are the CDC pilot's own (pilot.key), so P is scored against its own answers here - read P's figure as circular.</template> By set:</p>
          <div class="rg-scroll">
          <table class="rg-table">
            <thead><tr><th>Set</th><th v-for="k in setSides" :key="k" class="n">{{ k }}</th></tr></thead>
            <tbody>
              <tr v-for="s in setRows" :key="s">
                <td>{{ s }}</td>
                <td v-for="k in setSides" :key="k" class="n rg-small">
                  <template v-if="S(k + '|' + s)?.scored">{{ p(S(k + '|' + s).accuracy) }} <span class="rg-muted">/ {{ p(S(k + '|' + s).confidently_wrong) }} cw</span></template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </template>
        <p v-else class="rg-muted">No scores {{ plan ? 'for ' + shortPlan(plan) + ' ' : '' }}yet - scripts/rag/12-score.ts.</p>

        <template v-if="shownQueue.length">
          <h3 class="rg-h3">Adjudication queue · drafts for Manni to confirm or correct · most disputed first</h3>
          <article v-for="(a, i) in (showAll ? shownQueue : shownQueue.slice(0, 12))" :key="i" class="rg-step">
            <div class="rg-step-head"><span class="rg-tag">{{ a.set_name }} {{ a.clause }}</span> <span v-if="!plan && a.lep" class="rg-tag">{{ shortPlan(a.lep) }}</span> <span class="rg-small">{{ a.text }}</span></div>
            <p class="rg-done"><span class="rg-k">Proposed</span>{{ ruling(a.expected) }}
              <span v-if="a.wrong_sides?.length" class="rg-bad"> · disagree: {{ a.wrong_sides.join(', ') }}</span></p>
            <p v-if="a.expected?.trace?.length" class="rg-done rg-small"><span class="rg-k">Why</span>{{ a.expected.trace.join(' → ') }}</p>
            <details v-if="a.quote" class="rg-small"><summary>controlling words</summary><p class="rg-quote">{{ a.quote }}</p></details>
          </article>
          <button v-if="shownQueue.length > 12" class="rg-more" @click="showAll = !showAll">{{ showAll ? 'Show fewer' : `Show all ${shownQueue.length}` }}</button>
        </template>
        <p v-if="unkeyed" class="rg-muted rg-small">{{ unkeyed }} more question(s) have no expected answer yet (mostly the grid) - they are answered and shown under Questions, but there is nothing to rule on until one is drafted.</p>

        <details class="rg-fold rg-fold--inner">
          <summary>Retrieval recall and the resolver's precedence keys <span class="rg-muted">· measured across all plans</span></summary>
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

        </details>
      </template>
      </ClientOnly>
    </section>

    <!-- questions: every answer and how it was reached -->
    <section class="rg-section" id="questions">
      <h2 class="rg-h2">Questions <span class="rg-muted">· {{ plan ? shortPlan(plan) : 'all plans' }} · every side's answer and how it was reached</span></h2>
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
          <p class="rg-muted rg-small">{{ shownQs.length }} question(s)</p>
          <div v-for="x in shownQs" :key="x.id" class="qb-item" :class="{ 'qb-item--open': openQ === x.id }">
            <button type="button" class="qb-row" @click="toggleQ(x.id)">
              <span class="rg-tag">{{ x.set_name }} {{ x.clause }}</span><span v-if="!plan && x.lep" class="rg-tag rg-tag--plan">{{ shortPlan(x.lep) }}</span>
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
                          <RagClause v-if="qdetail[x.id].engine.refs?.[c]" :id="qdetail[x.id].engine.refs[c]" :p="qdetail[x.id].provisions[qdetail[x.id].engine.refs[c]]" :fallback="c" />
                          <span v-else class="rg-tag">{{ c === 'LUT' ? 'Land Use Table' : c }}</span>
                        </template>
                      </template>
                    </p>
                    <p class="rg-small">How: scripts/norms/pilot-key.ts reads the pilot's propositions for {{ qdetail[x.id].engine.plan ?? 'the LEP' }} only (the Housing SEPP is not loaded) and evaluates them on the lot.</p>
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

    <!-- spatial resolution: what the graph can test on a lot (build), and what each answer could and could not check (per lot) -->
    <section class="rg-section" id="spatial">
      <h2 class="rg-h2">Spatial resolution <span class="rg-muted">· {{ plan ? shortPlan(plan) : 'all plans' }} · resolved when the graph is built, then on each lot - and said plainly where it cannot be</span></h2>
      <ClientOnly>
      <template v-if="status?.bindings">
        <h3 class="rg-h3">1 · Building the graph: every condition a claim depends on, and how it will be tested</h3>
        <p class="rg-muted">From <code>rag.claim_binding</code> (scripts/rag/02d-bindings.ts). A condition is bound to the layers registered in
          <code>nsw.scope_layer</code> (the ones /testing-spatial-services and /cdc-map read), to a council list, or to the polygons
          of a map the clause names - <code>rag.map_polygon</code>: the plan's EPI map layers, the maps' Additional Controls
          (<code>rag.additional_controls</code>, from UrbanPortalDBP) and the resolver's map refs, the plan's own layers first; see
          "Corpus, index and runs". Anything that is not bound is listed here, and on a lot it is answered <em>maybe</em>, never assumed.
          <template v-if="plan">The Housing SEPP's conditions apply under every plan and are included.</template></p>
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
              <tr v-for="(b, i) in planBindings.filter((b: any) => b.status === s)" :key="i">
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

        <details v-if="planUnread.length" class="rg-bind">
          <summary><strong>Figures no reader took</strong> · {{ planUnread.length }} <span class="rg-muted">- a measure in the text (m, m², :1, %) that no claim
            reader turned into a claim. Most are not standards (distances, dates, dimensions); a standard among them is a sentence form to teach the readers
            (scripts/rag/02c-claims.ts) - D cannot answer from it until then.</span></summary>
          <table class="rg-table">
            <thead><tr><th>Clause</th><th>Words</th></tr></thead>
            <tbody>
              <tr v-for="(u, i) in planUnread" :key="i">
                <td class="rg-small"><a v-if="u.url" :href="u.url" target="_blank" rel="noopener">{{ u.label }}</a><span v-else>{{ u.label }}</span></td>
                <td class="rg-small">{{ u.span }}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <h3 class="rg-h3">Since the previous build</h3>
        <p v-if="!status.since?.previousBindingsAt" class="rg-muted">One build recorded so far - the next build is compared with it.</p>
        <template v-else>
          <p class="rg-muted">Build {{ when(status.since.bindingsAt) }} against {{ when(status.since.previousBindingsAt) }}: what moved{{ plan ? ' in ' + shortPlan(plan) : '' }},
            and side D's answers that changed (verdict | value | unit | values by case). Nothing listed means nothing moved.</p>
          <div class="rg-cols2">
            <div>
              <p class="rg-k">Counts that moved</p>
              <ul class="rg-list"><li v-for="(m, i) in planMoved" :key="i">{{ m.key.replace(':', ' · ') }}: {{ m.before }} → <strong>{{ m.now }}</strong><span v-if="!plan" class="rg-muted"> · {{ shortPlan(m.plan) }}</span></li></ul>
              <p v-if="!planMoved.length" class="rg-muted">None.</p>
            </div>
            <div>
              <p class="rg-k">Side D answers that changed</p>
              <ul class="rg-list"><li v-for="(a, i) in planChanged" :key="i">{{ a.text }} <span class="rg-muted">- {{ a.before }} → </span><strong>{{ a.now }}</strong></li></ul>
              <p v-if="!planChanged.length" class="rg-muted">None.</p>
            </div>
          </div>
        </template>

        <h3 class="rg-h3">Map areas and the clauses that govern them</h3>
        <p class="rg-muted">
          Each named area on a plan's maps, and every clause the build tied to it (<code>rag.area_clause</code>): directly, where a
          clause's condition names the area, or through the frame above it ("This clause applies to land identified as "Area 10" on the
          Additional Permitted Uses Map" - and so does every rule under it). Coverage (<code>rag.coverage</code>) lists what could not be
          tied together: an area on a control layer (additional permitted uses, key sites, local and special provisions, additional
          controls) that no clause read names, a clause whose area has no polygon, a condition no layer answers, a frame whose place was not
          read, a map label the EPI dump lacks, a Schedule 1 item with no permission read, and the figures above. A map read whole by a clause (the Height of Buildings Map's figure) is not listed area by area.</p>
        <div class="rg-cards">
          <div class="rg-card"><div class="rg-card-n">{{ planAreas.length }}</div><div class="rg-card-l">areas tied to a clause</div></div>
          <div v-for="k in COV_ORDER" :key="k" class="rg-card" :class="{ 'rg-card--warn': covOf(k).length }">
            <div class="rg-card-n">{{ covOf(k).length }}</div><div class="rg-card-l">{{ COV_LABEL[k] }}</div>
          </div>
        </div>
        <details v-if="planAreas.length" class="rg-bind">
          <summary><strong>Areas tied to a clause</strong> · {{ planAreas.length }}</summary>
          <table class="rg-table">
            <thead><tr><th>Map</th><th>Area</th><th>Clauses</th></tr></thead>
            <tbody>
              <tr v-for="(a, i) in planAreas" :key="i">
                <td class="rg-small">{{ a.map }}<span v-if="!plan && a.plan" class="rg-muted"> · {{ shortPlan(a.plan) }}</span></td>
                <td class="rg-small">{{ a.label }}</td>
                <td class="rg-small">
                  <div v-for="(c, j) in a.clauses" :key="j">
                    <a v-if="c.url" :href="c.url" target="_blank" rel="noopener">{{ c.label }}</a><span v-else>{{ c.label }}</span>
                    <span class="rg-muted"> - {{ c.role }}{{ c.via_frame ? ' (under the frame)' : '' }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </details>
        <details v-for="k in COV_LIST.filter(k => covOf(k).length)" :key="'c' + k" class="rg-bind">
          <summary><strong>{{ COV_LABEL[k] }}</strong> · {{ covOf(k).length }} <span class="rg-muted">- {{ COV_MEANS[k] }}</span></summary>
          <table class="rg-table">
            <thead><tr><th>Map / clause</th><th>Area</th><th>Note</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in covOf(k)" :key="i">
                <td class="rg-small">
                  <template v-if="c.map">{{ c.map }}</template>
                  <template v-if="c.label"><template v-if="c.map"> · </template><a v-if="c.url" :href="c.url" target="_blank" rel="noopener">{{ c.label }}</a><span v-else>{{ c.label }}</span></template>
                  <span v-if="!plan && c.plan" class="rg-muted"> · {{ shortPlan(c.plan) }}</span>
                </td>
                <td class="rg-small">{{ c.area ?? '' }}</td>
                <td class="rg-small">{{ c.note }}<span v-if="c.source" class="rg-muted"> · {{ c.source }}</span></td>
              </tr>
            </tbody>
          </table>
        </details>

        <h3 class="rg-h3">Against /report-2's Planning constraints</h3>
        <p v-if="!status.report2" class="rg-muted">Not compared yet - <code>npx tsx scripts/rag/16-compare-report2.ts</code> with the dev server running.</p>
        <template v-else>
          <p class="rg-muted">{{ when(status.report2.at) }}: for each lot in the question bank, the areas /api/report/additional-controls puts it in (from
            epi.additional_controls) against /api/rag/lot-controls (rag.map_polygon + rag.area_clause), on the maps report-2 reads.
            {{ status.report2.tally.lots }} lots · {{ status.report2.tally.both }} areas both see ({{ status.report2.tally.clauses_agree }} with the same clause,
            {{ status.report2.tally.clauses_differ }} citing different ones) · {{ status.report2.tally.only_report2 }} only on report-2 · {{ status.report2.tally.only_rag }} only in rag.</p>
          <table v-if="planReport2.length" class="rg-table">
            <thead><tr><th>Lot</th><th>Where they differ</th></tr></thead>
            <tbody>
              <tr v-for="l in planReport2" :key="l.cadid">
                <td class="rg-small">{{ l.address ?? l.cadid }}<span v-if="!plan && l.plan" class="rg-muted"> · {{ shortPlan(l.plan) }}</span></td>
                <td class="rg-small">
                  <div v-if="l.error" class="rg-err">{{ l.error }}</div>
                  <div v-for="(r, i) in l.rows" :key="i">{{ r.result.replace('_', ' ') }}: {{ r.map }} / {{ r.label }}
                    <span class="rg-muted">(report-2 {{ (r.report2 ?? []).join(' ') || '-' }}; rag {{ (r.rag ?? []).join(' ') || '-' }})</span></div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="rg-muted">No differences{{ plan ? ' for ' + shortPlan(plan) : '' }}.</p>
        </template>

        <h3 class="rg-h3">2 · Deciding on each lot</h3>
        <template v-if="LC">
          <p class="rg-muted">
            Of side D's {{ LC.answers }} answers, {{ LC.with_checked }} tested at least one condition against lot data and
            <strong>{{ LC.with_unchecked }}</strong> rest on a condition no data could settle - those say so in their trace
            ("Could not check") and the answer is <em>maybe</em> on that point, not assumed.</p>
          <div class="rg-cols2">
            <div>
              <p class="rg-k">Could not check · questions affected</p>
              <ul class="rg-list"><li v-for="(c, i) in LC.unchecked" :key="i">{{ c.text }} <span class="rg-muted">- {{ c.how }} · {{ c.n }}</span></li></ul>
              <p v-if="!LC.unchecked.length" class="rg-muted">None.</p>
            </div>
            <div>
              <p class="rg-k">Checked against data · yes / no across answers</p>
              <ul class="rg-list"><li v-for="(c, i) in LC.checked.slice(0, 25)" :key="i">{{ c.text }} <span class="rg-muted">· {{ c.yes }} yes / {{ c.no }} no</span></li></ul>
            </div>
          </div>
        </template>
      </template>
      </ClientOnly>
    </section>

    <!-- the pipeline itself: every stage, what it makes, from what, and whether a model is involved -->
    <section class="rg-section" id="pipeline">
      <h2 class="rg-h2">Pipeline <span class="rg-muted">· every plan · scripts/rag/run.ts, stage by stage - what each makes, from what, and whether a model is involved</span></h2>
      <p class="rg-goal">
        The default run calls <strong>no model</strong>: the law is read into data (claims, relations, bindings), side D answers
        every question from that data, and the answers are scored against keys D never reads. A model appears only in the
        opt-in comparison lane (<code>--with-llm-variants</code>) - the RAG variants R0-R4 and L0, which were the
        comparison, not the answer. A full rebuild of five plans takes about 17 minutes, 14 of them building the question
        bank's lot facts.
      </p>

      <h3 class="rg-h3">Build and check</h3>
      <div class="pl-scroll">
        <svg class="pl-svg" viewBox="0 0 1000 545" role="img" aria-label="The rag pipeline: sources, the graph build, side D's answers, the keys and the score, and the opt-in model lane">
          <defs>
            <marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b" /></marker>
            <marker id="pl-arrow-paid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d97706" /></marker>
          </defs>
          <text v-for="c in PL_COLS" :key="c.t" :x="c.x" y="30" class="pl-col">{{ c.t }}</text>
          <path v-for="(e, i) in plEdges" :key="i" :d="e.d" class="pl-edge" :class="{ 'pl-edge--paid': e.paid, 'pl-edge--test': e.test }" :marker-end="`url(#${e.paid ? 'pl-arrow-paid' : 'pl-arrow'})`" />
          <g v-for="n in PL_NODES" :key="n.id" :class="'pl-node pl-node--' + n.kind">
            <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="7" />
            <text :x="n.x + 9" :y="n.y + 18" class="pl-t">{{ n.t }}</text>
            <text v-for="(l, i) in n.lines" :key="i" :x="n.x + 9" :y="n.y + 33 + i * 13" class="pl-l">{{ l }}</text>
            <text v-if="n.out" :x="n.x + 9" :y="n.y + n.h - 7" class="pl-o">{{ n.out }}</text>
          </g>
          <text x="455" y="460" class="pl-lane">Opt-in, paid - the comparison only (--with-llm-variants)</text>
        </svg>
      </div>
      <p class="pl-legend">
        <span class="pl-key pl-key--src" /> source data, loaded before the pipeline
        <span class="pl-key pl-key--det" /> no model
        <span class="pl-key pl-key--test" /> the test: keys and scores, from sources D does not read
        <span class="pl-key pl-key--paid" /> calls a paid model, only when asked for
      </p>

      <h3 class="rg-h3">How side D answers one question</h3>
      <ol class="pl-flow">
        <li v-for="s in PL_ANSWER" :key="s.t"><strong>{{ s.t }}</strong><span>{{ s.d }}</span></li>
      </ol>

      <h3 class="rg-h3">Every stage</h3>
      <table class="rg-table pl-table">
        <thead><tr><th>#</th><th>Stage</th><th>What it makes, and how</th><th>Reads</th><th>Writes</th><th>Model</th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in PL_STAGES" :key="s.id" :class="{ 'pl-row--paid': s.model.includes('paid') }">
            <td class="n">{{ i + 1 }}</td>
            <td><code>{{ s.id }}</code><br><span class="rg-muted">{{ s.script }}</span><span v-if="s.optIn" class="rg-tag pl-opt">{{ s.optIn }}</span></td>
            <td class="rg-small">{{ s.what }}</td>
            <td class="rg-small">{{ s.reads }}</td>
            <td class="rg-small rg-mono">{{ s.writes }}</td>
            <td class="rg-small"><span :class="s.model.includes('paid') ? 'pl-paid' : 'pl-none'">{{ s.model }}</span></td>
          </tr>
        </tbody>
      </table>
      <p class="rg-muted">
        Where Claude took part outside the run: the grid's draft expectations (<code>11-grid-drafts.ts</code>) and the edge cases
        (<code>scripts/rag/edge-keys.json</code>) were written by Claude in the session, from the clause words, and are stored as
        data - they are drafts until confirmed, and no model is called when they are loaded or scored.
      </p>
    </section>

    <!-- corpus, index and runs (every plan): folded -->
    <details id="corpus" class="rg-section rg-fold">
      <summary class="rg-h2">Corpus, index and runs <span class="rg-muted" v-if="status">· every plan · measured {{ when(status.measuredAt) }} in {{ status.ms }} ms</span></summary>
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

        <h3 class="rg-h3">Map areas held <span class="rg-muted">- the polygons a map condition is tested against (rag.map_polygon){{ plan ? ' · ' + shortPlan(plan) : '' }}</span></h3>
        <table class="rg-table">
          <thead><tr><th>Plan</th><th>From</th><th class="n">Maps</th><th class="n">Labels</th><th class="n">Polygons</th></tr></thead>
          <tbody>
            <tr v-for="(m, i) in (status.mapSources ?? []).filter((m: any) => !plan || m.plan === plan || m.kind !== 'lep')" :key="i">
              <td class="rg-small">{{ shortPlan(m.plan) }}</td><td class="rg-small">{{ m.family }}</td>
              <td class="n">{{ fmt(m.maps) }}</td><td class="n">{{ fmt(m.labels) }}</td><td class="n">{{ fmt(m.polygons) }}</td>
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
    </details>

    <!-- the pilot itself: progress, phases, scope, variants, decisions, open questions - folded -->
    <details id="about" class="rg-section rg-fold">
      <summary class="rg-h2">About the pilot <span class="rg-muted">· plan updated {{ RAG_UPDATED }} · {{ stepCount.done }} of {{ stepCount.all }} steps done</span></summary>
    <section class="rg-progress">
      <div class="rg-bar"><div class="rg-bar-done" :style="{ width: pct + '%' }" /><div class="rg-bar-doing" :style="{ width: pctDoing + '%' }" /></div>
      <p class="rg-count">{{ stepCount.done }} of {{ stepCount.all }} steps done · {{ stepCount.doing }} in progress · {{ stepCount.blocked }} blocked</p>
      <nav class="rg-phases">
        <a v-for="p in RAG_PHASES" :key="p.id" :href="'#' + p.id" class="rg-phase-chip" :class="'rg-phase-chip--' + phaseState(p)">
          <strong>{{ p.id }}</strong> {{ p.title }}
        </a>
      </nav>
    </section>

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
    </details>
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
// the plan the page shows (?lep=<LEP title>, empty = all plans): scores, adjudication, questions and spatial follow it
const route = useRoute(), router = useRouter()
const plan = computed<string>({
  get: () => String(route.query.lep ?? ''),
  set: (v: string) => { router.replace({ query: { ...route.query, lep: v || undefined }, hash: route.hash }) },
})
const plans = computed(() => (status.value?.instruments ?? []).filter((i: any) => i.kind === 'lep').map((i: any) => String(i.title)) as string[])
const shortPlan = (t: string) => String(t).replace(/ Local Environmental Plan (\d{4})$/, ' LEP $1')
/** a score row for the plan shown (12-score.ts keys every row per plan as "<key>@<LEP title>") */
const S = (k: string) => status.value?.score?.summary?.[plan.value ? `${k}@${plan.value}` : k]
/** a SEPP's bindings (plan null) apply under every plan */
const planBindings = computed(() => (status.value?.bindings ?? []).filter((b: any) => !plan.value || !b.plan || b.plan === plan.value))
const LC = computed(() => status.value?.lotChecks?.[plan.value] ?? null)
const planReport2 = computed(() => (status.value?.report2?.lots ?? []).filter((l: any) => !plan.value || l.plan === plan.value))
const planMoved = computed(() => (status.value?.since?.moved ?? []).filter((m: any) => !plan.value || !m.plan || m.plan === plan.value))
const planChanged = computed(() => (status.value?.since?.changedAnswers ?? []).filter((a: any) => !plan.value || !a.lep || a.lep === plan.value))
const planAreas = computed(() => (status.value?.areaClauses ?? []).filter((a: any) => !plan.value || !a.plan || a.plan === plan.value))
const COV_ORDER = ['text_changed_since', 'map_newer_than_text', 'area_no_clause', 'clause_no_polygon', 'condition_no_layer', 'frame_unscoped', 'label_not_in_epi', 'schedule_item_unread', 'figure_unread'] as const
const COV_LIST = ['text_changed_since', 'map_newer_than_text', 'area_no_clause', 'clause_no_polygon', 'condition_no_layer', 'frame_unscoped', 'label_not_in_epi', 'schedule_item_unread'] as const
const COV_LABEL: Record<string, string> = { area_no_clause: 'control areas no clause read names', clause_no_polygon: 'clauses whose area has no polygon',
  text_changed_since: 'clauses changed since the text', map_newer_than_text: 'maps amended after the text',
  condition_no_layer: 'conditions no layer answers', frame_unscoped: 'frames whose place was not read', label_not_in_epi: 'map labels missing from the EPI dump',
  schedule_item_unread: 'Schedule 1 items with no permission read', figure_unread: 'figures no reader took' }
const COV_MEANS: Record<string, string> = {
  area_no_clause: 'the note says whether a provision names the area in its words (a reader to teach) or none does (the map\'s own legend, or a clause outside the corpus)',
  clause_no_polygon: 'the clause names an area, but no layer holds a polygon with that label - on a lot it is answered maybe',
  text_changed_since: 'the instrument in force today differs from the version the corpus holds (scripts/rag/01d-currency.py) - these clauses are added, changed or removed since; answers resting on them may be out of date until the corpus is re-snapshotted',
  map_newer_than_text: 'a map layer amended after the date the text is as at - the amendment that redrew it may have changed clauses the corpus does not hold',
  condition_no_layer: 'a condition of a claim no registered layer matches (or one registered with no dataset) - on a lot it is "could not check" and the answer is maybe on it',
  frame_unscoped: 'a frame ("This Part applies to ...") whose place the readers did not read - every rule under it is unknown on every lot',
  label_not_in_epi: 'a map label only the Additional Controls or a resolver map ref draws, not the plan’s EPI map layer - a gap in the EPI dump, filled from the other source',
  schedule_item_unread: 'an item with words but no permission claim - its use is not found on any lot',
  figure_unread: 'listed above' }
const covOf = (k: string) => (status.value?.coverage ?? []).filter((c: any) => c.check === k && (!plan.value || !c.plan || c.plan === plan.value))
const planUnread = computed(() => (status.value?.unreadFigures ?? []).filter((u: any) => !plan.value || !u.plan || u.plan === plan.value))
// the queue shows what there is to rule on - a draft or a key some side disagrees with; a question with no proposed
// answer yet is only counted
const planQueue = computed(() => (status.value?.queue ?? []).filter((a: any) => !plan.value || a.lep === plan.value))
const shownQueue = computed(() => planQueue.value.filter((a: any) => a.expected?.status && a.expected.status !== 'none'))
const unkeyed = computed(() => planQueue.value.length - shownQueue.value.length)
const bindCount = (s: string) => planBindings.value.filter((b: any) => b.status === s).length

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

// ── the pipeline section: one diagram (boxes and the edges between them) and the stage table, as scripts/rag/run.ts runs it
type PlNode = { id: string; kind: 'src' | 'det' | 'test' | 'paid'; x: number; y: number; w: number; h: number; t: string; lines: string[]; out?: string }
const PL_COLS = [{ x: 10, t: 'Sources' }, { x: 215, t: 'Build the graph' }, { x: 455, t: 'Answer' }, { x: 720, t: 'Check' }]
const PL_NODES: PlNode[] = [
  { id: 'struct', kind: 'src', x: 10, y: 45, w: 180, h: 62, t: 'Plan structure', lines: ["each LEP's tree, from the XML"], out: 'pilot.node · nsw.section' },
  { id: 'xml', kind: 'src', x: 10, y: 117, w: 180, h: 62, t: 'Legislation XML', lines: ['as at its date, and today’s'], out: 'legislation.nsw.gov.au' },
  { id: 'lut', kind: 'src', x: 10, y: 189, w: 180, h: 62, t: 'Land Use Tables', lines: ['every zone x use, resolved'], out: 'nsw.lep_permissibility' },
  { id: 'maps', kind: 'src', x: 10, y: 261, w: 180, h: 88, t: 'Maps and lots', lines: ['EPI map layers, additional', 'controls, cadastre, frontage'], out: 'epi.* · cadastre · derived' },
  { id: 'snap', kind: 'det', x: 215, y: 45, w: 215, h: 60, t: 'snapshot', lines: ['each plan’s provisions'], out: 'rag.instrument · rag.provision' },
  { id: 'cur', kind: 'det', x: 215, y: 111, w: 215, h: 60, t: 'currency · groups · terms', lines: ['still the law? zones, definitions'], out: 'rag.coverage · rag.provision' },
  { id: 'rel', kind: 'det', x: 215, y: 177, w: 215, h: 60, t: 'relations', lines: ['despite, subject to, applies if'], out: 'rag.relation' },
  { id: 'claims', kind: 'det', x: 215, y: 243, w: 215, h: 60, t: 'claims (twice)', lines: ['what each sentence says, as data'], out: 'rag.claim · rag.unread' },
  { id: 'bind', kind: 'det', x: 215, y: 309, w: 215, h: 60, t: 'bindings', lines: ['how each condition meets a lot'], out: 'rag.claim_binding · map_polygon' },
  { id: 'chunks', kind: 'det', x: 215, y: 375, w: 215, h: 60, t: 'chunks', lines: ['text for the model lane below'], out: 'rag.chunk' },
  { id: 'q', kind: 'det', x: 455, y: 45, w: 240, h: 76, t: 'Question bank', lines: ['real lots, facts frozen: zone, area,', 'frontage, map areas · 9 sets'], out: 'rag.question' },
  { id: 'd', kind: 'det', x: 455, y: 150, w: 240, h: 102, t: 'Side D - the rag engine', lines: ['the claims that reach the lot, each', 'condition tested, precedence', 'resolved, limits applied'], out: 'rag.answer (variant D)' },
  { id: 'r', kind: 'test', x: 455, y: 285, w: 240, h: 62, t: 'Resolver check', lines: ['12 precedence cases, no clause named'], out: 'rag.run' },
  { id: 'k', kind: 'test', x: 720, y: 45, w: 270, h: 128, t: 'Answer keys and expectations', lines: ['Land Use Table: the legislation XML', 'zoning, height, FSR, lot size: the', 'live Planning Portal map', 'your pilot keys; Claude’s drafts and', 'edge cases (drafts until confirmed)'], out: 'rag.key · rag.question.expected' },
  { id: 's', kind: 'test', x: 720, y: 205, w: 270, h: 90, t: 'Score', lines: ['each side against the keys, per plan;', 'disagreements queued to rule on'], out: 'rag.adjudication · Results above' },
  { id: 'ctx', kind: 'paid', x: 215, y: 470, w: 215, h: 62, t: 'context', lines: ['a model sums up each chunk'], out: 'Claude Haiku 4.5 / Llama' },
  { id: 'emb', kind: 'paid', x: 455, y: 470, w: 112, h: 62, t: 'embed', lines: ['chunk vectors'], out: 'bge-en-icl' },
  { id: 'ret', kind: 'paid', x: 583, y: 470, w: 112, h: 62, t: 'retrieval', lines: ['recall'], out: 'bge-en-icl' },
  { id: 'ans', kind: 'paid', x: 720, y: 470, w: 270, h: 62, t: 'answers R0-R4, L0', lines: ['a model writes the answer from chunks'], out: 'Claude Haiku 4.5 (never Sonnet)' },
]
const plNode = Object.fromEntries(PL_NODES.map(n => [n.id, n]))
const plR = (n: PlNode) => [n.x + n.w, n.y + n.h / 2], plL = (n: PlNode) => [n.x, n.y + n.h / 2]
const plT = (n: PlNode) => [n.x + n.w / 2, n.y], plB = (n: PlNode) => [n.x + n.w / 2, n.y + n.h]
const plCurve = (a: number[], b: number[], horizontal: boolean) => horizontal
  ? `M${a[0]},${a[1]} C${a[0]! + 20},${a[1]} ${b[0]! - 20},${b[1]} ${b[0]},${b[1]}`
  : `M${a[0]},${a[1]} L${b[0]},${b[1]}`
const plEdges = ([
  ['struct', 'snap', 'h'], ['xml', 'cur', 'h'], ['lut', 'claims', 'h'], ['maps', 'bind', 'h'],
  ['snap', 'cur', 'v'], ['cur', 'rel', 'v'], ['rel', 'claims', 'v'], ['claims', 'bind', 'v'],
  ['rel', 'd', 'h'], ['claims', 'd', 'h'], ['bind', 'd', 'h'], ['q', 'd', 'v'], ['r', 'd', 'up'],
  ['d', 's', 'h'], ['k', 's', 'v'],
  ['chunks', 'ctx', 'v', 'paid'], ['ctx', 'emb', 'h', 'paid'], ['emb', 'ret', 'h', 'paid'], ['ret', 'ans', 'h', 'paid'], ['ans', 's', 'up', 'paid'],
] as [string, string, string, string?][]).map(([a, b, how, paid]) => {
  const A = plNode[a]!, B = plNode[b]!
  return { paid: !!paid, test: a === 'r', d: how === 'h' ? plCurve(plR(A), plL(B), true) : how === 'up' ? plCurve(plT(A), plB(B), false) : plCurve(plB(A), plT(B), false) }
})
const PL_ANSWER = [
  { t: 'Read the question', d: 'its use, the instrument it asks under ("Under Hornsby LEP 2013, ..."), the pathway and code ("as complying development under the Housing Code"), the topic, the title type and number of lots - from its words' },
  { t: 'The lot’s facts', d: 'zone, area, primary frontage, and every map area with the share of the lot inside it - frozen when the question was built' },
  { t: 'The claims that could answer it', d: 'every permission, prohibition and standard on that use in that plan and the SEPP; a zone’s catch-all only where the zone does not list the use' },
  { t: 'Does each reach this lot', d: 'each condition through its binding - the zone, a map area (90% of the lot inside), a layer, a Schedule 1 lot, or a fact of the proposal / the consent authority’s judgement: yes, no or unknown' },
  { t: 'Which one wins', d: 'the resolver: the law’s own words first (despite, subject to, does not apply), then a SEPP over the LEP, specific over general, a consent bar over a permission; an unknown splits the answer into cases' },
  { t: 'What limits it', d: 'the standards on the use that reach the lot (lot size, width, FSR, height) and the conditions it stays subject to; a lot that fails a minimum lot size or width is "no, unless varied under cl 4.6"' },
  { t: 'The answer', d: 'yes / no / maybe or a figure, the clauses that control it, and every condition that could not be checked - stored as variant D and scored against the keys' },
]
const PL_STAGES = [
  { id: 'controls', script: '01c-additional-controls.py', optIn: '--refresh-controls', what: 'Copies the maps’ additional controls (APU, key sites, local provisions ...) so a clause’s map area has a polygon', reads: 'UrbanPortalDBP AdditionalControls_* (over SSH)', writes: 'rag.additional_controls', model: 'none' },
  { id: 'snapshot', script: '01-snapshot.ts', what: 'Copies each instrument’s provisions - stems, list items with their and / or, tables as rows and cells; replaces only one whose text changed. The LEPs and the Codes SEPP come whole from the pilot tree (its tables kept); the Housing SEPP’s parts in scope from nsw.section', reads: 'pilot.node (LEPs, Codes SEPP), nsw.section (Housing SEPP parts in scope)', writes: 'rag.instrument, rag.provision', model: 'none' },
  { id: 'currency', script: '01d-currency.py', what: 'Is the text still the law: compares the held version with today’s and lists clauses added, changed or removed since', reads: 'legislation XML (held date and today)', writes: 'rag.coverage', model: 'none' },
  { id: 'groups', script: '01b-groups.py', what: 'Land Use Table zones and other clause groups, from the XML’s structure', reads: 'legislation XML', writes: 'rag.provision', model: 'none' },
  { id: 'terms', script: '02a-terms.py', what: 'Every definition as its own provision (the Dictionary and "In this clause-" terms)', reads: 'legislation XML', writes: 'rag.provision (kind term)', model: 'none' },
  { id: 'claims-pre', script: '02c-claims.ts', what: 'Claims, first pass - the standards cl 4.6 and the relations need', reads: 'rag.provision, nsw.lep_permissibility', writes: 'rag.claim', model: 'none' },
  { id: 'relations', script: '02-relations.ts', what: 'The law’s own logic as data: despite, subject to, applies only if, does not apply, refers to, defines, prevails over', reads: 'rag.provision, rag.claim', writes: 'rag.relation, rag.unread', model: 'none' },
  { id: 'claims', script: '02c-claims.ts', what: 'Claims, read sentence by sentence by drafting pattern - permit, prohibit, standard, condition, frame - each with its uses, zones and terms; the figures no reader took are listed', reads: 'rag.provision, rag.relation, nsw.lep_permissibility', writes: 'rag.claim, rag.unread', model: 'none' },
  { id: 'bindings', script: '02d-bindings.ts', what: 'How each condition is tested on a lot: a zone, a map label’s polygons, a registered layer, a council list - or why it cannot be (no data, no polygon, a fact of the proposal, discretion)', reads: 'rag.claim, epi.* layers, rag.additional_controls, nsw.scope_layer, nsw.rule_spatial_ref', writes: 'rag.map_polygon, rag.claim_binding, rag.area_clause, rag.coverage', model: 'none' },
  { id: 'chunks', script: '03-chunks.ts', what: 'Retrieval chunks of the text - used only by the model lane; unchanged chunks keep their embeddings', reads: 'rag.provision', writes: 'rag.chunk', model: 'none' },
  { id: 'context', script: '04-context.ts', optIn: '--with-llm-variants', what: 'A model-written context sentence per chunk (contextual retrieval, variant R2)', reads: 'rag.chunk', writes: 'rag.chunk (context)', model: 'Claude Haiku 4.5, or Llama 3.3 on DeepInfra - paid' },
  { id: 'embed', script: '05-embed.ts', optIn: '--with-llm-variants', what: 'Embeddings for chunks without one', reads: 'rag.chunk', writes: 'rag.embedding', model: 'bge-en-icl on DeepInfra - paid' },
  { id: 'keys', script: '06a-keys.py', what: 'Answer keys from sources D does not read: permissibility from the Land Use Table in the legislation XML (uses another clause governs are left out), and zoning, height, FSR and lot size from the live Planning Portal map', reads: 'legislation XML, Planning Portal MapServer, cadastre.lot, epi.*', writes: 'rag.key', model: 'none' },
  { id: 'keys-codes', script: '06b-keys-codes.py', what: 'The complying development codes’ keys on the same lots: the cl 1.19 land exclusions the Planning Portal services draw (heritage, bushfire, flood, acid sulfate soils, foreshore, landslide, reserved land, environmentally sensitive land, drinking water catchment), the Housing Code’s lot requirements, and its standards for a dwelling house computed from the XML tables by the lot’s area and width', reads: 'legislation XML, Planning Portal Principal Planning / Hazard / Protection services, cadastre.lot, derived.lot_profile', writes: 'rag.key', model: 'none' },
  { id: 'questions', script: '06-questions.ts', what: 'The question bank, per plan: real lots with frozen facts; sets key_lut, key_map, key_cdc_land, key_cdc, pilot_key, hard_case, propcode, local, grid, area (derived) and edge', reads: 'rag.key, pilot.key, edge-keys.json, cadastre.lot, epi.*, rag.map_polygon', writes: 'rag.question', model: 'none' },
  { id: 'drafts', script: '11-grid-drafts.ts', what: 'Claude’s draft expectations for the grid, kept as code so a corrected reading is re-applied everywhere', reads: 'rag.question', writes: 'rag.question (expected)', model: 'none at run time' },
  { id: 'engine', script: '07-engine.ts', optIn: '--with-pilot', what: 'Side P, for comparison only: the CDC engine on each question’s plan (slow: one run per question)', reads: 'the CDC pilot', writes: 'rag.engine_answer', model: 'none' },
  { id: 'resolver', script: '08-resolver-check.ts', what: 'The precedence keys: does the resolver reach the ruled answer by the right rule, given only the claims and the relations', reads: 'rag.relation, fixtures', writes: 'rag.run', model: 'none' },
  { id: 'deterministic', script: '15-deterministic.ts', what: 'Side D answers every question: the claims, their bindings on the lot’s facts, the resolver, the limits', reads: 'rag.claim, rag.claim_binding, rag.relation, rag.question', writes: 'rag.answer (D)', model: 'none' },
  { id: 'retrieval', script: '09-retrieval.ts', optIn: '--with-llm-variants', what: 'Retrieval recall per variant (embeds the questions)', reads: 'rag.question, rag.embedding', writes: 'rag.run', model: 'bge-en-icl on DeepInfra - paid' },
  { id: 'answers', script: '10-answer.ts', optIn: '--with-llm-variants', what: 'The RAG variants R0-R4 and L0: a model reads the retrieved chunks and writes the answer (spend capped per stage)', reads: 'rag.question, rag.chunk, rag.embedding', writes: 'rag.answer (R0-R4, L0)', model: 'Claude Haiku 4.5 by default - paid; never Sonnet' },
  { id: 'score', script: '12-score.ts', what: 'Every side against the keys, per plan and per set; a key or draft some side disagrees with goes to the queue', reads: 'rag.answer, rag.question', writes: 'rag.adjudication, the Results above', model: 'none' },
]

// the question browser: the list once, each question's full answer on demand
const QSETS = [{ id: 'all', label: 'All' }, { id: 'hard_case', label: 'Hard cases' }, { id: 'local', label: 'Additional uses & local controls' },
  { id: 'propcode', label: 'PropCode claims' }, { id: 'pilot_key', label: 'Pilot keys' }, { id: 'grid', label: 'Grid' }]
const qset = ref('all'), qsearch = ref(''), openQ = ref<string | null>(null)
const qdetail = reactive<Record<string, any>>({})
const { data: qlist } = useFetch<any[]>('/api/rag/questions', { server: false, lazy: true })
const shownQs = computed(() => (qlist.value ?? []).filter((x: any) => (qset.value === 'all' || x.set_name === qset.value) && (!plan.value || x.lep === plan.value)
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
/** the by-set table shows only the sets and sides that have a score for the plan shown */
const setRows = computed(() => SETS.filter(st => SIDES.some(k => S(`${k}|${st}`)?.scored)))
const setSides = computed(() => SIDES.filter(k => SETS.some(st => S(`${k}|${st}`)?.scored)))
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
.rg-plans { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0 8px; padding: 8px 0;
  background: #fff; border-bottom: 1px solid #e2e8f0; }
.rg-plan { border: 1px solid #cbd5e1; background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 13px; cursor: pointer; color: #0f172a; }
.rg-plan--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.rg-plan-links { margin-left: auto; font-size: 12px; color: #64748b; }
.rg-plan-links a { color: #6366f1; text-decoration: none; }
@media (max-width: 760px) { .rg-plan-links { margin-left: 0; width: 100%; } }
.rg-fold > summary { cursor: pointer; list-style: revert; }
.rg-fold--inner { margin: 14px 0 4px; }
.rg-fold--inner > summary { font-size: 13px; font-weight: 600; color: #334155; }
.rg-tag--plan { background: #eef2ff; color: #3730a3; }
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
/* the pipeline diagram: a fixed drawing, scrolled sideways on a phone rather than shrunk past reading */
.pl-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #e2e8f0; border-radius: 8px; background: #fcfcfd; }
.pl-svg { display: block; width: 100%; min-width: 760px; height: auto; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.pl-col { font-size: 11px; font-weight: 700; fill: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.pl-lane { font-size: 11px; font-weight: 700; fill: #b45309; text-transform: uppercase; letter-spacing: .05em; }
.pl-node rect { stroke-width: 1.2; }
.pl-node--src rect { fill: #f1f5f9; stroke: #94a3b8; }
.pl-node--det rect { fill: #ecfdf5; stroke: #10b981; }
.pl-node--test rect { fill: #eef2ff; stroke: #6366f1; }
.pl-node--paid rect { fill: #fffbeb; stroke: #f59e0b; stroke-dasharray: 5 3; }
.pl-t { font-size: 12.5px; font-weight: 700; fill: #0f172a; }
.pl-l { font-size: 11px; fill: #334155; }
.pl-o { font-size: 9.5px; fill: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.pl-edge { fill: none; stroke: #94a3b8; stroke-width: 1.4; }
.pl-edge--paid { stroke: #f59e0b; stroke-dasharray: 5 3; }
.pl-edge--test { stroke-dasharray: 2 3; }
.pl-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; font-size: 12px; color: #475569; margin: 8px 0 0; }
.pl-key { display: inline-block; width: 14px; height: 10px; border-radius: 3px; border: 1.2px solid; vertical-align: -1px; margin-right: 5px; }
.pl-key--src { background: #f1f5f9; border-color: #94a3b8; }
.pl-key--det { background: #ecfdf5; border-color: #10b981; }
.pl-key--test { background: #eef2ff; border-color: #6366f1; }
.pl-key--paid { background: #fffbeb; border-color: #f59e0b; border-style: dashed; }
.pl-flow { counter-reset: pl; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.pl-flow li { counter-increment: pl; position: relative; border: 1px solid #a7f3d0; background: #f0fdf4; border-radius: 8px; padding: 8px 10px 9px 34px; font-size: 12.5px; overflow-wrap: anywhere; }
.pl-flow li::before { content: counter(pl); position: absolute; left: 9px; top: 8px; width: 18px; height: 18px; border-radius: 50%; background: #10b981; color: #fff; font-size: 11px; font-weight: 700; text-align: center; line-height: 18px; }
.pl-flow strong { display: block; color: #064e3b; margin-bottom: 2px; }
.pl-flow span { color: #334155; }
.pl-table code { font-size: 12px; }
.pl-opt { display: inline-block; margin-top: 3px; background: #fef3c7; color: #92400e; }
.pl-row--paid td { background: #fffbeb; }
.pl-none { color: #15803d; font-weight: 600; }
.pl-paid { color: #b45309; font-weight: 600; }
.rg-quote { white-space: pre-wrap; background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 6px 10px; margin: 6px 0 0; }
</style>
