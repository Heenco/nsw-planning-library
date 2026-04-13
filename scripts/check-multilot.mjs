import pg from 'pg'
const c = new pg.Client('postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg')
await c.connect()
await c.query('SET search_path TO nsw, public')

const r = await c.query(`
  SELECT propid, count(DISTINCT lotnumber || '/' || planlabel) as lot_count
  FROM up_property_comprehensive
  GROUP BY propid
  HAVING count(DISTINCT lotnumber || '/' || planlabel) > 1
  ORDER BY lot_count DESC
  LIMIT 5
`)

for (const row of r.rows) {
  console.log(`\npropid ${row.propid} — ${row.lot_count} distinct lots:`)
  const r2 = await c.query(`
    SELECT DISTINCT ON (lotnumber, planlabel)
      address, lotnumber, planlabel, lot_section_plan, area_sqm
    FROM up_property_comprehensive
    WHERE propid = $1
    ORDER BY lotnumber, planlabel
  `, [row.propid])
  for (const lot of r2.rows) {
    console.log(`  ${lot.lot_section_plan}  ${lot.area_sqm} sqm  (${lot.address})`)
  }
}

await c.end()
