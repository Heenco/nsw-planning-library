/**
 * RAG pilot - test the model setup before a paid run: one tiny call to each model the pipeline will use, and one tool
 * call (the R4 agent needs tools), with the model, tokens and time. Nothing is written.
 *
 *   npx tsx scripts/rag/check-llm.ts
 *
 * Which models: shared/rag/deepinfra.ts MODELS - RAG_LLM=anthropic in .env for Claude (needs ANTHROPIC_API_KEY),
 * RAG_MODEL_ANSWER / RAG_MODEL_CONTEXT to name one outright.
 */
import 'dotenv/config'
import { chat, embed, MODELS } from '../../shared/rag/deepinfra'

const tool = { type: 'function', function: { name: 'lookup', description: 'Look up a clause by its number.', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } } }

async function main() {
  console.log('provider', process.env.RAG_LLM ?? 'deepinfra', '| answer', MODELS.answer, '| context', MODELS.context, '| embed', MODELS.embed)
  console.log('keys: ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY ? 'set' : 'not set', '| DEEPINFRA_API_KEY', process.env.DEEPINFRA_API_KEY ? 'set' : 'not set')
  let bad = 0
  const step = async (name: string, f: () => Promise<string>) => {
    const t = Date.now()
    try { console.log(`ok   ${name.padEnd(9)} ${await f()} (${Date.now() - t} ms)`) } catch (e) { bad++; console.log(`FAIL ${name.padEnd(9)} ${String(e).slice(0, 300)}`) }
  }
  for (const [name, model] of [['context', MODELS.context], ['answer', MODELS.answer]] as const)
    await step(name, async () => { const r = await chat({ model, maxTokens: 20, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }); return `${model}: "${r.content.trim().slice(0, 20)}" ${r.tokens_in}+${r.tokens_out} tokens $${r.cost_usd.toFixed(5)}` })
  await step('tools', async () => {
    const r = await chat({ model: MODELS.answer, maxTokens: 200, tools: [tool], messages: [{ role: 'user', content: 'Use the lookup tool to read clause 4.4.' }] })
    return r.tool_calls.length ? `${MODELS.answer} called ${r.tool_calls[0].function.name}(${r.tool_calls[0].function.arguments})` : `${MODELS.answer} answered without a tool call: "${r.content.slice(0, 60)}"`
  })
  await step('embed', async () => { const r = await embed(['floor space ratio']); return `${MODELS.embed}: ${r.vecs[0]!.length} dims` })
  process.exit(bad ? 1 : 0)
}
main()
