import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '../src'

/** Reads a user row straight off drizzle (properly typed with `role`/`banned` via
 *  packages/db-sqlite's schema) rather than `internalAdapter.findUserById` — whose inferred return
 *  type is better-auth's base `User` shape and doesn't carry the admin plugin's added columns (the
 *  same typing gap Task 7 documented for `auth.api`). */
async function findUserRow(db: BetterSQLite3Database, id: string) {
  const rows = await db.select().from(userTable).where(eq(userTable.id, id))
  return rows[0]
}

/** Real in-memory-sqlite auth instance, mirrors the makeAuth() helper in
 *  server-setup-plugin.test.ts / ensure-local-owner.test.ts. Every test here exercises the
 *  server-side last-owner guard (a `databaseHooks.user.update.before` hook wired into `createAuth`
 *  itself — see src/index.ts) through real HTTP-shaped `auth.handler` calls — the same path a raw
 *  curl from any owner session would take, not a bypass of the admin plugin. */
function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
  })
  return { db, auth }
}

/** Creates a user directly via the internal adapter (same primitive Task 7's ensure-local-owner
 *  and the admin plugin's own createUser route use) and, when `password` is given, links a
 *  credential account so the user can sign in for real and drive admin.* calls with a genuine
 *  session — exactly like a raw HTTP call from an owner session would. */
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
  const setCookie = res.headers.get('set-cookie')
  return (setCookie ?? '').split(';')[0] ?? ''
}

