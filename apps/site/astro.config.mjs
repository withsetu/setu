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
  name: 'saytu:resolve-markdoc-from-app',
  enforce: 'pre',
  resolveId(id) {
    if (id === '@astrojs/markdoc' || id.startsWith('@astrojs/markdoc/')) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
    return null
  },
}

export default defineConfig({
  integrations: [markdoc(), react()],
  vite: {
    resolve: { alias: { '@theme': activeTheme } },
    plugins: [resolveMarkdocFromApp],
    // The theme Layout self-hosts fonts via `import '@fontsource-variable/...'`, which
    // resolve to .css. In `astro build` Vite bundles these, but in `astro dev` SSR Node's
    // loader tries to load the raw .css as a module and throws "Unknown file extension .css".
    // Force Vite to bundle the fontsource packages for SSR too.
    ssr: { noExternal: [/^@fontsource-variable\//, /^@fontsource\//] },
  },
})
