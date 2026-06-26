import { describe, expect, it } from 'vitest'
import { extractMediaRefs } from './extract-media-refs'

describe('extractMediaRefs — frontmatter featuredImage', () => {
  it('captures a frontmatter featuredImage as a normalized media key', () => {
    const doc = '---\ntitle: X\nfeaturedImage: /media/2026/06/hero.jpg\n---\n\nBody.\n'
    expect(extractMediaRefs(doc)).toContain('2026/06/hero')
  })
  it('also normalizes an extensionless featuredImage path', () => {
    const doc = '---\nfeaturedImage: /media/2026/06/hero\n---\n\nBody.\n'
    expect(extractMediaRefs(doc)).toContain('2026/06/hero')
  })
})
