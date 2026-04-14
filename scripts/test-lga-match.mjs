import pg from 'pg'

const c = new pg.Client('postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg')
await c.connect()
await c.query('SET search_path TO nsw, public')

const normalizeSql = `LOWER(TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE($1, '^\\s*(city of|shire of|municipality of|council of)\\s+', '', 'i'),
      '\\s+(city council|regional council|shire council|council|city|shire)\\s*$', '', 'i'
    ),
    '\\s+', ' ', 'g'
  )
))`

// Simulate the join: show DB lga_name + its normalized form, then test against filter values
const filters = ['ALBURY CITY', 'CITY OF PARRAMATTA', 'GEORGES RIVER', 'RANDWICK']

for (const filterVal of filters) {
  console.log(`\n== filter: "${filterVal}" ==`)
  const r = await c.query(
    `SELECT DISTINCT doc_type, lga_name, title
     FROM document
     WHERE doc_type='dcp' AND ${normalizeSql.replace(/\$1/g, 'lga_name')} = ${normalizeSql.replace(/\$1/g, '$1')}
     ORDER BY lga_name`,
    [filterVal]
  )
  if (r.rows.length === 0) {
    console.log('  NO MATCH')
  } else {
    for (const row of r.rows) console.log(`  → ${row.lga_name}: ${row.title}`)
  }
}

await c.end()
