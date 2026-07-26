import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '@setu/core'
import { registry } from '../src/blocks/registry'

/**
 * #967, over the PRODUCTION tag set. `packages/core/test/single-line-tag-roundtrip.test.ts`
 * holds the full table (both written shapes × attributes × idempotency) against a list it
 * derives from STANDARD_BLOCKS plus the repo-root `blocks/` folders. This file is the
 * anti-drift half: it iterates `registry.knownBlockTags` — the set the admin actually
 * hands `markdocToTiptap` (store.tsx) — so a tag that reaches production by some route
 * the core test's derivation does not model (today: `image`, appended by hand in
 * src/blocks/registry.ts) still gets covered rather than falling through the gap.
 */
const TAGS = [...registry.knownBlockTags]

describe('every tag the admin treats as a block survives the one-line shape', () => {
  it('has a non-empty registry to iterate', () => {
    // A registry that resolved to nothing would generate zero assertions below and read
    // as coverage — the #970 failure mode.
    expect(TAGS.length).toBeGreaterThanOrEqual(10)
    expect(TAGS).toContain('image')
  })

  for (const tag of TAGS) {
    it(`{% ${tag} %}body{% /${tag} %} round-trips byte-identically`, () => {
      const src = `{% ${tag} %}BODYTEXT{% /${tag} %}`
      const out = tiptapToMarkdoc(
        markdocToTiptap(src, { knownBlockTags: registry.knownBlockTags })
      ).trimEnd()
      expect(out).toContain('BODYTEXT')
      expect(out).toBe(src)
    })
  }
})
