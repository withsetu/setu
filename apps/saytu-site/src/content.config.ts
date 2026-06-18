import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

// One collection over all content; entry.id is the path minus extension, e.g.
// "post/en/kitchen-sink" (collection/locale/slug — the publish-service convention).
// Content lives at repo-root content/ (the publish-engine convention); the Astro project
// root is apps/saytu-site, so the glob base is two levels up.
const entries = defineCollection({ loader: glob({ pattern: '**/*.mdoc', base: '../../content' }) })

export const collections = { entries }
