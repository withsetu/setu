import { DEFAULT_ROLES } from '@setu/core'
import type { Action, Role } from '@setu/core'

/** #631 — the single declared link between Setu's `Action` vocabulary and better-auth's
 *  admin-plugin statement vocabulary.
 *
 *  ## The drift this closes
 *
 *  Setu had TWO hand-maintained role tables and nothing connecting them:
 *   1. `packages/core/src/authz/default-roles.ts` — the Setu matrix (`DEFAULT_ROLES`), where
 *      MAINTAINER holds `users.invite`/`users.setRole`/`users.disable` and ADMIN adds
 *      `users.delete`/`roles.manage`.
 *   2. `setuAdminRoles` in `index.ts` — a second table in better-auth's statement vocabulary
 *      (`maintainer: { user: ['create','set-role','ban'] }`, admin adding `'delete'` and
 *      `'set-password'`).
 *
 *  The `satisfies Record<(typeof SETU_ROLES)[number], ...>` on table 2 only ever checked that the
 *  four role KEYS exist — nothing checked the ACTIONS agreed. That mattered more than it looks:
 *  `users.invite`, `users.setRole`, `users.disable` and `roles.manage` are never passed to
 *  `authz.can` anywhere in `apps/api/src`, so real enforcement of user management lives ENTIRELY
 *  in table 2. Adding one word — `'delete'` to `setuAdminRoles.maintainer` — silently granted
 *  every maintainer the power to delete users, past a route (`/admin/remove-user`) that
 *  `rank-guard.ts` explicitly documents as protected ONLY by the withheld statement, and no test
 *  in the repo would have gone red. Same shape as #561's two hand-maintained block tables.
 *
 *  ## How the link works
 *
 *  This file declares, for EVERY `Action`, how that action is actually enforced. Where the answer
 *  is "a better-auth statement", `betterAuthStatementsForRole` derives the statement set for a
 *  role straight from `DEFAULT_ROLES` — and `action-statements.test.ts` asserts the literal
 *  `setuAdminRoles` equals that derivation, per role. The literal is kept (rather than replaced by
 *  the derivation) deliberately: it stays greppable and directly comparable against better-auth's
 *  own docs, which is what a reader auditing this file needs — while the test makes it impossible
 *  for the two to disagree.
 *
 *  ## The subsumed-vs-forgotten distinction
 *
 *  11 of Setu's actions are enforced by no `authz.can` call at all. Some of those are correct
 *  (taxonomy writes ride `content.edit` because they go through the same commit route); some are
 *  genuine gaps. Absence alone could not tell them apart, so every action here must say which it
 *  is — `subsumed` names the action whose gate really runs, `unenforced` names the gap. This is
 *  documentation of the CURRENT state, not new enforcement; widening enforcement is out of scope
 *  and tracked separately. */

/** A better-auth admin-plugin statement, as `<resource>:<permission>`. Resources and permissions
 *  are better-auth's own (`defaultAc`'s statement map), not Setu's. */
export type BetterAuthStatement = `user:${string}` | `session:${string}`

export type ActionEnforcement =
  /** Enforced by better-auth's own `hasPermission` on an admin-plugin route, via these statements.
   *  Withholding the statement IS the gate — see rank-guard.ts's file doc. */
  | { via: 'better-auth'; statements: readonly BetterAuthStatement[] }
  /** Enforced server-side by a Setu `authz.can(actor, action)` call in `apps/api/src`. */
  | { via: 'setu-authz'; note: string }
  /** Not gated in its own right: the route it would guard is already gated by `by`. */
  | { via: 'subsumed'; by: Action; note: string }
  /** Known gap — the action exists in the vocabulary but nothing enforces it today. */
  | { via: 'unenforced'; note: string }

