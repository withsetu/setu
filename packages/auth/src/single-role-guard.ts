import { APIError } from '@better-auth/core/error'
import type { GenericEndpointContext } from '@better-auth/core'
import { isSingleKnownRole, parseRoleSet } from '@setu/core'

/** #630 — "a Setu user holds exactly ONE role", enforced at the write boundary.
 *
 *  ## The inconsistency this closes
 *
 *  Three consumers disagreed about whether `role` is a scalar or a set:
 *   - `apps/api/src/auth/resolve-session-actor.ts` exact-matched the column against the four
 *     roles, so `'admin,maintainer'` resolved to a null actor -> **401 on every `/api/*` route**.
 *   - better-auth's own `hasPermission` (`dist/plugins/admin/has-permission.mjs`, 1.6.23) splits
 *     the role on `,` and authorizes if ANY component authorizes — so that same user kept full
 *     access to `/api/auth/admin/*`.
 *   - `rank-guard.ts` compared `actorRole === 'admin'` and then `rankOf('admin,maintainer')` -> 0,
 *     hard-forbidding a genuine multi-role admin (fail-closed and correct in isolation, but the
 *     wrong answer).
 *  Net effect: a multi-role admin was locked out of the app AND out of rank-guarded mutations
 *  while still holding raw better-auth admin power. #625 had already made `last-owner-guard.ts`
 *  comma-aware; these were the consumers left behind.
 *
 *  ## The contract chosen, and why
 *
 *  **Single-role, enforced on write; comma-tolerant on read.** Setu models `Role` as a closed
 *  four-value union with a strict rank ladder (`packages/core/src/authz/`) — `Actor.role`,
 *  `PermissionMatrix`, `DEFAULT_ROLES`, `outranks` all assume one value, and a SET has no
 *  well-defined rank, so "parse comma sets everywhere" would mean inventing rank-of-a-set
 *  semantics in three places and keeping them agreeing forever. Making the shape unrepresentable
 *  is strictly less surface. The read paths stay tolerant (`canonicalRoleOf` — highest known
 *  component) purely so a row persisted BEFORE this guard resolves instead of bricking its
 *  owner's access; nothing can create such a row any more.
 *
 *  ## Where better-auth's set-role actually lands (verified, not assumed)
 *
 *  Blocking it "at the boundary" cannot mean tightening our own Zod — Setu never proxies these
 *  writes. better-auth's admin plugin owns three routes that persist `role`, and its
 *  `setRoleBodySchema` accepts `z.string() | z.array(z.string())`:
 *   - `/admin/set-role` and `/admin/update-user` -> `internalAdapter.updateUser` -> the
 *     `user.update.before` databaseHook.
 *   - `/admin/create-user` -> `internalAdapter.createUser` -> the `user.create.before` hook.
 *  `parseRoles` joins an array with `,` BEFORE persisting, so by the time either hook runs the
 *  value is always the joined STRING form — one shape to validate, on both chokepoints.
 *
 *  Empirically confirmed by this file's test: a plain comma STRING (`role: 'editor,maintainer'`)
 *  is already rejected upstream by better-auth's own role validation, but the ARRAY form
 *  (`role: ['editor','maintainer']`) sailed through and persisted `'editor,maintainer'` — which is
 *  exactly why the guard has to sit at the databaseHook chokepoint, after `parseRoles`, and not at
 *  a request schema.
 *
 *  Runs FIRST in both composed hook chains (see `index.ts`): shape validation precedes the rank
 *  and last-admin questions, neither of which has a defined answer for a malformed role. */

function rejectMultiRole(role: unknown): never {
  const components = parseRoleSet(role)
  throw new APIError('BAD_REQUEST', {
    message:
      components.length > 1
        ? 'a user may hold exactly one role — multi-role assignment is not supported'
        : 'unrecognized role'
  })
}

/** True when this write actually assigns a role. An absent/undefined/null `role` is not an
 *  assignment: `/admin/update-user` with a name-only diff, and any bootstrap create that lets
 *  better-auth's `defaultRole` fill it in, must both pass through untouched. */
function assignsRole(data: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(data, 'role') &&
    data.role !== undefined &&
    data.role !== null
  )
}

/** `user.create.before` — rejects a multi-role or unknown role on `/admin/create-user`. */
export function singleRoleGuardCreateHook() {
  return async (
    user: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return // bootstrap/internal call — see the note on the update hook below
    if (!assignsRole(user)) return
    if (!isSingleKnownRole(user.role)) rejectMultiRole(user.role)
  }
}

/** `user.update.before` — rejects a multi-role or unknown role on `/admin/set-role` and
 *  `/admin/update-user`.
 *
 *  Deliberately not gated to specific PATHS (unlike `rank-guard.ts`/`last-owner-guard.ts`, which
 *  enumerate the admin routes they care about): those guards answer "may THIS actor do this HERE",
 *  a request-scoped question. This one asserts a data-shape invariant that holds for every
 *  request-borne writer, so it covers any current or future route that persists a role — including
 *  `POST /update-user`, the session-gated self-edit route that #410 showed can carry a `role` field.
 *
 *  It IS gated on `context` being present, matching every sibling guard's "bootstrap/internal call
 *  — not this guard's concern" convention. `context` is `null` only for direct
 *  `internalAdapter` calls (`ensureLocalOwner`, the server-setup plugin, host-side seeding/
 *  maintenance scripts): trusted first-party primitives that never assign a multi-role value, and
 *  the only way to construct the legacy row shape the read path is deliberately tolerant of — the
 *  #625 last-admin fixtures and this file's own legacy-row test both need exactly that. The
 *  request surface is where better-auth's set-role actually lands and where the bad shape could
 *  ever originate, so gating there loses no real coverage. */
export function singleRoleGuardUpdateHook() {
  return async (
    data: Record<string, unknown>,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return
    if (!assignsRole(data)) return
    if (!isSingleKnownRole(data.role)) rejectMultiRole(data.role)
  }
}
