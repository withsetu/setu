import { describe, it, expect } from 'vitest'
import { optionsToCss, resolveThemeTokens, parseThemeOptions } from '@setu/core'
import { themeOptions } from './options'

describe('resolveThemeTokens', () => {
  it('returns the manifest defaults for empty values', () => {
    const t = resolveThemeTokens(themeOptions, {})
    expect(t['--accent']).toBe('#4f46e5')
    expect(t['--measure-page']).toBe('64rem')
    expect(t['--radius-base']).toBe('10px')
    expect(t['--font-body']).toBe(t['--font-heading'])
  })
  it('applies a valid color and falls back on an invalid one', () => {
    expect(
      resolveThemeTokens(themeOptions, { accent: '#0ea5e9' })['--accent']
    ).toBe('#0ea5e9')
    expect(
      resolveThemeTokens(themeOptions, { accent: 'not-a-color' })['--accent']
    ).toBe('#4f46e5')
  })
  it('maps a select choice to its token value and both font tokens for fonts', () => {
    expect(
      resolveThemeTokens(themeOptions, { width: 'wide' })['--measure-page']
    ).toBe('78rem')
    const fonts = resolveThemeTokens(themeOptions, { font: 'inter' })
    expect(fonts['--font-body']).toBe(fonts['--font-heading'])
    expect(fonts['--font-body']).toContain('Inter')
  })
  it('falls back to the default choice for an unknown select value', () => {
    expect(
      resolveThemeTokens(themeOptions, { width: 'gigantic' })['--measure-page']
    ).toBe('64rem')
  })
  it('agrees with optionsToCss (same source of truth)', () => {
    const values = { accent: '#0ea5e9', font: 'lora', corners: 'sharp' }
    for (const [token, value] of Object.entries(
      resolveThemeTokens(themeOptions, values)
    )) {
      expect(optionsToCss(themeOptions, values)).toContain(
        `${token}: ${value};`
      )
    }
  })
})

describe('theme-default options manifest', () => {
  it('declares the five knobs by key', () => {
    expect(themeOptions.map((o) => o.key)).toEqual([
      'accent',
      'font',
      'width',
      'textSize',
      'corners'
    ])
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
    expect(optionsToCss(themeOptions, {})).toMatch(/^:root:root\s*\{[\s\S]*\}$/)
  })
  it('applies a chosen accent color', () => {
    expect(optionsToCss(themeOptions, { accent: '#0ea5e9' })).toContain(
      '--accent: #0ea5e9;'
    )
  })
  it('applies a chosen width to --measure-page', () => {
    expect(optionsToCss(themeOptions, { width: 'wide' })).toContain(
      '--measure-page: 78rem;'
    )
  })
  it('writes BOTH font tokens for a font choice', () => {
    const css = optionsToCss(themeOptions, { font: 'inter' })
    expect(css).toMatch(/--font-body:[^;]+;/)
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
  it('falls back to the default for an unknown select value', () => {
    expect(optionsToCss(themeOptions, { width: 'gigantic' })).toContain(
      '--measure-page: 64rem;'
    )
  })
  it('falls back to the default for an invalid color', () => {
    expect(optionsToCss(themeOptions, { accent: 'not-a-color' })).toContain(
      '--accent: #4f46e5;'
    )
  })
  it('all-default values reproduce the current token set', () => {
    const css = optionsToCss(themeOptions, {})
    expect(css).toContain('--accent: #4f46e5;')
    expect(css).toContain('--measure-page: 64rem;')
    expect(css).toContain('--text-base: 1.0625rem;')
    expect(css).toContain('--radius-base: 10px;')
    expect(css).toMatch(/--font-body:[^;]+;/)
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
})

// #1076: a theme's declaration is now DATA that core validates before the Customizer renders it.
// The shipped theme must pass its own gate — otherwise Setu's own theme would be rejected by the
// check that protects users from a malformed third-party one.
describe('the shipped declaration is a valid theme-options declaration', () => {
  it('passes core\u2019s parse gate', () => {
    expect(() => parseThemeOptions(themeOptions)).not.toThrow()
  })
})