export const ACTION_ENFORCEMENT: Record<Action, ActionEnforcement> = {
  // --- Content -------------------------------------------------------------------------------
  'content.view': {
    via: 'setu-authz',
    note: 'history-api.ts and index-api.ts gate reads on it'
  },
  'content.create': {
    via: 'setu-authz',
    note: 'oembed.ts gates the URL-unfurl route on it'
  },
  'content.edit': {
    via: 'setu-authz',
    note: "app.ts's writeActionForChanges — the baseline action for any commit"
  },
  'content.publish': {
    via: 'setu-authz',
    note: 'writeActionForChanges escalates to it when a commit makes content live'
  },
  'content.delete': {
    via: 'subsumed',
    by: 'content.edit',
    note: 'a delete is a commit through the same write route; deleting LIVE content escalates to content.publish'
  },
  'content.unpublish': {
    via: 'subsumed',
    by: 'content.publish',
    note: 'unpublish-by-write touches committed-live content, which writeActionForChanges already escalates to content.publish'
  },

  // --- Taxonomy ------------------------------------------------------------------------------
  'taxonomy.view': {
    via: 'subsumed',
    by: 'content.view',
    note: 'taxonomy is read through the content index, behind the same gate'
  },
  'taxonomy.create': {
    via: 'subsumed',
    by: 'content.edit',
    note: 'taxonomy files are written through the shared commit route'
  },
  'taxonomy.edit': {
    via: 'subsumed',
    by: 'content.edit',
    note: 'taxonomy files are written through the shared commit route'
  },
  'taxonomy.delete': {
    via: 'subsumed',
    by: 'content.edit',
    note: 'taxonomy files are written through the shared commit route'
  },

  // --- Media ---------------------------------------------------------------------------------
  'media.view': { via: 'setu-authz', note: 'media.ts + index-api.ts' },
  'media.upload': { via: 'setu-authz', note: 'media.ts upload route' },
  'media.edit': { via: 'setu-authz', note: 'media.ts reprocess route' },
  'media.delete': { via: 'setu-authz', note: 'media.ts delete route' },

  // --- Forms / ops / config ------------------------------------------------------------------
  'forms.view': { via: 'setu-authz', note: 'forms.ts' },
  'forms.manage': { via: 'setu-authz', note: 'forms.ts' },
  'sitehealth.view': { via: 'setu-authz', note: 'sitehealth.ts' },
  'site.deploy': { via: 'setu-authz', note: 'deploy.ts' },
  'theme.manage': {
    via: 'setu-authz',
    note: "writeActionForChanges' PATH_WRITE_ACTION for theme-options.json"
  },
  'settings.manage': {
    via: 'setu-authz',
    note: "writeActionForChanges' PATH_WRITE_ACTION for settings.json"
  },
  'settings.view': {
    via: 'unenforced',
    note: 'admin-side only today (app.tsx RequireCan + the sidebar). Settings are read through the general git/content read paths, which carry no settings-specific gate; the WRITE side is fully gated by settings.manage, so this is a read-visibility gap, not a mutation hole.'
  },

  // --- Users & roles -------------------------------------------------------------------------
  // These four are the reason this file exists: NONE of them is ever passed to `authz.can`. The
  // statement map below is the whole of their server-side enforcement.
  'users.view': {
    via: 'setu-authz',
    note: "users.ts serves Setu's own roster rather than better-auth's user:list, so maintainers can see it without holding the admin-plugin directory statements"
  },
  'users.invite': {
    via: 'better-auth',
    statements: ['user:create']
  },
  'users.setRole': {
    via: 'better-auth',
    statements: ['user:set-role']
  },
  'users.disable': {
    via: 'better-auth',
    // ban-user and unban-user share the single `ban` statement (rank-guard.ts's file doc).
    statements: ['user:ban']
  },
  'users.delete': {
    via: 'better-auth',
    // /admin/remove-user is protected ONLY by withholding this statement — no rank-aware
    // databaseHook can gate it. demo.ts also `authz.can`s on users.delete for the demo reset,
    // but that is a separate route, not this one's gate.
    statements: ['user:delete']
  },
  'roles.manage': {
    via: 'unenforced',
    note: 'the data-driven roles editor (#360) does not exist yet — DEFAULT_ROLES is still the compile-time matrix, so there is no route to gate. Grant it no statement until there is.'
  }
}

/** Statements Setu grants `admin` that have NO `Action` counterpart, each with the reason it is
 *  admin-only. Kept explicit so the derivation stays total: every statement in `setuAdminRoles` is
 *  either mapped from an Action the matrix grants, or listed here — nothing arrives by accident.
 *
 *  `user:list`/`user:get`: better-auth's own user directory. Setu serves its roster from
 *  `apps/api/src/users.ts` under `users.view` instead, so maintainers never need these.
 *  `user:set-password`: deliberately admin-only — no rank-aware databaseHook can gate
 *  `/admin/set-user-password` (it never touches the `user` table), so maintainers get the
 *  password-RESET email lever instead (see options.ts's `email`).
 *  `user:impersonate`/`user:set-email`/`user:update`: out of scope for #364's rank-scoped user
 *  management; no Setu Action models them.
 *  `session:*`: session administration has no Setu Action at all. */
export const ADMIN_ONLY_EXTRA_STATEMENTS: readonly BetterAuthStatement[] = [
  'user:list',
  'user:get',
  'user:set-password',
  'user:impersonate',
  'user:set-email',
  'user:update',
  'session:list',
  'session:revoke',
  'session:delete'
]

/** The better-auth statement map a role should hold, DERIVED from the Setu matrix: the union of
 *  statements for every `Action` the role holds that is enforced via better-auth, plus the
 *  admin-only extras for `admin`. This is the function `setuAdminRoles` is tested against. */
export function betterAuthStatementsForRole(
  role: Role
): Record<string, string[]> {
  const statements: BetterAuthStatement[] = []
  for (const action of DEFAULT_ROLES[role]) {
    const mapping = ACTION_ENFORCEMENT[action]
    if (mapping.via === 'better-auth') statements.push(...mapping.statements)
  }
  if (role === 'admin') statements.push(...ADMIN_ONLY_EXTRA_STATEMENTS)

  const grouped: Record<string, string[]> = {}
  for (const statement of statements) {
    const [resource, permission] = statement.split(':') as [string, string]
    ;(grouped[resource] ??= []).push(permission)
  }
  return grouped
}
