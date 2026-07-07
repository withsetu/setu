import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { countUsers } from '@setu/db-sqlite'
import { createAuth } from '../src'

/** Builds a real (in-memory sqlite) auth instance with the serverSetup plugin wired in — mirrors
 *  makeAuth() in local-token-plugin.test.ts. `getSetupToken()` reflects a stable topology-level
 *  fact (non-local mode with a fresh, unset-up instance); the plugin itself re-checks
 *  `countUsers(db) === 0` per request (not baked into a boolean at construction time) so the
 *  guard reflects the live DB state even mid-test. */
function makeAuth(opts?: { token?: string | null }) {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })

  const token: string | null =
    opts?.token === undefined ? 'test-setup-token-xyz789' : opts.token

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    serverSetup: {
      getSetupToken: () => token,
      countUsers: () => countUsers(db)
    }
  })

  return { db, auth }
}

function setupRequest(body: Record<string, unknown>) {
  return new Request('http://localhost:4444/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const VALID_BODY = {
  email: 'owner@example.com',
  password: 'a-strong-password-12',
  name: 'Owner Person',
  token: 'test-setup-token-xyz789'
}

describe('serverSetup plugin — POST /api/auth/setup', () => {
  it('valid token + zero users -> 200, creates an admin user with a real session cookie', async () => {
    const { db, auth } = makeAuth()

    const res = await auth.handler(setupRequest(VALID_BODY))
    expect(res.status).toBe(200)

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toMatch(/better-auth/)

    expect(countUsers(db)).toBe(1)

    // The returned cookie must be a genuinely valid session recognized by better-auth's own
    // getSession — not a bypass.
    const cookieHeader = (setCookie ?? '').split(';')[0] ?? ''
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader })
    })
    expect(session?.user.email).toBe('owner@example.com')
    expect((session?.user as { role?: string })?.role).toBe('admin')

    // The user can now sign in normally with the password they set.
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@example.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    expect(signin.headers.get('set-cookie')).toMatch(/better-auth/)
  })

  it('404s in local mode (getSetupToken always null) — the endpoint does not exist there', async () => {
    const { auth } = makeAuth({ token: null })
    const res = await auth.handler(setupRequest(VALID_BODY))
    expect(res.status).toBe(404)
  })

  it('403s once a user already exists, even with a valid token — setup is one-time', async () => {
    const { auth } = makeAuth()
    const first = await auth.handler(setupRequest(VALID_BODY))
    expect(first.status).toBe(200)

    const second = await auth.handler(
      setupRequest({ ...VALID_BODY, email: 'second-owner@example.com' })
    )
    expect(second.status).toBe(403)
    // better-auth's error responses use `message` (via ctx.error -> APIError), the same shape the
    // admin client's AuthClientError type already reads (see apps/admin/src/auth/auth-client.ts) —
    // not a literal `{ error: ... }` key.
    const body = (await second.json()) as { message: string }
    expect(body.message).toBe('setup already completed')
  })

  it('wrong token -> 401 and does NOT consume/burn anything; a subsequent valid attempt still works', async () => {
    const { db, auth } = makeAuth()

    const wrong = await auth.handler(
      setupRequest({ ...VALID_BODY, token: 'totally-wrong-token' })
    )
    expect(wrong.status).toBe(401)
    expect(countUsers(db)).toBe(0) // nothing was created

    const valid = await auth.handler(setupRequest(VALID_BODY))
    expect(valid.status).toBe(200)
  })

  it('rejects a malformed body (Zod validation) before touching the DB', async () => {
    const { db, auth } = makeAuth()
    const res = await auth.handler(
      setupRequest({
        email: 'not-an-email',
        password: 'short',
        name: '',
        token: 'test-setup-token-xyz789'
      })
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(countUsers(db)).toBe(0)
  })

  it('concurrent setup posts -> exactly one admin is created (in-process race guard)', async () => {
    const { db, auth } = makeAuth()

    const [a, b] = await Promise.all([
      auth.handler(setupRequest(VALID_BODY)),
      auth.handler(
        setupRequest({ ...VALID_BODY, email: 'racer-two@example.com' })
      )
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 403])
    expect(countUsers(db)).toBe(1)
  })
})
