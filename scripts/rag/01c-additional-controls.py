"""
RAG pilot - the planning maps' additional controls, copied from UrbanPortalDBP into planningai rag.additional_controls.

    python scripts/rag/01c-additional-controls.py          # replace the copy (every plan: the layers are statewide)
    python scripts/rag/01c-additional-controls.py --dry    # counts only

The feature services' "Additional Controls" layers (urbanportaldbp."AdditionalControls_FSR | _HOB | _LZN | _LotSize")
hold areas the GEODAAS EPI dump leaves out - Hornsby's Cherrybrook Areas 1, 2 (Height of Buildings Map) and 10 (Floor
Space Ratio Map), incentive heights and floor space ratios. UrbanPortalDBP is reached over SSH (psql as postgres,
read-only COPY ... TO STDOUT); its password is PIPELINE_SSH_PASSWORD in the app .env, read at run time and never
printed. planningai is the app's DATABASE_URL. 02d-bindings.ts then adds the copy to rag.map_polygon.
"""
import csv, io, json, sys
from pathlib import Path
import paramiko, psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from corpus_xml import env

DRY = '--dry' in sys.argv
HOST = '172.105.183.89'
# each layer: the map it draws, and which of its columns carry the area, clause and figure
LAYERS = {
    'AdditionalControls_FSR': ('Floor Space Ratio Map', '"LEGIS_REF_AREA"', '"LEGIS_REF_CLAUSE"', '"LEGIS_REF_VALUE"'),
    'AdditionalControls_HOB': ('Height of Buildings Map', 'NULL', '"LEGIS_REF_CLAUSE"', 'coalesce("LEGIS_REF_VALUE"::text, "MAX_B_H_M"::text)'),
    'AdditionalControls_LZN': ('Land Zoning Map', '"LEGIS_REF_AREA"', 'NULL', 'NULL'),
    'AdditionalControls_LotSize': ('Lot Size Map', '"LEGIS_REF_AREA"', '"LEGIS_REF_CLAUSE"', '"LEGIS_REF_VALUE"'),
}
# a date column may hold epoch milliseconds (the feature service's export) or a date
DATE = """CASE WHEN "CURRENCY_DATE"::text ~ '^[0-9]{11,}$' THEN to_timestamp("CURRENCY_DATE"::text::bigint / 1000)::date::text
               WHEN "CURRENCY_DATE"::text ~ '^[0-9]{4}-' THEN left("CURRENCY_DATE"::text, 10) END"""


def pull():
    pw = env('PIPELINE_SSH_PASSWORD')
    if not pw:
        sys.exit('PIPELINE_SSH_PASSWORD is not in the app .env')
    selects = [f"""SELECT '{t}', "OBJECTID", "EPI_NAME", '{m}', "LABEL"::text, {a}::text, {c}::text, {v}::text, "AMENDMENT"::text, {DATE},
                      encode(ST_AsEWKB(ST_MakeValid(geometry)), 'hex') FROM urbanportaldbp."{t}" WHERE geometry IS NOT NULL AND "EPI_NAME" IS NOT NULL"""
               for t, (m, a, c, v) in LAYERS.items()]
    sql = "SET statement_timeout = '600s';\nCOPY (" + "\nUNION ALL\n".join(selects) + ") TO STDOUT WITH (FORMAT csv);\n"
    cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username='root', password=pw, look_for_keys=False, allow_agent=False, timeout=30)
    _, out, err = cli.exec_command("sudo -u postgres psql -d UrbanPortalDBP -X -q <<'EOSQL'\n" + sql + "EOSQL\n", timeout=900)
    data = out.read().decode('utf-8'); e = err.read().decode('utf-8', 'replace').strip()
    cli.close()
    if e and 'SET' not in e:
        sys.exit(f'UrbanPortalDBP: {e[:500]}')
    return [r for r in csv.reader(io.StringIO(data)) if len(r) == 11]


def main():
    rows = pull()
    by = {}
    for r in rows: by[r[0]] = by.get(r[0], 0) + 1
    print('pulled', len(rows), by)
    if DRY:
        return
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    cur.execute("INSERT INTO rag.run (stage, config) VALUES ('additional_controls', %s) RETURNING id", (json.dumps({'source': f'UrbanPortalDBP@{HOST}', 'layers': list(LAYERS)}),))
    run = cur.fetchone()[0]
    cur.execute('DELETE FROM rag.additional_controls')
    buf = io.StringIO(); w = csv.writer(buf)
    for r in rows: w.writerow([*r[:10], r[10]])
    buf.seek(0)
    cur.execute('CREATE TEMP TABLE ac_in (source text, source_id text, epi_name text, map_name text, label text, legis_area text, legis_clause text, legis_value text, amendment text, currency_date text, wkb text) ON COMMIT DROP')
    cur.copy_expert('COPY ac_in FROM STDIN WITH (FORMAT csv)', buf)
    cur.execute("""INSERT INTO rag.additional_controls (source, source_id, epi_name, map_name, label, legis_area, legis_clause, legis_value, amendment, currency_date, geom, run_id)
                   SELECT source, nullif(source_id, '')::numeric::bigint, epi_name, map_name, nullif(label, ''), nullif(nullif(legis_area, ''), '<Null>'), nullif(nullif(legis_clause, ''), '<Null>'),
                          nullif(nullif(legis_value, ''), '<Null>'), nullif(nullif(amendment, ''), '<Null>'), nullif(currency_date, '')::date,
                          ST_Transform(ST_SetSRID(ST_GeomFromEWKB(decode(wkb, 'hex')), 4326), 4283), %s FROM ac_in""", (run,))
    n = cur.rowcount
    cur.execute("SELECT epi_name, map_name, count(*) FROM rag.additional_controls WHERE epi_name IN (SELECT title FROM rag.instrument) GROUP BY 1, 2 ORDER BY 1, 2")
    held = cur.fetchall()
    cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps({'rows': n, 'by_layer': by, 'corpus_plans': [list(map(str, h)) for h in held]}), run))
    con.commit()
    print('written', n)
    for h in held: print('  ', *h)


main()
