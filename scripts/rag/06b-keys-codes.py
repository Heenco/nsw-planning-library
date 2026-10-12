"""
RAG pilot - answer keys for the complying development codes (State Environmental Planning Policy (Exempt and Complying
Development Codes) 2008), from sources side D does not read, on the lots the plans' keys already sample (rag.key).

  python scripts/rag/06b-keys-codes.py [--dry]

Three kinds, all written to rag.key against the codes policy's document:
  cdc_land      the land exclusions of cl 1.19 that the live Planning Portal map services draw: is the lot on a heritage
                conservation area, a heritage item, bush fire prone land, a flood planning area, acid sulfate soils class
                1 or 2, a foreshore building line area, landslide risk land, reserved land, environmentally sensitive
                land, a drinking water catchment - each a yes / no from the service's own polygons over the lot (shrunk
                1 m), each one of the registry terms D's bindings test, so the question checks our copy of the layer
                against the service
  cdc_eligible  the Housing Code on the lot: the lot requirements of its first clause - the zones named, the minimum
                area and width at the building line (the lot's primary frontage, the rule every test here uses) - read
                from the policy's XML, and the portal's answers above: 'no' where a requirement fails or a drawn
                exclusion covers the lot, 'yes' where every testable requirement holds (the note names what no service
                draws: contaminated land, biobanking, Water NSW special areas, draft heritage)
  cdc_standard  the Housing Code's development standards for a dwelling house on the lot, computed from the tables in
                the policy's XML by the lot's area and width: maximum gross floor area (3.9), minimum landscaped area
                (3.13), side and rear setbacks (3.10, split by the building's height where the table is), maximum
                building height (3.8)

The XML tables are parsed here on their own (a second, independent reading of the same instrument text - D reads the
pilot tree, never this file), so a figure the two agree on was reached twice.
"""
import json, os, re, sys, time
from pathlib import Path

import psycopg2
from curl_cffi import requests

sys.path.insert(0, str(Path(__file__).parent))
from corpus_xml import env, sources  # noqa: E402

DRY = '--dry' in sys.argv
EP = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning'
# the cl 1.19 land exclusions a Planning Portal service draws: registry term (as D's bindings name it) -> service, layer,
# and how a feature counts (a class filter on the feature's own fields; None = any feature)
LAND = {
    # (layer 15 "Heritage" is a group; 16 "EPI Heritage" is the one that answers, by LAY_CLASS)
    'heritage conservation area':        ('Planning_Portal_Principal_Planning', 16,  lambda p: re.search(r'conservation', str(p.get('LAY_CLASS') or ''), re.I)),
    'heritage item':                     ('Planning_Portal_Principal_Planning', 16,  lambda p: re.search(r'item', str(p.get('LAY_CLASS') or ''), re.I)),
    'land reserved for a public purpose': ('Planning_Portal_Principal_Planning', 24,  None),
    'foreshore area':                    ('Planning_Portal_Principal_Planning', 26,  None),
    'bush fire prone land':              ('Planning_Portal_Hazard', 229, None),
    'flood planning area':               ('Planning_Portal_Hazard', 230, None),
    'susceptible to landslide risk':     ('Planning_Portal_Hazard', 232, None),
    'acid sulfate soils class 1 or 2':   ('Planning_Portal_Protection', 234, lambda p: re.search(r'(^|\D)[12](\D|$)', str(p.get('CLASS') or p.get('LAY_CLASS') or ''))),
    'environmentally sensitive':         ('Planning_Portal_Protection', 245, None),
}
# the layers that bar the Housing Code outright, by the policy's own words: a heritage conservation area (1.19(1)(a)),
# a heritage item (1.17A(1)(d)(iii)), reserved land (1.19(1)(b)), acid sulfate soils class 1 or 2 (c), environmentally
# sensitive land (e), a foreshore area (g), landslide risk land (3.2(1)(h)). Bush fire prone land and flood planning land
# are not bars: the code carries conditions for them (1.19A, 3.4, 3.5) - keyed as layers only
BARS = {'heritage conservation area', 'heritage item', 'land reserved for a public purpose', 'acid sulfate soils class 1 or 2', 'environmentally sensitive', 'foreshore area', 'susceptible to landslide risk'}
# what no service draws, and so what a 'yes' here cannot vouch for
UNDRAWN = 'significantly contaminated land, land under a biobanking or conservation agreement, Water NSW special areas, draft heritage items or areas, unsewered land in a drinking water catchment'


