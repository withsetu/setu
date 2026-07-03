import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

/** Setu's fixed role set. Default role for new users is 'viewer'. */
export const SETU_ROLES = ['owner', 'publisher', 'editor', 'author', 'viewer'] as const

export type SetuRole = (typeof SETU_ROLES)[number]

export interface CreateAuthOptions {
  db: BetterSQLite3Database
  /** Secret used to sign sessions/cookies. Caller-supplied — never read from process.env here. */
  secret: string
  baseURL: string
  trustedOrigins: string[]
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
}
