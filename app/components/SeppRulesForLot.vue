<!--
  "SEPPs for this lot" - the generated SEPP rule layer (docs/sepp-rule-pipeline.md) asked about one lot and
  one land use, through /api/rules/at. Every line is the pipeline's `held` rules, labelled as such: they are
  not yet what the report reads. What it shows, in order: the verdict and the clause that controls it, the
  SEPP frames (where each instrument / chapter applies) with each condition tested against the lot, the SEPP
  permissions and standards that reach the lot, then the LEP side (Land Use Table, clauses withholding
  consent, standards for the use). Every clause links to its place on legislation.nsw.gov.au (the version ingested):
  the graph's section ids are the page's own anchors.
-->
<template>
  <div class="sr">
    <div class="sr-ask">
      <label class="sr-label" for="sr-use">Land use</label>
      <select id="sr-use" v-model="use" class="sr-select">
        <option v-for="u in uses" :key="u.use" :value="u.use">{{ u.use }}{{ u.permitted ? '' : ' (standards only)' }}</option>
      </select>
      <span class="sr-dim"><code>/api/rules/at?cadid={{ cadid }}&amp;use={{ use }}</code></span>
    </div>

    <p v-if="error" class="sr-error">{{ error }}</p>
    <p v-else-if="!data" class="sr-dim">Loading&hellip;</p>
    <template v-else>
      <p class="sr-verdict" :class="`sr-verdict--${tri(data.verdict.permissible)}`">
        <strong>{{ data.verdict.permissible === true ? 'Permissible' : data.verdict.permissible === false ? 'Not permissible' : 'Undecided' }}</strong>
        &mdash;
        <template v-for="(seg, i) in verdictSegments" :key="i"><a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener" class="sr-link">{{ seg.text }}</a><template v-else>{{ seg.text }}</template></template>
      </p>
      <p v-if="data.verdict.caveat" class="sr-note">{{ data.verdict.caveat }}</p>
      <p class="sr-note">
        Zone {{ data.lot.zone || 'unknown' }} &middot; {{ data.lot.lga || 'council not recorded' }}
        &middot; {{ data.lot.areaM2?.toLocaleString() }} m²
        &middot; frontage {{ data.lot.frontageM == null ? 'unknown' : data.lot.frontageM.toFixed(1) + ' m' }}
        <span class="sr-dim">&middot; {{ data.ms }} ms &middot; SEPP rules are <code>held</code> (pipeline output, not yet read by the report)</span>
      </p>

      <h4 class="sr-h4">Where each SEPP applies (frames)</h4>
      <div class="sr-scroll">
        <table class="sr-table">
          <thead><tr><th>Instrument</th><th>Clause</th><th>Reaches the lot</th><th>Conditions tested</th></tr></thead>
          <tbody>
            <tr v-for="f in data.frames" :key="f.ruleKey">
              <td>{{ short(f.instrument) }}</td>
              <td><a v-if="href(f.instrument, f.clause)" :href="href(f.instrument, f.clause)" target="_blank" rel="noopener" class="sr-link">s {{ f.clause }}</a><template v-else>s {{ f.clause }}</template></td>
              <td><span class="sr-gate" :class="`sr-gate--${tri(f.reaches)}`">{{ word(f.reaches) }}</span></td>
              <td class="sr-wrap">
                <template v-if="!lotConds(f).length"><span class="sr-dim">no lot condition</span></template>
                <details v-else>
                  <summary>{{ decisive(f) }}</summary>
                  <ul class="sr-list">
                    <li v-for="(c, i) in lotConds(f)" :key="i">
                      <span class="sr-gate" :class="`sr-gate--${condTri(c)}`">{{ condWord(c) }}</span>
                      {{ c.polarity === 'excludes' ? 'not' : '' }} {{ c.dimension.replace(/_/g, ' ') }}: {{ c.value }}
                      <span class="sr-dim">&middot; {{ c.why }}</span>
                    </li>
                  </ul>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 class="sr-h4">SEPP permissions and standards for {{ data.use }}</h4>
      <p v-if="!data.sepp.permissions.length && !data.sepp.standards.length" class="sr-dim">No SEPP rule in the graph names this use.</p>
      <div v-else class="sr-scroll">
        <table class="sr-table">
          <thead><tr><th>Clause</th><th>What</th><th>Applies</th><th>Why</th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in data.sepp.permissions" :key="'p' + i">
              <td><a v-if="href(p.instrument, p.clause)" :href="href(p.instrument, p.clause)" target="_blank" rel="noopener" class="sr-link">s {{ p.clause }}</a><template v-else>s {{ p.clause }}</template></td>
              <td>permitted {{ p.pathway || 'with consent' }}</td>
              <td><span class="sr-gate" :class="`sr-gate--${tri(p.applies)}`">{{ word(p.applies) }}</span></td>
              <td class="sr-wrap">{{ p.why }}</td>
            </tr>
            <tr v-for="(s, i) in seppNumeric" :key="'s' + i">
              <td><a v-if="href(s.instrument, s.clause)" :href="href(s.instrument, s.clause)" target="_blank" rel="noopener" class="sr-link">s {{ s.clause }}</a><template v-else>s {{ s.clause }}</template></td>
              <td>{{ effect(s) }}</td>
              <td><span class="sr-gate" :class="`sr-gate--${tri(s.applies)}`">{{ word(s.applies) }}</span></td>
              <td class="sr-wrap">{{ s.why }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 class="sr-h4">{{ data.lep.document || 'LEP' }}</h4>
      <p class="sr-note">
        <a v-if="href(data.lep.document, 'Land Use Table')" :href="href(data.lep.document, 'Land Use Table')" target="_blank" rel="noopener" class="sr-link">Land Use Table</a><template v-else>Land Use Table</template>:
        {{ data.lep.landUseTable ? data.lep.landUseTable.replace(/_/g, ' ') : 'no row for this zone' }}
      </p>
      <div v-if="data.lep.withholdsConsent.length || lepNumeric.length" class="sr-scroll">
        <table class="sr-table">
          <thead><tr><th>Clause</th><th>What</th><th>Applies</th><th>Why</th></tr></thead>
          <tbody>
            <tr v-for="(b, i) in data.lep.withholdsConsent" :key="'b' + i">
              <td><a v-if="href(data.lep.document, b.clause)" :href="href(data.lep.document, b.clause)" target="_blank" rel="noopener" class="sr-link">cl {{ b.clause }}</a><template v-else>cl {{ b.clause }}</template></td>
              <td>consent must not be granted</td>
              <td><span class="sr-gate" :class="`sr-gate--${tri(b.applies)}`">{{ word(b.applies) }}</span></td>
              <td class="sr-wrap">{{ b.why }}</td>
            </tr>
            <tr v-for="(s, i) in lepNumeric" :key="'l' + i">
              <td><a v-if="href(data.lep.document, s.clause)" :href="href(data.lep.document, s.clause)" target="_blank" rel="noopener" class="sr-link">cl {{ s.clause }}</a><template v-else>cl {{ s.clause }}</template></td>
              <td>{{ effect(s) }}</td>
              <td><span class="sr-gate" :class="`sr-gate--${tri(s.applies)}`">{{ word(s.applies) }}</span></td>
              <td class="sr-wrap">{{ s.why }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ cadid: string }>()

// the uses come from the rule layer itself (/api/rules/uses), so a newly ingested SEPP adds its own
const uses = ref<{ use: string; permitted: boolean }[]>([])
const use = ref('')
const data = ref<any>(null)
const error = ref('')

async function load() {
  if (!use.value) {
    try {
      uses.value = (await $fetch<any>('/api/rules/uses')).uses
      use.value = uses.value[0]?.use ?? ''
    } catch (e: any) { error.value = e?.data?.statusMessage || e?.message || 'Request failed' }
    return // setting use re-runs load through the watcher
  }
  data.value = null
  error.value = ''
  try {
    data.value = await $fetch('/api/rules/at', { query: { cadid: props.cadid, use: use.value } })
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Request failed'
  }
}
watch(() => [props.cadid, use.value], load, { immediate: true })

type Tri = boolean | null
const tri = (v: Tri) => v === true ? 'yes' : v === false ? 'no' : 'open'
const word = (v: Tri) => v === true ? 'yes' : v === false ? 'no' : 'undecided'
const lotConds = (f: any) => f.conditions.filter((c: any) => c.why !== 'a fact about the proposal, not the lot')
// for an exclusion, the condition holding is what stops the frame
const condTri = (c: any) => c.holds === null ? 'open' : (c.polarity === 'excludes') === c.holds ? 'no' : 'yes'
const condWord = (c: any) => c.holds === null ? 'undecided' : c.holds ? 'holds' : 'does not hold'
function decisive(f: any) {
  const cs = lotConds(f)
  const stop = cs.filter((c: any) => condTri(c) === 'no')
  const open = cs.filter((c: any) => c.holds === null)
  if (stop.length) return `stopped by ${stop.map((c: any) => c.value).join('; ')}`
  if (open.length) return `${open.length} of ${cs.length} undecided: ${open.map((c: any) => c.value).join('; ')}`
  return `all ${cs.length} conditions clear`
}
/**
 * A clause as the page's anchor: "166" -> sec.166, "8(1)" -> sec.8-ssec.1, "15C(1)(a)" -> sec.15C-ssec.1-para1.a,
 * "6.11(1)" -> sec.6.11-ssec.1, "113(a)" -> sec.113-para1.a. The Land Use Table has no anchor of its own; it closes
 * Part 2 of every Standard Instrument LEP, so it links there.
 */
function anchor(clause: string): string | null {
  const c = String(clause ?? '').trim()
  if (/^land use table$/i.test(c)) return 'pt.2'
  const m = c.match(/^(\d+(?:\.\d+)?[A-Z]*)((?:\([0-9A-Za-z]+\))*)/)
  if (!m) return null
  let id = `sec.${m[1]}`
  let level = 0
  for (const [, tok] of m[2]!.matchAll(/\(([0-9A-Za-z]+)\)/g)) {
    if (/^\d/.test(tok!) && level === 0) id += `-ssec.${tok}`
    else id += `-para${++level}.${tok}`
  }
  return id
}
const href = (instrument: string | null | undefined, clause: string) => {
  const base = instrument ? data.value?.sources?.[instrument] : null
  const a = anchor(clause)
  return base && a ? `${base}#${a}` : null
}
/** The verdict sentence with each "<instrument> s 166", "<instrument> cl 6.11(1)", "<LEP> Land Use Table" and
 *  "by s 8(1)" (the controlling instrument's own relationship clause) as a link. */
const verdictSegments = computed(() => {
  const v = data.value?.verdict
  const text = String(v?.wording ?? '')
  const titles = Object.keys(data.value?.sources ?? {}).sort((a, b) => b.length - a.length)
  if (!titles.length) return [{ text, href: null as string | null }]
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const CL = String.raw`\d+(?:\.\d+)?[A-Z]*(?:\([0-9A-Za-z]+\))*`
  const re = new RegExp(`(${titles.map(esc).join('|')}) (?:(s|cl) (${CL})|(Land Use Table))|\\bby s (${CL})`, 'g')
  const out: { text: string; href: string | null }[] = []
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), href: null })
    const inst = m[1] ?? v?.controlling?.instrument
    const clause = m[3] ?? (m[4] ? 'Land Use Table' : m[5])
    out.push({ text: m[0], href: href(inst, clause!) })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), href: null })
  return out
})
const short = (t: string) => String(t ?? '').replace('State Environmental Planning Policy', 'SEPP')
const seppNumeric = computed(() => (data.value?.sepp.standards ?? []).filter((s: any) => s.value != null))
const lepNumeric = computed(() => (data.value?.lep.standards ?? []).filter((s: any) => s.value != null))
const CMP: Record<string, string> = { lte: '≤', lt: '<', gte: '≥', gt: '>', eq: '=' }
const effect = (e: any) => `${String(e.topic ?? '').replace(/_/g, ' ')} ${CMP[e.comparator] ?? e.comparator ?? ''} ${e.value}${e.unit && e.unit !== 'ratio' ? ' ' + e.unit : e.unit === 'ratio' ? ':1' : ''}`
  + (e.condition_metric ? ` (if ${e.condition_metric} ≤ ${e.condition_hi})` : '')
