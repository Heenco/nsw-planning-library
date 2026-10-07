<!--
  "Subdivision" - can this lot be subdivided, and which kind? (/api/norms/subdivision, docs/norms-trial.md)

  Torrens, strata and community title, each Yes / No / Maybe through one engine over the subdivision norms (Housing SEPP
  + the lot's LEP). A Maybe always says what it turns on, by who can answer it: you (what is on the lot, what the new
  lots are for), our data, the council, or a condition not yet machine-readable. The questions are ranked by how many
  answers they change, and only those that change something are asked. Standards come with the lot's own arithmetic.
  The plan's subdivision clauses that are not yet encoded are listed - a Yes never hides a clause nobody read.
-->
<template>
  <div class="sd">
    <p v-if="error" class="sd-error">{{ error }}</p>
    <p v-else-if="!data" class="sd-dim">Loading&hellip;</p>
    <template v-else>
      <p class="sd-note">
        Zone {{ data.lot.zone || 'unknown' }} &middot; {{ data.lot.areaM2?.toLocaleString() }} m²
        &middot; frontage {{ data.lot.frontageM == null ? 'unknown' : data.lot.frontageM.toFixed(1) + ' m' }}
        &middot; Lot Size Map: {{ data.lot.onLotSizeMap === true ? data.lot.lotSizeMinM2 + ' m²' : data.lot.onLotSizeMap === false ? 'not on it (our copy)' : 'not held' }}
        <template v-if="data.lot.strata"> &middot; already a strata lot ({{ data.lot.lotId }})</template>
        <span class="sd-dim">&middot; {{ data.ms }} ms</span>
      </p>
      <p v-if="!data.lepCovered" class="sd-warn">{{ data.lot.epi || 'This lot\'s LEP' }} is not in the graph yet - only the Housing SEPP's subdivision clauses are tested.</p>

      <div class="sd-ask">
        <label class="sd-label" for="sd-purpose">New lots for</label>
        <select id="sd-purpose" v-model="purpose" class="sd-select">
          <option value="">not stated</option>
          <option value="dwelling house">dwelling houses</option>
          <option value="dual occupancy">a dual occupancy (one dwelling per lot)</option>
          <option value="multi dwelling housing (terraces)">terraces (one per lot)</option>
        </select>
        <label class="sd-label" for="sd-lots">Torrens lots</label>
        <input id="sd-lots" v-model.number="lots" type="number" min="2" max="20" class="sd-num">
      </div>

      <div class="sd-scroll">
        <table class="sd-table">
          <thead><tr><th>Kind</th><th>Answer</th><th>Because</th><th>Depends on</th><th>Standards</th></tr></thead>
          <tbody>
            <tr v-for="k in data.kinds" :key="k.key">
              <td><strong>{{ k.label }}</strong></td>
              <td>
                <span class="sd-badge" :class="`sd-badge--${k.answer}`">{{ k.answer === 'yes' ? 'Yes' : k.answer === 'no' ? 'No' : 'Maybe' }}</span>
                <!-- permissible, but a standard the lot cannot meet: a development standard is varied under cl 4.6, a
                     non-discretionary one lets the council ask for more - either way, not a plain yes -->
                <div v-if="k.answer !== 'no' && k.standards.some((s: any) => s.holds === false)" class="sd-caveat">
                  but {{ k.standards.filter((s: any) => s.holds === false).map((s: any) => s.clause).join(', ') }} not met
                  <span class="sd-dim">{{ k.standards.some((s: any) => s.holds === false && /development standard/.test(s.standard)) ? '- needs a cl 4.6 variation' : '' }}</span>
                </div>
              </td>
              <td class="sd-wrap">
                <template v-if="k.controlling.length">
                  <template v-for="(c, i) in k.controlling" :key="c.id">
                    <span v-if="i">, </span>
                    <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="sd-link">{{ short(c.instrument) }} {{ isSepp(c.instrument) ? 's' : 'cl' }} {{ c.clause }}</a>
                    <template v-else>{{ short(c.instrument) }} {{ c.clause }}</template>
                  </template>
                  <span class="sd-dim">{{ k.outcome === 'prohibited' ? ' bars it' : k.pathway ? ' - ' + k.pathway.replace(/_/g, ' ') : '' }}</span>
                </template>
                <span v-else class="sd-dim">no clause permits it</span>
              </td>
              <td class="sd-wrap">
                <span v-if="!k.dependsOn.length" class="sd-dim">nothing open</span>
                <!-- compact: who can answer + the clauses; the questions themselves are listed (ranked) below the table -->
                <details v-else>
                  <summary>
                    <template v-for="(g, i) in groups(k.dependsOn)" :key="i">
                      <span class="sd-who" :class="`sd-who--${g.who}`">{{ WHO[g.who] }}</span>
                      <span class="sd-clauses">{{ [...new Set(g.items.map((d: any) => d.clause))].join(', ') }}</span>
                    </template>
                  </summary>
                  <ul class="sd-list sd-why">
                    <li v-for="(d, j) in k.dependsOn" :key="j">
                      <a v-if="d.url" :href="d.url" target="_blank" rel="noopener" class="sd-link">{{ d.clause }}</a><template v-else>{{ d.clause }}</template>: {{ d.why }}
                    </li>
                  </ul>
                </details>
              </td>
              <td class="sd-wrap">
                <span v-if="!k.standards.length" class="sd-dim">&mdash;</span>
                <ul v-else class="sd-list">
                  <li v-for="s in k.standards" :key="s.id">
                    <span class="sd-gate" :class="`sd-gate--${s.displacedBy ? 'off' : s.holds === true ? 'yes' : s.holds === false ? 'no' : 'open'}`">{{ s.displacedBy ? 'displaced' : s.holds === true ? 'met' : s.holds === false ? 'not met' : 'if it applies' }}</span>
                    <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="sd-link">{{ s.clause }}</a><template v-else>{{ s.clause }}</template>
                    {{ s.standard }} <span class="sd-dim" :title="s.test">&middot; {{ shortTest(s) }}</span>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="data.asks.length" class="sd-qs">
        <h4 class="sd-h4">
          What would settle it <span class="sd-dim">- ranked by how many answers each changes</span>
          <button v-if="siteAsks.length" type="button" class="sd-btn" :title="siteAsks.map((a: any) => a.label).join('; ')" @click="noneOfThese">None of the barred buildings is on the lot</button>
        </h4>
        <ul class="sd-list">
          <li v-for="a in data.asks" :key="a.param + a.key" class="sd-q">
            <span class="sd-seg">
              <button v-for="v in [true, false, null]" :key="String(v)" type="button" class="sd-segbtn"
                      :class="{ 'sd-segbtn--on': answers[a.param + '|' + a.key] === v }" @click="answer(a, v)">{{ v === true ? 'Yes' : v === false ? 'No' : '?' }}</button>
            </span>
            {{ a.param === 'site' ? 'The lot has ' : '' }}{{ a.label }}
            <span class="sd-dim">&middot; {{ a.clauses.join(', ') }}</span>
          </li>
        </ul>
      </div>
      <p v-if="Object.keys(answers).length" class="sd-note">
        <button type="button" class="sd-btn" @click="answers = {}">Clear my answers</button>
      </p>

      <div v-if="data.unchecked.length" class="sd-unchecked">
        <strong>Not yet checked</strong> ({{ data.unchecked.length }}) - subdivision clauses not yet encoded; any of them could change the answer:
        <template v-for="(u, i) in data.unchecked" :key="u.instrument + u.clause"><span v-if="i"> · </span>
          <a v-if="u.url" :href="u.url" target="_blank" rel="noopener" class="sd-link">{{ short(u.instrument) }} {{ u.clause }}</a><template v-else>{{ u.clause }}</template>
          <span class="sd-dim"> ({{ u.why }})</span></template>
      </div>
      <p class="sd-note sd-dim">
        Trial (docs/norms-trial.md): Housing SEPP subdivision clauses + the Standard Instrument 2.6 / 4.1 of {{ data.lepCovered ? 'this' : 'each' }} LEP,
        read from its own words. Exempt and complying subdivision (Codes SEPP) is not included yet.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ cadid: string }>()

