import { defineConfig } from 'astro/config'
import { createRequire } from 'node:module'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'
import { loadConfig } from '@setu/core/node'

// Read the active theme from setu.config (single source of truth) and alias '@theme'
// to it, so pages render through whichever theme is configured.
const config = await loadConfig(new URL('./setu.config.ts', import.meta.url).pathname)
const activeTheme = config.theme ?? '@setu/theme-default'

// Content lives at repo-root content/ (the publish-engine convention), which is OUTSIDE
// this app's node_modules scope. The markdoc integration injects bare imports
// (`@astrojs/markdoc/components`, `@astrojs/markdoc/runtime`, ...) into each compiled
// .mdoc; from the repo-root file location Vite can't resolve those specifiers. This Vite
// plugin resolves any `@astrojs/markdoc[/*]` specifier from this app, so .mdoc files render
// no matter where they live on disk.
const require = createRequire(import.meta.url)
const resolveMarkdocFromApp = {
  name: 'setu:resolve-markdoc-from-app',
  enforce: 'pre',
  resolveId(id) {
    if (id === '@astrojs/markdoc' || id.startsWith('@astrojs/markdoc/')) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
    // blocks/callout/callout.astro lives outside apps/site — its bare @setu/* imports
    // won't resolve from the repo root. Resolve them from this app where they ARE installed.
    if (id === '@setu/blocks' || id.startsWith('@setu/blocks/')) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
    return null
  },
}

// Inject the in-editor preview route ONLY in `astro dev`, from outside src/pages so it never
// enters the static build (astro build + the render tests are untouched). Production/edge preview
// is a later, adapter-backed concern; locally `astro dev` serves it on demand with no adapter.
const devPreviewRoute = {
  name: 'setu:dev-preview-route',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command === 'dev') {
        injectRoute({
          pattern: '/preview',
          entrypoint: new URL('./src/preview/preview.astro', import.meta.url).pathname,
          prerender: false,
        })
      }
    },
  },
}

export default defineConfig({
  // Absolute base URL for builds (used by RSS/sitemap/canonical links). Deployment-specific →
  // env at build; dev falls back to the local origin. A prod build MUST set SETU_SITE_URL.
  site: process.env.SETU_SITE_URL ?? 'http://localhost:4321',
  // Astro 7 changed the compressHTML default from `true` to `'jsx'`, which collapses
  // whitespace between inline elements using JSX rules. Our blocks + content templates
  // were authored under the v6 (`true`) model, so pin it to preserve exact prior output.
  // Revisit per-template if/when we want JSX-style compression.
  compressHTML: true,
  integrations: [markdoc(), react(), devPreviewRoute],
  vite: {
    resolve: { alias: { '@theme': activeTheme } },
    plugins: [resolveMarkdocFromApp],
    // The theme Layout self-hosts fonts via `import '@fontsource-variable/...'`, which
    // resolve to .css. In `astro build` Vite bundles these, but in `astro dev` SSR Node's
    // loader tries to load the raw .css as a module and throws "Unknown file extension .css".
    // Force Vite to bundle the fontsource packages for SSR too.
    ssr: { noExternal: [/^@fontsource-variable\//, /^@fontsource\//] },
    // Allow Vite to serve/process files from the repo root (blocks/ live outside apps/site).
    server: { fs: { allow: ['../..'] } },
  },
})
