import { withNswClient } from '../utils/nsw-kg/pool'
import { runQuery } from '../utils/nsw-kg/query/orchestrator'
import { runDeepLegalCards } from '../utils/sitewise/deep-legal-cards'

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

// Shared instruction for 3-section output
const SECTION_INSTRUCTION =
  `IMPORTANT: Structure your answer in exactly 3 sections with these markdown headings:\n` +
  `## LEP Findings\nWhat the Local Environmental Plan says (zoning, permitted uses, development standards, local provisions).\n` +
  `## SEPP Findings\nWhat relevant State Environmental Planning Policies say (overrides, exemptions, additional pathways).\n` +
  `## DCP Findings\nWhat the Development Control Plan says (detailed controls, setbacks, parking, landscaping, design).\n` +
  `If no propositions were found for a section, write "No relevant [type] provisions found in the knowledge base." under that heading.\n`

// Persona-specific query templates
const PERSONA_QUERIES: Record<string, (addr: string, zone: string, lga: string) => string> = {
  owner: (addr, zone, lga) =>
    `What can a property owner do with a property in zone ${zone} in ${lga}? ` +
    `What are the key permitted uses, restrictions, heritage or environmental constraints, ` +
    `and what development is possible without full DA? Address: ${addr}\n\n${SECTION_INSTRUCTION}`,
  developer: (addr, zone, lga) =>
    `What can a developer build on a site in zone ${zone} in ${lga}? ` +
    `What are the key development standards (FSR, height, setbacks, lot size), ` +
    `DCP controls, SEPP overrides, and any CDC/exempt pathways? Address: ${addr}\n\n${SECTION_INSTRUCTION}`,
  planner: (addr, zone, lga) =>
    `What planning controls apply to land in zone ${zone} in ${lga}? ` +
    `Provide a comprehensive analysis of all applicable provisions. Address: ${addr}\n\n${SECTION_INSTRUCTION}`,
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { lat, lng, address, persona } = body || {}

  if (!lat || !lng || !persona) {
    throw createError({ statusCode: 400, message: 'Missing lat, lng, or persona' })
  }

  const config = useRuntimeConfig()
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  try {
    // ── Phase 1: Property lookup via spatial intersection ──────────────
    sseWrite(res, 'agent_step', { agent: 'Property', status: 'running', message: 'Looking up property…' })

    const property = await withNswClient(async (client) => {
      const r = await client.query(
        `SELECT
          -- Identity
          propid, address, lga_name, council_name, suburbname, postcode, lotnumber, sectionnumber,
          planlabel AS plan_label, property_description, land_value_1,
          lzn_sym_code AS zone, lzn_lay_class AS zone_class, lzn_label AS zone_label,
          lep_name, dcp_plan_name,
          -- Development standards
          fsr_value, fsr_lay_class, fsr_epi_name,
          hob_max_height AS max_height, hob_max_height_m AS max_height_m, hob_units AS height_units,
          mls_lot_size AS min_lot_size, mls_lay_class AS lot_size_class, mls_units AS lot_size_units,
          -- Lot geometry
          area_sqm, area_h, perimeter_m, longest_axis_m, min_width_m,
          num_frontages, is_corner_lot, is_battleaxe,
          primary_frontage_road, primary_frontage_length_m, all_frontages,
          average_slope, orientation_degrees,
          -- Environmental constraints
          floodmapping, bushfireproneland, biodiversity,
          ass_lay_class AS acid_sulfate, groundwatervulnerability, landsliderisk,
          coastal_wetlands, coastal_environment_area, coastal_use_area,
          riparianlandwatercourse, drinking_water_catchment,
          scenicprotectionland, mine_subsidence_district, contamination_sitename,
          -- Heritage
          h_name AS heritage_name, h_id AS heritage_id, heritage_class,
          -- CDC eligibility
          cdc_eligible, total_cdc_eligible, cdc_general, cdc_general_exclusions,
          cdc_dwelling_houses, cdc_dwelling_houses_exclusions,
          cdc_dual_occupancy, cdc_dual_occupancy_exclusions,
          cdc_secondary_dwellings, cdc_secondary_dwellings_exclusions,
          cdc_multi_dwelling_terraces, cdc_multi_dwelling_terraces_exclusions,
          cdc_manor_homes, cdc_manor_homes_exclusions,
          cdc_greenfield_housing, cdc_greenfield_housing_exclusions,
          cdc_rural_housing, cdc_rural_housing_exclusions,
          cdc_agritourism, cdc_agritourism_exclusions,
          cdc_farmstay, cdc_farmstay_exclusions,
          -- LMR & Pattern Book
          in_lmr_housing_area, lmr_permissible, lmr_height_rfb, lmr_height_sth,
          semis_01_anthony_gill_eligible, semis_02_sibling_eligible,
          manor_homes_01_studio_eligible, row_homes_01_saha_eligible,
          terraces_01_carter_eligible, terraces_02_sam_crawford_eligible,
          terraces_03_officer_woods_eligible, terraces_04_other_eligible,
          -- Proximity
          closest_hospital, closest_hospital_distance_m,
          closest_school, closest_school_distance_m,
          closest_railway_station, closest_railway_station_distance_m,
          walkable_score, estimated_price, no_of_beds, no_of_baths, no_of_cars,
          -- Location
          centroid_lat, centroid_lon, region_name, permissible_uses
        FROM up_property_comprehensive
        WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
        ORDER BY (centroid_lat::float8 - $1)^2 + (centroid_lon::float8 - $2)^2
        LIMIT 1`,
        [lat, lng]
      )
      return r.rows[0] || null
    })

    if (!property) {
      sseWrite(res, 'agent_step', { agent: 'Property', status: 'warn', message: 'No property found at this location' })
      sseWrite(res, 'done', {})
      res.end()
      return
    }

    sseWrite(res, 'agent_step', { agent: 'Property', status: 'done', message: `Found: ${property.address}` })
    sseWrite(res, 'property', { property })

    // ── Phase 1b: Fetch all lots for this property (same propid) ──────
    let lots: any[] = []
    if (property.propid) {
      lots = await withNswClient(async (client) => {
        const r = await client.query(
          `SELECT DISTINCT ON (lotnumber, planlabel)
                  lotnumber, sectionnumber, planlabel AS plan_label,
                  area_h, lot_section_plan, address
           FROM up_property_comprehensive
           WHERE propid = $1
           ORDER BY lotnumber, planlabel`,
          [property.propid]
        )
        return r.rows
      })
      if (lots.length > 1) {
        sseWrite(res, 'agent_step', { agent: 'Property', status: 'done', message: `${lots.length} lots found for this property` })
      }
    }
    sseWrite(res, 'lots', { lots })

    // ── Phase 2: Permissibility lookup ────────────────────────────────
    sseWrite(res, 'agent_step', { agent: 'Permissibility', status: 'running', message: 'Checking permitted uses…' })

    let permittedUses: string[] = []
    if (property.lep_name && property.zone) {
      const permResult = await withNswClient(async (client) => {
        const r = await client.query(
          `SELECT DISTINCT permissiblelanduse
           FROM up_permissiblelanduse
           WHERE epititle ILIKE $1 AND zone = $2
             AND permissiblelanduse IS NOT NULL
           ORDER BY permissiblelanduse`,
          [property.lep_name, property.zone.trim().toUpperCase()]
        )
        return r.rows.map((row: any) => row.permissiblelanduse)
      })
      permittedUses = permResult
    }

    sseWrite(res, 'agent_step', {
      agent: 'Permissibility',
      status: 'done',
      message: `${permittedUses.length} permitted uses in zone ${property.zone}`,
    })
    sseWrite(res, 'permissibility', { zone: property.zone, lep: property.lep_name, uses: permittedUses })

    // ── Phase 3: Knowledge graph query (persona-shaped) ───────────────
    const queryFn = PERSONA_QUERIES[persona] || PERSONA_QUERIES.owner
    const kgQuery = queryFn(
      property.address || address || '',
      property.zone || 'unknown',
      property.lga_name || 'unknown',
    )

    // Build a property context block to prepend
    const p = property
    const contextLines = [
      `Address: ${p.address}`,
      `Zone: ${p.zone} (${p.zone_class || ''})`,
      `LEP: ${p.lep_name || 'N/A'}`,
      `LGA: ${p.lga_name || 'N/A'}`,
      `Council: ${p.council_name || 'N/A'}`,
      p.fsr_value ? `FSR: ${p.fsr_value}` : null,
      p.max_height_m ? `Max height: ${p.max_height_m}m` : null,
      p.min_lot_size ? `Min lot size: ${p.min_lot_size} ${p.lot_size_units || 'sqm'}` : null,
      p.area_sqm ? `Lot area: ${Math.round(Number(p.area_sqm))} sqm` : null,
      p.primary_frontage_length_m ? `Primary frontage: ${p.primary_frontage_length_m}m (${p.primary_frontage_road || ''})` : null,
      p.min_width_m ? `Min lot width: ${p.min_width_m}m` : null,
      p.average_slope ? `Average slope: ${Number(p.average_slope).toFixed(1)}°` : null,
      p.is_corner_lot === 'true' ? 'Corner lot: Yes' : null,
      p.is_battleaxe === 'true' ? 'Battle-axe lot: Yes' : null,
      p.heritage_name ? `Heritage: ${p.heritage_name} (${p.heritage_class || ''})` : null,
      p.floodmapping ? `Flood mapping: ${p.floodmapping}` : null,
      p.bushfireproneland ? `Bushfire prone: ${p.bushfireproneland}` : null,
      p.biodiversity ? `Biodiversity: ${p.biodiversity}` : null,
      p.acid_sulfate ? `Acid sulfate soils: ${p.acid_sulfate}` : null,
      p.coastal_wetlands ? `Coastal wetlands: ${p.coastal_wetlands}` : null,
      p.riparianlandwatercourse ? `Riparian/watercourse: ${p.riparianlandwatercourse}` : null,
      p.contamination_sitename ? `Contamination: ${p.contamination_sitename}` : null,
      p.cdc_eligible === 'true' ? `CDC eligible: Yes (${p.total_cdc_eligible} pathways)` : 'CDC eligible: No',
      p.cdc_dwelling_houses === 'true' ? 'CDC dwelling houses: eligible' : null,
      p.cdc_dual_occupancy === 'true' ? 'CDC dual occupancy: eligible' : null,
      p.cdc_secondary_dwellings === 'true' ? 'CDC secondary dwellings: eligible' : null,
      p.in_lmr_housing_area === 'true' ? 'In Low-Mid Rise housing area: Yes' : null,
      p.dcp_plan_name ? `DCP: ${p.dcp_plan_name}` : null,
    ].filter(Boolean).join('\n')

    const enrichedQuery = `${kgQuery}\n\nKnown property facts:\n${contextLines}\n\nPermitted uses in zone ${property.zone}: ${permittedUses.slice(0, 30).join(', ') || 'unknown'}`

    // ── Phase 3b: Fire deep legal cards in parallel (non-blocking) ────
    const lga = (property.lga_name || '').replace(/^(city of|shire of|municipality of)\s*/i, '').trim()
    const gisResult = {
      lat: Number(property.centroid_lat),
      lng: Number(property.centroid_lon),
      place: property.address || '',
      zone: property.zone || '',
      lepName: property.lep_name || '',
      fsr: property.fsr_value || null,
      maxHeight: property.max_height_m || null,
      minLotSize: property.min_lot_size || null,
    }

    const cardsPromise = runDeepLegalCards({
      gis: gisResult as any,
      lga,
      deepinfraKey: config.deepinfraApiKey,
      geminiKey: config.googleGeminiApiKey,
      emit: (type, payload) => sseWrite(res, type, payload),
      step: (agent, status, message, detail) =>
        sseWrite(res, 'agent_step', { agent, status, message, detail }),
    }).catch(() => {})

    // ── Phase 4: Main planning summary via KG query ───────────────────
    await runQuery({
      query: enrichedQuery,
      lgaFilter: property.lga_name || undefined,
      apiKey: config.deepinfraApiKey,
      geminiKey: config.googleGeminiApiKey,
      groqKey: config.groqApiKey,
      res: {
        write: (chunk: string) => res.write(chunk),
        flush: () => { if (typeof (res as any).flush === 'function') (res as any).flush() },
        end: () => {}, // Don't end yet — wait for cards
      },
    })

    // Wait for deep legal cards to finish
    await cardsPromise

    sseWrite(res, 'done', { ms: Date.now() })
    res.end()
  } catch (err) {
    sseWrite(res, 'error', { message: (err as Error).message || String(err) })
    res.end()
  }
})
