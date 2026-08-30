import { describe, it, expect } from 'vitest'
import {
  optionsToCss,
  parseThemeOptions,
  resolveThemeTokens,
  type ThemeOption
} from '../../src/theme/options'

/**
 * #1076: the option model moves to core so it can be applied to ANY theme's declaration.
 *
 * The Customizer used to `import { themeOptions, resolveThemeTokens } from
 * '@setu/theme-default/options'` — resolved when the ADMIN is built, so only one theme could ever
 * be customised. The logic was never theme-specific; it only ever read the declaration. Here it
 * takes the declaration as an argument, and the declaration becomes data a theme ships.
 *
 * That makes a theme declaration UNTRUSTED input: it arrives from an installed package and its
 * values are emitted into a `:root:root { … }` block and into inline preview styles. So these
 * cover hostile declarations, not just well-formed ones.
 */
const OPTIONS: ThemeOption[] = [
  {
    key: 'accent',
    label: 'Accent color',
    type: 'color',
    token: '--accent',
    default: '#3b5bdb'
  },
  {
    key: 'font',
    label: 'Typeface',
    type: 'select',
    token: ['--font-body', '--font-heading'],
    default: 'grotesk',
    choices: [
      { value: 'grotesk', label: 'Grotesk', tokenValue: "'Hanken Grotesk'" },
      { value: 'serif', label: 'Serif', tokenValue: "'Fraunces'" }
    ]
  }
]

describe('resolveThemeTokens', () => {
  it('resolves a chosen value for any theme, from its own declaration', () => {
    expect(
      resolveThemeTokens(OPTIONS, { accent: '#ff0000', font: 'serif' })
    ).toEqual({
      '--accent': '#ff0000',
      '--font-body': "'Fraunces'",
      '--font-heading': "'Fraunces'"
    })
  })

  it('falls back to the declared default when a value is missing or invalid', () => {
    const t = resolveThemeTokens(OPTIONS, { accent: 'not-a-color' })
    expect(t['--accent']).toBe('#3b5bdb')
    expect(t['--font-body']).toBe("'Hanken Grotesk'")
  })

  it('an empty declaration resolves to no tokens rather than throwing', () => {
    expect(resolveThemeTokens([], { accent: '#fff' })).toEqual({})
  })
})

describe('optionsToCss', () => {
  it('emits the doubled-specificity override the published stylesheet needs', () => {
    const css = optionsToCss(OPTIONS, { accent: '#0a0a0a' })
    expect(css).toMatch(/^:root:root \{/)
    expect(css).toContain('--accent: #0a0a0a;')
  })
})

// --- the untrusted-declaration half -----------------------------------------------------

describe('parseThemeOptions rejects a declaration that could inject CSS', () => {
  const hostile = (over: Record<string, unknown>) => [
    {
      key: 'x',
      label: 'X',
      type: 'color',
      token: '--x',
      default: '#fff',
      ...over
    }
  ]

  it('refuses a token name that closes the rule and opens another', () => {
    expect(() =>
      parseThemeOptions(
        hostile({ token: '--x: red; } body { display: none } .y' })
      )
    ).toThrow(/token/i)
  })

  it('refuses a token name that is not a custom property at all', () => {
    expect(() => parseThemeOptions(hostile({ token: 'color' }))).toThrow(
      /token/i
    )
  })

  it('refuses a default colour that is not a colour', () => {
    expect(() =>
      parseThemeOptions(hostile({ default: 'red; } html { display:none }' }))
    ).toThrow(/colou?r/i)
  })

  it('refuses a select choice whose tokenValue breaks out of the declaration', () => {
    expect(() =>
      parseThemeOptions([
        {
          key: 'f',
          label: 'F',
          type: 'select',
          token: '--f',
          default: 'a',
          choices: [
            { value: 'a', label: 'A', tokenValue: 'x; } evil { color: red' }
          ]
        }
      ])
    ).toThrow(/value/i)
  })

  it('accepts a well-formed declaration unchanged', () => {
    expect(parseThemeOptions(OPTIONS)).toEqual(OPTIONS)
  })

  it('refuses a declaration that is not an array at all', () => {
    expect(() => parseThemeOptions({ nope: true })).toThrow()
  })
})

describe('a hostile declaration cannot reach the emitted CSS', () => {
  it('is stopped at parse time, so optionsToCss never sees it', () => {
    // Belt and braces: even if a caller skipped parsing, a bad colour VALUE still falls back to
    // the default rather than being interpolated.
    const css = optionsToCss(OPTIONS, {
      accent: 'red; } html { display: none } .z {'
    })
    expect(css).not.toContain('display: none')
    expect(css).toContain('--accent: #3b5bdb;')
  })
})
