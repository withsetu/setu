import { SubmissionApiError } from '@setu/submission-http'

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
