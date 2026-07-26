import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import {
  createSqliteAdapter,
  createSqliteSubmissionPort,
  createSqliteReprocessJobStore,
  createSqliteDeployJobStore,
  createSqliteIndexPort,
  createSqliteMediaIndexPort,
  openSqliteDb,
  countUsers
} from '@setu/db-sqlite'
import {
  createSubmissionService,
  createNoopCaptcha,
  createIndexService,
  createMediaIndexService,
  parseSettings,
  formNotificationValues,
  passwordResetValues,
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET
} from '@setu/core'
import type { CaptchaPort, DeployInfo } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import {
  createRecaptchaCaptcha,
  createRecaptchaV3Captcha
} from '@setu/captcha-recaptcha'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createResendEmailAdapter } from '@setu/email-resend'
import { createSmtpEmailAdapter } from '@setu/email-smtp'
import { createAuth, type AuthEvent } from '@setu/auth'
import { createMiddleware } from 'hono/factory'
import { createGitApi } from './app'
import { createHistoryApi } from './history-api'
import { createPreviewApi } from './preview'
import { createUploadApi, listMediaRecords } from './media'
import { createIndexApi, latchInFlight } from './index-api'
import { createFormsApi, DEFAULT_SUBMIT_RATE } from './forms'
import { createOembedApi } from './oembed'
import { createSiteHealthApi } from './sitehealth'
import { createDeployApi } from './deploy'
import {
  resolveSiteDir,
  readDeployState,
  writeDeployState,
  gitHeadSha,
  gitChangedPaths,
  makeBuildRunner
} from './deploy-wiring'
import { createUsersApi } from './users'
import { createEmailApi } from './email'
import {
  createResetEmailSender,
  resetEmailEnabled,
  resetEmailRefusal
} from './reset-email-gate'
import { createDemoApi } from './demo'
import { resolveSessionActor } from './auth/resolve-session-actor'
import type { ResolveActor } from './auth/resolve-actor'
import { allowedOrigins, resolveAdminOrigin } from './auth/allowed-origins'
import { originGuard, originMatches } from './auth/origin-guard'
import { authUnconfiguredGuard } from './auth/auth-unconfigured-guard'
import {
  authCaptchaFromEnv,
  authSocialProvidersFromEnv,
  socialProvidersEnabled,
  captchaCapabilityFromEnv
} from './auth/env'
import {
  buildCapabilities,
  createCapabilitiesApi,
  emailCapabilityFromEnv,
  usableEmailTransport,
  type AuthCapabilities,
  type EmailCapabilities
} from './capabilities'
import { createLiveEmailConfig } from './email-config'
import { createLiveEmailTransport } from './email-transport'
import { createLiveEmailTemplates } from './email-templates'
import { runReprocessJob } from './reprocess-runner'
import { resumeActiveJob } from './server-resume'
import {
  resolveSetuMode,
  resolveAuthSecret,
  resolveRateLimitOverrides,
  resolvePreviewEnabled
} from './config'
import { resolveGitIdentity } from './auth/git-identity'
import { buildLocalTokenOptions } from './local-token'
import { mountAuthWithFailureEvents } from './auth/login-failure-events'
import { apiOnError } from './errors'
import { securityHeaders } from './security-headers'
import { turnstileTestKeyNotice } from './captcha-test-keys'
import { noCaptchaProviderNotice } from './captcha-notice'
import { createNotifyCeiling, boundFromEnv } from './rate-limit'
import { parseTrustedProxies, parseTrustedProxyHeader } from './client-ip'
import { getConnInfo } from '@hono/node-server/conninfo'

// #248 Task 9: default audit-event consumer — a single structured log line. The REAL consumer
// (persistence/alerting) is future issue #290; this is deliberately the dumbest possible sink so
// nothing here can become a second source of truth once #290 lands. Never logs anything beyond the
// event itself (see packages/auth/src/events.ts — AuthEvent.meta must never carry a secret).
function logAuthEvent(event: AuthEvent): void {
  console.info('[auth-event]', JSON.stringify(event))
}

