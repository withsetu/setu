import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { createAuth, type AuthEvent } from '@setu/auth'
import { mountAuthWithFailureEvents } from '../src/auth/login-failure-events'

/** #248 Task 9: `login.failure` cannot be observed through any better-auth databaseHooks
 *  chokepoint — sign-in's password/lookup failures all throw an APIError directly from the route
 *  handler (verified against installed better-auth 1.6.23 source: dist/api/routes/sign-in.mjs
 *  throws UNAUTHORIZED before ever calling internalAdapter.createSession, so no
 *  databaseHooks.session.create hook fires). This is the pre-approved fallback: a thin wrapper at
 *  the Hono mount point that inspects the RESPONSE of POST /api/auth/sign-in/email for
 *  status >= 400 and emits login.failure — never logging the request/response body. */
function makeApp(onAuthEvent: (e: AuthEvent) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'login-failure-events-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    onAuthEvent,
  })

  const app = new Hono()
  mountAuthWithFailureEvents(app, auth, onAuthEvent)

  return { app, auth, cleanup: () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build(onAuthEvent: (e: AuthEvent) => void) {
  const built = makeApp(onAuthEvent)
  cleanups.push(built.cleanup)
  return built
}

function signInRequest(email: string, password: string) {
  return new Request('http://localhost:4444/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

// Public sign-up is disabled (invite-only — see disableSignUp in packages/auth/src/index.ts), so
// these fixtures create the user server-side via internalAdapter.createUser + linkAccount, the
// same path first-run setup/ensureLocalOwner/admin-invite use. Mirrors the makeOwner helper in
// packages/auth/test/auth-events.test.ts.
async function createUser(auth: ReturnType<typeof createAuth>, email: string, password: string) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email, name: 'A', role: 'author', emailVerified: true })
  const hashed = await ctx.password.hash(password)
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hashed })
  return user
}

describe('login.failure — wrapper-at-mount fallback (POST /api/auth/sign-in/email, status >= 400)', () => {
  it('fires login.failure exactly once on a wrong password, and does NOT double-fire login.success', async () => {
    const events: AuthEvent[] = []
    const { app, auth } = build((e) => events.push(e))
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    events.length = 0 // clear user.created noise

    const res = await app.fetch(signInRequest('a@b.co', 'totally-wrong-password'))
    expect(res.status).toBe(401)

    const failures = events.filter((e) => e.type === 'login.failure')
    expect(failures).toHaveLength(1)
    expect(events.filter((e) => e.type === 'login.success')).toHaveLength(0)
  })

  it('does NOT fire login.failure on a successful sign-in', async () => {
    const events: AuthEvent[] = []
    const { app, auth } = build((e) => events.push(e))
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    events.length = 0

    const res = await app.fetch(signInRequest('a@b.co', 'hunter2hunter2'))
    expect(res.status).toBe(200)
    expect(events.filter((e) => e.type === 'login.failure')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'login.success')).toHaveLength(1)
  })

  it('does NOT fire login.failure for unrelated /api/auth/* 4xx responses (e.g. disabled public sign-up)', async () => {
    const events: AuthEvent[] = []
    const { app } = build((e) => events.push(e))

    const res = await app.fetch(
      new Request('http://localhost:4444/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dup@b.co', password: 'hunter2hunter2', name: 'A' }),
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(events.filter((e) => e.type === 'login.failure')).toHaveLength(0)
  })

  it('the emitted login.failure event never carries the attempted password', async () => {
    const events: AuthEvent[] = []
    const { app, auth } = build((e) => events.push(e))
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    events.length = 0

    await app.fetch(signInRequest('a@b.co', 'a-secret-guessed-password'))

    expect(JSON.stringify(events)).not.toContain('a-secret-guessed-password')
  })
})
