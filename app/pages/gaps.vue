<!--
  /gaps - what the rule pipeline does not cover yet, and how big each one is.

  A worklist, not a wishlist. Every entry in shared/planning-gaps.ts carries the measurement behind
  it, taken from planningai on the date shown, so its size can be argued with rather than guessed
  at. The closed ones stay on the page so progress is visible and nobody re-finds a fixed bug.
-->
<template>
  <div class="gp-page">
    <header class="gp-header">
      <NuxtLink to="/" class="gp-back">&larr; Home</NuxtLink>
      <h1 class="gp-title">Gaps</h1>
      <p class="gp-lead">
        What the rule pipeline does not cover yet. Each one carries the measurement behind it, so it can be
        argued with rather than guessed at &mdash; taken from <code>planningai</code> on {{ MEASURED_AT }}.
        The fixed ones stay here so nobody re-finds them.
      </p>
    </header>

    <p class="gp-chips">
      <button v-for="s in STATUSES" :key="s" type="button" class="gp-chip"
              :class="[{ 'gp-chip--on': status === s }, 'gp-chip--' + s]" @click="status = s">
        {{ s }} <strong>{{ s === 'all' ? PLANNING_GAPS.length : PLANNING_GAPS.filter(g => g.status === s).length }}</strong>
      </button>
      <span class="gp-sep" />
      <button v-for="a in AREAS" :key="a" type="button" class="gp-chip"
              :class="{ 'gp-chip--on': area === a }" @click="area = a">
        {{ a }} <strong>{{ a === 'all' ? PLANNING_GAPS.length : PLANNING_GAPS.filter(g => g.area === a).length }}</strong>
      </button>
    </p>

    <p class="gp-count">{{ shown.length }} of {{ PLANNING_GAPS.length }}</p>

    <article v-for="g in shown" :key="g.id" :data-gap="g.id" class="gp-gap" :class="'gp-gap--' + g.status">
      <h2 class="gp-h2">
        <span class="gp-status" :class="'gp-status--' + g.status">{{ g.status }}</span>
        {{ g.title }}
        <span class="gp-tags">
          <span class="gp-tag">{{ g.area }}</span>
          <span class="gp-tag gp-tag--effort" :title="EFFORT[g.effort]">{{ g.effort }}</span>
          <code class="gp-id">{{ g.id }}</code>
        </span>
      </h2>

      <p class="gp-what">{{ g.what }}</p>

      <p v-if="g.blockedBy?.length" class="gp-blocked">
        Blocked by
        <button v-for="b in g.blockedBy" :key="b" type="button" class="gp-link" @click="jump(b)">{{ b }}</button>
      </p>

      <div class="gp-cols">
        <div>
          <h3 class="gp-h3">Measured</h3>
          <ul class="gp-ev"><li v-for="(e, i) in g.evidence" :key="i">{{ e }}</li></ul>
        </div>
        <div>
          <h3 class="gp-h3">What it costs</h3>
          <p class="gp-impact">{{ g.impact }}</p>
          <template v-if="g.resolution">
            <h3 class="gp-h3">{{ g.status === 'fixed' ? 'How it was closed' : 'Done so far' }}</h3>
            <p class="gp-impact">{{ g.resolution }}</p>
          </template>
          <p v-if="g.where?.length" class="gp-where">
            <code v-for="(w, i) in g.where" :key="i">{{ w }}</code>
          </p>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { MEASURED_AT, PLANNING_GAPS } from '#shared/planning-gaps'

useHead({ title: 'Gaps · Planning Library' })

const STATUSES = ['all', 'open', 'partial', 'fixed'] as const
const AREAS = ['all', 'extraction', 'representation', 'lot data', 'currency', 'corpus', 'architecture'] as const
const EFFORT: Record<string, string> = { S: 'days', M: 'about a week', L: 'longer, or needs a design first' }

const status = ref<string>('open')
const area = ref<string>('all')

// open first, then partial, then fixed; within a status, the heavier ones last
const ORDER: Record<string, number> = { open: 0, partial: 1, fixed: 2 }
const shown = computed(() => PLANNING_GAPS
  .filter(g => (status.value === 'all' || g.status === status.value) && (area.value === 'all' || g.area === area.value))
  .slice()
  .sort((a, b) => ORDER[a.status]! - ORDER[b.status]! || a.effort.localeCompare(b.effort)))

function jump(id: string) {
  status.value = 'all'
  area.value = 'all'
  nextTick(() => document.querySelector(`[data-gap="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}
</script>

<style scoped>
.gp-page { max-width: 1060px; margin: 0 auto; padding: 24px 16px 64px; color: #0f172a;
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.gp-back { color: #6366f1; text-decoration: none; font-size: 12px; }
.gp-title { margin: 6px 0 4px; font-size: 26px; }
.gp-lead { margin: 0 0 18px; color: #475569; max-width: 78ch; }
.gp-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 6px; }
.gp-sep { width: 1px; height: 20px; background: #e2e8f0; margin: 0 6px; }
.gp-chip { padding: 4px 10px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 999px;
  background: #fff; cursor: pointer; color: #334155; }
.gp-chip:hover { background: #f8fafc; }
.gp-chip--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.gp-count { color: #64748b; font-size: 12px; margin: 0 0 14px; }

.gp-gap { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
.gp-gap--fixed { background: #f8fafc; }
.gp-h2 { font-size: 16px; margin: 0 0 6px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.gp-status { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; letter-spacing: .03em; }
.gp-status--open { background: #fee2e2; color: #7f1d1d; }
.gp-status--partial { background: #fef3c7; color: #78350f; }
.gp-status--fixed { background: #dcfce7; color: #14532d; }
.gp-tags { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.gp-tag { font-size: 11px; color: #475569; background: #f1f5f9; padding: 2px 7px; border-radius: 4px; font-weight: 400; }
.gp-tag--effort { font-weight: 700; }
.gp-id { font-size: 11px; color: #94a3b8; font-weight: 400; }
.gp-what { margin: 0 0 10px; color: #334155; }
.gp-blocked { margin: 0 0 10px; font-size: 12px; color: #b45309; }
.gp-link { background: #fef3c7; border: none; border-radius: 4px; padding: 1px 6px; cursor: pointer;
  font: inherit; color: #78350f; }
.gp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 760px) { .gp-cols { grid-template-columns: 1fr; } }
.gp-h3 { font-size: 12px; margin: 0 0 5px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.gp-ev { margin: 0; padding-left: 16px; font-size: 13px; color: #334155; }
.gp-ev li { margin-bottom: 3px; }
.gp-impact { margin: 0 0 10px; font-size: 13px; color: #334155; }
.gp-where { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 5px; }
.gp-where code { font-size: 11px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #475569; }
</style>
