import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `setu.config.ts` is bundled by the site build (astro.config.mjs loads it, and vite
 * resolves its imports). A config that declares collection field schemas imports zod —
 * either directly, or transitively via `@setu/core`'s re-export.
 *
 * Without zod in THIS package's dependencies, `import { z } from 'zod'` in a config fails
 * the whole site build with a rolldown resolve error, which is both fatal and opaque:
 *
 *   [vite]: Rolldown failed to resolve import "zod" from ".../apps/site/setu.config.ts"
 *
 * Found by driving #253 in the running app — every unit test passed while the site build
 * was broken for any site that actually used the feature. This guard is deliberately a
 * dependency assertion rather than a build fixture: it fails in milliseconds and names the
 * cause, where a build-based test would only reproduce the opaque error.
 */
describe('site can build a setu.config that declares field schemas', () => {
  it('declares zod as a direct dependency', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8'
      )
    ) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.['zod']).toBeTypeOf('string')
  })
})
