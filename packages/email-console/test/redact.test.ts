import { describe, it, expect, vi } from 'vitest'
import { createConsoleEmailAdapter, redactSecretsInUrls } from '../src/index'

/** The real shape better-auth 1.6.24 builds for a reset link: a token as the LAST PATH SEGMENT,
 *  plus a callbackURL query param (dist/api/routes/password.mjs). The stand-in is deliberately
 *  low-entropy and self-describing — a realistic `generateId(24)` string trips gitleaks'
 *  generic-api-key rule on push. What the redactor keys on is the SHAPE (16+ chars of the
 *  URL-safe token alphabet), which this has; the assertion against a REAL generated token lives
 *  in apps/api/test/reset-password-leak.test.ts. */
const RESET_TOKEN = 'reset-token-fixture-not-a-real-secret'
const RESET_URL = `http://localhost:4444/api/auth/reset-password/${RESET_TOKEN}?callbackURL=http%3A%2F%2Flocalhost%3A5173%2Freset-password`

describe('redactSecretsInUrls', () => {
  it('removes a token carried as a URL path segment', () => {
    const out = redactSecretsInUrls(`Reset your password: ${RESET_URL}`)
    expect(out).not.toContain(RESET_TOKEN)
    // Still recognisable as a reset link, so the dev log stays useful.
    expect(out).toContain('/api/auth/reset-password/')
    expect(out).toContain('[redacted]')
  })

  it('keeps the token out even when the URL ends a sentence', () => {
    const out = redactSecretsInUrls(`Open ${RESET_URL.split('?')[0]}.`)
    expect(out).not.toContain(RESET_TOKEN)
    // The sentence punctuation is not swallowed into the URL.
    expect(out.endsWith('.')).toBe(true)
  })

  it('removes the value of a credential-named query param', () => {
    const out = redactSecretsInUrls(
      'https://site.test/verify?token=abc123&otp=999999&name=Ada'
    )
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('999999')
    // Non-credential params survive: the log has to stay diagnosable.
    expect(out).toContain('name=Ada')
  })

  it('removes a token nested inside another URL in a query value', () => {
    const inner = `https://admin.test/callback/${RESET_TOKEN}`
    const out = redactSecretsInUrls(
      `https://site.test/go?next=${encodeURIComponent(inner)}`
    )
    expect(out).not.toContain(RESET_TOKEN)
    expect(out).not.toContain(encodeURIComponent(RESET_TOKEN))
  })

  it('removes a token carried in the fragment', () => {
    const out = redactSecretsInUrls(`https://site.test/x#${RESET_TOKEN}`)
    expect(out).not.toContain(RESET_TOKEN)
  })

  it('redacts the whole URL when it cannot be parsed (fails closed)', () => {
    const out = redactSecretsInUrls(`http://[oops${RESET_TOKEN}`)
    expect(out).not.toContain(RESET_TOKEN)
  })

  it('finds every URL in a multi-line body', () => {
    const out = redactSecretsInUrls(
      `line one ${RESET_URL}\nline two <a href="${RESET_URL}">click</a>`
    )
    expect(out).not.toContain(RESET_TOKEN)
  })

  it('leaves non-URL prose alone', () => {
    const body = 'Name: Ada Lovelace\nMessage: hello there, a long-ish sentence'
    expect(redactSecretsInUrls(body)).toBe(body)
  })

  it('leaves short, human-meaningful path segments alone', () => {
    const url = 'https://admin.test/submissions/inbox?page=2'
    expect(redactSecretsInUrls(url)).toBe(url)
  })

  it('drops URL userinfo, which is a credential of its own', () => {
    const out = redactSecretsInUrls('https://admin:hunter2pass@site.test/x')
    expect(out).not.toContain('hunter2pass')
    expect(out).toContain('site.test/x')
  })

  it('redacts a long slug too — the blunt shape test errs toward safety', () => {
    // Documented over-redaction (see isTokenShaped): the cost is a less readable dev log line.
    expect(
      redactSecretsInUrls('https://site.test/blog/the-best-blog-post-ever')
    ).toContain('[redacted]')
  })
})

describe('console adapter redaction', () => {
  it('never logs a reset token', async () => {
    const log = vi.fn()
    await createConsoleEmailAdapter(log).send({
      to: 'someone@x.com',
      from: 'site@x.com',
      subject: 'Reset your Setu password',
      text: `Reset your password: ${RESET_URL}`,
      html: `<p><a href="${RESET_URL}">Reset your password</a></p>`
    })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).not.toContain(RESET_TOKEN)
    // Still says WHAT was sent and TO WHOM — the dev-useful half.
    expect(line).toContain('someone@x.com')
    expect(line).toContain('Reset your Setu password')
  })

  it('redacts the html body too when there is no text alternative', async () => {
    const log = vi.fn()
    await createConsoleEmailAdapter(log).send({
      to: 'someone@x.com',
      from: 'site@x.com',
      subject: 'Reset your Setu password',
      html: `<p><a href="${RESET_URL}">Reset your password</a></p>`
    })
    expect(String(log.mock.calls[0]![0])).not.toContain(RESET_TOKEN)
  })
})
