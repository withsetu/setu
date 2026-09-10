import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import {
  createAuthz,
  DEFAULT_ROLES,
  DEFAULT_THEME,
  parseThemeOptions
} from '@setu/core'
import type { Action, Actor, ResolvedConfig, ThemeOption } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`.
 *  Pairs with `authMiddleware` — the collections-api.ts / forms.ts pattern. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

export interface ThemeApiDeps {
  resolveActor: ResolveActor
  getConfig: () => ResolvedConfig
  /** Load the active theme's raw option declaration. Injected so this is testable without a real
   *  installed theme, and so the import strategy stays one replaceable seam. */
  loadDeclaration: (theme: string) => Promise<unknown>
}

/** True when the error means "this package has no such subpath", rather than "something inside
 *  that subpath failed". Same distinction the font resolver draws (#1075): collapsing them would
 *  make a BROKEN theme look like a theme that simply declares no options. */
function isMissingExport(err: unknown, specifier: string): boolean {
  const e = err as { code?: string; message?: string }
  if (e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return true
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') return false
  return String(e.message ?? '').includes(specifier)
}

/**
 * Read-only control plane for the ACTIVE theme's option declaration (#1076).
 *
 * The Customizer used to import this from one named theme at admin BUILD time, which is what made
 * installable themes impossible: the admin is a browser bundle and cannot import an arbitrary
 * installed theme's module at runtime. Reading it server-side and serving it is the only shape
 * that works for a theme Setu did not ship.
 *
 * Gated on `theme.manage` — the same action the Appearance screen and the `theme-options.json`
 * write path already use (#419), so this opens no surface that screen did not already have.
 *
 * The declaration is UNTRUSTED: it comes from an installed package and its values are emitted
 * into CSS. It goes through `parseThemeOptions`, and a declaration that fails validation is a
 * 500 that says so — never an empty list, which the admin would render as "this theme has no
 * options". Behaviour is covered by apps/api/test/theme-api.test.ts.
 *
 * CORS/origin policy is owned centrally by server.ts, as with createCollectionsApi.
 */
export function createThemeApi(deps: ThemeApiDeps) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(deps.resolveActor)
  const canManageTheme = requireCan('theme.manage')

  app.get('/api/theme/options', auth, canManageTheme, async (c) => {
    const theme = deps.getConfig().theme ?? DEFAULT_THEME
    let raw: unknown
    try {
      raw = await deps.loadDeclaration(theme)
    } catch (err) {
      if (isMissingExport(err, `${theme}/options`))
        // A theme with nothing to customise is legitimate. `declared: false` keeps it
        // distinguishable from a theme whose options failed to load.
        return c.json({ theme, options: [] as ThemeOption[], declared: false })
      return c.json(
        {
          error: `theme ${theme} could not be read: ${err instanceof Error ? err.message : String(err)}`
        },
        500
      )
    }

    try {
      return c.json({ theme, options: parseThemeOptions(raw), declared: true })
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500
      )
    }
  })

  return app
}
