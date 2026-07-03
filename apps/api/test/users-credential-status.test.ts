import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { createUsersApi } from '../src/users'

const TRUSTED_ORIGIN = 'http://localhost:5173'

/** Real, temp-file-backed better-auth instance (mirrors auth-routes.test.ts's makeApp) — the
 *  credential-status endpoint reads the SAME drizzle handle better-auth itself uses for the
 *  `account` table, so a real instance (not a mock) is the honest way to test it. */
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'users-credential-status-'))
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

  const app = createUsersApi({ db, resolveActor: resolveSessionActor(auth) })

  return {
    app,
    auth,
    db,
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function makeUser(
  auth: ReturnType<typeof createAuth>,
  opts: { email: string; name: string; role: string; password?: string },
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email: opts.email,
    name: opts.name,
    role: opts.role,
    emailVerified: true,
  })
  if (opts.password) {
    const hashed = await ctx.password.hash(opts.password)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hashed,
    })
  }
  return user
}

async function signInCookie(auth: ReturnType<typeof createAuth>, email: string, password: string) {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build() {
  const built = makeApp()
  cleanups.push(built.cleanup)
  return built
}

describe('GET /api/users/credential-status', () => {
  it('401s with no session', async () => {
    const { app } = build()
    const res = await app.fetch(new Request('http://test/api/users/credential-status'))
    expect(res.status).toBe(401)
  })

  it('403s for a session lacking users.manage (a non-owner)', async () => {
    const { app, auth } = build()
    await makeUser(auth, { email: 'editor@test.com', name: 'Editor', role: 'editor', password: 'a-strong-password-12' })
    const cookie = await signInCookie(auth, 'editor@test.com', 'a-strong-password-12')

    const res = await app.fetch(new Request('http://test/api/users/credential-status', { headers: { cookie } }))
    expect(res.status).toBe(403)
  })

  it('owner session -> 200 with a map of userId -> true only for users WITH a credential account', async () => {
    const { app, auth } = build()
    const owner = await makeUser(auth, { email: 'owner@test.com', name: 'Owner', role: 'owner', password: 'a-strong-password-12' })
    // Passwordless user: created with no linkAccount call at all (mirrors ensure-local-owner.ts's
    // shape for the local owner, or any admin-created "magic link only" user).
    const passwordless = await makeUser(auth, { email: 'ghost@test.com', name: 'Ghost', role: 'viewer' })
    const cookie = await signInCookie(auth, 'owner@test.com', 'a-strong-password-12')

    const res = await app.fetch(new Request('http://test/api/users/credential-status', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, boolean>
    expect(body[owner.id]).toBe(true)
    expect(body[passwordless.id]).toBeUndefined() // absence = passwordless, per the brief's contract
  })

  it('does not leak internal errors: a thrown query surfaces as a generic 500', async () => {
    const { auth } = makeApp()
    const owner = await makeUser(auth, { email: 'owner@test.com', name: 'Owner', role: 'owner', password: 'a-strong-password-12' })
    void owner
    const cookie = await signInCookie(auth, 'owner@test.com', 'a-strong-password-12')

    // A db handle whose select() throws, simulating a query failure.
    const throwingDb = {
      select: () => {
        throw new Error('db exploded: leaking internal detail')
      },
    } as unknown as Parameters<typeof createUsersApi>[0]['db']
    const app = createUsersApi({ db: throwingDb, resolveActor: resolveSessionActor(auth) })

    const res = await app.fetch(new Request('http://test/api/users/credential-status', { headers: { cookie } }))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).not.toMatch(/leaking internal detail/)
  })
})
