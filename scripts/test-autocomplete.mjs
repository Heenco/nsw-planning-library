import pg from 'pg'

const c = new pg.Client('postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg')
await c.connect()
await c.query('SET search_path TO nsw, public')

async function test(label, streetNum, filters) {
  const whereParts = filters.map((_f, i) => `address ILIKE $${i + 1}`).join(' AND ')
  const params = [...filters.map(f => '%' + f + '%'), streetNum]
  const streetIdx = params.length
  const sql = `
    WITH matches AS (
      SELECT DISTINCT ON (address)
        address,
        (CASE
           WHEN address ~ ('^[0-9]+[A-Za-z]?\\s*/\\s*' || $${streetIdx} || '[A-Za-z]?\\s') THEN 0
           WHEN address ~ ('^' || $${streetIdx} || '[A-Za-z]?\\s') THEN 0
           ELSE 1
         END) AS _exact,
        ABS(
          COALESCE(
            NULLIF(substring(address from '^[0-9]+[A-Za-z]?\\s*/\\s*([0-9]+)'), '')::int,
            NULLIF(substring(address from '^([0-9]+)'), '')::int,
            999999
          ) - $${streetIdx}::int
        ) AS _dist
      FROM up_property_comprehensive
      WHERE ${whereParts}
      ORDER BY address
    )
    SELECT * FROM matches ORDER BY _exact, _dist, address LIMIT 6
  `
  const r = await c.query(sql, params)
  console.log(`\n${label}:`)
  for (const row of r.rows) {
    console.log(`  ${row.address}  exact=${row._exact}  dist=${row._dist}`)
  }
}

await test('1/500 Dean Street Albury', '500', ['DEAN', 'STREET', 'ALBURY'])
await test('500 Dean Street Albury',  '500', ['DEAN', 'STREET', 'ALBURY'])
await c.end()