def text(el):
    return re.sub(r'\s+', ' ', ''.join(el.itertext())).strip()


def num(s):
    return float(str(s).replace(',', ''))


def band_of(s):
    """'200m2–250m2' / '>250m2–300m2' / '>1,000m2' / '6m–18m' / '>24m' -> (lo, lo_incl, hi, hi_incl)"""
    s = s.replace('–', '-').replace('—', '-')
    m = re.match(r'^\s*(>)?\s*([\d,.]+)\s*(?:m2|m)?\s*-\s*([\d,.]+)\s*(?:m2|m)?\s*$', s)
    if m: return (num(m.group(2)), m.group(1) != '>', num(m.group(3)), True)
    m = re.match(r'^\s*>\s*([\d,.]+)', s)
    if m: return (num(m.group(1)), False, None, False)
    m = re.match(r'^\s*<\s*([\d,.]+)', s)
    if m: return (None, False, num(m.group(1)), False)
    return None


def in_band(v, b):
    lo, lo_incl, hi, hi_incl = b
    return (lo is None or (v >= lo if lo_incl else v > lo)) and (hi is None or (v <= hi if hi_incl else v < hi))


def value_of(s, area=None):
    """a cell's figure for a lot: '335m2' -> 335; '25% of lot area + 150m2' -> 0.25*area+150; '900mm' -> 0.9; '8.5m'"""
    s = s.replace(' ', ' ')
    m = re.match(r'^\s*([\d.]+)\s*% of lot area(?:\s*\+\s*([\d,.]+)\s*m2)?', s)
    if m: return None if area is None else round(num(m.group(1)) / 100 * area + (num(m.group(2)) if m.group(2) else 0), 1)
    m = re.match(r'^\s*([\d,.]+)\s*mm\b', s)
    if m: return num(m.group(1)) / 1000
    m = re.match(r'^\s*([\d,.]+)\s*(?:m2|m)\b', s)
    if m: return num(m.group(1))
    return None


def tables(root, prefix):
    """every table under provisions whose id starts with prefix: (provision id, [captions], [[cells]])"""
    out = []
    for el in root.iter():
        i = el.get('id') or ''
        if not i.startswith(prefix) or el.tag != 'table':
            continue
        heads = [text(e) for r in el.iter('row') if 'tblh' in (r.get('id') or '') for e in r.iter('entry')]
        rows = [[text(e) for e in r.iter('entry')] for r in el.iter('row') if 'tblh' not in (r.get('id') or '')]
        out.append((i, heads, rows))
    return out


def lookup(tbl, lot_area, lot_width):
    """the rows of a table that fit the lot, by its area / width band columns; a further band column (a building height)
    splits the answer into cases keyed by that column's cell"""
    heads, rows = tbl[1], tbl[2]
    band_cols = [k for k, h in enumerate(heads) if re.search(r'lot (area|size|width)|width of', h, re.I)]
    other_cols = [k for k, h in enumerate(heads) if k not in band_cols and re.search(r'height|setback of', h, re.I) and all(band_of(r[k]) for r in rows if k < len(r))]
    value_cols = [k for k in range(len(heads)) if k not in band_cols and k not in other_cols]
    hits = []
    for r in rows:
        ok = True
        for k in band_cols:
            b = band_of(r[k]) if k < len(r) else None
            v = lot_width if re.search(r'width', heads[k], re.I) else lot_area
            if not b or v is None or not in_band(v, b): ok = False
        if ok: hits.append(r)
    return heads, band_cols, other_cols, value_cols, hits


def query(service, lid, rings, flt, tries=3):
    """the layer's features over the lot - attributes only (a bush fire or flood polygon's geometry is huge, and a hit is
    all the key needs)"""
    params = {'geometry': json.dumps({'rings': rings, 'spatialReference': {'wkid': 4283}}), 'geometryType': 'esriGeometryPolygon', 'inSR': '4283',
              'spatialRel': 'esriSpatialRelIntersects', 'where': '1=1', 'outFields': '*', 'returnGeometry': 'false', 'f': 'json'}
    for attempt in range(tries):
        try:
            r = requests.post(f'{EP}/{service}/MapServer/{lid}/query', data=params, impersonate='chrome', timeout=60)
            if r.status_code == 200 and 'features' in r.json():
                feats = [{'properties': f.get('attributes') or {}} for f in r.json()['features']]
                return [f for f in feats if flt is None or flt(f['properties'])]
        except Exception:
            pass
        time.sleep(2 * 2 ** attempt)
    return None


