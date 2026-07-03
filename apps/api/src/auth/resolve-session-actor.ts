import type { Actor, Role } from '@setu/core'
import type { AuthInstance } from '@setu/auth'
import type { ResolveActor } from './resolve-actor'

const ROLES: readonly string[] = ['owner', 'publisher', 'editor', 'author', 'viewer']

// better-auth's `admin` plugin adds `role`/`banned` to the user record at runtime (and in the
// actual DB schema — see packages/db-sqlite/src/schema.ts), but `AuthInstance`'s inferred
// `api.getSession()` return type doesn't carry plugin-added user fields through this generic
// instantiation. Narrow with a local type rather than `any`/`as unknown as` — the fields are
// guaranteed present by the admin plugin's schema, not a runtime assumption.
type SessionUser = NonNullable<Awaited<ReturnType<AuthInstance['api']['getSession']>>>['user']
type SessionUserWithAdminFields = SessionUser & { banned?: boolean | null; role?: string | null }

export function resolveSessionActor(auth: AuthInstance): ResolveActor {
  return async (req) => {
    try {
      const session = await auth.api.getSession({ headers: req.headers })
      const user = session?.user as SessionUserWithAdminFields | undefined
      if (!user || user.banned) return null
      const role = ROLES.includes(user.role ?? '') ? (user.role as Role) : 'viewer'
      return { id: user.id, role }
    } catch {
      return null // fail closed (#291)
    }
  }
}
