import { resolveSetuMode } from '../config'

/** The admin dev server's origin — the LOCAL-mode-only default for `SETU_ADMIN_ORIGIN`. */
const LOCAL_ADMIN_ORIGIN = 'http://localhost:5173'

/** The admin SPA's origin, mode-aware. THE single source for "where the admin lives" (#642).
 *
 *  `SETU_ADMIN_ORIGIN` when set and non-empty. Otherwise: `http://localhost:5173` in LOCAL mode
 *  (the admin dev server), and `undefined` everywhere else — deliberately no default, because a
 *  loopback origin is never what an operator meant on a real server (#628).
 *
 *  Two consumers depend on this agreeing with `allowedOrigins` below, and before #642 they could
 *  not: server.ts re-read `SETU_ADMIN_ORIGIN` itself with an UNCONDITIONAL localhost default, so a
 *  self-hosted boot with the var unset built a password-reset callback pointing at
 *  `http://localhost:5173/reset-password` while the allowlist (correctly) contained nothing — and
 *  better-auth's `originCheck` therefore rejected the server's own reset callback. Deriving both
 *  from this one function makes that class of disagreement unrepresentable.
 */
export function resolveAdminOrigin(env: {
  SETU_MODE?: string
  SETU_ADMIN_ORIGIN?: string
}): string | undefined {
  const configured = env.SETU_ADMIN_ORIGIN
  if (configured !== undefined && configured !== '') return configured
  return resolveSetuMode(env) === 'local' ? LOCAL_ADMIN_ORIGIN : undefined
}

/** Build the CORS/origin allowlist from env.
 *
 *  This list feeds the CREDENTIALED `cors()` AND `originGuard` in server.ts (and better-auth's
 *  `trustedOrigins`), so every entry on it is an origin permitted to make cookie-bearing
 *  cross-origin READS AND WRITES. It is therefore mode-gated exactly like every other local-only
 *  affordance in config.ts (#628):
 *
 *  - **Admin origin**: `resolveAdminOrigin` (above). In LOCAL mode it defaults to
 *    `http://localhost:5173` (the admin dev server). Outside local mode there is NO default: an
 *    unset value used to silently put `http://localhost:5173` on a production server's credentialed
 *    allowlist. A loopback origin is never what an operator meant on a real server, so this now
 *    fails LOUDLY — nothing is added and a console error names the variable. The consequence is a
 *    visible, diagnosable "the admin can't reach the API" with the fix printed in the boot log,
 *    instead of an invisible hole any page on that loopback port can drive.
 *  - **Loopback API origins** (`http://localhost:<port>` + `http://127.0.0.1:<port>`, where
 *    `<port>` = `SETU_API_PORT`, default 4444): a convenience for curl/tools hitting the api's own
 *    loopback address without an Origin header. LOCAL MODE ONLY. On a self-hosted server these let
 *    any page served from those ports — another local app, a dev server, a malicious local
 *    process — issue credentialed cross-origin requests against the API.
 *  - **`SETU_TRUSTED_ORIGINS`**: comma-separated, whitespace-trimmed, empty entries dropped;
 *    honoured in every mode. Wildcard subdomain patterns (`https://*.host`) are passed through
 *    as-is — origin-guard.ts understands the `*.` prefix. This is the supported way to allow an
 *    extra origin (including a loopback one) on a non-local topology: explicit, not implicit.
 */
function deriveAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const isLocal = resolveSetuMode(env) === 'local'
  const origins: string[] = []

  const adminOrigin = resolveAdminOrigin(env)
  if (adminOrigin !== undefined) {
    origins.push(adminOrigin)
  } else {
    console.error(
      '[cors] SETU_ADMIN_ORIGIN is unset outside local mode — the admin origin is NOT allowlisted. ' +
        'It is deliberately NOT defaulted to http://localhost:5173, which would put a loopback ' +
        "origin on a production credentialed CORS allowlist. Set SETU_ADMIN_ORIGIN to the admin's " +
        'public origin.'
    )
  }

  if (isLocal) {
    const apiPort = env.SETU_API_PORT ?? '4444'
    origins.push(`http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`)
  }

  const trusted = env.SETU_TRUSTED_ORIGINS ?? ''
  for (const entry of trusted.split(',')) {
    const trimmed = entry.trim()
    if (trimmed !== '') origins.push(trimmed)
  }

  return origins
}

/** Memo keyed on the env object itself. WeakMap, so a test's throwaway env literal is collectable
 *  and each distinct env still derives independently. */
const cache = new WeakMap<NodeJS.ProcessEnv, readonly string[]>()

/** The allowlist for `env` — see `deriveAllowedOrigins` for what's on it and why.
 *
 *  Derived at most ONCE per env object (#642). It was being recomputed inside the per-request
 *  `cors()` origin callback AND the `originGuard` thunk, so a misconfigured self-hosted server
 *  emitted the fail-loud `console.error` above up to twice for EVERY request — a log flood an
 *  unauthenticated caller could drive at will, burying the one message that explains the
 *  misconfiguration. The inputs are `process.env`, which does not change per request, so caching
 *  on the env object is sound and makes the error a once-at-boot event. Callers that need to
 *  observe an env change must pass a fresh object (nothing in the server does; server.ts derives
 *  the list once at boot and shares that array).
 *
 *  Returns a fresh copy each call: the cached array is the authority and must not be mutable by a
 *  caller who pushes onto the result.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  let derived = cache.get(env)
  if (derived === undefined) {
    derived = Object.freeze(deriveAllowedOrigins(env))
    cache.set(env, derived)
  }
  return [...derived]
}
