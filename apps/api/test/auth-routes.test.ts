import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from '@setu/auth'
import type { StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { originGuard, originMatches } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'

/** Inline in-memory StoragePort fake, matching the pattern in media-upload.test.ts. */
function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `http://test/media/${key}` },
    async list(prefix?: string) { const keys = [...map.keys()]; return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys },
  }
}

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Build a Hono app mirroring server.ts's wiring: global CORS allowlist + originGuard, the
 *  better-auth handler mounted at /api/auth/*, and the /media upload route behind
 *  resolveSessionActor — using a real, temp-file-backed better-auth instance so rate limiting
 *  (which better-auth backs by the `rate_limit` DB table) persists across requests exactly as it
 *  would in production. */
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'auth-routes-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN],
  })

  const allowed = () => allowedOrigins({ SETU_ADMIN_ORIGIN: TRUSTED_ORIGIN, SETU_API_PORT: '4444' })

  const app = new Hono()
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return undefined
        return allowed().some((pattern) => originMatches(origin, pattern)) ? origin : undefined
      },
      credentials: true,
    }),
  )
  app.use('*', originGuard(allowed))
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/', createUploadApi({ storage: memStorage(), resolveActor: resolveSessionActor(auth) }))

  return { app, cleanup: () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build() {
  const { app, cleanup } = makeApp()
  cleanups.push(cleanup)
  return app
}

describe('auth routes (server.ts wiring)', () => {
  it('/api/auth/sign-in/email responds (mounted, not 404)', async () => {
    const app = build()
    const res = await app.fetch(
      new Request('http://test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongpassword123' }),
      }),
    )
    expect(res.status).not.toBe(404)
  })

  it('POST /media with an untrusted Origin -> 403 from the guard, before any auth logic', async () => {
    const app = build()
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    const res = await app.fetch(
      new Request('http://test/media', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: form,
      }),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'origin not allowed' })
  })

  it('4 rapid sign-in attempts with wrong credentials -> the 4th is rate-limited (429)', async () => {
    const app = build()
    const attempt = () =>
      app.fetch(
        new Request('http://test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongpassword123' }),
        }),
      )
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const res = await attempt()
      statuses.push(res.status)
    }
    expect(statuses[3]).toBe(429)
  })
})
