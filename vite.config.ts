import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,json,bin}'],
      },
      manifest: {
        name: 'Piano Player - Follow Along',
        short_name: 'PianoPlayer',
        description: 'Synthesia-style follow-along piano for concerts, worship and practice.',
        theme_color: '#0a0a14',
        background_color: '#0a0a14',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '.',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      }
    })
  ],
})
