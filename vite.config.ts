import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Nome do repositório no GitHub Pages: https://<usuario>.github.io/manga-lists/
const BASE_PATH = '/manga-lists/'

// Duplicado de propósito: este config não importa código de `src` (roda fora do
// bundle da app). Manter em sincronia com src/config.ts.
const APP_NAME = 'Ratsnest'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE_PATH : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png'],
      manifest: {
        name: `${APP_NAME} — Manga & Novels`,
        short_name: APP_NAME,
        description: 'Personal reading tracker for manga, manhwa, manhua and novels',
        theme_color: '#1e1440',
        background_color: '#0d0712',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // O chunk do xlsx (aba Images > upload de .xlsx, import dinâmico em
        // src/lib/imagensArquivo.ts) fica de fora do precache de propósito:
        // sem isso, globPatterns pega TODO .js gerado, inclusive chunks só
        // importados dinamicamente — o precache baixaria os ~140KB do xlsx
        // pra usuárias que nunca abrem a aba Images. Fica disponível via
        // rede normal na primeira vez que alguém sobe um .xlsx (precisa de
        // conexão nesse momento específico; CacheFirst abaixo cacheia depois
        // do primeiro uso, então funciona offline dali em diante).
        globIgnores: ['**/assets/xlsx-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/xlsx-.*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'xlsx-chunk-cache',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Capas de obras hospedadas no Supabase Storage: cache-first para funcionar offline
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/public/capas/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'capas-cache',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Chamadas REST do Supabase: tenta rede primeiro, cai pro cache se offline
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Ícones do app (bucket "icons" do Supabase Storage), incluindo o
            // rato do Edit mode: precisam sobreviver offline no PWA.
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/public/icons/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'icones-supabase',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}))
