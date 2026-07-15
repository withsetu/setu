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
