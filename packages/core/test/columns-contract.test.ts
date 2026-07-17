import { describe, it, expect } from 'vitest'
import { columnsBlock, columnBlock } from '../src/blocks/standard/columns'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { resolveControls } from '../src/blocks/resolve-controls'
import { markdocAttributesFor } from '../src/blocks/markdoc-attributes'

describe('columns contract (#181)', () => {
  it('ships in STANDARD_BLOCKS with its structural column child', () => {
    const tags = STANDARD_BLOCKS.map((b) => b.tag)
    expect(tags).toContain('columns')
    expect(tags).toContain('column')
  })

  it('declares layout/gap as selects and stackOnMobile as a switch', () => {
    const out = resolveControls(
      columnsBlock.contract.props,
      columnsBlock.contract.editor!.controls
    )
    const by = (n: string) => out.find((c) => c.name === n)!
    expect(by('layout').control).toBe('select')
    expect(by('layout').options).toEqual([
      '50-50',
      '33-67',
      '67-33',
      '33-33-33',
      '25-25-25-25'
    ])
    expect(by('gap').control).toBe('select')
    expect(by('gap').options).toEqual(['none', 'sm', 'md', 'lg'])
    expect(by('stackOnMobile').control).toBe('switch')
    expect(by('stackOnMobile').default).toBe(true)
  })

  it('slots into the layout slash-menu group with the agreed keywords', () => {
    const editor = columnsBlock.contract.editor!
    expect(editor.group).toBe('layout')
    expect(editor.keywords).toEqual(
      expect.arrayContaining(['grid', 'row', 'split', 'multi-column'])
    )
    expect(editor.hidden).toBeUndefined()
  })

  it('hides the structural column block from the slash menu', () => {
    expect(columnBlock.contract.editor!.hidden).toBe(true)
  })

  it('maps to Markdoc attribute descriptors (site codegen path)', () => {
    const attrs = markdocAttributesFor(columnsBlock.contract.props)
    expect(attrs.layout).toEqual({
      type: 'String',
      matches: ['50-50', '33-67', '67-33', '33-33-33', '25-25-25-25'],
      default: '50-50'
    })
    expect(attrs.stackOnMobile).toEqual({ type: 'Boolean', default: true })
    // column has no props — empty descriptor set, not a throw.
    expect(markdocAttributesFor(columnBlock.contract.props)).toEqual({})
  })
})
