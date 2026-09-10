import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES, resolveControls } from '@setu/core'
import type {
  Action,
  Actor,
  ResolvedCollection,
  ResolvedConfig,
  ResolvedControl
} from '@setu/core'
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
/**
 * Project a collection's declared field schema into the controls the admin renders (#1125).
 *
 * `resolveControls` is the same projection the block inspector already consumes
 * (apps/admin/src/editor/BlockInspector.tsx), so this adds no new wire format and no zod internals
 * cross the boundary — a zod schema is not serialisable, and coupling the admin to `_def` would
 * couple it to a layout that has moved between zod majors.
 *
 * It THROWS by design on a schema it cannot render — an array prop with no control hint, or an
 * unsupported zod type — and a collection is free to declare one. Left uncaught that would 500 the
 * whole endpoint, taking every healthy collection's fields down with it. So the failure is scoped
 * to the collection that caused it and reported rather than swallowed: `fields` present means
 * renderable, `fieldsError` present means broken, and NEITHER means the collection declared no
 * custom fields. The admin needs all three apart — "no fields" rendered over "could not read the
 * fields" is the #837 shape (§4 #22).
 *
 * Behaviour is covered by apps/api/test/collections-api.test.ts.
 */
function describeFields(
  col: ResolvedCollection
): { fields?: ResolvedControl[] } | { fieldsError?: string } {
  if (!col.fields) return {}
  try {
    return { fields: resolveControls(col.fields) }
  } catch (err) {
    return {
      fieldsError: err instanceof Error ? err.message : String(err)
    }
  }
}

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
        taxonomies: col.taxonomies,
        ...describeFields(col)
      }))
    return c.json({ collections })
  })

  app.onError(apiOnError({ scope: 'collections' })) // #291: prod-generic, never err.message
  return app
}
