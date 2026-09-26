/**
 * The control readers, as a line-oriented CLI so non-JS callers can use them.
 *
 * WHY THIS EXISTS
 *
 * `findNumberCandidates` is shared by extraction and by the recall verifier, deliberately: the moment
 * the two use different detectors, the recall gate stops measuring anything. The LEP pipeline is being
 * built in a Python notebook, and a Python reimplementation of the detector would break that invariant
 * on the first line. So the notebook calls this instead of copying it.
 *
 * One process, JSON Lines both ways — one request per input line, one result per output line, in
 * order. Reading a whole LEP costs one node start-up rather than one per clause.
 *
 *   {"op":"numbers","text":"..."}            -> {"ok":true,"candidates":[...]}
 *   {"op":"read","text":"...","headings":[]} -> {"ok":true,"topic":...,"datum":...,"sizeBand":...}
 *   {"op":"landuse","text":"..."}            -> {"ok":true,"uses":[...]}
 *
 * A reader that throws returns {"ok":false,"error":...} for that line and the stream continues: one
 * malformed clause must not take down a 1,800-section run.
 *
 * Usage:  node scripts/readers-cli.mjs < requests.jsonl > results.jsonl
 */
import { createInterface } from 'node:readline'
import {
  datumOf, groundDatumOf, headingBand, headingDatum, parseHeightBand, parseLengthBand,
  parseSizeBand, splitStoreyBands, storeyBandOf, topicCandidates, topicOf,
} from './lib/dcp-cells.mjs'
import { matchLandUses } from './lib/si-landuse.mjs'
import { findNumberCandidates } from '../server/utils/nsw-kg/verifiers/candidates'

const safe = (fn, fallback = null) => { try { return fn() } catch { return fallback } }

function handle(req) {
  const text = req.text ?? ''
  switch (req.op) {
    case 'numbers':
      return { candidates: findNumberCandidates(text) ?? [] }

    case 'landuse':
      return { uses: matchLandUses(text) ?? [] }

    case 'read': {
      const headings = req.headings ?? []
      return {
        // topic from the whole text is unreliable on LEP clauses - it read "setback" for a lot-size
        // clause - so the candidate list is returned too and the caller decides
        topic: safe(() => topicOf([text])),
        topicCandidates: safe(() => topicCandidates([text]), []),
        datum: safe(() => datumOf(text)),
        groundDatum: safe(() => groundDatumOf(text)),
        headingDatum: safe(() => headingDatum(...headings)),
        headingBand: safe(() => headingBand(headings)),
        sizeBand: safe(() => parseSizeBand(text)),
        lengthBand: safe(() => parseLengthBand(text)),
        heightBand: safe(() => parseHeightBand(text)),
        storeyBand: safe(() => storeyBandOf(text)),
        storeyBands: safe(() => splitStoreyBands(text), []),
      }
    }

    case 'ping':
      return { pong: true }

    default:
      throw new Error(`unknown op '${req.op}'`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of rl) {
  const s = line.trim()
  if (!s) continue
  let out
  try {
    out = { ok: true, ...handle(JSON.parse(s)) }
  } catch (e) {
    out = { ok: false, error: String(e?.message ?? e) }
  }
  process.stdout.write(JSON.stringify(out) + '\n')
}
