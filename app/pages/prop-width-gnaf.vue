<template>
  <PropWidthMap v-bind="LOT_METRICS_GNAF" />
</template>

<script setup lang="ts">
/**
 * /prop-width over lot_metrics_gnaf instead of lot_metrics_3 — see
 * shared/prop-width-variants.ts for what differs between the two datasets.
 */
import { LOT_METRICS_GNAF } from '#shared/prop-width-variants'
</script>
