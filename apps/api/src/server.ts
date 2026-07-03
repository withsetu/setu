import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createSqliteSubmissionPort, createSqliteReprocessJobStore, openSqliteDb } from '@setu/db-sqlite'
import { createSubmissionService, createNoopCaptcha, parseSettings } from '@setu/core'
import type { CaptchaPort } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import { createRecaptchaCaptcha } from '@setu/captcha-recaptcha'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createResendEmailAdapter } from '@setu/email-resend'
import { renderSubmissionEmail } from '@setu/email-templates'
import { createAuth } from '@setu/auth'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { createFormsApi } from './forms'
import { resolveSessionActor } from './auth/resolve-session-actor'
import { allowedOrigins } from './auth/allowed-origins'
import { originGuard, originMatches } from './auth/origin-guard'
import { buildCapabilities, createCapabilitiesApi } from './capabilities'
import { runReprocessJob } from './reprocess-runner'
import { resumeActiveJob } from './server-resume'
import { resolveSetuMode, resolveAuthSecret } from './config'

function resolveCaptcha(provider: string, secret: string): CaptchaPort {
  if (!provider) return createNoopCaptcha() // no provider configured → dev pass-through
  if (!secret) {
    // Provider selected but secret missing.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[captcha] provider "${provider}" selected but its secret is unset — rejecting submissions`)
      return { async verify() { return false } } // fail-closed in prod
    }
    console.warn(`[captcha] provider "${provider}" selected but secret unset — dev pass-through`)
    return createNoopCaptcha()
  }
  return provider === 'recaptcha'
    ? createRecaptchaCaptcha({ secret })
    : createTurnstileCaptcha({ secret })
}

/** better-auth's captcha plugin option, derived from the same env vars forms captcha reads.
 *  Omitted entirely when no provider is configured or its secret is unset (fail closed —
 *  no captcha plugin means better-auth doesn't gate on a check we can't perform). */
function authCaptchaFromEnv(): { provider: 'cloudflare-turnstile' | 'google-recaptcha'; secretKey: string } | undefined {
  const provider = process.env.SETU_CAPTCHA_PROVIDER ?? ''
  if (provider !== 'turnstile' && provider !== 'recaptcha') return undefined
  const secretKey =
    provider === 'recaptcha' ? (process.env.SETU_RECAPTCHA_SECRET ?? '') : (process.env.SETU_TURNSTILE_SECRET ?? '')
  if (!secretKey) return undefined
  return { provider: provider === 'turnstile' ? 'cloudflare-turnstile' : 'google-recaptcha', secretKey }
}

/** better-auth's socialProviders option. Each provider is included only when BOTH its client id
 *  and secret are set — an incomplete pair is omitted (fail closed, not a broken provider). */
function authSocialProvidersFromEnv(): { github?: { clientId: string; clientSecret: string }; google?: { clientId: string; clientSecret: string } } | undefined {
  const out: { github?: { clientId: string; clientSecret: string }; google?: { clientId: string; clientSecret: string } } = {}
  const githubId = process.env.SETU_GITHUB_CLIENT_ID
  const githubSecret = process.env.SETU_GITHUB_CLIENT_SECRET
  if (githubId && githubSecret) out.github = { clientId: githubId, clientSecret: githubSecret }
  const googleId = process.env.SETU_GOOGLE_CLIENT_ID
  const googleSecret = process.env.SETU_GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret) out.google = { clientId: googleId, clientSecret: googleSecret }
  return Object.keys(out).length > 0 ? out : undefined
}

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`

function loadSiteSettings() {
  try {
    const raw = readFileSync(join(dir, 'settings.json'), 'utf-8')
    return parseSettings(JSON.parse(raw) as unknown)
  } catch {
    return parseSettings(undefined)
  }
}
const siteSettings = loadSiteSettings()

const submissionsDb = process.env.SETU_SUBMISSIONS_DB ?? `${dir}/.setu/submissions.db`
const notifyTo = process.env.SETU_FORMS_NOTIFY_TO
const notifyFrom = process.env.SETU_FORMS_NOTIFY_FROM

// Ensure .setu/ parent dir exists before better-sqlite3 opens the DB file
mkdirSync(`${dir}/.setu`, { recursive: true })

const submissions = createSqliteSubmissionPort(submissionsDb)

// Better Auth's tables live in the SAME sqlite file as submissions (SETU_SUBMISSIONS_DB) — one
// drizzle handle, shared migrations folder (see packages/db-sqlite/src/open-db.ts).
const authDb = openSqliteDb(submissionsDb)
const baseURL = process.env.SETU_BASE_URL ?? `http://localhost:${port}`

