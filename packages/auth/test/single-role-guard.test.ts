import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '../src'

/** #630 — "one role per user" enforced where better-auth's set-role actually lands.
 *
 *  better-auth's admin plugin accepts `role: string | string[]` on `/admin/set-role`,
 *  `/admin/create-user` and `/admin/update-user`, and `parseRoles` joins an array with `,` before
 *  persisting — so `'admin,maintainer'` is a shape the DB will happily hold. Setu treats `Role` as
 *  a closed four-value union with a rank ladder everywhere else, and a SET has no rank: such a row
 *  used to 401 its owner out of every `/api/*` route (resolve-session-actor's exact match), hard-
 *  403 them in rank-guard (`rankOf('admin,maintainer') === 0`), and — until #625 — slip past the
 *  last-admin guard. The fix is to make the shape unrepresentable at the write boundary.
 *
 *  Harness mirrors rank-guard.test.ts: real in-memory sqlite + `auth.handler(...)`, i.e. the exact
 *  HTTP path a raw curl from a signed-in admin session would take — not a unit call to the hook. */

async function findUserRow(db: BetterSQLite3Database, id: string) {
  const rows = await db.select().from(userTable).where(eq(userTable.id, id))
  return rows[0]
}

function makeAuth() {
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: '../db-sqlite/drizzle' })
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173']
  })
  return { db, auth }
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
  const setCookie = res.headers.get('set-cookie')
  return (setCookie ?? '').split(';')[0] ?? ''
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

const PASSWORD = 'a-strong-password-12'

/** Signed-in admin + a plain author target, the shape most of these tests need. */
async function adminAndTarget() {
  const { db, auth } = makeAuth()
  await makeUser(auth, {
    email: 'admin@test.com',
    name: 'Admin',
    role: 'admin',
    password: PASSWORD
  })
  // A second admin so the last-admin guard is never the thing under test here.
  await makeUser(auth, {
    email: 'admin2@test.com',
    name: 'Admin Two',
    role: 'admin'
  })
  const target = await makeUser(auth, {
    email: 'author@test.com',
    name: 'Author',
    role: 'author'
  })
  const cookie = await signInCookie(auth, 'admin@test.com', PASSWORD)
  return { db, auth, target, cookie }
}

describe('single-role guard (#630)', () => {
  describe('/admin/set-role', () => {
    it('rejects an ARRAY multi-role assignment and leaves the row untouched', async () => {
      const { db, auth, target, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: target.id,
          role: ['editor', 'maintainer']
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect((await findUserRow(db, target.id))?.role).toBe('author')
    })

    it('rejects a COMMA-JOINED multi-role assignment', async () => {
      const { db, auth, target, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: target.id,
          role: 'editor,maintainer'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect((await findUserRow(db, target.id))?.role).toBe('author')
    })

    it('still allows a single valid role (the guard is not a blanket block)', async () => {
      const { db, auth, target, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: target.id,
          role: 'editor'
        })
      )
      expect(res.status).toBe(200)
      expect((await findUserRow(db, target.id))?.role).toBe('editor')
    })
  })

  describe('/admin/update-user', () => {
    it('rejects a multi-role value smuggled through the generic field editor', async () => {
      const { db, auth, target, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/update-user', cookie, {
          userId: target.id,
          data: { role: 'admin,author' }
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect((await findUserRow(db, target.id))?.role).toBe('author')
    })

    it('leaves a role-less update (name only) alone', async () => {
      const { db, auth, target, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/update-user', cookie, {
          userId: target.id,
          data: { name: 'Renamed' }
        })
      )
      expect(res.status).toBe(200)
      const row = await findUserRow(db, target.id)
      expect(row?.name).toBe('Renamed')
      expect(row?.role).toBe('author')
    })
  })

  describe('/admin/create-user', () => {
    it('rejects creating a user with a multi-role value', async () => {
      const { auth, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new@test.com',
          name: 'New',
          password: PASSWORD,
          role: ['maintainer', 'editor']
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it('still allows creating a user with a single valid role', async () => {
      const { auth, cookie } = await adminAndTarget()
      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new@test.com',
          name: 'New',
          password: PASSWORD,
          role: 'editor'
        })
      )
      expect(res.status).toBe(200)
    })
  })

  // The READ side of the contract: rows persisted BEFORE this guard existed must still work.
  // rank-guard resolved the ACTING role by exact string match, so a genuine multi-role admin
  // failed `actorRole === 'admin'`, then `rankOf('admin,maintainer')` returned 0 and the guard
  // hard-forbade them — locked out of every rank-guarded mutation despite better-auth's own
  // `hasPermission` authorizing them onto the route.
  describe('legacy multi-role rows still resolve (read-tolerant)', () => {
    it('a persisted multi-role admin can still set a role', async () => {
      const { db, auth } = makeAuth()
      const acting = await makeUser(auth, {
        email: 'multi@test.com',
        name: 'Multi Admin',
        role: 'admin',
        password: PASSWORD
      })
      const target = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      // Simulate the pre-guard persisted shape, bypassing the write path entirely.
      await db
        .update(userTable)
        .set({ role: 'maintainer,admin' })
        .where(eq(userTable.id, acting.id))
      const cookie = await signInCookie(auth, 'multi@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: target.id,
          role: 'editor'
        })
      )
      expect(res.status).toBe(200)
      expect((await findUserRow(db, target.id))?.role).toBe('editor')
    })
  })
})
