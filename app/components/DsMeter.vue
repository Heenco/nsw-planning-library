<!--
  <DsMeter>

  One share against its target, for the accuracy figures on /datasources:
  a label, the percentage, a bar, and the counts behind it.

  The bar's fill carries the state (good, caution, needs attention) and its
  track is a lighter step of the same hue, so the state reads across the whole
  bar. The state is also written out with a symbol, never shown by colour alone,
  and the count of rows that did not match is printed, because at 99% the bar
  alone cannot show the difference between 3,000 misses and 30,000.
-->

<template>
  <div class="mt" :class="`mt--${state}`">
    <div class="mt-row">
      <span class="mt-label">{{ label }}</span>
      <span class="mt-value">{{ percent }}</span>
    </div>
    <div
      class="mt-track"
      role="meter"
      :aria-valuenow="ratio == null ? undefined : Math.round(ratio * 1000) / 10"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${label}: ${percent}`"
    >
      <div class="mt-fill" :style="{ width: `${Math.max(0, Math.min(1, ratio ?? 0)) * 100}%` }" />
    </div>
    <div class="mt-foot">
      <span class="mt-state"><span class="mt-icon" aria-hidden="true">{{ ICON[state] }}</span>{{ STATE_LABEL[state] }}</span>
      <span v-if="denominator" class="mt-counts">
        {{ numerator.toLocaleString('en-AU') }} of {{ denominator.toLocaleString('en-AU') }}<template v-if="missing"> · {{ missing.toLocaleString('en-AU') }} {{ missingLabel }}</template>
      </span>
      <span v-if="note" class="mt-note">{{ note }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  numerator: number
  denominator: number
  good: number
  poor: number
  note?: string
  missingLabel?: string
}>(), { note: '', missingLabel: 'did not match' })

type State = 'good' | 'caution' | 'poor' | 'unknown'
const ICON: Record<State, string> = { good: '✓', caution: '!', poor: '✕', unknown: '?' }
const STATE_LABEL: Record<State, string> = { good: 'Good', caution: 'Worth knowing', poor: 'Needs attention', unknown: 'Not measured' }

const ratio = computed(() => (props.denominator ? props.numerator / props.denominator : null))
const missing = computed(() => Math.max(0, props.denominator - props.numerator))
const state = computed<State>(() => {
  if (ratio.value == null) return 'unknown'
  if (ratio.value >= props.good) return 'good'
  if (ratio.value < props.poor) return 'poor'
  return 'caution'
})
const percent = computed(() => {
  if (ratio.value == null) return 'n/a'
  const p = ratio.value * 100
  return `${p >= 99.95 && p < 100 ? '99.9' : p.toFixed(p >= 10 ? 1 : 2)}%`
})
</script>

<style scoped>
.mt { --fill: #94a3b8; --track: #e2e8f0; --ink: #475569; }
.mt--good { --fill: #15803d; --track: #dcfce7; --ink: #166534; }
.mt--caution { --fill: #b45309; --track: #fef3c7; --ink: #92400e; }
.mt--poor { --fill: #b91c1c; --track: #fee2e2; --ink: #991b1b; }

.mt-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; margin-bottom: 0.3rem; }
.mt-label { font-size: 0.85rem; font-weight: 600; color: #0f172a; }
.mt-value { font-size: 0.95rem; font-weight: 700; color: #0f172a; }

.mt-track { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
.mt-fill { height: 100%; border-radius: 4px; background: var(--fill); transition: width 0.4s ease; }

.mt-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.9rem; margin-top: 0.35rem; font-size: 0.74rem; color: #64748b; }
.mt-state { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 700; color: var(--ink); }
.mt-icon {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fill);
  color: #fff;
  font-size: 9px;
  line-height: 1;
}
.mt-counts { font-variant-numeric: tabular-nums; }
</style>