// Loopback token handshake (local topology only, #248 Task 4): the process that boots the api
// mints a ONE-TIME token; the admin exchanges it at POST /api/auth/local/exchange (see
// @setu/auth's localToken plugin) for a completely normal Better Auth session. Module state here
// holds the token — this is boot-scoped, per-process state by design (a fresh token every
// restart), not persisted anywhere.
//
// `getToken()` reflects a stable topology-level fact ("local-token capability exists"), so it
// keeps returning the same token for the process lifetime — it is NOT how single-use is
// enforced. Single-use is the plugin's own job (its guard order returns 404 only when getToken()
// is null, and 401 for an already-consumed token — conflating the two would make "wrong
// topology" indistinguishable from "already used"). `consume()` here is a no-op hook for future
// observability (e.g. logging that the handshake completed); the token remains fixed.
//
// `localUserId` is a stub for this task: it REJECTS with a clear error until Task 7 wires up
// ensureLocalOwner (creating/finding the single local owner account). Structured so Task 7 only
// needs to swap this one function for the real lookup — nothing else in the handshake changes.
function buildLocalTokenOptions() {
  const token = randomBytes(32).toString('base64url')
  return {
    token, // returned ONLY so the caller can log the one-time handoff URL below; never logged elsewhere.
    getToken: () => token,
    consume: () => {},
    localUserId: async (): Promise<string> => {
      throw new Error('local owner bootstrap lands in Task 7 (#248) — ensureLocalOwner not wired yet')
    },
  }
}

const mode = resolveSetuMode(process.env)
const localToken = mode === 'local' ? buildLocalTokenOptions() : undefined

const auth = createAuth({
  db: authDb,
  secret: resolveAuthSecret(),
  baseURL,
  trustedOrigins: allowedOrigins(process.env),
  captcha: authCaptchaFromEnv(),
  socialProviders: authSocialProvidersFromEnv(),
  localToken,
})
const resolveActor = resolveSessionActor(auth)

// Spam protection: select a captcha adapter by env. Secret is env-only.
const captchaProvider = process.env.SETU_CAPTCHA_PROVIDER ?? '' // 'turnstile' | 'recaptcha' | ''
const captchaSecret =
  captchaProvider === 'recaptcha'
    ? (process.env.SETU_RECAPTCHA_SECRET ?? '')
    : (process.env.SETU_TURNSTILE_SECRET ?? '')
const captcha = resolveCaptcha(captchaProvider, captchaSecret)
const captchaStatus = { provider: captchaProvider, secretConfigured: captchaSecret !== '' }
const emailAdapter = process.env.SETU_EMAIL_ADAPTER ?? 'console'
const email =
  emailAdapter === 'resend'
    ? createResendEmailAdapter({ apiKey: process.env.RESEND_API_KEY ?? '' })
    : createConsoleEmailAdapter()

const submit = createSubmissionService({
  submissions,
  captcha,
  email,
  notifyTo,
  notifyFrom,
  renderNotification: renderSubmissionEmail, // React Email HTML/text
})

const imageAdapter = createSharpImageAdapter()
const localStorage = createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl })
const reprocessStore = createSqliteReprocessJobStore(`${dir}/.setu/reprocess.db`)
const runReprocess = (jobId: string) => {
  const media = loadSiteSettings().media
  void runReprocessJob(reprocessStore, { image: imageAdapter, storage: localStorage, media, widths: [400, 800, 1200, 1600] }, jobId)
}

const app = new Hono()

// CORS allowlist (credentialed) + Host/Origin guard (DNS-rebinding/tunnel-detection), applied
// globally, before any route — including /api/auth/*.
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return undefined
      const allowed = allowedOrigins(process.env)
      return allowed.some((pattern) => originMatches(origin, pattern)) ? origin : undefined
    },
    credentials: true,
  }),
)
// publicPaths: routes that are deliberately public and read NO ambient credentials (no session
// cookie, no auth check) — captcha is the only gate. `/forms/submit` is an embeddable public form
// widget (#248 follow-up): it must stay reachable from any visitor origin. Anything reading a
// session (e.g. the /forms/submissions admin CRUD routes) MUST NOT be listed here — those stay
// behind the origin check.
app.use('*', originGuard(() => allowedOrigins(process.env), { publicPaths: ['/forms/submit'] }))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())
app.route('/', createUploadApi({
  storage: localStorage,
  resolveActor,
  image: imageAdapter,
  // Live getter, not a snapshot: re-read settings.json each request so a Media settings change
  // (format / LQIP) applies to new uploads and Reprocess without restarting the api.
  mediaSettings: () => loadSiteSettings().media,
  reprocess: { store: reprocessStore, run: runReprocess },
}))
app.route('/', createFormsApi({ submit, submissions, captchaStatus }))
app.route('/', createCapabilitiesApi(buildCapabilities({
  image: imageAdapter,            // present in the Node topology
  writableMediaStore: true,       // local fs storage is writable
  backgroundJobs: true,           // persistent Node process can run jobs
  mode,
})))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, imageFormat: ${siteSettings.media.imageFormat}, lqip: ${siteSettings.media.imageLqip})`)
console.log(`[captcha] provider=${captchaProvider || '(none)'} secretConfigured=${captchaStatus.secretConfigured}`)
if (localToken) {
  // The ONE place the token is ever logged — this is the intended handoff channel to the admin.
  // Never log the token (or this URL) anywhere else.
  const adminOrigin = process.env.SETU_ADMIN_ORIGIN ?? 'http://localhost:5173'
  console.log(`Admin handshake: ${adminOrigin}/#setu-token=${localToken.token}`)
}
resumeActiveJob(reprocessStore, runReprocess)
