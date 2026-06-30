import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createSqliteSubmissionPort } from '@setu/db-sqlite'
import { createSubmissionService, createNoopCaptcha, parseSettings } from '@setu/core'
import type { CaptchaPort } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import { createRecaptchaCaptcha } from '@setu/captcha-recaptcha'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createResendEmailAdapter } from '@setu/email-resend'
import { renderSubmissionEmail } from '@setu/email-templates'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { createFormsApi } from './forms'
import { resolveLocalOwner } from './auth/resolve-actor'

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

const app = new Hono()
app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())
app.route('/', createUploadApi({
  storage: createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl }),
  resolveActor: resolveLocalOwner,
  image: createSharpImageAdapter(),
  // Live getter, not a snapshot: re-read settings.json each request so a Media settings change
  // (format / LQIP) applies to new uploads and Reprocess without restarting the api.
  mediaSettings: () => loadSiteSettings().media,
}))
app.route('/', createFormsApi({ submit, submissions, captchaStatus }))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, imageFormat: ${siteSettings.media.imageFormat}, lqip: ${siteSettings.media.imageLqip})`)
console.log(`[captcha] provider=${captchaProvider || '(none)'} secretConfigured=${captchaStatus.secretConfigured}`)
