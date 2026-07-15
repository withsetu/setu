import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth, ensureLocalOwner } from '@setu/auth'
import { originGuard, originMatches } from '../src/auth/origin-guard'
import { allowedOrigins } from '../src/auth/allowed-origins'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Builds a Hono app mirroring server.ts's mode=local wiring: mints a boot token exactly like
 *  server.ts does (randomBytes(32).toString('base64url'), held as MUTABLE module state), and
 *  passes getToken/consume/localUserId into createAuth — with `consume()` re-minting the token
 *  synchronously (#386 rotation contract: a valid unused token always exists) and localUserId
 *  wired to the real ensureLocalOwner (#248 Task 7), exactly as server.ts's boot sequence does. */
function makeLocalModeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'local-token-exchange-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const bootToken = randomBytes(32).toString('base64url')
  let token = bootToken
  let consumeCount = 0

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN],
    localToken: {
      getToken: () => token,
      consume: () => {
        consumeCount += 1
        token = randomBytes(32).toString('base64url')
      },
      localUserId: () =>
        ensureLocalOwner(auth, {
          email: 'owner@local.test',
          name: 'Local Owner'
        })
    }
  })

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

  return {
    app,
    bootToken,
    getConsumed: () => consumeCount > 0,
    getCurrentToken: () => token,
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

function build() {
  const built = makeLocalModeApp()
  cleanups.push(built.cleanup)
  return built
}

describe('mode=local wiring exposes /api/auth/local/exchange (server.ts composition)', () => {
  it('valid token + loopback Host -> 200, ensureLocalOwner completes the handshake end-to-end (#248 Task 7)', async () => {
    const { app, bootToken, getConsumed } = build()

    const res = await app.fetch(
      new Request('http://test/api/auth/local/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:4444' },
        body: JSON.stringify({ token: bootToken })
      })
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/better-auth/)
    expect(getConsumed()).toBe(true)
  })

  it('wrong token -> 401 and is not routed to the Task-7 stub (guard rejects first, does not consume)', async () => {
    const { app, getConsumed } = build()

    const res = await app.fetch(
      new Request('http://test/api/auth/local/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:4444' },
        body: JSON.stringify({ token: 'not-the-boot-token' })
      })
    )

    expect(res.status).toBe(401)
    expect(getConsumed()).toBe(false)
  })

  it('after a consumed exchange, the ROTATED token admits a second exchange and the old one is dead (#386)', async () => {
    const { app, bootToken, getCurrentToken } = build()

    const exchange = (token: string) =>
      app.fetch(
        new Request('http://test/api/auth/local/exchange', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            host: 'localhost:4444'
          },
          body: JSON.stringify({ token })
        })
      )

    const first = await exchange(bootToken)
    expect(first.status).toBe(200)

    const rotated = getCurrentToken()
    expect(rotated).not.toBe(bootToken)

    // The consumed boot token must never work again.
    const replay = await exchange(bootToken)
    expect(replay.status).toBe(401)

    // The rotated token works — recovery without restarting the API.
    const second = await exchange(rotated)
    expect(second.status).toBe(200)
    expect(second.headers.get('set-cookie')).toMatch(/better-auth/)
  })
})
