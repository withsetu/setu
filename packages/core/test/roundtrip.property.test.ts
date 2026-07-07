import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '.split(
  ''
)
const safeText = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 40 })
  .map((a) => a.join('').trim() || 'x')

const heading = safeText.map((t) => `# ${t}`)
const paragraph = safeText
const bullets = fc
  .array(safeText, { minLength: 1, maxLength: 3 })
  .map((items) => items.map((i) => `- ${i}`).join('\n'))
const callout = safeText.map((t) => `{% callout %}\n${t}\n{% /callout %}`)
const ifBlock = fc
  .tuple(safeText, safeText)
  .map(([v, t]) => `{% if $${v.replace(/ /g, '')} %}\n${t}\n{% /if %}`)

const block = fc.oneof(heading, paragraph, bullets, callout, ifBlock)
const document = fc
  .array(block, { minLength: 1, maxLength: 6 })
  .map((bs) => bs.join('\n\n') + '\n')

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

describe('round-trip idempotency (property-based)', () => {
  it('reaches a stable fixed point for random documents', () => {
    fc.assert(
      fc.property(document, (s0) => {
        const s1 = roundtrip(s0)
        const s2 = roundtrip(s1)
        expect(s2).toBe(s1)
      }),
      { numRuns: 200 }
    )
  })
})
