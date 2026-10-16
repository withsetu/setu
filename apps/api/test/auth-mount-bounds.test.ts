import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import {
  CLIENT_IP_HEADER,
  createAuth,
  PROVISIONING,
  type AuthEvent
} from '@setu/auth'
import {
  AUTH_MAX_BODY_BYTES,
  mountAuthWithFailureEvents
} from '../src/auth/login-failure-events'
import { resolveClientIp } from '../src/client-ip'

/** #1274 + #1275: the bounds the `/api/auth/*` mount puts in front of better-auth, driven through
 *  the REAL better-auth handler and its REAL rate limiter (database-backed, enabled — createAuth's
 *  default), mounted exactly as server.ts mounts it.
 *
 *  The socket peer is simulated through Hono's `env` (app.fetch's second argument), read by the
 *  same `resolveClientIp` server.ts uses with the header-blind default trust (no
 *  SETU_TRUSTED_PROXIES) — so every client-supplied address header in these tests is something
 *  Setu's trust model says must be ignored. */
type Env = { peer?: string }

function makeApp(onAuthEvent: (e: AuthEvent) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'auth-mount-bounds-'))
  const sqlite = new Database(join(dir, 'auth.db'))
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173']
  })

  const app = new Hono<{ Bindings: Env }>()
  mountAuthWithFailureEvents(app, auth, {
    onAuthEvent,
    clientIp: (c) =>
      resolveClientIp(
        { header: (n) => c.req.header(n), socketIp: c.env?.peer },
        { proxies: [] }
      )
  })
  return {
    app,
    auth,
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})
function build(onAuthEvent?: (e: AuthEvent) => void) {
  const built = makeApp(onAuthEvent)
  cleanups.push(built.cleanup)
  return built
}

function signIn(extraHeaders: Record<string, string> = {}, password = 'x') {
  return new Request('http://localhost:4444/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ email: 'nobody@example.com', password })
  })
}

async function statuses(
  app: Hono<{ Bindings: Env }>,
  requests: Array<{ req: Request; peer: string }>
): Promise<number[]> {
  const out: number[] = []
  for (const { req, peer } of requests) {
    out.push((await app.fetch(req, { peer })).status)
  }
  return out
}

describe('#1274 — better-auth rate limiter keys on the address Setu resolves', () => {
  it('a client-supplied cf-connecting-ip cannot mint a fresh bucket: the 4th sign-in in 10s is 429', async () => {
    const { app } = build()
    const got = await statuses(
      app,
      [1, 2, 3, 4].map((i) => ({
        req: signIn({ 'cf-connecting-ip': `198.51.100.${i}` }),
        peer: '203.0.113.7'
      }))
    )
    expect(got.slice(0, 3)).not.toContain(429)
    expect(got[3]).toBe(429)
  })

  it(`a client-supplied ${CLIENT_IP_HEADER} (the header better-auth now reads) is replaced, not believed`, async () => {
    const { app } = build()
    const got = await statuses(
      app,
      [1, 2, 3, 4].map((i) => ({
        req: signIn({
          [CLIENT_IP_HEADER]: `198.51.100.${i}`,
          'x-forwarded-for': `192.0.2.${i}`
        }),
        peer: '203.0.113.7'
      }))
    )
    expect(got.slice(0, 3)).not.toContain(429)
    expect(got[3]).toBe(429)
  })

  it('spoofed and header-less attempts from one peer share ONE bucket', async () => {
    const { app } = build()
    const got = await statuses(app, [
      { req: signIn(), peer: '203.0.113.7' },
      {
        req: signIn({ 'cf-connecting-ip': '198.51.100.1' }),
        peer: '203.0.113.7'
      },
      {
        req: signIn({ [CLIENT_IP_HEADER]: '198.51.100.2' }),
        peer: '203.0.113.7'
      },
      { req: signIn(), peer: '203.0.113.7' }
    ])
    expect(got[3]).toBe(429)
  })

  it(`with NO resolvable peer, a client-supplied ${CLIENT_IP_HEADER} is still stripped: one shared bucket`, async () => {
    const { app } = build()
    const out: number[] = []
    for (const i of [1, 2, 3, 4]) {
      // No `peer` in env → resolveClientIp returns undefined → the mount must DELETE the inbound
      // header rather than leave it for better-auth to believe.
      const res = await app.fetch(
        signIn({ [CLIENT_IP_HEADER]: `198.51.100.${i}` }),
        {}
      )
      out.push(res.status)
    }
    expect(out.slice(0, 3)).not.toContain(429)
    expect(out[3]).toBe(429)
  })

  it('two different resolved client addresses get separate buckets', async () => {
    const { app } = build()
    const fromA = await statuses(
      app,
      [1, 2, 3, 4].map(() => ({ req: signIn(), peer: '203.0.113.7' }))
    )
    expect(fromA[3]).toBe(429)
    const fromB = await statuses(app, [{ req: signIn(), peer: '203.0.113.8' }])
    expect(fromB[0]).not.toBe(429)
  })

  it('the session row records the resolved address, not a client-supplied one', async () => {
    const { app, auth } = build()
    const ctx = await auth.$context
    const user = await ctx.internalAdapter.createUser(
      { email: 'a@b.co', name: 'A', role: 'author', emailVerified: true },
      PROVISIONING.adminInvite
    )
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash('hunter2hunter2')
    })
    const res = await app.fetch(
      new Request('http://localhost:4444/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.9',
          [CLIENT_IP_HEADER]: '198.51.100.10'
        },
        body: JSON.stringify({ email: 'a@b.co', password: 'hunter2hunter2' })
      }),
      { peer: '203.0.113.42' }
    )
    expect(res.status).toBe(200)
    const sessions = await ctx.internalAdapter.listSessions(user.id)
    expect(sessions.map((s) => s.ipAddress)).toEqual(['203.0.113.42'])
  })
})

describe('#1275 — request-size bound in front of /api/auth/*', () => {
  const oversized = JSON.stringify({
    email: 'nobody@example.com',
    password: 'x'.repeat(AUTH_MAX_BODY_BYTES + 1)
  })

  it('refuses an oversized sign-in body with 413 before better-auth runs', async () => {
    const events: AuthEvent[] = []
    const { app } = build((e) => events.push(e))
    const res = await app.fetch(
      new Request('http://localhost:4444/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversized
      }),
      { peer: '203.0.113.7' }
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload too large' })
    // better-auth never ran, so no attempt was counted as a login failure either.
    expect(events.filter((e) => e.type === 'login.failure')).toHaveLength(0)
  })

  it('refuses an oversized STREAMED body (no content-length) with 413', async () => {
    const { app } = build()
    const bytes = new TextEncoder().encode(oversized)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Several chunks, so the bound is enforced mid-stream rather than on one buffer.
        for (let i = 0; i < bytes.length; i += 8192)
          controller.enqueue(bytes.slice(i, i + 8192))
        controller.close()
      }
    })
    const req = new Request('http://localhost:4444/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half'
    })
    expect(req.headers.get('content-length')).toBeNull()
    const res = await app.fetch(req, { peer: '203.0.113.7' })
    expect(res.status).toBe(413)
  })

  it('a streamed body UNDER the bound still reaches better-auth intact', async () => {
    const { app } = build()
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        email: 'nobody@example.com',
        password: 'wrong-password-1'
      })
    )
    const req = new Request('http://localhost:4444/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        }
      }),
      duplex: 'half'
    })
    const res = await app.fetch(req, { peer: '203.0.113.7' })
    // better-auth parsed the body and answered on the credentials — not a 413, not a 400.
    expect(res.status).toBe(401)
  })
})
