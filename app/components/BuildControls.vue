<!--
  BuildControls - "what do you want to build?" first: a dropdown of every use the plans name, grouped by what the zone
  says about it on this lot, and for the one chosen, whether it is permissible and every development control on it.

  Data: /api/report/build-controls (RAG engine, shared/rag/evaluate.ts). Emits `trace` { use, topic } when a clause is
  clicked ('permissibility' for the verdict); the page shows the engine's trace.
-->
<template>
  <div class="flex flex-col gap-4">
    <p v-if="error" class="text-no">{{ error }}</p>
    <div v-else-if="!data" class="flex flex-col gap-3">
      <Skeleton class="h-10 w-full max-w-[520px]" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>
    <p v-else-if="data.engine === 'none'" class="rounded-lg border border-open-line bg-open-soft px-3 py-2 text-open">{{ data.reason }}</p>
    <template v-else>
      <!-- the use: a searchable list, grouped by what the zone says about each -->
      <div class="flex flex-col gap-2">
        <label for="bc-use" class="text-sm font-medium">What do you want to build?</label>
        <Popover v-model:open="openPick">
          <PopoverTrigger as-child>
            <button
              id="bc-use" type="button" role="combobox" :aria-expanded="openPick"
              class="flex w-full max-w-[520px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left text-[15px] shadow-xs transition hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span class="truncate">{{ cap(currentOption?.label ?? use) }}</span>
              <Badge v-if="currentOption" :variant="tone(currentOption)">{{ words(currentOption) }}</Badge>
              <ChevronsUpDown class="ml-auto size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="p-0" align="start" :style="{ width: 'var(--reka-popover-trigger-width)' }">
            <Command>
              <CommandInput placeholder="Search uses…" />
              <CommandList class="max-h-80">
                <CommandEmpty>No use by that name.</CommandEmpty>
                <CommandGroup v-for="g in groups" :key="g.key" :heading="`${g.label} · ${g.options.length}`">
                  <CommandItem v-for="o in g.options" :key="o.use" :value="o.label" @select="choose(o.use)">
                    <Check class="size-4" :class="o.use === use ? 'opacity-100' : 'opacity-0'" />
                    <span>{{ cap(o.label) }}</span>
                    <Badge class="ml-auto" :variant="tone(o)">{{ words(o) }}</Badge>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p class="flex flex-wrap gap-x-3 text-[12.5px] text-muted-foreground">
          <span v-for="g in groups" :key="g.key"><b class="font-semibold text-foreground">{{ g.options.length }}</b> {{ g.label.toLowerCase().replace('permitted ', '') }}</span>
        </p>
      </div>

      <div v-if="loading && !pick" class="flex flex-col gap-3"><Skeleton class="h-20 w-full" /><Skeleton class="h-48 w-full" /></div>
      <template v-if="pick">
        <!-- is it permissible -->
        <div class="flex flex-col gap-2 rounded-lg border px-4 py-3" :class="verdictBox">
          <p class="text-[15px]">
            <b class="font-semibold">{{ cap(pickLabel) }}</b> is <b class="font-semibold">{{ verdictWords }}</b> in Zone {{ data.lot?.zone }} on this lot.
          </p>
          <p class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>Set by</span>
            <ClausePill v-for="l in pick.permission!.by" :key="l" :label="l" :clause="pick.clauses[l]" @open="emit('trace', { use: pick.use!, topic: 'permissibility' })" />
            <span v-if="!pick.permission!.by.length">no clause - </span>
            <button v-if="!pick.permission!.by.length" type="button" class="text-primary underline" @click="emit('trace', { use: pick.use!, topic: 'permissibility' })">see why</button>
          </p>
          <p v-for="(s, i) in pick.permission!.steps" :key="i" class="text-[13px] text-muted-foreground">
            {{ s.winner }} prevails over {{ s.loser }}<span v-if="s.interpretive" class="text-open"> - a reading the text does not state, not yet verified</span>
          </p>
          <p v-if="pick.permission!.branches.length" class="text-[13px] text-muted-foreground">
            Turns on: {{ pick.permission!.branches.map(b => `${b.answer ?? 'no rule'} if ${b.if}`).join('; ') }}
          </p>
          <p v-if="pick.permission!.narrower?.length" class="text-[13px] text-open">
            {{ pick.permission!.by.join(', ') }} is about {{ pick.permission!.narrower.join(', ') }} only - see each kind below.
          </p>

          <div v-if="pick.permission!.kinds?.length" class="mt-1 grid gap-1.5">
            <div v-for="k in pick.permission!.kinds" :key="k.use" class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2">
              <button type="button" class="text-sm font-medium hover:text-primary hover:underline" @click="choose(k.use)">{{ cap(k.label) }}</button>
              <Badge :variant="k.verdict === 'permitted' ? 'ok' : k.verdict === 'prohibited' ? 'no' : 'open'">
                {{ k.verdict === 'permitted' ? (k.consent === 'without' ? 'no consent needed' : 'with consent') : k.verdict === 'prohibited' ? 'prohibited' : 'depends' }}
              </Badge>
              <span class="text-[12.5px] text-muted-foreground">{{ k.by.join(', ') }}</span>
            </div>
          </div>

          <Accordion v-if="pick.permission!.exceptions" type="single" collapsible class="rounded-md border bg-card px-3">
            <AccordionItem value="exceptions" class="border-0">
              <AccordionTrigger class="py-2 text-[13px]">
                <span>
                  {{ pick.permission!.exceptions.clause }} applies <i>unless</i> one of {{ pick.permission!.exceptions.items.length }} exceptions holds -
                  <b :class="pick.permission!.exceptions.outcome === 'stands' ? 'text-no' : pick.permission!.exceptions.outcome === 'lifted' ? 'text-ok' : 'text-open'">
                    {{ pick.permission!.exceptions.outcome === 'stands' ? 'this lot meets none' : pick.permission!.exceptions.outcome === 'lifted' ? 'this lot meets one' : 'not all can be tested' }}
                  </b>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ul class="grid gap-1 text-[13px]">
                  <li v-for="(it, i) in pick.permission!.exceptions.items" :key="i" class="flex gap-2">
                    <component :is="it.met === true ? CircleCheck : it.met === false ? CircleX : CircleHelp" class="mt-0.5 size-4 shrink-0" :class="it.met === true ? 'text-ok' : it.met === false ? 'text-no' : 'text-open'" />
                    <span>{{ cap(it.text) }} <span class="text-muted-foreground">- {{ it.how }}</span></span>
                  </li>
                </ul>
                <p class="mt-2 text-xs text-muted-foreground">
                  Read from the clause’s own words and tested on the lot{{ pick.permission!.exceptions.engineHas ? '; the engine holds these exceptions too.' : '; the engine was given this prohibition without its exceptions.' }}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <!-- every control -->
        <div v-if="pick.controls.length" class="overflow-hidden rounded-lg border bg-card" :class="{ 'opacity-60': pick.permission!.verdict === 'prohibited' && !byKind }">
          <Table>
            <TableHeader class="bg-muted/60">
              <TableRow>
                <TableHead class="text-[11px] uppercase tracking-wider">Control</TableHead>
                <TableHead class="text-[11px] uppercase tracking-wider">{{ cap(pickLabel) }}</TableHead>
                <TableHead class="text-[11px] uppercase tracking-wider">Set by</TableHead>
                <TableHead class="text-[11px] uppercase tracking-wider">This lot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="c in pick.controls" :key="c.key">
                <TableRow class="cursor-pointer align-top" @click="emit('trace', { use: pick.use!, topic: c.key })">
                  <TableCell class="py-3 font-medium">{{ c.label }}</TableCell>
                  <TableCell class="py-3">
                    <span v-if="c.verdict === 'decided'" class="text-[17px] font-semibold tabular-nums tracking-tight" :class="{ 'text-primary': c.sepp }">{{ fmt(c.key, c.value, c.unit) }}</span>
                    <span v-else class="text-[17px] font-semibold text-open">depends</span>
                    <span v-if="c.verdict === 'decided' && c.expr" class="block text-xs text-muted-foreground">{{ c.expr.replace(/m2/g, 'm²').replace(/ x /g, ' × ') }}</span>
                    <span v-else-if="c.candidates.length" class="block text-xs text-muted-foreground">{{ [...new Set(c.candidates.map(x => fmt(c.key === 'floor_area' && x.unit !== 'm2' ? 'fsr' : c.key, x.value, x.unit)))].join(', ') }} in contention</span>
                    <span v-else-if="c.branches.length" class="block text-xs text-muted-foreground">{{ [...new Set(c.branches.map(b => b.answer ? fmtAns(c.key, b.answer) : 'no limit'))].join(' or ') }}</span>
                  </TableCell>
                  <TableCell class="py-3" @click.stop>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <ClausePill v-for="l in c.by" :key="l" :label="l" :clause="pick.clauses[l]" @open="emit('trace', { use: pick.use!, topic: c.key })" />
                      <button v-if="!c.by.length" type="button" class="text-sm text-primary underline" @click="emit('trace', { use: pick.use!, topic: c.key })">see why</button>
                      <Badge v-if="c.sepp" variant="clause">SEPP</Badge>
                      <Badge v-if="c.nonDiscretionary" variant="outline" title="Non-discretionary: if it is met, consent cannot be refused on this ground">ND</Badge>
                    </div>
                    <p v-for="(s, i) in c.steps" :key="i" class="mt-1 text-xs text-muted-foreground">prevails over {{ s.loser }}<span v-if="s.interpretive" class="text-open"> (reading not verified)</span></p>
                    <p v-if="c.branches.length" class="mt-1 text-xs text-open">turns on: {{ turnsOn(c) }}</p>
                    <p v-if="c.otherBands.length" class="mt-1 text-xs text-muted-foreground">
                      other bands, not this lot: {{ c.otherBands.map(b => `${fmt(c.key, b.value, b.unit)} for ${b.band}`).join(' · ') }}
                    </p>
                  </TableCell>
                  <TableCell class="py-3 whitespace-nowrap">
                    <span v-if="lotCheck(c)" class="inline-flex items-center gap-1.5 text-sm tabular-nums">
                      <component :is="lotCheck(c)!.ok ? CircleCheck : CircleX" class="size-4" :class="lotCheck(c)!.ok ? 'text-ok' : 'text-no'" />{{ lotCheck(c)!.text }}
                    </span>
                  </TableCell>
                </TableRow>
                <!-- why a figure is not settled: each clause in contention, what its own words limit it to, and whether this lot meets it -->
                <TableRow v-if="c.why.length" class="bg-open-soft/60 hover:bg-open-soft/60">
                  <TableCell colspan="4" class="whitespace-normal py-3">
                    <p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-open">Why this is not settled</p>
                    <ul class="grid gap-1 text-[13px]">
                      <li v-for="(w, i) in c.why" :key="i" class="flex gap-2" :class="{ 'text-muted-foreground': w.reaches === false }">
                        <component :is="w.reaches === false ? CircleX : w.reaches ? CircleCheck : CircleHelp" class="mt-0.5 size-4 shrink-0" :class="w.reaches === false ? 'text-no' : w.reaches ? 'text-ok' : 'text-open'" />
                        <span>
                          <b :class="{ 'line-through decoration-faint': w.reaches === false }">{{ w.label }}</b> {{ fmt(c.key === 'floor_area' && w.unit !== 'm2' ? 'fsr' : c.key, w.value, w.unit) }} -
                          <template v-if="w.limits.length">its text limits it to {{ w.limits.map(l => l.text).join('; and to ') }}</template>
                          <template v-else>no limit in its text, it applies to this lot</template>
                          <span v-if="!w.engineTested && w.limits.length" class="text-open"> · the engine was given this clause without these conditions</span>
                        </span>
                      </li>
                    </ul>
                    <p class="mt-2 text-[13px]">
                      <template v-if="c.likely">
                        Setting aside the clauses whose own words exclude this lot: <b>{{ likelyText(c) }}</b> ({{ c.likely.by.join(', ') }}).
                        <span class="text-muted-foreground">Read from the clauses’ text, not decided by the engine.</span>
                      </template>
                      <template v-else>The clauses’ own words do not narrow it to one figure here.</template>
                    </p>
                  </TableCell>
                </TableRow>
              </template>
            </TableBody>
          </Table>
        </div>
        <p v-else class="text-muted-foreground">No development standard in the plans reaches {{ pickLabel }} on this lot.</p>

        <!-- what else the permission carries -->
        <div v-if="otherConditions.length" class="flex flex-col gap-1.5">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">Other conditions on the permission</p>
          <ul class="grid gap-1 text-[13px]">
            <li v-for="(c, i) in otherConditions" :key="i" class="flex flex-wrap gap-x-2">
              <b class="font-medium">{{ c.label }}</b><span v-if="c.detail" class="text-muted-foreground">{{ c.detail }}</span>
              <Badge :variant="c.status === 'met' ? 'ok' : c.status === 'not met' ? 'no' : 'outline'">{{ c.status }}</Badge>
            </li>
          </ul>
        </div>

        <!-- where the lot sits in a mapped area that reaches this use -->
        <div v-if="pick.areas.length" class="flex flex-col gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">Mapped areas on this lot that reach {{ pickLabel }}</p>
          <div class="grid gap-2.5 sm:grid-cols-2">
            <div v-for="a in pick.areas" :key="a.map + a.label" class="flex gap-3 rounded-lg border bg-card p-2.5">
              <svg :viewBox="areaBox(a)" class="size-24 shrink-0 rounded-md bg-muted">
                <g transform="scale(1 -1)">
                  <polygon v-for="(r, i) in a.areaRings" :key="i" :points="pts(r)" class="fill-primary/20 stroke-primary" stroke-width="0.6" />
                  <polygon :points="pts(a.lotRing)" class="fill-none stroke-foreground" stroke-width="1.4" />
                </g>
              </svg>
              <div class="min-w-0 text-[13px]">
                <p class="mb-1"><b class="font-semibold">{{ cap(a.label) }}</b> on the {{ mapName(a.map) }} Map <span class="text-muted-foreground">· {{ a.coverPct }}% of the lot</span></p>
                <ul class="grid gap-0.5">
                  <li v-for="(c, i) in a.claims" :key="i"><b class="font-medium">{{ c.label }}</b><span v-if="c.heading" class="text-muted-foreground"> {{ c.heading }}</span> - {{ claimWords(c) }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </template>
      <p class="text-xs text-faint">
        The RAG engine over {{ data.plan }} and the SEPPs. The list holds every use the plans’ Dictionary defines and a clause names;
        each control is the figure that wins for that use on this lot once the plans’ precedence is applied. Hover a clause to read it; click a row for the full trace.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronsUpDown, CircleCheck, CircleHelp, CircleX } from 'lucide-vue-next'
