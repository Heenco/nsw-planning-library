/**
 * POST /api/design/generate — ask Fable for a scheme, then measure it.
 *
 * The loop, once per requested variant:
 *
 *   brief  ->  Fable  ->  scheme JSON  ->  structural validation
 *                                      ->  compliance check
 *                       <-  repair  <-  (only if a hard check failed)
 *
 * One repair pass, not a loop to convergence. If a second attempt still
 * breaches the envelope the scheme is returned anyway, marked failing, with the
 * measurements attached — a scheme that misses by 300 mm is useful information
 * about what the controls leave on this lot, and hiding it behind a retry loop
 * would spend tokens to make the tool look better than it is.
 */

import { loadDesignBrief } from '../../utils/design-brief'
import {
  callFable, extractJson, designSystemPrompt, briefForPrompt, repairPrompt,
  FABLE_MODELS, DEFAULT_FABLE_MODEL, VARIANT_BRIEFS,
} from '../../utils/fable'
import { putDesign } from '../../utils/design-store'
import { validateScheme, schemeToModel } from '#shared/design-scheme.mjs'
import { checkScheme } from '#shared/design-check.mjs'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as any
  const address = String(body?.address ?? '').trim()
  if (!address) throw createError({ statusCode: 400, statusMessage: 'address required' })

  const apiKey = useRuntimeConfig().anthropicApiKey as string | undefined
  if (!apiKey) {
    throw createError({
      statusCode: 501,
      statusMessage: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart the dev server — this route is the only thing in the app that needs it.',
    })
  }

  const modelKey = String(body?.model ?? DEFAULT_FABLE_MODEL)
  const model = FABLE_MODELS[modelKey]
  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: `model must be one of ${Object.keys(FABLE_MODELS).join(', ')}`,
    })
  }

  const variants: string[] = Array.isArray(body?.variants) && body.variants.length
    ? body.variants.filter((v: string) => v in VARIANT_BRIEFS).slice(0, 3)
    : ['context']
  if (!variants.length) throw createError({ statusCode: 400, statusMessage: 'no known variant requested' })

  const landUses = String(body?.use ?? 'dwelling house')
    .split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  const storeys = Number(body?.storeys) || 2

  const brief = await loadDesignBrief(address, { landUses, storeys })

  if (!brief.buildablePolygon || brief.buildableArea < 10) {
    throw createError({
      statusCode: 422,
      statusMessage: `The controls leave no buildable area on this lot (front ${brief.setbacks.front} m, rear ${brief.setbacks.rear} m, side ${brief.setbacks.side} m on a ${Math.round(brief.siteArea)} m2 parcel), so there is nothing to design inside.`,
    })
  }

  const system = designSystemPrompt()

  // Variants are independent, so they run together — three sequential calls
  // would put a minute of latency in front of a page whose whole value is
  // being able to compare them side by side.
  const results = await Promise.all(variants.map(async (variant) => {
    const messages: { role: 'user' | 'assistant', content: string }[] = [
      { role: 'user', content: briefForPrompt(brief, variant) },
    ]

    let attempts = 0
    let scheme: any = null
    let structural: string[] = []
    let checks: any = null
    let usage: any = null
    const repairs: string[][] = []

    while (attempts < 2) {
      attempts++
      const reply = await callFable({ apiKey, model, system, messages, maxTokens: 8000 })
      usage = accumulate(usage, reply.usage)
      scheme = extractJson(reply.text)
      structural = validateScheme(scheme)
      checks = structural.length ? null : checkScheme(scheme, brief)

      const failures = checks ? checks.hardFailures : []
      if (!structural.length && checks?.pass) break
      if (attempts >= 2) break

      repairs.push([...structural, ...failures])
      messages.push({ role: 'assistant', content: reply.text })
      messages.push({ role: 'user', content: repairPrompt(failures, structural) })
    }

    // A scheme that is still structurally malformed after a repair pass has no
    // geometry to show, so it is an error rather than a failing result.
    if (structural.length) {
      return {
        variant,
        label: VARIANT_BRIEFS[variant].label,
        error: `The scheme did not validate after ${attempts} attempts: ${structural.slice(0, 5).join('; ')}`,
        attempts,
        usage,
      }
    }

    const modelJson = schemeToModel(scheme, brief)
    const stored = putDesign({
      address, variant, modelName: model, scheme, model: modelJson,
      checks, brief, usage, attempts,
    })

    return {
      id: stored.id,
      variant,
      label: VARIANT_BRIEFS[variant].label,
      schemeName: scheme.scheme_name ?? null,
      strategy: scheme.strategy ?? null,
      notes: scheme.notes ?? [],
      dwellings: scheme.dwellings ?? [],
      pass: checks.pass,
      checks: checks.checks,
      metrics: checks.metrics,
      repairs,
      attempts,
      usage,
      // The URL, not the model: the viewer derives the rationale document by
      // appending format=rationale to whatever path it was handed, so the
      // scheme has to be reachable by GET for the panel beside it to work.
      modelUrl: `/api/design/model?id=${stored.id}`,
    }
  }))

  return {
    address: brief.address,
    modelName: model,
    brief: publicBrief(brief),
    variants: results,
  }
})

function accumulate(a: any, b: any) {
  if (!b) return a
  if (!a) return { ...b }
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  }
}

/** The brief, minus the raw control rows the page has no use for. */
function publicBrief(b: any) {
  const { controls, envelopeMeta, ...rest } = b
  return { ...rest, controlCount: controls.length }
}