function resolveCaptcha(provider: string, secret: string): CaptchaPort {
  if (!provider) {
    // #918: the zero-config default is a PASS-THROUGH — every submission is accepted with no
    // verification at all — and it used to be the ONLY captcha branch that said nothing at boot,
    // because the two warnings below fire only once a provider is selected. Dev keeps the silence
    // (that is what the branch is for); every other topology gets the line. The decision itself
    // lives in captcha-notice.ts so it is testable — apps/api/test/captcha-notice.test.ts — since
    // this module cannot be imported by a test (it calls serve() at the bottom).
    const notice = noCaptchaProviderNotice(process.env)
    if (notice !== null) console.error(`[captcha] ${notice}`)
    return createNoopCaptcha()
  }
  if (!secret) {
    // Provider selected but secret missing.
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[captcha] provider "${provider}" selected but its secret is unset — rejecting submissions`
      )
      return {
        async verify() {
          return false
        }
      } // fail-closed in prod
    }
    console.warn(
      `[captcha] provider "${provider}" selected but secret unset — dev pass-through`
    )
    return createNoopCaptcha()
  }
  // 'recaptcha-v3' reads its score threshold from SETU_RECAPTCHA_MIN_SCORE (default 0.5) and an
  // optional expected action from SETU_RECAPTCHA_ACTION.
  if (provider === 'recaptcha-v3') {
    const raw = Number(process.env.SETU_RECAPTCHA_MIN_SCORE)
    return createRecaptchaV3Captcha({
      secret,
      ...(Number.isFinite(raw) ? { minScore: raw } : {}),
      ...(process.env.SETU_RECAPTCHA_ACTION
        ? { action: process.env.SETU_RECAPTCHA_ACTION }
        : {})
    })
  }
  return provider === 'recaptcha'
    ? createRecaptchaCaptcha({ secret })
    : createTurnstileCaptcha({ secret })
}

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl =
  process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`

function loadSiteSettings() {
  try {
    const raw = readFileSync(join(dir, 'settings.json'), 'utf-8')
    return parseSettings(JSON.parse(raw) as unknown)
  } catch {
    return parseSettings(undefined)
  }
}
const siteSettings = loadSiteSettings()

const submissionsDb =
  process.env.SETU_SUBMISSIONS_DB ?? `${dir}/.setu/submissions.db`
const notifyTo = process.env.SETU_FORMS_NOTIFY_TO
// #498: THE place the two from-address sources meet — capabilities.ts's resolveFromAddress
// (settings.json's email.fromAddress WINS; SETU_FORMS_NOTIFY_FROM is the fallback, precedence
// pinned order-sensitively by apps/api/test/capabilities.test.ts).
// #939: ONE live reading for every email path below — the from-address (#498), the transport
// (#890) and the stored templates + site title (#499) resolved from a SINGLE settings.json parse
// (createLiveEmailConfig in ./email-config). It replaced three sibling getters that each parsed
// the file independently, which cost three parses per form notification (a visitor-triggered
// path) and three per test send. It is not a cache: `liveEmailConfig()` is called INSIDE each
// send, so a save in Settings → Email still applies to the next email with no api restart — the
// count AND that liveness are both pinned, per path, by apps/api/test/email-read-count.test.ts.
// `notifyFrom` is the boot snapshot that ONLY the boot-time wiring conditions key off
// (createAuth's `email:` option and the users-api reset injection — the one email path whose
// ENABLE gate cannot follow a later save; see resetRestartRequired).
const liveEmailConfig = createLiveEmailConfig({
  settings: loadSiteSettings,
  env: process.env
})
const notifyFrom = liveEmailConfig().from.effective ?? undefined
// Admin SPA origin, from allowed-origins.ts's mode-aware resolver — the SAME derivation that
// builds the CORS/origin allowlist, not a second reading of SETU_ADMIN_ORIGIN (#642). It is
// `undefined` on a self-hosted boot with SETU_ADMIN_ORIGIN unset: outside local mode there is no
// localhost default, because the allowlist has none either (#628) and a callback built on an
// origin the allowlist rejects is worse than no callback. Shared by the reset-email default
// callback (below) and the local-handshake log line (bottom of this file).
const adminOrigin = resolveAdminOrigin(process.env)
// The credentialed CORS/origin allowlist, derived ONCE at boot and shared by every consumer below
// (better-auth's trustedOrigins, the cors() origin callback, originGuard). Deriving it per request
// meant a misconfigured server re-emitted allowed-origins.ts's fail-loud console.error on every
// request (#642); allowedOrigins memoises too, but the single boot-time const is what makes the
// "computed once" property visible at the call sites.
const originAllowlist = allowedOrigins(process.env)
// Honest degradation, once at boot (#642): an operator who configured an outbound sender but no
// admin origin would otherwise see password reset silently answer RESET_PASSWORD_DISABLED with no
// clue why. allowed-origins.ts already logged that SETU_ADMIN_ORIGIN is missing; this names the
// specific feature that is off as a result.
if (notifyFrom && adminOrigin === undefined) {
  console.error(
    '[auth] password reset is DISABLED: SETU_ADMIN_ORIGIN is unset outside local mode, so there is ' +
      'no admin origin to send the reset link to. Set SETU_ADMIN_ORIGIN to the admin SPA origin.'
  )
}

// Email transport (#248 forms notifications; #364 password-reset emails share it; #256 smtp;
// #890 the admin picks the provider). Selected by settings.json's `email.provider` with
// SETU_EMAIL_ADAPTER as the fallback, defaulting to the zero-config console adapter (dev: logs
// instead of sending). usableEmailTransport is the ONE usability predicate the live sender,
// emailCapabilityFromEnv and the /api/email/status thunk all share (#885 review Finding 2 —
// resend without RESEND_API_KEY falls back to console, like a partial smtp config), so the
// sending adapter and every report of it can't silently disagree. smtp is a Node-topology
// capability (raw TCP sockets — no Workers), which is fine here: this server entrypoint is
// Node-only; the edge topology has its own wiring.
const emailCapability = emailCapabilityFromEnv(
  process.env,
  siteSettings.email.fromAddress, // #498: settings from-address counts toward `deliverable`
  siteSettings.email.provider // #890: boot snapshot of the settings-chosen provider
)
const emailTransport = usableEmailTransport(
  process.env,
  siteSettings.email.provider
)
// Honest degradation, once at boot (same pattern as the adminOrigin warning above): an operator
// who asked for a real transport but left it unusable would otherwise get a silent console
// fallback — a mail black hole. Name the exact reason; never echo credential values (the
// problem strings are boot-log-safe — apps/api/test/capabilities.test.ts).
if (emailTransport.problem !== null) {
  console.error(
    `[email] the ${emailTransport.selected} transport is selected but not usable: ${emailTransport.problem}.`
  )
}
// #894: the console fallback is not a mail black hole — it WRITES every message to this process's
// log. The old wording here ("no mail will be sent") was false in exactly the way that mattered,
// and it fired only on the misconfigured branch, never on the plain default-console boot. Say what
// actually happens, on every console-effective boot, and name the feature that is off as a result.
if (emailTransport.effective === 'console') {
  console.error(
    '[email] no deliverable transport: messages are WRITTEN TO THIS LOG instead of being ' +
      'delivered (the console adapter redacts credential-shaped URL parts — @setu/email-console). ' +
      'Password reset is DISABLED. Pick a provider in Settings → Email, or set ' +
      'SETU_EMAIL_ADAPTER=resend|smtp.'
  )
}
if (emailTransport.effective !== 'console' && !notifyFrom) {
  console.error(
    `[email] the ${emailTransport.effective} transport is configured but no from-address is set — ` +
      'email stays disabled until one exists. Set it in Settings → Email or via SETU_FORMS_NOTIFY_FROM.'
  )
}
// #894: THE reset-enablement predicate, derived once and shared by createAuth's `email:` option,
// the users-api injection and the /api/email/status thunk below — previously the same expression
// was hand-mirrored in three places while transport selection used a different one entirely, so
// "reset is on" and "the transport can deliver" could disagree. Branches (and the console case
// that made a reset link land in stdout) are pinned by apps/api/test/reset-email-gate.test.ts;
// the flow end-to-end by apps/api/test/reset-password-leak.test.ts.
const resetWiredAtBoot = resetEmailEnabled({
  from: notifyFrom,
  adminOrigin,
  effectiveTransport: emailTransport.effective
})
// #890: the ONE sender every email path below uses. It re-resolves the transport per send from
// the live settings + env (createLiveEmailTransport in ./email-transport, unit-tested in
// apps/api/test/email-transport.test.ts), which is what makes the Settings → Email provider
// dropdown a real control: a save applies to the next email with no api restart. Adapters are
// built lazily and cached per kind, so a console-only instance never constructs a nodemailer
// transport. Selection keys on the transport being USABLE — deliberately not on `deliverable`
// (which also folds in the from-address), so an instance with resend/smtp configured but no
// from-address yet still sends the moment one is saved. An unusable selection degrades to
// console with a named reason rather than throwing at send time; that is the fail-safe for a
// provider stored in Git-canonical settings.json, which can arrive without passing the api's
// settings-write gate at all.
// #939: every send path below dispatches through `email.sendVia(config.transport, …)` with a
// transport `liveEmailConfig()` already resolved, so this getter backs only the seam's UNBOUND
// entry points (`email.resolve()` / `email.send()`) — kept live and wired so the object stays a
// complete EmailPort, not because server.ts calls them. Collapsing the seam to a pure dispatcher
// is spun off as its own issue rather than folded in here.
const email = createLiveEmailTransport({
  env: process.env,
  provider: () => loadSiteSettings().email.provider,
  adapters: {
    console: () => createConsoleEmailAdapter(),
    resend: (apiKey) => createResendEmailAdapter({ apiKey }),
    smtp: (config) => createSmtpEmailAdapter(config)
  },
  onProblem: (problem, selected) => {
    console.error(
      `[email] the ${selected} transport is selected but not usable: ${problem}. ` +
        'Falling back to the console adapter — the message is written to this log, redacted, ' +
        'instead of being delivered.'
    )
  }
})

// #499: the template half of the same live-getter story — settings.json's
// `email.templates.<type>` is re-read on EVERY send (createLiveEmailTemplates in
// ./email-templates, unit-tested in apps/api/test/email-templates.test.ts), so an admin editing
// a template in Settings → Email applies to the next email with no api restart, exactly like
// the from-address (#498) and the provider (#890). Every send path below renders through this
// one object, so "which override applies" has a single answer. `{{site_title}}` is folded in
// from Settings → General, also live. An unreadable settings.json or a malformed override
// degrades to the shipped default rather than sending garbage.
// #939: every send path renders through `renderWith(config, …)` against the SAME `EmailConfig`
// that supplied its from-address and transport, so one email now costs one settings parse. The
// comment that used to sit here claimed that outcome already ("ONE getter, so one email costs
// one settings read") while three sibling getters each parsed the file — a form notification
// cost three parses and a password reset three more. What it named as proof was
// apps/api/test/email-templates.test.ts's "reads settings exactly ONCE per render", which pins
// one resolver in isolation and is strictly narrower than the claim. The per-PATH count is now
// asserted by apps/api/test/email-read-count.test.ts, which is the test that fails if a fourth
// reader is added to any send path.
const emailTemplates = createLiveEmailTemplates({
  settings: loadSiteSettings
})

// Ensure .setu/ parent dir exists before better-sqlite3 opens the DB file
mkdirSync(`${dir}/.setu`, { recursive: true })

const submissions = createSqliteSubmissionPort(submissionsDb)

// Better Auth's tables live in the SAME sqlite file as submissions (SETU_SUBMISSIONS_DB) — one
// drizzle handle, shared migrations folder (see packages/db-sqlite/src/open-db.ts).
const authDb = openSqliteDb(submissionsDb)
const baseURL = process.env.SETU_BASE_URL ?? `http://localhost:${port}`

const mode = resolveSetuMode(process.env)
// Forward reference: `authRef` is read inside the localToken closure (built just below) but only
// assigned once `auth` exists further down — a deliberate `let`, not a reassign-once const case.
// eslint-disable-next-line prefer-const
let authRef: ReturnType<typeof createAuth> | undefined
// Loopback token handshake provider (local topology only, #248 Task 4; rotation + self-healing
// persistence #386) — the full contract (synchronous rotation, `.setu/handshake-url` persistence,
// getToken-retries-failed-persist) lives on buildLocalTokenOptions in ./local-token. `identity`
// is resolved once here via `resolveGitIdentity`, matching "read git config once at boot" from
// the task brief, not on every exchange attempt.
// `adminOrigin !== undefined` is a type narrowing, not an extra condition: resolveAdminOrigin
// always returns a string in local mode (that is where its localhost default lives), so this is
// still exactly "the local topology".
const localToken =
  mode === 'local' && adminOrigin !== undefined
    ? buildLocalTokenOptions({
        dir,
        adminOrigin,
        getAuth: () => authRef!,
        identity: resolveGitIdentity()
      })
    : undefined

// Fail-closed boot degradation (#248 Task 5). resolveAuthSecret returns null in non-local mode
// with no SETU_AUTH_SECRET set — NOT a thrown boot error (that was Task 3's behavior; see the
// comment on resolveAuthSecret in ./config for why it changed). When it's null we do not
// construct `auth` at all: there is no secret to sign sessions with, so there is no safe partial
// instance to build — "auth disabled" must mean "no auth object exists", not "an auth object
// exists but might misbehave". `authUnconfiguredGuard` below is what actually protects routes in
// this state; `resolveActor` here is never invoked when auth is null because every mutating route
// (and /api/auth/* itself) is 503'd by that guard before any route handler — including this one —
// ever runs. It still needs a value to satisfy createUploadApi's type, so it's a resolver that
// fails closed to null (-> authMiddleware's 401) purely as a defensive fallback, not the primary
// guard.
const authSecret = resolveAuthSecret()
const authConfigured = authSecret !== null

// Non-local topology first-run setup (#248 Task 7): mint a one-time setup token whenever this
// boot could need first-run setup — auth configured AND zero users yet — mirroring the local-mode
// loopback token above, but for the guarded `POST /api/auth/setup` route instead. Never minted in
// local mode (the loopback handshake covers first-run there instead); the serverSetup plugin
// itself also 404s whenever `getSetupToken()` returns null, so a topology mismatch here and in the
// plugin's own guard would agree, not silently diverge.
const setupToken =
  mode !== 'local' && authConfigured && countUsers(authDb) === 0
    ? randomBytes(32).toString('base64url')
    : null

const auth = authConfigured
  ? createAuth({
      db: authDb,
      secret: authSecret,
      baseURL,
      trustedOrigins: originAllowlist,
      captcha: authCaptchaFromEnv(),
      socialProviders: authSocialProvidersFromEnv(),
      localToken,
      serverSetup:
        setupToken !== null
          ? {
              getSetupToken: () => setupToken,
              countUsers: () => countUsers(authDb)
            }
          : undefined,
      onAuthEvent: logAuthEvent,
      rateLimit: resolveRateLimitOverrides(process.env),
      // #364: wire password-reset emails through the same transport as forms notifications, sent
      // FROM the same instance-wide sender address (SETU_FORMS_NOTIFY_FROM) — see the `email`
      // option's doc in packages/auth/src/options.ts for why this reuses that env rather than
      // inventing an auth-specific one. Omitted (reset stays disabled, unchanged) when no
      // from-address is configured at all: there is nothing to put in the message's `from` field,
      // matching how the submission service itself skips sending without one (see
      // createSubmissionService's `if (email && notifyTo && notifyFrom)` guard below).
      // resetRedirectTo: where the emailed link lands when the /request-password-reset caller
      // omitted redirectTo — without it better-auth's callback route 302s the click to
      // /error?error=INVALID_TOKEN (see the option's doc). It is built from `adminOrigin`, which
      // comes from the same resolver as `trustedOrigins` above, so the callback origin is on that
      // allowlist BY CONSTRUCTION and better-auth's originCheck accepts it (#642 — previously the
      // two were derived separately and a self-hosted boot with SETU_ADMIN_ORIGIN unset emailed a
      // http://localhost:5173 link that the server's own originCheck then rejected).
      // The whole `email` option is omitted when `adminOrigin` is undefined — i.e. self-hosted
      // with SETU_ADMIN_ORIGIN unset — for the same reason it is omitted without `notifyFrom`:
      // there is no honest value for a required field, so reset stays DISABLED (better-auth
      // answers RESET_PASSWORD_DISABLED) rather than sending a link that cannot work. The boot
      // log already names the missing variable; see the warning below.
      // #894 adds the third condition (see resetWiredAtBoot above): a console-EFFECTIVE transport
      // also means DISABLED, because the console adapter writes the message — reset URL, token in
      // the path — to this server's log.
      // `&& notifyFrom && adminOrigin` are TYPE NARROWINGS, not extra conditions (same idiom as
      // the localToken ternary above): resetWiredAtBoot is false whenever either is missing —
      // pinned by apps/api/test/reset-email-gate.test.ts — but TS cannot see that through a
      // boolean, and both fields below are required `string`s.
      email:
        resetWiredAtBoot && notifyFrom && adminOrigin
          ? {
              // #498: re-resolve the from-address at SEND time (settings win, env fallback) so an
              // admin editing Settings → Email applies to the next reset email without a restart;
              // `from: notifyFrom` below stays as the boot-time fallback the option type requires.
              // #894: createResetEmailSender re-checks the whole predicate against the LIVE
              // transport too, so a provider switched to console after boot (settings.json is
              // Git-canonical — it can change without passing the settings-write gate) refuses
              // instead of logging a credential. The ENABLE gate here is still boot-time —
              // resetRestartRequired in the status thunk below is how that is surfaced honestly;
              // making it live is #886.
              // #919: the gate resolves the transport ONCE and delivers through that very
              // reading via `sendVia` — `email.send` would have re-resolved, so a settings.json
              // rewrite in between could admit on one reading and dispatch on another.
              // #939: the transport and the from-address now arrive from ONE `liveEmailConfig()`
              // call instead of two, so this send costs one settings parse rather than two.
              send: createResetEmailSender({
                resolveConfig: () => {
                  const config = liveEmailConfig()
                  return {
                    transport: config.transport,
                    from: config.from.effective ?? undefined
                  }
                },
                sendVia: (transport, msg) => email.sendVia(transport, msg),
                adminOrigin,
                onRefused: (reason) => {
                  console.error(
                    `[auth] password-reset email NOT sent: ${reason}. No link was delivered; ` +
                      'the requester saw the usual "check your email" response.'
                  )
                  // #912: also through the audit seam — a recovery path silently not working is
                  // a security-relevant event (CLAUDE.md §5, API-route checklist), and the
                  // console.error above is operator prose, not a structured record. `reason` is
                  // reset-email-gate.ts's own string: no address, no token (events.ts).
                  logAuthEvent({
                    type: 'password-reset.refused',
                    meta: { reason }
                  })
                }
              }),
              // #499: resolve the message BODY at send time too, through the same live template
              // resolver every other send path uses, so an admin's stored override applies with
              // no restart. @setu/auth hands over the reset link it already built and
              // callback-defaulted — a template can PLACE `{{reset_url}}` but has no syntax with
              // which to supply or alter one (kill-shot tested in
              // apps/api/test/email-templates.test.ts, "a stored template cannot supply or
              // override the reset url").
              // #939: this is the ONE settings read on the reset path that could not be folded
              // into `send`'s. `content` and `send` are two independent @setu/auth callbacks
              // (packages/auth/src/index.ts's sendResetPassword calls the first and then the
              // second), so binding them to a single reading would mean asserting that nothing
              // runs between them — a claim about another package's internals that no test here
              // could hold. The reset path therefore costs TWO parses, down from three; merging
              // the two callbacks into one is spun off rather than assumed. The exact count is
              // asserted, with this reason, by apps/api/test/email-read-count.test.ts.
              content: ({ url, userName, userEmail }) =>
                emailTemplates.render(
                  EMAIL_TYPE_PASSWORD_RESET,
                  passwordResetValues({ url, userName, userEmail })
                ),
              from: notifyFrom,
              resetRedirectTo: `${adminOrigin}/reset-password`
            }
          : undefined
    })
  : undefined
authRef = auth
const resolveActor: ResolveActor = auth ? resolveSessionActor(auth) : () => null

// Spam protection: select a captcha adapter by env. Secret is env-only.
const captchaProvider = process.env.SETU_CAPTCHA_PROVIDER ?? '' // 'turnstile' | 'recaptcha' | ''
const captchaSecret =
  captchaProvider === 'recaptcha'
    ? (process.env.SETU_RECAPTCHA_SECRET ?? '')
    : (process.env.SETU_TURNSTILE_SECRET ?? '')
const captcha = resolveCaptcha(captchaProvider, captchaSecret)
const captchaStatus = {
  provider: captchaProvider,
  secretConfigured: captchaSecret !== ''
}

// #918 layer 1 — the HARD bound on the anonymous form→email path: a ceiling on notifications
// SENT per window, for this process, keyed on nothing at all. Layer 2 (the per-IP submit limit
// wired into createFormsApi below) is a refinement that can only ever be as good as the address
// it keys on; this one cannot be bypassed by varying an address, a header or a session, because
// none of them feed it. Defaults: 20 notifications per 10 minutes — comfortably above any real
// contact form and far below "open relay". See rate-limit.ts for the reason string and
// packages/core/src/submissions/submission-service.ts for why the check sits AFTER the persist.
const notifyBound = boundFromEnv({
  raw: {
    max: process.env.SETU_FORMS_NOTIFY_MAX_PER_WINDOW,
    windowMs: process.env.SETU_FORMS_NOTIFY_WINDOW_MS
  },
  defaults: { max: 20, windowMs: 10 * 60_000 },
  names: {
    max: 'SETU_FORMS_NOTIFY_MAX_PER_WINDOW',
    windowMs: 'SETU_FORMS_NOTIFY_WINDOW_MS'
  }
})
const submitBound = boundFromEnv({
  raw: {
    max: process.env.SETU_FORMS_SUBMIT_MAX_PER_WINDOW,
    windowMs: process.env.SETU_FORMS_SUBMIT_WINDOW_MS
  },
  defaults: DEFAULT_SUBMIT_RATE,
  names: {
    max: 'SETU_FORMS_SUBMIT_MAX_PER_WINDOW',
    windowMs: 'SETU_FORMS_SUBMIT_WINDOW_MS'
  }
})
// An override that could not be parsed fell back to the default rather than to "unlimited"
// (boundFromEnv). Say so, or the operator believes a number that is not in force.
for (const problem of [...notifyBound.problems, ...submitBound.problems]) {
  console.error(`[forms] ${problem}`)
}
const notifyCeiling = createNotifyCeiling({
  ...notifyBound,
  // #918 review F6: the ceiling doubles as a notification-SUPPRESSION primitive — sustained
  // low-rate traffic inside the per-IP bound can hold it saturated, and the operator would
  // otherwise just stop receiving mail. One line per window, distinct from the per-skip reason
  // below so it is an alert rather than more of the same noise.
  onSaturated: (reason) => {
    console.error(`[forms] ${reason}`)
  }
})
// The proxy declaration, in two deliberately separate parts (see client-ip.ts):
//  - SETU_TRUSTED_PROXIES makes `x-forwarded-for` readable from those peers. Its right-walk is
//    safe by construction because every mainstream proxy APPENDS to that header.
//  - SETU_TRUSTED_PROXY_HEADER additionally believes ONE single-valued header (cf-connecting-ip,
//    x-real-ip, …). It is a separate opt-in because a generic reverse proxy forwards unknown
//    headers verbatim, so the address declaration alone must never make one believable — that
//    was a real bypass, caught reviewing PR #933.
// Both unset is the header-blind default: the per-IP bound keys on the socket peer, so a
// deployment behind an undeclared CDN collapses to ONE bucket (over-limiting, never unlimited).
const proxyTrust = {
  proxies: parseTrustedProxies(process.env.SETU_TRUSTED_PROXIES),
  header: parseTrustedProxyHeader(process.env.SETU_TRUSTED_PROXY_HEADER)
}
if (proxyTrust.header !== undefined && proxyTrust.proxies.length === 0) {
  // Declaring a header without declaring who may send it would be meaningless — and dangerous if
  // it were ever honoured — so say why it is being ignored rather than let it look configured.
  console.error(
    `[forms] SETU_TRUSTED_PROXY_HEADER=${proxyTrust.header} is IGNORED because ` +
      'SETU_TRUSTED_PROXIES is unset: a forwarded header is only believable from a declared ' +
      'proxy address. Set both, or neither.'
  )
}

const submit = createSubmissionService({
  submissions,
  captcha,
  email,
  notifyTo,
  // #498 (#885 review Finding 1) + #939: resolved PER SUBMISSION, so the notify gate, the sender
  // and the body all follow a from-address, provider or template saved in Settings → Email
  // without an api restart — but from ONE settings.json parse instead of three. This is the path
  // the count mattered most on: /forms/submit is unauthenticated, so three synchronous parses
  // here were three per anonymous visitor request. The service calls this only after the row is
  // persisted and only when notifications are wired, so a honeypot, captcha or validation reject
  // still parses nothing at all.
  // #499: the body is the `form-notification` registry type with the admin's stored override
  // applied — see packages/core/src/email/templates/form-notification.ts for why the default
  // markup is a hand-written table rather than @setu/email-templates' renderer output.
  resolveNotification: () => {
    const config = liveEmailConfig()
    return {
      from: config.from.effective ?? undefined,
      render: (s) =>
        emailTemplates.renderWith(
          config,
          EMAIL_TYPE_FORM_NOTIFICATION,
          formNotificationValues(s)
        ),
      // #919's binding, applied here too: dispatch through the very transport reading this
      // notification was gated on, never a second resolution.
      send: (msg) => email.sendVia(config.transport, msg)
    }
  },
  // #921 (CLAUDE.md §4 #22): the sibling of the reset sender's `onRefused` a few lines below.
  // Because `notifyFrom` is live, clearing the from-address in Settings → Email (or a `git push`
  // that clears it) stops every form notification at once — previously with no log line at all,
  // while the visitor still saw `{ ok: true }`. The service only calls this when notifications
  // are actually configured, so a deployment that never wanted them stays quiet — both
  // directions pinned by packages/core/test/submissions/submission-service.test.ts
  // ("onNotifySkipped (#921)" describe), which also covers a throwing callback.
  onNotifySkipped: (reason) => {
    console.error(`[forms] form notification NOT sent: ${reason}`)
  },
  // #918: consulted immediately before the send and only once the row is persisted, so hitting
  // the ceiling costs an email and never a submission. A skip is reported through the SAME
  // onNotifySkipped seam above — one place an operator watches, not two.
  allowNotification: notifyCeiling
})

const imageAdapter = createSharpImageAdapter()
const localStorage = createLocalStorage({
  dir: mediaDir,
  baseUrl: mediaPublicUrl
})
const reprocessStore = createSqliteReprocessJobStore(
  `${dir}/.setu/reprocess.db`
)
const runReprocess = (jobId: string) => {
  const media = loadSiteSettings().media
  void runReprocessJob(
    reprocessStore,
    {
      image: imageAdapter,
      storage: localStorage,
      media,
      widths: [400, 800, 1200, 1600]
    },
    jobId
  )
}

// --- Server-authoritative content/media index (#464, Increment A) ---
// One GitPort instance, shared with the /git routes below.
const git = createLocalGitAdapter({ dir })

// Deploy truth for lifecycle derivation (live vs staged vs pending), refreshed
// before every latched index build from the same seams the deploy API reads
// (.setu/deploy.json + git diff). A missing deploy state honestly derives
// "never deployed" — identical to what the admin's client-side index does.
let deployInfo: DeployInfo = { deployedSha: null, changed: [] }
async function refreshDeployInfo(): Promise<void> {
  const state = readDeployState(dir)
  if (state === null) {
    deployInfo = { deployedSha: null, changed: [] }
    return
  }
  try {
    deployInfo = {
      deployedSha: state.sha,
      changed: await gitChangedPaths(dir, state.sha)
    }
  } catch (err) {
    // Diff unavailable (e.g. deployed sha pruned) → treat the deploy as
    // unchanged rather than fail the whole index build.
    console.error('[index] deploy diff failed — assuming no pending set:', err)
    deployInfo = { deployedSha: state.sha, changed: [] }
  }
}

// Drafts + index rows live in the SAME sqlite file as the other long-lived
// stores (submissions/auth) — one .setu/submissions.db, several adapters, the
// established pattern (see openSqliteDb's comment).
const contentIndexService = createIndexService({
  data: createSqliteAdapter(submissionsDb),
  git,
  index: createSqliteIndexPort(submissionsDb),
  deploy: () => deployInfo
})
// latchInFlight: concurrent callers (route bursts, boot warm-up, post-commit
// refresh) share ONE build; after the first build ensureBuilt is a cheap
// HEAD-compare, and an out-of-band commit imports incrementally.
const ensureContentIndex = latchInFlight(async () => {
  await refreshDeployInfo()
  await contentIndexService.ensureBuilt()
})
// POST /api/index/refresh (#464 Increment B): a deploy that doesn't move git
// HEAD only changes deploy-derived lifecycle — ensureBuilt's sha-compare can't
// see it, so the admin asks for an explicit re-derivation.
const refreshContentIndex = latchInFlight(async () => {
  await refreshDeployInfo()
  await contentIndexService.reindexAfterDeploy()
})

const mediaIndexService = createMediaIndexService({
  mediaIndex: createSqliteMediaIndexPort(submissionsDb),
  // The same record scan GET /media/_index serves — shared helper, never HTTP.
  fetchRaw: () => listMediaRecords(localStorage)
})
const ensureMediaIndex = latchInFlight(() => mediaIndexService.ensureBuilt())

const app = new Hono()

// #291 fail-secure errors: the root handler catches any throw OUTSIDE a factory (middleware,
// the /api/auth/* mount) — each factory mounts its own scoped apiOnError, which Hono prefers
// for the routes it owns; this is the backstop so nothing ever falls through to a raw 500.
app.onError(apiOnError())

// Baseline security headers on EVERY response (#289) — registered first so even guard rejections
// (503/403 below) carry them. JSON + media API: nosniff, never framed (DENY — stricter than the
// site's SAMEORIGIN), no referrer leakage; deliberately NO CSP here (document-context policy —
// the site build emits its own report-only CSP).
app.use('*', securityHeaders())

// CORS allowlist (credentialed) + Host/Origin guard (DNS-rebinding/tunnel-detection), applied
// globally, before any route — including /api/auth/*.
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return undefined
      return originAllowlist.some((pattern) => originMatches(origin, pattern))
        ? origin
        : undefined
    },
    credentials: true
  })
)
// Fail-closed boot degradation (#248 Task 5): when auth couldn't be constructed, short-circuit
// every unsafe-method request (including /api/auth/* below) with a 503 rather than let it reach a
// route that assumes a working auth instance. Placed after CORS (so the 503 still carries CORS
// headers and is readable by the admin origin) and before originGuard — the two guards check
// independent axes (method-based vs. Origin/Host-based) so their relative order doesn't change
// which requests are ultimately allowed through; this one is cheaper (no header parsing) so it
// runs first.
app.use(
  '*',
  authUnconfiguredGuard(() => !authConfigured)
)
// publicPaths: routes that are deliberately public and read NO ambient credentials (no session
// cookie, no auth check) — captcha is the only gate. `/forms/submit` is an embeddable public form
// widget (#248 follow-up): it must stay reachable from any visitor origin. Anything reading a
// session (e.g. the /forms/submissions admin CRUD routes) MUST NOT be listed here — those stay
// behind the origin check.
app.use(
  '*',
  originGuard(() => originAllowlist, {
    publicPaths: ['/forms/submit']
  })
)

