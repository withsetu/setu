import { describe, it, expect } from 'vitest'
import {
  columnsTemplate,
  columnsRenderAttrs
} from '../src/columns/columns-classes'

describe('columnsTemplate (#181)', () => {
  it('maps each layout preset to fr tracks', () => {
    expect(columnsTemplate('50-50')).toBe('50fr 50fr')
    expect(columnsTemplate('33-67')).toBe('33fr 67fr')
    expect(columnsTemplate('67-33')).toBe('67fr 33fr')
    expect(columnsTemplate('33-33-33')).toBe('33fr 33fr 33fr')
    expect(columnsTemplate('25-25-25-25')).toBe('25fr 25fr 25fr 25fr')
  })

  it('degrades unknown or malicious values to an even two-column split', () => {
    expect(columnsTemplate(undefined)).toBe('1fr 1fr')
    expect(columnsTemplate('')).toBe('1fr 1fr')
    expect(columnsTemplate('banana')).toBe('1fr 1fr')
    expect(columnsTemplate('50-50; } body { display: none')).toBe('1fr 1fr')
    expect(columnsTemplate(42)).toBe('1fr 1fr')
    // 5+ segments are outside the 2–4 column contract.
    expect(columnsTemplate('20-20-20-20-20')).toBe('1fr 1fr')
  })
})

describe('columnsRenderAttrs (#181)', () => {
  it('derives classes and the inline grid-template local', () => {
    const { className, style } = columnsRenderAttrs({
      layout: '33-67',
      gap: 'lg',
      stackOnMobile: true
    })
    expect(className).toBe('blk-columns gap-lg stack')
    expect(style).toBe('--blk-columns-template: 33fr 67fr')
  })

  it('defaults: gap md, stacking on', () => {
    const { className } = columnsRenderAttrs({})
    expect(className).toBe('blk-columns gap-md stack')
  })

  it('stackOnMobile=false drops the stack class; bad gap falls back to md', () => {
    const { className } = columnsRenderAttrs({
      gap: 'huge',
      stackOnMobile: false
    })
    expect(className).toBe('blk-columns gap-md')
  })
})
