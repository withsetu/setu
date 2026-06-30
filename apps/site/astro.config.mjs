import { defineConfig } from 'astro/config'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'
import { loadConfig } from '@setu/core/node'
import { perPageCssPurge } from './integrations/per-page-css-purge.mjs'

// Read the active theme from setu.config (single source of truth) and alias '@theme'
// to it, so pages render through whichever theme is configured.
const config = await loadConfig(new URL('./setu.config.ts', import.meta.url).pathname)
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
  const themeDir = dirname(createRequire(import.meta.url).resolve('@setu/theme-default/theme.css'))
  const themeRequire = createRequire(join(themeDir, 'package.json'))
  fontImports = fontPackagesFor(selectedFontChoice())
    .map((pkg) => `import ${JSON.stringify(themeRequire.resolve(pkg))};`)
    .join('\n')
}

// Serve `virtual:setu-fonts` with only the resolved font imports. Empty for a theme that ships
// its own fonts — the no-op import in such a theme's Layout is then harmless.
const virtualFonts = {
  name: 'setu:virtual-fonts',
  resolveId: (id) => (id === 'virtual:setu-fonts' ? '\0virtual:setu-fonts' : null),
  load: (id) => (id === '\0virtual:setu-fonts' ? fontImports : null),
}

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
    if (id === '@setu/core' || id.startsWith('@setu/core/')) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
    if (id === '@setu/image-astro' || id.startsWith('@setu/image-astro/')) {
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
  // Astro 7 changed the compressHTML default from `true` to `'jsx'`, which collapses
  // whitespace between inline elements using JSX rules. Our blocks + content templates
  // were authored under the v6 (`true`) model, so pin it to preserve exact prior output.
  // Revisit per-template if/when we want JSX-style compression.
  compressHTML: true,
  // perPageCssPurge runs only at `astro build` (astro:build:done) — dev is untouched. It strips
  // each page's unused block CSS and inlines the rest, so a page only ships the blocks it uses.
  integrations: [markdoc(), react(), devPreviewRoute, perPageCssPurge()],
  vite: {
    resolve: { alias: { '@theme': activeTheme } },
    plugins: [resolveMarkdocFromApp, virtualFonts],
    // The theme Layout self-hosts fonts via `import '@fontsource-variable/...'`, which
    // resolve to .css. In `astro build` Vite bundles these, but in `astro dev` SSR Node's
    // loader tries to load the raw .css as a module and throws "Unknown file extension .css".
    // Force Vite to bundle the fontsource packages for SSR too.
    ssr: { noExternal: [/^@fontsource-variable\//, /^@fontsource\//] },
    // Allow Vite to serve/process files from the repo root (blocks/ live outside apps/site).
    server: { fs: { allow: ['../..'] } },
  },
})
