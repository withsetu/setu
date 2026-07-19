import { APIError } from '@better-auth/core/error'
import type { GenericEndpointContext } from '@better-auth/core'
import { rankOf, outranks, canonicalRoleOf, parseRoleSet } from '@setu/core'
import type { UserWithAdminFields } from './last-owner-guard'

/** #364: server-side rank enforcement in the better-auth mutation pipeline. `last-owner-guard.ts`
 *  protects one narrow invariant (never demote/ban/delete the LAST active admin); this file is the
 *  broader generalization — a maintainer (or, defensively, any non-admin role) may only manage
 *  users strictly below their own rank, and may only ever hand out a role strictly below their own
 *  rank. Admins are exempt (full management, including peers) but remain subject to the last-admin
 *  guard, which still runs alongside this one (see `index.ts`'s composed `update.before`).
 *
 *  ## Why the admin-plugin's OWN permission model isn't enough (verified against installed
 *  better-auth 1.6.23 source, not assumed)
 *
 *  `hasPermission` (`dist/plugins/admin/has-permission.mjs`) is purely statement-based: it looks up
 *  `input.options.roles[input.role]` in the `roles` access-control map passed to the `admin()`
 *  plugin and calls `.authorize(input.permissions)` — nothing in that function (or in any of the
 *  route handlers in `dist/plugins/admin/routes.mjs`) consults `adminRoles` to gate `/admin/set-
 *  role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/create-user`, or `/admin/update-user`.
 *  `adminRoles` is used in exactly ONE place in the whole plugin (`routes.mjs` around the
 *  impersonate-user route): to decide whether the IMPERSONATION TARGET counts as "an admin" for the
 *  separate `allowImpersonatingAdmins` check — an unrelated feature. So once `setuAdminRoles.
 *  maintainer` is widened to carry `user: ['create', 'set-role', 'ban']` statements (needed so a
 *  maintainer can manage authors/editors at all), better-auth's own gate authorizes a maintainer on
 *  ALL of those routes for ANY target/role — including creating another maintainer, promoting an
 *  author to maintainer, or banning a fellow maintainer or an admin. Statements express "can call
 *  this endpoint at all", not "below whose rank". This guard is the missing per-call, per-target
 *  rank check.
 *
 *  `/admin/remove-user` (delete) and `/admin/set-user-password` are deliberately NOT included here:
 *  maintainer's statements withhold `delete` and `set-password` entirely, so better-auth's own
 *  `hasPermission` check in those routes already 403s a maintainer before any databaseHooks fire —
 *  no rank logic is reachable (or needed) for either.
 *
 *  ## Resolving the ACTING user's role from the hook context
 *
 *  Mirrors `last-owner-guard.ts`'s derivation: `context` here is the same live, AsyncLocalStorage-
 *  scoped `GenericEndpointContext` (`context.context` = the real `AuthContext`) that
 *  `updateWithHooks`/`createWithHooks` read via `getCurrentAuthContext()`. For the routes gated
 *  below, `context.context.session` is populated by the time our hook fires:
 *   - `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/update-user` all declare
 *     `use: [adminMiddleware]` (`routes.mjs`), and `adminMiddleware` resolves the session and
 *     RETURNS it (`return { session }`). better-call's `createInternalContext`
 *     (`better-call/dist/context.mjs`) merges each `use` middleware's returned object onto the
 *     endpoint's shared `context` object via `Object.assign(internalContext.context, response.
 *     response)` — the SAME object instance `dispatchAuthEndpoint` later hands to
 *     `runWithEndpointContext`, which is what `getCurrentAuthContext()` reads inside the
 *     `databaseHooks` call. So `context.context.session` is present and correct by the time
 *     `updateWithHooks` invokes this hook.
 *   - `/admin/create-user` does NOT use `adminMiddleware` — it calls
 *     `getAuthoritativeSessionFromCtx(ctx)` directly in its own handler body. That function bottoms
 *     out in `getSessionFromCtx` (`dist/api/routes/session.mjs`), which — as a caching side effect —
 *     assigns `ctx.context.session = session.response` directly onto the same shared context
 *     object, BEFORE the handler goes on to call `internalAdapter.createUser(...)`. So
 *     `context.context.session` is populated there too by the time `createWithHooks` invokes this
 *     hook.
 *  Empirically confirmed (not just traced from types): a debug `databaseHooks.user.update.before`
 *  hook logging `context.context.session` during a real `POST /admin/set-role` call from a signed-
 *  in admin printed the full session object, including `session.user.role: 'admin'`.
 *
 *  If `context.context.session` (or its `.user.role`) is missing, this guard fails closed — that
 *  shape only arises for a non-HTTP internal call reaching these paths without ever having resolved
 *  a session, which is not a legitimate admin-mutation caller. */

