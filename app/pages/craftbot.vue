<!--
  /craftbot — CraftBot model viewer

  The viewer itself is a self-contained static three.js app vendored under
  public/craftbot-viewer (see PROVENANCE.md there). The folder is *-viewer and
  not /craftbot because a public/ directory shadows a page route of the same
  name — Nitro serves the directory and this page never renders. It is framed rather than ported
  into Vue: it owns its own GUI, import map, WebGL canvas and CSS, so wrapping
  it keeps it working exactly as upstream and re-copyable when upstream moves.

  It displays models; it does not generate them. Producing a model needs Blender
  running CraftBot's export pipeline offline.
-->

<template>
  <div class="cb-page">
    <header class="cb-header">
      <div class="cb-header-left">
        <NuxtLink to="/" class="cb-back">&larr; Home</NuxtLink>
        <h1 class="cb-title">3D Viewer</h1>
        <p class="cb-meta">
          Buildings designed as Blender Python — 14 model sets, 156 models
        </p>
      </div>
    </header>

    <!-- Query string is passed through so ?model=… deep links reach the viewer. -->
    <iframe
      :src="viewerSrc"
      class="cb-frame"
      title="CraftBot model viewer"
      allow="fullscreen"
    />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()

const viewerSrc = computed(() => {
  const qs = new URLSearchParams(route.query as Record<string, string>).toString()
  return `/craftbot-viewer/index.html${qs ? `?${qs}` : ''}`
})

useHead({ title: '3D Viewer — Australian Planning Library' })
</script>

<style scoped>
.cb-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fafafa;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Figtree", "Segoe UI", system-ui, sans-serif;
}

.cb-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 14px 24px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.cb-back {
  display: inline-block;
  font-size: 13px;
  color: #64748b;
  text-decoration: none;
  margin-bottom: 6px;
}
.cb-back:hover { color: #0f172a; }

.cb-title { font-size: 20px; font-weight: 700; margin: 0; color: #0f172a; }
.cb-meta { font-size: 12px; color: #64748b; margin: 4px 0 0; }

/* The viewer sizes itself to the frame, so the frame takes the rest of the page. */
.cb-frame {
  flex: 1;
  width: 100%;
  border: 0;
  display: block;
  min-height: 0;
}
</style>
