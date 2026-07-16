import { describe, it, expect } from 'vitest'
import { galleryBlock } from '../src/blocks/standard/gallery'
import { resolveControls } from '../src/blocks/resolve-controls'
import { markdocAttributesFor } from '../src/blocks/markdoc-attributes'

describe('gallery contract', () => {
  it('registers in the media group with slash-menu keywords', () => {
    const ed = galleryBlock.contract.editor!
    expect(ed.group).toBe('media')
    expect(ed.keywords).toEqual(
      expect.arrayContaining(['images', 'grid', 'photos', 'masonry'])
    )
  })

  it('maps images to an Array markdoc attribute with an empty default', () => {
    const attrs = markdocAttributesFor(galleryBlock.contract.props)
    expect(attrs.images).toEqual({ type: 'Array', default: [] })
    expect(attrs.columns).toEqual({ type: 'Number', default: 3 })
    expect(attrs.gap).toEqual({
      type: 'String',
      matches: ['none', 'small', 'medium', 'large'],
      default: 'medium'
    })
    // #533: masonry layout for vertical/mixed-aspect images
    expect(attrs.layout).toEqual({
      type: 'String',
      matches: ['grid', 'masonry'],
      default: 'grid'
    })
    // #553: lightbox (WP "Expand on click") — default ON
    expect(attrs.lightbox).toEqual({ type: 'Boolean', default: true })
  })

  it('resolves typed controls: media-list, slider, select, switch, align', () => {
    const out = resolveControls(
      galleryBlock.contract.props,
      galleryBlock.contract.editor!.controls
    )
    const control = (name: string) => out.find((c) => c.name === name)!.control
    expect(control('images')).toBe('media-list')
    expect(control('layout')).toBe('select')
    expect(control('columns')).toBe('slider')
    expect(control('gap')).toBe('select')
    expect(control('captions')).toBe('switch')
    expect(control('lightbox')).toBe('switch')
    expect(control('width')).toBe('align')
  })

  it('declares Content/Layout/Style groups', () => {
    const labels = galleryBlock.contract.editor!.groups!.map((g) => g.label)
    expect(labels).toEqual(['Content', 'Layout', 'Style'])
  })
})
