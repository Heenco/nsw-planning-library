<!--
  RagTrace - one answer of the rag engine (side D) as its full trace: the rules that apply to the lot and why, the
  precedence steps, the case split when a fact is unknown, the limits, and the sub-questions behind them (rendered with
  this same component). Every provision is a link to the legislation with its words one click away.
  Data: shared/rag/evaluate.ts explain(), served by /api/rag/question.
-->
<template>
  <div class="rt" :class="{ 'rt--sub': depth > 0 }">
    <p class="rt-head">
      <span class="rt-verdict" :class="'rt-v--' + tone">{{ headline }}</span>
      <span v-if="ex.note" class="rt-note">{{ ex.note }}</span>
    </p>

    <template v-if="applied.length">
      <p class="rt-k">Rules that apply to this lot</p>
      <ul class="rt-list">
        <li v-for="(c, i) in applied" :key="'a' + i" :class="{ 'rt-won': c.won }">
          <span class="rt-mark">{{ c.holds === null ? '?' : '✓' }}</span>
          <RagClause :id="c.provision_id" :p="provisions[c.provision_id]" :fallback="c.label" />
          <span class="rt-effect">{{ effect(c) }}</span>
          <span v-if="c.won" class="rt-tag">decides</span>
          <ul v-if="whyLines(c).length" class="rt-why">
            <li v-for="(w, j) in whyLines(c)" :key="j">{{ w }}</li>
          </ul>
          <div v-for="(s, j) in c.subs" :key="'s' + j" class="rt-subq">
            <p class="rt-k">Sub-question: {{ askText(s.ask) }}</p>
            <RagTrace :ex="s" :provisions="provisions" :depth="depth + 1" />
          </div>
        </li>
      </ul>
    </template>

    <template v-if="ex.steps.length">
      <p class="rt-k">Which rule wins</p>
      <ul class="rt-list">
        <li v-for="(s, i) in ex.steps" :key="'st' + i">
          <RagClause :id="s.winner_id" :p="s.winner_id ? provisions[s.winner_id] : null" :fallback="s.winner" />
          <span class="rt-over">prevails over</span>
          <RagClause :id="s.loser_id" :p="s.loser_id ? provisions[s.loser_id] : null" :fallback="s.loser" />
          <span class="rt-why1">- {{ s.why }}<template v-if="s.relation_id && s.relation_id !== s.winner_id">, as stated in <RagClause :id="s.relation_id" :p="provisions[s.relation_id]" :fallback="s.relation" /></template></span>
          <span v-if="s.basis === 'interpretive' && s.status !== 'verified'" class="rt-tag rt-tag--warn" title="This step rests on a reading the text does not state in words (e.g. that one clause is more specific than another). It has not been verified.">interpretive reading - not verified</span>
        </li>
      </ul>
    </template>

    <template v-if="ex.branches.length">
      <p class="rt-k">It depends on a fact nobody gave</p>
      <ul class="rt-list">
        <li v-for="(b, i) in ex.branches" :key="'b' + i">
          <strong>{{ b.answer ?? 'no limit' }}</strong> if {{ cleanIf(b.if) }}
          <span v-for="(s, j) in b.steps" :key="j" class="rt-why1"> - <RagClause :id="s.winner_id" :p="s.winner_id ? provisions[s.winner_id] : null" :fallback="s.winner" /> over <RagClause :id="s.loser_id" :p="s.loser_id ? provisions[s.loser_id] : null" :fallback="s.loser" /></span>
        </li>
      </ul>
    </template>

    <template v-if="ex.limits.length">
      <p class="rt-k">Limits</p>
      <ul class="rt-list">
        <li v-for="(l, i) in ex.limits" :key="'l' + i">
          <span class="rt-mark" :class="'rt-st--' + l.status">{{ l.status === 'met' ? '✓' : l.status === 'not met' ? '✗' : l.status === 'depends' ? '?' : '•' }}</span>
          <RagClause v-if="l.provision_id" :id="l.provision_id" :p="provisions[l.provision_id]" :fallback="l.label" />
          <strong v-else>{{ l.label }}</strong>
          <span v-if="l.detail" class="rt-effect">{{ l.detail }}</span>
          <q v-if="l.text && !l.detail" class="rt-quote">{{ l.text }}</q>
          <details v-for="(s, j) in l.subs" :key="j" class="rt-subq">
            <summary>how: {{ askText(s.ask) }} → {{ answerText(s) }}</summary>
            <RagTrace :ex="s" :provisions="provisions" :depth="depth + 1" />
          </details>
        </li>
      </ul>
    </template>

    <details v-if="notApplied.length" class="rt-more">
      <summary>{{ notApplied.length }} more rules tested that do not apply to this lot</summary>
      <ul class="rt-list rt-list--dim">
        <li v-for="(c, i) in notApplied" :key="'n' + i">
          <span class="rt-mark">✗</span>
          <RagClause :id="c.provision_id" :p="provisions[c.provision_id]" :fallback="c.label" />
          <span class="rt-effect">{{ effect(c) }}</span>
          <span class="rt-why1">- {{ c.why.filter((w: string) => / no$/.test(w) || /: no\]/.test(w)).join('; ') || c.why.join('; ') }}</span>
        </li>
      </ul>
    </details>

    <template v-if="depth === 0 && checked.length">
      <p class="rt-k">Checked against data for this lot</p>
      <ul class="rt-list">
        <li v-for="(c, i) in checked" :key="'ck' + i">
          <span class="rt-mark" :class="c.result === true ? 'rt-st--met' : c.result === false ? '' : 'rt-st--depends'">{{ c.result === true ? '✓' : c.result === false ? '✗' : '?' }}</span>
          {{ c.text }} <span class="rt-why1">- {{ c.how }}</span>
        </li>
      </ul>
    </template>
    <template v-if="depth === 0 && (couldNot.length || ex.notChecked?.length)">
      <p class="rt-k rt-k--warn">Could not check - the answer does not assume these</p>
      <ul class="rt-list">
        <li v-for="(c, i) in couldNot" :key="'cn' + i"><span class="rt-mark rt-st--depends">?</span>{{ c.text }} <span class="rt-why1">- {{ c.how }}</span></li>
        <li v-for="(t, i) in ncOnly" :key="'nc' + i"><span class="rt-mark rt-st--depends">?</span>{{ t }}</li>
      </ul>
    </template>
    <p v-if="depth === 0 && ex.asAt?.length" class="rt-nc">Law as at: {{ ex.asAt.map((a: any) => `${a.instrument} ${a.date ?? '(date not recorded)'}`).join('; ') }} - amendments after that date are not read.</p>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ ex: any; provisions: Record<string, any>; depth?: number }>(), { depth: 0 })
