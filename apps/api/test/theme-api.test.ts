import { describe, it, expect } from 'vitest'
import { resolveConfig, type ThemeOption } from '@setu/core'
import { createThemeApi } from '../src/theme-api'
import type { ResolvedActor } from '../src/auth/resolve-actor'

/**
 * #1076: the Customizer used to import its option model from ONE named theme, resolved when the
 * admin bundle was built, so only that theme could ever be customised. The admin is a browser
 * bundle and cannot import an installed theme's module at runtime, so the declaration has to be
 * read server-side and served.
 *
 * A theme declaration is untrusted input from an installed package, so the two failure shapes are
 * asserted apart: "this theme declares no options" is a legitimate 200, while "this theme's
 * declaration is broken" must NOT present as an empty form.
 */
const DECLARATION: ThemeOption[] = [
  {
    key: 'accent',
    label: 'Accent color',
    type: 'color',
    token: '--accent',
    default: '#3b5bdb'
  }
]

const config = resolveConfig({ theme: '@acme/theme-brochure' })

const admin = (): ResolvedActor => ({ id: 'a', role: 'admin' })
const author = (): ResolvedActor => ({ id: 'b', role: 'author' })

const get = (
  actor: () => ResolvedActor | null,
  loadDeclaration = async () => DECLARATION as unknown
) =>
  createThemeApi({
    resolveActor: actor,
    getConfig: () => config,
    loadDeclaration
  }).fetch(new Request('http://x/api/theme/options'))

describe('GET /api/theme/options', () => {
  it("serves the ACTIVE theme's declaration, whichever theme that is", async () => {
    const res = await get(admin)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { theme: string; options: ThemeOption[] }
    expect(body.theme).toBe('@acme/theme-brochure')
    expect(body.options).toEqual(DECLARATION)
  })

  // The gate that matters: the Appearance screen is `theme.manage`, so this must match it.
  it('401s an unauthenticated request', async () => {
    const res = await get(() => null)
    expect(res.status).toBe(401)
  })

  it('403s an actor without theme.manage', async () => {
    const res = await get(author)
    expect(res.status).toBe(403)
  })

  it('a theme that declares no options is a legitimate 200, not an error', async () => {
    const res = await get(admin, async () => {
      const err = new Error('no such export') as Error & { code: string }
      err.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      throw err
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      options: ThemeOption[]
      declared: boolean
    }
    expect(body.options).toEqual([])
    // Distinguishable from a broken one, and from a theme whose options failed to load.
    expect(body.declared).toBe(false)
  })

  it('a MALFORMED declaration fails loudly — it must not look like "no options"', async () => {
    const res = await get(admin, async () => [
      { key: 'x', label: 'X', type: 'color', token: 'color', default: '#fff' }
    ])
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/token/i)
  })

  it('a declaration that tries to inject CSS is rejected, not served', async () => {
    const res = await get(admin, async () => [
      {
        key: 'x',
        label: 'X',
        type: 'color',
        token: '--x: red; } body { display: none } .y',
        default: '#fff'
      }
    ])
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('display: none')
  })
})
