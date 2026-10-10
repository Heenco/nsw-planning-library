"""
RAG pilot - answer keys for every plan in the corpus, from sources independent of side D (schema rag, table rag.key).

    python scripts/rag/06a-keys.py            # every LEP in rag.instrument
    python scripts/rag/06a-keys.py --dry      # print the keys, write nothing

Onboarding a council means it gets keys, and D is scored against them (06-questions.ts turns rag.key into questions with
status 'key'). Two kinds, both read from somewhere D does not read:

  lut   The plan's Land Use Table, parsed here from the legislation XML (D's permissions come from nsw.lep_permissibility,
        built by another reader). A use literally listed in item 2, 3 or 4 of the lot's zone is that item's answer; in a
        closed zone ("Any development not specified in item 2 or 3") a use is prohibited when neither it nor any group term
        that includes it - the same XML's Dictionary, "... includes any of the following" - is listed in items 2 or 3.
        Asked "Under <plan>, ..." on lots outside every mapped area a clause governs and outside every lot a clause names,
        so the table is the plan's whole answer there.
  map   The lot's zone, height, floor space ratio and minimum lot size from the live NSW Planning Portal map service
        (Planning_Portal_Principal_Planning), not the epi dump D reads: the lot shrunk 1 m inward, each figure's share of it.
        A figure over 90% of what is mapped is the key; a lot split between figures is keyed "maybe". A height in RL (a
        reduced level, not metres above ground) is keyed only when the layer gives the metres too.

Lots: per plan, the zones with the most land, 2 lots each, chosen by rule (lowest cadid in the first zoning polygons, no
strata, 300 - 3,000 m2). A response missing the fields its layer declares (the service's degraded mode) is retried, never
keyed from.
"""
import json, re, sys, time
import psycopg2
from lxml import etree
from curl_cffi import requests
from corpus_xml import env, sources

DRY = '--dry' in sys.argv
SVC = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer'
LAYERS = {'zone': (19, 'SYM_CODE'), 'height': (14, 'MAX_B_H'), 'fsr': (11, 'FSR'), 'lot_size': (22, 'LOT_SIZE')}
ZONES_PER_PLAN, LOTS_PER_ZONE = 8, 2
# uses asked about in every zone besides the ones the table lists - housing and the common commercial ones
PROBES = ['dual occupancy (attached)', 'dual occupancy (detached)', 'multi dwelling housing', 'residential flat building', 'secondary dwelling',
          'shop top housing', 'office premises', 'shop', 'light industry', 'hotel or motel accommodation']


def key(u):
    """a land use however the table spells it: lower case, singular per word, no articles"""
    u = re.sub(r'\s+', ' ', u.replace('’', "'")).strip().lower().strip(' .;,')
    u = re.sub(r'^\([a-z]{1,3}\)\s*', '', u)                          # a list label left on the item
    u = re.sub(r'^(a|an|the)\s+', '', u)
    words = []
    for w in u.split(' '):
        if w.endswith('ies') and len(w) > 4: w = w[:-3] + 'y'
        elif w.endswith('s') and not w.endswith('ss') and len(w) > 3: w = w[:-1]
        words.append(w)
    return ' '.join(words).strip(' .;,')


def parse(path):
    raw = re.sub(r'<!DOCTYPE[^>]*>', '', path.read_text(encoding='utf-8'))
    return etree.fromstring(raw.encode('utf-8'), parser=etree.XMLParser(recover=True, huge_tree=True))


def text(el):
    return re.sub(r'\s+', ' ', ' '.join(el.itertext())).strip()


