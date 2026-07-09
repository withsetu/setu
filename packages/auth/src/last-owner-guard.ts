import { APIError } from '@better-auth/core/error'
import type { GenericEndpointContext } from '@better-auth/core'

// #364 generalization: this guard protects "the last account of the top role" — originally named
// around the pre-#362 `owner` role, now generalized to `lastAdmin*` naming throughout (identifiers,
// comments, and doc below all say admin/rank; only the user-facing message text is unchanged, since
// tests and any integration depend on its exact wording). The companion `rank-guard.ts` handles the
// separate, broader concern of a maintainer/editor/author managing users below their own rank —
// this file remains scoped to the single invariant of never allowing the last active admin to be
// demoted/banned/deleted.

/** better-auth's core `User` type predates the admin plugin's schema extension, so
 *  `internalAdapter.findUserById`'s inferred return type doesn't carry `role`/`banned` — the same
 *  typing gap Task 7 documented for `auth.api` (plugin-added fields erased by the base type). Both
 *  fields are real, always-present runtime columns once the admin plugin is registered (see
 *  packages/db-sqlite/src/schema.ts's `user` table) — this is a narrow, runtime-verified read, not
 *  an unchecked assumption. */
export interface UserWithAdminFields {
  role?: string | null
  banned?: boolean | null
}

/** better-auth's `databaseHooks.user.update.before` hook — the ONLY server-side chokepoint every
 *  user-row update funnels through (`internalAdapter.updateUser` -> `updateWithHooks`, verified in
 *  `node_modules/better-auth/dist/db/with-hooks.mjs`/`internal-adapter.mjs`), which is exactly what
 *  the admin plugin's `setRole` and `banUser` routes call internally
 *  (`node_modules/better-auth/dist/plugins/admin/routes.mjs`). Wiring this into `createAuth` itself
 *  (rather than only guarding it in the admin UI, as the pre-fix UsersSettings.tsx comment
 *  documented) means EVERY consumer — our own routes, a future public API, or a raw curl by any
 *  admin session — is covered, not just this client.
 *
 *  ## Mechanism, derived from installed better-auth 1.6.23 source (not assumed):
 *
 *  `updateWithHooks(data, where, model)` (with-hooks.mjs) invokes the hook as
 *  `toRun(data, context)` — TWO arguments only. `where` (which carries the target user id as
 *  `[{field:'id', value:userId}]`) is a separate closure variable and is NEVER forwarded to the
 *  hook. This means the hook's `data` argument alone (`{role: ...}` for setRole, `{banned: ...}`
 *  for banUser — both routes pass only the diff, not a merged user object) cannot answer "which
 *  user". Naively, this looks like exactly the gap the task brief warned about.
 *
 *  However, `context` (the hook's 2nd argument) is typed as `GenericEndpointContext` —
 *  `EndpointContext & { context: AuthContext }` (`@better-auth/core`'s
 *  `dist/types/context.d.mts`/`dist/context/endpoint-context.d.mts`) — NOT merely the bare
 *  `AuthContext`. Better-call's `dispatchAuthEndpoint` (`better-auth/dist/api/dispatch.mjs`) builds
 *  its `internalContext` as `{...input, context: {...}}` before calling
 *  `runWithEndpointContext(internalContext, ...)`, and `updateWithHooks` reads that SAME
 *  AsyncLocalStorage-scoped value via `getCurrentAuthContext()`. So `context` here is the full
 *  request-scoped endpoint context — including `context.body` (the endpoint's parsed+validated
 *  request body) and `context.path` (the route being dispatched) — NOT just adapter/db access.
 *
 *  Empirically confirmed (not just traced from types): a debug hook logging `context.body` for a
 *  real `POST /admin/set-role` request printed `{ userId: '...', role: 'author' }` — the exact
 *  target id and requested role, straight off `context.body`. Same shape confirmed for
 *  `/admin/ban-user`'s body (`{ userId, banReason?, banExpiresIn? }`). `context.context` is the
 *  real `AuthContext`, carrying `internalAdapter`/`adapter` for the admin-count query below.
 *
 *  ## `/admin/update-user` coverage (gap fix)
 *
 *  better-auth's admin plugin ALSO exposes `POST /admin/update-user` (`adminUpdateUser`,
 *  `dist/plugins/admin/routes.mjs`), a general user-field editor that accepts `role`/`banned`
 *  directly in its payload — an admin-session curl to it bypassed the guard entirely, since only
 *  `/admin/set-role` and `/admin/ban-user` were path-gated. Verified from the installed route
 *  source: its body schema is `{ userId: string, data: Record<string, any> }`, and the handler
 *  calls `ctx.context.internalAdapter.updateUser(ctx.body.userId, ctx.body.data)` — i.e. it funnels
 *  through the exact same `internalAdapter.updateUser` -> `updateWithHooks` chokepoint as
 *  setRole/banUser. That means BOTH shapes this hook already relies on carry over unchanged:
 *  the hook's `data` argument is `ctx.body.data` (the diff, so `data.role`/`data.banned` are read
 *  identically to the setRole/banUser case), and `context.body.userId` is still the target id at
 *  the top level of the full request body (not nested under `data`). So no new extraction logic is
 *  needed — only the path gate below grows to include this route, reusing the identical
 *  `removesAdminStatus`/admin-count logic for all three paths.
 *
 *  `context.path` disambiguates the three guarded routes from any other `user.update` (e.g. a
 *  profile-update flow, or Task 7's `ensureLocalOwner`/`serverSetup` — neither of which is reached
 *  through the admin plugin's HTTP dispatch, so `context` is `null` there per `with-hooks.mjs`'s
 *  own `.catch(() => null)` — this hook is a no-op for those non-HTTP internalAdapter call sites,
 *  which is correct: they are direct, trusted, bootstrap-time primitives, not admin-mutation
 *  surface).
 *
 *  ## Guard logic
 *
 *  Fires only for the dangerous transitions:
 *   - `/admin/set-role` or `/admin/update-user` with a `role` that is not (or does not include)
 *     `'admin'` — a demotion.
 *   - `/admin/ban-user` or `/admin/update-user` — either always sets `banned: true` (ban-user), or
 *     sets `data.banned === true` (update-user).
 *  For either, counts OTHER active admins (role `'admin'` AND NOT banned, excluding the target
 *  user id) via `context.context.adapter.count`. Zero others -> throws `APIError('BAD_REQUEST', {
 *  message: 'cannot remove the last admin' })`, aborting the update before it reaches the DB
 *  (fail-closed: the throw propagates out of `internalAdapter.updateUser` -> out of the admin
 *  route's `await` -> caught by `dispatchAuthEndpoint`'s `isAPIError` branch -> a real 400 HTTP
 *  response, verified empirically).
 *
 *  A promotion TOWARD admin (any other `role` value, or setting role to `'admin'`) is a no-op for
 *  this guard — it can only ever increase the active-admin count, so it is never blocked, including
 *  Task 7's first-owner-promotion path (the identifier predates #362/#364 but the mechanism is
 *  unchanged). Everything else (name changes, email changes, non-admin-
 *  role sets, unban, an `/admin/update-user` call that touches neither `role` nor `banned`) passes
 *  through untouched. */
