import { createMiddleware } from 'hono/factory'
import { correlationId } from '../errors'
import type { ResolvedActor, ResolveActor } from './resolve-actor'

/** Authentication seam: sets c.get('actor'); 401 when the resolver returns null.
 *  A resolver that THROWS also denies (#291 fail-closed): masking the fault as a plain 401 avoids
 *  advertising an internal auth failure to a probing client; the correlation-id log line keeps it
 *  debuggable. */
export function authMiddleware(resolveActor: ResolveActor) {
  return createMiddleware<{ Variables: { actor: ResolvedActor } }>(
    async (c, next) => {
      let actor: ResolvedActor | null
      try {
        actor = await resolveActor(c.req.raw)
      } catch (err) {
        const id = correlationId()
        console.error(
          `[api:auth] actor resolution threw — denying id=${id} ${c.req.method} ${c.req.path}`,
          err
        )
        return c.json({ error: 'unauthenticated' }, 401)
      }
      if (!actor) return c.json({ error: 'unauthenticated' }, 401)
      c.set('actor', actor)
      await next()
    }
  )
}
