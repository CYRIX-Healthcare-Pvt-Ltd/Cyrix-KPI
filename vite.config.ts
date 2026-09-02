import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * Which build this is, stamped in at build time.
 *
 * There is no way to ask a running page when it was deployed — the
 * bundle has no memory of being made. So the answer has to be baked in
 * while it is being made, and the only moment that can happen is here.
 *
 * It exists because "has my change gone out yet?" was being answered by
 * reloading and squinting. A hashed filename in the network tab is not
 * an answer anybody should have to decode.
 *
 * The commit comes from Vercel's own environment on a real deploy and
 * from git on a developer's machine. Neither is guaranteed — a build
 * from a tarball has no git and no Vercel — so it degrades to a dash
 * rather than failing the build over a caption.
 */
const buildSha = (): string => {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromVercel) return fromVercel.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return '—'
  }
}

/**
 * The app lives at app.cyrix.in/kpi, not at the root.
 *
 * app.cyrix.in is the portal — a tile per module, KPI being one of
 * three. So every URL this app emits has to carry /kpi, and there are
 * three separate places that decide one: Vite writes it into index.html,
 * React Router strips it off the front of every route, and the manifest
 * tells the installed app which corner of the origin it owns.
 *
 * outDir matches base deliberately. Vite's `base` only rewrites the URLs
 * inside index.html — it does not move the files — so building to plain
 * dist/ would ship a page asking for /kpi/assets/… while the file sat at
 * /assets/…, and every bundle would 404. Building into dist/kpi puts the
 * files where the page is about to look for them.
 */
export default defineConfig({
  base: '/kpi/',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Cyrix KPI',
        short_name: 'Cyrix KPI',
        description: 'Monthly KPI submission and appraisal scoring for Cyrix Healthcare',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/kpi/',
        scope: '/kpi/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Naming itself here is what lets getInstalledRelatedApps() answer
        // "yes, it is already on this device" from inside an ordinary tab
        // — the one case display-mode: standalone cannot see. Without it
        // somebody who followed a link to the app they already installed
        // gets asked to install it again.
        //
        // prefer_related_applications stays false, and must: true would
        // tell the browser to stop offering the install altogether.
        related_applications: [
          { platform: 'webapp', url: 'https://app.cyrix.in/manifest.webmanifest' },
        ],
        prefer_related_applications: false,
      },
      workbox: {
        // Old hashed chunks are what a stale tab asks for after a
        // deploy. Keeping them cached forever is how a browser ends up
        // serving half of one build and half of another.
        cleanupOutdatedCaches: true,
        // Handles the tap on a notification. Android will not let the page
        // raise one at all — only the worker may — so the click arrives
        // here rather than in the app.
        importScripts: ['/sw-notifications.js'],
        // Never cache API responses — appraisal figures must always be live.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist/kpi',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: { port: 5173 },
})
