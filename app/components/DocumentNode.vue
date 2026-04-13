<script setup lang="ts">
import type { LegalStructureNode } from '~/types/epi'

const props = defineProps<{
  node: LegalStructureNode
  childrenMap: Map<string, string[]>
  nodeMap: Map<string, LegalStructureNode>
}>()

const children = computed(() => {
  const ids = props.childrenMap.get(props.node.id) ?? []
  return ids
    .map(id => props.nodeMap.get(id))
    .filter((n): n is LegalStructureNode => !!n && n.kind !== 'reference')
})

const headingTag = computed(() => {
  switch (props.node.kind) {
    case 'part':
    case 'schedule':
      return 'h2'
    case 'section':
      return 'h3'
    case 'clause':
      return 'h4'
    default:
      return null
  }
})
</script>

<template>
  <!-- Part / Schedule -->
  <section v-if="node.kind === 'part' || node.kind === 'schedule'" :id="'doc-' + node.id" class="dn-part">
    <h2 class="dn-part-heading">
      <span v-if="node.number" class="dn-part-num">{{ node.number }}</span>
      <span class="dn-part-title">{{ node.title }}</span>
    </h2>
    <DocumentNode v-for="child in children" :key="child.id"
      :node="child" :children-map="childrenMap" :node-map="nodeMap" />
  </section>

  <!-- Section (e.g. "1.1 Name of Plan") -->
  <section v-else-if="node.kind === 'section'" :id="'doc-' + node.id" class="dn-section">
    <h3 class="dn-section-heading">
      <span v-if="node.number" class="dn-section-num">{{ node.number }}</span>
      {{ node.title }}
    </h3>
    <p v-if="node.text" class="dn-text">{{ node.text }}</p>
    <DocumentNode v-for="child in children" :key="child.id"
      :node="child" :children-map="childrenMap" :node-map="nodeMap" />
  </section>

  <!-- Clause (e.g. "1.1AA Commencement") -->
  <div v-else-if="node.kind === 'clause'" :id="'doc-' + node.id" class="dn-clause">
    <h4 class="dn-clause-heading">
      <span v-if="node.number" class="dn-clause-num">{{ node.number }}</span>
      {{ node.title }}
    </h4>
    <p v-if="node.text" class="dn-text">{{ node.text }}</p>
    <DocumentNode v-for="child in children" :key="child.id"
      :node="child" :children-map="childrenMap" :node-map="nodeMap" />
  </div>

  <!-- Subclause — "(1) This Plan is …" -->
  <div v-else-if="node.kind === 'subclause'" :id="'doc-' + node.id" class="dn-subclause">
    <div v-if="node.number || node.text" class="dn-subclause-row">
      <span v-if="node.number" class="dn-subclause-num">{{ node.number }}</span>
      <span v-if="node.text" class="dn-subclause-text">{{ node.text }}</span>
    </div>
    <div v-if="children.length" class="dn-subclause-children">
      <DocumentNode v-for="child in children" :key="child.id"
        :node="child" :children-map="childrenMap" :node-map="nodeMap" />
    </div>
  </div>

  <!-- List item — "(a) residential accommodation" -->
  <div v-else-if="node.kind === 'list-item'" :id="'doc-' + node.id" class="dn-list-item">
    <div class="dn-list-item-row">
      <span v-if="node.number" class="dn-list-item-num">{{ node.number }}</span>
      <span v-if="node.text" class="dn-list-item-text">{{ node.text }}</span>
    </div>
    <div v-if="children.length" class="dn-list-item-children">
      <DocumentNode v-for="child in children" :key="child.id"
        :node="child" :children-map="childrenMap" :node-map="nodeMap" />
    </div>
  </div>

  <!-- Definition — bold term -->
  <div v-else-if="node.kind === 'definition'" :id="'doc-' + node.id" class="dn-definition">
    <strong>{{ node.title }}</strong>
    <span v-if="node.text"> — {{ node.text }}</span>
    <DocumentNode v-for="child in children" :key="child.id"
      :node="child" :children-map="childrenMap" :node-map="nodeMap" />
  </div>

  <!-- Paragraph -->
  <p v-else-if="node.kind === 'paragraph'" :id="'doc-' + node.id" class="dn-paragraph">
    {{ node.text }}
  </p>

  <!-- Fallback for any other kind -->
  <div v-else :id="'doc-' + node.id" class="dn-fallback">
    <span v-if="node.number" class="dn-fallback-num">{{ node.number }}</span>
    <span v-if="node.text">{{ node.text }}</span>
    <span v-else-if="node.title">{{ node.title }}</span>
    <DocumentNode v-for="child in children" :key="child.id"
      :node="child" :children-map="childrenMap" :node-map="nodeMap" />
  </div>
</template>

<style scoped>
/* ── Part / Schedule ──────────────────────────────────────────────────── */
.dn-part {
  margin-bottom: 2.5rem;
}
.dn-part-heading {
  font-size: 1.35rem;
  font-weight: 700;
  color: #0f172a;
  margin: 2rem 0 1rem;
  padding-bottom: 0.6rem;
  border-bottom: 2px solid #15803d;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.dn-part-num {
  color: #15803d;
  font-weight: 700;
}
.dn-part-title {
  color: #0f172a;
}

/* ── Section (e.g. "1.1 Name of Plan") ────────────────────────────────── */
.dn-section {
  margin-bottom: 1.5rem;
}
.dn-section-heading {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1e293b;
  margin: 1.5rem 0 0.5rem;
}
.dn-section-num {
  margin-right: 0.5rem;
  color: #1e293b;
  font-weight: 700;
}

/* ── Clause ────────────────────────────────────────────────────────────── */
.dn-clause {
  margin-bottom: 1rem;
  margin-left: 0.25rem;
}
.dn-clause-heading {
  font-size: 1rem;
  font-weight: 600;
  color: #334155;
  margin: 1rem 0 0.35rem;
  font-style: italic;
}
.dn-clause-num {
  margin-right: 0.4rem;
  font-style: normal;
  color: #334155;
}

/* ── Subclause — "(1) text …" ─────────────────────────────────────────── */
.dn-subclause {
  margin: 0.3rem 0;
  margin-left: 1.5rem;
}
.dn-subclause-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.dn-subclause-num {
  flex-shrink: 0;
  min-width: 2rem;
  color: #475569;
  font-weight: 500;
}
.dn-subclause-text {
  color: #1e293b;
}
.dn-subclause-children {
  margin-left: 0.5rem;
}

/* ── List item — "(a) text …" ─────────────────────────────────────────── */
.dn-list-item {
  margin: 0.15rem 0;
  margin-left: 2rem;
}
.dn-list-item-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.dn-list-item-num {
  flex-shrink: 0;
  min-width: 1.8rem;
  color: #475569;
}
.dn-list-item-text {
  color: #1e293b;
}
.dn-list-item-children {
  margin-left: 0.5rem;
}

/* ── Definition ───────────────────────────────────────────────────────── */
.dn-definition {
  margin: 0.35rem 0;
  margin-left: 1.5rem;
  font-size: 0.92rem;
  color: #1e293b;
}

/* ── Paragraph ────────────────────────────────────────────────────────── */
.dn-paragraph {
  margin: 0.35rem 0;
  color: #1e293b;
  line-height: 1.7;
}

/* ── Fallback ─────────────────────────────────────────────────────────── */
.dn-fallback {
  margin: 0.2rem 0;
  margin-left: 1rem;
  color: #334155;
}
.dn-fallback-num {
  margin-right: 0.4rem;
  color: #475569;
}
</style>