def groups_of(root):
    """the Dictionary's group terms: term -> the uses it includes ("residential accommodation means a building ... and
    includes any of the following- (a) attached dwellings, ..."; "dual occupancy means a dual occupancy (attached) or a
    dual occupancy (detached)")"""
    out = {}
    for el in root.iter():
        i = el.get('id') or ''
        if not re.match(r'^(dict|sch\.[^-]+)-def\.[^-]+$', i):
            continue
        # the id is on the <defterm>; the definition is the block it sits in - its sentence and the list that follows
        blk = el
        while blk is not None and blk.tag != 'block':
            blk = blk.getparent()
        t = text(blk if blk is not None else el)
        m = re.match(r'^(.+?) means (.*)$', t)
        if not m:
            continue
        term = key(m.group(1))
        body = re.split(r'\s+Note\b', m.group(2))[0]                        # a Note after the definition is not part of it
        members = []
        if re.search(r'any of the following', body):
            # each "(a) attached dwellings," item - its label one to three letters ("(baa)"), never "(attached)" - up to
            # "but does not include", whose items are the opposite
            tail = re.split(r'but does not include', body.split('following', 1)[1])[0]
            members = [key(re.sub(r'[,;]?\s*(?:or|and)?\s*$', '', mm.group(1))) for mm in re.finditer(r'\([a-z]{1,3}\)\s*(.+?)(?=\s*\([a-z]{1,3}\)\s|$)', tail)]
        else:
            alt = re.match(r'^an? (.+?) or an? (.+?)\.?$', body)
            if alt and key(alt.group(1)).startswith(term.split(' (')[0]): members = [key(alt.group(1)), key(alt.group(2))]
        members = [x for x in members if x and len(x) < 80]
        if members:
            out[term] = members
    return out


def governed_of(root, defined, groups):
    """uses a clause of the plan outside its Land Use Table permits or bars on its own ("Development consent must not be
    granted to development for the purposes of dual occupancies (detached) on land in a residential zone ...", Parramatta
    6.11(2)) - for them the table is not the plan's whole answer, so they are not keyed. Read from the same XML, with the
    use's kinds and the groups that include it"""
    out = set()
    for el in root.iter():
        i = el.get('id') or ''
        # the plan's clauses (a Schedule 1 item is site-specific: its land is kept out of the keyed lots instead)
        if not re.match(r'^sec\.[^-]+$', i):
            continue
        t = text(el).lower().replace('’', "'")
        # sentence by sentence: an outright bar ("must not be granted ... for the purposes of X", no "unless" - a condition
        # on the proposal is a limit, not a bar), a bar lifted only by the lot's own area or size ("... for the erection of
        # multi dwelling housing ... unless the lot has an area of at least 1,200 square metres": on a smaller lot the
        # answer is the clause's, not the table's), or the use permitted / prohibited by the clause itself
        for sent in re.split(r'(?<=[.;])\s+|\s+\(\d+\)\s+', t):
            lot_bar = re.search(r'\bunless\b.*\b(?:lot|site)\b.*(?:\barea\b|\bsize\b|\bat least [\d,.]+\s*(?:m2|square metres))', sent)
            bar = 'must not be granted' in sent and ('unless' not in sent or bool(lot_bar))
            perm = re.search(r'for the purposes? of [^.;]{3,200}? (?:is|are) (?:permitted|prohibited)\b', sent)
            if not (bar or perm):
                continue
            for m in re.finditer(r'(?:for the purposes? of|the erection of|the carrying out of) ([^.;:]{3,200})', sent):
                words = ' ' + ' '.join(key(w) for w in re.split(r'[\s,]+', m.group(1)) if w) + ' '
                for d in defined:
                    if len(d) > 4 and f' {d} ' in words:
                        out.add(d)
    # with the use's own kinds ("dual occupancy (detached)" under "dual occupancy")
    for d in list(out):
        out |= {x for x in defined if x.startswith(d + ' (')}
    return out


def defined_of(root):
    """every term the plan's Dictionary defines - a Land Use Table entry that is not one ("Uses authorised under the
    National Parks and Wildlife Act 1974") is not a land use to key"""
    return {key(text(el)) for el in root.iter() if re.match(r'^(dict|sch\.[^-]+)-def\.[^-]+$', el.get('id') or '')}


def ancestors(use, groups):
    """every group term that includes the use, nearest first"""
    parents = {m: [g for g, ms in groups.items() if m in ms] for ms in groups.values() for m in ms}
    out, todo = [], list(parents.get(use, []))
    while todo:
        g = todo.pop(0)
        if g not in out:
            out.append(g); todo += parents.get(g, [])
    return out


def descendants(use, groups):
    out, todo = set(), list(groups.get(use, []))
    while todo:
        m = todo.pop()
        if m not in out:
            out.add(m); todo += groups.get(m, [])
    return out


