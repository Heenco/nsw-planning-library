<!--
  /build-to-rent - Housing SEPP Chapter 3, Part 4 (s 72) on a map: where build-to-rent is permitted, and a
  verdict for any lot. Clauses in shared/build-to-rent.ts, the lot test in shared/housing-evaluate.ts.
-->
<template>
  <HousingMapPage page="btr" :spec="BUILD_TO_RENT" heading="Build-to-rent housing" />
</template>

<script setup lang="ts">
import { BUILD_TO_RENT } from '#shared/build-to-rent'

useHead({ title: 'Build-to-rent housing · Planning Library' })
</script>
