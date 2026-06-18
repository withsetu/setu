import { defineConfig } from 'astro/config'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'
import { loadConfig } from '@saytu/core/node'

// Read the active theme from saytu.config (single source of truth) and alias '@theme'
// to it, so pages render through whichever theme is configured.
const config = await loadConfig(new URL('./saytu.config.ts', import.meta.url).pathname)
const activeTheme = config.theme ?? '@saytu/theme-default'

export default defineConfig({
  integrations: [markdoc(), react()],
  vite: { resolve: { alias: { '@theme': activeTheme } } },
})
