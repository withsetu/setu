import type { GenericEndpointContext } from '@better-auth/core'
import type { AuthEvent } from './events'

/** Mechanism notes (#248 Task 9), verified against installed better-auth 1.6.23 source (the same
 *  `databaseHooks` surface last-owner-guard.ts documents in depth — see that file for the deep
 *  derivation of `context`/`context.path`/`context.body` availability, which applies identically
 *  here). Each hook below is a thin `onAuthEvent` emitter, not a guard — it never blocks or
 *  mutates data, only observes the already-committed change and reports it.
 *
 *  - `user.created`   -> `databaseHooks.user.create.after`. Fires once per user row insert,
 *    regardless of the creating route (sign-up, admin createUser, ensureLocalOwner, serverSetup).
 *    `created` (the hook's 1st arg) is the full inserted user row.
 *  - `login.success`  -> `databaseHooks.session.create.after`, GATED on
 *    `context.path === '/sign-in/email'`. Session creation ALSO happens on `/sign-up/email`
 *    (better-auth's autoSignIn) and on our own `/local/exchange` / `/setup` plugin endpoints —
 *    none of those are "a login" in the audit sense (they're accounted for by their own event
 *    types: user.created, local.exchange, setup.completed), so gating on the exact sign-in path
 *    is what prevents double-counting a sign-up as a login. `session` (the hook's 1st arg) is the
 *    full created session row, carrying `userId`.
 *  - `logout`         -> `databaseHooks.session.delete.after`, GATED on
 *    `context.path === '/sign-out'`. Session deletion ALSO happens via admin
 *    revoke-user-session/revoke-user-sessions and impersonation stop — none of those are a
 *    self-service "logout", so the same path-gating discipline applies. `session` (the hook's
 *    1st arg) is the full deleted session row (fetched by `deleteWithHooks` BEFORE the delete),
 *    carrying `userId`.
 *
 *    #386: the event carries `meta: { passwordless: 'true' }` when the signing-out user has NO
 *    `account` row with `providerId === 'credential'` (e.g. a local-mode owner created by
 *    ensureLocalOwner, whose only way back in is the loopback handshake) — the audit trail's
 *    signal that this logout may be a lockout. Queried via `context.context.adapter.count`, the
 *    same request-scoped adapter access last-owner-guard.ts derives and documents in depth. The
 *    query runs AFTER the session delete, but sign-out never touches `account` rows, so the
 *    count is accurate. Absent (not 'false') for users who DO hold a credential account. On a
 *    query failure the event still fires, just without the meta — an audit emitter must never
 *    become the thing that breaks (or silences) sign-out.
 *  - `role.changed` / `user.banned` / `user.unbanned` -> `databaseHooks.user.update.after`, path-
 *    dispatched exactly like last-owner-guard.ts's `before` hook (`/admin/set-role`,
 *    `/admin/ban-user`, `/admin/unban-user`, and — mirroring last-owner-guard.ts's
 *    `/admin/update-user` coverage — `/admin/update-user` too). Unlike the `before` hook, `after`'s
 *    1st argument (`updated`) is the FULL POST-UPDATE user row (not just the diff) —
 *    `updateWithHooks` in with-hooks.mjs calls `toRun(updated, context)` — so
 *    `updated.role`/`updated.banned` can be read directly rather than reconstructed from
 *    `context.body`. `context.body` is still used for `role.changed`'s meta (the requested role
 *    string) and to read `context.context.session` for the acting admin's id (the same
 *    `GenericEndpointContext.context.session` shape the admin plugin's own routes use internally to
 *    authorize the call in the first place).
 *
 *    `/admin/update-user`'s body is `{ userId, data }` (`adminUpdateUser`,
 *    `dist/plugins/admin/routes.mjs`, same source last-owner-guard.ts derived its coverage from) —
 *    so unlike setRole/banUser, the touched fields live under `context.body.data`, not at the body's
 *    top level. Only a transition that actually TOUCHES `role` or `banned` emits anything (a
 *    name/email-only update-user call is a no-op here, same discipline as the guard).
 *
 *  - `user.deleted` -> `databaseHooks.user.delete.after`, GATED on
 *    `context.path === '/admin/remove-user'` — the same route last-owner-guard.ts's
 *    `lastAdminDeleteGuardHook` already guards via `delete.before`. `deleteWithHooks` in
 *    with-hooks.mjs calls `toRun(entityToDelete, context)` where `entityToDelete` is the FULL
 *    target row read BEFORE the delete (see last-owner-guard.ts's delete-guard doc), so `targetId`
 *    comes directly off that row's `id` — no `context.body` round-trip needed for the id, though
 *    the actor id still comes from `context.context.session` the same way as the other admin
 *    events. */

