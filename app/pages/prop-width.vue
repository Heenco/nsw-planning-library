<template>
  <PropWidthMap v-bind="LOT_METRICS_3" />
</template>

<script setup lang="ts">
/**
 * The page is a thin wrapper: everything lives in components/PropWidthMap.vue
 * so /prop-width and /prop-width-gnaf cannot drift apart. Which dataset each
 * one draws is the only difference between them, and it is declared in
 * shared/prop-width-variants.ts.
 */
import { LOT_METRICS_3 } from '#shared/prop-width-variants'
</script>
