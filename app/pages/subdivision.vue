<!--
  /subdivision - can this lot be subdivided, and which kind?

  Search an address (or a lot reference, A//DP71490), pick the lot, and get Torrens, strata and community title as
  Yes / No / Maybe from the Housing SEPP and the lot's LEP (GET /api/norms/subdivision, docs/norms-trial.md). The same
  component as the Subdivision section of /testing-spatial-services; the lot is in the URL (?cadid=) so a result can be
  shared. The search is /api/lotprofile?q= - the one /testing-spatial-services runs.
-->
<template>
  <div class="sp-page">
    <header class="sp-header">
      <NuxtLink to="/" class="sp-back">&larr; Home</NuxtLink>
      <h1 class="sp-title">Subdivision</h1>
      <p class="sp-lead">
        Can this lot be subdivided, and which way - Torrens, strata or community title? Each answer is
        <b>Yes</b>, <b>No</b> or <b>Maybe</b> from the Housing SEPP and the lot's LEP; a Maybe tells you exactly what it turns
        on, and the questions below it settle it.
      </p>
    </header>

    <section class="sp-search">
      <div class="sp-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="open = false">
        <label class="sp-sr" for="sp-q">Address or lot reference</label>
        <input id="sp-q" v-model="q" type="search" class="sp-input" autocomplete="off" spellcheck="false"
               placeholder="Type an address - 62B Carr St Coogee - or a lot, 1//DP219220" role="combobox"
               :aria-expanded="open && results.length > 0" aria-controls="sp-list"
               @input="onType" @focus="open = results.length > 0" @keydown.enter.prevent="pick(results[hi])">
        <span v-if="searching" class="sp-busy">searching&hellip;</span>
        <ul v-if="open && results.length" id="sp-list" class="sp-list" role="listbox">
          <li v-for="(r, i) in results" :key="`${r.cadid}-${r.msoid}`" role="option" :aria-selected="i === hi"
              class="sp-opt" :class="{ 'sp-opt--on': i === hi }" @mousedown.prevent="pick(r)" @mousemove="hi = i">
            <span>{{ r.address || '(no address)' }}</span>
            <span class="sp-dim"><code>{{ r.titleLot || r.lotId || '' }}</code> {{ r.lgaName || '' }}</span>
          </li>
        </ul>
      </div>
      <p v-if="searchError" class="sp-error">{{ searchError }}</p>
      <p v-else-if="hint" class="sp-dim sp-hint">{{ hint }}</p>
      <p v-else-if="searched && !results.length && !searching" class="sp-dim sp-hint">Nothing matched <b>{{ lastQ }}</b>.</p>
      <p v-if="!cadid" class="sp-examples">
        Try:
        <button v-for="e in EXAMPLES" :key="e.cadid" type="button" class="sp-chip" @click="openLot(e.cadid, e.label)">{{ e.label }}</button>
      </p>
    </section>

    <section v-if="cadid" class="sp-result">
      <h2 class="sp-h2">
        {{ label || 'Lot' }}
        <span class="sp-dim">cadid <code>{{ cadid }}</code></span>
        <NuxtLink :to="{ path: '/testing-spatial-services', query: { cadid } }" class="sp-more">everything else about this lot &rarr;</NuxtLink>
      </h2>
      <SubdivisionForLot :cadid="cadid" />
    </section>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'Subdivision · Planning Library' })

const route = useRoute()
const router = useRouter()
const EXAMPLES = [
  { cadid: '102325171', label: '62B Carr Street, Coogee' },
  { cadid: '100097746', label: 'A Parramatta R2 lot near a station' },
]

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
    // a query that narrows to one address opens it
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
  router.replace({ query: { cadid: c, address: l } })
}
watch(() => route.query.cadid, (v) => { if (v && String(v) !== cadid.value) { cadid.value = String(v); label.value = String(route.query.address ?? '') } })
</script>

<style scoped>
.sp-page { max-width: 1180px; margin: 0 auto; padding: 1.2rem 1rem 3rem; font-family: inherit; color: #0f172a; }
.sp-back { font-size: 0.78rem; color: #64748b; text-decoration: none; }
.sp-title { margin: 0.3rem 0 0.2rem; font-size: 1.6rem; font-weight: 800; }
.sp-lead { margin: 0; font-size: 0.88rem; color: #475569; max-width: 80ch; }
.sp-search { margin: 1rem 0 0.6rem; }
.sp-combo { position: relative; max-width: 640px; }
.sp-input { width: 100%; box-sizing: border-box; font-size: 1rem; padding: 0.6rem 0.8rem; border: 1px solid #cbd5e1; border-radius: 10px; outline: none; }
.sp-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px #dbeafe; }
.sp-busy { position: absolute; right: 0.8rem; top: 0.7rem; font-size: 0.75rem; color: #94a3b8; }
.sp-list { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 0.25rem 0; list-style: none; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); max-height: 360px; overflow-y: auto; }
.sp-opt { display: flex; justify-content: space-between; gap: 1rem; padding: 0.4rem 0.8rem; font-size: 0.85rem; cursor: pointer; }
.sp-opt--on { background: #eff6ff; }
.sp-dim { color: #94a3b8; font-size: 0.78rem; font-weight: 400; }
.sp-hint { margin: 0.35rem 0 0; }
.sp-error { color: #b91c1c; margin: 0.35rem 0 0; font-size: 0.8rem; }
.sp-examples { margin: 0.6rem 0 0; font-size: 0.8rem; color: #64748b; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.sp-chip { font-size: 0.78rem; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color: #1e293b; }
.sp-chip:hover { border-color: #2563eb; }
.sp-result { margin-top: 1rem; padding-top: 0.6rem; border-top: 1px solid #e2e8f0; }
.sp-h2 { margin: 0 0 0.4rem; font-size: 1.05rem; font-weight: 800; display: flex; gap: 0.6rem; align-items: baseline; flex-wrap: wrap; }
.sp-more { margin-left: auto; font-size: 0.75rem; font-weight: 600; color: #2563eb; text-decoration: none; }
.sp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
