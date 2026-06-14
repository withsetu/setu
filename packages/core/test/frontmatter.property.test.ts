import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseMdoc, serializeMdoc } from '../src/index'

// Safe content avoids YAML metacharacters so the test exercises OUR round-trip
// (parse/serialize + the HR-trap), not js-yaml's unicode edge cases.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz '.split('')
const KEYCHARS = 'abcdefghijklmnopqrstuvwxyz'.split('')
const safeStr = fc.array(fc.constantFrom(...LETTERS), { minLength: 0, maxLength: 20 }).map((a) => a.join(''))
const safeKey = fc.array(fc.constantFrom(...KEYCHARS), { minLength: 1, maxLength: 8 }).map((a) => a.join(''))
const metaValue = fc.oneof(safeStr, fc.integer(), fc.boolean())
const metadata = fc.dictionary(safeKey, metaValue, { maxKeys: 5 })
const body = fc.oneof(
  safeStr,
  safeStr.map((s) => `# ${s}\n\n${s}\n`),
  safeStr.map((s) => `---\n\n${s}\n`), // a body that starts with a horizontal rule
  fc.constant('---\n'),
  fc.constant(''),
)

describe('frontmatter round-trip (property-based)', () => {
  it('parseMdoc(serializeMdoc(x)) deep-equals x', () => {
    fc.assert(
      fc.property(metadata, body, (frontmatter, b) => {
        const r = parseMdoc(serializeMdoc({ frontmatter, body: b }))
        expect(r.frontmatter).toEqual(frontmatter)
        expect(r.body).toBe(b)
      }),
    )
  })

  it('serializeMdoc is a stable fixed point', () => {
    fc.assert(
      fc.property(metadata, body, (frontmatter, b) => {
        const s1 = serializeMdoc({ frontmatter, body: b })
        const s2 = serializeMdoc(parseMdoc(s1))
        expect(s2).toBe(s1)
      }),
    )
  })
})