const data = ref<any>(null)
const error = ref('')
const purpose = ref('')
const lots = ref(2)
/** '<param>|<key>' -> true / false / null (not answered) */
const answers = ref<Record<string, boolean | null>>({})

const WHO: Record<string, string> = { site: 'tell us', proposal: 'tell us', lot: 'data', discretion: 'council', unparsed: 'not yet encoded' }

// the buildings that bar subdivision - what "none of these is on the lot" answers (not, say, a dwelling house)
const siteAsks = computed(() => (data.value?.asks ?? []).filter((a: any) => a.param === 'site' && a.bars))

async function load() {
  error.value = ''
  const site = Object.entries(answers.value).filter(([k, v]) => k.startsWith('site|') && v !== null)
    .map(([k, v]) => `${k.slice(5)}=${v ? 'yes' : 'no'}`).join(';')
  const flag = (param: string) => {
    const e = Object.entries(answers.value).find(([k, v]) => k.startsWith(param + '|') && v !== null)
    return e ? (e[1] ? e[0].slice(param.length + 1) : '-') : undefined
  }
  try {
    data.value = await $fetch('/api/norms/subdivision', { query: { cadid: props.cadid, purpose: purpose.value || undefined,
      lots: lots.value, site: site || undefined, erects: flag('erects'), separates: flag('separates') } })
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.message || 'Request failed' }
}
watch(() => [props.cadid, purpose.value, lots.value, JSON.stringify(answers.value)], load, { immediate: true })
watch(() => props.cadid, () => { answers.value = {}; purpose.value = '' })

