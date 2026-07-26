import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Action, Actor, ResolvedConfig } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`.
 *  Pairs with `authMiddleware` — the index-api.ts / forms.ts pattern. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** What the admin needs to render a collection: identity, display labels and which
 *  taxonomies it participates in. Deliberately NOT the field schema — a zod schema is not
 *  serializable, and describing fields for a generated edit form is #963's contract to
 *  define. Shipping a partial field shape now would be an interface nobody could rely on
 *  (apps/api/test/collections-api.test.ts pins its absence). */
export interface CollectionDescriptor {
  name: string
  label: string
  labelPlural: string
  taxonomies: string[]
}

export interface CollectionsApiDeps {
  resolveActor: ResolveActor
  getConfig: () => ResolvedConfig
}

/** Read-only control plane for the site's declared collections (#253 increment C).
 *
 *  Gated on `content.view` — the same read surface as /api/index/query, and held by all
 *  four roles, so no role loses access; the gate that bites is the unauthenticated one
 *  (401 via authMiddleware). No repo content is exposed, only the config's own vocabulary.
 *
 *  CORS/origin policy is owned centrally by server.ts (see app.ts's comment on
 *  createGitApi) — this factory sets none of its own. */
export function createCollectionsApi(deps: CollectionsApiDeps) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(deps.resolveActor)
  const canViewContent = requireCan('content.view')

  app.get('/api/collections', auth, canViewContent, (c) => {
    const collections: CollectionDescriptor[] = deps
      .getConfig()
      .collections.map((col) => ({
        name: col.name,
        label: col.label,
        labelPlural: col.labelPlural,
        taxonomies: col.taxonomies
      }))
    return c.json({ collections })
  })

  app.onError(apiOnError({ scope: 'collections' })) // #291: prod-generic, never err.message
  return app
}
