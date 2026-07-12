import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@setu/db-sqlite/schema'
import { createAuth } from '../src'

/** #364 rank guard — server-side enforcement that a maintainer (or below) can only manage users
 *  strictly below their own rank, and can only ever hand out a role strictly below their own rank.
 *  Template/pattern: last-owner-guard.test.ts (real in-memory sqlite + `auth.handler(adminRequest
 *  (...))`, exercising the exact HTTP path a raw curl from any session would take). */

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

describe('rank guard (databaseHooks + widened maintainer statements, #364)', () => {
  describe('/admin/create-user', () => {
    it('maintainer creates an editor -> 200', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new-editor@test.com',
          name: 'New Editor',
          role: 'editor',
          password: PASSWORD
        })
      )
      expect(res.status).toBe(200)
    })

    it('maintainer creates an author -> 200', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new-author@test.com',
          name: 'New Author',
          role: 'author',
          password: PASSWORD
        })
      )
      expect(res.status).toBe(200)
    })

    it('maintainer creates a maintainer -> 4xx', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new-maintainer@test.com',
          name: 'New Maintainer',
          role: 'maintainer',
          password: PASSWORD
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('maintainer creates an admin -> 4xx', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new-admin@test.com',
          name: 'New Admin',
          role: 'admin',
          password: PASSWORD
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('admin creates a maintainer (full management incl. peers) -> 200', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'admin@test.com',
        name: 'Admin',
        role: 'admin',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'admin@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'new-maintainer@test.com',
          name: 'New Maintainer',
          role: 'maintainer',
          password: PASSWORD
        })
      )
      expect(res.status).toBe(200)
    })
  })

  describe('/admin/set-role', () => {
    it('maintainer set-role author -> editor: 200', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: author.id,
          role: 'editor'
        })
      )
      expect(res.status).toBe(200)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.role).toBe('editor')
    })

    it('maintainer set-role author -> maintainer: 4xx (escalation to own rank)', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: author.id,
          role: 'maintainer'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.role).toBe('author')
    })

    it('maintainer set-role on an ADMIN target: 4xx', async () => {
      const { db, auth } = makeAuth()
      // A second admin exists so the last-admin guard doesn't also fire — isolating the rank check.
      await makeUser(auth, {
        email: 'admin-b@test.com',
        name: 'Admin B',
        role: 'admin'
      })
      const targetAdmin = await makeUser(auth, {
        email: 'admin-a@test.com',
        name: 'Admin A',
        role: 'admin'
      })
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: targetAdmin.id,
          role: 'editor'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, targetAdmin.id)
      expect(persisted?.role).toBe('admin')
    })

    it('fail-closed: target row with an unknown role string -> maintainer mutation 4xx', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const ghost = await makeUser(auth, {
        email: 'ghost@test.com',
        name: 'Ghost',
        role: 'some-legacy-role'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: ghost.id,
          role: 'author'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, ghost.id)
      expect(persisted?.role).toBe('some-legacy-role')
    })
  })

  describe('/admin/ban-user and /admin/unban-user', () => {
    it('maintainer bans an author -> 200', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/ban-user', cookie, { userId: author.id })
      )
      expect(res.status).toBe(200)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.banned).toBeTruthy()
    })

    it('maintainer unbans an author -> 200', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const ban = await auth.handler(
        adminRequest('/admin/ban-user', cookie, { userId: author.id })
      )
      expect(ban.status).toBe(200)

      const unban = await auth.handler(
        adminRequest('/admin/unban-user', cookie, { userId: author.id })
      )
      expect(unban.status).toBe(200)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.banned).toBeFalsy()
    })

    it('maintainer bans an admin -> 4xx', async () => {
      const { db, auth } = makeAuth()
      const admin = await makeUser(auth, {
        email: 'admin@test.com',
        name: 'Admin',
        role: 'admin'
      })
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/ban-user', cookie, { userId: admin.id })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, admin.id)
      expect(persisted?.banned).toBeFalsy()
    })

    it('maintainer bans a peer maintainer -> 4xx', async () => {
      const { db, auth } = makeAuth()
      const targetMaintainer = await makeUser(auth, {
        email: 'maintainer-b@test.com',
        name: 'Maintainer B',
        role: 'maintainer'
      })
      await makeUser(auth, {
        email: 'maintainer-a@test.com',
        name: 'Maintainer A',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'maintainer-a@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/ban-user', cookie, { userId: targetMaintainer.id })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, targetMaintainer.id)
      expect(persisted?.banned).toBeFalsy()
    })
  })

  describe('/admin/remove-user (delete stays admin-only)', () => {
    it('maintainer /admin/remove-user on an author -> 4xx (statements withhold delete)', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/remove-user', cookie, { userId: author.id })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      expect(await findUserRow(db, author.id)).toBeDefined()
    })
  })

  describe('/admin/set-user-password (not granted)', () => {
    it('maintainer /admin/set-user-password on an author -> 4xx (statements withhold set-password)', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'maintainer@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-user-password', cookie, {
          userId: author.id,
          newPassword: 'another-strong-password-1'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })
  })

  describe('editor/author on any admin mutation (unchanged)', () => {
    it('editor set-role -> 4xx (no admin-plugin statements)', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'editor@test.com',
        name: 'Editor',
        role: 'editor',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'editor@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: author.id,
          role: 'author'
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })

    it('author ban-user -> 4xx (no admin-plugin statements)', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'author-a@test.com',
        name: 'Author A',
        role: 'author',
        password: PASSWORD
      })
      const authorB = await makeUser(auth, {
        email: 'author-b@test.com',
        name: 'Author B',
        role: 'author'
      })
      const cookie = await signInCookie(auth, 'author-a@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/ban-user', cookie, { userId: authorB.id })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })
  })

  // #410/#364 escalation-filter pins (whole-branch review): none of the code above in this file
  // is what stops these three attacks — better-auth's OWN mechanisms are, and nothing in-repo
  // would go red if a dependency upgrade changed them. These tests exist purely so an upgrade that
  // weakens the underlying guard fails CI instead of shipping silently.
  describe('#410 self-escalation via POST /update-user (session-gated, NOT an /admin/* route)', () => {
    // The ONLY thing preventing this is better-auth's own field-level `input: false` filtering
    // (verified in installed better-auth@1.6.23's admin plugin schema, `dist/plugins/admin/
    // schema.mjs`: `role`/`banned`/`banReason`/`banExpires` are all declared `input: false`).
    // `parseInputData` (`dist/db/schema.mjs`) throws `FIELD_NOT_ALLOWED` (400) whenever such a
    // field is present in the body with a truthy value — there is no rank-guard.ts hook on this
    // path at all (`/update-user` isn't in `UPDATE_GUARDED_PATHS`, and it doesn't need to be, as
    // long as better-auth keeps this filter). A future better-auth upgrade that relaxed
    // `input: false` handling (or dropped it from these fields) would silently reopen
    // self-escalation with nothing in this repo noticing — hence pinning it here.
    it('author POSTs /update-user with { name, role: "admin" } -> 4xx, role unchanged', async () => {
      const { db, auth } = makeAuth()
      const author = await makeUser(auth, {
        email: 'author-esc@test.com',
        name: 'Author',
        role: 'author',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'author-esc@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/update-user', cookie, { name: 'x', role: 'admin' })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.role).toBe('author')
    })

    // `banned: false` is deliberately NOT used here: better-auth's `input: false` filter only
    // throws on a TRUTHY value for the field (`if (data[key]) throw ...` in `parseInputData`) —
    // `banned: false` is falsy, so it is silently dropped (200, no-op) rather than rejected.
    // Verified directly against the real harness before writing this test (an author POSTing
    // `{ name: 'y', banned: false }` returns 200 with `banned` untouched — never a security issue
    // since `false` is already the safe default and the field is never forwarded to
    // `internalAdapter.updateUser`). `banned: true` is the truthy escalation attempt that
    // exercises the same `input: false` guard as the role case above.
    it('author POSTs /update-user with { name, banned: true } -> 4xx, banned unchanged', async () => {
      const { db, auth } = makeAuth()
      const author = await makeUser(auth, {
        email: 'author-esc2@test.com',
        name: 'Author',
        role: 'author',
        password: PASSWORD
      })
      const cookie = await signInCookie(auth, 'author-esc2@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/update-user', cookie, { name: 'z', banned: true })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const persisted = await findUserRow(db, author.id)
      expect(persisted?.banned).toBeFalsy()
    })
  })

  describe('#364 triage (a): /admin/create-user role smuggled via `data.role` (body.role absent)', () => {
    // better-auth's own `/admin/create-user` handler (`dist/plugins/admin/routes.mjs`) already
    // folds `data.role` into `requestedRole` (`ctx.body.role ?? dataRole`) before resolving the
    // row it's about to persist, so `rankGuardCreateHook` (this package's `rank-guard.ts`) sees the
    // SAME already-resolved `user.role` regardless of which field carried it in the request body —
    // there is no separate code path to smuggle through today. This test pins that fact so a
    // future refactor of the create-user route (or of `rankGuardCreateHook` to read
    // `context.body.role` directly instead of the resolved `user.role`) can't reopen the gap
    // silently.
    it('maintainer creates a user via data:{role:"admin"} (no top-level role) -> 4xx, no row created', async () => {
      const { db, auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer-smuggle@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const cookie = await signInCookie(
        auth,
        'maintainer-smuggle@test.com',
        PASSWORD
      )

      const res = await auth.handler(
        adminRequest('/admin/create-user', cookie, {
          email: 'smuggled@test.com',
          name: 'Smuggled',
          password: PASSWORD,
          data: { role: 'admin' }
        })
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      const rows = await db
        .select()
        .from(userTable)
        .where(eq(userTable.email, 'smuggled@test.com'))
      expect(rows).toHaveLength(0)
    })
  })

  describe('#364 triage (b): /admin/update-user is maintainer-inaccessible entirely', () => {
    // Unlike /admin/set-role and /admin/ban-user (widened for maintainer), /admin/update-user's
    // underlying `update` statement is deliberately withheld from `setuAdminRoles.maintainer`
    // (see rank-guard.ts's file doc: "/admin/remove-user (delete) and /admin/set-user-password are
    // deliberately NOT included here ... withhold delete and set-password entirely" — update-user
    // is withheld the same way). better-auth's own `hasPermission` check 403s a maintainer before
    // any databaseHook or rank logic is reachable, for ANY field — not just role/banned. This pins
    // that the withheld statement, not a per-field guard, is what protects this route, so a future
    // statement-widening (the exact class of change that necessitated rank-guard.ts in the first
    // place) fails this test instead of silently opening the route.
    it('maintainer POSTs /admin/update-user with a harmless field (name) -> 403', async () => {
      const { auth } = makeAuth()
      await makeUser(auth, {
        email: 'maintainer-upd@test.com',
        name: 'Maintainer',
        role: 'maintainer',
        password: PASSWORD
      })
      const author = await makeUser(auth, {
        email: 'author-upd@test.com',
        name: 'Author',
        role: 'author'
      })
      const cookie = await signInCookie(
        auth,
        'maintainer-upd@test.com',
        PASSWORD
      )

      const res = await auth.handler(
        adminRequest('/admin/update-user', cookie, {
          userId: author.id,
          data: { name: 'New Name' }
        })
      )
      expect(res.status).toBe(403)
    })
  })

  describe('admin full management incl. peers (unchanged)', () => {
    it('admin set-role on a peer admin -> 200 (still subject to last-admin guard elsewhere)', async () => {
      const { db, auth } = makeAuth()
      const adminA = await makeUser(auth, {
        email: 'admin-a@test.com',
        name: 'Admin A',
        role: 'admin',
        password: PASSWORD
      })
      await makeUser(auth, {
        email: 'admin-b@test.com',
        name: 'Admin B',
        role: 'admin'
      })
      const cookie = await signInCookie(auth, 'admin-a@test.com', PASSWORD)

      const res = await auth.handler(
        adminRequest('/admin/set-role', cookie, {
          userId: adminA.id,
          role: 'maintainer'
        })
      )
      expect(res.status).toBe(200)
      const persisted = await findUserRow(db, adminA.id)
      expect(persisted?.role).toBe('maintainer')
    })
  })
})