</script>

<style scoped>
.sr-ask { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; font-size: 0.78rem; }
.sr-label { font-weight: 700; color: #334155; }
.sr-select { font-size: 0.78rem; padding: 0.15rem 0.3rem; border: 1px solid #cbd5e1; border-radius: 4px; }
.sr-dim { color: #94a3b8; }
.sr-error { color: #b91c1c; margin: 0.5rem 0 0; }
.sr-note { margin: 0.4rem 0 0; font-size: 0.75rem; color: #64748b; max-width: 88ch; }
.sr-h4 { margin: 0.8rem 0 0.3rem; font-size: 0.78rem; font-weight: 800; color: #475569; }
.sr-verdict { margin: 0.2rem 0 0.6rem; padding: 0.4rem 0.6rem; border-radius: 8px; font-size: 0.82rem; border-left: 3px solid; }
.sr-verdict--yes { background: #f0fdf4; border-color: #16a34a; color: #166534; }
.sr-verdict--no { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
.sr-verdict--open { background: #fffbeb; border-color: #d97706; color: #92400e; }
.sr-scroll { overflow-x: auto; }
.sr-table { border-collapse: collapse; font-size: 0.76rem; width: 100%; }
.sr-table th, .sr-table td { border: 1px solid #eef2f7; padding: 0.25rem 0.45rem; text-align: left; white-space: nowrap; vertical-align: top; }
.sr-table th { background: #f8fafc; font-weight: 700; }
.sr-table td.sr-wrap { white-space: normal; min-width: 16rem; }
.sr-list { margin: 0.3rem 0 0; padding-left: 1rem; }
.sr-list li { margin-bottom: 0.15rem; }
.sr-gate { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }
.sr-gate--yes { background: #dcfce7; color: #166534; }
.sr-gate--no { background: #fee2e2; color: #991b1b; }
.sr-gate--open { background: #fef3c7; color: #92400e; }
summary { cursor: pointer; }
.sr-link { color: inherit; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
.sr-link:hover { text-decoration-style: solid; }
</style>
