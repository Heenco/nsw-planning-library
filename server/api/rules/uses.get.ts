/**
 * /api/rules/uses - the land uses the SEPP rule layer names (a permission's permits_use effect or a rule's
 * land_use applicability), so a page can offer them for /api/rules/at without keeping its own list.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export default defineEventHandler(async () => {
  const r = await nswQuery<any>(
    `SELECT lower(v) AS use, bool_or(permits) AS permitted, count(DISTINCT doc) AS instruments FROM (
       SELECT a.value AS v, false AS permits, r.document_id AS doc FROM nsw.rule_applicability a
         JOIN nsw.rule r ON r.id = a.rule_id JOIN nsw.document d ON d.id = r.document_id
        WHERE d.doc_type = 'sepp' AND a.dimension = 'land_use' AND a.polarity = 'applies' AND r.publish_state <> 'retired'
       UNION ALL
       SELECT e.topic, true, r.document_id FROM nsw.rule_effect e
         JOIN nsw.rule r ON r.id = e.rule_id JOIN nsw.document d ON d.id = r.document_id
        WHERE d.doc_type = 'sepp' AND e.effect_type = 'permits_use' AND r.publish_state <> 'retired') x
      WHERE v IS NOT NULL GROUP BY 1 ORDER BY bool_or(permits) DESC, 1`)
  return { uses: r.rows.map(x => ({ use: x.use as string, permitted: Boolean(x.permitted), instruments: Number(x.instruments) })) }
})
