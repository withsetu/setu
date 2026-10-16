import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TYPEFACE,
  FONT_PACKAGES,
  MONO_FONT_PACKAGE,
  fontPackagesFor
} from './fonts'
import { themeOptions } from './options'

const typeface = themeOptions.find((o) => o.role === 'typeface')!

describe('fontPackagesFor', () => {
  it('bundles the selected family and the mono face', () => {
    expect(fontPackagesFor('literata')).toEqual([
      '@fontsource-variable/literata',
      MONO_FONT_PACKAGE
    ])
  })

  it('falls back to the default family for an unknown or missing choice', () => {
    const fallback = [FONT_PACKAGES[DEFAULT_TYPEFACE], MONO_FONT_PACKAGE]
    expect(fontPackagesFor(undefined)).toEqual(fallback)
    expect(fontPackagesFor('comic-sans')).toEqual(fallback)
  })
})

describe('the font map stays in step with the typeface option', () => {
  it('maps every typeface choice to a package, and nothing else', () => {
    const choices = (typeface.choices ?? []).map((c) => c.value).sort()
    expect(Object.keys(FONT_PACKAGES).sort()).toEqual(choices)
  })

  it("agrees with the option's default", () => {
    expect(typeface.default).toBe(DEFAULT_TYPEFACE)
  })

  it('names each family in the CSS stack its choice writes', () => {
    // A fontsource package's @font-face family is its title-cased name + " Variable"; if the
    // stack named a different family the bundled face would never be used.
    const family = (pkg: string) =>
      pkg
        .replace('@fontsource-variable/', '')
        .split('-')
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(' ')
    for (const c of typeface.choices ?? [])
      expect(c.tokenValue).toContain(
        `'${family(FONT_PACKAGES[c.value]!)} Variable'`
      )
  })
})
