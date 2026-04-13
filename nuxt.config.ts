export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  runtimeConfig: {
    deepinfraApiKey: process.env.DEEPINFRA_API_KEY,
    googleGeminiApiKey: process.env.GOOGLE_GEMINI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    public: {
      mapboxToken: process.env.NUXT_PUBLIC_MAPBOX_TOKEN,
      upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
      upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    }
  },
  nitro: {
    externals: {
      inline: [],
    },
    rollupConfig: {
      external: ['pg', 'pg-native', 'ssh2'],
    },
  },
  app: {
    head: {
      title: 'Australian Planning Library',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap' },
      ],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Browse Australian planning instruments — LEPs, SEPPs, and DCPs.' }
      ]
    }
  }
})
