/**
 * Fable, asked to design.
 *
 * A thin client over the Anthropic Messages API plus the prompt that turns a
 * site brief into a design scheme. No SDK: one fetch, one JSON body, and the
 * dependency list stays as it is.
 *
 * Why Fable rather than the providers the rest of the app already talks to —
 * the models in public/craftbot-viewer/models were produced by a Fable run
 * writing Blender Python, and the thing being tested here is whether that same
 * spatial competence holds when the constraints come from a planning
 * instrument instead of a reference photograph.
 *
 * The model is never asked for the model file. It is asked for a small
 * declarative scheme, which shared/design-scheme.mjs turns into geometry and
 * shared/design-check.mjs measures. That boundary is the whole design of this
 * feature: everything the model says can be checked, and nothing it says is
 * taken on trust.
 */

const API = 'https://api.anthropic.com/v1/messages'

/** Models this route will call. Anything else is rejected rather than passed through. */
export const FABLE_MODELS: Record<string, string> = {
  'fable-5.1': 'claude-fable-5-1',
  'fable-5': 'claude-fable-5',
}

export const DEFAULT_FABLE_MODEL = 'fable-5.1'

export interface FableResult {
  text: string
  usage: { input_tokens?: number, output_tokens?: number } | null
  stopReason: string | null
  model: string
}

export async function callFable(opts: {
  apiKey: string
  model: string
  system: string
  messages: { role: 'user' | 'assistant', content: string }[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}): Promise<FableResult> {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8000,
      temperature: opts.temperature ?? 1,
      system: opts.system,
      messages: opts.messages,
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Surface the provider's own message: "model not found" and "credit
    // balance too low" are both 400s and mean very different things to whoever
    // is trying to get this working.
    let detail = body.slice(0, 400)
    try {
      const j = JSON.parse(body)
      detail = j?.error?.message ?? detail
    } catch { /* keep the raw body */ }
    throw createError({
      statusCode: res.status === 401 || res.status === 403 ? 502 : 502,
      statusMessage: `Anthropic API ${res.status}: ${detail}`,
    })
  }

  const json = await res.json() as any
  const text = (json.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')

  return { text, usage: json.usage ?? null, stopReason: json.stop_reason ?? null, model: json.model ?? opts.model }
}

/**
 * Pull the scheme object out of a reply.
 *
 * Tolerant on purpose. A fenced block, a bare object, or an object with a
 * sentence in front of it all parse; anything else raises with the head of the
 * reply attached, because "the model did not return JSON" is not a debuggable
 * message on its own.
 */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text].filter(Boolean) as string[]
  for (const c of candidates) {
    const trimmed = c.trim()
    try { return JSON.parse(trimmed) } catch { /* try the brace span */ }
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { /* next candidate */ }
    }
  }
  throw createError({
    statusCode: 502,
    statusMessage: `Model did not return parseable JSON. Reply began: ${text.slice(0, 200)}`,
  })
}

// -- the prompt ----------------------------------------------------------

