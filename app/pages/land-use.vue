<!--
  /land-use - can this land use be carried out on this lot, under the LEP AND the SEPPs?

  The sibling of /subdivision: the same address search (/api/lotprofile), the same Yes / No / Maybe
  reading, asked of a land use instead of a subdivision. One tab per use that a CDC type or a
  Pattern Book design turns on - the nine in docs/permissible-use-by-type.md.

  Why it exists: /cdc and /pattern-book both answer cl 1.18(1)(b) and s 183(1)(a) with a bare
  pass/fail, and until now the answer came off the LEP's Land Use Table alone. GET /api/norms/use
  reads the LEP and the SEPPs together, names every instrument that spoke - a SEPP permission over
  an LEP prohibition is shown as both, never merged away - and brings the standards with it.
-->
<template>
  <div class="lu-page">
    <header class="lu-header">
      <NuxtLink to="/" class="lu-back">&larr; Home</NuxtLink>
      <h1 class="lu-title">Land use</h1>
      <p class="lu-lead">
        Can this land use be carried out on this lot? Each answer is <b>Yes</b>, <b>No</b> or <b>Maybe</b> from the
        lot's LEP <b>and</b> every SEPP that reaches it - a SEPP can permit what the LEP prohibits, and both are shown.
        These are the nine uses the <NuxtLink to="/cdc">CDC codes</NuxtLink> and the
        <NuxtLink to="/pattern-book">Pattern Book</NuxtLink> turn on.
      </p>
    </header>

    <section class="lu-search">
      <div class="lu-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="open = false">
        <label class="lu-sr" for="lu-q">Address or lot reference</label>
        <input id="lu-q" v-model="q" type="search" class="lu-input" autocomplete="off" spellcheck="false"
               placeholder="Type an address - 23 Cobbadah Ave Pennant Hills - or a lot, 1//DP219220" role="combobox"
               :aria-expanded="open && results.length > 0" aria-controls="lu-list"
               @input="onType" @focus="open = results.length > 0" @keydown.enter.prevent="pick(results[hi])">
        <span v-if="searching" class="lu-busy">searching&hellip;</span>
        <ul v-if="open && results.length" id="lu-list" class="lu-list" role="listbox">
          <li v-for="(r, i) in results" :key="`${r.cadid}-${r.msoid}`" role="option" :aria-selected="i === hi"
              class="lu-opt" :class="{ 'lu-opt--on': i === hi }" @mousedown.prevent="pick(r)" @mousemove="hi = i">
            <span>{{ r.address || '(no address)' }}</span>
            <span class="lu-dim"><code>{{ r.titleLot || r.lotId || '' }}</code> {{ r.lgaName || '' }}</span>
          </li>
        </ul>
      </div>
      <p v-if="searchError" class="lu-error">{{ searchError }}</p>
      <p v-else-if="hint" class="lu-dim lu-hint">{{ hint }}</p>
      <p v-else-if="searched && !results.length && !searching" class="lu-dim lu-hint">Nothing matched <b>{{ lastQ }}</b>.</p>
      <p v-if="!cadid" class="lu-examples">
        Try:
        <button v-for="e in EXAMPLES" :key="e.cadid" type="button" class="lu-chip" @click="openLot(e.cadid, e.label)">{{ e.label }}</button>
      </p>
    </section>

    <section v-if="cadid" class="lu-result">
      <h2 class="lu-h2">
        {{ label || 'Lot' }}
        <span class="lu-dim">cadid <code>{{ cadid }}</code></span>
        <NuxtLink :to="{ path: '/testing-spatial-services', query: { cadid } }" class="lu-more">everything else about this lot &rarr;</NuxtLink>
      </h2>

      <p v-if="error" class="lu-error">{{ error }}</p>
      <p v-else-if="pending" class="lu-dim">Reading the instruments&hellip;</p>

      <template v-else-if="data">
        <p class="lu-note">
          Zone <b>{{ data.lot.zone || '?' }}</b>
          &middot; {{ data.lot.epi || 'no LEP matched' }}
          &middot; {{ data.lot.areaM2 ? Math.round(data.lot.areaM2).toLocaleString() + ' m²' : 'area unknown' }}
          <template v-if="data.lot.isBattleaxe">&middot; battle-axe, {{ data.lot.handleAreaM2 }} m² handle</template>
          <span class="lu-dim"> &middot; {{ data.ms }} ms</span>
        </p>

        <!-- one tab per land use; the count beside each is how many standards came with it -->
        <nav class="lu-tabs" role="tablist">
          <button v-for="t in data.tabs" :key="t.key" type="button" role="tab" class="lu-tab"
                  :class="[{ 'lu-tab--on': t.key === tab }, 'lu-tab--' + t.answer]"
                  :aria-selected="t.key === tab" @click="tab = t.key">
            <span class="lu-dot" :class="'lu-dot--' + t.answer" />{{ t.label }}
          </button>
        </nav>

        <div v-if="current" class="lu-panel" role="tabpanel">
          <div class="lu-verdict">
            <span class="lu-answer" :class="'lu-answer--' + current.answer">{{ ANSWER[current.answer] }}</span>
            <span class="lu-verdict-txt">{{ summary(current) }}</span>
          </div>

          <p v-if="current.inferred" class="lu-inferred"><b>Inferred.</b> {{ current.inferred }}</p>

          <h3 class="lu-h3">What the instruments say</h3>
          <table v-if="current.because.length" class="lu-table">
            <thead><tr><th>Source</th><th>Instrument</th><th>Term</th><th>Says</th></tr></thead>
            <tbody>
              <tr v-for="(b, i) in current.because" :key="i">
                <td><span class="lu-src" :class="'lu-src--' + b.source">{{ b.source.toUpperCase() }}</span></td>
                <td>{{ b.instrument }}</td>
                <td><code>{{ b.term }}</code></td>
                <td :class="'lu-st--' + (b.status.startsWith('permitted') ? 'yes' : b.status === 'prohibited' ? 'no' : 'maybe')">
                  {{ b.status.replace(/_/g, ' ') }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="lu-dim">
            No row for this use in the zone's Land Use Table, in either the LEP or a SEPP. That is not the same as
            prohibited - it means the term is outside the vocabulary we hold for this plan.
          </p>

          <h3 class="lu-h3">Standards <span class="lu-dim">if the use is carried out</span></h3>
          <table v-if="current.standards.length" class="lu-table">
            <thead><tr><th>Clause</th><th>Standard</th><th>Against this lot</th></tr></thead>
            <tbody>
              <tr v-for="s in current.standards" :key="s.id">
                <td>
                  <a v-if="s.url" :href="s.url" target="_blank" rel="noopener">{{ s.clause }}</a>
                  <span v-else>{{ s.clause }}</span>
                </td>
                <td>{{ s.standard }}</td>
                <td :class="s.holds === false ? 'lu-st--no' : s.holds === true ? 'lu-st--yes' : 'lu-dim'">{{ s.test }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="lu-dim">No numeric standard in the graph for this use on this plan.</p>

          <details v-if="current.gaps.length" class="lu-gaps">
            <summary>{{ current.gaps.length }} clause(s) in the plan with no standard extracted</summary>
            <ul>
              <li v-for="(g, i) in current.gaps" :key="i">
                <a v-if="g.url" :href="g.url" target="_blank" rel="noopener">{{ g.clause }}</a>
                <span v-else>{{ g.clause }}</span>
                <span class="lu-dim"> {{ g.heading }}</span>
              </li>
            </ul>
          </details>

          <p class="lu-needs"><b>Needed by:</b> {{ current.needs.join(' &middot; ') }}</p>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'Land use · Planning Library' })

