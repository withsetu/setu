import { describe, it, expect } from 'vitest'
import { tableToGfm } from '../src/markdoc/table-gfm'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc, TiptapNode } from '../src/markdoc/types'

const cell = (
  text: string,
  align: string | null = null,
  type = 'tableCell'
): TiptapNode => ({
  type,
  attrs: { align },
  content: [
    { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
  ]
})
const headerCell = (text: string, align: string | null = null) =>
  cell(text, align, 'tableHeader')
const row = (...cells: TiptapNode[]): TiptapNode => ({
  type: 'tableRow',
  content: cells
})
const table = (...rows: TiptapNode[]): TiptapNode => ({
  type: 'table',
  content: rows
})

describe('tableToGfm', () => {
  it('serializes a header + body with no alignment', () => {
    const md = tableToGfm(
      table(
        row(headerCell('Name'), headerCell('Role')),
        row(cell('Ada'), cell('Eng'))
      )
    )
    expect(md).toBe('| Name | Role |\n| --- | --- |\n| Ada | Eng |')
  })

  it('emits per-column alignment from the header row', () => {
    const md = tableToGfm(
      table(
        row(
          headerCell('L', 'left'),
          headerCell('C', 'center'),
          headerCell('R', 'right')
        ),
        row(cell('a'), cell('b'), cell('c'))
      )
    )
    expect(md).toBe('| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |')
  })

  it('escapes a pipe in cell text', () => {
    const md = tableToGfm(table(row(headerCell('a')), row(cell('x | y'))))
    expect(md).toBe('| a |\n| --- |\n| x \\| y |')
  })

  it('renders inline marks inside a cell', () => {
    const boldCell: TiptapNode = {
      type: 'tableCell',
      attrs: { align: null },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }]
        }
      ]
    }
    const md = tableToGfm(table(row(headerCell('h')), row(boldCell)))
    expect(md).toBe('| h |\n| --- |\n| **b** |')
  })

  it('renders an empty cell as blank', () => {
    const md = tableToGfm(
      table(row(headerCell('a'), headerCell('b')), row(cell(''), cell('c')))
    )
    expect(md).toBe('| a | b |\n| --- | --- |\n|  | c |')
  })
})

/* --------------------------------------------------------------------------- *
 * #752 — a multi-block table cell must not silently drop everything but its
 * first paragraph. `@tiptap/extension-table` declares a cell as `block+`, so a
 * second paragraph, a list, an image or a code block is schema-valid and reachable
 * from the editor (press Enter, slash-insert, paste). This is the #658 defect in
 * the OTHER string-only serializer: the fix folds EVERY block child through the
 * same per-type serializers, flattening the inline-only cell's line breaks to <br>.
 * --------------------------------------------------------------------------- */

const P = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : []
})
const multiCell = (...content: TiptapNode[]): TiptapNode => ({
  type: 'tableCell',
  attrs: { align: null },
  content
})
const bulletList = (...items: string[]): TiptapNode => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [P(t)] }))
})
const orderedList = (...items: string[]): TiptapNode => ({
  type: 'orderedList',
  content: items.map((t) => ({ type: 'listItem', content: [P(t)] }))
})
const taskList = (...items: [string, boolean][]): TiptapNode => ({
  type: 'taskList',
  content: items.map(([t, checked]) => ({
    type: 'taskItem',
    attrs: { checked },
    content: [P(t)]
  }))
})
const imageBlock = (src: string, alt = ''): TiptapNode => ({
  type: 'imageBlock',
  attrs: { mdAttrs: { src, alt } }
})
const codeBlock = (code: string, language = ''): TiptapNode => ({
  type: 'codeBlock',
  attrs: { language },
  content: [{ type: 'text', text: code }]
})
/** The body-text of the single cell in `content`'s serialized table. */
const cellBody = (content: TiptapNode[]): string =>
  tableToGfm(table(row(headerCell('h')), row(multiCell(...content))))
    .split('\n')[2]!
    .replace(/^\| | \|$/g, '')

describe('tableToGfm — multi-block cells (#752)', () => {
  it('keeps every paragraph, joined by <br>', () => {
    expect(cellBody([P('one'), P('two'), P('three')])).toBe(
      'one<br>two<br>three'
    )
  })

  it('keeps a list after a paragraph (markers preserved as text)', () => {
    expect(cellBody([P('intro'), bulletList('a', 'b')])).toBe(
      'intro<br>- a<br>- b'
    )
  })

  it('renders a block image as an inline image', () => {
    expect(cellBody([imageBlock('/a.png', 'cat')])).toBe('![cat](/a.png)')
  })

  it('renders a code block as inline code spans, one line per <br>', () => {
    expect(cellBody([codeBlock('x = 1\ny = 2', 'js')])).toBe(
      '`x = 1`<br>`y = 2`'
    )
  })

  it('unwraps a callout, keeping its body', () => {
    expect(
      cellBody([
        { type: 'callout', attrs: { mdAttrs: {} }, content: [P('note')] }
      ])
    ).toBe('note')
  })

  it('escapes a pipe across every folded block', () => {
    expect(cellBody([P('a | b'), P('c | d')])).toBe('a \\| b<br>c \\| d')
  })

  it('leaves a single-paragraph cell byte-identical to the old serializer', () => {
    // The original `find(first paragraph)` path — guarded so the fold never
    // rewrites existing single-paragraph tables.
    expect(cellBody([P('plain')])).toBe('plain')
    expect(cellBody([P('')])).toBe('')
  })
})

/** The Markdoc source of a doc holding one table row with `content` as its single
 *  body cell. */
