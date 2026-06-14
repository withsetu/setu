import { describe, it, expect } from 'vitest'
import { contentPath } from '../../src/index'

describe('contentPath', () => {
  it('builds content/<collection>/<locale>/<slug>.mdoc', () => {
    expect(contentPath({ collection: 'post', locale: 'en', slug: 'hello' })).toBe('content/post/en/hello.mdoc')
  })

  it('reflects locale and collection distinctly', () => {
    expect(contentPath({ collection: 'page', locale: 'fr', slug: 'about' })).toBe('content/page/fr/about.mdoc')
  })
})
