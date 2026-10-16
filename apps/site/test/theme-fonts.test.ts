import { describe, it, expect, vi } from 'vitest'
import { themeFontImports } from '../integrations/theme-fonts.mjs'

/**
 * #1075: font loading used to be gated on the theme's package NAME —
 * `if (activeTheme === '@setu/theme-default')` — so any other theme silently got no fonts at
 * all. The site still built and rendered, just wrong, with nothing saying why.
 *
 * The failure mode is silence, so these assert on what is REPORTED as much as on what is
 * returned: "this theme ships no fonts" and "this theme's fonts are broken" must not collapse
 * into the same quiet empty string.
 */

/** A declaration whose typeface option is NOT keyed `font` — the #1295 case. */
const DECLARATION = [
  {
    key: 'accent',
    label: 'Accent',
    type: 'color',
    token: '--accent',
    default: '#000000'
  },
  {
    key: 'typeface',
    label: 'Typeface',
    type: 'select',
    role: 'typeface',
    token: '--font-body',
    default: 'grotesk',
    choices: [
      { value: 'grotesk', label: 'Grotesk', tokenValue: 'Grotesk' },
      { value: 'serif', label: 'Serif', tokenValue: 'Fraunces' }
    ]
  }
]

const FONTS_MODULE = {
  fontPackagesFor: (choice?: string) =>
    choice === 'serif'
      ? ['@fontsource-variable/fraunces', '@fontsource-variable/jetbrains-mono']
      : ['@fontsource-variable/grotesk', '@fontsource-variable/jetbrains-mono']
}

/** Node's shape for "the package has no such export". */
const noSuchExport = (spec: string) => {
  const err = new Error(
    `Package subpath './fonts' is not defined by "exports" in ${spec}`
  ) as Error & { code: string }
  err.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  return err
}

/** Serves the theme's `./options` and `./fonts` subpaths; `options` overrides the declaration. */
const themeModules =
  (options: unknown = { themeOptions: DECLARATION }) =>
  async (spec: string) =>
    spec.endsWith('/options') ? options : FONTS_MODULE

const deps = (over: Partial<Parameters<typeof themeFontImports>[2]> = {}) => ({
  importModule: vi.fn(themeModules()),
  resolvePackageFile: vi.fn(
    (pkg: string) => `/themes/acme/node_modules/${pkg}/index.css`
  ),
  logger: { info: vi.fn(), warn: vi.fn() },
  ...over
})

describe('themeFontImports', () => {
  it('loads fonts for ANY theme, not just the built-in one', async () => {
    const d = deps()
    const out = await themeFontImports(
      '@acme/theme-brochure',
      {
        typeface: 'serif'
      },
      d
    )

    expect(d.importModule).toHaveBeenCalledWith('@acme/theme-brochure/fonts')
    expect(out).toContain('@fontsource-variable/fraunces')
    expect(out).toContain('@fontsource-variable/jetbrains-mono')
    // Resolved from the THEME's context — a bare specifier has no meaning inside a virtual module.
    expect(d.resolvePackageFile).toHaveBeenCalledWith(
      '@fontsource-variable/fraunces',
      '@acme/theme-brochure'
    )
  })

  it('bundles only the selected family, not everything the theme offers', async () => {
    const out = await themeFontImports(
      '@acme/theme-brochure',
      { typeface: 'grotesk' },
      deps()
    )
    expect(out).toContain('grotesk')
    expect(out).not.toContain('fraunces')
  })

  it('a theme with no ./fonts export is fine — and SAYS so rather than going quiet', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) => {
        if (spec.endsWith('/options')) return { themeOptions: DECLARATION }
        throw noSuchExport(spec)
      })
    })
    const out = await themeFontImports('@acme/theme-plain', {}, d)

    expect(out).toBe('')
    // The whole point: no fonts must be an announced outcome, not an invisible one.
    const info = d.logger.info as ReturnType<typeof vi.fn>
    expect(info).toHaveBeenCalledOnce()
    expect(String(info.mock.calls[0])).toMatch(/no fonts|ships no/i)
  })

  it('a BROKEN fonts module fails loudly — it is not the same as shipping none', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) => {
        if (spec.endsWith('/options')) return { themeOptions: DECLARATION }
        throw new Error('Cannot find module @fontsource-variable/typo')
      })
    })
    await expect(themeFontImports('@acme/theme-broken', {}, d)).rejects.toThrow(
      /typo/
    )
    expect(d.logger.info).not.toHaveBeenCalled()
  })

  it('a fonts module missing its export is broken, not empty', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) =>
        spec.endsWith('/options') ? { themeOptions: DECLARATION } : {}
      )
    })
    await expect(themeFontImports('@acme/theme-odd', {}, d)).rejects.toThrow(
      /fontPackagesFor/
    )
  })

  // --- #1295: the selected family is found by the option's ROLE, never by the key `font` ---

  it('bundles the family selected under a typeface option that is NOT keyed `font`', async () => {
    const d = deps()
    const out = await themeFontImports(
      '@acme/theme-brochure',
      { typeface: 'serif' },
      d
    )
    expect(d.importModule).toHaveBeenCalledWith('@acme/theme-brochure/options')
    expect(out).toContain('fraunces')
    expect(out).not.toContain('grotesk')
  })

  it('a value stored under `font` does not select the family for such a theme', async () => {
    const out = await themeFontImports(
      '@acme/theme-brochure',
      { font: 'serif' },
      deps()
    )
    expect(out).toContain('grotesk')
    expect(out).not.toContain('fraunces')
  })

  it('a declaration with NO typeface role selects nothing — and SAYS so', async () => {
    const d = deps({
      importModule: vi.fn(themeModules({ themeOptions: [DECLARATION[0]] }))
    })
    const out = await themeFontImports(
      '@acme/theme-static',
      { font: 'serif', typeface: 'serif' },
      d
    )
    // Whatever was stored, no family is SELECTED: the theme's fonts module gets no choice.
    expect(out).not.toContain('fraunces')
    const info = d.logger.info as ReturnType<typeof vi.fn>
    expect(info).toHaveBeenCalledOnce()
    expect(String(info.mock.calls[0])).toMatch(/no typeface option/i)
  })

  it('a theme with no ./options export is announced the same way, not an error', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) => {
        if (spec.endsWith('/options')) throw noSuchExport(spec)
        return FONTS_MODULE
      })
    })
    await themeFontImports('@acme/theme-bare', {}, d)
    expect(
      String((d.logger.info as ReturnType<typeof vi.fn>).mock.calls[0])
    ).toMatch(/no typeface option/i)
  })

  it('an invalid declaration fails the build with the parse error, not a silent default', async () => {
    const two = [DECLARATION[1], { ...DECLARATION[1], key: 'headings' }]
    const d = deps({ importModule: vi.fn(themeModules({ themeOptions: two })) })
    await expect(themeFontImports('@acme/theme-twice', {}, d)).rejects.toThrow(
      /more than one option declares role "typeface"/
    )
  })

  it('a BROKEN options module fails loudly', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) => {
        if (spec.endsWith('/options')) throw new Error('SyntaxError in options')
        return FONTS_MODULE
      })
    })
    await expect(themeFontImports('@acme/theme-broken', {}, d)).rejects.toThrow(
      /SyntaxError/
    )
  })
})