const cellDocSource = (content: TiptapNode[]): string => {
  const doc: TiptapDoc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          row(headerCell('h')),
          { type: 'tableRow', content: [multiCell(...content)] }
        ]
      }
    ]
  }
  return tiptapToMarkdoc(doc)
}
const rt = (s: string): string => tiptapToMarkdoc(markdocToTiptap(s))

describe('multi-block cell round-trip (#752)', () => {
  const cases: Record<string, TiptapNode[]> = {
    'multiple paragraphs': [P('one'), P('two')],
    'a list': [P('lead'), bulletList('a', 'b')],
    'a block image': [imageBlock('/a.png', 'cat')],
    'a code block': [codeBlock('x = 1\ny = 2', 'js')],
    'a code block with backticks': [codeBlock('a `b` c')],
    'a callout': [
      { type: 'callout', attrs: { mdAttrs: {} }, content: [P('note')] }
    ],
    'a blockquote': [{ type: 'blockquote', content: [P('quoted')] }],
    'a horizontal rule between paragraphs': [
      P('a'),
      { type: 'horizontalRule' },
      P('b')
    ],
    everything: [
      P('lead'),
      bulletList('x'),
      imageBlock('/i.png'),
      codeBlock('code')
    ]
  }

  for (const [name, content] of Object.entries(cases)) {
    it(`reaches a byte-stable fixed point with ${name}`, () => {
      const s1 = cellDocSource(content)
      const s2 = rt(s1)
      const s3 = rt(s2)
      // Once the block tree is flattened to the cell's inline form (read 1), the
      // serialization is stable: s2 === s3, no drift.
      expect(s3).toBe(s2)
    })
  }

  it('drops nothing from a multi-paragraph cell (the verified loss)', () => {
    const s1 = cellDocSource([P('one'), P('two')])
    expect(s1).toContain('one')
    expect(s1).toContain('two')
    // The old serializer produced "| one |" — 'two' gone.
    expect(s1).toContain('one<br>two')
  })

  it('drops nothing from an image-only cell (the verified loss)', () => {
    const s1 = cellDocSource([imageBlock('/a.png', 'cat')])
    expect(s1).toContain('![cat](/a.png)')
  })

  /* #772 — the fold converged only after a SECOND save. `serializeBlock` emitted a
   * folded block's STRUCTURAL markers raw (`- a`, `1. b`, `- [x] c`, `---`), the reader
   * re-read them as literal cell text — a GFM cell is inline-only, so they are text —
   * and the next save escaped them. One save produced a file that a no-op second save
   * still rewrote: churn in `git blame` for no content change. Both halves are fixed —
   * a cell has no block start ANYWHERE (`<br>` is HTML, not a newline), so the writer
   * stops adding positional escapes inside one; and a folded list writes its markers as
   * the literal text they will be read as. */
  describe('the fold converges on the FIRST write (#772)', () => {
    const firstWriteStable = (content: TiptapNode[]): void => {
      const s1 = cellDocSource(content)
      expect(rt(s1)).toBe(s1)
    }
    it('a bullet list after a paragraph', () =>
      firstWriteStable([P('intro'), bulletList('alpha', 'beta')]))
    it('an ordered list', () =>
      firstWriteStable([P('intro'), orderedList('one', 'two')]))
    it('a task list', () =>
      firstWriteStable([taskList(['done', true], ['todo', false])]))
    it('two adjacent bullet lists (alternating markers)', () =>
      firstWriteStable([bulletList('a'), bulletList('b')]))
    it('a horizontal rule between paragraphs', () =>
      firstWriteStable([P('a'), { type: 'horizontalRule' }, P('b')]))
    it('a blockquote after a paragraph', () =>
      firstWriteStable([
        P('a'),
        { type: 'blockquote', content: [P('quoted')] }
      ]))
    it('a heading', () =>
      firstWriteStable([
        P('a'),
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title' }]
        }
      ]))
  })

  /* The other half of #772: a cell that is ALREADY in Git must not gain backslashes on
   * an unrelated save. These are the exact shapes the old writer produced. */
  describe('an already-folded cell in Git is never re-escaped (#772)', () => {
    const unchanged = (cell: string): void => {
      const src = `| h |\n| --- |\n| ${cell} |\n`
      expect(rt(src)).toBe(src)
    }
    it('a bullet marker after a break', () => unchanged('intro<br>- alpha'))
    it('an ordinal marker after a break', () => unchanged('1. one<br>1. two'))
    it('a thematic-break run after a break', () => unchanged('a<br>---<br>b'))
    it('a heading marker after a break', () => unchanged('a<br># Title'))
    it('a blockquote marker after a break', () => unchanged('a<br>> quoted'))
    // The ONE shape that cannot be kept byte-identical, and why. A `[` in a cell opens a
    // link (`| [x](y) |` really is one), so a literal `[x]` MUST carry its escape — the
    // old fold wrote the task marker as bare structure, which was never a stable spelling
    // of literal text. Cells folded by the previous writer are corrected exactly once,
    // on their next save, and are stable from then on.
    it('normalises a folded task marker to its literal spelling, once', () => {
      const src = '| h |\n| --- |\n| - [x] done |\n'
      const r1 = rt(src)
      expect(r1).toBe('| h |\n| --- |\n| - \\[x\\] done |\n')
      expect(rt(r1)).toBe(r1)
    })
  })

  it('heals a literal <br> typed in a cell into a hard break, byte-stably', () => {
    const src = '| h |\n| --- |\n| one<br>two |\n'
    const r1 = tiptapToMarkdoc(markdocToTiptap(src))
    const r2 = tiptapToMarkdoc(markdocToTiptap(r1))
    expect(r1).toBe('| h |\n| --- |\n| one<br>two |\n')
    expect(r2).toBe(r1)
  })
})
