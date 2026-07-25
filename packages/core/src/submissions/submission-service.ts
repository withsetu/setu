import type { SubmissionPort } from './submission-port'
import type { Submission } from './types'
import type { EmailPort } from '../email/email-port'
import type { CaptchaPort } from '../captcha/captcha-port'
import { renderEmailTemplate } from '../email/template-registry'
import {
  FORM_NOTIFICATION_EMAIL,
  formNotificationValues
} from '../email/templates/form-notification'

export interface SubmitInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  captchaToken: string
  honeypot?: string
  source?: Submission['source']
  ip?: string
}

export type SubmitResult =
  | { ok: true; id?: string }
  | { ok: false; error: 'spam' | 'invalid' | 'server' }

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
  captcha: CaptchaPort
  email?: EmailPort
  notifyTo?: string
  /** Sender for the notification email. May be a thunk (#498): it is then re-resolved on EVERY
   *  submission — both the notify gate and the message's `from` follow the live value, so a
   *  from-address saved in Settings → Email applies without reconstructing the service
   *  (packages/core/test/submissions/submission-service.test.ts pins this). A plain string
   *  behaves as before. */
  notifyFrom?: string | (() => string | undefined)
  /** Override the notification body. Defaults to `defaultRender` below — the
   *  `form-notification` registry type's shipped default (#499). apps/api injects a resolver
   *  that applies the admin's stored override, re-read per submission. May be async: the
   *  signature keeps the Promise arm so a topology whose renderer needs I/O still fits. */
  renderNotification?: (
    submission: Submission
  ) => NotificationContent | Promise<NotificationContent>
  /** #921 (CLAUDE.md §4 #22): called with a named reason when a submission that SHOULD have
   *  notified could not. Mirrors `createResetEmailSender`'s `onRefused` — apps/api points it at
   *  console.error. Only the "configured, then broke" case fires (see the call site);
   *  packages/core/test/submissions/submission-service.test.ts pins both directions. */
  onNotifySkipped?: (reason: string) => void
}

/** Linear-time email floor check, exactly equivalent to the old
 *  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (a valid local part, one `@`, and a domain
 *  containing an interior dot) but without the adjacent-quantifier backtracking
 *  that made that regex polynomial on adversarial input (issue #340 — this runs
 *  on the UNAUTHENTICATED `/forms/submit` path). */
export function isEmailish(s: string): boolean {
  const at = s.indexOf('@')
  if (at < 1) return false // need an `@` with at least one char before it
  if (s.indexOf('@', at + 1) !== -1) return false // exactly one `@`
  if (/\s/.test(s)) return false // no whitespace anywhere
  // a dot in the domain that is neither its first nor its last character
  const dot = s.indexOf('.', at + 2)
  return dot !== -1 && dot < s.length - 1
}

/** #499: the fallback body is now the `form-notification` type's SHIPPED DEFAULT, rendered by
 *  the same function apps/api's override-aware renderer and the admin's live preview call. This
 *  file used to carry its own third template (plus a private escapeHtml copy) — so an
 *  installation without `renderNotification` wired got different mail from one with it. Now the
 *  two differ only by whether an admin override is applied. */
const defaultRender = (s: Submission): NotificationContent =>
  renderEmailTemplate(
    FORM_NOTIFICATION_EMAIL,
    undefined,
    formNotificationValues(s)
  )

/** The topology-agnostic submit pipeline: honeypot → captcha → validate →
 *  persist → best-effort notify. Runs unchanged behind apps/api today and a
 *  Worker later. */
export function createSubmissionService(
  deps: SubmissionServiceDeps
): SubmissionService {
  const { submissions, captcha, email, notifyTo, notifyFrom } = deps
  const render = deps.renderNotification ?? defaultRender

  return {
    async submit(input) {
      // 1. Honeypot — bots fill it. Pretend success, store nothing (no signal).
      if (input.honeypot && input.honeypot.trim() !== '') return { ok: true }

      // 2. Captcha (fails closed inside the adapter).
      if (!(await captcha.verify(input.captchaToken, input.ip)))
        return { ok: false, error: 'spam' }

      // 3. Validate server-side floor: a valid email + a non-empty message.
      const emailVal = (input.fields['email'] ?? '').trim()
      const message = (input.fields['message'] ?? '').trim()
      if (!isEmailish(emailVal) || message === '')
        return { ok: false, error: 'invalid' }

      // 4. Persist.
      let saved: Submission
      try {
        saved = await submissions.saveSubmission({
          formId: input.formId,
          formLabel: input.formLabel,
          fields: input.fields,
          source: input.source
        })
      } catch {
        return { ok: false, error: 'server' }
      }

      // 5. Best-effort notify — never fails the submission. The from-address is resolved HERE,
      // per submission, so a thunk-shaped notifyFrom keeps both the gate and the sender live.
      const from = typeof notifyFrom === 'function' ? notifyFrom() : notifyFrom
      if (email && notifyTo && from) {
        try {
          const content = await render(saved)
          await email.send({ to: notifyTo, from, ...content })
        } catch (e) {
          console.error('[submission-service] notify failed', e)
        }
      } else if (email && notifyTo) {
        // #921: notifications ARE configured (a transport and a recipient), so a missing
        // from-address is a break, not a choice — and since #498 it is resolved live, so it can
        // vanish mid-run from a Settings → Email save or a `git push` (settings.json is
        // Git-canonical). Reporting is gated on `notifyTo` precisely so the never-configured
        // case stays silent: claiming a failure that did not happen is the inverse defect (#834).
        // The submission itself is already persisted — nothing is lost, the operator just stops
        // being told, which is the part that was invisible.
        deps.onNotifySkipped?.(
          'no from-address is configured, so the form-notification email was not sent — the ' +
            'submission was saved. Set one in Settings → Email (or SETU_FORMS_NOTIFY_FROM).'
        )
      }

      return { ok: true, id: saved.id }
    }
  }
}
