/**
 * Follow one NSW address through every table, for the "Trace an address" panel
 * on /datasources.
 *
 *   /api/datasources/nsw-address?q=405/88-90 Foveaux St Surry Hills   → matching addresses
 *   /api/datasources/nsw-address?id=5830687                           → the full trace
 *
 * The trace is the join map made concrete: address string, property, property
 * lots, lot shape, address point, access line, integrated service, and the
 * other addresses on the same property. Each step is one indexed lookup, so a
 * trace is a dozen queries of tens of milliseconds on one client.
 *
 * WHY THE SEARCH PARSES INSTEAD OF MATCHING TEXT
 *
 * guras.addressstring has 4.3 million rows and no trigram index; its `address`
 * btree cannot serve a prefix under the en_US collation. It does have btree
 * indexes on housenumberfirst and roadname, and the pair narrows to a few
 * hundred rows at most in ~1 ms. So the search pulls the street number and the
 * candidate road names out of what was typed, fetches on those, and then keeps
 * only rows whose address contains every word typed, with street types
 * expanded ("ST" → STREET), because that is how GURAS spells them.
 *
 * WHICH LOTS AN ADDRESS GETS
 *
 *   strata unit     (sppropid set, not propid) → its own strata lot, propidtype 2
 *   scheme address  (sppropid = propid)        → common property, propidtype 3
 *   ordinary        (sppropid empty)           → every lot of the property, propidtype 1
 *
 * and each of those reaches its shape through cadid. When none does, the lot
 * under the address point stands in, and `lotSource` says so.
 */

import type pg from 'pg'
import { withNswClient } from '../../utils/nsw-kg/pool'
import type { AddressKind, AddressMatch, AddressTrace, GeoJsonGeometry, TraceLot } from '#shared/datasources-nsw'

const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', PDE: 'PARADE', CRES: 'CRESCENT', CR: 'CRESCENT',
  PL: 'PLACE', HWY: 'HIGHWAY', CCT: 'CIRCUIT', CL: 'CLOSE', CT: 'COURT', TCE: 'TERRACE', LN: 'LANE', BVD: 'BOULEVARD',
  BLVD: 'BOULEVARD', GR: 'GROVE', ESP: 'ESPLANADE', WY: 'WAY', SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY',
}
const FULL_ROAD_TYPES = new Set(Object.values(ROAD_TYPES))
const UNIT_WORDS = /^(?:UNIT|U|APT|APARTMENT|SHOP|SUITE|FLAT|VILLA|TOWNHOUSE)\s+/

/** The address rule, with $1 = propid and $2 = sppropid. */
const RULE = `((($2)::int IS NOT NULL AND ($2)::int <> ($1)::int AND pl.propidtype = 2 AND pl.sppropid = ($2)::int)
            OR (($2)::int = ($1)::int AND pl.propidtype = 3)
            OR (($2)::int IS NULL AND pl.propidtype = 1))`

function kindOf(propid: number, sppropid: number | null): AddressKind {
  if (sppropid == null) return 'ordinary'
  return sppropid === propid ? 'strata-scheme' : 'strata-unit'
}

interface Parsed {
  unit: string | null
  number: number
  suffix: string
  words: string[]
  roadCandidates: string[]
}