export function lastAdminGuardHook() {
  return async (
    data: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return // no HTTP request context (e.g. bootstrap/internal calls) — not this guard's concern
    const path = context.path
    const isSetRole = path === '/admin/set-role'
    const isBanUser = path === '/admin/ban-user'
    const isUpdateUser = path === '/admin/update-user'
    if (!isSetRole && !isBanUser && !isUpdateUser) return

    const targetUserId = (context.body as { userId?: unknown } | undefined)
      ?.userId
    if (typeof targetUserId !== 'string' || !targetUserId) return // malformed body — let normal validation reject it

    // update-user's `data` param IS the diff (ctx.body.data, per adminUpdateUser's
    // `internalAdapter.updateUser(ctx.body.userId, ctx.body.data)` call) — identical shape to
    // setRole/banUser's `data`, so the same field reads apply across all three paths.
    const removesAdminStatus = isBanUser
      ? data.banned === true
      : isSetRole
        ? !roleSetIncludesAdmin(data.role)
        : // isUpdateUser: only a transition that actually TOUCHES role/banned can remove admin
          // status — an update-user call that changes name/email only must be a no-op here.
          (Object.prototype.hasOwnProperty.call(data, 'banned') &&
            data.banned === true) ||
          (Object.prototype.hasOwnProperty.call(data, 'role') &&
            !roleSetIncludesAdmin(data.role))
    if (!removesAdminStatus) return

    // Is the TARGET currently an active admin at all? If not (e.g. banning a non-admin, or
    // demoting someone who isn't currently admin), this transition can't be removing "the" admin.
    const target = (await context.context.internalAdapter.findUserById(
      targetUserId
    )) as (UserWithAdminFields & Record<string, unknown>) | null
    if (!target || target.role !== 'admin' || target.banned) return

    if (await isLastActiveAdmin(context, targetUserId)) {
      throw new APIError('BAD_REQUEST', {
        message: 'cannot remove the last admin'
      })
    }
  }
}

