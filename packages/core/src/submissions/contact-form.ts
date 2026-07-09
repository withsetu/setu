import type { SubmitResult } from './submission-service'

export interface ContactRequired {
  name: boolean
  subject: boolean
  message: boolean
}

/** Linear-time email floor check, exactly equivalent to the old
 *  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` but without the polynomial backtracking
 *  (issue #340). Mirrors the server floor in submission-service.ts. */
export function isEmailish(s: string): boolean {
  const at = s.indexOf('@')
  if (at < 1) return false // need an `@` with at least one char before it
  if (s.indexOf('@', at + 1) !== -1) return false // exactly one `@`
  if (/\s/.test(s)) return false // no whitespace anywhere
  // a dot in the domain that is neither its first nor its last character
  const dot = s.indexOf('.', at + 2)
  return dot !== -1 && dot < s.length - 1
}

/** Client-side validation mirroring the server floor. email always required +
 *  format-checked; name/subject/message per the block's `required` config. */
export function validateContactFields(
  fields: Record<string, string>,
  required: ContactRequired
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const val = (k: string) => (fields[k] ?? '').trim()
  if (!isEmailish(val('email'))) errors.email = 'Enter a valid email address.'
  if (required.name && val('name') === '') errors.name = 'Required.'
  if (required.subject && val('subject') === '') errors.subject = 'Required.'
  if (required.message && val('message') === '') errors.message = 'Required.'
  return { ok: Object.keys(errors).length === 0, errors }
}

/** POST a contact submission to the forms API. Network/parse failures map to a
 *  server error result so the island can show a generic message. */
export async function submitContact(opts: {
  apiBase: string
  formId: string
  formLabel?: string
  fields: Record<string, string>
  captchaToken: string
  honeypot?: string
  pageUrl?: string
  fetchImpl?: typeof fetch
}): Promise<SubmitResult> {
  const f = opts.fetchImpl ?? fetch
  try {
    const res = await f(`${opts.apiBase.replace(/\/$/, '')}/forms/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        formId: opts.formId,
        formLabel: opts.formLabel,
        fields: opts.fields,
        captchaToken: opts.captchaToken,
        honeypot: opts.honeypot,
        source: opts.pageUrl ? { url: opts.pageUrl } : undefined
      })
    })
    if (!res.ok && res.status >= 500) return { ok: false, error: 'server' }
    return (await res.json()) as SubmitResult
  } catch {
    return { ok: false, error: 'server' }
  }
}