function parse(raw: string): Parsed | null {
  let s = raw.toUpperCase().replace(/[,.]/g, ' ').replace(/\bNSW\b/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(UNIT_WORDS, '')
  const m = s.match(/^(?:([A-Z]?\d+[A-Z]?)\s*\/\s*)?(\d+)([A-Z]{0,2})(?:\s*-\s*\d+[A-Z]?)?\s+(.+)$/)
  if (!m) return null
  const words = m[4]!
    .split(' ')
    .filter(w => w && !/^\d{4}$/.test(w))            // a postcode
    .map(w => ROAD_TYPES[w] ?? w)
  if (!words.length) return null
  const names = words.filter(w => !FULL_ROAD_TYPES.has(w))
  const roadCandidates = new Set<string>()
  for (let i = 0; i < names.length; i++) {
    roadCandidates.add(names[i]!)
    if (i + 1 < names.length) roadCandidates.add(`${names[i]} ${names[i + 1]}`)
    if (i + 2 < names.length) roadCandidates.add(`${names[i]} ${names[i + 1]} ${names[i + 2]}`)
  }
  return { unit: m[1] ?? null, number: Number(m[2]), suffix: m[3] ?? '', words, roadCandidates: [...roadCandidates] }
}

async function search(client: pg.PoolClient, raw: string): Promise<{ results: AddressMatch[]; hint?: string }> {
  const p = parse(raw)
  if (!p) return { results: [], hint: 'Start with the street number, for example 90 Denning Street South Coogee or 1/90 Denning St.' }
  const r = await client.query(
    `SELECT msoid, address, housenumber, unitnumber, principaladdresstype, propid, sppropid
     FROM guras.addressstring
     WHERE housenumberfirst = $1 AND roadname = ANY($2::text[])
     LIMIT 500`,
    [p.number, p.roadCandidates],
  )
  const wanted = p.words
  const rows = r.rows.filter((row) => {
    const tokens = new Set(String(row.address).split(' '))
    if (!wanted.every(w => tokens.has(w))) return false
    if (p.suffix && !String(row.housenumber ?? '').includes(`${p.number}${p.suffix}`)) return false
    return true
  })
  const unitOf = (hn: string | null) => (hn && hn.includes('/') ? hn.split('/')[0] : null)
  rows.sort((a, b) => {
    const au = p.unit && unitOf(a.housenumber) === p.unit ? 0 : 1
    const bu = p.unit && unitOf(b.housenumber) === p.unit ? 0 : 1
    if (au !== bu) return au - bu
    const ap = a.unitnumber == null ? 0 : 1
    const bp = b.unitnumber == null ? 0 : 1
    if (ap !== bp) return ap - bp
    return (a.unitnumber ?? 0) - (b.unitnumber ?? 0) || String(a.address).localeCompare(String(b.address))
  })
  return {
    results: rows.slice(0, 12).map(row => ({
      id: Number(row.msoid),
      address: row.address,
      kind: kindOf(Number(row.propid), row.sppropid == null ? null : Number(row.sppropid)),
    })),
    hint: rows.length ? undefined : 'No address matched. Check the street number and spelling, and include the suburb.',
  }
}

const SHAPE = (col: string) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${col}, sqrt(ST_Area(${col})) / 400), 7)`

async function trace(client: pg.PoolClient, msoid: number): Promise<AddressTrace | null> {
  const a = (await client.query(
    `SELECT a.msoid, a.address, a.housenumber, a.unittype, a.unitnumber, a.roadname, a.roadtype, a.suburbname, a.postcode, a.council,
            coalesce(a.buildingname, a.addresssitename) AS site_name, a.principaladdresstype, a.contributororigin,
            a.propid, a.sppropid, a.principaladdresssiteoid, a.gnafprimarysiteid, o.address AS official_address
     FROM guras.addressstring a
     LEFT JOIN guras.addressstring o ON o.msoid = a.officialaddressstringoid
     WHERE a.msoid = $1`,
    [msoid],
  )).rows[0]
  if (!a) return null
  const propid = Number(a.propid)
  const sppropid = a.sppropid == null ? null : Number(a.sppropid)

  const prop = (await client.query(
    `SELECT count(*) AS address_rows, count(*) FILTER (WHERE addressstringoid = $2) AS this_row,
            min(address) FILTER (WHERE principaladdresstype = 1) AS primary_address,
            max(valnetpropertytype) AS valnet_type, max(valnetlotcount) AS valnet_lot_count,
            round(max(ST_Area(geom::geography))) AS area_m2
     FROM cadastre.property WHERE propid = $1`,
    [propid, msoid],
  )).rows[0]

  const counts = (await client.query(
    `SELECT propidtype, count(*) AS n FROM guras.propertylot WHERE propid = $1 GROUP BY 1`,
    [propid],
  )).rows
  const countOf = (t: number) => Number(counts.find(c => Number(c.propidtype) === t)?.n ?? 0)

  const links = (await client.query(
    `SELECT pl.propidtype, pl.planlabel, pl.lotnumber, pl.sectionnumber, pl.cadid, (l.cadid IS NOT NULL) AS has_shape
     FROM guras.propertylot pl
     LEFT JOIN cadastre.lot l ON l.cadid = pl.cadid
     WHERE pl.propid = $1 AND ${RULE}
     ORDER BY pl.planlabel, pl.sectionnumber NULLS FIRST, pl.lotnumber
     LIMIT 24`,
    [propid, sppropid],
  )).rows

  const pointRow = (await client.query(
    `SELECT ap.msoid, ST_X(ST_GeometryN(ap.geom, 1)) AS lon, ST_Y(ST_GeometryN(ap.geom, 1)) AS lat, ap.addresspointtype, ap.containment,
            round(ST_Length(pw.geom::geography)) AS access_m,
            ST_X(ST_GeometryN(w.geom, 1)) AS way_lon, ST_Y(ST_GeometryN(w.geom, 1)) AS way_lat, w.derivedby
     FROM guras.addresspoint ap
     LEFT JOIN guras.proway pw ON pw.addresspointoid = ap.msoid
     LEFT JOIN guras.waypoint w ON w.msoid = pw.waypointoid
     WHERE ap.addressstringoid = $1
     ORDER BY ap.objectid_1
     LIMIT 1`,
    [msoid],
  )).rows[0]

  let lotSource: AddressTrace['lotSource'] = 'none'
  let cadids = [...new Set(links.filter(l => l.has_shape).map(l => String(l.cadid)))].slice(0, 12)
  if (cadids.length) {
    lotSource = 'property'
  } else if (pointRow) {
    const under = (await client.query(
      `SELECT l.cadid FROM cadastre.lot l, guras.addresspoint ap
       WHERE ap.addressstringoid = $1 AND l.geom && ap.geom AND ST_Intersects(l.geom, ap.geom)
       LIMIT 3`,
      [msoid],
    )).rows
    cadids = under.map(u => String(u.cadid))
    if (cadids.length) lotSource = 'point'
  }

  const lots: TraceLot[] = cadids.length
    ? (await client.query(
        `SELECT l.cadid, l.lotidstring, l.classsubtype, l.planlotarea, round(ST_Area(l.geom::geography)) AS area_m2,
                CASE WHEN ap.geom IS NULL THEN NULL ELSE ST_Intersects(l.geom, ap.geom) END AS contains_point,
                ${SHAPE('l.geom')} AS geojson
         FROM cadastre.lot l
         LEFT JOIN LATERAL (SELECT geom FROM guras.addresspoint WHERE addressstringoid = $2 ORDER BY objectid_1 LIMIT 1) ap ON true
         WHERE l.cadid = ANY($1::text[])
         ORDER BY l.lotidstring`,
        [cadids, msoid],
      )).rows.map(r => ({
        cadid: String(r.cadid),
        lotidstring: r.lotidstring,
        classsubtype: r.classsubtype == null ? null : Number(r.classsubtype),
        planLotArea: r.planlotarea == null ? null : Number(r.planlotarea),
        areaM2: r.area_m2 == null ? null : Number(r.area_m2),
        containsPoint: r.contains_point,
        geometry: JSON.parse(r.geojson),
      }))
    : []

  // The lots around the site, for context on the small map. Bounded by the
  // site's own extent, so a rural lot does not pull in a whole district.
  let neighbours: GeoJsonGeometry[] = []
  if (cadids.length) {
    neighbours = (await client.query(
      `WITH site AS (SELECT ST_Envelope(ST_Collect(geom)) AS box FROM cadastre.lot WHERE cadid = ANY($1::text[]))
       SELECT ${SHAPE('l.geom')} AS geojson
       FROM cadastre.lot l, site
       WHERE l.geom && ST_Expand(site.box, greatest(ST_XMax(site.box) - ST_XMin(site.box), ST_YMax(site.box) - ST_YMin(site.box)) * 0.8)
         AND NOT (l.cadid = ANY($1::text[]))
       LIMIT 80`,
      [cadids],
    )).rows.map(r => JSON.parse(r.geojson))
  }

  const integrated = (await client.query(
    `SELECT formattedaddress, cadastralidentifier, lot_cadid, lganame, sa1_code_2021, sa2_name_2021, mb_code_2021,
            stateelectoraldistrict, federalelectoraldivision
     FROM integrated_address.point_address WHERE ss_addressstringoid = $1 ORDER BY objectid LIMIT 12`,
    [msoid],
  )).rows

  const siblings = (await client.query(
    `SELECT count(*) OVER () AS total, a.msoid, a.address, a.unitnumber, a.principaladdresstype,
            CASE WHEN pl.lotnumber IS NULL THEN NULL ELSE pl.lotnumber || '/' || coalesce(pl.sectionnumber, '') || '/' || pl.planlabel END AS lot
     FROM guras.addressstring a
     LEFT JOIN guras.propertylot pl ON a.sppropid <> a.propid AND pl.sppropid = a.sppropid AND pl.propidtype = 2
     WHERE a.propid = $1
     ORDER BY a.principaladdresstype, a.unitnumber NULLS FIRST, a.address
     LIMIT 80`,
    [propid],
  )).rows

  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    address: {
      msoid: Number(a.msoid),
      address: a.address,
      housenumber: a.housenumber,
      unitType: a.unittype,
      unitNumber: n(a.unitnumber),
      road: [a.roadname, a.roadtype].filter(Boolean).join(' ') || null,
      suburb: a.suburbname,
      postcode: n(a.postcode),
      council: a.council,
      siteName: a.site_name,
      principalType: n(a.principaladdresstype),
      contributorOrigin: n(a.contributororigin),
      propid,
      sppropid,
      officialAddress: a.official_address,
      siteId: n(a.principaladdresssiteoid),
      gnafSiteId: n(a.gnafprimarysiteid),
    },
    kind: kindOf(propid, sppropid),
    property: {
      found: Number(prop?.this_row ?? 0) > 0,
      addressRows: Number(prop?.address_rows ?? 0),
      primaryAddress: prop?.primary_address ?? null,
      valnetType: n(prop?.valnet_type),
      valnetLotCount: n(prop?.valnet_lot_count),
      areaM2: n(prop?.area_m2),
    },
    propertyLotCounts: { ordinary: countOf(1), unit: countOf(2), common: countOf(3) },
    links: links.map(l => ({
      propidtype: Number(l.propidtype),
      planlabel: l.planlabel,
      lotnumber: l.lotnumber,
      sectionnumber: l.sectionnumber,
      titleLotId: `${l.lotnumber ?? ''}/${l.sectionnumber ?? ''}/${l.planlabel ?? ''}`,
      cadid: l.cadid,
      hasShape: Boolean(l.has_shape),
    })),
    lotSource,
    lots,
    neighbours,
    point: pointRow
      ? {
          lon: Number(pointRow.lon),
          lat: Number(pointRow.lat),
          pointType: n(pointRow.addresspointtype),
          containment: n(pointRow.containment),
          accessMetres: n(pointRow.access_m),
          waypoint: pointRow.way_lon == null ? null : { lon: Number(pointRow.way_lon), lat: Number(pointRow.way_lat), derivedBy: n(pointRow.derivedby) },
        }
      : null,
    integrated: integrated.map(r => ({
      formattedAddress: r.formattedaddress,
      cadastralIdentifier: r.cadastralidentifier,
      lotCadid: r.lot_cadid == null ? null : String(r.lot_cadid),
      lga: r.lganame,
      sa1: r.sa1_code_2021,
      sa2Name: r.sa2_name_2021,
      meshBlock: r.mb_code_2021,
      stateElectorate: r.stateelectoraldistrict,
      federalDivision: r.federalelectoraldivision,
    })),
    siblings: {
      total: Number(siblings[0]?.total ?? 0),
      rows: siblings.map(s => ({
        msoid: Number(s.msoid),
        address: s.address,
        unitNumber: n(s.unitnumber),
        principalType: n(s.principaladdresstype),
        lot: s.lot,
      })),
    },
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = Number(query.id)
  const q = String(query.q ?? '').trim()

  if (Number.isInteger(id) && id > 0) {
    // No SET on the session: the client goes back to a shared pool, and every
    // lookup here is indexed and far inside the server's own timeout.
    const result = await withNswClient(client => trace(client, id))
    if (!result) throw createError({ statusCode: 404, statusMessage: `No address with id ${id}.` })
    return result
  }
  if (q.length >= 3) {
    return withNswClient(client => search(client, q))
  }
  throw createError({ statusCode: 400, statusMessage: 'Pass ?q= with an address to search, or ?id= with an address id to trace.' })
})
