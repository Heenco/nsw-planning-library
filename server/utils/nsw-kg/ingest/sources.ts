// ── Document source registry ────────────────────────────────────────────
//
// The three documents we ingest in v1, with their canonical sources.

import path from 'node:path'
import type { DocumentSource } from '../types'

const REPO_ROOT = path.resolve(process.cwd())

// Default as-at date — can be overridden per run from the CLI.
export const DEFAULT_AS_AT = '2026-04-07'

export const SOURCES: Record<string, DocumentSource> = {
  'albury-lep': {
    label: 'albury-lep',
    title: 'Albury Local Environmental Plan 2010',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Albury',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2010-0433',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2010-0433.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  // ── LEPs for the councils whose DCPs we're ingesting into NSW KG v2 ──
  // Each maps to its council's local XML in public/EPI/xml/.
  'georges-river-lep': {
    label: 'georges-river-lep',
    title: 'Georges River Local Environmental Plan 2021',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Georges River',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0587',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2021-0587.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'liverpool-lep': {
    label: 'liverpool-lep',
    title: 'Liverpool Local Environmental Plan 2008',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Liverpool',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2008-0403',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2008-0403.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'parramatta-lep': {
    label: 'parramatta-lep',
    title: 'Parramatta Local Environmental Plan 2023',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Parramatta',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2023-0117',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2023-0117.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  // Hornsby is the LGA every property route targets, and its LEP was the one
  // document never registered here. It reached the database through a one-off
  // import from a pilot SQLite store instead (document.raw_path still records
  // "pilot:lep_store.sqlite (Parts 4-6 only)"), which carried clause headings
  // but none of the subclause or paragraph text beneath them.
  'hornsby-lep': {
    label: 'hornsby-lep',
    title: 'Hornsby Local Environmental Plan 2013',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Hornsby',
    // Deliberately distinct from the pilot row's URL so upsert-document, which
    // deletes by source_url, lands this beside the pilot import rather than on
    // top of it. The pilot rows carry the entire rule layer -- 88 rules, 64
    // override edges, and 26 spatial refs with resolved geometry linking
    // Schedule 1 items to real parcels -- and nothing in the XML pipeline
    // rebuilds any of it, so replacing in place would destroy data this ingest
    // cannot reproduce. Reverts to the canonical URL at cutover.
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2013-0569?src=xml',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2013-0569.xml'),
    instrument_slug: 'hornsby-local-environmental-plan-2013-xml',
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'randwick-lep': {
    label: 'randwick-lep',
    title: 'Randwick Local Environmental Plan 2012',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Randwick',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2013-0036',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2013-0036.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sydney-lep': {
    label: 'sydney-lep',
    title: 'Sydney Local Environmental Plan 2012',
    doc_type: 'lep',
    scope: 'local',
    hierarchy_level: 3,
    lga_name: 'Sydney',
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2012-0628',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'xml', 'epi-2012-0628.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'housing-sepp': {
    label: 'housing-sepp',
    title: 'State Environmental Planning Policy (Housing) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0714',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0714_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'albury-dcp': {
    label: 'albury-dcp',
    title: 'Albury Development Control Plan 2010',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Albury',
    source_url: 'https://www.alburycity.nsw.gov.au/property/plan/planning-controls/dcp',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'albury-dcp-2010.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },

  // ── Other state-wide SEPPs (precinct SEPPs deliberately excluded) ──
  'sepp-biodiversity-and-conservation-2021': {
    label: 'sepp-biodiversity-and-conservation-2021',
    title: 'State Environmental Planning Policy (Biodiversity and Conservation) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0722',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0722_2026-03-22.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-industry-and-employment-2021': {
    label: 'sepp-industry-and-employment-2021',
    title: 'State Environmental Planning Policy (Industry and Employment) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0723',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0723_2026-03-22.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-planning-systems-2021': {
    label: 'sepp-planning-systems-2021',
    title: 'State Environmental Planning Policy (Planning Systems) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0724',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0724_2026-03-22.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-primary-production-2021': {
    label: 'sepp-primary-production-2021',
    title: 'State Environmental Planning Policy (Primary Production) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0729',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0729_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-resilience-and-hazards-2021': {
    label: 'sepp-resilience-and-hazards-2021',
    title: 'State Environmental Planning Policy (Resilience and Hazards) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0730',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0730_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-resources-and-energy-2021': {
    label: 'sepp-resources-and-energy-2021',
    title: 'State Environmental Planning Policy (Resources and Energy) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0731',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0731_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-transport-and-infrastructure-2021': {
    label: 'sepp-transport-and-infrastructure-2021',
    title: 'State Environmental Planning Policy (Transport and Infrastructure) 2021',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2021-0732',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2021-0732_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  'sepp-sustainable-buildings-2022': {
    label: 'sepp-sustainable-buildings-2022',
    title: 'State Environmental Planning Policy (Sustainable Buildings) 2022',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2022-0521',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2022-0521_2026-03-23.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
  // ── DCPs (Docling-generated structured markdown) ──────────────────────
  'georges-river-dcp': {
    label: 'georges-river-dcp',
    title: 'Georges River Development Control Plan 2021',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Georges River',
    source_url: 'https://www.georgesriver.nsw.gov.au/Development/Planning-Controls/Development-Control-Plans',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'georges-river-dcp-2021.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'liverpool-dcp-main': {
    label: 'liverpool-dcp-main',
    title: 'Liverpool Growth Centre Precincts DCP — Main Body',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Liverpool',
    source_url: 'https://www.planning.nsw.gov.au/plans-for-your-area/priority-growth-areas-and-precincts/south-west-growth-area#main-body',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'liverpool-gcp-main-body.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'liverpool-dcp-sch1': {
    label: 'liverpool-dcp-sch1',
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 1 (Austral & Leppington North)',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Liverpool',
    source_url: 'https://www.planning.nsw.gov.au/plans-for-your-area/priority-growth-areas-and-precincts/south-west-growth-area#schedule-1',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'liverpool-gcp-schedule-1.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'liverpool-dcp-sch2': {
    label: 'liverpool-dcp-sch2',
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 2 (Leppington Major Centre)',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Liverpool',
    source_url: 'https://www.planning.nsw.gov.au/plans-for-your-area/priority-growth-areas-and-precincts/south-west-growth-area#schedule-2',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'liverpool-gcp-schedule-2.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'liverpool-dcp-sch3': {
    label: 'liverpool-dcp-sch3',
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 3 (East Leppington)',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Liverpool',
    source_url: 'https://www.planning.nsw.gov.au/plans-for-your-area/priority-growth-areas-and-precincts/south-west-growth-area#schedule-3',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'liverpool-gcp-schedule-3.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'parramatta-dcp': {
    label: 'parramatta-dcp',
    title: 'Parramatta Development Control Plan 2023',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Parramatta',
    source_url: 'https://www.cityofparramatta.nsw.gov.au/development/development-control-plan',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'parramatta-dcp-2023.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },
  'randwick-dcp': {
    label: 'randwick-dcp',
    title: 'Randwick Comprehensive Development Control Plan 2013',
    doc_type: 'dcp',
    scope: 'local',
    hierarchy_level: 4,
    lga_name: 'Randwick',
    source_url: 'https://www.randwick.nsw.gov.au/planning-and-building/planning-controls/development-control-plan',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'DCPs', 'randwick-comprehensive-dcp-2013.md'),
    raw_format: 'structured-md',
    as_at_date: DEFAULT_AS_AT,
  },

  'sepp-exempt-and-complying-development-codes-2008': {
    label: 'sepp-exempt-and-complying-development-codes-2008',
    title: 'State Environmental Planning Policy (Exempt and Complying Development Codes) 2008',
    doc_type: 'sepp',
    scope: 'state',
    hierarchy_level: 2,
    lga_name: null,
    source_url: 'https://legislation.nsw.gov.au/view/whole/html/inforce/current/epi-2008-0572',
    raw_path: path.join(REPO_ROOT, 'public', 'EPI', 'SEPP', 'epi-2008-0572_2026-03-26.xml'),
    raw_format: 'xml',
    as_at_date: DEFAULT_AS_AT,
  },
}

export function getSource(label: string): DocumentSource {
  const src = SOURCES[label]
  if (!src) {
    throw new Error(`Unknown document source: ${label}. Known: ${Object.keys(SOURCES).join(', ')}`)
  }
  return src
}

export function listSources(): string[] {
  return Object.keys(SOURCES)
}