import type { BuildArea, BuildControl, BuildResponse } from '../../server/api/report/build-controls.get'

/** `select` - a use chosen elsewhere on the page (the summary band's chips) */
const props = defineProps<{ cadid: string; select?: string | null }>()
/** `use` - the chosen use (the engine's key and the Dictionary's spelling), so the page can site the same thing */
const emit = defineEmits<{ trace: [{ use: string; topic: string }]; use: [{ use: string; label: string }] }>()

const data = ref<BuildResponse | null>(null)
const pick = ref<BuildResponse | null>(null)
const error = ref('')
const loading = ref(false)
const use = ref<string>('')
const openPick = ref(false)
function choose(u: string) { use.value = u; openPick.value = false }
watch(() => props.select, (u) => { if (u && data.value?.options.some(o => o.use === u)) use.value = u })

watch(() => props.cadid, async (id) => {
  data.value = null; pick.value = null; error.value = ''; use.value = ''
  if (!id) return
  try {
    const r = await $fetch<BuildResponse>('/api/report/build-controls', { query: { cadid: id } })
    if (props.cadid !== id) return
    data.value = r
    // start on the first kind of housing this lot permits (an MU1 lot that bars dwelling houses opened on "advertising
    // structure", the first permitted use alphabetically), else the first use permitted at all
    const HOUSING = ['dwelling house', 'dual occupancy', 'semi-detached dwelling', 'multi dwelling housing', 'residential flat building', 'shop top housing']
    use.value = HOUSING.map(h => r.options.find(o => o.label.toLowerCase() === h && o.verdict === 'permitted')?.use).find(Boolean)
      ?? r.options.find(o => o.verdict === 'permitted')?.use ?? r.options[0]?.use ?? ''
  } catch (e: any) { error.value = e?.data?.message || e?.message || 'Could not ask the plans.' }
}, { immediate: true })

