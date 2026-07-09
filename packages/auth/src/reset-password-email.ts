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

/** #364: the password-reset email body, built as a plain template string — NOT a React Email
 *  template. `packages/email-templates` today has exactly one slot (`renderSubmissionNotification`,
 *  a forms feature) with its own render engine and layout; a password-reset email is a different
 *  lifecycle event with a different, one-line data shape (a bare reset URL). Standing up a second
 *  template in that package for a single link would be premature ceremony — this plain string IS
 *  the entire feature. Promote it into `@setu/email-templates` the moment a SECOND auth-lifecycle
 *  email (e.g. email-verification) needs shared chrome/layout with this one. */
export function resetPasswordEmailContent(url: string): {
  subject: string
  html: string
  text: string
} {
  return {
    subject: 'Reset your Setu password',
    html: `<p>We received a request to reset the password for your Setu account.</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link will expire soon. If you didn't request this, you can safely ignore this email.</p>`,
    text: `We received a request to reset the password for your Setu account.

Reset your password: ${url}

This link will expire soon. If you didn't request this, you can safely ignore this email.`
  }
}