const applied = computed(() => (props.ex.claims ?? []).filter((c: any) => c.holds !== false))
const notApplied = computed(() => (props.ex.claims ?? []).filter((c: any) => c.holds === false))
// the conditions tested against spatial / lot data, and the ones no data could settle (shared/rag/evaluate.ts Check)
const checked = computed(() => (props.ex.checks ?? []).filter((c: any) => c.could))
const couldNot = computed(() => (props.ex.checks ?? []).filter((c: any) => !c.could))
const ncOnly = computed(() => (props.ex.notChecked ?? []).filter((t: string) => !couldNot.value.some((c: any) => t.includes(c.text))))
const unit = (u: string | null, topic?: string | null) => topic === 'fsr' || u === 'ratio' ? ':1' : u === 'm2' ? ' m²' : u ? ` ${u}` : ''
const answerText = (ex: any) => {
  const a = ex.answer
  if (ex.verdict === 'permitted') return 'permitted'
  if (ex.verdict === 'prohibited') return 'prohibited'
  if (a?.effect === 'value' && a.value != null) return `${a.value}${unit(a.unit, ex.ask?.topic)}${a.expr && /x/.test(a.expr) ? ` (${a.expr})` : ''}`
  if (a?.expr) return a.expr
  return ex.verdict === 'maybe' ? 'it depends' : ex.verdict === 'yes' ? 'yes' : ex.verdict === 'no' ? 'no' : ex.verdict
}
const headline = computed(() => {
  const k = props.ex.ask?.kind
  const a = answerText(props.ex)
  return k === 'permissibility' ? (props.ex.verdict === 'permitted' ? 'Permissible with consent' : props.ex.verdict === 'prohibited' ? 'Prohibited' : 'It depends')
    : k === 'subdivision' ? `${props.ex.verdict === 'yes' ? 'Yes' : props.ex.verdict === 'no' ? 'No' : 'It depends'} - minimum ${a}`
    : `${(props.ex.ask?.topic ?? '').replace('_', ' ')}: ${a}`
})
const tone = computed(() => ['permitted', 'yes'].includes(props.ex.verdict) ? 'yes' : ['prohibited', 'no'].includes(props.ex.verdict) ? 'no' : props.ex.verdict === 'maybe' ? 'maybe' : 'value')
const effect = (c: any) => c.kind === 'permit' ? `permits ${c.uses?.join(', ') || 'it'}` : c.kind === 'prohibit' ? `prohibits ${c.uses?.join(', ') || 'it'}`
  : c.value != null ? `${c.topic?.replace('_', ' ') ?? ''} ${c.value}${unit(c.unit, c.topic)}${c.non_discretionary ? ' (non-discretionary)' : ''}` : c.kind