/** #632: who really performed this action, and (when they were wearing someone else's identity)
 *  whose identity that was.
 *
 *  `context.context.session` is better-auth's `{ session, user }` pair — the same shape the admin
 *  plugin's own `adminMiddleware` puts there (`dist/plugins/admin/routes.mjs:16-20`,
 *  `return { session }` from `getAuthoritativeSessionFromCtx`). During an impersonated session the
 *  `user` half is the IMPERSONATED user, so the pre-#632 `session.user.id` recorded a role change
 *  or ban against the VICTIM rather than the admin who actually did it. The session ROW carries
 *  `impersonatedBy` (set to `ctx.context.session.user.id`, the impersonating admin, at
 *  `routes.mjs:586`; persisted as `session.impersonated_by` in packages/db-sqlite's schema), so
 *  it's the authoritative "who really acted".
 *
 *  Both facts are kept: `actorId` becomes the real admin, and `meta.impersonating` names the
 *  assumed identity. An audit record that loses either one is misleading. */
interface ActorAttribution {
  actorId?: string
  /** Merged into the event's `meta` — `{ impersonating: <assumed user id> }`, or empty. */
  meta: Record<string, string>
}

function actorFrom(context: GenericEndpointContext): ActorAttribution {
  const session = (
    context.context as
      | {
          session?: {
            user?: { id?: string }
            session?: { impersonatedBy?: string | null }
          }
        }
      | undefined
  )?.session
  const sessionUserId = session?.user?.id
  const impersonatedBy = session?.session?.impersonatedBy
  if (impersonatedBy) {
    return {
      actorId: impersonatedBy,
      meta: sessionUserId ? { impersonating: sessionUserId } : {}
    }
  }
  return { actorId: sessionUserId, meta: {} }
}

/** Spread-in `meta` for events that carry no meta of their own — omitted entirely (rather than
 *  emitted as `{}`) when there is nothing to say, so a non-impersonated event's shape is
 *  byte-identical to what it was before #632. */
function metaOrNone(meta: Record<string, string>): {
  meta?: AuthEvent['meta']
} {
  return Object.keys(meta).length > 0 ? { meta } : {}
}

/** The `impersonatedBy` column off a session row, without widening the hook's declared parameter
 *  type (better-auth types session-hook arguments as `Session & Record<string, unknown>`, so the
 *  admin plugin's added column reads as `unknown` there). */
function impersonatedByOf(session: object): string | undefined {
  const value = (session as { impersonatedBy?: unknown }).impersonatedBy
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function userCreateAfterHook(emit: (e: AuthEvent) => void) {
  return async (created: { id: string }): Promise<void> => {
    emit({ type: 'user.created', targetId: created.id })
  }
}

export function sessionCreateAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    session: { userId: string },
    context: GenericEndpointContext | null
  ): Promise<void> => {
    // #632: `/admin/impersonate-user` creates a REAL session row through the same
    // `internalAdapter.createSession` -> `createWithHooks('session')` path as a login
    // (`dist/db/internal-adapter.mjs:162,201`; the route at `dist/plugins/admin/routes.mjs:585-588`
    // passes `impersonatedBy: ctx.context.session.user.id` as an override) — so this hook DOES
    // fire, it was simply being dropped by the sign-in path gate. The new row's `userId` is the
    // impersonated user and `impersonatedBy` the admin, which is exactly the actor/target pair.
    if (context?.path === '/admin/impersonate-user') {
      emit({
        type: 'impersonation.started',
        actorId: impersonatedByOf(session) ?? actorFrom(context).actorId,
        targetId: session.userId
      })
      return
    }
    if (context?.path !== '/sign-in/email') return
    emit({ type: 'login.success', targetId: session.userId })
  }
}

export function sessionDeleteAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    session: { userId: string },
    context: GenericEndpointContext | null
  ): Promise<void> => {
    // #632: `/admin/stop-impersonating` ends the impersonated session via
    // `internalAdapter.deleteSession` -> `deleteWithHooks('session')`
    // (`dist/db/internal-adapter.mjs:354,377`; the route at `dist/plugins/admin/routes.mjs:624-637`),
    // so this hook fires with the FULL pre-delete row — including `impersonatedBy`. That row, not
    // `context.context.session`, is the reliable source here: stop-impersonating uses
    // `getSessionFromCtx` rather than `adminMiddleware` (routes.mjs:623), so it does not populate
    // `context.context.session` the way the other admin routes do.
    if (context?.path === '/admin/stop-impersonating') {
      emit({
        type: 'impersonation.stopped',
        actorId: impersonatedByOf(session) ?? actorFrom(context).actorId,
        targetId: session.userId
      })
      return
    }
    if (context?.path !== '/sign-out') return
    // #386: flag passwordless sign-outs (no credential account row) — see the module doc.
    let passwordless = false
    try {
      const credentialAccounts = await context.context.adapter.count({
        model: 'account',
        where: [
          { field: 'userId', value: session.userId },
          { field: 'providerId', value: 'credential', connector: 'AND' }
        ]
      })
      passwordless = credentialAccounts === 0
    } catch {
      // Query failure must not block or silence the logout event — emit without the meta.
    }
    emit({
      type: 'logout',
      targetId: session.userId,
      ...(passwordless ? { meta: { passwordless: 'true' } } : {})
    })
  }
}

