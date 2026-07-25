import {
  renderEmailTemplate,
  passwordResetValues,
  PASSWORD_RESET_EMAIL
} from '@setu/core'

/** #364 review fix: better-auth's `/reset-password/:token` callback route treats an EMPTY
 *  `callbackURL` query param as invalid — `if (!token || !callbackURL) throw ctx.redirect(
 *  redirectError(ctx.context, callbackURL, { error: "INVALID_TOKEN" }))` (1.6.23
 *  dist/api/routes/password.mjs line 115) — and its request route builds the emailed link with
 *  `callbackURL=${redirectTo ? encodeURIComponent(redirectTo) : ''}` (lines 71-72), i.e.
 *  literally empty when the `/request-password-reset` caller omitted `redirectTo`. So an emailed
 *  link without a callback is a guaranteed 302 to `${apiBase}/error?error=INVALID_TOKEN` — a dead
 *  end. This helper makes the send path incapable of emitting one: if the built link's
 *  `callbackURL` is absent or empty, fill in the caller-configured default (the admin origin's
 *  `/reset-password` route — that admin SPA screen lands in the next task on this branch); a link
 *  that already carries a non-empty callback (the requester passed an explicit, origin-checked
 *  `redirectTo`) is returned byte-for-byte untouched — never rewritten. */
export function withDefaultResetCallback(
  url: string,
  defaultRedirectTo: string
): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not parseable as an absolute URL — leave whatever better-auth built untouched rather than
    // guess (unreachable with 1.6.23's construction, which always starts from ctx.context.baseURL).
    return url
  }
  if (parsed.searchParams.get('callbackURL')) return url
  parsed.searchParams.set('callbackURL', defaultRedirectTo) // percent-encodes the value
  return parsed.href
}

/** What the reset send path knows about the message it is building. `url` is the ONLY required
 *  member and is always the link this module produced from better-auth's — never anything a
 *  template supplied. */
export interface ResetPasswordEmailInput {
  url: string
  userName?: string
  userEmail?: string
  siteTitle?: string
}

export type ResetPasswordEmailContent = {
  subject: string
  html: string
  text: string
}

/**
 * The password-reset email body.
 *
 * #364 wrote these strings inline here. #499 (epic #497) moved them into core's email TYPE
 * registry — `PASSWORD_RESET_EMAIL` — so an admin can customize them in Settings → Email, and
 * this function became the thin default: registry definition, no override, values built from
 * the link. It is what @setu/auth uses when the caller injects no `content` resolver of its own
 * (apps/api injects one that applies the admin's stored override live, per send).
 *
 * The move is byte-neutral: packages/auth/test/reset-password-email.test.ts asserts this equals
 * the registry default, and packages/core/test/email/email-registry.test.ts holds the pre-#499
 * strings verbatim, so a drift in either direction fails a test.
 */
export function resetPasswordEmailContent(
  input: ResetPasswordEmailInput
): ResetPasswordEmailContent {
  return renderEmailTemplate(
    PASSWORD_RESET_EMAIL,
    undefined,
    passwordResetValues(input)
  )
}