watch(use, async (u) => {
  if (!u) return
  emit('use', { use: u, label: data.value?.options.find(o => o.use === u)?.label ?? u })
  const id = props.cadid
  loading.value = true
  try {
    const r = await $fetch<BuildResponse>('/api/report/build-controls', { query: { cadid: id, use: u } })
    if (props.cadid === id && use.value === u) pick.value = r
  } catch (e: any) { error.value = e?.data?.message || e?.message || 'Could not resolve the controls.' }
  finally { loading.value = false }
})

const GROUPS = [
  { key: 'without', label: 'Permitted without consent' },
  { key: 'with', label: 'Permitted with consent' },
  { key: 'maybe', label: 'Depends' },
  { key: 'prohibited', label: 'Prohibited' },
] as const
const groupOf = (o: BuildResponse['options'][number]) => (o.verdict === 'permitted' ? (o.consent === 'without' ? 'without' : 'with') : o.verdict)
const groups = computed(() => GROUPS.map(g => ({ ...g, options: (data.value?.options ?? []).filter(o => groupOf(o) === g.key) })).filter(g => g.options.length))
const counts = computed(() => groups.value.map(g => `${g.options.length} ${g.label.toLowerCase()}`).join(' · '))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
type Opt = BuildResponse['options'][number]
const currentOption = computed(() => data.value?.options.find(o => o.use === use.value) ?? null)
const tone = (o: Opt) => (o.verdict === 'permitted' ? 'ok' : o.verdict === 'prohibited' ? 'no' : 'open') as 'ok' | 'no' | 'open'
const words = (o: Opt) => (o.verdict === 'permitted' ? (o.consent === 'without' ? 'no consent' : 'with consent') : o.verdict === 'prohibited' ? 'prohibited' : 'depends')
const pickOption = computed(() => data.value?.options.find(o => o.use === pick.value?.use))
const pickLabel = computed(() => pickOption.value?.label ?? pick.value?.use ?? '')
/** the answer rests on a clause about one kind, and the kinds do not agree: the honest headline is "depends on the kind" */
const byKind = computed(() => {
  const p = pick.value?.permission
  return !!p?.narrower?.length && new Set((p.kinds ?? []).map(k => `${k.verdict}|${k.consent}`)).size > 1
})
const verdictBox = computed(() => ({ yes: 'border-ok-line bg-ok-soft', no: 'border-no-line bg-no-soft', open: 'border-open-line bg-open-soft' } as const)[verdictTone.value])
const verdictTone = computed(() => (byKind.value ? 'open' : pick.value?.permission?.verdict === 'permitted' ? 'yes' : pick.value?.permission?.verdict === 'prohibited' ? 'no' : 'open'))
const verdictWords = computed(() => {
  const p = pick.value?.permission
  if (!p) return ''
  if (byKind.value) return 'different for each kind'
  return p.verdict === 'permitted' ? (p.consent === 'without' ? 'permitted without consent' : 'permitted with consent') : p.verdict === 'prohibited' ? 'prohibited' : 'undecided - it depends'
})

