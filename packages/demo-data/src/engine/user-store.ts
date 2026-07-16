/** The default UserStore: better-auth's own internalAdapter over the
 *  sandbox's sqlite file (`<sandbox>/.setu/submissions.db` — the exact file
 *  the running api opens), via the shared `openInternalAuthContext` seam.
 *  This is the SAME creation path as apps/api's admin-invite,
 *  `ensureLocalOwner`, and `e2e/lib/seed-users.ts`: real scrypt-hashed
 *  credential accounts the live api verifies unchanged — never hand-forged
 *  rows or a parallel auth system.
 *
 *  Deletion uses `internalAdapter.deleteUser` (verified in the installed
 *  better-auth 1.6.23: `dist/db/internal-adapter.mjs` deletes the user's
 *  sessions + accounts + row, through databaseHooks — so the last-admin
 *  delete guard still applies and can reject; callers report, never crash).
 *
 *  Isolated in its own module (dynamically imported by the engine) so unit
 *  tests with injected fakes never load better-auth/drizzle/sqlite. */
import path from 'node:path'
import { openSqliteDb } from '@setu/db-sqlite'
import { openInternalAuthContext } from '@setu/auth'
import type { UserStore } from './types'

/** The sqlite file the api for `sandboxDir` opens (server.ts:
 *  `SETU_SUBMISSIONS_DB ?? <repoDir>/.setu/submissions.db`). */
export function submissionsDbFile(sandboxDir: string): string {
  return path.join(sandboxDir, '.setu', 'submissions.db')
}

export function createSqliteUserStore(dbFile: string): UserStore {
  // `$context` is a promise (better-auth resolves it lazily) — resolve once,
  // share across calls; the same await-shape as e2e/lib/seed-users.ts.
  const ctxPromise = openInternalAuthContext(openSqliteDb(dbFile))
  return {
    async findByEmail(email) {
      const ctx = await ctxPromise
      const found = await ctx.internalAdapter.findUserByEmail(email)
      return found ? { id: found.user.id } : null
    },
    async create(user) {
      const ctx = await ctxPromise
      const created = await ctx.internalAdapter.createUser({
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: true
      })
      await ctx.internalAdapter.linkAccount({
        userId: created.id,
        providerId: 'credential',
        accountId: created.id,
        password: await ctx.password.hash(user.password)
      })
      return { id: created.id }
    },
    async deleteById(id) {
      const ctx = await ctxPromise
      await ctx.internalAdapter.deleteUser(id)
    }
  }
}
