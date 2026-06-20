import { createMiddleware } from 'hono/factory'
import type { Actor } from '@setu/core'
import type { ResolveActor } from './resolve-actor'

/** Authentication seam: sets c.get('actor'); 401 when the resolver returns null. */
export function authMiddleware(resolveActor: ResolveActor) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    const actor = await resolveActor(c.req.raw)
    if (!actor) return c.json({ error: 'unauthenticated' }, 401)
    c.set('actor', actor)
    await next()
  })
}
