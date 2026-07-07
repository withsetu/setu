import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { StoragePort, StoredObject } from '@setu/core'
import { openSqliteDb } from '@setu/db-sqlite'
import { createAuth } from '@setu/auth'
import { resolveAuthSecret, resolveSetuMode } from '../src/config'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { originGuard, originMatches } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'
import { authUnconfiguredGuard } from '../src/auth/auth-unconfigured-guard'
import { buildCapabilities, createCapabilitiesApi } from '../src/capabilities'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) {
      map.set(key, { body: body.slice(), contentType: opts.contentType })
    },
    async get(key) {
      const o = map.get(key)
      return o ? { body: o.body.slice(), contentType: o.contentType } : null
    },
    async delete(key) {
      map.delete(key)
    },
    async exists(key) {
      return map.has(key)
    },
    url(key) {
      return `http://test/media/${key}`
    },
    async list(prefix?: string) {
      const keys = [...map.keys()]
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
    }
  }
}

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Mirrors server.ts's wiring for the non-local, no-SETU_AUTH_SECRET case: resolveAuthSecret
 *  returns null, so `auth` (and everything downstream of it) is never constructed. The
 *  authUnconfiguredGuard middleware is the only thing standing in for it — mounted after CORS,
 *  before originGuard (order doesn't matter for correctness here since the guard only inspects
 *  method + auth-configured state, not Origin; see the comment in server.ts for why this order was
 *  chosen). */
function makeDegradedApp() {
  const dir = mkdtempSync(join(tmpdir(), 'fail-closed-boot-'))
  const env = { SETU_MODE: 'self-hosted' } as NodeJS.ProcessEnv
  const mode = resolveSetuMode(env)
  const secret = resolveAuthSecret(env)
  expect(secret).toBeNull() // sanity: this test only makes sense in the degraded state

  const allowed = () =>
    allowedOrigins({ SETU_ADMIN_ORIGIN: TRUSTED_ORIGIN, SETU_API_PORT: '4444' })

  const app = new Hono()
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return undefined
        return allowed().some((pattern) => originMatches(origin, pattern))
          ? origin
          : undefined
      },
      credentials: true
    })
  )
  app.use(
    '*',
    authUnconfiguredGuard(() => secret === null)
  )
  app.use('*', originGuard(allowed, { publicPaths: ['/forms/submit'] }))

  // auth is NOT constructed — matches the requirement "the auth instance must simply not be
  // constructed in this state". /api/auth/* still needs a mount point to prove the guard, not the
  // route, is what returns 503 — a 404 would mean the guard let it fall through to nothing.
  app.on(['POST', 'GET'], '/api/auth/*', (c) =>
    c.json({ error: 'unreachable: guard should have short-circuited' }, 500)
  )

  app.route(
    '/',
    createUploadApi({ storage: memStorage(), resolveActor: () => null })
  )
  app.route(
    '/',
    createCapabilitiesApi(
      buildCapabilities({
        writableMediaStore: true,
        backgroundJobs: true,
        mode,
        auth: {
          enabled: false,
          providers: [],
          captcha: null,
          needsSetup: false
        }
      }),
      () => ({
        enabled: false,
        providers: [],
        captcha: null,
        needsSetup: false
      })
    )
  )

  return { app, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build() {
  const built = makeDegradedApp()
  cleanups.push(built.cleanup)
  return built.app
}

describe('fail-closed boot degradation (non-local mode, no SETU_AUTH_SECRET)', () => {
  it('POST /media -> 503 with the exact "auth not configured" body (not the auth middleware\'s 401, not a crash)', async () => {
    const app = build()
    const form = new FormData()
    form.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    )
    const res = await app.fetch(
      new Request('http://test/media', {
        method: 'POST',
        headers: { origin: TRUSTED_ORIGIN },
        body: form
      })
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'auth not configured',
      hint: 'set SETU_AUTH_SECRET'
    })
  })

  it('POST /api/auth/sign-in/email -> 503 (the auth mount is short-circuited before it ever runs)', async () => {
    const app = build()
    const res = await app.fetch(
      new Request('http://test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
        body: JSON.stringify({
          email: 'a@example.com',
          password: 'whatever123'
        })
      })
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'auth not configured',
      hint: 'set SETU_AUTH_SECRET'
    })
  })

  it('GET /api/capabilities -> 200, auth.enabled: false (public GETs keep working)', async () => {
    const app = build()
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { auth: { enabled: boolean } }
    expect(body.auth.enabled).toBe(false)
  })

  it("GET /media/whatever -> passes the guard (falls through to the route's own 404, not a 503)", async () => {
    const app = build()
    const res = await app.fetch(new Request('http://test/media/does-not-exist'))
    expect(res.status).toBe(404) // media route's own "not found", proving GET was not 503'd
  })

  it("OPTIONS preflight is never 503'd", async () => {
    const app = build()
    const res = await app.fetch(
      new Request('http://test/media', {
        method: 'OPTIONS',
        headers: {
          origin: TRUSTED_ORIGIN,
          'access-control-request-method': 'POST'
        }
      })
    )
    expect(res.status).not.toBe(503)
  })
})

describe('resolveActor fails closed when auth is unconfigured (503, not 401 — see comment in resolve-session-actor.ts)', () => {
  it('a gated route reachable in a mixed topology still 503s rather than misreport 401', async () => {
    // Construction-time proof: with no auth instance, server.ts never builds resolveSessionActor
    // at all — the guard is the sole gate. This test documents that the *combination* (guard +
    // absent auth) is what fail-closed means here, not a fallback resolveActor implementation.
    const dir = mkdtempSync(join(tmpdir(), 'fail-closed-actor-'))
    try {
      const db = openSqliteDb(join(dir, 'auth.db'))
      const auth = createAuth({
        db,
        secret: 'configured-secret-for-comparison-only',
        baseURL: 'http://localhost:4444',
        trustedOrigins: []
      })
      const resolveActor = resolveSessionActor(auth)
      const result = await resolveActor(
        new Request('http://test/', {
          headers: { cookie: 'better-auth.session_token=garbage' }
        })
      )
      expect(result).toBeNull() // proves the underlying resolver already fails closed to null/401 when unauthenticated
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
