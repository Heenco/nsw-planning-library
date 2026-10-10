"""
RAG pilot - the legislation XML behind each instrument in schema rag, for the Python stages (01b-groups.py, 02a-terms.py).

Each instrument is read at the date its text is in force as at (rag.instrument.as_at, set by 01-snapshot.ts from
nsw.document), so the clause groups and definitions come from the same version as the provisions. The file lives in
Notebooks/Data/rag_pilot/<epi code>.<as at>.xml and is fetched from the NSW legislation export when missing - with
curl_cffi impersonating Chrome, because the site filters on the TLS fingerprint (a plain request gets 403).
"""
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
DATA = APP.parent / 'Notebooks' / 'Data' / 'rag_pilot'


def env(key):
    for line in (APP / '.env').read_text(encoding='utf-8').splitlines():
        if line.startswith(key + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")


def _valid_at(raw, as_at):
    """the exdoc's own validity covers as_at: first.valid.date <= as_at and (no end.valid.date, or it is later)"""
    head = raw[:2000].decode('utf-8', 'replace')
    first = re.search(r'first\.valid\.date="([^"]*)"', head)
    end = re.search(r'end\.valid\.date="([^"]*)"', head)
    return bool(first and first.group(1) and first.group(1) <= as_at and (not end or not end.group(1) or end.group(1) > as_at))


def xml_for(epi_code, as_at, fallback=None):
    """the instrument's XML in force at as_at, fetched once and kept. When the site cannot be reached, a copy already on
    disk (fallback: the file the nsw ingest loaded, nsw.document.raw_path) is used if its own validity dates cover as_at"""
    path = DATA / f'{epi_code}.{as_at}.xml'
    if path.exists() and path.stat().st_size > 10_000:
        return path
    import time
    from curl_cffi import requests
    url = f'https://legislation.nsw.gov.au/export/xml/{as_at}/{epi_code}'
    # the site answers 503 / 429 at times (busy, not missing): retried with backoff, 4 tries over about 35 s
    for attempt in range(4):
        r = requests.get(url, impersonate='chrome', timeout=180)
        if r.status_code not in (429, 500, 502, 503, 504, 520, 522, 524):
            break
        if attempt < 3: time.sleep(5 * 2 ** attempt)
    if r.status_code != 200 or b'<legis' not in r.content[:5000] and b'<?xml' not in r.content[:200]:
        if fallback and Path(fallback).exists():
            raw = Path(fallback).read_bytes()
            if _valid_at(raw, as_at):
                print(f'{url}: HTTP {r.status_code} - using {fallback} (valid at {as_at})')
                DATA.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                return path
        raise RuntimeError(f'{url}: HTTP {r.status_code}, {len(r.content)} bytes - not the instrument XML')
    DATA.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return path


def sources(cur):
    """(title, document_id, kind, xml path) for every instrument in schema rag"""
    cur.execute("SELECT i.title, i.document_id, i.kind, coalesce(i.as_at::text, (d.as_at_date AT TIME ZONE 'Australia/Sydney')::date::text), "
                "coalesce(d.source_url, ''), coalesce(d.raw_path, '') FROM rag.instrument i JOIN nsw.document d ON d.id = i.document_id ORDER BY i.rank, i.title")
    out = []
    for title, doc, kind, as_at, url, raw in cur.fetchall():
        m = re.search(r'(epi-\d{4}-\d{3,4})', url) or re.search(r'(epi-\d{4}-\d{3,4})', raw)
        if not m or not as_at:
            raise RuntimeError(f'{title}: no epi code or as-at date to fetch its XML by')
        out.append((title, doc, kind, xml_for(m.group(1), as_at, raw or None)))
    return out


def remove_provisions(cur, ids):
    """delete provisions this stage made that no longer exist, with what hangs off them (chunks, embeddings, relations,
    claims; an adjudication keeps its row and loses the pointer). Kept provisions are updated in place, never deleted,
    so their chunks - and the model contexts and embeddings on them - survive a re-run."""
    ids = [str(i) for i in ids]
    if not ids:
        return 0
    cur.execute("DELETE FROM rag.embedding WHERE chunk_id IN (SELECT id FROM rag.chunk WHERE provision_id = ANY(%s::uuid[]))", (ids,))
    cur.execute("DELETE FROM rag.chunk WHERE provision_id = ANY(%s::uuid[])", (ids,))
    cur.execute("DELETE FROM rag.relation WHERE from_provision = ANY(%s::uuid[]) OR to_provision = ANY(%s::uuid[])", (ids, ids))
    cur.execute("UPDATE rag.relation SET authority_provision = NULL WHERE authority_provision = ANY(%s::uuid[])", (ids,))
    cur.execute("UPDATE rag.adjudication SET source_provision = NULL WHERE source_provision = ANY(%s::uuid[])", (ids,))
    cur.execute("DELETE FROM rag.claim WHERE provision_id = ANY(%s::uuid[]) OR unit_provision = ANY(%s::uuid[])", (ids, ids))
    cur.execute("DELETE FROM rag.provision WHERE id = ANY(%s::uuid[])", (ids,))
    return cur.rowcount


def dictionary_ids(root):
    """the ids of the instrument's Dictionary - plan-wide definitions: an LEP's 'dict', a SEPP's schedule headed Dictionary"""
    ids = set()
    for el in root.iter():
        i = el.get('id')
        if not i:
            continue
        if i == 'dict':
            ids.add(i)
            continue
        head = el.find('head')
        h = head.find('heading') if head is not None else None
        if h is not None and re.sub(r'\s+', ' ', ''.join(h.itertext())).strip().lower() == 'dictionary':
            ids.add(i)
    return tuple(sorted(ids))
