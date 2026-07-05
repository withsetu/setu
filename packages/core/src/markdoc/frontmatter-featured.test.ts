import { describe, expect, it } from 'vitest'
import { parseMdoc, serializeMdoc } from './frontmatter'

describe('frontmatter — featuredImage round-trip', () => {
  it('serializes and parses metadata.featuredImage unchanged', () => {
    const file = {
      frontmatter: { title: 'X', featuredImage: '/media/2026/06/hero.jpg' },
      body: 'A body paragraph.\n'
    }
    const round = parseMdoc(serializeMdoc(file))
    expect(round.frontmatter['featuredImage']).toBe('/media/2026/06/hero.jpg')
    expect(round.body).toBe('A body paragraph.\n')
  })
})
