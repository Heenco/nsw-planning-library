<!--
  <DsSchemaMap>

  The NSW land and address tables as a map of boxes and connecting lines, for
  /datasources. Click a box for what the table is, its keys and its pitfalls;
  click a line for the fields that join two tables, how many rows match, and
  the SQL. Row counts and match rates come in as props from the live overview,
  so the drawing itself needs no fetch.

  The layout is fixed rather than computed: eleven boxes placed so no line
  crosses a box and no label touches a box or another label, with the address
  table at the centre because every route between land and addresses passes
  through it. Long key names sit on vertical or diagonal lines, where there is
  room; the two horizontal gaps that carry labels are widened to fit them.
-->

<template>
  <div class="sm">
    <div class="sm-canvas-wrap">
      <svg class="sm-canvas" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="How the NSW land and address tables connect">
        <!-- connections -->
        <g v-for="e in edges" :key="e.id" class="sm-edge-g" @click="select({ kind: 'edge', id: e.id })">
          <line
            :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
            class="sm-edge-hit"
          />
          <line
            :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
            class="sm-edge"
            :class="{ 'sm-edge--spatial': e.spatial, 'sm-edge--on': edgeOn(e), 'sm-edge--dim': edgeDim(e) }"
          />
          <g :transform="`translate(${e.mx}, ${e.my})`" :class="{ 'sm-dim': edgeDim(e) }">
            <rect :x="-e.labelW / 2" y="-10" :width="e.labelW" height="20" rx="10" class="sm-pill" :class="{ 'sm-pill--on': edgeOn(e) }" />
            <text y="4" class="sm-pill-text" :class="{ 'sm-pill-text--on': edgeOn(e) }">{{ e.label }}</text>
          </g>
        </g>

        <!-- tables -->
        <g
          v-for="n in nodes"
          :key="n.id"
          :transform="`translate(${n.x}, ${n.y})`"
          class="sm-node"
          :class="{ 'sm-node--on': selected.kind === 'table' && selected.id === n.id, 'sm-dim': nodeDim(n.id) }"
          tabindex="0"
          role="button"
          :aria-label="`${n.doc.title}: ${n.doc.schema}.${n.doc.label}`"
          @click="select({ kind: 'table', id: n.id })"
          @keydown.enter.prevent="select({ kind: 'table', id: n.id })"
        >
          <rect :width="NW" :height="NH" rx="10" class="sm-box" />
          <rect :width="6" :height="NH" rx="3" :fill="SCHEMA_COLOR[n.doc.schema]" />
          <text x="16" y="22" class="sm-name">{{ n.doc.label }}</text>
          <text x="16" y="39" class="sm-title">{{ NODE_TITLE[n.id] ?? n.doc.title }}</text>
          <text x="16" y="55" class="sm-meta">{{ rowText(n.doc) }}</text>
        </g>
      </svg>
    </div>

    <ul class="sm-legend">
      <li v-for="(label, key) in SCHEMA_LABEL" :key="key">
        <span class="sm-legend-dot" :style="{ background: SCHEMA_COLOR[key] }" />{{ label }}
        <code>{{ key }}</code>
      </li>
      <li><span class="sm-legend-line" />joined by a key</li>
      <li><span class="sm-legend-line sm-legend-line--spatial" />related by position</li>
    </ul>

    <!-- ── Detail: a table ─────────────────────────────────────────────── -->
    <section v-if="table" class="sm-detail" aria-live="polite">
      <header class="sm-detail-head">
        <span class="sm-badge" :style="{ borderColor: SCHEMA_COLOR[table.schema] }">
          <span class="sm-legend-dot" :style="{ background: SCHEMA_COLOR[table.schema] }" />{{ SCHEMA_LABEL[table.schema] }}
        </span>
        <h3 class="sm-detail-title">{{ table.title }}</h3>
        <code class="sm-detail-code">{{ tableNames(table) }}</code>
      </header>

      <p class="sm-lead">{{ table.plain }}</p>

      <dl class="sm-facts">
        <div><dt>One row is</dt><dd>{{ table.oneRowIs }}</dd></div>
        <div><dt>Shape</dt><dd>{{ GEOMETRY_LABEL[table.geometry] }}</dd></div>
        <div v-if="rowText(table)"><dt>Rows now</dt><dd>{{ rowText(table) }}</dd></div>
      </dl>

      <div class="sm-cols">
        <div>
          <h4 class="sm-h4">Keys</h4>
          <table class="sm-table">
            <tbody>
              <tr v-for="col in table.keys" :key="col.name">
                <th scope="row"><code>{{ col.name }}</code></th>
                <td>{{ col.meaning }}<span v-if="col.example" class="sm-example"> e.g. {{ col.example }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 class="sm-h4">Other useful columns</h4>
          <table class="sm-table">
            <tbody>
              <tr v-for="col in table.useful" :key="col.name">
                <th scope="row"><code>{{ col.name }}</code></th>
                <td>{{ col.meaning }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="table.watchOuts.length" class="sm-watch">
        <h4 class="sm-h4">Watch out</h4>
        <ul>
          <li v-for="w in table.watchOuts" :key="w">{{ w }}</li>
        </ul>
      </div>

      <div class="sm-connects">
        <h4 class="sm-h4">Connects to</h4>
        <ul class="sm-connect-list">
          <li v-for="e in edgesOf(table.id)" :key="e.id">
            <button type="button" class="sm-connect" @click="select({ kind: 'edge', id: e.id })">
              <span class="sm-connect-table">{{ docOf(e.a === table.id ? e.b : e.a).title }}</span>
              <span class="sm-connect-via">via {{ e.label }}</span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Detail: a connection ────────────────────────────────────────── -->
    <section v-else-if="edge" class="sm-detail" aria-live="polite">
      <header class="sm-detail-head">
        <h3 class="sm-detail-title">{{ docOf(edge.a).title }} and {{ docOf(edge.b).title }}</h3>
      </header>

      <article v-for="j in edgeJoins" :key="j.id" class="sm-join">
        <p class="sm-lead">{{ j.plain }}</p>
        <div class="sm-join-fields">
          <code>{{ fieldName(j.from) }}</code>
          <span class="sm-join-arrow" aria-hidden="true">=</span>
          <code>{{ fieldName(j.to) }}</code>
          <span class="sm-card">{{ j.cardinality }}</span>
        </div>
        <p v-if="j.when" class="sm-when"><strong>Only when</strong> {{ j.when }}.</p>

        <div v-for="id in j.checks ?? []" :key="id" class="sm-check">
          <DsMeter
            :label="checkOf(id)?.title ?? id"
            :numerator="measured(id).numerator"
            :denominator="measured(id).denominator"
            :good="checkOf(id)?.good ?? 0.99"
            :poor="checkOf(id)?.poor ?? 0.95"
            :note="measured(id).note"
          />
        </div>

        <details class="sm-sql">
          <summary>Show SQL</summary>
          <pre><code>{{ joinSql(j) }}</code></pre>
        </details>
      </article>

      <button type="button" class="sm-back" @click="select({ kind: 'table', id: edge.a })">
        &larr; {{ docOf(edge.a).title }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  JOINS, QUALITY_CHECKS, SCHEMA_COLOR, SCHEMA_LABEL, TABLES,
  type JoinDoc, type TableDoc, type TableId,
} from '#shared/datasources-nsw'

const props = defineProps<{
  /** "schema.table" → rows in the latest load. */
  rows: Record<string, number>
  /** check id → latest measurement, when the accuracy script has run. */
  checks: Record<string, { numerator: number; denominator: number; measuredAt: string }>
}>()

const W = 1080
const H = 544
const NW = 180
const NH = 64

// Columns at 20, 290, 610 and 880: the 140 px gap before the third column holds
// the "propid, sppropid" and "lot_cadid" labels on horizontal lines.
const POSITIONS: Record<TableId, [number, number]> = {
  'epi.layers': [20, 30],
  'cadastre.lot': [290, 30],
  'integrated_address.point_address': [610, 30],
  'guras.addresspoint': [880, 30],
  'cadastre.other': [20, 240],
  'guras.propertylot': [290, 240],
  'guras.addressstring': [610, 240],
  'guras.proway': [880, 240],
  'integrated_address.point_address_unique': [20, 450],
  'cadastre.property': [610, 450],
  'guras.waypoint': [880, 450],
}

/** Box titles that would not fit the box; the detail panel keeps the full title. */
const NODE_TITLE: Partial<Record<TableId, string>> = {
  'integrated_address.point_address_unique': 'One row per address',
}

/** `t` places the label along the line, from a (0) to b (1), where the middle would crowd another label. */
interface EdgeDef { id: string; a: TableId; b: TableId; joins: string[]; label: string; spatial?: boolean; t?: number }

const EDGE_DEFS: EdgeDef[] = [
  { id: 'property-address', a: 'cadastre.property', b: 'guras.addressstring', joins: ['property-address'], label: 'addressstringoid' },
  { id: 'address-propertylot', a: 'guras.addressstring', b: 'guras.propertylot', joins: ['address-unit-lot', 'address-common-property', 'address-lots'], label: 'propid, sppropid' },
  { id: 'propertylot-lot', a: 'guras.propertylot', b: 'cadastre.lot', joins: ['propertylot-lot'], label: 'cadid' },
  { id: 'property-propertylot', a: 'cadastre.property', b: 'guras.propertylot', joins: ['property-propertylot'], label: 'propid' },
  { id: 'addresspoint-address', a: 'guras.addresspoint', b: 'guras.addressstring', joins: ['addresspoint-address'], label: 'addressstringoid', t: 0.4 },
  { id: 'proway-addresspoint', a: 'guras.proway', b: 'guras.addresspoint', joins: ['proway-addresspoint'], label: 'addresspointoid', t: 0.3 },
  { id: 'proway-waypoint', a: 'guras.proway', b: 'guras.waypoint', joins: ['proway-waypoint'], label: 'waypointoid' },
  { id: 'integrated-address', a: 'integrated_address.point_address', b: 'guras.addressstring', joins: ['integrated-address'], label: 'ss_addressstringoid' },
  { id: 'integrated-lot', a: 'integrated_address.point_address', b: 'cadastre.lot', joins: ['integrated-lot'], label: 'lot_cadid' },
  { id: 'unique-address', a: 'integrated_address.point_address_unique', b: 'guras.addressstring', joins: ['unique-address'], label: 'ss_addressstringoid' },
  { id: 'epi-lot', a: 'epi.layers', b: 'cadastre.lot', joins: ['epi-lot'], label: 'overlap', spatial: true },
  { id: 'other-lot', a: 'cadastre.other', b: 'cadastre.lot', joins: ['other-lot'], label: 'touch', spatial: true },
]

const GEOMETRY_LABEL: Record<TableDoc['geometry'], string> = {
  polygon: 'Polygons',
  point: 'Points',
  line: 'Lines',
  none: 'None, a plain table',
  mixed: 'Polygons and lines',
}

type Selection = { kind: 'table'; id: TableId } | { kind: 'edge'; id: string }
const selected = ref<Selection>({ kind: 'table', id: 'guras.addressstring' })

function select(s: Selection) {
  selected.value = s
}

const docOf = (id: TableId) => TABLES.find(t => t.id === id)!
const nodes = computed(() => (Object.keys(POSITIONS) as TableId[]).map(id => ({ id, x: POSITIONS[id][0], y: POSITIONS[id][1], doc: docOf(id) })))

/** Where the line from a box's centre towards (tx, ty) leaves the box. */
function exitPoint(id: TableId, tx: number, ty: number): [number, number] {
  const [x, y] = POSITIONS[id]
  const cx = x + NW / 2
  const cy = y + NH / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return [cx, cy]
  const sx = dx ? (NW / 2) / Math.abs(dx) : Infinity
  const sy = dy ? (NH / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return [cx + dx * s, cy + dy * s]
}

const edges = computed(() => EDGE_DEFS.map((e) => {
  const [ax, ay] = POSITIONS[e.a]
  const [bx, by] = POSITIONS[e.b]
  const acx = ax + NW / 2, acy = ay + NH / 2, bcx = bx + NW / 2, bcy = by + NH / 2
  const [x1, y1] = exitPoint(e.a, bcx, bcy)
  const [x2, y2] = exitPoint(e.b, acx, acy)
  const t = e.t ?? 0.5
  return { ...e, x1, y1, x2, y2, mx: x1 + (x2 - x1) * t, my: y1 + (y2 - y1) * t, labelW: e.label.length * 6.4 + 18 }
}))

const edgesOf = (id: TableId) => edges.value.filter(e => e.a === id || e.b === id)

function edgeOn(e: { id: string; a: TableId; b: TableId }): boolean {
  const s = selected.value
  return s.kind === 'edge' ? s.id === e.id : (e.a === s.id || e.b === s.id)
}
function edgeDim(e: { id: string; a: TableId; b: TableId }): boolean {
  return !edgeOn(e)
}
function nodeDim(id: TableId): boolean {
  const s = selected.value
  if (s.kind === 'table') return s.id !== id && !edges.value.some(e => (e.a === s.id && e.b === id) || (e.b === s.id && e.a === id))
  const e = edges.value.find(x => x.id === s.id)
  return !!e && e.a !== id && e.b !== id
}

const table = computed(() => (selected.value.kind === 'table' ? docOf(selected.value.id) : null))
const edge = computed(() => (selected.value.kind === 'edge' ? edges.value.find(e => e.id === selected.value.id) ?? null : null))
const edgeJoins = computed(() => (edge.value ? edge.value.joins.map(id => JOINS.find(j => j.id === id)!).filter(Boolean) : []))

function tableNames(t: TableDoc): string {
  if (t.id === 'epi.layers') return 'epi.epi_*'
  return t.tables.length === 1 ? `${t.schema}.${t.tables[0]}` : `${t.schema}.{${t.tables.join(', ')}}`
}

function rowText(t: TableDoc): string {
  if (t.id === 'epi.layers') {
    const n = Object.keys(props.rows).filter(k => k.startsWith('epi.')).length
    return n ? `${n} layers` : ''
  }
  const counts = t.tables.map(name => props.rows[`${t.schema}.${name}`]).filter((v): v is number => typeof v === 'number')
  if (!counts.length) return ''
  const total = counts.reduce((s, v) => s + v, 0)
  return `${compact(total)} rows`
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return n.toLocaleString('en-AU')
}

function fieldName(f: JoinDoc['from']): string {
  const t = docOf(f.table)
  return `${tableNames(t)}.${f.column}`
}

const checkOf = (id: string) => QUALITY_CHECKS.find(c => c.id === id)

function measured(id: string): { numerator: number; denominator: number; note: string } {
  const live = props.checks[id]
  if (live) return { numerator: live.numerator, denominator: live.denominator, note: `Measured ${formatDate(live.measuredAt)}` }
  const base = checkOf(id)?.baseline
  return base
    ? { numerator: base.numerator, denominator: base.denominator, note: `Baseline measured ${formatDate(base.measuredAt)}` }
    : { numerator: 0, denominator: 0, note: '' }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function joinSql(j: JoinDoc): string {
  const from = docOf(j.from.table)
  const to = docOf(j.to.table)
  const a = from.id === 'epi.layers' ? 'epi.epi_land_zoning' : from.id === 'cadastre.other' ? 'cadastre.road' : `${from.schema}.${from.tables[0]}`
  const b = `${to.schema}.${to.tables[0]}`
  if (j.cardinality === 'spatial') {
    return `SELECT l.lotidstring, x.*\nFROM ${b} l\nJOIN ${a} x ON x.geom && l.geom AND ST_Intersects(x.geom, l.geom)\nWHERE l.lotidstring = '17//DP10140';`
  }
  const cast = j.id === 'integrated-lot' ? '::text' : ''
  const extra: Record<string, string> = {
    'address-unit-lot': '\n WHERE a.sppropid <> a.propid AND b.propidtype = 2',
    'address-common-property': '\n WHERE a.sppropid = a.propid AND b.propidtype = 3',
    'address-lots': '\n WHERE a.sppropid IS NULL AND b.propidtype = 1',
  }
  return `SELECT *\nFROM ${a} a\nJOIN ${b} b ON b.${j.to.column} = a.${j.from.column}${cast}${extra[j.id] ?? ''};`
}
</script>

<style scoped>
.sm { display: grid; gap: 0.9rem; }

.sm-canvas-wrap {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 0.5rem;
  overflow-x: auto;
}
.sm-canvas { display: block; width: 100%; min-width: 760px; height: auto; font-family: inherit; }

.sm-edge-g { cursor: pointer; }
.sm-edge-hit { stroke: transparent; stroke-width: 16; }
.sm-edge { stroke: #94a3b8; stroke-width: 2; transition: stroke 0.15s, opacity 0.15s; }
.sm-edge--spatial { stroke-dasharray: 6 5; }
.sm-edge--on { stroke: #0f172a; stroke-width: 2.5; }
.sm-edge--dim { opacity: 0.35; }
.sm-pill { fill: #fff; stroke: #cbd5e1; }
.sm-pill--on { fill: #0f172a; stroke: #0f172a; }
.sm-pill-text { font-size: 11px; font-weight: 600; fill: #334155; text-anchor: middle; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.sm-pill-text--on { fill: #fff; }

.sm-node { cursor: pointer; transition: opacity 0.15s; outline: none; }
.sm-box { fill: #fff; stroke: #cbd5e1; stroke-width: 1.5; }
.sm-node:hover .sm-box, .sm-node:focus-visible .sm-box { stroke: #0f172a; }
.sm-node--on .sm-box { stroke: #0f172a; stroke-width: 2.5; }
.sm-name { font-size: 12.5px; font-weight: 700; fill: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.sm-title { font-size: 12px; fill: #334155; }
.sm-meta { font-size: 11px; fill: #64748b; }
.sm-dim { opacity: 0.4; }

.sm-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; font-size: 0.78rem; color: #475569; }
.sm-legend li { display: inline-flex; align-items: center; gap: 0.4rem; }
.sm-legend code { font-size: 0.72rem; color: #64748b; }
.sm-legend-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.sm-legend-line { width: 22px; border-top: 2px solid #94a3b8; display: inline-block; }
.sm-legend-line--spatial { border-top-style: dashed; }

/* ── Detail ──────────────────────────────────────────────────────────── */
.sm-detail {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.1rem 1.25rem 1.25rem;
}
.sm-detail-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin-bottom: 0.6rem; }
.sm-badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.15rem 0.55rem; border: 1px solid; border-radius: 999px; font-size: 0.72rem; font-weight: 600; color: #334155; }
.sm-detail-title { margin: 0; font-size: 1.1rem; font-weight: 800; color: #0f172a; }
.sm-detail-code { font-size: 0.78rem; color: #475569; background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 5px; }
.sm-lead { margin: 0 0 0.8rem; font-size: 0.92rem; line-height: 1.55; color: #1e293b; }

.sm-facts { display: flex; flex-wrap: wrap; gap: 0.5rem 1.75rem; margin: 0 0 1rem; }
.sm-facts dt { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.sm-facts dd { margin: 0.1rem 0 0; font-size: 0.88rem; color: #0f172a; }

.sm-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 1rem 1.5rem; }
.sm-h4 { margin: 0 0 0.4rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.sm-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.sm-table th { text-align: left; vertical-align: top; padding: 0.35rem 0.75rem 0.35rem 0; width: 40%; font-weight: 400; overflow-wrap: anywhere; }
.sm-table td { padding: 0.35rem 0; color: #334155; line-height: 1.45; }
.sm-table tr + tr { border-top: 1px solid #f1f5f9; }
.sm-table code { font-size: 0.78rem; color: #0f172a; }
.sm-example { color: #64748b; }

.sm-watch { margin-top: 1rem; padding: 0.7rem 0.9rem; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
.sm-watch ul { margin: 0; padding-left: 1.1rem; font-size: 0.82rem; color: #78350f; line-height: 1.5; }

.sm-connects { margin-top: 1rem; }
.sm-connect-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.sm-connect { display: inline-flex; flex-direction: column; align-items: flex-start; padding: 0.4rem 0.7rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font: inherit; cursor: pointer; text-align: left; }
.sm-connect:hover { border-color: #0f172a; }
.sm-connect-table { font-size: 0.82rem; font-weight: 600; color: #0f172a; }
.sm-connect-via { font-size: 0.72rem; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.sm-join + .sm-join { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #f1f5f9; }
.sm-join-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
.sm-join-fields code { font-size: 0.8rem; background: #f1f5f9; padding: 0.15rem 0.45rem; border-radius: 5px; color: #0f172a; }
.sm-join-arrow { font-weight: 700; color: #64748b; }
.sm-card { font-size: 0.72rem; font-weight: 700; color: #475569; border: 1px solid #cbd5e1; border-radius: 999px; padding: 0.1rem 0.5rem; }
.sm-when { margin: 0 0 0.6rem; font-size: 0.82rem; color: #334155; }
.sm-check { margin: 0.6rem 0; max-width: 560px; }
.sm-sql { margin-top: 0.5rem; }
.sm-sql summary { cursor: pointer; font-size: 0.78rem; font-weight: 600; color: #15803d; }
.sm-sql pre { margin: 0.5rem 0 0; padding: 0.75rem; background: #0f172a; color: #e2e8f0; border-radius: 8px; overflow-x: auto; font-size: 0.78rem; line-height: 1.5; }
.sm-back { margin-top: 1rem; border: none; background: none; padding: 0; font: inherit; font-size: 0.8rem; color: #475569; cursor: pointer; }
.sm-back:hover { color: #0f172a; }
</style>
