import { runQuery } from '../utils/nsw-kg/query/orchestrator'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const query = body?.query?.trim()

  if (!query) {
    throw createError({ statusCode: 400, message: 'Missing query' })
  }

  const config = useRuntimeConfig()

  // Set SSE headers
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  await runQuery({
    query,
    apiKey: config.deepinfraApiKey,
    geminiKey: config.googleGeminiApiKey,
    groqKey: config.groqApiKey,
    res,
  })
})
