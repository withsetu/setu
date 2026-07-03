import { randomBytes } from 'node:crypto'

/** Setu deployment topology mode. 'local' relaxes a few dev-only fallbacks (e.g. an ephemeral
 *  auth secret); every other topology is treated as 'self-hosted' — including when SETU_MODE is
 *  unset. Fail closed: an operator who forgets to set SETU_MODE on a real server must NOT
 *  silently get local-only behavior. `pnpm dev` sets SETU_MODE=local explicitly for local dev. */
export type SetuMode = 'local' | 'self-hosted'

export function resolveSetuMode(env: { SETU_MODE?: string }): SetuMode {
  return env.SETU_MODE === 'local' ? 'local' : 'self-hosted'
}

/** The auth secret. In local topology (SETU_MODE='local', via resolveSetuMode — which itself
 *  fails closed to 'self-hosted' when SETU_MODE is unset), fall back to an ephemeral per-boot
 *  secret when SETU_AUTH_SECRET is unset — sessions reset on restart, which is fine for a single
 *  local user. In any other topology, a missing secret is a hard boot error: there is no safe
 *  fallback once auth is meant to be durable across restarts / shared across instances.
 *  (Task 5 refines the "any other topology" branch into route-level 503s instead of a hard boot
 *  failure; for this task a clear thrown error is the correct fail-closed behavior.) */
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SETU_AUTH_SECRET
  if (configured) return configured
  const mode = resolveSetuMode(env)
  if (mode === 'local') {
    console.warn('[auth] SETU_AUTH_SECRET is unset — using an ephemeral secret; sessions will reset on restart')
    return randomBytes(32).toString('hex')
  }
  throw new Error(`[auth] SETU_AUTH_SECRET is required when SETU_MODE=${mode} (no ephemeral fallback outside local mode)`)
}
