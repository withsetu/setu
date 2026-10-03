import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { entryIdFromContentPath } from '@setu/core'

// One collection over all content; entry.id is "collection/locale/slug", e.g.
// "post/en/kitchen-sink" (the publish-service convention).
// Content lives at repo-root content/ (the publish-engine convention); the Astro project
// root is apps/site, so the glob base is two levels up.
//
// SETU_CONTENT_DIR overrides the source for dev/UAT (an absolute path to a gitignored
// `.content-sandbox/<name>/content`), so the bridge's Publish never touches the tracked
// fixtures. Unset (build, render tests, prod) → the canonical repo-root content/.
const contentBase = process.env.SETU_CONTENT_DIR ?? '../../content'
const entries = defineCollection({
  loader: glob({
    pattern: '**/*.mdoc',
    base: contentBase,
    // Explicit, not Astro's default (which uses a frontmatter `slug:` as the whole id,
    // strips a trailing /index and github-slugs every segment). The id is the file path
    // verbatim, via the one helper scripts/gen-relations.mjs also uses — parity pinned by
    // apps/site/test/entry-id-parity.test.ts (#1117).
    generateId: ({ entry }) => entryIdFromContentPath(entry)
  })
})

export const collections = { entries }
