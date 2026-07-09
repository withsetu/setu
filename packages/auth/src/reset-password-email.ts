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
