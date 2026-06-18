import { defineConfig } from 'astro/config'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'

export default defineConfig({ integrations: [markdoc(), react()] })