def tables_of(root):
    """zone code -> {2: [...], 3: [...], 4: [...], 'open': bool, 'closed': bool, 'text': {...}}"""
    out = {}
    for el in root.iter():
        m = re.match(r'^pt-cg1\.Zone_([A-Z0-9]+)$', el.get('id') or '')
        if not m:
            continue
        z = {2: [], 3: [], 4: [], 'open': False, 'closed': False, 'text': {}}
        for c in el:
            h = c.find('.//heading')
            if h is None:
                continue
            head = text(h)
            n = 2 if re.match(r'^Permitted without consent', head) else 3 if re.match(r'^Permitted with consent', head) else 4 if re.match(r'^Prohibited', head) else None
            if not n:
                continue
            body = re.sub(r'^\s*\d+\s+' + re.escape(head), '', text(c)).strip()
            z['text'][n] = body
            if n == 3 and re.search(r'Any other development not specified in item 2 or 4', body, re.I): z['open'] = True
            if n == 4 and re.search(r'Any (?:other )?development not specified in item 2 or 3', body, re.I): z['closed'] = True
            for part in re.split(r';\s*', body):
                for u in re.split(r',\s*(?=[A-Z])', part):
                    if u and not re.match(r'^(Any|Nil)\b', u, re.I):
                        z[n].append(key(u))
        out[m.group(1)] = z
    return out


def status(use, z, groups):
    """the table's answer for a use in a zone: ('yes'|'no', item, why) or None when the table alone does not settle it"""
    for n in (2, 3, 4):
        if use in z[n]:
            return ('yes' if n < 4 else 'no', n, f'listed in item {n}')
    # a narrower kind listed while the use itself is not ("dual occupancies (attached)" for "dual occupancy"): it depends
    if descendants(use, groups) & set(z[2] + z[3] + z[4]):
        return None
    for g in ancestors(use, groups):
        for n in (2, 3, 4):
            if g in z[n]:
                return ('yes' if n < 4 else 'no', n, f'"{g}" (which includes it) listed in item {n}')
    if z['closed']:
        return ('no', 4, 'not in item 2 or 3, nor any group that includes it: item 4 "Any development not specified in item 2 or 3"')
    if z['open']:
        return ('yes', 3, 'not in items 2 or 4: item 3 "Any other development not specified in item 2 or 4"')
    return None


def query_layer(layer, rings, epi, tries=4):
    """the layer's features under the lot, as GeoJSON; a response without the layer's value field is retried"""
    lid, field = LAYERS[layer]
    params = {'geometry': json.dumps({'rings': rings, 'spatialReference': {'wkid': 4283}}), 'geometryType': 'esriGeometryPolygon', 'inSR': '4283',
              'spatialRel': 'esriSpatialRelIntersects', 'where': f"EPI_NAME = '{epi.replace(chr(39), chr(39) * 2)}'", 'outFields': '*', 'outSR': '4283',
              'returnGeometry': 'true', 'f': 'geojson'}
    for attempt in range(tries):
        try:
            r = requests.post(f'{SVC}/{lid}/query', data=params, impersonate='chrome', timeout=90)
            if r.status_code == 200:
                feats = r.json().get('features', [])
                if all(field in (f.get('properties') or {}) for f in feats):
                    return feats
        except Exception:
            pass
        time.sleep(3 * 2 ** attempt)
    return None


