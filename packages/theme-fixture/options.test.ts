import { describe, expect, it } from 'vitest'
import { parseThemeOptions, resolveThemeTokens } from '@setu/core'
import { themeOptions } from './options'

describe('the fixture theme declaration', () => {
  it('passes the same validation the site build and the API run', () => {
    expect(parseThemeOptions(themeOptions)).toHaveLength(themeOptions.length)
  })

  it("shares no option key with theme-default's (accent/font/width/textSize/corners)", () => {
    const theirs = ['accent', 'font', 'width', 'textSize', 'corners']
    expect(
      themeOptions.map((o) => o.key).filter((k) => theirs.includes(k))
    ).toEqual([])
  })

  it('declares exactly one typeface by role, under a key other than `font`', () => {
    const typefaces = themeOptions.filter((o) => o.role === 'typeface')
    expect(typefaces.map((o) => o.key)).toEqual(['typeface'])
  })

  it('resolves defaults and a changed choice to the driven tokens', () => {
    const defaults = resolveThemeTokens(themeOptions, {})
    expect(defaults['--accent']).toBe('#b4532a')
    expect(defaults['--measure-post']).toBe('40rem')
    expect(defaults['--font-body']).toContain('Fraunces')

    const changed = resolveThemeTokens(themeOptions, {
      highlight: '#2f6f4f',
      typeface: 'bricolage',
      measure: 'roomy'
    })
    expect(changed['--accent']).toBe('#2f6f4f')
    expect(changed['--measure-post']).toBe('46rem')
    expect(changed['--font-heading']).toContain('Bricolage Grotesque')
  })
})
