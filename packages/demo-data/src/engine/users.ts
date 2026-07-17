/** Demo-user creation (#512). Deterministic identities from `demoUserSpecs`;
 *  passwords are freshly generated per created user and surfaced ONCE in the
 *  seed summary (the engine itself never logs them — CLAUDE.md §6, secrets are
 *  never logged). Idempotent: an existing user is left untouched (password
 *  unchanged, reported as `password: null`). */
import { randomBytes } from 'node:crypto'
import type { SeedUserSummary, UserStore } from './types'
import type { DemoUserSpec } from './partition'

/** Dev-only password: 18 random bytes, base64url (24 chars) — comfortably past
 *  better-auth's minimum and obviously machine-minted. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/** Ensure every spec'd demo user exists. Returns per-user summaries (password
 *  only for users created by THIS call). */
export async function ensureUsers(
  store: UserStore,
  specs: DemoUserSpec[],
  onEach?: (done: number, total: number) => void
): Promise<SeedUserSummary[]> {
  const summaries: SeedUserSummary[] = []
  let done = 0
  for (const spec of specs) {
    const existing = await store.findByEmail(spec.email)
    if (existing) {
      summaries.push({ email: spec.email, role: spec.role, password: null })
    } else {
      const password = generatePassword()
      await store.create({
        email: spec.email,
        name: spec.name,
        role: spec.role,
        password
      })
      summaries.push({ email: spec.email, role: spec.role, password })
    }
    done++
    onEach?.(done, specs.length)
  }
  return summaries
}
