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
  parseSettings
} from '@setu/core'
import type { CaptchaPort, DeployInfo } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import {
  createRecaptchaCaptcha,
  createRecaptchaV3Captcha
} from '@setu/captcha-recaptcha'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createResendEmailAdapter } from '@setu/email-resend'
import { renderSubmissionEmail } from '@setu/email-templates'
import { createAuth, type AuthEvent } from '@setu/auth'
import { createMiddleware } from 'hono/factory'
import { createGitApi } from './app'
import { createHistoryApi } from './history-api'
import { createPreviewApi } from './preview'
import { createUploadApi, listMediaRecords } from './media'
import { createIndexApi, latchInFlight } from './index-api'
import { createFormsApi } from './forms'
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
import { createDemoApi } from './demo'
import { resolveSessionActor } from './auth/resolve-session-actor'
import type { ResolveActor } from './auth/resolve-actor'
import { allowedOrigins } from './auth/allowed-origins'
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
  type AuthCapabilities
} from './capabilities'
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

// #248 Task 9: default audit-event consumer — a single structured log line. The REAL consumer
// (persistence/alerting) is future issue #290; this is deliberately the dumbest possible sink so
// nothing here can become a second source of truth once #290 lands. Never logs anything beyond the
// event itself (see packages/auth/src/events.ts — AuthEvent.meta must never carry a secret).
function logAuthEvent(event: AuthEvent): void {
  console.info('[auth-event]', JSON.stringify(event))
}

function resolveCaptcha(provider: string, secret: string): CaptchaPort {
  if (!provider) return createNoopCaptcha() // no provider configured → dev pass-through
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
const notifyFrom = process.env.SETU_FORMS_NOTIFY_FROM
// Admin SPA origin — same env + default that allowed-origins.ts uses for the CORS/origin
// allowlist. Read once here and shared by the reset-email default callback (below) and the
// local-handshake log line (bottom of this file).
const adminOrigin = process.env.SETU_ADMIN_ORIGIN ?? 'http://localhost:5173'

// Email transport (#248 forms notifications; #364 password-reset emails share it). Selected by
// SETU_EMAIL_ADAPTER, defaulting to the zero-config console adapter (dev: logs instead of
// sending). emailCapabilityFromEnv is the single source of truth for which env value maps to a
// REAL transport (currently only 'resend') — reused here so this construction and the
// /api/capabilities report below can never silently disagree about what's actually wired up.
const emailCapability = emailCapabilityFromEnv(process.env)
const email = emailCapability.deliverable
  ? createResendEmailAdapter({ apiKey: process.env.RESEND_API_KEY ?? '' })
  : createConsoleEmailAdapter()

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
const localToken =
  mode === 'local'
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
      trustedOrigins: allowedOrigins(process.env),
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
      // /error?error=INVALID_TOKEN (see the option's doc). The admin origin is already on the
      // trustedOrigins allowlist above, so better-auth's originCheck accepts this callback. The
      // admin SPA's /reset-password screen is the next task on this branch.
      email: notifyFrom
        ? {
            send: (msg) => email.send(msg),
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

const submit = createSubmissionService({
  submissions,
  captcha,
  email,
  notifyTo,
  notifyFrom,
  renderNotification: renderSubmissionEmail // React Email HTML/text
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
      const allowed = allowedOrigins(process.env)
      return allowed.some((pattern) => originMatches(origin, pattern))
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
  originGuard(() => allowedOrigins(process.env), {
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
  createFormsApi({ submit, submissions, captchaStatus, resolveActor })
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
app.route('/', createUsersApi({ db: authDb, resolveActor }))

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
      email: emailCapability
    }),
    resolveAuthCapabilities
  )
)

serve({ fetch: app.fetch, port })
console.log(
  `api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, imageFormat: ${siteSettings.media.imageFormat}, lqip: ${siteSettings.media.imageLqip})`
)
console.log(
  `[captcha] provider=${captchaProvider || '(none)'} secretConfigured=${captchaStatus.secretConfigured}`
)
if (localToken) {
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
