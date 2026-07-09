import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import type { EmailMessage } from '@setu/core'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth, type CreateAuthOptions } from '../src'

function makeAuth(email?: CreateAuthOptions['email']) {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  return {
    db,
    createAuth: () =>
      createAuth({
        db,
        secret: 'test-secret-32-chars-minimum!!!!',
        baseURL: 'http://localhost:4444',
        trustedOrigins: ['http://localhost:5173'],
        email
      })
  }
}

/** A minimal fake matching `CreateAuthOptions['email']`'s structural `send` shape — never a real
 *  transport (mirrors packages/email-testing's contract-harness style: record what was sent, don't
 *  actually deliver anything). resetRedirectTo mirrors what server.ts supplies —
 *  `<adminOrigin>/reset-password`, on the trusted admin origin. */
const ADMIN_RESET_ROUTE = 'http://localhost:5173/reset-password'
function makeFakeEmail() {
  const sent: EmailMessage[] = []
  return {
    sent,
    email: {
      send: async (msg: EmailMessage) => {
        sent.push(msg)
      },
      from: 'noreply@setu.test',
      resetRedirectTo: ADMIN_RESET_ROUTE
    }
  }
}

// Setu is invite-only (public sign-up is disabled — see disableSignUp in ../src/index.ts). Every
// user is created server-side via internalAdapter.createUser (first-run setup, ensureLocalOwner,
// or the admin plugin's createUser), never through the public sign-up route. Tests that merely
// need *a user to exist* create one this way, mirroring auth-events.test.ts's makeOwner helper.
async function createUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string,
  role: 'author' | 'admin' = 'author'
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email,
    name: 'A',
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

describe('createAuth', () => {
  it('public sign-up is disabled (invite-only — see #248)', async () => {
    const { createAuth: makeAuthInstance } = makeAuth()
    const auth = makeAuthInstance()
    await expect(
      auth.api.signUpEmail({
        body: { email: 'attacker@b.co', password: 'hunter2hunter2', name: 'A' }
      })
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
      asResponse: true
    })
    expect(signin.headers.get('set-cookie')).toMatch(/better-auth/)
  })

  it('rejects a wrong password', async () => {
    const { createAuth: makeAuthInstance } = makeAuth()
    const auth = makeAuthInstance()
    await createUser(auth, 'a@b.co', 'hunter2hunter2')
    await expect(
      auth.api.signInEmail({
        body: { email: 'a@b.co', password: 'nope-nope-nope' }
      })
    ).rejects.toThrow()
  })

  // #364: maintainers can trigger a password-reset EMAIL but never set a password directly (see
  // the `email` option's doc in options.ts + setuAdminRoles' withheld `set-password` statement).
  // This suite pins both halves of that contract at the createAuth level: reset stays disabled
  // with byte-for-byte the same error when no email transport is wired, and — when one is — the
  // real better-auth route sends a real link through it.
  describe('password reset (#364 email wiring)', () => {
    it('without an `email` option: /request-password-reset still throws RESET_PASSWORD_DISABLED (pinned pre-existing behavior)', async () => {
      const { createAuth: makeAuthInstance } = makeAuth()
      const auth = makeAuthInstance()
      await createUser(auth, 'a@b.co', 'hunter2hunter2')
      await expect(
        auth.api.requestPasswordReset({ body: { email: 'a@b.co' } })
      ).rejects.toThrow(/reset password isn't enabled/i)
    })

    it('with an `email` option: sends a reset email containing the better-auth reset link for an existing user', async () => {
      const { sent, email } = makeFakeEmail()
      const { createAuth: makeAuthInstance } = makeAuth(email)
      const auth = makeAuthInstance()
      await createUser(auth, 'a@b.co', 'hunter2hunter2')

      const res = await auth.api.requestPasswordReset({
        body: { email: 'a@b.co' }
      })
      expect(res.status).toBe(true)

      expect(sent).toHaveLength(1)
      expect(sent[0]?.to).toBe('a@b.co')
      expect(sent[0]?.from).toBe('noreply@setu.test')
      expect(sent[0]?.subject).toMatch(/reset/i)
      // better-auth's own reset link: `${ctx.context.baseURL}/reset-password/${token}?callbackURL=...`
      // (see dist/api/routes/password.mjs) — `ctx.context.baseURL` is `opts.baseURL` + `basePath`
      // ('/api/auth', set in index.ts), so assert the html carries an absolute link back to THIS
      // auth instance's mounted base and the /reset-password/ path, not just any string.
      expect(sent[0]?.html).toContain(
        'http://localhost:4444/api/auth/reset-password/'
      )
    })

    // Review fix: better-auth's /reset-password/:token handler 302s an EMPTY callbackURL to
    // ${apiBase}/error?error=INVALID_TOKEN (password.mjs line 115) — so a request WITHOUT
    // redirectTo used to email a guaranteed-dead link. The send path must fill in the default.
    it('a request WITHOUT redirectTo: the emailed link carries a non-empty callbackURL pointing at the admin reset route', async () => {
      const { sent, email } = makeFakeEmail()
      const { createAuth: makeAuthInstance } = makeAuth(email)
      const auth = makeAuthInstance()
      await createUser(auth, 'a@b.co', 'hunter2hunter2')

      await auth.api.requestPasswordReset({ body: { email: 'a@b.co' } })

      expect(sent).toHaveLength(1)
      const html = sent[0]!.html
      // Extract the actual link and decode its callbackURL — asserting on the parsed param, not a
      // substring, proves the link is one better-auth's callback route will actually accept.
      const href = /href="([^"]+)"/.exec(html)?.[1]
      expect(href).toBeDefined()
      const link = new URL(href!)
      expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/.+/) // token segment preserved
      expect(link.searchParams.get('callbackURL')).toBe(ADMIN_RESET_ROUTE)
    })

    it('a request WITH an explicit redirectTo keeps it (link untouched)', async () => {
      const { sent, email } = makeFakeEmail()
      const { createAuth: makeAuthInstance } = makeAuth(email)
      const auth = makeAuthInstance()
      await createUser(auth, 'a@b.co', 'hunter2hunter2')

      // Must be on a trusted origin — /request-password-reset originChecks the redirectTo body.
      const explicit = 'http://localhost:5173/my-custom-reset'
      await auth.api.requestPasswordReset({
        body: { email: 'a@b.co', redirectTo: explicit }
      })

      expect(sent).toHaveLength(1)
      const href = /href="([^"]+)"/.exec(sent[0]!.html)?.[1]
      expect(href).toBeDefined()
      const link = new URL(href!)
      expect(link.searchParams.get('callbackURL')).toBe(explicit)
      expect(link.searchParams.get('callbackURL')).not.toBe(ADMIN_RESET_ROUTE)
    })

    it('with an `email` option: a non-existent email does not error and does not send (better-auth anti-enumeration behavior, unchanged)', async () => {
      const { sent, email } = makeFakeEmail()
      const { createAuth: makeAuthInstance } = makeAuth(email)
      const auth = makeAuthInstance()

      const res = await auth.api.requestPasswordReset({
        body: { email: 'nobody@b.co' }
      })
      expect(res.status).toBe(true)
      expect(sent).toHaveLength(0)
    })
  })
})
