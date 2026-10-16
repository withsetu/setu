import { describe, expect, it } from 'vitest'
import {
  FONT_PACKAGES,
  MONO_FONT_PACKAGE,
  DEFAULT_FONT,
  fontPackagesFor
} from './fonts'
import { parseThemeOptions, typefaceOption } from '@setu/core'
import { themeOptions } from './options'

describe('fontPackagesFor', () => {
  it('bundles the selected family + the mono font', () => {
    expect(fontPackagesFor('inter')).toEqual([
      FONT_PACKAGES.inter,
      MONO_FONT_PACKAGE
    ])
  })

  it('falls back to the default family for an unknown/missing choice', () => {
    const dflt = [FONT_PACKAGES[DEFAULT_FONT], MONO_FONT_PACKAGE]
    expect(fontPackagesFor(undefined)).toEqual(dflt)
    expect(fontPackagesFor('not-a-font')).toEqual(dflt)
  })
})

describe('font registry stays in sync with the theme option', () => {
  // Found by ROLE, exactly as the site build finds it (#1295) — not by this theme's key.
  const fontOption = typefaceOption(parseThemeOptions(themeOptions))!

  it('declares exactly one typeface-role option (the one the build bundles from)', () => {
    expect(fontOption?.key).toBe('font')
  })

  it('every `font` choice maps to a fontsource package (no drift)', () => {
    const missing = (fontOption.choices ?? [])
      .map((c) => c.value)
      .filter((v) => !(v in FONT_PACKAGES))
    expect(
      missing,
      `font choices missing a package: ${missing.join(', ')}`
    ).toEqual([])
  })

  it("the option's default matches DEFAULT_FONT", () => {
    expect(fontOption.default).toBe(DEFAULT_FONT)
  })
})
