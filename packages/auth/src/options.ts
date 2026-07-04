import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { AuthEvent } from './events'

/** Setu's fixed role set (epic #359: `owner`→`admin`, `publisher`→`maintainer`).
 *  Default role for new users is 'viewer'. */
export const SETU_ROLES = ['admin', 'maintainer', 'editor', 'author', 'viewer'] as const

export type SetuRole = (typeof SETU_ROLES)[number]

export interface CreateAuthOptions {
  db: BetterSQLite3Database
  /** Secret used to sign sessions/cookies. Caller-supplied — never read from process.env here. */
  secret: string
  baseURL: string
  trustedOrigins: string[]
  /** Structured audit-event seam (#248 Task 9). Called once per emission point below — never for
   *  raw request logging. Defaults to a no-op when omitted (server.ts supplies the real default,
   *  a `console.info('[auth-event]', ...)` line, so every OTHER caller — e.g. tests — gets total
   *  silence unless it opts in). */
  onAuthEvent?: (event: AuthEvent) => void
  captcha?: {
    provider: 'cloudflare-turnstile' | 'google-recaptcha'
    secretKey: string
  }
  socialProviders?: {
    github?: { clientId: string; clientSecret: string }
    google?: { clientId: string; clientSecret: string }
  }
  rateLimit?: {
    window?: number
    max?: number
  }
  /** Local topology only: wires the loopback token handshake plugin (POST /api/auth/local/exchange).
   *  Omitted entirely outside local topology — see apps/api/src/server.ts. */
  localToken?: {
    getToken: () => string | null
    consume: () => void
    localUserId: () => Promise<string>
  }
  /** Non-local topology only: wires the guarded first-run server setup plugin
   *  (POST /api/auth/setup). Omitted entirely in local topology — the loopback handshake covers
   *  local first-run, not this route (see apps/api/src/server.ts). */
  serverSetup?: {
    /** The one-time setup token minted at boot when needsSetup is true in non-local mode, or null
     *  when this topology has no setup route at all (mirrors localToken's getToken contract). */
    getSetupToken: () => string | null
    /** Live row count of the user table — checked fresh on every request, not cached, so setup
     *  closes the instant the first owner exists. */
    countUsers: () => number
  }
}