// authUnconfiguredGuard only 503s unsafe methods — GET is a safe method and passes through even
// when auth is unconfigured (that's deliberate: GETs elsewhere, like capabilities, must keep
// working). better-auth also exposes GET endpoints (e.g. session fetch) under /api/auth/*, so this
// mount is still guarded by `auth`'s existence rather than assuming the method-based guard alone
// covers it: no auth instance means nothing here to call. Only mounted when auth is configured;
// with auth unconfigured, GET /api/auth/* falls through to Hono's default 404 (there is no
// meaningful "session" endpoint to serve, and capabilities already reports auth.enabled: false so
// callers know why).
// #248 Task 9: mountAuthWithFailureEvents wraps the same auth.handler mount as before, adding ONE
// extra behavior — inspecting POST /api/auth/sign-in/email's response status to emit login.failure
// (the one audit-event type better-auth's databaseHooks can't observe; see
// login-failure-events.ts's module comment for the full derivation from source). Every other
// /api/auth/* route's behavior is unchanged.
if (auth) {
  mountAuthWithFailureEvents(app, auth, logAuthEvent)
}

// Index refresh after content commits (#464): HEAD moved, so the next latched
// ensureBuilt takes the incremental diff path. Fire-and-forget — a commit must
// never fail or slow down because indexing hiccuped. Registered BEFORE the git
// route mount (Hono only runs middleware registered ahead of the handler).
const refreshIndexAfterCommit = createMiddleware(async (c, next) => {
  await next()
  if (c.req.method === 'POST' && c.res.status === 200)
    void ensureContentIndex().catch((err: unknown) => {
      console.error('[index] refresh after commit failed:', err)
    })
})
app.use('/git/commit', refreshIndexAfterCommit)
app.use('/git/commit-files', refreshIndexAfterCommit)
// #466: a restore is a content commit too — same freshness hook.
app.use('/api/history/restore', refreshIndexAfterCommit)
app.route('/', createGitApi(git, resolveActor))
// Revision history from Git (#466) — list/read/restore; the git-local adapter
// implements the optional capability, so this topology serves it.
app.route('/', createHistoryApi(git, resolveActor))
// Server-authoritative content/media index reads (#464, Increment A).
app.route(
  '/',
  createIndexApi({
    resolveActor,
    index: { ...contentIndexService, ensureBuilt: ensureContentIndex },
    media: { ...mediaIndexService, ensureBuilt: ensureMediaIndex },
    refresh: refreshContentIndex
  })
)
// In-editor preview is dev-only (the site route that renders the slot exists only under `astro dev`
// and its GET carries no session cookie, so the slot can't be auth-gated). It is an unauthenticated
// read/write surface, so it is mounted ONLY in the local topology outside production — see
// resolvePreviewEnabled for why the old NODE_ENV-only gate (#419) left it mounted on a default
// self-hosted boot (#627). Everywhere else the routes are physically absent and /preview 404s.
app.route(
  '/',
  createPreviewApi({ enabled: resolvePreviewEnabled(process.env) })
)
app.route(
  '/',
  createUploadApi({
    storage: localStorage,
    resolveActor,
    image: imageAdapter,
    // Live getter, not a snapshot: re-read settings.json each request so a Media settings change
    // (format / LQIP) applies to new uploads and Reprocess without restarting the api.
    mediaSettings: () => loadSiteSettings().media,
    reprocess: { store: reprocessStore, run: runReprocess },
    // #464 Increment B: keep the server media index fresh on upload/delete —
    // it only rebuilds on version mismatch, never per request.
    mediaIndex: mediaIndexService
  })
)
app.route(
  '/',
  createFormsApi({
    submit,
    submissions,
    captchaStatus,
    resolveActor,
    // #918 layer 2. The socket peer is the ONLY unforgeable identity an unauthenticated caller
    // has; reading it is topology-specific, hence the injection (@hono/node-server exposes the
    // Node request through c.env — a Workers entrypoint would pass its own reader). Defensive
    // try/catch: a runtime without `incoming` must degrade to the one-shared-bucket fallback,
    // never throw on the public submit path.
    socketIp: (c) => {
      try {
        return getConnInfo(c).remote.address
      } catch {
        return undefined
      }
    },
    proxyTrust,
    submitRateLimit: submitBound,
    // #918 review F2: the per-IP bound's accepted zero-config trade (an undeclared proxy
    // collapses every visitor into one bucket) is only acceptable if the operator can notice it.
    // Deduped inside the factory to one line per window.
    onSubmitLimited: (message) => {
      console.error(`[forms] ${message}`)
    }
  })
)
app.route('/', createOembedApi({ resolveActor }))
// Live getter for the site URL, mirroring mediaSettings above — a Settings change to the
// site identity URL applies to the next probe without an api restart.
app.route(
  '/',
  createSiteHealthApi({
    resolveActor,
    // The canonical site/entity URL from the identity settings (#201) — the public
    // address a live probe should hit. Live getter so a Settings change applies next probe.
    siteUrl: () => loadSiteSettings().identity.url
  })
)
// #248 Task 8 review, Finding 2: the SAME drizzle handle better-auth's own createAuth uses for
// its tables (authDb, above) — not a separate connection — so credential-status always reflects
// live account state. `resolveActor` here already fails closed to null when auth is unconfigured
// (see its own comment above), which authMiddleware turns into a 401 for this route too.
app.route(
  '/',
  createUsersApi({
    db: authDb,
    resolveActor,
    // #500 review: the admin-surface reset triggers call better-auth SERVER-SIDE so the captcha
    // plugin (which protects the public HTTP /request-password-reset by default) keeps guarding
    // the unauthenticated surface without asking authenticated staff to solve challenges.
    // Injected under EXACTLY the same condition as createAuth's `email:` option above — since
    // #894 that is the SAME `resetWiredAtBoot` const, not a hand-mirrored copy of the expression,
    // so the route's 409 and better-auth's RESET_PASSWORD_DISABLED cannot drift apart. redirectTo
    // is omitted on purpose: packages/auth's withDefaultResetCallback fills in
    // `${adminOrigin}/reset-password`, the same default the emailed-link flow already uses.
    ...(auth && resetWiredAtBoot
      ? {
          requestPasswordReset: async (email: string) => {
            await auth.api.requestPasswordReset({ body: { email } })
          },
          // #912: the same predicate over the same LIVE resolvers the sender above uses
          // (one `liveEmailConfig()` reading), so the route's honest 409 and the sender's
          // refusal cannot disagree about what "deliverable" means. Without it the route
          // answered `{ status: true }` over a refused send, because the refusal happens inside
          // better-auth's send hook and never comes back out.
          // #939: one settings parse, not two — the from-address and the transport used to be
          // resolved separately here, which also meant this check could straddle a save.
          resetEmailRefusal: () => {
            const config = liveEmailConfig()
            return resetEmailRefusal({
              from: config.from.effective ?? undefined,
              adminOrigin,
              effectiveTransport: config.transport.effective
            })
          }
        }
      : {})
  })
)