/** Every guarded databaseHook path this file cares about. `/admin/remove-user` and
 *  `/admin/set-user-password` are excluded on purpose — see the file doc above. */
const UPDATE_GUARDED_PATHS = new Set([
  '/admin/set-role',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/update-user'
])

function forbidden(message: string): never {
  throw new APIError('FORBIDDEN', { message })
}

/** True only when EVERY component of `role` is a known role strictly below `actorRank`. Used for
 *  "the role being newly assigned" (set-role/update-user/create-user) — a maintainer must never be
 *  able to hand out a role at or above their own rank, even indirectly via a multi-role string.
 *
 *  #630 made multi-role assignment unrepresentable (`single-role-guard.ts` runs ahead of this hook
 *  and rejects it outright), so `components` is a single element in practice. The per-component
 *  check is kept as defence in depth rather than collapsed to a scalar: an unknown component still
 *  fails closed here instead of silently reading as "rank 0, therefore below everyone".
 *  `parseRoleSet` is core's shared shape parser — the same one `canonicalRoleOf` and the
 *  last-admin guard use, so all four consumers now split roles identically (#630). */
function allComponentsBelowRank(role: unknown, actorRank: number): boolean {
  const components = parseRoleSet(role)
  if (components.length === 0) return false
  return components.every((r) => {
    const rank = rankOf(r)
    return rank > 0 && rank < actorRank
  })
}

/** Resolves the acting user's role off the hook's live session context. Returns `undefined` when
 *  no session (or no usable role) is present — callers must fail closed on that, not treat it as
 *  "rank 0 guest" (a guest should never reach these routes in the first place; `undefined` here
 *  signals a gap in our own assumptions, not a legitimate low-privilege caller).
 *
 *  #630: canonicalized through core's `canonicalRoleOf`, so a row persisted as a comma-joined
 *  multi-role value resolves to its HIGHEST known component. Previously this returned the raw
 *  column, and an `'admin,maintainer'` actor then failed `actorRole === 'admin'` below and hit
 *  `rankOf(...) === 0` -> hard forbidden, even though better-auth's own `hasPermission` (which
 *  splits on `,` and grants if ANY component grants) had already authorized them onto the route.
 *  Writes are now single-role-only (`single-role-guard.ts`); this is the read-tolerant half.
 *  A role with no known component still resolves to `undefined` — fail closed, unchanged. */
function resolveActorRole(context: GenericEndpointContext): string | undefined {
  const session = (
    context.context as unknown as {
      session?: { user?: { role?: string | null } }
    }
  ).session
  return canonicalRoleOf(session?.user?.role) ?? undefined
}

/** Gates `/admin/create-user`: a non-admin actor may only create a user whose (possibly comma-
 *  joined) role is strictly below their own rank. `admin`s are exempt entirely. No target user
 *  exists yet at creation time, so there is nothing to "outrank" — only the newly-assigned role
 *  needs checking. A create call with no `role` (default-role case) is always safe: `defaultRole`
 *  is `'author'`, the bottom of the ladder, strictly below every actor that can reach this route. */
