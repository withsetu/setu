import type { betterAuth } from 'better-auth'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { EmailPort } from '@setu/core'
import type { AuthEvent } from './events'

/** Setu's fixed role set (epic #359: `owner`→`admin`, `publisher`→`maintainer`).
 *  Default role for new users is 'author'. */
export const SETU_ROLES = ['admin', 'maintainer', 'editor', 'author'] as const

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
  /** Passed straight through to better-auth. Typed as better-auth's OWN option rather than a
   *  hand-written `{ clientId, clientSecret }` pair, because that narrower shape was a lie: #624
   *  has been sending `disableSignUp` / `disableImplicitSignUp` from
   *  `apps/api/src/auth/env.ts` all along. Excess-property checking only fires on object
   *  LITERALS, so those flags were structurally erased at this boundary — present at runtime,
   *  invisible to the type, and impossible for a reader to discover here. #645 (the sign-up hole
   *  that erasure helped hide) is the reason it now says what it accepts. */
  socialProviders?: NonNullable<
    Parameters<typeof betterAuth>[0]
  >['socialProviders']
  rateLimit?: {
    /** Master switch. Defaults to `true`; only an explicit `false` (e.g. the e2e topology, for a
     *  deterministic auth lane) turns the limiter off. Never disable in a real deployment. */
    enabled?: boolean
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
  /** #364: wires better-auth's `emailAndPassword.sendResetPassword` to a real transport so
   *  `POST /api/auth/request-password-reset` sends an actual email instead of throwing
   *  `RESET_PASSWORD_DISABLED`. This is deliberately the ONLY password-reset lever: a maintainer
   *  (who never holds the `set-password` statement — see `setuAdminRoles` in index.ts) can trigger
   *  this reset EMAIL for a below-rank user but can never set a password directly. Omitted
   *  entirely -> behavior is unchanged from before this task (reset stays disabled). See index.ts's
   *  `createAuth` for the full better-auth 1.6.23 source citation for the callback signature and
   *  the disabled-gate behavior.
   *
   *  Typed structurally against `EmailPort['send']` (a type-only import from `@setu/core`, zero
   *  runtime cost) rather than accepting a concrete adapter — @setu/auth stays runtime-agnostic
   *  and never imports a Node-only email package itself; the caller (apps/api/src/server.ts)
   *  supplies whichever adapter it already constructed. */
  email?: {
    send: EmailPort['send']
    /** Address the reset email is sent FROM. Reuses the one from-address convention this codebase
     *  already has (`SETU_FORMS_NOTIFY_FROM`, read in server.ts) rather than inventing a second,
     *  auth-specific env var for what is still just "the instance's one outbound sender address". */
    from: string
    /** Default landing page for the emailed reset link when the `/request-password-reset` caller
     *  omitted `redirectTo`. Required, not optional: better-auth's `/reset-password/:token`
     *  handler treats an EMPTY `callbackURL` query param as invalid and 302s to
     *  `${apiBase}/error?error=INVALID_TOKEN` (1.6.23 dist/api/routes/password.mjs line 115:
     *  `if (!token || !callbackURL) throw ctx.redirect(redirectError(...))`), so an emailed link
     *  without a callback is a guaranteed dead end — the send path must be incapable of emitting
     *  one. `createAuth` can't derive this itself (`trustedOrigins` is an unordered allowlist with
     *  no designated admin origin), so the caller supplies it — server.ts builds it from the
     *  existing `SETU_ADMIN_ORIGIN` convention as `<adminOrigin>/reset-password`. Must be an
     *  allowlisted origin, or better-auth's own originCheck on the callback route rejects the
     *  redirect when the link is clicked. */
    resetRedirectTo: string
    /**
     * #499 (epic #497): resolve the message BODY at send time. Omitted → the shipped default
     * (`resetPasswordEmailContent`, i.e. core's `password-reset` registry default), which is
     * exactly the pre-#499 behavior; apps/api injects a resolver that applies the admin's
     * `email.templates['password-reset']` override, re-read from settings.json on every send so
     * a save in Settings → Email needs no restart.
     *
     * `url` is passed in, never out: the caller receives the link this package already built
     * and callback-defaulted, so a stored template can place the reset link but can never
     * change or supply one (packages/core/test/email/email-registry.test.ts and
     * apps/api/test/email-templates.test.ts both kill-shot that).
     */
    content?: (input: {
      url: string
      userName?: string
      userEmail?: string
    }) => { subject: string; html: string; text?: string }
  }
}
