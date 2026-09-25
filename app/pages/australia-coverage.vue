<!--
  /australia-coverage - what every Australian jurisdiction publishes for cadastre and planning.

  The question behind it: we have New South Wales. What would the rest of the country cost?

  The page is ordered by the answer rather than alphabetically or by population, because the answer is
  not what you would guess. Tasmania and the ACT are trivial. Victoria is a weekend. South Australia
  has the best planning data in the country and a cadastre you cannot download. Western Australia sells
  its parcels by the hundred. The Northern Territory publishes neither.

  Every figure comes from shared/australia-coverage.ts, where each source carries whether it was
  VERIFIED - called from a machine on the research date - or merely documented from the publisher's own
  pages. That distinction is on the page, not buried, because three of these jurisdictions need a
  conversation with a person and a licence column cannot say that on its own.
-->

<template>
  <div class="ac">
    <header class="ac-head">
      <div>
        <NuxtLink to="/" class="ac-back">&larr; Home</NuxtLink>
        <h1 class="ac-title">Cadastre and planning data, state by state</h1>
        <p class="ac-sub">
          What each jurisdiction publishes, how to get it, and what it costs — researched
          {{ AU_RESEARCHED_ON }}. {{ openCadastre }} of {{ AU_JURISDICTIONS.length }} publish their
          cadastre openly and {{ openPlanning }} publish state-wide planning zones openly. The download
          is rarely the hard part.
        </p>
      </div>
      <div class="ac-key">
        <span v-for="a in LEGEND" :key="a.k" class="ac-key-row">
          <i class="ac-dot" :style="{ background: ACCESS[a.k].colour }" />{{ ACCESS[a.k].label }}
        </span>
      </div>
    </header>

    <!-- ── the matrix ───────────────────────────────────────────────────── -->
    <section class="ac-sec">
      <h2 class="ac-h2">The whole country in one table</h2>
      <div class="ac-scroll">
        <table class="ac-table">
          <thead>
            <tr>
              <th>Jurisdiction</th>
              <th>Cadastre</th>
              <th>Planning</th>
              <th>Licence</th>
              <th>We hold</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="j in AU_JURISDICTIONS" :key="j.code" :class="{ 'ac-tr-held': j.held }">
              <td class="ac-td-j"><b>{{ j.code }}</b><span class="ac-sub2">{{ j.name }}</span></td>
              <td><span class="ac-pill" :style="pill(j.cadastre.access)">{{ ACCESS[j.cadastre.access].label }}</span></td>
              <td><span class="ac-pill" :style="pill(j.planning.access)">{{ ACCESS[j.planning.access].label }}</span></td>
              <td class="ac-dim">{{ j.cadastre.licence === j.planning.licence ? j.cadastre.licence : `${j.cadastre.licence} / ${j.planning.licence}` }}</td>
              <td class="ac-dim">{{ j.held ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="ac-lead ac-lead--after">
        <b>What the table cannot show.</b> The formats are all ordinary GIS and the licences are mostly
        CC BY, so a pipeline that reads one state reads most of them. What does not carry across is the
        <b>zone vocabulary</b>: NSW writes R2 and B4 under the Standard Instrument, Victoria writes GRZ
        and NRZ, South Australia has a single Planning and Design Code, and Queensland has a
        scheme per council — 77 of them — with no state-wide zoning layer at all. Four languages for one idea. A national product
        is a translation problem wearing a data-download costume, and the translation is the product.
      </p>
    </section>

    <!-- ── each jurisdiction ────────────────────────────────────────────── -->
    <section v-for="j in AU_JURISDICTIONS" :key="j.code" class="ac-sec ac-j">
      <div class="ac-j-head">
        <h2 class="ac-h2">
          <span class="ac-code">{{ j.code }}</span>{{ j.name }}
          <span v-if="j.held" class="ac-held">loaded here</span>
        </h2>
        <p class="ac-agency">{{ j.agency }}</p>
      </div>
      <p class="ac-headline">{{ j.headline }}</p>

      <div class="ac-cards">
        <article v-for="s in [j.cadastre, j.planning]" :key="s.name" class="ac-card">
          <header class="ac-card-head">
            <span class="ac-card-kind">{{ s === j.cadastre ? 'Cadastre' : 'Planning' }}</span>
            <span class="ac-pill" :style="pill(s.access)">{{ ACCESS[s.access].label }}</span>
            <span class="ac-ev" :class="`ac-ev--${s.evidence}`">{{ s.evidence === 'verified' ? 'endpoint verified' : 'from the publisher' }}</span>
          </header>
          <h3 class="ac-card-name">{{ s.name }}</h3>
          <p class="ac-how">{{ s.how }}</p>
          <dl class="ac-facts">
            <div><dt>Formats</dt><dd>{{ s.formats }}</dd></div>
            <div><dt>Licence</dt><dd>{{ s.licence }}</dd></div>
            <div v-if="s.cadence"><dt>Updated</dt><dd>{{ s.cadence }}</dd></div>
          </dl>
          <p v-if="s.note" class="ac-note">{{ s.note }}</p>
          <p class="ac-links">
            <a :href="s.url" target="_blank" rel="noopener">{{ shortHost(s.url) }}</a>
            <a v-if="s.endpoint" class="ac-endpoint" :href="s.endpoint" target="_blank" rel="noopener">
              <code>{{ shortHost(s.endpoint) }}</code> endpoint
            </a>
          </p>
        </article>
      </div>
    </section>

    <!-- ── national ─────────────────────────────────────────────────────── -->
    <section class="ac-sec">
      <h2 class="ac-h2">The national layer</h2>
      <p class="ac-lead">
        Three things are published nationally and one conspicuously is not.
      </p>
      <div class="ac-scroll">
        <table class="ac-table">
          <thead>
            <tr><th>Source</th><th>What it is</th><th>Access</th><th>Worth knowing</th></tr>
          </thead>
          <tbody>
            <tr v-for="n in AU_NATIONAL" :key="n.name">
              <td class="ac-td-j"><a :href="n.url" target="_blank" rel="noopener">{{ n.name }}</a><span class="ac-sub2">{{ n.licence }}</span></td>
              <td>{{ n.what }}</td>
              <td><span class="ac-pill" :style="pill(n.access)">{{ ACCESS[n.access].label }}</span></td>
              <td class="ac-dim">{{ n.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── the read ─────────────────────────────────────────────────────── -->
    <section class="ac-sec">
      <h2 class="ac-h2">If we went national, in the order I would do it</h2>
      <ol class="ac-plan">
        <li>
          <b>Tasmania and the ACT — days, not weeks.</b> Both publish cadastre and state-wide zoning
          under CC BY with working REST services, and both are small enough to load whole. The ACT has
          one Territory Plan and Tasmania one state scheme, so neither needs council reconciliation.
          They are the cheapest way to prove the pipeline is not NSW-shaped.
        </li>
        <li>
          <b>Victoria — the real prize.</b> Vicmap Planning is a single state-wide zones-and-overlays
          dataset covering every planning scheme, which is the closest thing in the country to our
          <NuxtLink to="/epi">epi schema</NuxtLink>. Open licence, choose your format and CRS on the way
          out. If only one more state gets done, it is this one.
        </li>
        <li>
          <b>South Australia — take the planning, park the cadastre.</b> One state-wide Planning and
          Design Code, GeoJSON, CC BY, updated fortnightly. The parcels are the problem: not open data,
          and only by agreement with Land Services SA.
        </li>
        <li>
          <b>Queensland — we have the hard half already.</b> The QSCF cadastre is loaded. Zoning is the
          gap, and it is a real one: no state-wide layer, so it means 77 council schemes or a commercial
          aggregator.
        </li>
        <li>
          <b>Western Australia — price it before designing around it.</b> The planning side is open; the
          cadastre is sold by the parcel. Get a quote for the whole state before assuming it behaves
          like the others.
        </li>
        <li>
          <b>Northern Territory — last, and by conversation.</b> Neither dataset is on the open portal.
          The Digital Atlas cadastral lite extract is the only route that does not start with an email.
        </li>
      </ol>
      <p class="ac-lead ac-lead--after">
        <b>On the evidence.</b> Sources marked <i>endpoint verified</i> were called from a machine on
        {{ AU_RESEARCHED_ON }} and answered; the rest are read from the publisher's own documentation.
        Prices and licence terms change without notice, and the three restricted jurisdictions require a
        person rather than a download — treat the licence column as the start of a procurement question,
        not a settled fact.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { AU_JURISDICTIONS, AU_NATIONAL, AU_RESEARCHED_ON, type Access } from '#shared/australia-coverage'

useHead({ title: 'Australian cadastre and planning coverage · Planning Library' })

/** One colour per access grade - the page's only colour system. */
const ACCESS: Record<Access, { label: string; colour: string }> = {
  open: { label: 'open', colour: '#0f766e' },
  account: { label: 'free, account', colour: '#0891b2' },
  partial: { label: 'partial', colour: '#ca8a04' },
  paid: { label: 'paid', colour: '#c2410c' },
  restricted: { label: 'by request', colour: '#9f1239' },
}
const LEGEND = (Object.keys(ACCESS) as Access[]).map(k => ({ k }))

const pill = (a: Access) => ({ background: ACCESS[a].colour })

const openCadastre = computed(() => AU_JURISDICTIONS.filter(j => j.cadastre.access === 'open' || j.cadastre.access === 'account').length)
const openPlanning = computed(() => AU_JURISDICTIONS.filter(j => j.planning.access === 'open' || j.planning.access === 'account').length)

/** A URL is not a sentence; show where it points and let the link carry the rest. */
function shortHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
</script>

<style scoped>
.ac {
  min-height: 100vh; background: #f5faf9; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; padding-bottom: 4rem;
}

.ac-head { display: flex; flex-wrap: wrap; gap: 1.5rem; justify-content: space-between; padding: 1.2rem 1.5rem 1rem; background: #fff; border-bottom: 1px solid #d6e7e4; }
.ac-back { display: inline-block; font-size: 0.78rem; color: #5b7d78; text-decoration: none; margin-bottom: 0.25rem; }
.ac-back:hover { color: #0f766e; }
.ac-title { margin: 0; font-size: 1.4rem; font-weight: 800; color: #0f172a; }
.ac-sub { margin: 0.35rem 0 0; max-width: 78ch; font-size: 0.88rem; color: #475569; }
.ac-key { display: grid; gap: 0.25rem; align-content: start; font-size: 0.72rem; color: #64748b; }
.ac-key-row { display: flex; align-items: center; gap: 0.4rem; }
.ac-dot { width: 9px; height: 9px; border-radius: 999px; flex: none; }

.ac-sec { margin: 1.5rem 1.5rem 0; }
.ac-h2 { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 0.3rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.ac-lead { margin: 0.5rem 0 0.8rem; max-width: 92ch; font-size: 0.82rem; color: #475569; }
.ac-lead--after { margin-top: 0.9rem; }
.ac-lead b { color: #0f172a; }
.ac-lead a, .ac-plan a { color: #0f766e; }
.ac-dim { color: #64748b; }

/* ── table ────────────────────────────────────────────────────────────── */
.ac-scroll { overflow-x: auto; }
.ac-table { width: 100%; min-width: 46rem; border-collapse: collapse; background: #fff; border: 1px solid #d6e7e4; border-radius: 12px; overflow: hidden; font-size: 0.8rem; }
.ac-table thead th { padding: 0.45rem 0.7rem; background: #edf6f4; border-bottom: 1px solid #d6e7e4; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #5b7d78; text-align: left; white-space: nowrap; }
.ac-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #eef5f3; vertical-align: top; }
.ac-tr-held { background: #f6fbfa; }
.ac-td-j b { color: #0f172a; }
.ac-td-j a { color: #0f766e; font-weight: 700; }
.ac-sub2 { display: block; font-size: 0.7rem; color: #94a3b8; font-weight: 400; }
.ac-pill { display: inline-block; padding: 0.08em 0.55em; border-radius: 999px; color: #fff; font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }

/* ── a jurisdiction ───────────────────────────────────────────────────── */
.ac-j { padding-top: 0.6rem; border-top: 1px solid #e3efed; }
.ac-j-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.6rem; justify-content: space-between; }
.ac-code { display: inline-block; padding: 0.05em 0.5em; border-radius: 6px; background: #0f766e; color: #fff; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.02em; }
.ac-held { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #0f766e; background: #d7f0eb; border-radius: 999px; padding: 0.1em 0.6em; }
.ac-agency { margin: 0; font-size: 0.74rem; color: #94a3b8; }
.ac-headline { margin: 0.3rem 0 0.8rem; max-width: 92ch; font-size: 0.86rem; color: #334155; font-weight: 600; }

.ac-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(23rem, 1fr)); gap: 0.8rem; }
.ac-card { background: #fff; border: 1px solid #d6e7e4; border-radius: 12px; padding: 0.7rem 0.85rem 0.8rem; }
.ac-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin-bottom: 0.3rem; }
.ac-card-kind { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #5b7d78; }
.ac-ev { font-size: 0.63rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.08em 0.45em; border-radius: 999px; }
.ac-ev--verified { color: #0f766e; background: #d7f0eb; }
.ac-ev--documented { color: #7c6f5b; background: #f3efe7; }
.ac-card-name { margin: 0; font-size: 0.9rem; font-weight: 800; color: #0f172a; line-height: 1.3; }
.ac-how { margin: 0.25rem 0 0.5rem; font-size: 0.8rem; color: #475569; }
.ac-facts { margin: 0 0 0.5rem; display: grid; gap: 0.15rem; font-size: 0.76rem; }
.ac-facts div { display: flex; gap: 0.5rem; }
.ac-facts dt { flex: none; width: 4.6rem; color: #94a3b8; font-weight: 600; }
.ac-facts dd { margin: 0; color: #334155; }
.ac-note { margin: 0 0 0.5rem; padding: 0.4rem 0.6rem; background: #f6fbfa; border-left: 2px solid #99d6cd; border-radius: 0 6px 6px 0; font-size: 0.76rem; color: #475569; }
.ac-links { margin: 0; display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.74rem; }
.ac-links a { color: #0f766e; }
.ac-endpoint code { font-size: 0.72rem; }

.ac-plan { margin: 0.4rem 0 0; padding-left: 1.3rem; display: grid; gap: 0.6rem; max-width: 94ch; font-size: 0.83rem; color: #475569; }
.ac-plan b { color: #0f172a; }
</style>