export function rankGuardCreateHook() {
  return async (
    user: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return // bootstrap/internal call (ensureLocalOwner, serverSetup) — not this guard's concern
    if (context.path !== '/admin/create-user') return

    const actorRole = resolveActorRole(context)
    if (!actorRole)
      forbidden('cannot determine the acting user for this action')
    if (actorRole === 'admin') return // full management, incl. peers

    const actorRank = rankOf(actorRole)
    if (actorRank <= 0)
      forbidden('unrecognized role — cannot authorize this action')

    // `user.role` is the near-final row `createWithHooks` is about to persist — already resolved
    // from `ctx.body.role` (or `opts.defaultRole` when omitted) by the createUser route handler.
    if (
      Object.prototype.hasOwnProperty.call(user, 'role') &&
      user.role !== undefined &&
      user.role !== null &&
      !allComponentsBelowRank(user.role, actorRank)
    ) {
      forbidden('cannot assign a role at or above your own rank')
    }
  }
}

/** Gates `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/update-user`: a non-
 *  admin actor must strictly outrank the TARGET's current role, and — if this mutation assigns a
 *  new role — that role must also be strictly below the actor's own rank. `admin`s are exempt
 *  (still subject to the last-admin guard, composed alongside this one in `index.ts`).
 *
 *  Only fires for mutations that actually touch `role` or `banned` — a name/email-only `/admin/
 *  update-user` call is untouched (mirrors `last-owner-guard.ts`'s `removesAdminStatus` no-op
 *  shape), and unban/name-only calls on a target the actor already outranks are simply allowed. */
export function rankGuardUpdateHook() {
  return async (
    data: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return // bootstrap/internal call — not this guard's concern
    if (!UPDATE_GUARDED_PATHS.has(context.path)) return

    const touchesRole = Object.prototype.hasOwnProperty.call(data, 'role')
    const touchesBanned = Object.prototype.hasOwnProperty.call(data, 'banned')
    // set-role/ban-user/unban-user always touch exactly the field they're named for; update-user's
    // `data` is the raw diff, so only a payload that actually names `role`/`banned` is in scope.
    if (!touchesRole && !touchesBanned) return

    const actorRole = resolveActorRole(context)
    if (!actorRole)
      forbidden('cannot determine the acting user for this action')
    if (actorRole === 'admin') return // full management, incl. peers — last-admin guard still applies

    const actorRank = rankOf(actorRole)
    if (actorRank <= 0)
      forbidden('unrecognized role — cannot authorize this action')

    const targetUserId = (context.body as { userId?: unknown } | undefined)
      ?.userId
    if (typeof targetUserId !== 'string' || !targetUserId) return // malformed body — let normal validation reject it

    const target = (await context.context.internalAdapter.findUserById(
      targetUserId
    )) as (UserWithAdminFields & Record<string, unknown>) | null
    if (!target) return // target doesn't exist — let the route's own NOT_FOUND check handle it

    // #630: canonicalize the TARGET's role too, for the same reason as the actor's — a legacy
    // `'admin,maintainer'` target must read as an admin (rank 4), not as an unknown rank-0 row
    // that a maintainer would then be allowed to "outrank" and manage.
    const targetRole = canonicalRoleOf(target.role) ?? ''
    const targetRank = rankOf(targetRole)
    // Fail closed on an unknown/garbage target role: `outranks` alone treats an unrecognized target
    // as rank 0 (bottom of the ladder), which would let a known actor "outrank" it by default — see
    // rank.ts's own division-of-responsibility note. A real action must validate the target is a
    // KNOWN role first.
    if (targetRank <= 0)
      forbidden('cannot act on a user with an unrecognized role')
    if (!outranks(actorRole, targetRole)) {
      forbidden('cannot manage a user at or above your own rank')
    }

    if (touchesRole && !allComponentsBelowRank(data.role, actorRank)) {
      forbidden('cannot assign a role at or above your own rank')
    }
  }
}