// Settings → Email control plane (#498, #890): live provider status + admin-only test send.
// `resolveConfig` is a thunk (same pattern as the mediaSettings live getter above): the provider,
// the from-address and the stored templates re-read settings.json per request, so a save in the
// admin is reflected immediately.
//
// #938: the status PAYLOAD is no longer built here. It used to be an inline literal in this file
// — which no test imports, this being a side-effectful entrypoint — while three hand-written
// near-copies of it stood in for it in tests, one of which had already dropped the from-address
// half of `deliverable`. It is now `buildEmailStatus` in ./email.ts, over `emailDeliverable` from
// ./capabilities, which is the same function /api/capabilities' block calls. The secrets block is
// presence booleans ONLY (never values); the problem strings are smtpConfigFromEnv's boot-log-safe
// reasons (apps/api/test/capabilities.test.ts proves they never echo credentials).
//
// #939: ONE settings parse per request on both routes. The GET builds its payload from a single
// reading; the POST gates, stamps, dispatches and labels from a single reading. That also makes
// #919's property structural rather than a discipline — there is no second read left in the POST
// for a mid-request settings.json rewrite to change.
app.route(
  '/',
  createEmailApi({
    resolveActor,
    resolveConfig: liveEmailConfig,
    sendVia: (transport, msg) => email.sendVia(transport, msg),
    statusContext: {
      env: process.env,
      mode,
      // Boot gate for reset = the exact createAuth `email:` condition above — the same
      // `resetWiredAtBoot` const, so this cannot report a gate the server does not have.
      resetWiredAtBoot: Boolean(auth && resetWiredAtBoot),
      authConfigured,
      adminOriginPresent: adminOrigin !== undefined
    }
  })
)