function answer(a: any, v: boolean | null) { answers.value = { ...answers.value, [`${a.param}|${a.key}`]: v } }
function noneOfThese() {
  const next = { ...answers.value }
  for (const a of siteAsks.value) if (next[`site|${a.key}`] == null) next[`site|${a.key}`] = false
  answers.value = next
}
function groups(ds: any[]) {
  const order = ['site', 'proposal', 'lot', 'discretion', 'unparsed']
  const by = new Map<string, any[]>()
  for (const d of ds) { const w = d.who === 'proposal' ? 'site' : d.who; by.set(w, [...(by.get(w) ?? []), d]) }
  return order.filter(w => by.has(w)).map(w => ({ who: w, items: by.get(w)! }))
}
/** the arithmetic only; "applies only if ..." is what the questions below settle */
const shortTest = (s: any) => String(s.test ?? '').split('; applies only if')[0]
const isSepp = (t: string) => /State Environmental Planning Policy/.test(t)
const short = (t: string) => String(t ?? '').replace('State Environmental Planning Policy', 'SEPP').replace(/ Local Environmental Plan /, ' LEP ')
</script>

<style scoped>
.sd-ask { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.5rem 0; font-size: 0.78rem; }
.sd-label { font-weight: 700; color: #334155; }
.sd-select, .sd-num { font-size: 0.78rem; padding: 0.15rem 0.3rem; border: 1px solid #cbd5e1; border-radius: 4px; }
.sd-num { width: 4rem; }
.sd-dim { color: #94a3b8; }
.sd-error { color: #b91c1c; margin: 0.5rem 0 0; }
.sd-warn { margin: 0.4rem 0; padding: 0.3rem 0.5rem; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 0.76rem; }
.sd-note { margin: 0.4rem 0 0; font-size: 0.75rem; color: #64748b; max-width: 100ch; }
.sd-h4 { margin: 0.8rem 0 0.3rem; font-size: 0.78rem; font-weight: 800; color: #475569; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.sd-scroll { overflow-x: auto; }
.sd-table { border-collapse: collapse; font-size: 0.76rem; width: 100%; }
.sd-table th, .sd-table td { border: 1px solid #eef2f7; padding: 0.3rem 0.45rem; text-align: left; vertical-align: top; }
.sd-table th { background: #f8fafc; font-weight: 700; white-space: nowrap; }
.sd-table td.sd-wrap { min-width: 14rem; }
.sd-list { margin: 0; padding-left: 0; list-style: none; }
.sd-list li { margin-bottom: 0.2rem; }
.sd-badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-weight: 800; font-size: 0.74rem; }
.sd-badge--yes { background: #dcfce7; color: #166534; }
.sd-badge--no { background: #fee2e2; color: #991b1b; }
.sd-badge--maybe { background: #fef3c7; color: #92400e; }
.sd-gate { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700; white-space: nowrap; margin-right: 0.2rem; }
.sd-gate--yes { background: #dcfce7; color: #166534; }
.sd-gate--no { background: #fee2e2; color: #991b1b; }
.sd-gate--open { background: #f1f5f9; color: #475569; }
.sd-gate--off { background: #f8fafc; color: #94a3b8; text-decoration: line-through; }
.sd-who { display: inline-block; padding: 0 0.35rem; border-radius: 4px; font-size: 0.66rem; font-weight: 700; margin-right: 0.25rem; }
.sd-who--site { background: #e0f2fe; color: #075985; }
.sd-who--lot { background: #f1f5f9; color: #475569; }
.sd-who--discretion { background: #ede9fe; color: #5b21b6; }
.sd-who--unparsed { background: #fef3c7; color: #92400e; }
.sd-qs { margin-top: 0.4rem; }
.sd-q { font-size: 0.76rem; display: flex; gap: 0.4rem; align-items: baseline; flex-wrap: wrap; }
.sd-seg { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
.sd-segbtn { font-size: 0.7rem; padding: 0.05rem 0.45rem; background: #fff; border: 0; border-right: 1px solid #e2e8f0; cursor: pointer; color: #475569; }
.sd-segbtn:last-child { border-right: 0; }
.sd-segbtn--on { background: #0f172a; color: #fff; }
.sd-btn { font-size: 0.7rem; padding: 0.1rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; font-weight: 600; color: #334155; }
.sd-clauses { margin-right: 0.5rem; }
.sd-why { margin-top: 0.3rem; color: #475569; }
.sd-caveat { margin-top: 0.25rem; font-size: 0.68rem; font-weight: 700; color: #991b1b; max-width: 9rem; }
.sd-unchecked { margin-top: 0.6rem; padding: 0.4rem 0.55rem; border-radius: 6px; background: #f8fafc; border: 1px dashed #cbd5e1; font-size: 0.74rem; color: #334155; }
.sd-link { color: inherit; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
</style>
