import type { SubmissionPort } from './submission-port'
import type { Submission } from './types'
import type { EmailPort } from '../email/email-port'
import type { TurnstileVerifier } from './turnstile'

export interface SubmitInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  turnstileToken: string
  honeypot?: string
  source?: Submission['source']
  ip?: string
}

export type SubmitResult = { ok: true; id?: string } | { ok: false; error: 'spam' | 'invalid' | 'server' }

export interface NotificationContent {
  subject: string
  html: string
  text?: string
}

export interface SubmissionService {
  submit(input: SubmitInput): Promise<SubmitResult>
}

export interface SubmissionServiceDeps {
  submissions: SubmissionPort
  verifyTurnstile: TurnstileVerifier
  email?: EmailPort
  notifyTo?: string
  notifyFrom?: string
  /** Override the notification body. Defaults to a plain-text summary. May be
   *  async (React Email's render() is async — see Phase 5). */
  renderNotification?: (submission: Submission) => NotificationContent | Promise<NotificationContent>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const defaultRender = (s: Submission): NotificationContent => {
  const lines = Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`)
  const text = `New submission on "${s.formLabel ?? s.formId}"\n\n${lines.join('\n')}`
  return {
    subject: `New submission: ${s.formLabel ?? s.formId}`,
    html: `<h2>New submission: ${s.formLabel ?? s.formId}</h2><ul>${Object.entries(s.fields)
      .map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`)
      .join('')}</ul>`,
    text,
  }
}

/** The topology-agnostic submit pipeline: honeypot → Turnstile → validate →
 *  persist → best-effort notify. Runs unchanged behind apps/api today and a
 *  Worker later. */
export function createSubmissionService(deps: SubmissionServiceDeps): SubmissionService {
  const { submissions, verifyTurnstile, email, notifyTo, notifyFrom } = deps
  const render = deps.renderNotification ?? defaultRender

  return {
    async submit(input) {
      // 1. Honeypot — bots fill it. Pretend success, store nothing (no signal).
      if (input.honeypot && input.honeypot.trim() !== '') return { ok: true }

      // 2. Turnstile (fails closed inside the verifier).
      if (!(await verifyTurnstile(input.turnstileToken, input.ip))) return { ok: false, error: 'spam' }

      // 3. Validate server-side floor: a valid email + a non-empty message.
      const emailVal = (input.fields['email'] ?? '').trim()
      const message = (input.fields['message'] ?? '').trim()
      if (!EMAIL_RE.test(emailVal) || message === '') return { ok: false, error: 'invalid' }

      // 4. Persist.
      let saved: Submission
      try {
        saved = await submissions.saveSubmission({
          formId: input.formId,
          formLabel: input.formLabel,
          fields: input.fields,
          source: input.source,
        })
      } catch {
        return { ok: false, error: 'server' }
      }

      // 5. Best-effort notify — never fails the submission.
      if (email && notifyTo && notifyFrom) {
        const content = await render(saved)
        try {
          await email.send({ to: notifyTo, from: notifyFrom, ...content })
        } catch (e) {
          console.error('[submission-service] notify failed', e)
        }
      }

      return { ok: true, id: saved.id }
    },
  }
}
