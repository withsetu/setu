import { defineConfig } from 'astro/config'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'
import { loadConfig } from '@setu/core/node'
import { perPageCssPurge } from './integrations/per-page-css-purge.mjs'
import { securityHeaders } from './integrations/security-headers.mjs'
import { settingsWatcher } from './integrations/settings-watcher.mjs'

// Read the active theme from setu.config (single source of truth) and alias '@theme'
// to it, so pages render through whichever theme is configured.
const config = await loadConfig(
  new URL('./setu.config.ts', import.meta.url).pathname
)
const activeTheme = config.theme ?? '@setu/theme-default'

// Bundle ONLY the selected font family (+ mono), not every font the theme offers. The choice
// lives in setu.config themeOptions / the Customizer-published theme-options.json (file wins,
// matching loadThemeOptions); the theme's Layout imports `virtual:setu-fonts`, filled here.
function selectedFontChoice() {
  let fromFile
  try {
    const p = process.env.SETU_CONTENT_DIR
      ? join(process.env.SETU_CONTENT_DIR, '..', 'theme-options.json')
      : fileURLToPath(new URL('../../theme-options.json', import.meta.url))
    fromFile = JSON.parse(readFileSync(p, 'utf8'))?.font
  } catch {
    /* no published theme-options.json → fall back to the config / theme default */
  }
  return fromFile ?? config.themeOptions?.font
}

let fontImports = ''
if (activeTheme === '@setu/theme-default') {
  const { fontPackagesFor } = await import('@setu/theme-default/fonts')
  // The fontsource packages are the THEME's deps, and a \0-virtual module has no location to
  // resolve bare specifiers from — so resolve each to an absolute path from the theme's context.
  const themeDir = dirname(
    createRequire(import.meta.url).resolve('@setu/theme-default/theme.css')
  )
  const themeRequire = createRequire(join(themeDir, 'package.json'))
  fontImports = fontPackagesFor(selectedFontChoice())
    .map((pkg) => `import ${JSON.stringify(themeRequire.resolve(pkg))};`)
    .join('\n')
}

// Serve `virtual:setu-fonts` with only the resolved font imports. Empty for a theme that ships
// its own fonts — the no-op import in such a theme's Layout is then harmless.
const virtualFonts = {
  name: 'setu:virtual-fonts',
  resolveId: (id) =>
    id === 'virtual:setu-fonts' ? '\0virtual:setu-fonts' : null,
  load: (id) => (id === '\0virtual:setu-fonts' ? fontImports : null)
}

// Content lives at repo-root content/ (the publish-engine convention), which is OUTSIDE
// this app's node_modules scope. The markdoc integration injects bare imports
// (`@astrojs/markdoc/components`, `@astrojs/markdoc/runtime`, ...) into each compiled
// .mdoc; from the repo-root file location Vite can't resolve those specifiers. This Vite
// plugin resolves any `@astrojs/markdoc[/*]` specifier from this app, so .mdoc files render
// no matter where they live on disk.
const require = createRequire(import.meta.url)

// The @setu/* packages that repo-root blocks/<tag>/*.astro import with bare specifiers.
// Those files live outside apps/site, and the repo-root node_modules has no @setu/blocks —
// so the specifier cannot resolve from the importer's own location. TWO mechanisms below
// have to cover this set, and #613 happened because only one of them did; both now derive
// from this single list so they cannot drift apart:
//   1. `resolveMarkdocFromApp.resolveId` maps the specifier to THIS app's copy.
//   2. `vite.ssr.noExternal` keeps them non-external in the dev SSR environment.
// (2) is what makes (1) reachable: Vite externalizes bare specifiers in dev SSR, and an
// externalized specifier bypasses `resolveId` entirely — Node then resolves it from the
// importer's directory and fails. `astro build` bundles the whole SSR graph, so it was
// never affected, which is why the render-smoke suite and CI stayed green while every
// root-block page 500'd in `astro dev`.
const ROOT_BLOCK_PACKAGES = ['@setu/blocks', '@setu/core', '@setu/image-astro']

const isRootBlockPackage = (id) =>
  ROOT_BLOCK_PACKAGES.some((pkg) => id === pkg || id.startsWith(`${pkg}/`))

// Same list, expressed as noExternal patterns — derived, never hand-maintained.
const rootBlockNoExternal = ROOT_BLOCK_PACKAGES.map(
  (pkg) => new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`)
)

const resolveMarkdocFromApp = {
  name: 'setu:resolve-markdoc-from-app',
  enforce: 'pre',
  resolveId(id) {
    if (
      id === '@astrojs/markdoc' ||
      id.startsWith('@astrojs/markdoc/') ||
      isRootBlockPackage(id)
    ) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
    return null
  }
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
          entrypoint: new URL('./src/preview/preview.astro', import.meta.url)
            .pathname,
          prerender: false
        })
      }
    }
  }
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
  // perPageCssPurge runs only at `astro build` (astro:build:done) — dev is untouched. It strips
  // each page's unused block CSS and inlines the rest, so a page only ships the blocks it uses.
  integrations: [
    markdoc(),
    react(),
    devPreviewRoute,
    perPageCssPurge(),
    // Emits dist/_headers (default security headers, report-only CSP) at build; a user-supplied
    // public/_headers wins. Build-only, like perPageCssPurge — dev is untouched. (#289)
    securityHeaders(),
    settingsWatcher()
  ],
  vite: {
    resolve: {
      alias: {
        '@theme': activeTheme,
        // How repo-root blocks/ (bare-specifier imports only) reach the site's collision-aware
        // permalink map — same trick as the existing `virtual:setu-fonts`. Nothing imports this
        // yet; Task 6 (block permalink-aware links) is the first consumer.
        'setu:permalinks': fileURLToPath(
          new URL('./src/lib/permalinks.ts', import.meta.url)
        ),
        // Same seam for the shared entry→PostRow projection, so dynamic block renderers
        // (@setu/blocks latest-posts today; query is a candidate under #175) reuse ONE
        // projection instead of hand-copying it per component.
        'setu:post-row': fileURLToPath(
          new URL('./src/lib/post-row.ts', import.meta.url)
        )
      }
    },
    plugins: [resolveMarkdocFromApp, virtualFonts],
    // The theme Layout self-hosts fonts via `import '@fontsource-variable/...'`, which
    // resolve to .css. In `astro build` Vite bundles these, but in `astro dev` SSR Node's
    // loader tries to load the raw .css as a module and throws "Unknown file extension .css".
    // Force Vite to bundle the fontsource packages for SSR too.
    // ...and the @setu/* packages the repo-root blocks/ import, so those bare specifiers reach
    // `resolveMarkdocFromApp` instead of Node's resolver in dev SSR (#613 — see the comment on
    // ROOT_BLOCK_PACKAGES for why externalization is the root cause).
    ssr: {
      noExternal: [
        /^@fontsource-variable\//,
        /^@fontsource\//,
        ...rootBlockNoExternal
      ]
    },
    // Allow Vite to serve/process files from the repo root (blocks/ live outside apps/site).
    server: { fs: { allow: ['../..'] } }
  }
})
