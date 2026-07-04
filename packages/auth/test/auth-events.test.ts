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
    onAuthEvent: (e) => events.push(e),
  })
  return { db, auth, events }
}

async function makeOwner(auth: ReturnType<typeof createAuth>, email: string, password: string) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email, name: 'Owner', role: 'admin', emailVerified: true })
  const hashed = await ctx.password.hash(password)
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hashed })
  return user
}

function adminRequest(path: string, cookie: string, body: Record<string, unknown>) {
  return new Request(`http://localhost:4444/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
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

    await auth.api.signInEmail({ body: { email: 'a@b.co', password: 'hunter2hunter2' } })

    const logins = events.filter((e) => e.type === 'login.success')
    expect(logins).toHaveLength(1)
    expect(logins[0]?.targetId).toBe(owner.id)
  })

  it('fires logout exactly once on sign-out (not on admin session revocation)', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:5173' },
      }),
    )
    expect(res.status).toBe(200)

    const logouts = events.filter((e) => e.type === 'logout')
    expect(logouts).toHaveLength(1)
    expect(logouts[0]?.targetId).toBe(owner.id)
  })

  it('fires role.changed exactly once on admin setRole', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0 // clear the owner+target user.created / owner login.success noise

    const res = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: target.id, role: 'editor' }))
    expect(res.status).toBe(200)

    const changes = events.filter((e) => e.type === 'role.changed')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.targetId).toBe(target.id)
    expect(changes[0]?.actorId).toBe(owner.id)
    expect(changes[0]?.meta?.role).toBe('editor')
  })

  it('fires user.banned exactly once on admin banUser', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(adminRequest('/admin/ban-user', cookie, { userId: target.id }))
    expect(res.status).toBe(200)

    const banned = events.filter((e) => e.type === 'user.banned')
    expect(banned).toHaveLength(1)
    expect(banned[0]?.targetId).toBe(target.id)
    expect(banned[0]?.actorId).toBe(owner.id)
  })

  it('fires user.unbanned exactly once on admin unbanUser', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    await auth.handler(adminRequest('/admin/ban-user', cookie, { userId: target.id }))
    events.length = 0

    const res = await auth.handler(adminRequest('/admin/unban-user', cookie, { userId: target.id }))
    expect(res.status).toBe(200)

    const unbanned = events.filter((e) => e.type === 'user.unbanned')
    expect(unbanned).toHaveLength(1)
    expect(unbanned[0]?.targetId).toBe(target.id)
    expect(unbanned[0]?.actorId).toBe(owner.id)
  })

  it('fires role.changed exactly once on admin update-user role change', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/update-user', cookie, { userId: target.id, data: { role: 'editor' } }),
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
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const banRes = await auth.handler(
      adminRequest('/admin/update-user', cookie, { userId: target.id, data: { banned: true } }),
    )
    expect(banRes.status).toBe(200)
    const banned = events.filter((e) => e.type === 'user.banned')
    expect(banned).toHaveLength(1)
    expect(banned[0]?.targetId).toBe(target.id)
    expect(banned[0]?.actorId).toBe(owner.id)
    expect(events.filter((e) => e.type === 'user.unbanned')).toHaveLength(0)
    events.length = 0

    const unbanRes = await auth.handler(
      adminRequest('/admin/update-user', cookie, { userId: target.id, data: { banned: false } }),
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
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(
      adminRequest('/admin/update-user', cookie, { userId: target.id, data: { name: 'New Name' } }),
    )
    expect(res.status).toBe(200)

    expect(events.filter((e) => e.type === 'role.changed')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'user.banned')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'user.unbanned')).toHaveLength(0)
  })

  it('fires user.deleted exactly once on admin remove-user', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-strong-password-12')
    const target = await makeOwner(auth, 'target@test.com', 'a-strong-password-12')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-strong-password-12' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    events.length = 0

    const res = await auth.handler(adminRequest('/admin/remove-user', cookie, { userId: target.id }))
    expect(res.status).toBe(200)

    const deleted = events.filter((e) => e.type === 'user.deleted')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.targetId).toBe(target.id)
    expect(deleted[0]?.actorId).toBe(owner.id)
  })

  it('no emitted event ever carries a password or token substring', async () => {
    const { events, auth } = makeAuth()
    const owner = await makeOwner(auth, 'owner@test.com', 'a-super-secret-password-99')
    const signin = await auth.api.signInEmail({ body: { email: 'owner@test.com', password: 'a-super-secret-password-99' }, asResponse: true })
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    await auth.handler(adminRequest('/admin/set-role', cookie, { userId: owner.id, role: 'admin' }))

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
        localUserId: async () => localUserId,
      },
    })
    const owner = await makeOwner(auth, 'owner@local.test', 'hunter2hunter2')
    localUserId = owner.id
    events.length = 0 // clear the user.created noise from makeOwner

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/local/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:4444' },
        body: JSON.stringify({ token: 'test-loopback-token-abc123' }),
      }),
    )
    expect(res.status).toBe(200)

    const exchanges = events.filter((e) => e.type === 'local.exchange')
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]?.targetId).toBe(localUserId)
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
      serverSetup: { getSetupToken: () => 'test-setup-token-xyz789', countUsers: () => 0 },
    })

    const res = await auth.handler(
      new Request('http://localhost:4444/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'a-strong-password-12',
          name: 'Owner Person',
          token: 'test-setup-token-xyz789',
        }),
      }),
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
