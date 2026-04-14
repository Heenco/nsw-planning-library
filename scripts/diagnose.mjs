import pg from 'pg'

const c = new pg.Client('postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg')
await c.connect()
await c.query('SET search_path TO nsw, public')

// 1. Real coords for sample addresses
const addrs = ['500 DEAN STREET ALBURY', '11 MACMAHON STREET HURSTVILLE',
               '10 BOUNDARY STREET PARRAMATTA', '43 GREVILLE STREET CLOVELLY', '1 MARTIN PLACE SYDNEY']
const r1 = await c.query(
  `SELECT address, centroid_lat, centroid_lon FROM up_property_comprehensive WHERE address = ANY($1::text[]) ORDER BY address`,
  [addrs]
)
console.log('== Actual DB coords ==')
for (const row of r1.rows) {
  console.log(`  ${row.address}  lat=${row.centroid_lat}  lng=${row.centroid_lon}`)
}

// 2. Indexes on table
const r2 = await c.query(
  `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='up_property_comprehensive' AND schemaname='nsw'`
)
console.log('\n== Indexes ==')
for (const row of r2.rows) console.log(`  ${row.indexname}`)

// 3. Time the KNN query using old Albury sample coords (-36.0737, 146.9135)
const t0 = Date.now()
const r3 = await c.query(
  `SELECT address FROM up_property_comprehensive
   WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
   ORDER BY (centroid_lat::float8 - $1)^2 + (centroid_lon::float8 - $2)^2
   LIMIT 1`,
  [-36.0737, 146.9135]
)
console.log(`\n== KNN query took ${Date.now() - t0}ms ==`)
console.log(`Nearest to (-36.0737, 146.9135): ${r3.rows[0]?.address}`)

await c.end()
