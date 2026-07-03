import { describe, it, expect } from 'vitest'
import { slashRenderModel, scoreBlock } from '../src/editor/slash-model'
import type { SlashBlock, SlashRow } from '../src/editor/slash-model'

const block = (over: Partial<SlashBlock>): SlashBlock => ({
  title: 'X',
  subtitle: '',
  icon: 'sparkle',
  group: 'text',
  keywords: [],
  run: () => {},
  ...over
})

const headings = block({
  title: 'Heading 2',
  group: 'text',
  keywords: ['heading', 'h2']
})
const image = block({
  title: 'Image',
  subtitle: 'Pick or upload',
  group: 'media',
  keywords: ['img', 'photo']
})
const hero = block({ title: 'Hero', group: 'marketing', keywords: ['banner'] })

const ALL = [headings, image, hero]

const items = (rows: SlashRow[]) =>
  rows.filter(
    (r): r is Extract<SlashRow, { kind: 'item' }> => r.kind === 'item'
  )

describe('slashRenderModel — empty query (grouped)', () => {
  const rows = slashRenderModel(ALL, '')

  it('emits a header per non-empty category in canonical order', () => {
    const heads = rows
      .filter((r) => r.kind === 'header')
      .map((r) => (r as { label: string }).label)
    expect(heads).toEqual(['Text', 'Media', 'Marketing']) // layout/embed/dynamic/widget omitted (empty)
  })

  it('assigns sequential itemIndex skipping headers', () => {
    expect(items(rows).map((r) => r.itemIndex)).toEqual([0, 1, 2])
  })

  it('orders items by category then original order', () => {
    expect(items(rows).map((r) => r.block.title)).toEqual([
      'Heading 2',
      'Image',
      'Hero'
    ])
  })
})

describe('slashRenderModel — typing (flat ranked)', () => {
  it('drops headers when a query is present', () => {
    const rows = slashRenderModel(ALL, 'h')
    expect(rows.every((r) => r.kind === 'item')).toBe(true)
  })

  it('ranks keyword-equals above subtitle-contains (/img)', () => {
    const subtitleHit = block({
      title: 'Zeta',
      subtitle: 'an img caption',
      group: 'text'
    })
    const rows = slashRenderModel([subtitleHit, image], 'img')
    expect(items(rows).map((r) => r.block.title)).toEqual(['Image', 'Zeta'])
  })

  it('ranks title-startsWith first (/he)', () => {
    const keywordHit = block({ title: 'Zeta', keywords: ['header'] })
    const rows = slashRenderModel([keywordHit, headings], 'he')
    expect(items(rows)[0]!.block.title).toBe('Heading 2')
  })

  it('returns no items when nothing matches', () => {
    expect(items(slashRenderModel(ALL, 'zzz'))).toHaveLength(0)
  })

  it('renumbers itemIndex sequentially in ranked mode', () => {
    const rows = slashRenderModel(ALL, 'a') // matches Image(photo? no)/Hero(banner)/Heading? — at least Hero via 'banner'? no 'a'
    expect(items(rows).map((r) => r.itemIndex)).toEqual(
      items(rows).map((_, i) => i)
    )
  })
})

describe('scoreBlock score table', () => {
  const b = block({
    title: 'callout',
    subtitle: 'a note block',
    keywords: ['note']
  })
  it('title equals = 100', () => expect(scoreBlock(b, 'callout')).toBe(100))
  it('title startsWith = 80', () => expect(scoreBlock(b, 'call')).toBe(80))
  it('keyword equals = 70', () => expect(scoreBlock(b, 'note')).toBe(70))
  it('title includes = 50', () => expect(scoreBlock(b, 'allou')).toBe(50))
  it('keyword includes = 40', () =>
    expect(scoreBlock(block({ title: 'x', keywords: ['note'] }), 'ot')).toBe(
      40
    ))
  it('subtitle includes = 20', () => expect(scoreBlock(b, 'block')).toBe(20))
  it('no match = 0', () => expect(scoreBlock(b, 'zzz')).toBe(0))
})
