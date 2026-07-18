import type { Role } from './types'

/** The rank ladder behind "below-rank" scoping (epic #359 §rank-scoping, increment
 *  #364): admin > maintainer > editor > author. Higher number = more senior.
 *  Pure ordering data — carries no permission of its own; combine with the
 *  `Action` matrix in default-roles.ts for what a role may actually do. */
export const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  maintainer: 3,
  editor: 2,
  author: 1
}

/** Rank for a role string, 0 for anything not in `ROLE_RANK` (unknown role, the
 *  removed `viewer`, empty string, garbage input) — fail closed, never throws. */
export function rankOf(role: string): number {
  return ROLE_RANK[role as Role] ?? 0
}

/** Strict rank comparison: does `actor` outrank `target`? `rankOf(actor) >
 *  rankOf(target) && rankOf(actor) > 0` — equal rank never outranks (a
 *  maintainer does not outrank another maintainer), and an unknown/garbage
 *  actor role (rank 0) never outranks anyone.
 *
 *  Division of responsibility: this is pure rank ORDERING, not a fail-closed
 *  authorization decision by itself. An unknown/unparseable TARGET role also
 *  collapses to rank 0, so a known actor (rank > 0) will read as "outranking"
 *  a garbage target string too — e.g. `outranks('admin', 'garbage') === true`.
 *  That's correct for ordering (0 is the bottom of the ladder) but callers that
 *  gate a real action (e.g. `users.setRole` below-rank scoping) MUST separately
 *  validate the target is a known `Role` before trusting this result — do not
 *  use `outranks` alone as the authorization check for an unknown target. */
export function outranks(actor: string, target: string): boolean {
  return rankOf(actor) > rankOf(target) && rankOf(actor) > 0
}

/** #630 — the multi-role SHAPE, and Setu's contract for it.
 *
 *  better-auth's admin plugin accepts `role` as `string | string[]` on
 *  `/admin/set-role`, `/admin/create-user` and `/admin/update-user`, and its
 *  `parseRoles` helper joins an array with `,` before persisting — so the `user.role`
 *  COLUMN can legitimately hold `'admin,maintainer'`, and better-auth's own
 *  `hasPermission` authorizes such a user if ANY component authorizes.
 *
 *  Setu's contract (#630) is narrower: **a user holds exactly one role.** `Role` is a
 *  closed four-value union everywhere else in the codebase (`Actor.role`,
 *  `PermissionMatrix`, `DEFAULT_ROLES`, the rank ladder), and a set has no well-defined
 *  rank. The contract is enforced on the WRITE path (`single-role-guard.ts` in
 *  `@setu/auth` rejects any multi-role assignment before it reaches the DB).
 *
 *  These three helpers are the READ side, kept deliberately comma-tolerant so a row
 *  persisted BEFORE that guard existed still resolves to a usable actor instead of
 *  failing every request its owner makes. Read-tolerant, write-strict. */

/** Components of a possibly-comma-joined (or, defensively, array-shaped) role value.
 *  Empty list for absent/empty/garbage-typed input — never throws. */
export function parseRoleSet(role: unknown): string[] {
  const raw = Array.isArray(role)
    ? role.map((r) => String(r))
    : typeof role === 'string'
      ? role.split(',')
      : []
  return raw.map((r) => r.trim()).filter((r) => r.length > 0)
}

/** The single `Role` a (possibly multi-role) value resolves to: the HIGHEST-ranked
 *  KNOWN component, or `null` when no component is a known staff role.
 *
 *  Highest-ranked, not first-listed, because the set is unordered as far as better-auth
 *  is concerned and its own `hasPermission` grants if ANY component grants — resolving
 *  to the highest component is the only reading that doesn't silently under- OR
 *  over-authorize relative to what better-auth's admin routes will already allow that
 *  same user. `null` (not a default role) for an all-unknown value keeps the #379
 *  fail-closed behavior: an unrecognized role is not staff. */
export function canonicalRoleOf(role: unknown): Role | null {
  let best: Role | null = null
  for (const component of parseRoleSet(role)) {
    const rank = rankOf(component)
    if (rank > 0 && (best === null || rank > rankOf(best)))
      best = component as Role
  }
  return best
}

/** The WRITE-path contract check: is `role` exactly ONE known Setu role? Rejects
 *  multi-role sets, unknown roles, empty strings and non-string input alike. */
export function isSingleKnownRole(role: unknown): boolean {
  const components = parseRoleSet(role)
  return components.length === 1 && rankOf(components[0]!) > 0
}
