-- What 09G would write for one zone, from nsw.lep_permissibility, under the
-- corrected group-term rule, beside the old rule, with the difference.
--
-- Plain SQL: the plan and zone are the two literals in the params CTE at the
-- top of each query, so this runs in DBeaver, pgAdmin or psql alike. Randwick
-- LEP 2012 is epi-2013-0036. On UrbanPortalDBP use urbanportaldbp. for nsw.

-- 1. The group terms, both answers side by side, and what the change does
WITH params AS (SELECT 'epi-2013-0036'::text AS epi, 'R2'::text AS zone)
SELECT p.land_use,
       p.status                                   AS members_rolled_up,
       coalesce(p.named_status, '(never named)')  AS plan_says,
       p.named_source_text                        AS plan_line,
       CASE
         WHEN p.named_status IN ('permitted_with_consent','permitted_without_consent')
              AND p.status NOT IN ('permitted_with_consent','permitted_without_consent') THEN 'ADDED to the list'
         WHEN p.named_status = 'prohibited'
              AND p.status IN ('permitted_with_consent','permitted_without_consent')     THEN 'REMOVED from the list'
         ELSE ''
       END AS change
FROM nsw.lep_permissibility p, params
WHERE p.epicode = params.epi AND p.zone_code = params.zone AND p.level = 'parent'
ORDER BY change DESC, p.land_use;

-- 2. The list under the corrected rule (what 09G will write), one row per use,
--    beside the old rule, with additions and removals flagged
WITH params AS (SELECT 'epi-2013-0036'::text AS epi, 'R2'::text AS zone),
rows AS (
  SELECT p.land_use, p.level, p.status, p.named_status
  FROM nsw.lep_permissibility p, params
  WHERE p.epicode = params.epi AND p.zone_code = params.zone AND p.level IN ('leaf', 'parent')
),
new_rule AS (
  SELECT land_use FROM rows
  WHERE (level = 'leaf'   AND status IN ('permitted_with_consent','permitted_without_consent'))
     OR (level = 'parent' AND (named_status IN ('permitted_with_consent','permitted_without_consent')
                               OR (named_status IS NULL AND status IN ('permitted_with_consent','permitted_without_consent'))))
),
old_rule AS (
  SELECT land_use FROM rows
  WHERE status IN ('permitted_with_consent','permitted_without_consent')   -- old 09G: mixed parents excluded by status
)
SELECT coalesce(n.land_use, o.land_use) AS land_use,
       CASE WHEN o.land_use IS NULL THEN 'added' WHEN n.land_use IS NULL THEN 'removed' ELSE '' END AS change
FROM new_rule n FULL JOIN old_rule o USING (land_use)
ORDER BY change DESC, 1;

-- 3. The same list as the single string 09G stores in up_property_d_4.permissible_uses
WITH params AS (SELECT 'epi-2013-0036'::text AS epi, 'R2'::text AS zone)
SELECT count(*) AS n_uses, string_agg(u.land_use, ', ' ORDER BY u.land_use) AS permissible_uses
FROM nsw.lep_permissibility u, params
WHERE u.epicode = params.epi AND u.zone_code = params.zone
  AND ((u.level = 'leaf'   AND u.status IN ('permitted_with_consent','permitted_without_consent'))
    OR (u.level = 'parent' AND (u.named_status IN ('permitted_with_consent','permitted_without_consent')
                                OR (u.named_status IS NULL AND u.status IN ('permitted_with_consent','permitted_without_consent')))));
