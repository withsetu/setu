import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '../src'

function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  return { db, createAuth: () => createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
  }) }
}

// Setu is invite-only (public sign-up is disabled — see disableSignUp in ../src/index.ts). Every
// user is created server-side via internalAdapter.createUser (first-run setup, ensureLocalOwner,
// or the admin plugin's createUser), never through the public sign-up route. Tests that merely
// need *a user to exist* create one this way, mirroring auth-events.test.ts's makeOwner helper.
async function createUser(auth: ReturnType<typeof createAuth>, email: string, password: string, role: 'author' | 'admin' = 'author') {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email, name: 'A', role, emailVerified: true })
  const hashed = await ctx.password.hash(password)
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hashed })
  return user
}

describe('createAuth', () => {
  it('public sign-up is disabled (invite-only — see #248)', async () => {
    const { createAuth: makeAuthInstance } = makeAuth()
    const auth = makeAuthInstance()
    await expect(
      auth.api.signUpEmail({ body: { email: 'attacker@b.co', password: 'hunter2hunter2', name: 'A' } }),
    ).rejects.toThrow(/sign up is not enabled/i)
  })

  it('signs in with email/password for a server-created user; default role author', async () => {
    const { db, createAuth: makeAuthInstance } = makeAuth()
    const auth = makeAuthInstance()
    const created = await createUser(auth, 'a@b.co', 'hunter2hunter2')
    expect(created.email).toBe('a@b.co')

    // Verify the persisted user has the default role of 'author' (#379: viewer removed)
    const persistedUser = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, created.id))
      .then((rows) => rows[0])
    expect(persistedUser?.role).toBe('author')

    const signin = await auth.api.signInEmail({
      body: { email: 'a@b.co', password: 'hunter2hunter2' },
      asResponse: true,
    })
    expect(signin.headers.get('set-cookie')).toMatch(/better-auth/)
  })

  it('rejects a wrong password', async () => {
    const { createAuth: makeAuthInstance } = makeAuth()
    const auth = makeAuthInstance()
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    await expect(
      auth.api.signInEmail({ body: { email: 'a@b.co', password: 'nope-nope-nope' } }),
    ).rejects.toThrow()
  })
})
