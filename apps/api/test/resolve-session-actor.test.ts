import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '@setu/auth'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'

function makeAuth() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })
  return {
    db,
    auth: createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: ['http://localhost:5173']
    })
  }
}

// Public sign-up is disabled (invite-only — see disableSignUp in packages/auth/src/index.ts), so
// this fixture creates the user server-side via internalAdapter.createUser + linkAccount, the same
// path first-run setup/ensureLocalOwner/admin-invite use.
async function createUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string,
  role = 'author',
  name = 'A'
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    role,
    emailVerified: true
  })
  const hashed = await ctx.password.hash(password)
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hashed
  })
  return user
}

/** Signs in and resolves the actor for a freshly created user — shared by the gitAuthor tests. */
async function signInAndResolve(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return resolveSessionActor(auth)(
    new Request('http://x/', { headers: { cookie } })
  )
}

describe('resolveSessionActor', () => {
  it('maps a session to an Actor', async () => {
    const { auth } = makeAuth()
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    const actor = await signInAndResolve(auth, 'a@b.co', 'hunter2hunter2')
    expect(actor).toEqual({
      id: expect.any(String),
      role: 'author',
      gitAuthor: { name: 'A', email: 'a@b.co' }
    })
  })

  // #382 — the resolver also surfaces the session user's identity as `gitAuthor` so the commit
  // routes can stamp it server-side instead of trusting the client-supplied author.
  it('carries the session user identity as gitAuthor', async () => {
    const { auth } = makeAuth()
    await createUser(
      auth,
      'real@x.dev',
      'hunter2hunter2',
      'author',
      'Real Name'
    )
    const actor = await signInAndResolve(auth, 'real@x.dev', 'hunter2hunter2')
    expect(actor).toEqual({
      id: expect.any(String),
      role: 'author',
      gitAuthor: { name: 'Real Name', email: 'real@x.dev' }
    })
  })

  it('falls back to email as the author name when name is empty', async () => {
    const { auth } = makeAuth()
    await createUser(auth, 'noname@x.dev', 'hunter2hunter2', 'author', '')
    const actor = await signInAndResolve(auth, 'noname@x.dev', 'hunter2hunter2')
    expect(actor).toEqual({
      id: expect.any(String),
      role: 'author',
      gitAuthor: { name: 'noname@x.dev', email: 'noname@x.dev' }
    })
  })

  it('returns null for an unrecognized (non-staff) role — fails closed (#379)', async () => {
    const { auth } = makeAuth()
    // A future audience/read-only role that isn't in the staff ladder must NOT resolve to a
    // default staff actor — the caller then 401s.
    await createUser(auth, 'a@b.co', 'hunter2hunter2', 'subscriber')
    const res = await auth.api.signInEmail({
      body: { email: 'a@b.co', password: 'hunter2hunter2' },
      asResponse: true
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const actor = await resolveSessionActor(auth)(
      new Request('http://x/', { headers: { cookie } })
    )
    expect(actor).toBeNull()
  })

  it('returns null for no cookie', async () => {
    const { auth } = makeAuth()
    const actor = await resolveSessionActor(auth)(
      new Request('http://x/', { headers: {} })
    )
    expect(actor).toBeNull()
  })

  it('returns null for garbage cookie', async () => {
    const { auth } = makeAuth()
    const actor = await resolveSessionActor(auth)(
      new Request('http://x/', { headers: { cookie: 'garbage=value' } })
    )
    expect(actor).toBeNull()
  })

  it('returns null for banned user', async () => {
    const { db, auth } = makeAuth()
    const user = await createUser(auth, 'a@b.co', 'hunter2hunter2')
    // Sign in before banning to get a session cookie
    const res = await auth.api.signInEmail({
      body: { email: 'a@b.co', password: 'hunter2hunter2' },
      asResponse: true
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    // Ban the user by updating the database
    await db
      .update(userTable)
      .set({ banned: true })
      .where(eq(userTable.id, user.id))
    // Now try to use the previously valid session with a banned user
    const actor = await resolveSessionActor(auth)(
      new Request('http://x/', { headers: { cookie } })
    )
    expect(actor).toBeNull()
  })
})
