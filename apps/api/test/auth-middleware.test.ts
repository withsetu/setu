import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Actor } from '@setu/core'
import { authMiddleware } from '../src/auth/middleware'
import { resolveLocalOwner } from '../src/auth/resolve-actor'
import type { ResolveActor } from '../src/auth/resolve-actor'

function appWith(resolve: ResolveActor) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.use('*', authMiddleware(resolve))
  app.get('/whoami', (c) => c.json({ actor: c.get('actor') }))
  return app
}
const req = (app: Hono<any>, path: string) =>
  app.fetch(new Request(`http://test${path}`))

describe('authMiddleware', () => {
  it('sets the actor and continues when the resolver returns one', async () => {
    const res = await req(appWith(resolveLocalOwner), '/whoami')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actor: { id: 'local', role: 'admin' } })
  })

  it('returns 401 when the resolver returns null', async () => {
    const res = await req(
      appWith(() => null),
      '/whoami'
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  // #291 fail-closed auth resolution: an EXCEPTION inside the resolver must deny exactly like a
  // null actor — never fall through to the handler, never surface the internal fault to the client.
  it('denies with a masked 401 when the resolver THROWS — the handler never runs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let handlerRan = false
    const app = new Hono<{ Variables: { actor: Actor } }>()
    app.use(
      '*',
      authMiddleware(() => {
        throw new Error('session store exploded: /var/lib/secret.db')
      })
    )
    app.get('/whoami', (c) => {
      handlerRan = true
      return c.json({ actor: c.get('actor') })
    })

    const res = await req(app, '/whoami')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' }) // masked — no internal detail
    expect(handlerRan).toBe(false)
    // The underlying fault IS logged server-side (with a correlation id) so it stays debuggable.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[1])).toContain('session store exploded')
    spy.mockRestore()
  })

  it('resolveLocalOwner is the single local owner', () => {
    expect(resolveLocalOwner(new Request('http://test/'))).toEqual({
      id: 'local',
      role: 'admin'
    })
  })
})
