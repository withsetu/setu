import { SubmissionApiError } from '@setu/submission-http'
import { GitApiError } from '@setu/git-http'

export function connectionError(action: string): string {
  return `Couldn't ${action}. Check your connection and try again.`
}

/** Message for a failed forms/submissions action.
 *
 *  `SubmissionApiError` means the server ANSWERED and said why (apps/api/src/
 *  forms.ts sends `{ error: 'forbidden' | 'invalid' | 'too_large' }` plus the
 *  status), so the user gets that reason. Every other rejection never got a
 *  reply — offline, api down, DNS, CORS — which is the only case
 *  `connectionError`'s "check your connection" is actually true of.
 *
 *  Same #870/#852 shape as `MediaTransportError`, inverted: there the TAGGED
 *  class is the transport half, here it is the server half. Both directions are
 *  enforced by apps/admin/test/forms-inbox.test.tsx.
 *
 *  `action` is a bare verb phrase — 'delete the submissions', 'mark this as
 *  read' — so it reads after "Couldn't ". */
export function submissionError(err: unknown, action: string): string {
  if (!(err instanceof SubmissionApiError)) return connectionError(action)
  const lead = `Couldn't ${action}`
  if (err.status === 401)
    return `${lead} — your session has expired. Sign in again.`
  if (err.status === 403)
    return `${lead} — your role doesn't have permission for this.`
  if (err.status === 404)
    return `${lead} — it no longer exists. Refresh the list.`
  if (err.status === 413)
    return `${lead} — that was too much at once. Select fewer and try again.`
  if (err.status === 400)
    return `${lead} — the server rejected the request as invalid.`
  if (err.status >= 500)
    return `${lead} — the server had a problem (${err.status}). Try again.`
  return `${lead} (server error ${err.status}${err.code ? `: ${err.code}` : ''}).`
}

/** Message for a failed Git write (publish / save draft / unpublish).
 *
 *  `GitApiError` means the server ANSWERED and refused, so the user gets the reason.
 *  Everything else never got a reply — offline, api down, DNS, CORS — which is the only
 *  case `connectionError`'s "check your connection" is actually true of. Before #253 this
 *  path reported EVERY publish failure as a connection problem; the field gate made a
 *  server-answered refusal reachable, and "check your connection" is simply false for it.
 *
 *  Same split as `submissionError` above.
 *
 *  `action` is a bare verb phrase — 'publish', 'save the draft' — so it reads after
 *  "Couldn't ". Enforced by apps/admin/test/error-message.test.ts. */
export function writeError(err: unknown, action: string): string {
  if (!(err instanceof GitApiError)) return connectionError(action)
  const lead = `Couldn't ${action}`
  if (err.status === 422 && err.issues.length > 0) {
    // Name the offending fields rather than paraphrasing — the author cannot act on
    // "invalid" — and separate MISSING fields from present-but-wrong ones, because
    // "requires x" is simply false for a field that was supplied with a bad value.
    const isMissing = (m: string) => /^required$/i.test(m.trim())
    const missing = [
      ...new Set(
        err.issues
          .filter((i) => isMissing(i.message) && i.field !== '')
          .map((i) => i.field)
      )
    ]
    const wrong = err.issues.filter(
      (i) => !isMissing(i.message) || i.field === ''
    )
    const parts: string[] = []
    if (missing.length > 0)
      parts.push(
        `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`
      )
    // Cap the verbatim ones: a toast that lists ten zod messages is unreadable.
    for (const i of wrong.slice(0, 2))
      parts.push(i.field === '' ? i.message : `${i.field}: ${i.message}`)
    if (wrong.length > 2) parts.push(`and ${wrong.length - 2} more`)
    return `${lead} — ${parts.join('; ')}.`
  }
  if (err.status === 401)
    return `${lead} — your session has expired. Sign in again.`
  if (err.status === 403)
    return `${lead} — your role doesn't have permission for this.`
  if (err.status === 413) return `${lead} — that was too large to send.`
  if (err.status >= 500)
    return `${lead} — the server had a problem (${err.status}). Try again.`
  return `${lead} (server error ${err.status}).`
}
