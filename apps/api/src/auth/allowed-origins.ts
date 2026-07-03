/** Build the CORS/origin allowlist from env.
 *  - Admin origin: SETU_ADMIN_ORIGIN (default http://localhost:5173).
 *  - Loopback API origins: http://localhost:<port> + http://127.0.0.1:<port>,
 *    where <port> = SETU_API_PORT (default 4444). These let curl/tools hitting
 *    the api's own loopback address through without needing an Origin header.
 *  - SETU_TRUSTED_ORIGINS: comma-separated, whitespace-trimmed, empty entries
 *    dropped. Wildcard subdomain patterns (https://*.host) are passed through
 *    as-is — origin-guard.ts understands the `*.` prefix.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const adminOrigin = env.SETU_ADMIN_ORIGIN ?? 'http://localhost:5173'
  const apiPort = env.SETU_API_PORT ?? '4444'

  const origins = [adminOrigin, `http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`]

  const trusted = env.SETU_TRUSTED_ORIGINS ?? ''
  for (const entry of trusted.split(',')) {
    const trimmed = entry.trim()
    if (trimmed !== '') origins.push(trimmed)
  }

  return origins
}
