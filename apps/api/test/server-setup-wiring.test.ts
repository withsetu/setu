import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openSqliteDb, countUsers } from '@setu/db-sqlite'
import { createAuth } from '@setu/auth'
import { originGuard, originMatches } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Mirrors server.ts's non-local wiring: mode !== 'local' && authConfigured && countUsers === 0
 *  mints a setup token, threaded into createAuth's `serverSetup` option — same composition, same
 *  guard order, real sqlite (so the countUsers()===0 check reads genuinely live state). */
function makeNonLocalModeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'server-setup-wiring-'))
  const authDb = openSqliteDb(join(dir, 'auth.db'))

  const setupToken = randomBytes(32).toString('base64url')
  const auth = createAuth({
    db: authDb,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN],
    serverSetup: { getSetupToken: () => setupToken, countUsers: () => countUsers(authDb) },
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
  app.use('*', originGuard(allowed, { publicPaths: ['/forms/submit'] }))
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  return { app, setupToken, authDb, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build() {
  const built = makeNonLocalModeApp()
  cleanups.push(built.cleanup)
  return built
}

describe('mode!=local wiring exposes POST /api/auth/setup (server.ts composition, #248 Task 7)', () => {
  it('valid token + zero users -> 200, real session cookie, and needsSetup-equivalent (countUsers) flips to false', async () => {
    const { app, setupToken, authDb } = build()

    const res = await app.fetch(
      new Request('http://test/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
        body: JSON.stringify({ email: 'owner@example.com', password: 'a-strong-password-12', name: 'Owner', token: setupToken }),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/better-auth/)
    expect(countUsers(authDb)).toBe(1)
  })

  it('wrong token -> 401, no user created', async () => {
    const { app, authDb } = build()

    const res = await app.fetch(
      new Request('http://test/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
        body: JSON.stringify({ email: 'owner@example.com', password: 'a-strong-password-12', name: 'Owner', token: 'wrong' }),
      }),
    )

    expect(res.status).toBe(401)
    expect(countUsers(authDb)).toBe(0)
  })
})

describe('mode=local never mints a setup token — POST /api/auth/setup 404s there (loopback handshake covers first-run instead)', () => {
  it('createAuth with serverSetup omitted -> /api/auth/setup is unmounted (404)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'server-setup-local-mode-'))
    try {
      const authDb = openSqliteDb(join(dir, 'auth.db'))
      const auth = createAuth({
        db: authDb,
        secret: 'test-secret-32-chars-minimum!!!!',
        baseURL: 'http://localhost:4444',
        trustedOrigins: [TRUSTED_ORIGIN],
        // serverSetup omitted — mirrors server.ts when mode === 'local' (setupToken stays null).
      })
      const res = await auth.handler(
        new Request('http://localhost:4444/api/auth/setup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.co', password: 'a-strong-password-12', name: 'A', token: 'anything' }),
        }),
      )
      expect(res.status).toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