const route = useRoute()
const router = useRouter()
const EXAMPLES = [
  { cadid: '102537951', label: '23 Cobbadah Ave, Pennant Hills' },
  { cadid: '102443157', label: 'A Fairfield R2/R3 lot' },
]
const ANSWER: Record<string, string> = { yes: 'YES', no: 'NO', maybe: 'MAYBE', unknown: 'NOT RECORDED' }

const q = ref('')
const results = ref<any[]>([])
const hi = ref(0)
const open = ref(false)
const searching = ref(false)
const searched = ref(false)
const searchError = ref('')
const hint = ref('')
const lastQ = ref('')
const cadid = ref<string>(String(route.query.cadid ?? '').trim())
const label = ref<string>(String(route.query.address ?? '').trim())
const tab = ref<string>(String(route.query.use ?? 'dual-occupancy'))

const { data, pending, error } = await useFetch<any>('/api/norms/use', {
  query: computed(() => ({ cadid: cadid.value })),
  immediate: Boolean(cadid.value),
  watch: [cadid],
})
const current = computed(() => (data.value?.tabs ?? []).find((t: any) => t.key === tab.value) ?? data.value?.tabs?.[0])
watch(tab, v => router.replace({ query: { ...route.query, use: v } }))

/** One line under the pill: what the answer rests on, in the terms the clause uses. */
const names = (rows: any[]) => [...new Set(rows.map((r: any) => r.instrument))].join(', ')

