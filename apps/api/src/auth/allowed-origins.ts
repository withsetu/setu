import { resolveSetuMode } from '../config'

/** Build the CORS/origin allowlist from env.
 *
 *  This list feeds the CREDENTIALED `cors()` AND `originGuard` in server.ts (and better-auth's
 *  `trustedOrigins`), so every entry on it is an origin permitted to make cookie-bearing
 *  cross-origin READS AND WRITES. It is therefore mode-gated exactly like every other local-only
 *  affordance in config.ts (#628):
 *
 *  - **Admin origin**: `SETU_ADMIN_ORIGIN`. In LOCAL mode it defaults to `http://localhost:5173`
 *    (the admin dev server). Outside local mode there is NO default: an unset value used to
 *    silently put `http://localhost:5173` on a production server's credentialed allowlist. A
 *    loopback origin is never what an operator meant on a real server, so this now fails LOUDLY —
 *    nothing is added and a console error names the variable. The consequence is a visible,
 *    diagnosable "the admin can't reach the API" with the fix printed in the boot log, instead of
 *    an invisible hole any page on that loopback port can drive.
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
export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const isLocal = resolveSetuMode(env) === 'local'
  const origins: string[] = []

  const configuredAdmin = env.SETU_ADMIN_ORIGIN
  if (configuredAdmin !== undefined && configuredAdmin !== '') {
    origins.push(configuredAdmin)
  } else if (isLocal) {
    origins.push('http://localhost:5173')
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