def land_of(rings):
    """every exclusion layer over the lot, queried side by side"""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {term: ex.submit(query, svc, lid, rings, flt) for term, (svc, lid, flt) in LAND.items()}
        return {term: f.result() for term, f in futs.items()}


def main():
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    codes = [(t, d, k, p) for t, d, k, p in sources(cur) if 'Exempt and Complying' in t]
    if not codes:
        print('the codes policy is not in the corpus'); return
    title, doc, _, path = codes[0]
    import xml.etree.ElementTree as ET
    root = ET.fromstring(re.sub(r'<!DOCTYPE[^>]*>', '', Path(path).read_text(encoding='utf8', errors='replace')))
    # the Housing Code's own lot requirements, from its words
    req_zones, req_area, req_width = [], None, None
    for el in root.iter():
        if (el.get('id') or '') == 'sec.3.1-ssec.3':
            t = text(el)
            # "the lot must be in Zone R1, R2, R3, R4 or RU5," - the list runs to the item's end, not its first comma
            req_zones = re.findall(r'\b([A-Z]{1,2}\d{1,2})\b', re.split(r',\s*\(?[a-z]\)\s|,\s*the\b', t.split('must be in')[1], 1)[0]) if 'must be in' in t else []
            m = re.search(r'area of the lot must not be less than ([\d,.]+)\s*m2', t); req_area = num(m.group(1)) if m else None
            m = re.search(r'width of the lot must be at least ([\d,.]+)\s*m\b', t); req_width = num(m.group(1)) if m else None
    height_max = None
    for el in root.iter():
        if (el.get('id') or '') == 'sec.3.8':
            m = re.search(r'must not exceed ([\d.]+)\s*m\b', text(el)); height_max = num(m.group(1)) if m else None
    gfa = tables(root, 'sec.3.9-ssec.1'); land = tables(root, 'sec.3.13-ssec.1'); side = [t for t in tables(root, 'sec.3.10') if any(re.search(r'side', h, re.I) for h in t[1])]
    rear = [t for t in tables(root, 'sec.3.10') if any(re.search(r'rear', h, re.I) for h in t[1]) and not any(re.search(r'secondary', h, re.I) for h in t[1])]
    print(f'Housing Code: zones {req_zones}, area >= {req_area}, width >= {req_width}, height <= {height_max}; tables gfa {len(gfa)} landscaping {len(land)} side {len(side)} rear {len(rear)}')
    # the plans' sampled lots (clean lots the Land Use Table keys use), with the zone the portal gave each
    cur.execute("""SELECT k.cadid, max(k.expected->>'zone') zone FROM rag.key k WHERE k.kind = 'map' AND k.subject = 'zone' GROUP BY 1 ORDER BY 1""")
    lots = cur.fetchall()
    rows, n_land = [], 0
    for cadid, zone in lots:
        cur.execute("""SELECT ST_AsGeoJSON(ST_Buffer(l.geom::geography, -1)::geometry, 7), round(ST_Area(l.geom::geography)::numeric, 1), p.primary_frontage_length_m, p.is_battleaxe, p.is_corner_lot, l.lotidstring
                         FROM cadastre.lot l LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid WHERE l.cadid::text = %s LIMIT 1""", (cadid,))
        r = cur.fetchone()
        if not r or not r[0]: continue
        gj, area, width, battleaxe, corner, lotid = json.loads(r[0]), float(r[1]), (float(r[2]) if r[2] is not None else None), r[3], r[4], r[5]
        if gj.get('type') not in ('Polygon', 'MultiPolygon'): continue
        rings = gj['coordinates'] if gj['type'] == 'Polygon' else [x for poly in gj['coordinates'] for x in poly]
        excluded, untested = [], []
        found = land_of(rings)
        for term, (svc, lid, flt) in LAND.items():
            feats = found[term]
            if feats is None: untested.append(term); continue
            hit = len(feats) > 0
            rows.append((doc, 'cdc_land', cadid, term, {'verdict': 'yes' if hit else 'no'}, f'NSW Planning Portal {svc.replace("Planning_Portal_", "")} service, layer {lid}, {time.strftime("%Y-%m-%d")}',
                         f'{len(feats)} feature(s) over the lot (shrunk 1 m)' + (f': {json.dumps({k: v for k, v in (feats[0].get("properties") or {}).items() if k in ("LAY_CLASS", "LAY_NAME", "CLASS", "LABEL", "MAP_TYPE")})}' if hit else '')))
            n_land += 1
            if hit and term in BARS: excluded.append(term)
        # the Housing Code on the lot
        fails = []
        if zone and req_zones and zone not in req_zones: fails.append(f'zone {zone} not in {", ".join(req_zones)}')
        if req_area and area < req_area: fails.append(f'area {area} m2 < {req_area}')
        if req_width and width is not None and width < req_width: fails.append(f'width {width} m < {req_width}')
        if excluded: fails.append('cl 1.19 land: ' + ', '.join(excluded))
        if width is None: untested.append('lot width (no frontage measured)')
        if fails:
            rows.append((doc, 'cdc_eligible', cadid, 'dwelling house', {'verdict': 'no'}, 'Housing Code cl 3.1(3) lot requirements (legislation XML) + cl 1.19 land (Planning Portal services)', '; '.join(fails)))
        elif not untested:
            rows.append((doc, 'cdc_eligible', cadid, 'dwelling house', {'verdict': 'yes'}, 'Housing Code cl 3.1(3) lot requirements (legislation XML) + cl 1.19 land (Planning Portal services)',
                         f'zone {zone}, {area} m2, width {width} m; no drawn cl 1.19 land over the lot; not drawn by any service: {UNDRAWN}'))
        # the standards, from the tables, for a dwelling house on this lot - only where the code reaches the lot (its zone,
        # area and width tests), since a standard of a code that does not apply is no standard
        if fails: continue
        if height_max: rows.append((doc, 'cdc_standard', cadid, 'height', {'value': height_max, 'unit': 'm'}, 'Housing Code cl 3.8 (legislation XML)', 'maximum building height'))
        for name, tbls, subject, unit in [('gross floor area', gfa, 'floor_area', 'm2'), ('landscaped area', land, 'landscaping', 'm2'), ('side setback', side, 'setback_side', 'm'), ('rear setback', rear, 'setback_rear', 'm')]:
            for tbl in tbls:
                heads, band_cols, other_cols, value_cols, hits = lookup(tbl, area, width)
                if not hits or not value_cols: continue
                k = value_cols[0]
                if other_cols:
                    cases = {f'{heads[other_cols[0]].lower()} {h[other_cols[0]]}': value_of(h[k], area) for h in hits if k < len(h)}
                    cases = {c: v for c, v in cases.items() if v is not None}
                    if cases: rows.append((doc, 'cdc_standard', cadid, subject, {'verdict': 'maybe', 'values': cases, 'unit': unit}, f'Housing Code {tbl[0].split("-tbl")[0].replace("sec.", "cl ")} table (legislation XML)', f'{name}: by {heads[other_cols[0]].lower()}; lot {area} m2, width {width} m'))
                else:
                    v = value_of(hits[0][k], area)
                    if v is not None: rows.append((doc, 'cdc_standard', cadid, subject, {'value': v, 'unit': unit}, f'Housing Code {tbl[0].split("-tbl")[0].replace("sec.", "cl ")} table (legislation XML)', f'{name}: row "{" | ".join(hits[0])}"; lot {area} m2, width {width} m'))
                break
        print(cadid, lotid, zone, area, width, 'excluded:', excluded or '-', 'fails:', fails or '-', 'untested:', untested or '-', flush=True)
    print(f'{len(lots)} lots: {n_land} land keys, {sum(1 for r in rows if r[1] == "cdc_eligible")} eligibility keys, {sum(1 for r in rows if r[1] == "cdc_standard")} standard keys')
    for r in rows[:12]: print('   ', r[1], r[2], r[3], json.dumps(r[4]), '|', r[6][:90])
    if DRY: return
    cur.execute("INSERT INTO rag.run (stage, config) VALUES ('keys-codes', %s) RETURNING id", (json.dumps({'lots': len(lots), 'land_layers': list(LAND)}),))
    run = cur.fetchone()[0]
    cur.execute("DELETE FROM rag.key WHERE document_id = %s", (doc,))
    for r in rows:
        cur.execute("INSERT INTO rag.key (document_id, kind, cadid, subject, expected, source, note, run_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", (r[0], r[1], r[2], r[3], json.dumps(r[4]), r[5], r[6], run))
    cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps({'keys': len(rows)}), run))
    con.commit()
    print(f'written {len(rows)} keys')


if __name__ == '__main__':
    main()
