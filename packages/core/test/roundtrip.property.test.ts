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
 *  `*` used to be excluded as well, for two defects it alone could synthesise. The
 *  first is now fixed and the second is narrowly scoped, so `*` IS generated:
 *
 *    (a) delimiter-run adjacency — sibling inline runs that both carry `italic`
 *        serialized as "*a**`b`**c*", whose "**" re-parsed as a literal asterisk
 *        pair, LOSING the mark. FIXED: `buildInline` now merges adjacent runs that
 *        share a mark, so one delimiter pair spans the whole run.          [#693]
 *    (b) list looseness — the writer normalises a `*` or `+` bullet marker to `-`,
 *        so a `*` list ADJACENT to a `-` list merges into one list on the second
 *        pass and the document settles one pass late ("- a\n\n*\n" is the minimal
 *        counterexample). STILL OPEN, so `noAliasBulletList` below drops exactly
 *        the blocks that open such a list — the looseness shape — rather than
 *        dropping `*` from the alphabet wholesale.                         [#694]
 *
 *  #712: `_` is generated for the same reason as every other metacharacter, NOT
 *  because it is structurally safer than `*`. The old rationale here claimed the
 *  generator "cannot build a delimiter run out of it" because `_` never opens
 *  emphasis intraword. That clause is true and the conclusion drawn from it was
 *  false: `_` opens emphasis perfectly well after punctuation or whitespace, so
 *  `("_x_")` and `._x_.` both parse as italic. The generator therefore DID reach the
 *  #693 defect class through `_`, just rarely — roughly 1 run in 40,000, which is
 *  green at 5,000 and red at 60,000. That latent flake is what #712 tracked; the
 *  #693 fix is what actually removes it.
 *
 *  Restoring `*` immediately surfaced a THIRD defect of the same family, which had to
 *  be fixed before the alphabet could stay widened: CommonMark nests identical
 *  emphasis (`_a*a*_` is em(text, em(text))), and the reader appended a mark per level,
 *  so a run came out carrying `italic` twice and was wrapped in two delimiter pairs.
 *  `withMark` in ../src/markdoc/to-tiptap.ts now deduplicates. At roughly 1 document in
 *  200,000 it was a live CI flake at these run counts, not a curiosity.
 *
 *  These counts are the CI budget, not the evidence. The widened alphabet was confirmed
 *  green at numRuns 200,000 on every property below (~1,000,000 executions) before the
 *  counts were restored — raise them locally, not in CI, to re-confirm.
 */
const METACHARS = [
  '*',
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

/** #694 (still open). A block that opens a bullet list with an ALIAS marker (`*` or
 *  `+`). The writer normalises those to `-`, so such a list adjacent to a `-` list
 *  merges into one on the second pass and the document settles one pass late. The
 *  exclusion is deliberately this narrow — it drops only the looseness shape, and
 *  leaves `*` generated everywhere it exercises escaping and emphasis: intraword
 *  ("x*y"), at a block start ("*x"), inside headings, and inside tag bodies.
 *
 *  `\r` counts as a line separator here, not just `\n`: markdown-it breaks lines on a
 *  bare CR, so "# a\r*" really is a heading followed by a `*` list. A marker may also
 *  carry up to three leading spaces and still be a marker. Missing either was
 *  worth one false-green pass of this filter. */
const opensAliasBulletList = (block: string) =>
  /(^|[\n\r]) {0,3}[*+]([ \t]|$)/m.test(block)

const withoutAliasBulletLists = (blocks: string[]) =>
  blocks.filter((b) => !opensAliasBulletList(b))

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
    .map(withoutAliasBulletLists)
    .filter((bs) => bs.length > 0)
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
    .map(withoutAliasBulletLists)
    .filter((bs) => bs.length > 0)
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