def main():
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    rows, summary = [], {}
    for title, doc, kind, path in sources(cur):
        if kind != 'lep':
            continue
        root = parse(path)
        groups, tables, defined = groups_of(root), tables_of(root), defined_of(root)
        governed = governed_of(root, defined, groups)
        short = re.sub(r' Local Environmental Plan ', ' LEP ', title)
        # lots a clause names (Schedule 1 items, local clauses "Lot 1, DP ..."): the table is not their whole answer
        cur.execute("SELECT DISTINCT unnest(c.terms) FROM rag.claim c JOIN rag.provision p ON p.id = c.provision_id WHERE p.document_id = %s", (doc,))
        named = {x.lstrip('~').upper() for (t,) in cur.fetchall() if t and t.startswith('lots:') for x in t[5:].split('|')}
        # uses a clause permits or prohibits on land no layer draws (Ku-ring-gai Sch 1 item 85, "Area 3" on a map no polygon
        # holds): on any lot the table may not be the whole answer for them - not keyed
        cur.execute("""SELECT DISTINCT u FROM rag.coverage cv JOIN rag.claim f ON f.provision_id = cv.provision_id JOIN rag.provision up ON up.id = f.unit_provision
                         JOIN rag.provision p ON p.document_id = up.document_id AND (p.local_id = up.local_id OR p.local_id LIKE up.local_id || '-%%')
                         JOIN rag.claim c ON c.provision_id = p.id AND c.kind IN ('permit', 'prohibit'), unnest(c.uses) u
                        WHERE cv.document_id = %s AND cv.check_kind = 'clause_no_polygon'""", (doc,))
        unlocated = {key(u) for (u,) in cur.fetchall()}
        cur.execute("""SELECT trim(sym_code), count(*) FROM epi.epi_land_zoning WHERE epi_name = %s AND trim(sym_code) = ANY(%s) GROUP BY 1 ORDER BY 2 DESC LIMIT %s""",
                    (title, list(tables), ZONES_PER_PLAN))
        zones = [z for z, _ in cur.fetchall()]
        keys = []
        for zi, zone in enumerate(zones):
            cur.execute("""
              SELECT l.cadid::text, l.lotidstring,
                     ST_AsGeoJSON(ST_Buffer(l.geom::geography, -1)::geometry, 7) AS shrunk
                FROM (SELECT geom FROM epi.epi_land_zoning WHERE epi_name = %s AND trim(sym_code) = %s ORDER BY objectid LIMIT 12) z
                JOIN LATERAL (SELECT l.* FROM cadastre.lot l WHERE l.geom && z.geom AND ST_Intersects(z.geom, ST_PointOnSurface(l.geom))
                                AND l.lotidstring NOT LIKE '%%SP%%' AND ST_Area(l.geom::geography) BETWEEN 300 AND 3000 ORDER BY l.cadid LIMIT 4) l ON true
               -- outside every control layer of the plan (read from the layers, not from D's index): additional permitted uses,
               -- key sites, local and special provisions, the maps' additional controls - where the table is not the whole answer
               WHERE NOT EXISTS (SELECT 1 FROM epi.epi_additional_permitted_uses x WHERE x.epi_name = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom))
                 AND NOT EXISTS (SELECT 1 FROM epi.epi_key_sites x WHERE x.epi_name = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom))
                 AND NOT EXISTS (SELECT 1 FROM epi.epi_local_provisions x WHERE x.epi_name = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom))
                 AND NOT EXISTS (SELECT 1 FROM epi.epi_special_provision x WHERE x.epi_name = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom))
                 AND NOT EXISTS (SELECT 1 FROM rag.additional_controls x WHERE x.epi_name = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom))
                 -- and any other mapped area of the plan, whatever the layer it came from (Area 3 on Ku-ring-gai's APU map,
                 -- Parramatta's Dual Occupancy Prohibition Map), except the maps every lot is on
                 AND NOT EXISTS (SELECT 1 FROM rag.map_polygon x WHERE x.document_id = %s AND x.geom && l.geom AND ST_Intersects(x.geom, l.geom)
                                  AND coalesce(x.label, '') <> '' AND x.map NOT IN ('land zoning', 'height of buildings', 'floor space ratio', 'lot size', 'land application', 'heritage', 'acid sulfate soils', 'flood planning'))
               ORDER BY l.cadid LIMIT %s""", (title, zone, title, title, title, title, title, doc, LOTS_PER_ZONE * 3))
            picked = [r for r in cur.fetchall() if (r[1] or '').upper() not in named][:LOTS_PER_ZONE]
            z = tables[zone]
            for li, (cadid, lotid, shrunk) in enumerate(picked):
                # the Land Use Table: one listed use per item where the table lists some, and two probes, rotated by lot
                listed = [(u, n) for n in (2, 3, 4) for u in [x for x in z[n] if x in defined][:1]]
                probes = [PROBES[(zi * 3 + li * 2 + k) % len(PROBES)] for k in range(2)]
                for use in [u for u, _ in listed] + probes:
                    if key(use) in unlocated or key(use) in governed:
                        continue
                    st = status(key(use), z, groups)                      # the table's uses are normalised: so is the asked one
                    if st:
                        keys.append((doc, 'lut', cadid, use, {'verdict': st[0]}, f'{short} Land Use Table, Zone {zone}, item {st[1]} (legislation XML)',
                                     f'{st[2]}; item {st[1]}: "{z["text"].get(st[1], "")[:200]}"'))
                # the live map service: each map's figure and its share of the lot (shrunk 1 m)
                gj = json.loads(shrunk) if shrunk else None
                if not gj or gj.get('type') not in ('Polygon', 'MultiPolygon'):
                    continue
                rings = gj['coordinates'] if gj['type'] == 'Polygon' else [r for poly in gj['coordinates'] for r in poly]
                for layer, (lid, field) in LAYERS.items():
                    feats = query_layer(layer, rings, title)
                    if feats is None or not feats:
                        continue
                    shares = {}
                    for f in feats:
                        p = f['properties']
                        val = p.get(field)
                        if layer == 'height' and str(p.get('UNITS') or 'm').strip().lower() not in ('m', 'metres', 'meters'):
                            val = p.get('MAX_B_H_M')                     # a reduced level: keyed only in metres
                        if layer == 'lot_size' and val is not None and re.search(r'ha', str(p.get('UNITS') or ''), re.I):
                            val = float(val) * 10000
                        if val is None or f.get('geometry') is None:
                            continue
                        cur.execute("""SELECT ST_Area(ST_Intersection(ST_GeomFromGeoJSON(%s), ST_SetSRID(ST_GeomFromGeoJSON(%s), 4283))::geography) / nullif(ST_Area(ST_GeomFromGeoJSON(%s)::geography), 0)""",
                                    (json.dumps({**gj, 'crs': {'type': 'name', 'properties': {'name': 'EPSG:4283'}}}), json.dumps(f['geometry']), json.dumps({**gj, 'crs': {'type': 'name', 'properties': {'name': 'EPSG:4283'}}})))
                        s = float(cur.fetchone()[0] or 0)
                        v = str(val).strip() if layer == 'zone' else round(float(val), 3)
                        shares[v] = shares.get(v, 0) + s
                    parts = sorted([(v, s) for v, s in shares.items() if s > 0.05], key=lambda x: -x[1])
                    if not parts:
                        continue
                    mapped = sum(s for _, s in parts)
                    src = f'NSW Planning Portal map service, layer {lid} ({field}), {time.strftime("%Y-%m-%d")}'
                    if parts[0][1] >= 0.9 * mapped:
                        exp = {'verdict': 'yes', 'zone': parts[0][0]} if layer == 'zone' else {'value': parts[0][0], 'unit': {'height': 'm', 'fsr': 'ratio', 'lot_size': 'm2'}[layer]}
                    elif layer == 'zone':
                        continue                                          # a lot two zones split: not a single key
                    else:
                        exp = {'verdict': 'maybe', 'values': {f'{round(s * 100)}% of the lot': v for v, s in parts}}
                    keys.append((doc, 'map', cadid, layer, exp, src, ', '.join(f'{v} on {round(s * 100)}%' for v, s in parts)))
        rows += keys
        summary[title] = {'zones': len(zones), 'lots': len({k[2] for k in keys}), 'lut': sum(1 for k in keys if k[1] == 'lut'), 'map': sum(1 for k in keys if k[1] == 'map')}
        print(title, summary[title])
        for k in keys[:6]:
            print('   ', k[1], k[2], k[3], json.dumps(k[4]), '|', k[5][:70])
    if DRY:
        return
    cur.execute("INSERT INTO rag.run (stage, config) VALUES ('keys', %s) RETURNING id", (json.dumps({'zones_per_plan': ZONES_PER_PLAN, 'lots_per_zone': LOTS_PER_ZONE}),))
    run = cur.fetchone()[0]
    cur.execute("DELETE FROM rag.key")
    for r in rows:
        cur.execute("INSERT INTO rag.key (document_id, kind, cadid, subject, expected, source, note, run_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (r[0], r[1], r[2], r[3], json.dumps(r[4]), r[5], r[6], run))
    cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps(summary), run))
    con.commit()
    print(f'written {len(rows)} keys')


if __name__ == '__main__':
    main()
