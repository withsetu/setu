import type { betterAuth } from 'better-auth'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { AuthEvent } from './events'
import type { ResetEmailRequest } from './reset-password-email'

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
   *  @setu/auth stays runtime-agnostic and never imports a Node-only email package itself: the
   *  caller (apps/api/src/server.ts) owns the transport and the from-address entirely, and this
   *  package only hands it the link it built. */
  email?: {
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
     * #958: the ONE callback that owns both the message BODY and its dispatch.
     *
     * It used to be two — `content(...)` to render and `send(...)` to deliver — and that split
     * had a cost for any caller whose body and transport come from the same stored settings:
     * each callback had to resolve them for itself, because binding both to a single reading
     * would have meant assuming nothing runs between two callbacks of THIS package, which is a
     * claim about internals no test in the caller's package could hold. So a password reset cost
     * apps/api two full settings.json parses (#939), one per callback. Collapsing them makes the
     * single reading an ordinary local variable inside the caller's own function, so the
     * assumption is not needed and the count is one — asserted by
     * apps/api/test/email-read-count.test.ts, 'parses settings.json exactly ONCE, and a save
     * applies to the next reset'.
     *
     * `from` is deliberately NOT an option any more: the callback builds the whole message, so
     * the address belongs to whoever dispatches it. The field it replaced was read nowhere except
     * to be handed straight back to the same caller (apps/api overrode it per send from its own
     * live reading), which is the shape of a required field that exists only to satisfy a type.
     *
     * Everything the default body needs travels with the request, including the shipped default
     * itself (`ResetEmailRequest.defaultContent`), so a caller that wants Setu's stock reset email
     * writes `{ to, from: …, ...defaultContent() }` and a caller with its own templates ignores
     * it. That is what keeps `resetPasswordEmailContent` the shipped default with `content` gone —
     * exercised through this option by packages/auth/test/create-auth.test.ts.
     */
    sendReset: (request: ResetEmailRequest) => Promise<void>
  }
}
