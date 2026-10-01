<!--
  /affordable-housing - the in-fill affordable housing bonus (Housing SEPP s 15C) on a map: the location
  tests, the exclusions, and a verdict for any lot. Clauses in shared/affordable-housing.ts, the lot test in
  shared/housing-evaluate.ts.
-->
<template>
  <HousingMapPage page="ahb" :spec="AFFORDABLE_HOUSING" heading="Affordable housing bonus" />
</template>

<script setup lang="ts">
import { AFFORDABLE_HOUSING } from '#shared/affordable-housing'

useHead({ title: 'Affordable housing bonus · Planning Library' })
</script>