// Demo Data control plane (#513, epic #509) — dev tooling: mounted ONLY in the
// local topology outside production (the createPreviewApi gating precedent);
// everywhere else the routes are physically absent and /api/demo/* 404s. The
// engine (and @setu/demo-data's whole module graph) loads lazily on the first
// demo request, so a self-hosted boot never touches it even when this file is
// bundled. Uses the api's OWN git/storage/image adapters and auth DB — one
// git writer per process, and demo users land in the same sqlite the running
// api verifies logins against.
app.route(
  '/',
  createDemoApi({
    enabled: mode === 'local' && process.env.NODE_ENV !== 'production',
    resolveActor,
    engine: async () => {
      const { buildDemoEngine } = await import('./demo-wiring')
      return buildDemoEngine({
        sandboxDir: dir,
        mediaDir,
        submissionsDb,
        git,
        storage: localStorage,
        image: imageAdapter
      })
    },
    // Seeds/unseeds commit content and write media records out-of-band of the
    // /git/commit hooks — refresh both server indexes when a job lands.
    onContentMutated: () => {
      void ensureContentIndex().catch((err: unknown) => {
        console.error('[demo] content-index refresh failed:', err)
      })
      void mediaIndexService.rebuild().catch((err: unknown) => {
        console.error('[demo] media-index rebuild failed:', err)
      })
    }
  })
)

