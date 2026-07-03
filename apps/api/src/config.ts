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
 *  local user. In any other topology, a missing secret means auth cannot be safely constructed:
 *  there is no ephemeral fallback once auth is meant to be durable across restarts / shared across
 *  instances (that fallback stays local-only, deliberately).
 *
 *  Task 3 made this a hard `throw` at boot. Task 5 replaces that with honest degradation: the
 *  server MUST still boot and serve public GETs (media, capabilities) even when auth can't be
 *  configured — an operator should be able to see the server is up and *why* auth is disabled via
 *  GET /api/capabilities, not have the whole process refuse to start. Returning `null` (rather than
 *  throwing) lets server.ts skip constructing the auth instance entirely and register a 503
 *  short-circuit for mutating routes and /api/auth/* instead. */
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.SETU_AUTH_SECRET
  if (configured) return configured
  const mode = resolveSetuMode(env)
  if (mode === 'local') {
    console.warn('[auth] SETU_AUTH_SECRET is unset — using an ephemeral secret; sessions will reset on restart')
    return randomBytes(32).toString('hex')
  }
  console.error(
    `[auth] SETU_AUTH_SECRET is required when SETU_MODE=${mode} (no ephemeral fallback outside local mode) — ` +
      'auth is DISABLED; the server will boot but mutating routes and /api/auth/* will 503 until it is set',
  )
  return null
}