const TOPIC_UNIT: Record<string, string> = { height: 'm', lot_width: 'm', lot_size: 'm2', floor_area: 'm2' }
const num = (v: number) => (+v.toFixed(2)).toLocaleString('en-AU')
function fmt(topic: string, v: number | null | undefined, unit0: string | null | undefined): string {
  if (v == null) return '—'
  const unit = unit0 || TOPIC_UNIT[topic] || null
  if (topic === 'fsr' || unit === 'ratio') return `${num(v)}:1`
  if (unit === 'm2') return `${num(v)} m²`
  if (unit === 'm') return `${num(v)} m`
  if (unit === '%') return `${num(v)}%`
  return `${num(v)}${unit ? ` ${unit}` : ''}`
}
const fmtAns = (topic: string, a: string) => (/^[\d.]+$/.test(a.trim()) ? fmt(topic, Number(a), null) : a.replace(/\bm2\b/, 'm²'))
function turnsOn(c: BuildControl) {
  const facts = [...new Set(c.branches.map(b => b.if.replace(/^not /, '')))]
  const first = facts[0] ?? ''
  return `${first.length > 90 ? `${first.slice(0, 90)}…` : first}${facts.length > 1 ? ` (and ${facts.length - 1} more)` : ''}`
}
/** the figure the clauses' own words leave standing; a floor area left as a ratio is applied to the site area */
function likelyText(c: BuildControl) {
  const l = c.likely!
  if (c.key === 'floor_area' && l.unit !== 'm2' && l.value != null) {
    const a = data.value?.lot?.areaM2
    return `${fmt('fsr', l.value, null)}${a ? ` × ${Math.round(a).toLocaleString('en-AU')} m² = ${num(l.value * a)} m²` : ''}`
  }
  return fmt(c.key, l.value, l.unit)
}
/** a minimum the lot itself has to clear, measured against the lot */
function lotCheck(c: BuildControl) {
  const l = data.value?.lot
  if (c.verdict !== 'decided' || c.value == null || !l) return null
  if (c.key === 'lot_size' && l.areaM2 != null) return { ok: l.areaM2 >= c.value, text: `${Math.round(l.areaM2).toLocaleString('en-AU')} m²` }
  if (c.key === 'lot_width' && l.frontageM != null) return { ok: l.frontageM >= c.value, text: `${num(l.frontageM)} m frontage` }
  return null
}
/** the permission's conditions that are not already a row of the table */
const otherConditions = computed(() => (pick.value?.permission?.conditions ?? [])
  .filter(c => !/floor space ratio|building height|^maximum height|lot size|lot width|floor area|parking/i.test(c.label)))

