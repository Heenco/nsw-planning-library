<!--
  RagClause - a provision as a link to the NSW legislation (its own anchor), with its words one click away.
  p: { label, url, text, stem, heading } from /api/rag/question's provisions map; fallback: the label when the provision
  is not held.
-->
<template>
  <span class="rc">
    <a v-if="p?.url" :href="p.url" target="_blank" rel="noopener" class="rc-link">{{ p.label ?? fallback }}</a>
    <strong v-else>{{ p?.label ?? fallback }}</strong>
    <button v-if="p?.text || p?.stem" type="button" class="rc-toggle" :aria-expanded="open" @click="open = !open">{{ open ? 'hide text' : 'text' }}</button>
    <span v-if="open" class="rc-text">
      <span v-if="p.stem && p.stem !== p.text" class="rc-stem">{{ p.stem }} </span>{{ p.text }}
    </span>
  </span>
</template>

<script setup lang="ts">
defineProps<{ id?: string | null; p?: any; fallback?: string }>()
const open = ref(false)
</script>

<style scoped>
.rc-link { color: #4338ca; text-decoration: none; font-weight: 600; }
.rc-link:hover { text-decoration: underline; }
.rc-toggle { margin-left: 4px; font-size: 10px; padding: 0 5px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #475569; cursor: pointer; }
.rc-text { display: block; margin: 3px 0 3px 0; padding: 6px 9px; background: #f8fafc; border-left: 3px solid #c7d2fe; font-size: 12px; color: #334155; white-space: pre-wrap; }
.rc-stem { color: #64748b; }
</style>
