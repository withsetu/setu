import { describe, it, expect } from 'vitest'
import { tableToGfm } from '../src/markdoc/table-gfm'
import type { TiptapNode } from '../src/markdoc/types'

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
