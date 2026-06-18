import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

// One collection over all content; entry.id is the path minus extension, e.g.
// "post/en/kitchen-sink" (collection/locale/slug — the publish-service convention).
// Content lives at repo-root content/ (the publish-engine convention); the Astro project
// root is apps/site, so the glob base is two levels up.
//
// SETU_CONTENT_DIR overrides the source for dev/UAT (an absolute path to a gitignored
// `.content-sandbox/<name>/content`), so the bridge's Publish never touches the tracked
// fixtures. Unset (build, render tests, prod) → the canonical repo-root content/.
const contentBase = process.env.SETU_CONTENT_DIR ?? '../../content'
const entries = defineCollection({ loader: glob({ pattern: '**/*.mdoc', base: contentBase }) })

export const collections = { entries }
