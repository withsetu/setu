import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

/** Letters and a space — the ORIGINAL alphabet (#651). It can never generate an
 *  escape metacharacter, a newline, a tab or a non-ASCII byte, so it never exercised
 *  any of the hard serialization paths. Kept because the plain-prose fixed point is
 *  still worth asserting. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '.split(
  ''
)

/** Metacharacters and whitespace the original alphabet could never produce: link and
 *  image brackets, parens, quotes, tilde, pipe, hard line breaks, CR, tab, and
 *  non-ASCII up to astral plane (#651).
 *
 *  The backslash, `*`, `_`, `#` and backtick were excluded here as known-open
 *  escaping defects. The escaping contract in `src/markdoc/escape-inline.ts`
 *  (#652/#675/#676/#677) closed all four, so `\`, `_`, `#` and backtick are now
 *  generated:
 *
 *    `\`  escape erosion:  "\\\\" -> "\\",  "\\_x" -> "_x",  "\\[y]" -> "[y]"
 *         and, in a list item, "- b \\*x" -> "- b *x" (an escaped literal asterisk
 *         becoming an active emphasis marker on the next save).            [#675]
 *    `*` `_` `#`  escape non-idempotency: emphasis/heading markers gained or lost a
 *         leading backslash across successive round-trips, e.g.
 *         "- |']#\rb" -> "- |']# b" -> "- |']\\# b".                       [#676]
 *    '`'  code-span fence width erosion: "``x``" -> "`x`" ("# 中``b中 ` `" was
 *         unstable across two round-trips).                                [#677]
 *
 *  ALSO FIXED, and now covered by the widened generator below: tag blocks with
 *  multi-line bodies (#674) — a bare "\r" desynchronized Markdoc's location line
 *  numbering from `source.split('\n')`, so the passthrough slicing in markdocToTiptap
 *  dropped the opening "{% callout %}" line and duplicated the preceding block,
 *  GROWING the document on every save (~15% of random tag-bearing documents). That is
 *  why `taggedDocument` now carries the wide alphabet too, not just `proseDocument`.
 *
 *  `*` IS THE ONLY CHARACTER STILL EXCLUDED, and the reason is structural rather than
 *  escaping: it is the only generatable character that can synthesise EMPHASIS, which
 *  exposes two defects no escape rule can close.
 *
 *    (a) delimiter-run adjacency — two sibling inline runs that both carry `italic`
 *        serialize as "*a**`b`*", whose "**" re-parses as a literal asterisk pair,
 *        LOSING the second run's italic mark.                              [#693]
 *    (b) list looseness — a list containing an empty item is re-emitted by
 *        Markdoc.format with blank lines between items, which re-reads as a tight
 *        list, so the document settles one pass late ("- a\r*\n\n# a\n" is the
 *        minimal counterexample).                                          [#694]
 *
 *  Both need a delimiter-selection/normalisation design; do not re-litigate them here.
 *  `_` (the other emphasis character) IS generated: it never opens emphasis intraword,
 *  so the generator cannot build a delimiter run out of it.
 */
const METACHARS = [
  '[',
  ']',
  '(',
  ')',
  '!',
  '"',
  "'",
  '~',
  '|',
  '\\',
  '_',
  '#',
  '`',
  '\n',
  '\r',
  '\t',
  'é',
  '中',
  '🙂'
]

const textFrom = (alphabet: string[]) =>
  fc
    .array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 40 })
    .map((a) => a.join('').trim() || 'x')

const safeText = textFrom(LETTERS)
const wideText = textFrom([...LETTERS, ...METACHARS])

const heading = (text: fc.Arbitrary<string>) => text.map((t) => `# ${t}`)
const bullets = (text: fc.Arbitrary<string>) =>
  fc
    .array(text, { minLength: 1, maxLength: 3 })
    .map((items) => items.map((i) => `- ${i}`).join('\n'))

/** Documents of prose blocks only. */
const proseDocument = (text: fc.Arbitrary<string>) =>
  fc
    .array(fc.oneof(text, heading(text), bullets(text)), {
      minLength: 1,
      maxLength: 6
    })
    .map((bs) => bs.join('\n\n') + '\n')

/** The original generator: prose plus `{% callout %}` and `{% if %}` tag blocks. */
const taggedDocument = (text: fc.Arbitrary<string>) => {
  const callout = text.map((t) => `{% callout %}\n${t}\n{% /callout %}`)
  const ifBlock = fc
    .tuple(text, text)
    .map(([v, t]) => `{% if $${v.replace(/ /g, '')} %}\n${t}\n{% /if %}`)
  return fc
    .array(fc.oneof(text, heading(text), bullets(text), callout, ifBlock), {
      minLength: 1,
      maxLength: 6
    })
    .map((bs) => bs.join('\n\n') + '\n')
}

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

