import type { Role } from '@setu/core'
import type { AuthInstance } from '@setu/auth'
import type { ResolveActor } from './resolve-actor'

const ROLES: readonly string[] = ['admin', 'maintainer', 'editor', 'author']

// better-auth's `admin` plugin adds `role`/`banned` to the user record at runtime (and in the DB
// schema — packages/db-sqlite/src/schema.ts), but `AuthInstance`'s inferred `getSession()` return
// type doesn't carry those plugin-added fields, so we narrow with a local type.
type SessionUser = NonNullable<
  Awaited<ReturnType<AuthInstance['api']['getSession']>>
>['user']
type SessionUserWithAdminFields = SessionUser & {
  banned?: boolean | null
  role?: string | null
}

export function resolveSessionActor(auth: AuthInstance): ResolveActor {
  return async (req) => {
    try {
      const session = await auth.api.getSession({ headers: req.headers })
      // The optional-prop intersection reads as a no-op to no-unnecessary-type-assertion, but the
      // cast is required for tsc to permit the `.banned`/`.role` access below (SessionUser lacks
      // them) — so the rule is a false positive here.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const user = session?.user as SessionUserWithAdminFields | undefined
      if (!user || user.banned) return null
      // #379: an unrecognized (e.g. future audience) role is not staff — resolve to no actor (fail
      // closed), never a default staff role.
      if (!ROLES.includes(user.role ?? '')) return null
      return { id: user.id, role: user.role as Role }
    } catch {
      return null // fail closed (#291)
    }
  }
}
