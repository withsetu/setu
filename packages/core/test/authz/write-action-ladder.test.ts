import { describe, it, expect } from 'vitest'
import { DEFAULT_ROLES } from '../../src/authz/default-roles'
import type { Action, Role } from '../../src/authz/types'

// #622 — apps/api/src/app.ts derives the permission a mixed git commit needs by taking the
// STRONGEST action any single change requires (`WRITE_ACTION_RANK` / `writeActionForChanges`).
// That reduction is only sound because of a subset property of THIS matrix: for each adjacent
// pair on the ladder, every role holding the stronger action also holds the weaker one. If that
// ever stops holding, a mixed commit could be admitted on the strongest action while the actor
// silently lacks a weaker one it also needed — and the api-side gate would keep passing, because
// it never checks the assumption. It was asserted only in a prose comment until now.
//
// The test lives HERE, next to the data, so the edit that breaks it (adding a role, or moving
// `theme.manage` onto a role without `content.publish`) fails in the package that caused it.
const LADDER: Action[] = [
  'content.edit',
  'content.publish',
  'theme.manage',
  'settings.manage'
]

const holders = (action: Action): Role[] =>
  (Object.keys(DEFAULT_ROLES) as Role[]).filter((r) =>
    DEFAULT_ROLES[r].has(action)
  )

describe('#622 write-action ladder: DEFAULT_ROLES upholds the subset invariant', () => {
  it('every role holding a stronger action also holds the next weaker one', () => {
    for (let i = 1; i < LADDER.length; i++) {
      const stronger = LADDER[i]!
      const weaker = LADDER[i - 1]!
      for (const role of holders(stronger))
        expect(
          DEFAULT_ROLES[role].has(weaker),
          `role "${role}" holds ${stronger} but NOT ${weaker} — the api's strongest-action reduction (apps/api/src/app.ts WRITE_ACTION_RANK) is no longer sound`
        ).toBe(true)
    }
  })

  it('holds transitively: settings.manage holders hold every weaker rung', () => {
    for (const role of holders('settings.manage'))
      for (const action of LADDER)
        expect(DEFAULT_ROLES[role].has(action), `${role} / ${action}`).toBe(
          true
        )
  })

  it('each rung is strictly narrower than the one below it (the ladder is real, not degenerate)', () => {
    // Guards the other direction: if two rungs ever had identical holders the "ladder" would be
    // decorative, and a reviewer could not rely on rank ordering meaning anything.
    for (let i = 1; i < LADDER.length; i++)
      expect(
        holders(LADDER[i]!).length,
        `${LADDER[i]} vs ${LADDER[i - 1]}`
      ).toBeLessThan(holders(LADDER[i - 1]!).length)
  })
})
