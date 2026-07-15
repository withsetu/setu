import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from '@setu/auth'
import { originGuard, originMatches } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'
import { buildLocalTokenOptions } from '../src/local-token'
import { writeHandshakeFile } from '../src/handshake-file'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Builds a Hono app mirroring server.ts's mode=local wiring — through the REAL
 *  `buildLocalTokenOptions` (apps/api/src/local-token.ts), not a test-local stub: the same
 *  boot-token mint, synchronous `consume()` rotation (#386 contract: a valid unused token always
 *  exists), `.setu/handshake-url` persistence, and `localUserId` → `ensureLocalOwner` (#248
 *  Task 7) that server.ts hands to createAuth, including the forward-referenced `getAuth`.
 *  `persist` is injectable exactly as in the real builder so the persist-failure path can be
 *  driven end-to-end through better-auth's handler. */
function makeLocalModeApp(persist?: (dir: string, url: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'local-token-exchange-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  // Forward reference, exactly like server.ts: `auth` doesn't exist yet when the provider is
  // built (createAuth takes it as an option); localUserId only runs per-exchange, after boot.
  // eslint-disable-next-line prefer-const
  let authRef: ReturnType<typeof createAuth> | undefined
  const localToken = buildLocalTokenOptions({
    dir,
    adminOrigin: TRUSTED_ORIGIN,
    getAuth: () => authRef!,
    identity: { email: 'owner@local.test', name: 'Local Owner' },
    ...(persist ? { persist } : {})
  })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN],
    localToken
  })
  authRef = auth

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
  app.use('*', originGuard(allowed, { publicPaths: ['/forms/submit'] }))
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const bootToken = localToken.token
  localToken.persistUrl() // the boot write server.ts performs after logging the handoff URL

  return {
    app,
    dir,
    bootToken,
    // Consumption is observable through the REAL provider: consume() rotates, so the current
    // token differing from the boot token is exactly "an exchange consumed it".
    getConsumed: () => localToken.getToken() !== bootToken,
    getCurrentToken: () => localToken.getToken(),
    readHandshakeFile: () =>
      readFileSync(join(dir, '.setu', 'handshake-url'), 'utf8').trim(),
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  vi.restoreAllMocks()
})

function build(persist?: (dir: string, url: string) => void) {
  const built = makeLocalModeApp(persist)
  cleanups.push(built.cleanup)
  return built
}

function exchangeWith(app: Hono, token: string) {
  return app.fetch(
    new Request('http://test/api/auth/local/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:4444' },
      body: JSON.stringify({ token })
    })
  )
}

describe('mode=local wiring exposes /api/auth/local/exchange (server.ts composition)', () => {
  it('valid token + loopback Host -> 200, ensureLocalOwner completes the handshake end-to-end (#248 Task 7)', async () => {
    const { app, bootToken, getConsumed } = build()

    const res = await exchangeWith(app, bootToken)

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/better-auth/)
    expect(getConsumed()).toBe(true)
  })

  it('wrong token -> 401 and is not routed to the Task-7 stub (guard rejects first, does not consume)', async () => {
    const { app, getConsumed } = build()

    const res = await exchangeWith(app, 'not-the-boot-token')

    expect(res.status).toBe(401)
    expect(getConsumed()).toBe(false)
  })

  it('after a consumed exchange, the ROTATED token admits a second exchange, the old one is dead, and the handshake file rotated (#386)', async () => {
    const { app, bootToken, getCurrentToken, readHandshakeFile } = build()

    expect(readHandshakeFile()).toBe(
      `${TRUSTED_ORIGIN}/#setu-token=${bootToken}`
    )

    const first = await exchangeWith(app, bootToken)
    expect(first.status).toBe(200)

    const rotated = getCurrentToken()
    expect(rotated).not.toBe(bootToken)
    // The on-disk recovery link followed the rotation — it never holds the dead token.
    expect(readHandshakeFile()).toBe(`${TRUSTED_ORIGIN}/#setu-token=${rotated}`)

    // The consumed boot token must never work again.
    const replay = await exchangeWith(app, bootToken)
    expect(replay.status).toBe(401)

    // The rotated token works — recovery without restarting the API.
    const second = await exchangeWith(app, rotated)
    expect(second.status).toBe(200)
    expect(second.headers.get('set-cookie')).toMatch(/better-auth/)
  })

  it('persist failure during rotation: the exchange still succeeds, and a later FAILED attempt with the dead token heals the file (#386 self-healing)', async () => {
    let failNext = false
    const persist = (dir: string, url: string) => {
      if (failNext) {
        failNext = false
        throw new Error('disk hiccup')
      }
      writeHandshakeFile(dir, url)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, bootToken, getCurrentToken, readHandshakeFile } =
      build(persist)

    failNext = true
    // The rotation's persist throws — the exchange must still succeed (the token was already
    // burned; failing the response would strand a completed session).
    const first = await exchangeWith(app, bootToken)
    expect(first.status).toBe(200)
    // The file is now STALE: it still holds the consumed boot token.
    expect(readHandshakeFile()).toBe(
      `${TRUSTED_ORIGIN}/#setu-token=${bootToken}`
    )

    // A locked-out owner reads that stale file and tries the dead token: the attempt 401s, but
    // its getToken() call retried the persist — the attempt itself healed the file.
    const staleAttempt = await exchangeWith(app, bootToken)
    expect(staleAttempt.status).toBe(401)
    const current = getCurrentToken()
    expect(readHandshakeFile()).toBe(`${TRUSTED_ORIGIN}/#setu-token=${current}`)

    // Reading the healed file now recovers access for real.
    const recovered = await exchangeWith(app, current)
    expect(recovered.status).toBe(200)
  })
})