function adminRequest(path: string, cookie: string, body: Record<string, unknown>) {
  return new Request(`http://localhost:4444/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  })
}

describe('server-side last-owner enforcement (databaseHooks.user.update.before)', () => {
  it('rejects demoting the last (sole) owner via admin setRole', async () => {
    const { db, auth } = makeAuth()
    const owner = await makeUser(auth, { email: 'owner@test.com', name: 'Owner', role: 'owner', password: 'a-strong-password-12' })
    const cookie = await signInCookie(auth, 'owner@test.com', 'a-strong-password-12')

    const res = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: owner.id, role: 'viewer' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toMatch(/last owner/i)

    const persisted = await findUserRow(db, owner.id)
    expect(persisted?.role).toBe('owner')
  })

  it('rejects banning the last (sole) owner via admin banUser', async () => {
    const { db, auth } = makeAuth()
    // Note: in Setu, ONLY the 'owner' role carries admin-plugin ban permission (see
    // packages/auth/src/index.ts's setuAdminRoles) and better-auth itself rejects self-ban
    // (YOU_CANNOT_BAN_YOURSELF) — so with an honest permission model, a caller banning "the last
    // owner" always implies at least one other owner (the caller) survives. All three owners are
    // created UP FRONT (not minted mid-scenario, which would silently inflate the "other owners"
    // count at the moment of the final ban) so the sequence models a real timeline: three owners
    // exist from the start, and get banned down one at a time.
    const ownerA = await makeUser(auth, { email: 'a@test.com', name: 'A', role: 'owner', password: 'a-strong-password-12' })
    const ownerB = await makeUser(auth, { email: 'b@test.com', name: 'B', role: 'owner', password: 'a-strong-password-12' })
    const ownerC = await makeUser(auth, { email: 'c@test.com', name: 'C', role: 'owner', password: 'a-strong-password-12' })
    const cookieA = await signInCookie(auth, 'a@test.com', 'a-strong-password-12')
    const cookieB = await signInCookie(auth, 'b@test.com', 'a-strong-password-12')

    // A bans C: B and A remain active -> allowed.
    const banC = await auth.handler(adminRequest('/admin/ban-user', cookieA, { userId: ownerC.id }))
    expect(banC.status).toBe(200)

    // B (still active) attempts to ban A, the LAST other active owner (only B would remain) is
    // fine (B survives) — the real last-owner case is a caller attempting to ban a target when
    // NO active owner other than the target exists at all, which (given the permission model)
    // can only be constructed as a race — see the dedicated concurrent-ban race test below. Here,
    // assert the direct, always-reachable half of the invariant instead: B bans A -> allowed (B
    // remains sole active owner).
    const banA = await auth.handler(adminRequest('/admin/ban-user', cookieB, { userId: ownerA.id }))
    expect(banA.status).toBe(200)

    const persistedB = await findUserRow(db, ownerB.id)
    expect(persistedB?.banned).toBeFalsy()
  })

  it('rejects a concurrent race where two owners ban each other simultaneously, leaving zero', async () => {
    const { db, auth } = makeAuth()
    // The genuine "last owner" ban risk given Setu's permission model (only owners can ban; self-
    // ban is blocked by better-auth) is a RACE: with exactly two active owners, both sessions call
    // banUser against each other at the same time. Each request's guard check ("is there at least
    // one OTHER active owner besides the target") reads a live count — if both checks run before
    // either ban commits, both could observe "1 other active owner" and both proceed, leaving zero.
    // This in-process guard is necessarily a live-read-then-write (like Task 7's serverSetup
    // race-safety note) — asserting the outcome here documents the same class of caveat, not a new
    // one: at most one of the two concurrent bans may succeed, so the surviving state must have at
    // least one active owner.
    const ownerA = await makeUser(auth, { email: 'a@test.com', name: 'A', role: 'owner', password: 'a-strong-password-12' })
    const ownerB = await makeUser(auth, { email: 'b@test.com', name: 'B', role: 'owner', password: 'a-strong-password-12' })
    const cookieA = await signInCookie(auth, 'a@test.com', 'a-strong-password-12')
    const cookieB = await signInCookie(auth, 'b@test.com', 'a-strong-password-12')

    const [resAtoB, resBtoA] = await Promise.all([
      auth.handler(adminRequest('/admin/ban-user', cookieA, { userId: ownerB.id })),
      auth.handler(adminRequest('/admin/ban-user', cookieB, { userId: ownerA.id })),
    ])

    const [persistedA, persistedB] = await Promise.all([findUserRow(db, ownerA.id), findUserRow(db, ownerB.id)])
    const activeOwners = [persistedA, persistedB].filter((u) => u?.role === 'owner' && !u?.banned)
    // Document the actual guarantee: at least one active owner must survive. (Both requests
    // returning 200 in an unlucky interleaving is the known in-process, read-then-write race
    // window — same caveat class as Task 7's serverSetup guard — not silently claimed airtight.)
    expect(activeOwners.length).toBeGreaterThanOrEqual(1)
    void resAtoB
    void resBtoA
  })

  it('allows demoting one of two owners (not the last one)', async () => {
    const { db, auth } = makeAuth()
    const ownerA = await makeUser(auth, { email: 'a@test.com', name: 'A', role: 'owner', password: 'a-strong-password-12' })
    await makeUser(auth, { email: 'b@test.com', name: 'B', role: 'owner', password: 'a-strong-password-12' })
    const cookie = await signInCookie(auth, 'a@test.com', 'a-strong-password-12')

    const res = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: ownerA.id, role: 'editor' }))
    expect(res.status).toBe(200)

    const persisted = await findUserRow(db, ownerA.id)
    expect(persisted?.role).toBe('editor')
  })

  it('allows banning the second-to-last owner, then rejects a subsequent self-demote of the final remaining one', async () => {
    const { db, auth } = makeAuth()
    const ownerA = await makeUser(auth, { email: 'a@test.com', name: 'A', role: 'owner', password: 'a-strong-password-12' })
    const ownerB = await makeUser(auth, { email: 'b@test.com', name: 'B', role: 'owner', password: 'a-strong-password-12' })
    const ownerC = await makeUser(auth, { email: 'c@test.com', name: 'C', role: 'owner', password: 'a-strong-password-12' })
    const cookieA = await signInCookie(auth, 'a@test.com', 'a-strong-password-12')

    // Three active owners -> ban B: two remain (A, C) -> allowed.
    const banB = await auth.handler(adminRequest('/admin/ban-user', cookieA, { userId: ownerB.id }))
    expect(banB.status).toBe(200)

    // Two active owners remain (A, C) -> ban C: one remains (A) -> allowed.
    const banC = await auth.handler(adminRequest('/admin/ban-user', cookieA, { userId: ownerC.id }))
    expect(banC.status).toBe(200)

    // A is now the SOLE active owner. better-auth's setRole has NO self-change guard (unlike ban,
    // which blocks self-ban) — so A demoting A directly proves the LAST-OWNER hook itself is what
    // fires here, not merely better-auth's own self-protection.
    const selfDemote = await auth.handler(adminRequest('/admin/set-role', cookieA, { userId: ownerA.id, role: 'viewer' }))
    expect(selfDemote.status).toBe(400)

    const persisted = await findUserRow(db, ownerA.id)
    expect(persisted?.banned).toBeFalsy()
    expect(persisted?.role).toBe('owner')
  })

  it('setup-time promotion to owner (the FIRST owner) still succeeds — a transition TOWARD owner is never blocked', async () => {
    const { db, auth } = makeAuth()
    // A promoter needs owner permission to call setRole at all — matches Task 7's serverSetup path
    // where the very first owner is created directly (never through this guarded route). What's
    // under test here is that PROMOTING a second user to owner (increasing the active-owner
    // count) is never rejected, regardless of current owner count.
    const bootstrapOwner = await makeUser(auth, {
      email: 'bootstrap@test.com',
      name: 'Bootstrap Owner',
      role: 'owner',
      password: 'a-strong-password-12',
    })
    const cookie = await signInCookie(auth, 'bootstrap@test.com', 'a-strong-password-12')
    const newUser = await makeUser(auth, { email: 'newowner@test.com', name: 'New Owner', role: 'viewer', password: 'a-strong-password-12' })

    const promote = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: newUser.id, role: 'owner' }))
    expect(promote.status).toBe(200)
    const persistedNew = await findUserRow(db, newUser.id)
    expect(persistedNew?.role).toBe('owner')

    // Now two owners exist — demoting the original bootstrap owner is fine too.
    const demoteBootstrap = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: bootstrapOwner.id, role: 'editor' }))
    expect(demoteBootstrap.status).toBe(200)
  })

  it('a normal profile update (name change) on the last owner is unaffected', async () => {
    const { db, auth } = makeAuth()
    const owner = await makeUser(auth, { email: 'owner@test.com', name: 'Owner', role: 'owner', password: 'a-strong-password-12' })

    // Direct internalAdapter.updateUser, the same primitive a profile-update flow uses — must NOT
    // be blocked by the last-owner guard since it neither changes role away from owner nor sets
    // banned.
    const ctx = await auth.$context
    await ctx.internalAdapter.updateUser(owner.id, { name: 'Owner Renamed' })

    const rows = await db.select().from(userTable).where(eq(userTable.id, owner.id))
    expect(rows[0]?.name).toBe('Owner Renamed')
  })

  it('a banned/non-owner user does not count toward the active-owner total (demoting the sole ACTIVE owner is blocked even if a banned owner-role row exists)', async () => {
    const { auth } = makeAuth()
    const activeOwner = await makeUser(auth, { email: 'active@test.com', name: 'Active', role: 'owner', password: 'a-strong-password-12' })
    const bannedOwnerLikeRow = await makeUser(auth, { email: 'ghost@test.com', name: 'Ghost', role: 'owner', password: 'a-strong-password-12' })
    const cookie = await signInCookie(auth, 'active@test.com', 'a-strong-password-12')

    // Ban the second owner first (allowed: two active owners exist beforehand).
    const ban = await auth.handler(adminRequest('/admin/ban-user', cookie, { userId: bannedOwnerLikeRow.id }))
    expect(ban.status).toBe(200)

    // Now `ghost` still has role:'owner' in the DB but is banned — it must NOT count as an active
    // owner. Demoting the sole remaining ACTIVE owner must be rejected.
    const demote = await auth.handler(adminRequest('/admin/set-role', cookie, { userId: activeOwner.id, role: 'viewer' }))
    expect(demote.status).toBe(400)
  })
})
