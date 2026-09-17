export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  runtimeConfig: {
    deepinfraApiKey: process.env.DEEPINFRA_API_KEY,
    googleGeminiApiKey: process.env.GOOGLE_GEMINI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    // Only /api/design/* reads this. Absent, the design lab says so and every
    // other route is unaffected.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    // The one shared password server/middleware/password.ts asks every visitor
    // for. Declared empty here and supplied as NUXT_APP_PASSWORD in the
    // deployment's environment: the repository is public, so it cannot live in
    // this file. A production build with it unset refuses everyone; a dev
    // server with it unset asks nobody.
    appPassword: '',
    public: {
      mapboxToken: process.env.NUXT_PUBLIC_MAPBOX_TOKEN,
      martinUrl: process.env.NUXT_PUBLIC_MARTIN_URL || 'http://172.105.184.178:3004',
      upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
      upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    }
  },
  nitro: {
    rollupConfig: {
      external: ['pg-native', 'ssh2'],
    },
    // Run the server functions in Sydney, next to the planningai database.
    // Every API route here is a few sequential Postgres round trips, and from
    // the default Washington region each one crossed the Pacific: a search
    // measured 2.3 s in production against 0.9 s from Sydney.
    vercel: {
      functions: {
        regions: ['syd1'],
      },
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