const pts = (r: number[][]) => r.map(p => `${p[0]},${p[1]}`).join(' ')
const mapName = (s: string) => s.split(' ').map((w, i) => (i && ['of', 'on', 'the', 'and', 'for'].includes(w) ? w : cap(w))).join(' ')
function areaBox(a: BuildArea) {
  const xs = a.lotRing.map(p => p[0]!); const ys = a.lotRing.map(p => p[1]!)
  const pad = Math.max(12, (Math.max(...xs) - Math.min(...xs)) * 0.6)
  const x0 = Math.min(...xs) - pad; const x1 = Math.max(...xs) + pad
  const y0 = Math.min(...ys) - pad; const y1 = Math.max(...ys) + pad
  const s = Math.max(x1 - x0, y1 - y0)
  return `${(x0 + x1) / 2 - s / 2} ${-((y0 + y1) / 2) - s / 2} ${s} ${s}`
}
function claimWords(c: BuildArea['claims'][number]) {
  if (c.kind === 'standard') return `${(c.topic ?? 'standard').replace('_', ' ')} ${fmt(c.topic ?? '', c.value, c.unit)}`
  if (c.kind === 'permit') return 'permits it here'
  if (c.kind === 'prohibit') return 'prohibits it here'
  if (c.kind === 'frame') return 'the clause applies here'
  return c.kind
}
</script>
