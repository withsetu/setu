import { describe, it, expect } from 'vitest'
import {
  parseThemeOptions,
  selectedTypeface,
  typefaceOption,
  type ThemeOption
} from '../../src/theme/options'

/**
 * #1295: the site build used to find the typeface option by reading the key `font`, which is
 * theme-default's name for it. A theme that called it `typeface` got its default family bundled
 * while the CSS override named the chosen one. The option is now found by its declared ROLE.
 */
const typeface = (over: Record<string, unknown> = {}) => ({
  key: 'typeface',
  label: 'Typeface',
  type: 'select',
  token: '--font-body',
  default: 'sans',
  role: 'typeface',
  choices: [
    { value: 'sans', label: 'Sans', tokenValue: 'system-ui' },
    { value: 'serif', label: 'Serif', tokenValue: 'Georgia, serif' }
  ],
  ...over
})

const accent = {
  key: 'accent',
  label: 'Accent',
  type: 'color',
  token: '--accent',
  default: '#000000'
}

describe('parseThemeOptions: the typeface role', () => {
  it('accepts role "typeface" and keeps it on the parsed option', () => {
    const [, opt] = parseThemeOptions([accent, typeface()])
    expect(opt?.role).toBe('typeface')
  })

  it('accepts a declaration with no role at all', () => {
    expect(parseThemeOptions([accent])).toHaveLength(1)
  })

  it('rejects an unknown role', () => {
    expect(() => parseThemeOptions([typeface({ role: 'palette' })])).toThrow(
      /invalid theme options declaration/
    )
  })

  it('rejects more than one typeface role, naming the offending keys', () => {
    expect(() =>
      parseThemeOptions([typeface(), typeface({ key: 'headingFace' })])
    ).toThrow(/more than one.*typeface.*typeface.*headingFace/)
  })

  it('rejects a typeface role on a colour option — a family is chosen from a list', () => {
    expect(() => parseThemeOptions([{ ...accent, role: 'typeface' }])).toThrow(
      /typeface.*select/
    )
  })
})

describe('typefaceOption / selectedTypeface', () => {
  const options: ThemeOption[] = parseThemeOptions([accent, typeface()])

  it('finds the option by role, whatever its key is', () => {
    expect(typefaceOption(options)?.key).toBe('typeface')
  })

  it('returns undefined when the theme declares no typeface role', () => {
    expect(typefaceOption(parseThemeOptions([accent]))).toBeUndefined()
    expect(selectedTypeface(parseThemeOptions([accent]), {})).toBeUndefined()
  })

  it('a value stored under the key `font` is NOT read for a theme that names it otherwise', () => {
    expect(selectedTypeface(options, { font: 'serif' })).toBe('sans')
  })

  it('reads the chosen value under the role option’s own key', () => {
    expect(selectedTypeface(options, { typeface: 'serif' })).toBe('serif')
  })

  it('falls back to the declared default for a missing or undeclared choice', () => {
    expect(selectedTypeface(options, {})).toBe('sans')
    expect(selectedTypeface(options, { typeface: 'comic-sans' })).toBe('sans')
  })
})
