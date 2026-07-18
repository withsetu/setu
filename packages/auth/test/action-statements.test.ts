import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLES } from '@setu/core'
import type { Action, Role } from '@setu/core'
import { setuAdminRoles } from '../src'
import {
  ACTION_ENFORCEMENT,
  ADMIN_ONLY_EXTRA_STATEMENTS,
  betterAuthStatementsForRole
} from '../src/action-statements'

/** #631 — the link between Setu's `Action` matrix and better-auth's statement vocabulary.
 *
 *  Setu carried TWO hand-maintained role tables with nothing connecting them:
 *  `packages/core/src/authz/default-roles.ts` (the `Action` matrix) and `setuAdminRoles` in
 *  `packages/auth/src/index.ts` (better-auth statements). The `satisfies Record<SETU_ROLES[number],
 *  ...>` on the latter checks only that the four role KEYS exist — nothing checked the ACTIONS
 *  agree. And `users.invite`/`users.setRole`/`users.disable`/`users.delete` are never passed to
 *  `authz.can` anywhere in `apps/api/src`: real enforcement of user management lives ENTIRELY in
 *  the statement map. So adding one word — `'delete'` to `setuAdminRoles.maintainer` — silently
 *  granted maintainers user deletion, with no failing test, past a route that `rank-guard.ts`
 *  documents as protected ONLY by the withheld statement.
 *
 *  These tests are that missing link. The kill-shot for the suite is exactly that word. */

/** better-auth's `newRole()` returns `{ authorize, statements }` (verified in the installed
 *  1.6.23 `dist/plugins/access/index.mjs`: `function role(statements) { return { authorize,
 *  statements } }`), so the literal table's statements are readable for comparison. */
function statementsOf(role: Role): Record<string, string[]> {
  return normalize(setuAdminRoles[role].statements)
}

/** Sorted, empty-resource-free form so `{ user: [], session: [] }` and `{}` compare equal and
 *  ordering never matters. */
function normalize(
  statements: Record<string, readonly string[] | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [resource, perms] of Object.entries(statements)) {
    if (perms && perms.length > 0) out[resource] = [...perms].sort()
  }
  return out
}

describe('Action ↔ better-auth statement mapping (#631)', () => {
  // A `Record<Action, ...>` is exhaustive at COMPILE time, but only against whatever `Action`
  // happens to be. This pins it at runtime to the role matrix itself: `DEFAULT_ROLES.admin` holds
  // every action by construction (admin = full control), so a new `Action` added to the union and
  // granted to admin without a mapping entry fails here.
  it('every Action in the matrix has an explicit enforcement mapping', () => {
    const mapped = new Set(Object.keys(ACTION_ENFORCEMENT))
    const inMatrix = [...DEFAULT_ROLES.admin]
    expect([...inMatrix].filter((a) => !mapped.has(a))).toEqual([])
  })

  it('maps no Action that the matrix does not define', () => {
    const inMatrix = new Set<string>(DEFAULT_ROLES.admin)
    expect(
      Object.keys(ACTION_ENFORCEMENT).filter((a) => !inMatrix.has(a))
    ).toEqual([])
  })

  // THE load-bearing assertion. Kill-shot: add 'delete' to setuAdminRoles.maintainer in
  // packages/auth/src/index.ts and this fails for `maintainer`.
  it.each(['admin', 'maintainer', 'editor', 'author'] as const)(
    'the %s statements in setuAdminRoles are exactly what the Setu matrix derives',
    (role) => {
      expect(statementsOf(role)).toEqual(
        normalize(betterAuthStatementsForRole(role))
      )
    }
  )

  it('grants a better-auth statement only to roles the matrix grants the mapped Action to', () => {
    for (const role of ['admin', 'maintainer', 'editor', 'author'] as const) {
      const granted = new Set<string>()
      for (const [resource, perms] of Object.entries(statementsOf(role)))
        for (const perm of perms) granted.add(`${resource}:${perm}`)

      for (const [action, mapping] of Object.entries(ACTION_ENFORCEMENT) as [
        Action,
        (typeof ACTION_ENFORCEMENT)[Action]
      ][]) {
        if (mapping.via !== 'better-auth') continue
        const roleHasAction = DEFAULT_ROLES[role].has(action)
        for (const statement of mapping.statements) {
          // Extras have no Action counterpart and are admin-only by declaration — skip them here.
          if (ADMIN_ONLY_EXTRA_STATEMENTS.includes(statement)) continue
          expect(
            granted.has(statement),
            `${role}: statement "${statement}" (mapped from ${action}) present=${granted.has(
              statement
            )} but matrix grants ${action}=${roleHasAction}`
          ).toBe(roleHasAction)
        }
      }
    }
  })

  it('admin-only extra statements are granted to admin and to nobody else', () => {
    for (const statement of ADMIN_ONLY_EXTRA_STATEMENTS) {
      const [resource, perm] = statement.split(':') as [string, string]
      expect(statementsOf('admin')[resource]).toContain(perm)
      for (const role of ['maintainer', 'editor', 'author'] as const)
        expect(statementsOf(role)[resource] ?? []).not.toContain(perm)
    }
  })

  it('no statement is claimed by both an Action mapping and the admin-only extras', () => {
    const mappedStatements = new Set<string>()
    for (const mapping of Object.values(ACTION_ENFORCEMENT))
      if (mapping.via === 'better-auth')
        for (const s of mapping.statements) mappedStatements.add(s)
    expect(
      ADMIN_ONLY_EXTRA_STATEMENTS.filter((s) => mappedStatements.has(s))
    ).toEqual([])
  })

  // The subsumed-vs-forgotten distinction (#631 bonus): an Action enforced by NEITHER better-auth
  // NOR a Setu `authz.can` call must say which it is — subsumed by another action's gate, or a
  // known unenforced gap with an issue behind it. "Absent from both tables" is no longer a
  // sayable state.
  it('every unmapped Action declares WHY — subsumed or a named gap, never silence', () => {
    for (const [action, mapping] of Object.entries(ACTION_ENFORCEMENT)) {
      if (mapping.via === 'subsumed') {
        expect(
          ACTION_ENFORCEMENT[mapping.by].via,
          `${action} is subsumed by ${mapping.by}, which must itself be really enforced`
        ).not.toBe('unenforced')
        expect(mapping.by, `${action} cannot be subsumed by itself`).not.toBe(
          action
        )
      }
      if (mapping.via === 'unenforced')
        expect(
          mapping.note.length,
          `${action} needs a real note`
        ).toBeGreaterThan(10)
    }
  })
})
