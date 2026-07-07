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
export function resolveAuthSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const configured = env.SETU_AUTH_SECRET
  if (configured) return configured
  const mode = resolveSetuMode(env)
  if (mode === 'local') {
    console.warn(
      '[auth] SETU_AUTH_SECRET is unset — using an ephemeral secret; sessions will reset on restart'
    )
    return randomBytes(32).toString('hex')
  }
  console.error(
    `[auth] SETU_AUTH_SECRET is required when SETU_MODE=${mode} (no ephemeral fallback outside local mode) — ` +
      'auth is DISABLED; the server will boot but mutating routes and /api/auth/* will 503 until it is set'
  )
  return null
}

/** Parses a single positive-int env override. Returns `undefined` (never throws) for anything
 *  that isn't a clean positive integer — unset, empty, non-numeric, zero, negative, or a float all
 *  fall back to "no override" (createAuth's own default applies), with a warning naming which var
 *  and value were rejected so a typo'd env is visible in boot logs rather than silently ignored. */
function parsePositiveIntEnv(
  name: string,
  raw: string | undefined
): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(
      `[auth] ${name}=${JSON.stringify(raw)} is not a positive integer — ignoring, default applies`
    )
    return undefined
  }
  return n
}

/** Rate-limit env overrides (#248 Task 9) for createAuth's `rateLimit` option. Deliberately
 *  returns a sparse object (only the keys that parsed) rather than always returning both keys —
 *  createAuth's own `opts.rateLimit?.window ?? 60` / `?? 100` defaulting (see packages/auth's
 *  index.ts) already handles "window set, max unset" and vice versa correctly; duplicating that
 *  fallback logic here would risk the two drifting. Never throws — see parsePositiveIntEnv. */
export function resolveRateLimitOverrides(
  env: NodeJS.ProcessEnv = process.env
): { enabled?: boolean; window?: number; max?: number } {
  const window = parsePositiveIntEnv(
    'SETU_AUTH_RATELIMIT_WINDOW',
    env.SETU_AUTH_RATELIMIT_WINDOW
  )
  const max = parsePositiveIntEnv(
    'SETU_AUTH_RATELIMIT_MAX',
    env.SETU_AUTH_RATELIMIT_MAX
  )
  const out: { enabled?: boolean; window?: number; max?: number } = {}
  // Default ON; only an explicit SETU_AUTH_RATELIMIT_ENABLED=false disables it (the e2e topology,
  // for a deterministic auth lane). Any other value — including unset — leaves the limiter on.
  if (env.SETU_AUTH_RATELIMIT_ENABLED === 'false') out.enabled = false
  if (window !== undefined) out.window = window
  if (max !== undefined) out.max = max
  return out
}
