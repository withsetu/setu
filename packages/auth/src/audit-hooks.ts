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
 *  - `role.changed` / `user.banned` / `user.unbanned` -> `databaseHooks.user.update.after`, path-
 *    dispatched exactly like last-owner-guard.ts's `before` hook (`/admin/set-role`,
 *    `/admin/ban-user`, `/admin/unban-user`). Unlike the `before` hook, `after`'s 1st argument
 *    (`updated`) is the FULL POST-UPDATE user row (not just the diff) — `updateWithHooks` in
 *    with-hooks.mjs calls `toRun(updated, context)` — so `updated.role`/`updated.banned` can be
 *    read directly rather than reconstructed from `context.body`. `context.body` is still used for
 *    `role.changed`'s meta (the requested role string) and to read `context.context.session` for
 *    the acting admin's id (the same `GenericEndpointContext.context.session` shape the admin
 *    plugin's own routes use internally to authorize the call in the first place). */

function actorIdFrom(context: GenericEndpointContext): string | undefined {
  const session = (context.context as { session?: { user?: { id?: string } } } | undefined)?.session
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
    context: GenericEndpointContext | null,
  ): Promise<void> => {
    if (context?.path !== '/sign-in/email') return
    emit({ type: 'login.success', targetId: session.userId })
  }
}

export function sessionDeleteAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    session: { userId: string },
    context: GenericEndpointContext | null,
  ): Promise<void> => {
    if (context?.path !== '/sign-out') return
    emit({ type: 'logout', targetId: session.userId })
  }
}

export function userUpdateAfterHook(emit: (e: AuthEvent) => void) {
  return async (
    updated: { id: string; role?: string | null; banned?: boolean | null },
    context: GenericEndpointContext | null,
  ): Promise<void> => {
    if (!context) return
    const actorId = actorIdFrom(context)
    if (context.path === '/admin/set-role') {
      const requestedRole = (context.body as { role?: unknown } | undefined)?.role
      emit({
        type: 'role.changed',
        actorId,
        targetId: updated.id,
        meta: { role: typeof requestedRole === 'string' ? requestedRole : String(updated.role ?? '') },
      })
      return
    }
    if (context.path === '/admin/ban-user') {
      emit({ type: 'user.banned', actorId, targetId: updated.id })
      return
    }
    if (context.path === '/admin/unban-user') {
      emit({ type: 'user.unbanned', actorId, targetId: updated.id })
    }
  }
}
