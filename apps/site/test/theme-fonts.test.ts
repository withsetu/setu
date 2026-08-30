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

const deps = (over: Partial<Parameters<typeof themeFontImports>[2]> = {}) => ({
  importModule: vi.fn(async () => FONTS_MODULE),
  resolvePackageFile: vi.fn(
    (pkg: string) => `/themes/acme/node_modules/${pkg}/index.css`
  ),
  logger: { info: vi.fn(), warn: vi.fn() },
  ...over
})

describe('themeFontImports', () => {
  it('loads fonts for ANY theme, not just the built-in one', async () => {
    const d = deps()
    const out = await themeFontImports('@acme/theme-brochure', 'serif', d)

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
      'grotesk',
      deps()
    )
    expect(out).toContain('grotesk')
    expect(out).not.toContain('fraunces')
  })

  it('a theme with no ./fonts export is fine — and SAYS so rather than going quiet', async () => {
    const d = deps({
      importModule: vi.fn(async (spec: string) => {
        throw noSuchExport(spec)
      })
    })
    const out = await themeFontImports('@acme/theme-plain', 'serif', d)

    expect(out).toBe('')
    // The whole point: no fonts must be an announced outcome, not an invisible one.
    const info = d.logger.info as ReturnType<typeof vi.fn>
    expect(info).toHaveBeenCalledOnce()
    expect(String(info.mock.calls[0])).toMatch(/no fonts|ships no/i)
  })

  it('a BROKEN fonts module fails loudly — it is not the same as shipping none', async () => {
    const d = deps({
      importModule: vi.fn(async () => {
        throw new Error('Cannot find module @fontsource-variable/typo')
      })
    })
    await expect(
      themeFontImports('@acme/theme-broken', 'serif', d)
    ).rejects.toThrow(/typo/)
    expect(d.logger.info).not.toHaveBeenCalled()
  })

  it('a fonts module missing its export is broken, not empty', async () => {
    const d = deps({ importModule: vi.fn(async () => ({})) })
    await expect(
      themeFontImports('@acme/theme-odd', 'serif', d)
    ).rejects.toThrow(/fontPackagesFor/)
  })
})
