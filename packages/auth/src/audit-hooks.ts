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

function actorIdFrom(context: GenericEndpointContext): string | undefined {
  const session = (
    context.context as { session?: { user?: { id?: string } } } | undefined
  )?.session
  return session?.user?.id
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
    if (context?.path !== '/sign-in/email') return
    emit({ type: 'login.success', targetId: session.userId })
  }
}

export function sessionDeleteAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    session: { userId: string },
    context: GenericEndpointContext | null
  ): Promise<void> => {
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
    const actorId = actorIdFrom(context)
    if (context.path === '/admin/set-role') {
      const requestedRole = (context.body as { role?: unknown } | undefined)
        ?.role
      emit({
        type: 'role.changed',
        actorId,
        targetId: updated.id,
        meta: {
          role:
            typeof requestedRole === 'string'
              ? requestedRole
              : String(updated.role ?? '')
        }
      })
      return
    }
    if (context.path === '/admin/ban-user') {
      emit({ type: 'user.banned', actorId, targetId: updated.id })
      return
    }
    if (context.path === '/admin/unban-user') {
      emit({ type: 'user.unbanned', actorId, targetId: updated.id })
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
          targetId: updated.id
        })
      }
    }
  }
}

export function userDeleteAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    deleted: { id: string },
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (context?.path !== '/admin/remove-user') return
    emit({
      type: 'user.deleted',
      actorId: actorIdFrom(context),
      targetId: deleted.id
    })
  }
}
