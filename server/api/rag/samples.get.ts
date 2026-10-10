/**
 * GET /api/rag/samples - the LEPs side D (the rag engine) reads, and a few sample lots in each, for the landing page.
 *
 * Every LEP in rag.instrument, so a council onboarded through scripts/rag/run.ts appears here with no edit. The lots are
 * ones the pipeline has already examined (rag.question's frozen lot facts), chosen by rule, not by hand:
 *   zone   one lot per zone, the plan's main residential and centre zones first (from its key and grid lots)
 *   APU    lots in an Additional Permitted Uses area a Schedule 1 item governs (the 'area' set)
 *   AC     lots in another mapped area a clause governs - key sites, local provisions, additional controls
 */
import { shortName } from '#shared/rag/refs'

const ZONE_ORDER = ['R2', 'R3', 'R4', 'R1', 'E1', 'MU1', 'E2', 'B4', 'B2', 'R5', 'C4', 'E3', 'E4', 'IN1', 'IN2', 'RU4']

export default defineEventHandler(async () => {
  const q = async (sql: string, p: unknown[] = []) => (await ragQuery(sql, p)).rows
  const leps = await q(`SELECT document_id::text AS doc, title FROM rag.instrument WHERE kind = 'lep' ORDER BY title`)
  const lots = await q(`SELECT DISTINCT ON (qn.document_id, qn.cadid) qn.document_id::text AS doc, qn.cadid, qn.set_name, qn.tags,
                               qn.lot_facts->>'address' AS address, qn.lot_facts->>'lot' AS lot, qn.lot_facts->>'zone' AS zone, qn.lot_facts->>'epi' AS epi
                          FROM rag.question qn
                         WHERE qn.cadid IS NOT NULL AND coalesce(qn.expected->>'status', '') <> 'retired' AND qn.lot_facts->>'address' IS NOT NULL
                         ORDER BY qn.document_id, qn.cadid, qn.set_name`)
  return {
    leps: leps.map((l: any) => {
      const mine = lots.filter((x: any) => x.doc === l.doc && String(x.epi ?? '').toLowerCase() === l.title.toLowerCase())
      const chip = (x: any, tag: string) => ({ tag, address: x.address, lot: x.lot, zone: x.zone, cadid: x.cadid })
      const byZone = new Map<string, any>()
      for (const x of mine.filter((x: any) => x.set_name !== 'area').sort((a: any, b: any) => String(a.cadid).localeCompare(String(b.cadid))))
        if (x.zone && !byZone.has(x.zone)) byZone.set(x.zone, x)
      const zones = [...byZone.keys()].sort((a, b) => (ZONE_ORDER.indexOf(a) + 1 || 99) - (ZONE_ORDER.indexOf(b) + 1 || 99)).slice(0, 4).map(z => chip(byZone.get(z), z))
      const area = mine.filter((x: any) => x.set_name === 'area')
      const apu = area.filter((x: any) => (x.tags ?? []).includes('additional permitted uses')).slice(0, 2).map((x: any) => chip(x, 'APU'))
      const ac = area.filter((x: any) => !(x.tags ?? []).includes('additional permitted uses') && !apu.some(a => a.cadid === x.cadid)).slice(0, 2).map((x: any) => chip(x, 'AC'))
      return { title: l.title, short: shortName(l.title), council: shortName(l.title).replace(/ LEP.*$/, ''), samples: [...zones, ...apu, ...ac] }
    }),
  }
})
