import { APIError } from '@better-auth/core/error'
import type { GenericEndpointContext } from '@better-auth/core'

/** better-auth's core `User` type predates the admin plugin's schema extension, so
 *  `internalAdapter.findUserById`'s inferred return type doesn't carry `role`/`banned` — the same
 *  typing gap Task 7 documented for `auth.api` (plugin-added fields erased by the base type). Both
 *  fields are real, always-present runtime columns once the admin plugin is registered (see
 *  packages/db-sqlite/src/schema.ts's `user` table) — this is a narrow, runtime-verified read, not
 *  an unchecked assumption. */
interface UserWithAdminFields {
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
 *  owner session — is covered, not just this client.
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
 *  real `POST /admin/set-role` request printed `{ userId: '...', role: 'viewer' }` — the exact
 *  target id and requested role, straight off `context.body`. Same shape confirmed for
 *  `/admin/ban-user`'s body (`{ userId, banReason?, banExpiresIn? }`). `context.context` is the
 *  real `AuthContext`, carrying `internalAdapter`/`adapter` for the owner-count query below.
 *
 *  `context.path` disambiguates the two guarded routes from any other `user.update` (e.g. a
 *  profile-update flow, or Task 7's `ensureLocalOwner`/`serverSetup` — neither of which is reached
 *  through the admin plugin's HTTP dispatch, so `context` is `null` there per `with-hooks.mjs`'s
 *  own `.catch(() => null)` — this hook is a no-op for those non-HTTP internalAdapter call sites,
 *  which is correct: they are direct, trusted, bootstrap-time primitives, not admin-mutation
 *  surface).
 *
 *  ## Guard logic
 *
 *  Fires only for the two dangerous transitions:
 *   - `/admin/set-role` with a `role` that is not (or does not include) `'owner'` — a demotion.
 *   - `/admin/ban-user` — always sets `banned: true`.
 *  For either, counts OTHER active owners (role `'owner'` AND NOT banned, excluding the target
 *  user id) via `context.context.adapter.count`. Zero others -> throws `APIError('BAD_REQUEST', {
 *  message: 'cannot remove the last owner' })`, aborting the update before it reaches the DB
 *  (fail-closed: the throw propagates out of `internalAdapter.updateUser` -> out of the admin
 *  route's `await` -> caught by `dispatchAuthEndpoint`'s `isAPIError` branch -> a real 400 HTTP
 *  response, verified empirically).
 *
 *  A promotion TOWARD owner (any other `role` value, or `/admin/set-role` setting role to
 *  `'owner'`) is a no-op for this guard — it can only ever increase the active-owner count, so it
 *  is never blocked, including Task 7's first-owner-promotion path. Everything else (name changes,
 *  email changes, non-owner-role sets, unban) passes through untouched. */
export function lastOwnerGuardHook() {
  return async (
    data: Record<string, unknown>,
    context: GenericEndpointContext | null,
  ): Promise<void> => {
    if (!context) return // no HTTP request context (e.g. bootstrap/internal calls) — not this guard's concern
    const path = context.path
    const isSetRole = path === '/admin/set-role'
    const isBanUser = path === '/admin/ban-user'
    if (!isSetRole && !isBanUser) return

    const targetUserId = (context.body as { userId?: unknown } | undefined)?.userId
    if (typeof targetUserId !== 'string' || !targetUserId) return // malformed body — let normal validation reject it

    const removesOwnerStatus = isBanUser
      ? data.banned === true
      : !roleSetIncludesOwner(data.role)
    if (!removesOwnerStatus) return

    // Is the TARGET currently an active owner at all? If not (e.g. banning a non-owner, or
    // demoting someone who isn't currently owner), this transition can't be removing "the" owner.
    const target = (await context.context.internalAdapter.findUserById(targetUserId)) as
      | (UserWithAdminFields & Record<string, unknown>)
      | null
    if (!target || target.role !== 'owner' || target.banned) return

    const otherActiveOwners = await context.context.adapter.count({
      model: 'user',
      where: [
        { field: 'id', operator: 'ne', value: targetUserId },
        { field: 'role', value: 'owner', connector: 'AND' },
        { field: 'banned', operator: 'ne', value: true, connector: 'AND' },
      ],
    })
    if (otherActiveOwners === 0) {
      throw new APIError('BAD_REQUEST', { message: 'cannot remove the last owner' })
    }
  }
}

/** `role` on setRole's body may be a single string or an array of strings (better-auth supports
 *  multi-role assignment, `parseRoles` in admin/routes.mjs joins arrays with a comma before
 *  persisting) — but the persisted `data.role` this hook actually receives is ALWAYS the
 *  already-joined string form (see admin/routes.mjs: `updateUser(userId, { role: parseRoles(...) })`).
 *  Still defensive here in case a future/direct caller passes an array through some other path. */
function roleSetIncludesOwner(role: unknown): boolean {
  if (Array.isArray(role)) return role.includes('owner')
  if (typeof role === 'string') return role.split(',').includes('owner')
  return false
}
