<!--
  ClausePill - a clause reference ("cl 4.4(2)") that shows the clause's words on hover and opens the trace on click.
  The words come from the endpoint that cited the clause (BuildResponse.clauses); without them the pill is a plain button.
-->
<template>
  <HoverCard v-if="clause?.text" :open-delay="150" :close-delay="80">
    <HoverCardTrigger as-child>
      <button type="button" :class="pill" @click="emit('open')">{{ short }}</button>
    </HoverCardTrigger>
    <HoverCardContent class="w-80 text-sm leading-relaxed" align="start">
      <p class="mb-1 font-semibold">{{ label }}<span v-if="clause.heading" class="font-normal text-muted-foreground"> · {{ clause.heading }}</span></p>
      <p class="text-muted-foreground">“{{ clause.text }}”</p>
      <p class="mt-2 text-xs text-primary">Click for how the engine reached the figure</p>
    </HoverCardContent>
  </HoverCard>
  <button v-else type="button" :class="pill" @click="emit('open')">{{ short }}</button>
</template>

<script setup lang="ts">
const props = defineProps<{ label: string; clause?: { heading: string | null; text: string } | null }>()
const emit = defineEmits<{ open: [] }>()

const pill = 'inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 font-mono text-[12px] text-accent-foreground hover:ring-1 hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-primary cursor-pointer text-left break-words max-w-full'
/** "Parramatta LEP cl 4.4(2)" reads as "cl 4.4(2)" inside a report that already names the plan; a SEPP keeps its name */
const short = computed(() => (/\bSEPP\b/.test(props.label) ? props.label.replace(/^Housing SEPP /, 'Housing SEPP ') : props.label.replace(/^.*?\bLEP\s+/, '')))
</script>