const SCHEME_CONTRACT = `Return ONE JSON object and nothing else. No prose before or after it.

{
  "scheme_name": "short name for this design",
  "strategy": "2-4 sentences: the moves you made and why, in terms of this lot",
  "dwellings": [ { "id": "A", "name": "Dwelling A", "bedrooms": 4, "gfa_sqm": 210 } ],
  "masses": [
    {
      "name": "unique string",
      "dwelling": "id from dwellings, or omit",
      "kind": "habitable" | "garage" | "deck" | "balcony" | "basement" | "ancillary",
      "storey": 0,
      "footprint": [[x, y], [x, y], ...],
      "z0": 0.0,
      "z1": 3.1
    }
  ],
  "roofs": [
    { "name": "...", "over": "name of a mass", "type": "gable" | "hip" | "skillion" | "flat",
      "axis": "x" | "y", "eave_height": 6.2, "ridge_height": 8.4 }
  ],
  "open_space": [
    { "name": "...", "kind": "private_open_space" | "deep_soil" | "landscaped" | "driveway" | "communal",
      "polygon": [[x, y], ...] }
  ],
  "parking": [ { "name": "Car A1", "x": 12.0, "y": 4.5 } ],
  "notes": [ "anything a reviewer should know, one point per string" ]
}

RULES ON THE GEOMETRY

- Coordinates are metres in the lot's own frame. X runs along the primary
  street frontage. Y runs from the street into the lot. Z is up from ground
  level at Z = 0.
- Every footprint is a simple polygon, at least 3 points, listed in order, not
  self-intersecting. Do not repeat the first point at the end.
- Every footprint of every mass except a basement must lie ENTIRELY inside the
  buildable polygon given in the brief. That polygon is the title boundary
  already inset by the setback governing each edge — staying inside it is how
  the setbacks are satisfied. Leave yourself 100-200 mm of tolerance.
- Nothing may exceed the height limit. That includes ridge_height, which is
  measured from Z = 0 like everything else.
- Masses that share a height range must not overlap in plan. Stacking floors is
  correct and expected: an upper storey is a separate mass with z0 equal to the
  storey below's z1.
- A storey is 2.7-3.2 m floor to floor. Do not model internal walls, rooms,
  windows or structure — this is a massing scheme, not a set of drawings.
- open_space polygons are on the ground and must not sit under a habitable or
  garage mass. Put private open space where it will get sun.
- parking entries are the centre point of a 2.6 x 5.4 m space.`

/**
 * How a variant is steered.
 *
 * The point of asking three times is not three renderings of the same answer.
 * Each variant is given a different thing to optimise for, which is what makes
 * comparing them worth doing — the yield-maximising scheme and the
 * amenity-first scheme genuinely disagree about where the building goes.
 */
export const VARIANT_BRIEFS: Record<string, { label: string, instruction: string }> = {
  yield: {
    label: 'Maximum yield',
    instruction: 'Push the permitted floor space as far as the controls allow. Use the full height and as much of the buildable area as you can while still meeting every numeric control. Accept a plainer form to get the area.',
  },
  amenity: {
    label: 'Amenity first',
    instruction: 'Optimise for liveability over floor area: north-facing private open space, cross-ventilation through narrow floor plates, generous separation from side boundaries, and a deliberate landscaped setting. Take less GFA if the result is a better place to live.',
  },
  context: {
    label: 'Contextual',
    instruction: 'Design for the street. Keep the form and scale of a conventional detached house in this locality — a modest front mass addressing the street, articulated rather than one slab, pitched roof, garage subordinate and set back from the front facade. Aim for a scheme a council assessor would consider unremarkable.',
  },
}

export function designSystemPrompt(): string {
  return `You are a registered NSW residential architect producing a massing scheme for one lot, working strictly inside a set of statutory planning controls that have already been resolved for you.

You will be given a SITE BRIEF: the surveyed parcel, the buildable polygon left by the setbacks, the height limit and its source, the floor space ratio if the lot is mapped for one, and every other numeric control that was extracted from the council's DCP with its clause number.

Design within those numbers. You do not need to restate them, argue with them, or ask for more. If a control makes something impossible, say so in "notes" and design the best scheme the controls do allow.

Judgement you are expected to exercise, because the controls do not settle it:
- how many volumes the building is broken into, and where they sit on the lot
- which way the building faces and where its open space goes given the lot's shape and orientation
- roof form and ridge direction
- how the garage and driveway relate to the street
- where floor space is worth taking and where it is worth giving up

Two things are checked against your output by measurement, not by asking you:
containment inside the buildable polygon, and the height of the highest point.
A scheme that breaches either is rejected and sent back to you. It is worth
being conservative on both.

${SCHEME_CONTRACT}`
}

