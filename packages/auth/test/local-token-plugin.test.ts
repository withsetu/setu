import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '../src'
import { constantTimeTokenEquals } from '../src/local-token-plugin'

/** Builds a real (in-memory sqlite) auth instance with the localToken plugin wired in.
 *
 *  `getToken()` reflects a stable topology-level fact — "does this server have local-token
 *  capability at all" (null only when the caller passes `token: null`, simulating a non-local
 *  topology) — it does NOT flip to null on consumption. Single-use enforcement is the plugin's
 *  own job (see local-token-plugin.ts); `consume()` here just records that it was called, for
 *  assertions like "wrong token must not consume". This mirrors the real server.ts contract. */
function makeAuth(opts?: { token?: string | null }) {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })

  const token: string | null = opts?.token === undefined ? 'test-loopback-token-abc123' : opts.token
  let consumeCallCount = 0
  let localUserId = ''

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    localToken: {
      getToken: () => token,
      consume: () => {
        consumeCallCount += 1
      },
      localUserId: async () => {
        if (!localUserId) throw new Error('local owner not set for this test')
        return localUserId
      },
    },
  })

  return {
    db,
    auth,
    setLocalUserId: (id: string) => {
      localUserId = id
    },
    getConsumed: () => consumeCallCount > 0,
  }
}

// Public sign-up is disabled (invite-only — see disableSignUp in ../src/index.ts), so this fixture
// creates the local user the same way the real local-owner flow does: internalAdapter.createUser +
// linkAccount, not the public sign-up route. Mirrors auth-events.test.ts's makeOwner helper.
async function createLocalUser(auth: ReturnType<typeof createAuth>) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email: 'owner@local.test', name: 'Owner', role: 'owner', emailVerified: true })
  const hashed = await ctx.password.hash('hunter2hunter2')
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hashed })
  return user.id
}

function exchangeRequest(token: string, host = 'localhost:4444') {
  return new Request('http://localhost:4444/api/auth/local/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host },
    body: JSON.stringify({ token }),
  })
}

describe('localToken plugin — POST /api/auth/local/exchange', () => {
  it('valid token + loopback Host -> 200, sets a genuinely valid session cookie', async () => {
    const { auth, setLocalUserId } = makeAuth()
    const userId = await createLocalUser(auth)
    setLocalUserId(userId)

    const res = await auth.handler(exchangeRequest('test-loopback-token-abc123'))
    expect(res.status).toBe(200)

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toMatch(/better-auth/)

    // Follow up: use the returned cookie to fetch the session, proving it's a real session row —
    // not a bypass — recognized by better-auth's own getSession.
    const cookieHeader = (setCookie ?? '').split(';')[0] ?? ''
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) })
    expect(session?.user.id).toBe(userId)
  })

  it('second exchange with the same token -> 401/403 (single-use, already consumed)', async () => {
    const { auth, setLocalUserId } = makeAuth()
    const userId = await createLocalUser(auth)
    setLocalUserId(userId)

    const first = await auth.handler(exchangeRequest('test-loopback-token-abc123'))
    expect(first.status).toBe(200)

    const second = await auth.handler(exchangeRequest('test-loopback-token-abc123'))
    expect([401, 403]).toContain(second.status)
  })

  it('wrong token -> 401/403 AND does not consume; a subsequent valid exchange still works', async () => {
    const { auth, setLocalUserId, getConsumed } = makeAuth()
    const userId = await createLocalUser(auth)
    setLocalUserId(userId)

    const wrong = await auth.handler(exchangeRequest('totally-wrong-token'))
    expect([401, 403]).toContain(wrong.status)
    expect(getConsumed()).toBe(false)

    const valid = await auth.handler(exchangeRequest('test-loopback-token-abc123'))
    expect(valid.status).toBe(200)
  })

  it('non-loopback Host -> 403 AND does not consume', async () => {
    const { auth, setLocalUserId, getConsumed } = makeAuth()
    const userId = await createLocalUser(auth)
    setLocalUserId(userId)

    const res = await auth.handler(exchangeRequest('test-loopback-token-abc123', 'xyz.trycloudflare.com'))
    expect(res.status).toBe(403)
    expect(getConsumed()).toBe(false)

    // Ordering matters: the token must still be valid afterwards.
    const valid = await auth.handler(exchangeRequest('test-loopback-token-abc123'))
    expect(valid.status).toBe(200)
  })

  it('getToken() null (server topology has no local token) -> 404', async () => {
    const { auth } = makeAuth({ token: null })

    const res = await auth.handler(exchangeRequest('anything'))
    expect(res.status).toBe(404)
  })
})

describe('constantTimeTokenEquals', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeTokenEquals('same-token-value', 'same-token-value')).toBe(true)
  })

  it('returns false for unequal strings', () => {
    expect(constantTimeTokenEquals('same-token-value', 'different-token')).toBe(false)
  })

  it('returns false for unequal-length strings without throwing', () => {
    expect(constantTimeTokenEquals('short', 'a-much-longer-token-value')).toBe(false)
  })

  it('is constant-time-shaped: hashes both sides to equal-length buffers before comparing (structural check via source)', async () => {
    // We can't measure timing reliably in a unit test. Instead, assert structurally that the
    // implementation routes through node:crypto's timingSafeEqual — the one primitive Node
    // provides for this — by reading the compiled source of the module rather than mocking the
    // (non-configurable) crypto module export.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const srcPath = fileURLToPath(new URL('../src/local-token-plugin.ts', import.meta.url))
    const source = readFileSync(srcPath, 'utf-8')
    expect(source).toMatch(/timingSafeEqual/)
    expect(source).toMatch(/createHash\(['"]sha256['"]\)/)
  })
})