export function userUpdateAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    updated: { id: string; role?: string | null; banned?: boolean | null },
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!context) return
    const { actorId, meta: actorMeta } = actorFrom(context)
    if (context.path === '/admin/set-role') {
      const requestedRole = (context.body as { role?: unknown } | undefined)
        ?.role
      emit({
        type: 'role.changed',
        actorId,
        targetId: updated.id,
        meta: {
          ...actorMeta,
          role:
            typeof requestedRole === 'string'
              ? requestedRole
              : String(updated.role ?? '')
        }
      })
      return
    }
    if (context.path === '/admin/ban-user') {
      emit({
        type: 'user.banned',
        actorId,
        targetId: updated.id,
        ...metaOrNone(actorMeta)
      })
      return
    }
    if (context.path === '/admin/unban-user') {
      emit({
        type: 'user.unbanned',
        actorId,
        targetId: updated.id,
        ...metaOrNone(actorMeta)
      })
      return
    }
    if (context.path === '/admin/update-user') {
      // `data` (the diff) lives under `context.body.data` for this route — see the module doc.
      const data = (
        context.body as { data?: Record<string, unknown> } | undefined
      )?.data
      if (!data) return
      const touchesRole = Object.prototype.hasOwnProperty.call(data, 'role')
      const touchesBanned = Object.prototype.hasOwnProperty.call(data, 'banned')
      if (touchesRole) {
        const requestedRole = data.role
        emit({
          type: 'role.changed',
          actorId,
          targetId: updated.id,
          meta: {
            ...actorMeta,
            role:
              typeof requestedRole === 'string'
                ? requestedRole
                : String(updated.role ?? '')
          }
        })
      }
      if (touchesBanned) {
        emit({
          type: updated.banned ? 'user.banned' : 'user.unbanned',
          actorId,
          targetId: updated.id,
          ...metaOrNone(actorMeta)
        })
      }
    }
  }
}

/** #632: `POST /admin/set-user-password` — an admin setting ANOTHER user's password, the most
 *  direct account-takeover primitive the admin plugin exposes.
 *
 *  It never touches the `user` table, so `databaseHooks.user.update` cannot see it (the same
 *  reason rank-guard.ts documents for why it can't gate this route). It writes the `account`
 *  table instead, on one of two mutually exclusive branches
 *  (`dist/plugins/admin/routes.mjs:793-830`, `dist/db/internal-adapter.mjs:86,528`):
 *   - target already has a `providerId === 'credential'` account -> `internalAdapter.updatePassword`
 *     -> `updateManyWithHooks('account')` -> `databaseHooks.account.update.after`
 *   - target has none                                            -> `internalAdapter.createAccount`
 *     -> `createWithHooks('account')`     -> `databaseHooks.account.create.after`
 *  This one emitter is registered on BOTH; the route takes exactly one branch per call, so it
 *  fires exactly once. Path-gating keeps every other account write (sign-up linkAccount, the
 *  user-initiated changePassword and reset flows covered by #454) out of it.
 *
 *  `targetId` comes from `context.body.userId` rather than the hook's row argument on purpose:
 *  the `updateMany` branch's argument is the adapter's bulk-update result, not a user-bearing
 *  row. The row is deliberately never read at all here — it holds the freshly hashed password,
 *  and the safest handling of a secret is to not touch it. */
export function adminSetPasswordHook(emit: (e: AuthEvent) => void) {
  return async (
    _account: unknown,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (context?.path !== '/admin/set-user-password') return
    const targetId = (context.body as { userId?: unknown } | undefined)?.userId
    const { actorId, meta } = actorFrom(context)
    emit({
      type: 'admin.password-set',
      actorId,
      ...(typeof targetId === 'string' ? { targetId } : {}),
      ...metaOrNone(meta)
    })
  }
}

export function userDeleteAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    deleted: { id: string },
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (context?.path !== '/admin/remove-user') return
    const { actorId, meta } = actorFrom(context)
    emit({
      type: 'user.deleted',
      actorId,
      targetId: deleted.id,
      ...metaOrNone(meta)
    })
  }
}