/** `role` on setRole's body may be a single string or an array of strings (better-auth supports
 *  multi-role assignment, `parseRoles` in admin/routes.mjs joins arrays with a comma before
 *  persisting) — but the persisted `data.role` this hook actually receives is ALWAYS the
 *  already-joined string form (see admin/routes.mjs: `updateUser(userId, { role: parseRoles(...) })`).
 *  Still defensive here in case a future/direct caller passes an array through some other path. */
function roleSetIncludesAdmin(role: unknown): boolean {
  if (Array.isArray(role)) return role.includes('admin')
  if (typeof role === 'string') return role.split(',').includes('admin')
  return false
}

/** Shared by both the update guard (above) and the delete guard (below): counts OTHER active
 *  admins (role `'admin'` AND NOT banned, excluding `targetUserId`) via `context.context.adapter`
 *  — the query itself doesn't depend on update vs. delete, only on "who is left besides the
 *  target". Returns true when the target is the LAST active admin (zero others exist). */
async function isLastActiveAdmin(
  context: GenericEndpointContext,
  targetUserId: string
): Promise<boolean> {
  const otherActiveAdmins = await context.context.adapter.count({
    model: 'user',
    where: [
      { field: 'id', operator: 'ne', value: targetUserId },
      { field: 'role', value: 'admin', connector: 'AND' },
      { field: 'banned', operator: 'ne', value: true, connector: 'AND' }
    ]
  })
  return otherActiveAdmins === 0
}

/** ## Deletion coverage (`/admin/remove-user`)
 *
 *  `POST /admin/remove-user` (`removeUser`, `dist/plugins/admin/routes.mjs`) deletes a user via
 *  `internalAdapter.deleteUser(ctx.body.userId)`, which calls `deleteWithHooks(..., 'user', ...)`
 *  (`dist/db/internal-adapter.mjs`) — a SEPARATE chokepoint from `updateWithHooks`, so the
 *  update-guard above never sees a delete. Deleting the last active admin bricks admin access with
 *  no `user.update.before` firing at all, which is exactly the gap this covers.
 *
 *  Confirmed from `@better-auth/core`'s `dist/types/init-options.d.mts` (`databaseHooks.user`):
 *  a `delete` hook family DOES exist in 1.6.23 — `before?: (user, context) => Promise<boolean |
 *  void>` / `after?: (user, context) => Promise<void>` — sibling to `create`/`update`. So this is a
 *  real, typed hook, not a workaround.
 *
 *  `deleteWithHooks(where, model)` (`dist/db/with-hooks.mjs`) reads the row FIRST —
 *  `entityToDelete = adapter.findMany({model, where, limit:1})[0]` — then calls
 *  `toRun(entityToDelete, context)`, i.e. the hook's 1st argument is the FULL target user row
 *  (already carrying `role`/`banned`), not a diff and not just a where-clause. That means, unlike
 *  the update guard, no extra `findUserById` round-trip is needed here — the row is handed to us
 *  directly. `context.path === '/admin/remove-user'` gates this to the one dangerous delete route
 *  (`removeUserBodySchema` is `{ userId: string }`, confirmed from the installed route source, and
 *  `context.body.userId` carries it identically to the update guard's paths).
 *
 *  Returning `false` from `delete.before` also aborts the delete (per `with-hooks.mjs`), but this
 *  throws `APIError('BAD_REQUEST', ...)` instead, matching the update guard's convention/message
 *  family and giving a real 400 with the same message rather than a silent no-op. */
export function lastAdminDeleteGuardHook() {
  return async (
    deletedUser: UserWithAdminFields & { id: string } & Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return // no HTTP request context (e.g. bootstrap/internal calls) — not this guard's concern
    if (context.path !== '/admin/remove-user') return

    const targetUserId = (context.body as { userId?: unknown } | undefined)
      ?.userId
    if (
      typeof targetUserId !== 'string' ||
      !targetUserId ||
      targetUserId !== deletedUser.id
    )
      return

    // Is the TARGET currently an active admin at all? If not, deleting them can't be removing
    // "the" admin.
    if (deletedUser.role !== 'admin' || deletedUser.banned) return

    if (await isLastActiveAdmin(context, targetUserId)) {
      throw new APIError('BAD_REQUEST', {
        message: 'cannot remove the last admin'
      })
    }
  }
}