const whyLines = (c: any) => (c.why ?? []).map((w: string) => w.replace(/^frame (.+?) \[(.*)\]: (yes|unknown)$/, 'applies through $1: $2').replace(/: yes$/, ' ✓').replace(/: unknown$/, ' - unknown'))
const askText = (a: any) => a.kind === 'permissibility' ? `is ${a.use} permissible here?` : a.kind === 'subdivision' ? `minimum lot size for a ${a.tenure ?? ''} subdivision` : `${a.topic?.replace('_', ' ')} for ${a.use}`
const cleanIf = (s: string) => s.replace(/frame [^[]*\[|\]|: unknown/g, '').replace(/\s+/g, ' ').trim()
</script>

<style scoped>
.rt { font-size: 13px; }
.rt--sub { border-left: 2px solid #e2e8f0; padding-left: 10px; margin: 4px 0 4px 2px; }
.rt-head { margin: 0 0 6px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.rt-verdict { font-weight: 700; }
.rt-v--yes { color: #15803d; } .rt-v--no { color: #b91c1c; } .rt-v--maybe { color: #b45309; } .rt-v--value { color: #0f172a; }
.rt-note { font-size: 12px; color: #475569; }
.rt-k { margin: 8px 0 3px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
.rt-list { margin: 0; padding-left: 0; list-style: none; }
.rt-list > li { margin: 3px 0; overflow-wrap: anywhere; }
.rt-list--dim > li { color: #64748b; }
.rt-mark { display: inline-block; width: 16px; font-weight: 700; color: #475569; }
.rt-st--met { color: #15803d; } .rt-st--not\ met { color: #b91c1c; } .rt-st--depends { color: #b45309; }
.rt-won { background: #f0fdf4; border-radius: 4px; }
.rt-effect { margin-left: 6px; color: #334155; }
.rt-over { margin: 0 6px; color: #64748b; font-style: italic; }
.rt-why { margin: 2px 0 2px 22px; padding-left: 12px; color: #475569; font-size: 12px; }
.rt-why1 { color: #475569; font-size: 12px; margin-left: 4px; }
.rt-tag { font-size: 10px; font-weight: 700; background: #dcfce7; color: #14532d; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
.rt-tag--soft { background: #f1f5f9; color: #475569; }
.rt-tag--warn { background: #fef3c7; color: #92400e; }
.rt-k--warn { color: #b45309; }
.rt-quote { display: block; margin: 2px 0 0 22px; color: #475569; font-size: 12px; }
.rt-subq { margin: 4px 0 4px 22px; }
.rt-subq summary, .rt-more summary { cursor: pointer; color: #475569; font-size: 12px; }
.rt-more { margin-top: 8px; }
.rt-nc { margin: 8px 0 0; font-size: 11px; color: #64748b; }
</style>