// Deploy control plane (#207 · #208 indicator + #209 rebuild). The site dir decides the
// rebuild capability: present on the monorepo dev stack and scaffolded sites, absent on
// a bare content-repo deployment → the API 409s honestly and only the indicator runs.
const siteDir = resolveSiteDir(process.env, process.cwd())
app.route(
  '/',
  createDeployApi({
    resolveActor,
    siteDir,
    jobs: createSqliteDeployJobStore(`${dir}/.setu/deploy-jobs.db`),
    readState: () => readDeployState(dir),
    writeState: (s) => writeDeployState(dir, s),
    headSha: () => gitHeadSha(dir),
    changedPaths: (since) => gitChangedPaths(dir, since),
    // Unreachable when siteDir is null (the route 409s first) — a defensive reject.
    runBuild:
      siteDir !== null
        ? makeBuildRunner({ siteDir, repoDir: dir, env: process.env })
        : () => Promise.reject(new Error('no site dir'))
  })
)

// The auth capability block is computed fresh per request (not baked into the boot-time
// capabilities object below): `needsSetup` depends on the current user-table row count, which
// changes the moment first-run setup creates the owner account — a stale snapshot would keep
// telling the admin "you need setup" after it already happened. `enabled`/`providers`/`captcha`
// ARE boot-time-stable (they only depend on env + whether `auth` was constructed), but computing
// them in the same thunk keeps this one obvious function rather than splitting truly-static vs.
// per-request fields across two call sites.
//
// `countUsers` reads the DB on every request, so a transient DB fault (locked file, disk error)
// must not 500 the whole capabilities endpoint — the admin needs SOMETHING to render. On a
// countUsers throw, degrade to `needsSetup: false` (never `true`): failing toward "show login"
// is safe (worst case, a legitimate operator sees a login form and has to investigate), while
// failing toward "show setup" would hand an attacker a first-run owner-setup screen precisely
// because the DB is unhealthy — the opposite of fail-closed. The rest of the block still returns
// normally; only this one derived field degrades.
const resolveAuthCapabilities = (): AuthCapabilities => {
  let needsSetup = false
  if (authConfigured) {
    try {
      needsSetup = countUsers(authDb) === 0
    } catch (err) {
      console.error(
        '[auth] countUsers failed while resolving capabilities — degrading needsSetup to false (fail toward login, not setup)',
        err
      )
    }
  }
  return {
    enabled: authConfigured,
    providers: authConfigured ? socialProvidersEnabled(process.env) : [],
    captcha: authConfigured ? captchaCapabilityFromEnv(process.env) : null,
    needsSetup
  }
}
// #890: computed fresh per request, like resolveAuthCapabilities above and for the same reason —
// it isn't boot-stable. Both halves of `deliverable` (the provider and the from-address) live in
// settings.json and apply to the next send with no restart, so a boot snapshot here went stale
// the moment an admin saved. That mattered beyond cosmetics: this block is what the admin's
// password-reset surfaces read (LoginScreen's "Forgot password?" card, UsersScreen's reset
// action), so a stale `deliverable: false` told users reset wasn't configured while it genuinely
// worked. It re-reads settings.json per request — the same cost shape as resolveAuthCapabilities'
// countUsers DB read — and loadSiteSettings already swallows a missing/corrupt file into defaults,
// so this cannot throw the endpoint. Exposure is unchanged: transport name + one boolean.
const resolveEmailCapabilities = (): EmailCapabilities => {
  const settings = loadSiteSettings().email
  return emailCapabilityFromEnv(
    process.env,
    settings.fromAddress,
    settings.provider
  )
}
app.route(
  '/',
  createCapabilitiesApi(
    buildCapabilities({
      image: imageAdapter, // present in the Node topology
      writableMediaStore: true, // local fs storage is writable
      backgroundJobs: true, // persistent Node process can run jobs
      // #466: derived from the adapter ACTUALLY having the optional functions,
      // never asserted per-topology — an adapter swap can't silently lie.
      history:
        typeof git.log === 'function' && typeof git.readFileAt === 'function',
      mode,
      auth: resolveAuthCapabilities(), // boot-time value; createCapabilitiesApi re-derives per request via the thunk below
      email: emailCapability // ditto — resolveEmailCapabilities below is what the response uses
    }),
    resolveAuthCapabilities,
    resolveEmailCapabilities
  )
)

