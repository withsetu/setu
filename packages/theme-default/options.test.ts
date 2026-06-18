import { describe, it, expect } from 'vitest'
import { themeOptions, optionsToCss } from './options'

describe('theme-default options manifest', () => {
  it('declares the five knobs by key', () => {
    expect(themeOptions.map((o) => o.key)).toEqual(['accent', 'font', 'width', 'textSize', 'corners'])
  })
  it('every select knob has choices including its default', () => {
    for (const opt of themeOptions) {
      if (opt.type === 'select') {
        const values = (opt.choices ?? []).map((c) => c.value)
        expect(values).toContain(opt.default)
      }
    }
  })
  it('font knob drives both --font-body and --font-heading', () => {
    const font = themeOptions.find((o) => o.key === 'font')
    expect(font?.token).toEqual(['--font-body', '--font-heading'])
  })
})

describe('optionsToCss', () => {
  it('wraps declarations in a :root block', () => {
    expect(optionsToCss({})).toMatch(/^:root:root\s*\{[\s\S]*\}$/)
  })
  it('applies a chosen accent color', () => {
    expect(optionsToCss({ accent: '#0ea5e9' })).toContain('--accent: #0ea5e9;')
  })
  it('applies a chosen width to --measure-page', () => {
    expect(optionsToCss({ width: 'wide' })).toContain('--measure-page: 78rem;')
  })
  it('writes BOTH font tokens for a font choice', () => {
    const css = optionsToCss({ font: 'inter' })
    expect(css).toMatch(/--font-body:[^;]+;/)
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
  it('falls back to the default for an unknown select value', () => {
    expect(optionsToCss({ width: 'gigantic' })).toContain('--measure-page: 64rem;')
  })
  it('falls back to the default for an invalid color', () => {
    expect(optionsToCss({ accent: 'not-a-color' })).toContain('--accent: #4f46e5;')
  })
  it('all-default values reproduce the current token set', () => {
    const css = optionsToCss({})
    expect(css).toContain('--accent: #4f46e5;')
    expect(css).toContain('--measure-page: 64rem;')
    expect(css).toContain('--text-base: 1.0625rem;')
    expect(css).toContain('--radius-base: 10px;')
    expect(css).toMatch(/--font-body:[^;]+;/)
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
})
