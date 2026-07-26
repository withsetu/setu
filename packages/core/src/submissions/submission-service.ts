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

/** Everything ONE notification needs, resolved together (#939). See
 *  `SubmissionServiceDeps.resolveNotification`. */
export interface NotificationContext {
  /** The from-address for this notification, or undefined when none is configured. */
  from: string | undefined
  render: (
    submission: Submission
  ) => NotificationContent | Promise<NotificationContent>
  send: (msg: {
    to: string
    from: string
    subject: string
    html: string
    text?: string
  }) => Promise<void>
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
  /** #918: the outbound-mail ceiling seam. Consulted ONCE per submission that would otherwise
   *  notify, immediately before the send, and only after every other precondition holds — so a
   *  submission that was never going to notify cannot burn quota. Return null to allow (the
   *  implementation consumes a slot as it answers) or a named operator-facing reason to skip;
   *  a reason is reported through `onNotifySkipped` exactly like the missing-from-address case.
   *
   *  Why it lives here rather than in the HTTP layer: this is the one place that knows the
   *  submission is ALREADY PERSISTED, which is what makes "skip the email, keep the submission"
   *  a safe answer to a burst — losing a genuine submission is worse than losing its email. A
   *  rate limit at the route can only refuse the whole request.
   *
   *  apps/api supplies `createNotifyCeiling` from apps/api/src/rate-limit.ts, which keys on
   *  nothing at all, so no header, address or session can mint fresh quota. Both halves — the
   *  skip-with-reason and the still-persisted row — are pinned by
   *  packages/core/test/submissions/submission-service.test.ts ("the notification ceiling"). */
  allowNotification?: () => string | null
  /** #939: resolve the from-address, the renderer and the sender in ONE call, instead of reaching
   *  for `notifyFrom`, `renderNotification` and `email.send` independently.
   *
   *  Why the seam exists at all: in apps/api all three of those are backed by settings.json, so a
   *  single form notification — a VISITOR-triggered path — parsed that file three times, and the
   *  count grew with each new resolution concern rather than with the number of emails. This lets
   *  the host resolve once per notification. It is NOT a cache and must not become one: it is
   *  called INSIDE `submit`, so a from-address, provider or template saved between two
   *  submissions still applies to the second (apps/api/test/email-read-count.test.ts drives both
   *  halves — the count and the save-takes-effect-next-send liveness).
   *
   *  Called at most ONCE per submission, and only after the row is persisted and `notifyTo` plus
   *  a transport are known — so a honeypot, captcha or validation reject still costs nothing.
   *  When omitted it is derived from `notifyFrom` / `renderNotification` / `email`, which is the
   *  only path this service had before and remains the shape every other topology uses.
   *  packages/core/test/submissions/submission-service.test.ts pins both wirings, including that
   *  the derived default resolves `notifyFrom` per submission. */
  resolveNotification?: () => NotificationContext
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
  // #939: ONE code path through the notify block, whichever wiring the host chose. The default
  // reproduces the pre-#939 behaviour exactly — `notifyFrom` resolved per submission, the
  // renderer and `email.send` reached separately — so a host that supplies neither
  // `resolveNotification` nor a thunk-shaped `notifyFrom` is unaffected.
  const resolveNotification: () => NotificationContext =
    deps.resolveNotification ??
    (() => ({
      from: typeof notifyFrom === 'function' ? notifyFrom() : notifyFrom,
      render,
      // Non-null: this thunk is only ever called inside the `notifications are wired` branch
      // below, whose condition includes `email !== undefined` when `resolveNotification` is
      // absent. Pinned by packages/core/test/submissions/submission-service.test.ts ("stays
      // quiet on the happy path, and when there is no email port at all").
      send: (msg) => email!.send(msg)
    }))

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

      // 5. Best-effort notify — never fails the submission. The row is ALREADY persisted here,
      // and apps/api/src/forms.ts awaits submit() inside the request handler, so anything that
      // escapes this block turns a saved submission into a 500 for the visitor. The whole block
      // is therefore wrapped, not just the send: `notifyFrom` is a live thunk that reads
      // settings.json in apps/api (it can throw on an unreadable file), and `onNotifySkipped` is
      // caller-supplied. Both throw paths are pinned by
      // packages/core/test/submissions/submission-service.test.ts ("cannot fail a persisted
      // submission").
      try {
        // Notifications are WIRED when there is a recipient and something that can send them.
        // The context — from-address, renderer and sender — is resolved HERE, per submission,
        // which is what keeps a thunk-shaped `notifyFrom` (and, since #939, apps/api's whole
        // settings reading) live: a save landing between two submissions applies to the second.
        if (notifyTo && (email !== undefined || deps.resolveNotification)) {
          const notify = resolveNotification()
          const from = notify.from
          if (from) {
            // #918: last gate before the only line in this service that costs the operator money
            // and sender reputation. Checked here — after the row is persisted and after every
            // "would we even notify" precondition — so hitting the ceiling costs an email and
            // never a submission, and so a submission that was never going to notify cannot
            // consume ceiling quota on its way past.
            const ceilingReason = deps.allowNotification?.() ?? null
            if (ceilingReason !== null) {
              deps.onNotifySkipped?.(ceilingReason)
            } else {
              const content = await notify.render(saved)
              await notify.send({ to: notifyTo, from, ...content })
            }
          } else {
            // #921: notifications ARE configured (a transport and a recipient), so a missing
            // from-address is a break, not a choice — and since #498 it is resolved live, so it
            // can vanish mid-run from a Settings → Email save or a `git push` (settings.json is
            // Git-canonical). Reporting is gated on `notifyTo` precisely so the never-configured
            // case stays silent: claiming a failure that did not happen is the inverse defect
            // (#834). The submission itself is already persisted — nothing is lost, the operator
            // just stops being told, which is the part that was invisible.
            deps.onNotifySkipped?.(
              'no from-address is configured, so the form-notification email was not sent — the ' +
                'submission was saved. Set one in Settings → Email (or SETU_FORMS_NOTIFY_FROM).'
            )
          }
        }
      } catch (e) {
        console.error('[submission-service] notify failed', e)
      }

      return { ok: true, id: saved.id }
    }
  }
}
