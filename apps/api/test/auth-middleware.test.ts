import { describe, expect, it } from 'vitest'
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

  it('resolveLocalOwner is the single local owner', () => {
    expect(resolveLocalOwner(new Request('http://test/'))).toEqual({
      id: 'local',
      role: 'admin'
    })
  })
})