function summary(t: any): string {
  const permits = t.because.filter((b: any) => b.status.startsWith('permitted'))
  const bans = t.because.filter((b: any) => b.status === 'prohibited')
  if (!t.because.length) return `No Land Use Table row for ${t.label.toLowerCase()} in this zone.`
  const lepYes = permits.filter((p: any) => p.source === 'lep')
  const seppYes = permits.filter((p: any) => p.source === 'sepp')
  if (!lepYes.length && seppYes.length && bans.length) {
    /*
     * The case this page was built for, and the reason it is a MAYBE rather than a yes.
     * nsw.sepp_permissible_landuse is keyed by zone alone, but Housing SEPP s 166 permits the use
     * "on land to which this chapter applies", and Chapter 6 excludes heritage items, bush fire
     * prone land, flood planning areas and more. Whether it reaches this lot is a separate test.
     */
    // one name per instrument: a use with six spellings would otherwise name its LEP six times
    return `${names(bans)} prohibits it in this zone, but ${names(seppYes)} permits it where that chapter `
      + 'applies to the land - and whether it reaches this lot is not tested here.'
  }
  if (lepYes.length) return `${names(lepYes)} permits it ${lepYes[0].status === 'permitted_without_consent' ? 'without consent' : 'with consent'}.`
  if (bans.length) return `${names(bans)} prohibits it in this zone, and no SEPP permits it.`
  return 'The Land Use Table splits this use - see the rows below.'
}

