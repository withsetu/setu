import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import markdoc from '@astrojs/markdoc'

export default defineConfig({
  integrations: [markdoc(), react()],
})