serve({ fetch: app.fetch, port })
console.log(
  `api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, imageFormat: ${siteSettings.media.imageFormat}, lqip: ${siteSettings.media.imageLqip})`
)
{
  // #868: Turnstile's public dummy keys auto-resolve every challenge — a production boot running
  // them has a captcha in the UI and no protection behind it. Make that state loud at the one
  // place every topology already reports captcha status. Detection + copy live in
  // captcha-test-keys.ts (apps/api/test/captcha-test-keys.test.ts).
  const testKeyNotice = turnstileTestKeyNotice(process.env)
  const line = `[captcha] provider=${captchaProvider || '(none)'} secretConfigured=${captchaStatus.secretConfigured}${testKeyNotice ? ` ${testKeyNotice}` : ''}`
  if (testKeyNotice) console.warn(line)
  else console.log(line)
}
if (localToken && adminOrigin !== undefined) {
  // The ONE place the token is ever logged — this is the intended handoff channel to the admin.
  // Never log the token (or this URL) anywhere else. (adminOrigin is the shared const near the
  // top of this file.) `localToken.token` is the boot-initial token; after any exchange the
  // CURRENT URL lives in `.setu/handshake-url` (#386), persisted here at boot and rewritten on
  // every rotation — local mode only (localToken is undefined in every other mode).
  console.log(`Admin handshake: ${adminOrigin}/#setu-token=${localToken.token}`)
  localToken.persistUrl()
}
if (setupToken !== null) {
  // The ONE place the setup token is ever logged — the intended handoff channel to whoever is
  // standing up this instance (they paste it into the admin's SetupScreen). Never log it (or a
  // URL containing it) anywhere else.
  console.log(`Setup token: ${setupToken}`)
}
resumeActiveJob(reprocessStore, runReprocess)
// Warm the server index at boot (#464) — fire-and-forget: failures are LOUD
// (an empty index with no diagnostics bit us before, #429) but never crash
// boot; the /api/index routes rebuild on demand anyway.
void ensureContentIndex().catch((err: unknown) => {
  console.error('[index] boot content-index build failed:', err)
})
void ensureMediaIndex().catch((err: unknown) => {
  console.error('[index] boot media-index build failed:', err)
})
