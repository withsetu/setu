import { mkdirSync } from 'node:fs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createSqliteSubmissionPort } from '@setu/db-sqlite'
import { createSubmissionService, createTurnstileVerifier } from '@setu/core'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createResendEmailAdapter } from '@setu/email-resend'
import { renderSubmissionEmail } from '@setu/email-templates'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { createFormsApi } from './forms'
import { resolveLocalOwner } from './auth/resolve-actor'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`
const imageFormat = process.env.SETU_IMAGE_FORMAT === 'avif' ? 'avif' : 'webp'

const submissionsDb = process.env.SETU_SUBMISSIONS_DB ?? `${dir}/.setu/submissions.db`
const turnstileSecret = process.env.SETU_TURNSTILE_SECRET ?? ''
const notifyTo = process.env.SETU_FORMS_NOTIFY_TO
const notifyFrom = process.env.SETU_FORMS_NOTIFY_FROM

// Ensure .setu/ parent dir exists before better-sqlite3 opens the DB file
mkdirSync(`${dir}/.setu`, { recursive: true })

const submissions = createSqliteSubmissionPort(submissionsDb)
// No secret configured (dev) → accept all (Turnstile disabled). In prod the secret
// MUST be set; an unset secret in production should be treated as misconfiguration.
const verifyTurnstile = turnstileSecret
  ? createTurnstileVerifier(turnstileSecret)
  : async () => true
const emailAdapter = process.env.SETU_EMAIL_ADAPTER ?? 'console'
const email =
  emailAdapter === 'resend'
    ? createResendEmailAdapter({ apiKey: process.env.RESEND_API_KEY ?? '' })
    : createConsoleEmailAdapter()

const submit = createSubmissionService({
  submissions,
  verifyTurnstile,
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
  imageConfig: { format: imageFormat, widths: [400, 800, 1200, 1600] },
}))
app.route('/', createFormsApi({ submit, submissions }))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, image: ${imageFormat})`)
