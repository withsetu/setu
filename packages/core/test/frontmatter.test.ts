import { describe, it, expect } from 'vitest'
import { parseMdoc, serializeMdoc } from '../src/index'

describe('serializeMdoc', () => {
  it('emits body only when frontmatter is empty', () => {
    expect(serializeMdoc({ frontmatter: {}, body: '# Hi\n' })).toBe('# Hi\n')
  })

  it('emits a --- fence for non-empty frontmatter', () => {
    expect(
      serializeMdoc({ frontmatter: { title: 'Hi' }, body: '# Body\n' })
    ).toBe('---\ntitle: Hi\n---\n# Body\n')
  })
})

describe('parseMdoc', () => {
  it('parses a fenced document into frontmatter + body', () => {
    expect(parseMdoc('---\ntitle: Hi\n---\n# Body\n')).toEqual({
      frontmatter: { title: 'Hi' },
      body: '# Body\n',
      // #666: the original YAML text rides along so serializeMdoc can re-emit
      // untouched keys byte-for-byte.
      rawFrontmatter: 'title: Hi'
    })
  })

  it('treats a body-only document as empty frontmatter', () => {
    expect(parseMdoc('# Just a body\n')).toEqual({
      frontmatter: {},
      body: '# Just a body\n'
    })
  })

  it('does NOT eat a leading horizontal rule as frontmatter', () => {
    expect(parseMdoc('---\n\npara\n')).toEqual({
      frontmatter: {},
      body: '---\n\npara\n'
    })
    expect(parseMdoc('---\n')).toEqual({ frontmatter: {}, body: '---\n' })
  })

  it('falls back to body-only on malformed YAML in the fence', () => {
    const raw = '---\n: : bad yaml :\n---\nbody\n'
    const r = parseMdoc(raw)
    expect(r.frontmatter).toEqual({})
    expect(r.body).toBe(raw)
  })
})