describe('round-trip idempotency (property-based)', () => {
  it('reaches a stable fixed point for random documents', () => {
    fc.assert(
      fc.property(taggedDocument(safeText), (s0) => {
        const s1 = roundtrip(s0)
        expect(roundtrip(s1)).toBe(s1)
      }),
      { numRuns: 200 }
    )
  })

  it('reaches a stable fixed point for metacharacter-heavy prose', () => {
    fc.assert(
      fc.property(proseDocument(wideText), (s0) => {
        const s1 = roundtrip(s0)
        expect(roundtrip(s1)).toBe(s1)
      }),
      { numRuns: 6000 }
    )
  })

  /** #674. Tag blocks over the WIDE alphabet — the case the generator used to exclude.
   *  Every other defect in this slice converges after one pass, so a fixed-point check
   *  alone could not distinguish them; this one never converged, the document grew
   *  without bound. Asserting the fixed point over tag-bearing wide-alphabet documents
   *  is exactly the regression guard. */
  it('reaches a stable fixed point for metacharacter-heavy tag blocks', () => {
    fc.assert(
      fc.property(taggedDocument(wideText), (s0) => {
        const s1 = roundtrip(s0)
        expect(roundtrip(s1)).toBe(s1)
      }),
      { numRuns: 5000 }
    )
  })

  /** #674, the sharper form: the defect made the document GROW every save. Length must
   *  never increase across successive round-trips of an already-round-tripped doc. */
  it('never grows a tag-bearing document across successive saves', () => {
    fc.assert(
      fc.property(taggedDocument(wideText), (s0) => {
        const s1 = roundtrip(s0)
        expect(roundtrip(s1).length).toBeLessThanOrEqual(s1.length)
      }),
      { numRuns: 5000 }
    )
  })
})

/** Byte-stability (#651). The fixed-point property above only ever asserted
 *  `rt(rt(s)) === rt(s)`, so ANY defect that settles after one pass — which is every
 *  defect in this slice — passed it forever. This asserts the real contract for
 *  already-canonical content: `rt(s) === s`, no drift at all.
 *
 *  The generator is restricted to the shape `tiptapToMarkdoc` itself emits (`**` for
 *  bold, `*` for italic, `~~` for strike, backtick code spans, inline links), so a
 *  failure here is genuine drift and never expected normalization. */
describe('round-trip byte-stability (property-based)', () => {
  const word = fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 1,
      maxLength: 8
    })
    .map((a) => a.join(''))
  const words = fc
    .array(word, { minLength: 1, maxLength: 6 })
    .map((w) => w.join(' '))

  const canonicalInline = fc.oneof(
    words,
    words.map((t) => `**${t}**`),
    words.map((t) => `*${t}*`),
    words.map((t) => `~~${t}~~`),
    words.map((t) => `\`${t}\``),
    fc.tuple(words, word).map(([t, h]) => `[${t}](https://example.com/${h})`),
    // A code span carrying a sibling mark — the #653 pair. Before that fix the
    // sibling mark was discarded: [`api`](href) collapsed to `api`.
    fc
      .tuple(words, word)
      .map(([t, h]) => `[\`${t}\`](https://example.com/${h})`),
    words.map((t) => `**\`${t}\`**`),
    words.map((t) => `*\`${t}\`*`)
  )

  const listBlock = fc
    .array(canonicalInline, { minLength: 1, maxLength: 3 })
    .map((items) => items.map((i) => `- ${i}`).join('\n'))

  const canonicalBlock = fc.oneof(
    canonicalInline,
    fc
      .tuple(fc.integer({ min: 1, max: 6 }), canonicalInline)
      .map(([lvl, t]) => `${'#'.repeat(lvl)} ${t}`),
    listBlock,
    canonicalInline.map((t) => `{% callout %}\n${t}\n{% /callout %}`),
    // A passthrough tag with a multi-line body — the #674 shape, byte-for-byte.
    fc
      .tuple(word, canonicalInline)
      .map(([v, t]) => `{% if $${v} %}\n${t}\n{% /if %}`)
  )

  const isList = (b: string) => b.startsWith('- ')

  const canonicalDocument = fc
    .array(canonicalBlock, { minLength: 1, maxLength: 5 })
    // Two blank-line-separated bullet blocks are ONE loose list in Markdown, which
    // legitimately re-serializes as a single tight list. Drop the adjacency so the
    // generator only emits documents that are already canonical.
    .map((bs) =>
      bs.filter((b, i) => !(i > 0 && isList(b) && isList(bs[i - 1]!)))
    )
    .filter((bs) => bs.length > 0)
    .map((bs) => bs.join('\n\n') + '\n')

  it('round-trips canonical Markdoc byte-for-byte', () => {
    fc.assert(
      fc.property(canonicalDocument, (s0) => {
        expect(roundtrip(s0)).toBe(s0)
      }),
      { numRuns: 6000 }
    )
  })
})
