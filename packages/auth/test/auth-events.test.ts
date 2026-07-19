import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '../src'
import type { AuthEvent } from '../src/events'

/** Real in-memory-sqlite auth instance wired with a capturing `onAuthEvent` — mirrors the
 *  makeAuth() helper pattern used across this package's other test files (last-owner-guard,
 *  server-setup-plugin, etc). Every assertion below drives the REAL better-auth HTTP dispatch
 *  (auth.handler / auth.api), not a bypass — event emission must survive the real request path,
 *  the same one Task 8's last-owner guard was verified against. */
function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const events: AuthEvent[] = []
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    onAuthEvent: (e) => events.push(e)
  })
  return { db, auth, events }
}

async function makeOwner(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email,
    name: 'Owner',
    role: 'admin',
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

/** A user row with NO credential account — the shape of an invited/impersonation-target user. */
async function makeUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  role: string
) {
  const ctx = await auth.$context
  return await ctx.internalAdapter.createUser({
    email,
    name: email,
    role,
    emailVerified: true
  })
}

async function signInCookie(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password = 'a-strong-password-12'
) {
  const signin = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  return (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

/** Fold every `Set-Cookie` on a response into one `Cookie` request header. Impersonation sets
 *  several cookies (the impersonated session token AND the stashed `admin_session`), and
 *  `/admin/stop-impersonating` needs both — the single-header `.split(';')[0]` shortcut the
 *  older tests use would drop one of them. `/admin/impersonate-user` also calls
 *  `deleteSessionCookie(ctx)` BEFORE `setSessionCookie(ctx, …)`, so the session-token cookie is
 *  emitted twice (first blank/expired, then real): last-writer-wins per name, blanks dropped —
 *  which is exactly what a browser's cookie jar would end up holding. */
function cookieHeaderFrom(res: Response) {
  const jar = new Map<string, string>()
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (value === '') jar.delete(name)
    else jar.set(name, value)
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

function adminRequest(
  path: string,
  cookie: string,
  body: Record<string, unknown>
) {
  return new Request(`http://localhost:4444/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://localhost:5173'
    },
    body: JSON.stringify(body)
  })
}

describe('auth event emission — onAuthEvent', () => {
  it('fires user.created exactly once when a user is created (server-side, e.g. first-run setup/invite — public sign-up is disabled)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'a@b.co', 'hunter2hunter2')

    const created = events.filter((e) => e.type === 'user.created')
    expect(created).toHaveLength(1)
    expect(created[0]?.targetId).toBe(owner.id)
  })

  it('fires login.success exactly once on sign-in', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'a@b.co', 'hunter2hunter2')
    events.length = 0 // clear user.created noise from makeOwner

    await auth.api.signInEmail({
      body: { email: 'a@b.co', password: 'hunter2hunter2' }
    })

    const logins = events.filter((e) => e.type === 'login.success')
    expect(logins).toHaveLength(1)
    expect(logins[0]?.targetId).toBe(owner.id)
  })

  it('fires logout exactly once on sign-out (not on admin session revocation)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:5173' }
      })
    )
    expect(res.status).toBe(200)

    const logouts = events.filter((e) => e.type === 'logout')
    expect(logouts).toHaveLength(1)
    expect(logouts[0]?.targetId).toBe(owner.id)
    // #386: the owner HAS a credential account (makeOwner links one), so no passwordless meta.
    expect(logouts[0]?.meta?.passwordless).toBeUndefined()
  })

  it('fires role.changed exactly once on admin setRole', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0 // clear the owner+target user.created / owner login.success noise

    const res = await auth.handler(
      adminRequest('/admin/set-role', cookie, {
        userId: target.id,
        role: 'editor'
      })
    )
    expect(res.status).toBe(200)

    const changes = events.filter((e) => e.type === 'role.changed')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.targetId).toBe(target.id)
    expect(changes[0]?.actorId).toBe(owner.id)
    expect(changes[0]?.meta?.role).toBe('editor')
  })

  it('fires user.banned exactly once on admin banUser', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/ban-user', cookie, { userId: target.id })
    )
    expect(res.status).toBe(200)

    const banned = events.filter((e) => e.type === 'user.banned')
    expect(banned).toHaveLength(1)
    expect(banned[0]?.targetId).toBe(target.id)
    expect(banned[0]?.actorId).toBe(owner.id)
  })

  it('fires user.unbanned exactly once on admin unbanUser', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    await auth.handler(
      adminRequest('/admin/ban-user', cookie, { userId: target.id })
    )
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/unban-user', cookie, { userId: target.id })
    )
    expect(res.status).toBe(200)

    const unbanned = events.filter((e) => e.type === 'user.unbanned')
    expect(unbanned).toHaveLength(1)
    expect(unbanned[0]?.targetId).toBe(target.id)
    expect(unbanned[0]?.actorId).toBe(owner.id)
  })

  it('fires role.changed exactly once on admin update-user role change', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/update-user', cookie, {
        userId: target.id,
        data: { role: 'editor' }
      })
    )
    expect(res.status).toBe(200)

    const changes = events.filter((e) => e.type === 'role.changed')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.targetId).toBe(target.id)
    expect(changes[0]?.actorId).toBe(owner.id)
    expect(changes[0]?.meta?.role).toBe('editor')
  })

  it('fires user.banned/user.unbanned exactly once on admin update-user banned toggle', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const banRes = await auth.handler(
      adminRequest('/admin/update-user', cookie, {
        userId: target.id,
        data: { banned: true }
      })
    )
    expect(banRes.status).toBe(200)
    const banned = events.filter((e) => e.type === 'user.banned')
    expect(banned).toHaveLength(1)
    expect(banned[0]?.targetId).toBe(target.id)
    expect(banned[0]?.actorId).toBe(owner.id)
    expect(events.filter((e) => e.type === 'user.unbanned')).toHaveLength(0)
    events.length = 0

    const unbanRes = await auth.handler(
      adminRequest('/admin/update-user', cookie, {
        userId: target.id,
        data: { banned: false }
      })
    )
    expect(unbanRes.status).toBe(200)
    const unbanned = events.filter((e) => e.type === 'user.unbanned')
    expect(unbanned).toHaveLength(1)
    expect(unbanned[0]?.targetId).toBe(target.id)
    expect(unbanned[0]?.actorId).toBe(owner.id)
    expect(events.filter((e) => e.type === 'user.banned')).toHaveLength(0)
  })

  it('fires no role/ban event on an admin update-user call that only touches name', async () => {
    const { events, auth } = makeAuth()
    await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/update-user', cookie, {
        userId: target.id,
        data: { name: 'New Name' }
      })
    )
    expect(res.status).toBe(200)

    expect(events.filter((e) => e.type === 'role.changed')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'user.banned')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'user.unbanned')).toHaveLength(0)
  })

  it('fires user.deleted exactly once on admin remove-user', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-strong-password-12' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/remove-user', cookie, { userId: target.id })
    )
    expect(res.status).toBe(200)

    const deleted = events.filter((e) => e.type === 'user.deleted')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.targetId).toBe(target.id)
    expect(deleted[0]?.actorId).toBe(owner.id)
  })

  it('fires impersonation.started on admin impersonate-user, attributed to the impersonating admin (#632)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const victim = await makeUser(auth, 'victim@test.com', 'editor')
    const cookie = await signInCookie(auth, 'owner@test.com')
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/impersonate-user', cookie, { userId: victim.id })
    )
    expect(res.status).toBe(200)

    const started = events.filter((e) => e.type === 'impersonation.started')
    expect(started).toHaveLength(1)
    expect(started[0]?.actorId).toBe(owner.id)
    expect(started[0]?.targetId).toBe(victim.id)
    // Creating an impersonation session must NOT masquerade as a login.
    expect(events.filter((e) => e.type === 'login.success')).toHaveLength(0)
  })

  it('fires impersonation.stopped on admin stop-impersonating, attributed to the impersonating admin (#632)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const victim = await makeUser(auth, 'victim@test.com', 'editor')
    const adminCookie = await signInCookie(auth, 'owner@test.com')

    const impersonate = await auth.handler(
      adminRequest('/admin/impersonate-user', adminCookie, {
        userId: victim.id
      })
    )
    expect(impersonate.status).toBe(200)
    const impersonatedCookie = cookieHeaderFrom(impersonate)
    events.length = 0

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/admin/stop-impersonating', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: impersonatedCookie,
          origin: 'http://localhost:5173'
        }
      })
    )
    expect(res.status).toBe(200)

    const stopped = events.filter((e) => e.type === 'impersonation.stopped')
    expect(stopped).toHaveLength(1)
    expect(stopped[0]?.actorId).toBe(owner.id)
    expect(stopped[0]?.targetId).toBe(victim.id)
    // Ending an impersonation must NOT masquerade as the victim logging out.
    expect(events.filter((e) => e.type === 'logout')).toHaveLength(0)
  })

  it('fires admin.password-set on admin set-user-password, without leaking the new password (#632)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const target = await makeOwner(
      auth,
      'target@test.com',
      'a-strong-password-12'
    )
    const cookie = await signInCookie(auth, 'owner@test.com')
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/set-user-password', cookie, {
        userId: target.id,
        newPassword: 'takeover-password-777'
      })
    )
    expect(res.status).toBe(200)

    const set = events.filter((e) => e.type === 'admin.password-set')
    expect(set).toHaveLength(1)
    expect(set[0]?.actorId).toBe(owner.id)
    expect(set[0]?.targetId).toBe(target.id)
    expect(JSON.stringify(events)).not.toContain('takeover-password-777')
  })

  it('fires admin.password-set when the target had no credential account yet (#632)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    // No linkAccount — this user's `account` row is CREATED by set-user-password, not updated.
    const target = await makeUser(auth, 'passwordless@test.com', 'editor')
    const cookie = await signInCookie(auth, 'owner@test.com')
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/set-user-password', cookie, {
        userId: target.id,
        newPassword: 'takeover-password-777'
      })
    )
    expect(res.status).toBe(200)

    const set = events.filter((e) => e.type === 'admin.password-set')
    expect(set).toHaveLength(1)
    expect(set[0]?.actorId).toBe(owner.id)
    expect(set[0]?.targetId).toBe(target.id)
    expect(JSON.stringify(events)).not.toContain('takeover-password-777')
  })

  it('attributes an action taken WHILE impersonating to the real admin, recording the impersonated identity too (#632)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-strong-password-12'
    )
    const puppet = await makeUser(auth, 'maintainer@test.com', 'maintainer')
    const target = await makeUser(auth, 'target@test.com', 'author')
    const adminCookie = await signInCookie(auth, 'owner@test.com')

    const impersonate = await auth.handler(
      adminRequest('/admin/impersonate-user', adminCookie, {
        userId: puppet.id
      })
    )
    expect(impersonate.status).toBe(200)
    const impersonatedCookie = cookieHeaderFrom(impersonate)
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/set-role', impersonatedCookie, {
        userId: target.id,
        role: 'editor'
      })
    )
    expect(res.status).toBe(200)

    const changes = events.filter((e) => e.type === 'role.changed')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.targetId).toBe(target.id)
    // The audit trail must name the human who really acted…
    expect(changes[0]?.actorId).toBe(owner.id)
    // …AND whose identity they were wearing at the time.
    expect(changes[0]?.meta?.impersonating).toBe(puppet.id)
    expect(changes[0]?.meta?.role).toBe('editor')
  })

  it('no emitted event ever carries a password or token substring', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(
      auth,
      'owner@test.com',
      'a-super-secret-password-99'
    )
    const signin = await auth.api.signInEmail({
      body: { email: 'owner@test.com', password: 'a-super-secret-password-99' },
      asResponse: true
    })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    await auth.handler(
      adminRequest('/admin/set-role', cookie, {
        userId: owner.id,
        role: 'admin'
      })
    )

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('a-super-secret-password-99')
    // Every event's own keys are limited to type/actorId/targetId/meta (see AuthEvent) — assert
    // the shape directly rather than pattern-matching content, since legitimate ids are
    // themselves long opaque strings and a length-based regex can't distinguish them from a
    // leaked secret.
    const allowedKeys = new Set(['type', 'actorId', 'targetId', 'meta'])
    for (const e of events) {
      for (const key of Object.keys(e)) expect(allowedKeys.has(key)).toBe(true)
    }
  })
})

describe('auth event emission — direct plugin emission points', () => {
  it('fires local.exchange exactly once on a successful loopback token exchange', async () => {
    const db = drizzle(new Database(':memory:'))
    migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
    const events: AuthEvent[] = []
    let localUserId = ''
    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: ['http://localhost:5173'],
      onAuthEvent: (e) => events.push(e),
      localToken: {
        getToken: () => 'test-loopback-token-abc123',
        consume: () => {},
        localUserId: async () => localUserId
      }
    })
    const owner = await makeOwner(auth, 'owner@local.test', 'hunter2hunter2')
    localUserId = owner.id
    events.length = 0 // clear the user.created noise from makeOwner

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/local/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:4444' },
        body: JSON.stringify({ token: 'test-loopback-token-abc123' })
      })
    )
    expect(res.status).toBe(200)

    const exchanges = events.filter((e) => e.type === 'local.exchange')
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]?.targetId).toBe(localUserId)
  })

  it('fires logout with meta.passwordless="true" when the signing-out user has NO credential account (#386)', async () => {
    const db = drizzle(new Database(':memory:'))
    migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
    const events: AuthEvent[] = []
    let localUserId = ''
    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: ['http://localhost:5173'],
      onAuthEvent: (e) => events.push(e),
      localToken: {
        getToken: () => 'test-loopback-token-abc123',
        consume: () => {},
        localUserId: async () => localUserId
      }
    })
    // A local-mode owner created by ensureLocalOwner has NO credential account row — create the
    // user the same way (internalAdapter.createUser, no linkAccount) and sign in via the loopback
    // exchange, the only session-creation path such a user has.
    const ctx = await auth.$context
    const user = await ctx.internalAdapter.createUser({
      email: 'passwordless@local.test',
      name: 'Passwordless Owner',
      role: 'admin',
      emailVerified: true
    })
    localUserId = user.id

    const exchange = await auth.handler(
      new Request('http://localhost:4444/api/auth/local/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:4444' },
        body: JSON.stringify({ token: 'test-loopback-token-abc123' })
      })
    )
    expect(exchange.status).toBe(200)
    const cookie =
      (exchange.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:5173' }
      })
    )
    expect(res.status).toBe(200)

    const logouts = events.filter((e) => e.type === 'logout')
    expect(logouts).toHaveLength(1)
    expect(logouts[0]?.targetId).toBe(user.id)
    expect(logouts[0]?.meta?.passwordless).toBe('true')
  })

  it('fires setup.completed exactly once on a successful first-run server setup', async () => {
    const db = drizzle(new Database(':memory:'))
    migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
    const events: AuthEvent[] = []
    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: ['http://localhost:5173'],
      onAuthEvent: (e) => events.push(e),
      serverSetup: {
        getSetupToken: () => 'test-setup-token-xyz789',
        countUsers: () => 0
      }
    })

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'a-strong-password-12',
          name: 'Owner Person',
          token: 'test-setup-token-xyz789'
        })
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }

    const completed = events.filter((e) => e.type === 'setup.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.targetId).toBe(body.user.id)
    // setup.completed also fires user.created (via the generic databaseHooks.user.create.after
    // hook, same as any other user row insert) — that's expected, not a conflict: the two events
    // describe different facts (a row was created vs. first-run setup specifically completed).
    expect(events.filter((e) => e.type === 'user.created')).toHaveLength(1)
  })
})
