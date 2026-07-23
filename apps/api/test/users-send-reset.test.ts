import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** Same real, temp-file-backed better-auth harness as users-credential-status.test.ts. The
 *  send itself is an injected thunk (server.ts passes better-auth's server-side
 *  `auth.api.requestPasswordReset`), so tests assert against a spy — which email it was asked to
 *  send to, and that authz failures never reach it. */
function makeApp(opts: { withSend?: boolean } = { withSend: true }) {
  const dir = mkdtempSync(join(tmpdir(), 'users-send-reset-'))
  const dbFile = join(dir, 'auth.db')
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [TRUSTED_ORIGIN]
  })

  const sendSpy = vi.fn(async (_email: string) => {})
  const app = createUsersApi({
    db,
    resolveActor: resolveSessionActor(auth),
    ...(opts.withSend === false ? {} : { requestPasswordReset: sendSpy })
  })

  return {
    app,
    auth,
    db,
    sendSpy,
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function makeUser(
  auth: ReturnType<typeof createAuth>,
  opts: { email: string; name: string; role: string; password?: string }
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email: opts.email,
    name: opts.name,
    role: opts.role,
    emailVerified: true
  })
  if (opts.password) {
    const hashed = await ctx.password.hash(opts.password)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hashed
    })
  }
  return user
}

async function signInCookie(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function build(opts: { withSend?: boolean } = {}) {
  const built = makeApp(opts)
  cleanups.push(built.cleanup)
  return built
}

function post(body: unknown, cookie?: string) {
  return new Request('http://test/api/users/send-reset', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  })
}

// #500/#453: the admin-surface reset-email triggers (Users row action; the passwordless
// non-admin's own-password card) go through this server-gated route so better-auth's captcha
// plugin — which protects the PUBLIC /request-password-reset by default — keeps guarding the
// unauthenticated surface while authenticated staff aren't asked to solve bot challenges.
describe('POST /api/users/send-reset', () => {
  it('401s with no session', async () => {
    const { app, sendSpy } = build()
    const res = await app.fetch(post({ userId: 'anyone' }))
    expect(res.status).toBe(401)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('400s on a body that fails the zod schema', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'owner@test.com',
      name: 'Owner',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )

    for (const bad of [{}, { userId: '' }, { userId: 42 }, null]) {
      const res = await app.fetch(post(bad, cookie))
      expect(res.status).toBe(400)
    }
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('SELF: any signed-in role (even author, no users.view) may email THEMSELVES a reset link', async () => {
    const { app, auth, sendSpy } = build()
    const author = await makeUser(auth, {
      email: 'author@test.com',
      name: 'Author',
      role: 'author',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      auth,
      'author@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: author.id }, cookie))
    expect(res.status).toBe(200)
    expect(sendSpy).toHaveBeenCalledWith('author@test.com')
  })

  it('wrong actor: an editor (no users.view) targeting ANOTHER user gets 403 and no email is sent', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'editor@test.com',
      name: 'Editor',
      role: 'editor',
      password: 'a-strong-password-12'
    })
    const target = await makeUser(auth, {
      email: 'target@test.com',
      name: 'Target',
      role: 'author'
    })
    const cookie = await signInCookie(
      auth,
      'editor@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: target.id }, cookie))
    expect(res.status).toBe(403)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('wrong actor: a maintainer targeting a PEER maintainer gets 403 (rank is strict, mirrors the row-action UI)', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'maint@test.com',
      name: 'Maint',
      role: 'maintainer',
      password: 'a-strong-password-12'
    })
    const peer = await makeUser(auth, {
      email: 'peer@test.com',
      name: 'Peer',
      role: 'maintainer'
    })
    const cookie = await signInCookie(
      auth,
      'maint@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: peer.id }, cookie))
    expect(res.status).toBe(403)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('right actor: a maintainer targeting a below-rank editor gets 200 and the email goes to the TARGET', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'maint@test.com',
      name: 'Maint',
      role: 'maintainer',
      password: 'a-strong-password-12'
    })
    const editor = await makeUser(auth, {
      email: 'editor@test.com',
      name: 'Editor',
      role: 'editor'
    })
    const cookie = await signInCookie(
      auth,
      'maint@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: editor.id }, cookie))
    expect(res.status).toBe(200)
    expect(sendSpy).toHaveBeenCalledWith('editor@test.com')
  })

  it('an admin targeting a PEER admin gets 403 (outranks is strict; the UI hides reset on peer rows too)', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'admin1@test.com',
      name: 'Admin One',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const peer = await makeUser(auth, {
      email: 'admin2@test.com',
      name: 'Admin Two',
      role: 'admin'
    })
    const cookie = await signInCookie(
      auth,
      'admin1@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: peer.id }, cookie))
    expect(res.status).toBe(403)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('an unknown-role target is 403 even for an admin (fail closed; the UI gates on isKnownRole too)', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'owner@test.com',
      name: 'Owner',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const legacy = await makeUser(auth, {
      email: 'legacy@test.com',
      name: 'Legacy',
      role: 'viewer' // a real role removed in #379 — the realistic garbage value
    })
    const cookie = await signInCookie(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: legacy.id }, cookie))
    expect(res.status).toBe(403)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('404s on a nonexistent target for a users.view holder', async () => {
    const { app, auth, sendSpy } = build()
    await makeUser(auth, {
      email: 'owner@test.com',
      name: 'Owner',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: 'no-such-user' }, cookie))
    expect(res.status).toBe(404)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('409s honestly when password reset is not wired on this deployment (no thunk injected)', async () => {
    const { app, auth } = build({ withSend: false })
    const owner = await makeUser(auth, {
      email: 'owner@test.com',
      name: 'Owner',
      role: 'admin',
      password: 'a-strong-password-12'
    })
    const cookie = await signInCookie(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )

    const res = await app.fetch(post({ userId: owner.id }, cookie))
    expect(res.status).toBe(409)
  })
})
