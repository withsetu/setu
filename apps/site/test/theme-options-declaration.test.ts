import { describe, expect, it, vi } from 'vitest'
import { parseThemeOptions } from '@setu/core'
import { loadThemeDeclaration } from '../integrations/theme-options.mjs'

/**
 * #1294: the site build validates the active theme's option declaration with the same
 * `parseThemeOptions` the API runs, so a bad declaration fails `astro build` instead of shipping
 * broken CSS while the admin shows a 500 for the same theme.
 */
const GOOD = [
  {
    key: 'accent',
    label: 'Accent',
    type: 'color',
    token: '--accent',
    default: '#123456'
  }
]

const deps = (
  over: Partial<Parameters<typeof loadThemeDeclaration>[1]> = {}
) => ({
  importModule: vi.fn(async () => ({ themeOptions: GOOD })),
  parse: parseThemeOptions,
  logger: { info: vi.fn() },
  ...over
})

const missing = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

describe('loadThemeDeclaration', () => {
  it("reads ANY theme's declaration from its ./options export", async () => {
    const d = deps()
    await expect(loadThemeDeclaration('@acme/theme', d)).resolves.toEqual(GOOD)
    expect(d.importModule).toHaveBeenCalledWith('@acme/theme/options')
  })

  it('fails with an error naming the theme and the offending option', async () => {
    const d = deps({
      importModule: vi.fn(async () => ({
        themeOptions: [
          ...GOOD,
          { ...GOOD[0], key: 'headline', token: 'headline' }
        ]
      }))
    })
    await expect(loadThemeDeclaration('@acme/theme', d)).rejects.toThrow(
      /theme @acme\/theme has an invalid options declaration.*option "headline"/
    )
  })

  it('treats a theme with no ./options export as declaring none, and says so', async () => {
    const d = deps({
      importModule: vi.fn(async () => {
        throw missing('ERR_PACKAGE_PATH_NOT_EXPORTED', 'no ./options')
      })
    })
    await expect(loadThemeDeclaration('@acme/theme', d)).resolves.toEqual([])
    expect(d.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('declares no options')
    )
  })

  it('does NOT mistake a broken options module for a missing one', async () => {
    const d = deps({
      importModule: vi.fn(async () => {
        throw missing('ERR_MODULE_NOT_FOUND', "Cannot find module 'some-dep'")
      })
    })
    await expect(loadThemeDeclaration('@acme/theme', d)).rejects.toThrow(
      /some-dep/
    )
  })

  it('rejects an ./options module that exports no declaration', async () => {
    const d = deps({ importModule: vi.fn(async () => ({})) })
    await expect(loadThemeDeclaration('@acme/theme', d)).rejects.toThrow(
      /invalid options declaration/
    )
  })
})