let timer: ReturnType<typeof setTimeout> | null = null
let ctrl: AbortController | null = null
function onType() {
  if (timer) clearTimeout(timer)
  const term = q.value.trim()
  if (term.length < 3) { results.value = []; open.value = false; return }
  timer = setTimeout(() => search(term), 250)
}
async function search(term: string) {
  ctrl?.abort()
  ctrl = new AbortController()
  searching.value = true; searchError.value = ''; hint.value = ''
  try {
    const r = await $fetch<{ results: any[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    results.value = r.results ?? []
    hint.value = r.hint ?? ''
    hi.value = 0
    open.value = results.value.length > 0
    searched.value = true; lastQ.value = term
    if (results.value.length === 1) pick(results.value[0])
  } catch (e: any) {
    if (e?.name !== 'AbortError') searchError.value = e?.data?.statusMessage || e?.message || 'Search failed'
  } finally { searching.value = false }
}
function move(d: number) { if (results.value.length) hi.value = (hi.value + d + results.value.length) % results.value.length }
function pick(r: any) {
  if (!r?.cadid) return
  open.value = false
  q.value = r.address || r.lotId || ''
  openLot(String(r.cadid), r.address ? `${r.address}${r.titleLot || r.lotId ? ` (${r.titleLot || r.lotId})` : ''}` : r.lotId)
}
function openLot(c: string, l: string) {
  cadid.value = c
  label.value = l
  router.replace({ query: { cadid: c, address: l, use: tab.value } })
}
watch(() => route.query.cadid, (v) => { if (v && String(v) !== cadid.value) { cadid.value = String(v); label.value = String(route.query.address ?? '') } })
</script>

<style scoped>
.lu-page { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; color: #0f172a;
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.lu-back { color: #6366f1; text-decoration: none; font-size: 12px; }
.lu-title { margin: 6px 0 4px; font-size: 26px; }
.lu-lead { margin: 0 0 18px; color: #475569; max-width: 74ch; }
.lu-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.lu-combo { position: relative; }
.lu-input { width: 100%; padding: 12px 14px; font-size: 15px; border: 1px solid #cbd5e1; border-radius: 8px; }
.lu-input:focus { outline: 2px solid #6366f1; outline-offset: 1px; }
.lu-busy { position: absolute; right: 12px; top: 13px; font-size: 12px; color: #64748b; }
.lu-list { position: absolute; z-index: 20; left: 0; right: 0; margin: 4px 0 0; padding: 4px; list-style: none;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 8px 24px rgba(15,23,42,.12);
  max-height: 320px; overflow: auto; }
.lu-opt { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; border-radius: 6px; cursor: pointer; }
.lu-opt--on { background: #eef2ff; }
.lu-dim { color: #64748b; }
.lu-hint, .lu-examples { margin: 8px 0 0; font-size: 13px; }
.lu-chip { margin-left: 6px; padding: 3px 9px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 999px;
  background: #fff; cursor: pointer; }
.lu-chip:hover { background: #eef2ff; }
.lu-error { color: #b91c1c; }
.lu-result { margin-top: 26px; }
.lu-h2 { font-size: 18px; margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.lu-h2 .lu-dim { font-size: 12px; font-weight: 400; }
.lu-more { margin-left: auto; font-size: 13px; color: #6366f1; text-decoration: none; }
.lu-note { margin: 0 0 14px; color: #475569; font-size: 13px; }

.lu-tabs { display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.lu-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; font-size: 13px; cursor: pointer;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 7px; color: #334155; }
.lu-tab:hover { background: #f8fafc; }
.lu-tab--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.lu-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.lu-dot--yes { background: #16a34a; } .lu-dot--no { background: #dc2626; }
.lu-dot--maybe { background: #d97706; } .lu-dot--unknown { background: #94a3b8; }

.lu-panel { padding-top: 16px; }
.lu-verdict { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.lu-answer { padding: 4px 12px; border-radius: 6px; font-weight: 700; font-size: 13px; letter-spacing: .03em; }
.lu-answer--yes { background: #dcfce7; color: #14532d; }
.lu-answer--no { background: #fee2e2; color: #7f1d1d; }
.lu-answer--maybe { background: #fef3c7; color: #78350f; }
.lu-answer--unknown { background: #e2e8f0; color: #334155; }
.lu-verdict-txt { color: #334155; }
.lu-inferred { background: #eef2ff; border-left: 3px solid #6366f1; padding: 8px 12px; margin: 10px 0; font-size: 13px; }
.lu-h3 { font-size: 14px; margin: 20px 0 8px; }
.lu-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lu-table th { text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; padding: 6px 8px; }
.lu-table td { border-bottom: 1px solid #f1f5f9; padding: 6px 8px; vertical-align: top; overflow-wrap: anywhere; }
.lu-src { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.lu-src--lep { background: #e0e7ff; color: #312e81; }
.lu-src--sepp { background: #fae8ff; color: #701a75; }
.lu-st--yes { color: #15803d; } .lu-st--no { color: #b91c1c; } .lu-st--maybe { color: #b45309; }
.lu-gaps { margin-top: 16px; font-size: 13px; }
.lu-gaps summary { cursor: pointer; color: #64748b; }
.lu-needs { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
</style>
