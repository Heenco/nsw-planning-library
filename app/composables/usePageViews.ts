/**
 * usePageViews — tracks and returns the view count for the current page
 * using Upstash Redis REST API (called client-side from the static build).
 *
 * Counts once per browser session per page to reduce bot/refresh inflation.
 * Fails silently — view counts are non-critical and should never break the UI.
 */
export function usePageViews() {
  const config = useRuntimeConfig()
  const route = useRoute()
  const viewCount = ref<number | null>(null)

  onMounted(async () => {
    const { upstashRedisUrl, upstashRedisToken } = config.public as {
      upstashRedisUrl?: string
      upstashRedisToken?: string
    }

    if (!upstashRedisUrl || !upstashRedisToken) return

    const redisKey = `views:${route.path}`
    const sessionKey = `pv_tracked:${route.path}`

    try {
      const alreadyTracked = sessionStorage.getItem(sessionKey)

      if (!alreadyTracked) {
        // Increment and return the new count in one request
        const res = await fetch(`${upstashRedisUrl}/incr/${encodeURIComponent(redisKey)}`, {
          headers: { Authorization: `Bearer ${upstashRedisToken}` },
        })
        const data = await res.json()
        viewCount.value = data.result ?? null
        sessionStorage.setItem(sessionKey, '1')
      } else {
        // Already counted this session — just read the current value
        const res = await fetch(`${upstashRedisUrl}/get/${encodeURIComponent(redisKey)}`, {
          headers: { Authorization: `Bearer ${upstashRedisToken}` },
        })
        const data = await res.json()
        viewCount.value = data.result !== null ? Number(data.result) : null
      }
    } catch {
      // Non-critical — silently swallow any network/parse errors
    }
  })

  return { viewCount }
}
