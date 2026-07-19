import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

/** One read+write pass. The contract under test is `rt(s) === s` for canonical
 *  source, and `rt(rt(s)) === rt(s)` for anything else. */
const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

/** The literal text a source string reads back as, for asserting that escaping
 *  never changes MEANING — only bytes. */
const textOf = (s: string): string => {
  const doc = markdocToTiptap(s)
  const collect = (n: unknown): string => {
    const node = n as { text?: string; content?: unknown[] }
    if (typeof node.text === 'string') return node.text
    return (node.content ?? []).map(collect).join('')
  }
  return doc.content.map(collect).join('\n')
}

describe('inline escaping contract (#652)', () => {
  const cases: [string, string][] = [
    ['emphasis markers', 'a \\*not emphasis\\* b\n'],
    ['non-intraword underscores', 'a \\_x\\_ b\n'],
    ['link brackets', 'literal \\[not a link\\](/x)\n'],
    ['code ticks', 'a \\`code\\` b\n'],
    ['backslash', 'a \\\\ b\n'],
    ['heading marker at block start', '\\# not a heading\n'],
    ['blockquote marker at block start', '\\> not a quote\n'],
    ['bullet marker at block start', '\\- not a bullet\n'],
    ['ordered marker at block start', '1\\. not a list\n'],
    ['markdoc tag braces', 'a \\{% not-a-tag %} b\n'],
    ['html entity', 'a \\&amp; b\n'],
    ['angle bracket', 'a \\<b> c\n'],
    ['strikethrough run', 'a \\~\\~not strike\\~\\~ b\n']
  ]

  for (const [name, src] of cases) {
    it(`preserves ${name} byte-for-byte`, () => {
      expect(rt(src)).toBe(src)
    })
  }

  it('does not escape intraword underscores (GFM never emphasises them)', () => {
    expect(rt('snake_case_name\n')).toBe('snake_case_name\n')
  })

  /** Escaping that the contract deems unnecessary is dropped on the first save
   *  — a one-time normalisation to canonical form. The bar is that the MEANING
   *  survives and the result is then byte-stable forever; it is not corruption
   *  the way an eroded `\*` or `\\` is. */
  it('normalises redundant escapes without changing meaning', () => {
    const redundant: [string, string][] = [
      ['snake\\_case\\_name\n', 'snake_case_name\n'],
      ['a \\<b\\> c\n', 'a \\<b> c\n'],
      ['a \\! b\n', 'a ! b\n']
    ]
    for (const [src, canonical] of redundant) {
      expect(rt(src)).toBe(canonical)
      expect(rt(canonical)).toBe(canonical)
      expect(textOf(canonical)).toBe(textOf(src))
    }
  })

  it('does not escape block-start markers away from block start', () => {
    expect(rt('a # b\n')).toBe('a # b\n')
    expect(rt('a > b\n')).toBe('a > b\n')
    expect(rt('a - b\n')).toBe('a - b\n')
  })

  it('escapes block-start markers inside a list item', () => {
    expect(rt('- \\# not a heading\n')).toBe('- \\# not a heading\n')
  })

  it('does not escape inside a code span (content is literal)', () => {
    expect(rt('a `*x* _y_ \\z` b\n')).toBe('a `*x* _y_ \\z` b\n')
  })
})

describe('escape erosion across passes (#675)', () => {
  const eroders = [
    'a \\\\ b\n',
    'a \\_x b\n',
    'a \\[y\\] b\n',
    '- b \\*x\n',
    '- a \\\\ b\n'
  ]
  for (const src of eroders) {
    it(`keeps ${JSON.stringify(src)} stable over three passes`, () => {
      const one = rt(src)
      expect(one).toBe(src)
      expect(rt(one)).toBe(src)
      expect(rt(rt(one))).toBe(src)
    })
  }

  it('never turns an escaped literal into an active emphasis marker', () => {
    const src = '- b \\*x\n'
    expect(textOf(rt(src))).toBe('b *x')
  })
})

describe('escape idempotency for * _ # (#676)', () => {
  const seeds = ["- |']#\rb\n", '# a#b\n', '*x\n', '> \\# x\n', '#a\n']
  for (const s0 of seeds) {
    it(`settles after one pass for ${JSON.stringify(s0)}`, () => {
      const s1 = rt(s0)
      expect(rt(s1)).toBe(s1)
      expect(rt(rt(s1))).toBe(s1)
    })
  }
})

describe('code-span fence width (#677)', () => {
  it('preserves a doubled fence when the content needs one', () => {
    expect(rt('a ``x`y`` b\n')).toBe('a ``x`y`` b\n')
  })

  it('widens the fence rather than splitting a span containing backticks', () => {
    const src = 'a ``x`y`` b\n'
    expect(textOf(src)).toBe('a x`y b')
    expect(textOf(rt(src))).toBe('a x`y b')
  })

  it('handles a run of two backticks inside the content', () => {
    const src = 'a ```x``y``` b\n'
    expect(rt(src)).toBe(src)
    expect(textOf(rt(src))).toBe('a x``y b')
  })

  it('pads when the content starts or ends with a backtick', () => {
    const src = 'a `` `x` `` b\n'
    expect(rt(src)).toBe(src)
    expect(textOf(rt(src))).toBe('a `x` b')
  })

  it('narrows an over-wide fence to the minimum safe width', () => {
    // Not byte-stable (the source is not canonical) but must not corrupt.
    expect(rt('a ```x``` b\n')).toBe('a `x` b\n')
    expect(textOf(rt('a ```x``` b\n'))).toBe('a x b')
  })
})

describe('escaping does not disturb neighbouring constructs', () => {
  it('keeps an autolink an autolink', () => {
    expect(rt('<https://example.com/a_b>\n')).toBe(
      '<https://example.com/a_b>\n'
    )
  })

  it('keeps inline links intact', () => {
    expect(rt('[a_b](https://example.com/x_y)\n')).toBe(
      '[a_b](https://example.com/x_y)\n'
    )
  })

  it('escapes inside emphasis without double-escaping', () => {
    expect(rt('**a \\* b**\n')).toBe('**a \\* b**\n')
    expect(rt('*a \\_ b*\n')).toBe('*a \\_ b*\n')
  })

  it('escapes inside a table cell without double-escaping backslashes', () => {
    const src = '| a \\\\ b | c \\| d |\n| --- | --- |\n| e \\*f\\* | g |\n'
    expect(rt(src)).toBe(src)
  })

  it('escapes inside a heading', () => {
    expect(rt('# a \\*b\\* c\n')).toBe('# a \\*b\\* c\n')
  })

  /** A trailing `#` run in a heading is CommonMark's optional ATX CLOSING
   *  sequence, so writing it unescaped deletes it: `# \#` became `# #`, which
   *  re-reads as an EMPTY heading. Found by the widened property generator once
   *  `#` was no longer excluded. */
  it('escapes a heading-trailing # run (ATX closing sequence)', () => {
    expect(rt('# \\#\n')).toBe('# \\#\n')
    expect(textOf(rt('# \\#\n'))).toBe('#')
    expect(rt('# a \\#\n')).toBe('# a \\#\n')
    expect(rt('# a \\#\\#\n')).toBe('# a \\#\\#\n')
    expect(textOf(rt('# a \\#\\#\n'))).toBe('a ##')
  })

  it('leaves a heading-trailing # alone when it is not a closing sequence', () => {
    // No whitespace before the run, so CommonMark reads it as literal text.
    expect(rt('# a#\n')).toBe('# a#\n')
    // Mid-heading hashes are never a closing sequence.
    expect(rt('# a # b\n')).toBe('# a # b\n')
  })
})
