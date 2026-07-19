import { canonicalRoleOf } from '@setu/core'
import type { AuthInstance } from '@setu/auth'
import type { ResolveActor } from './resolve-actor'

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
      //
      // #630: comma-aware, via core's shared `canonicalRoleOf`. better-auth persists a multi-role
      // assignment as a comma-joined string (`'admin,maintainer'`) and its own `hasPermission`
      // grants if ANY component grants — so the old exact-match `ROLES.includes(...)` resolved
      // such a user to null and 401'd them out of EVERY `/api/*` route while better-auth happily
      // kept authorizing them on `/api/auth/admin/*`. Setu's contract is one role per user and the
      // write path now enforces it (packages/auth/src/single-role-guard.ts), but this read stays
      // tolerant so a row persisted before that guard resolves to its highest known component
      // rather than locking its owner out. An all-unknown value still resolves to null.
      const role = canonicalRoleOf(user.role)
      if (!role) return null
      // #382: surface the session user's identity as the git commit author — the display name if
      // set, else the (required) email — so the commit routes can stamp it server-side instead of
      // trusting whatever `author` the client's request body claims.
      return {
        id: user.id,
        role,
        gitAuthor: { name: user.name?.trim() || user.email, email: user.email }
      }
    } catch {
      return null // fail closed (#291)
    }
  }
}