/** The brief as the model sees it: numbers, clauses, and the two rings. */
export function briefForPrompt(brief: any, variant: string): string {
  const round = (pts: number[][] | null) => pts?.map(p => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))]) ?? null
  const v = VARIANT_BRIEFS[variant] ?? VARIANT_BRIEFS.context

  const numeric = (brief.controls ?? [])
    .filter((c: any) => !['setback', 'height'].includes(c.topic))
    .map((c: any) => `${c.topic}: ${c.comparator ?? '='} ${c.value} ${c.unit ?? ''} (DCP cl ${c.clause})`.replace(/\s+/g, ' '))
  const uniqueNumeric = [...new Set(numeric)].slice(0, 40)

  return `SITE BRIEF

Address           ${brief.address}
Lot / plan        ${brief.lotSectionPlan ?? '—'}
Council           ${brief.lga ?? '—'}
Zone              ${brief.zone ?? '—'} under ${brief.epiName ?? 'the LEP'}
DCP               ${brief.dcpName ?? '—'}
Site area         ${Math.round(brief.siteArea)} m2 (${brief.geometrySource})
Frontage          ${brief.frontage ? `${brief.frontage.toFixed(1)} m` : '—'}
Lot shape         ${[brief.isCornerLot && 'corner lot', brief.isBattleaxe && 'battle-axe (access handle excluded from the buildable area)'].filter(Boolean).join(', ') || 'regular'}
Orientation       ${brief.orientationDegrees != null ? `long axis ${Math.round(brief.orientationDegrees)}° from north` : '—'}
Average slope     ${brief.averageSlope != null ? `${brief.averageSlope.toFixed(1)}%` : '—'}

CONTROLS THAT BIND

Height limit      ${brief.height} m  (${brief.heightSource})
Floor space       ${brief.fsr ? `FSR ${brief.fsr}:1 = ${Math.round(brief.fsr * brief.siteArea)} m2 of GFA` : 'no FSR mapped for this lot'}
Front setback     ${brief.setbacks.front} m  (cl ${brief.setbackClauses.front})
Rear setback      ${brief.setbacks.rear} m  (cl ${brief.setbackClauses.rear})
Side setback      ${brief.setbacks.side} m  (cl ${brief.setbackClauses.side})
Secondary front   ${brief.setbacks.secondary} m  (cl ${brief.setbackClauses.secondary})
Minimum lot size  ${brief.minLotSize ? `${brief.minLotSize} m2` : '—'}

OTHER EXTRACTED CONTROLS (from the DCP; treat as guidance, some are noisy)
${uniqueNumeric.length ? uniqueNumeric.map((s: string) => `  ${s}`).join('\n') : '  none'}

GEOMETRY  (metres, X along the frontage, Y into the lot)

Title boundary    ${JSON.stringify(round(brief.lotPolygon))}
Buildable polygon ${JSON.stringify(round(brief.buildablePolygon))}
Buildable area    ${Math.round(brief.buildableArea)} m2
Buildable extent  x ${brief.buildableBbox ? `${brief.buildableBbox.x0.toFixed(1)} to ${brief.buildableBbox.x1.toFixed(1)}` : '—'}, y ${brief.buildableBbox ? `${brief.buildableBbox.y0.toFixed(1)} to ${brief.buildableBbox.y1.toFixed(1)}` : '—'}
Boundary roles    ${(brief.edgeRoles ?? []).join(', ') || '—'}  (one per edge of the buildable polygon, in order)

THE PROPOSAL

Land use          ${brief.landUses.join(' / ')}
Storeys sought    ${brief.storeys}
Design priority   ${v.label} — ${v.instruction}

Produce the scheme JSON now.`
}

/** The message that asks for a fix after the deterministic checker rejected a scheme. */
export function repairPrompt(failures: string[], structural: string[]): string {
  const all = [...structural, ...failures]
  return `That scheme was rejected by the compliance check. Every one of these was measured off the coordinates you gave, so they are facts about your geometry, not opinions:

${all.map(f => `  - ${f}`).join('\n')}

Return a corrected scheme as a complete JSON object in the same format. Fix the listed problems by moving or resizing geometry — keep the design intent where you can. Do not explain the changes outside the JSON; put anything a reviewer should know in "notes".`
}
