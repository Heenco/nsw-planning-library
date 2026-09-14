-- What 09G would write for one zone, from nsw.lep_permissibility, under the
-- corrected group-term rule, beside the old rule, with the difference.
--
-- Set the two values at the top. Randwick LEP 2012 is epi-2013-0036.
-- Run against planningai (nsw schema) or, with the schema changed to
-- urbanportaldbp, against UrbanPortalDBP.

\set epi 'epi-2013-0036'
\set zone 'R2'

-- 1. The group terms, both answers side by side, and what the change does
SELECT land_use,
       status                                   AS members_rolled_up,
       coalesce(named_status, '(never named)')  AS plan_says,
       named_source_text                        AS plan_line,
       CASE
         WHEN named_status IN ('permitted_with_consent','permitted_without_consent')
              AND status NOT IN ('permitted_with_consent','permitted_without_consent') THEN 'ADDED to the list'
         WHEN named_status = 'prohibited'
              AND status IN ('permitted_with_consent','permitted_without_consent')     THEN 'REMOVED from the list'
         ELSE ''
       END AS change
FROM nsw.lep_permissibility
WHERE epicode = :'epi' AND zone_code = :'zone' AND level = 'parent'
ORDER BY change DESC, land_use;

-- 2. The list under the corrected rule (what 09G will write), one row per use
WITH rows AS (
  SELECT land_use, level, status, named_status
  FROM nsw.lep_permissibility
  WHERE epicode = :'epi' AND zone_code = :'zone' AND level IN ('leaf', 'parent')
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
SELECT land_use,
       CASE WHEN o.land_use IS NULL THEN 'added' WHEN n.land_use IS NULL THEN 'removed' ELSE '' END AS change
FROM new_rule n FULL JOIN old_rule o USING (land_use)
ORDER BY change DESC, land_use;

-- 3. The same list as the single string 09G stores in up_property_d_4.permissible_uses
SELECT count(*) AS n_uses, string_agg(land_use, ', ' ORDER BY land_use) AS permissible_uses
FROM nsw.lep_permissibility u
WHERE epicode = :'epi' AND zone_code = :'zone'
  AND ((u.level = 'leaf'   AND u.status IN ('permitted_with_consent','permitted_without_consent'))
    OR (u.level = 'parent' AND (u.named_status IN ('permitted_with_consent','permitted_without_consent')
                                OR (u.named_status IS NULL AND u.status IN ('permitted_with_consent','permitted_without_consent')))));
