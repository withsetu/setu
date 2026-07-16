/** Deterministic post partitioning (#512): which demo user owns which post,
 *  and which posts are drafts. Pure index arithmetic — no RNG — so a resumed
 *  or re-planned run assigns identically. */
import type { SeedRole } from './types'
import { SEED_ROLES } from './types'

export interface DemoUserSpec {
  email: string
  name: string
  role: SeedRole
}

const ROLE_LABEL: Record<SeedRole, string> = {
  admin: 'Admin',
  maintainer: 'Maintainer',
  editor: 'Editor',
  author: 'Author'
}

/** Realistic ownership weights: authors write most, admins least — but every
 *  role writes (all four are author-capable; that's the point of the rig). */
export const ROLE_WEIGHT: Record<SeedRole, number> = {
  author: 4,
  editor: 3,
  maintainer: 2,
  admin: 1
}

/** Expand per-role counts into concrete user specs with deterministic
 *  identities: `demo-<role>-<n>@demo.setu.test` / "Demo <Role> <n>". */
export function demoUserSpecs(
  users: Partial<Record<SeedRole, number>>
): DemoUserSpec[] {
  const specs: DemoUserSpec[] = []
  for (const role of SEED_ROLES) {
    const count = users[role] ?? 0
    if (!Number.isInteger(count) || count < 0)
      throw new Error(`Invalid user count for role "${role}": ${count}`)
    for (let n = 1; n <= count; n++) {
      specs.push({
        email: `demo-${role}-${n}@demo.setu.test`,
        name: `Demo ${ROLE_LABEL[role]} ${n}`,
        role
      })
    }
  }
  return specs
}

/** Build the repeating ownership sequence: a weighted round-robin interleave
 *  (each pass takes one slot from every user with weight remaining), so owners
 *  alternate instead of writing in blocks. Post `i` belongs to
 *  `sequence[i % sequence.length]`. */
export function buildOwnerSequence(users: DemoUserSpec[]): DemoUserSpec[] {
  if (users.length === 0)
    throw new Error('Seeding needs at least one demo user')
  const remaining = users.map((u) => ROLE_WEIGHT[u.role])
  const sequence: DemoUserSpec[] = []
  for (;;) {
    let took = false
    for (let i = 0; i < users.length; i++) {
      if (remaining[i]! > 0) {
        remaining[i]!--
        sequence.push(users[i]!)
        took = true
      }
    }
    if (!took) return sequence
  }
}

/** Deterministic draft picker: spreads `fraction` of posts evenly by index
 *  (Bresenham-style accumulator — exactly `round(N*fraction)` drafts over any
 *  prefix-stable enumeration, no RNG). */
export function isDraft(index: number, fraction: number): boolean {
  if (fraction <= 0) return false
  if (fraction >= 1) return true
  return Math.floor((index + 1) * fraction) - Math.floor(index * fraction) === 1
}
