/** #868: detection of Cloudflare Turnstile's permanent public dummy keys.
 *
 *  Turnstile ships well-known test sitekeys/secrets that work on ANY domain and auto-resolve
 *  every challenge (values verified against
 *  developers.cloudflare.com/turnstile/troubleshooting/testing, fetched 2026-07-25). They are
 *  exactly what dev and the e2e captcha lane want (see e2e/captcha.config.ts) and exactly what a
 *  production boot must never run with — the always-pass secret accepts every token, so the
 *  captcha protects nothing. server.ts appends `turnstileTestKeyNotice` to its `[captcha]` boot
 *  line so a test-key configuration is loudly visible wherever it boots. (Admin-UI surfacing of
 *  the same fact is #497 Increment A territory, deliberately not built here.)
 *  Behavior enforced by apps/api/test/captcha-test-keys.test.ts. */

/** The five public dummy sitekeys (visible/invisible × pass/fail, plus forced-interactive). */
export const TURNSTILE_TEST_SITEKEYS: readonly string[] = [
  '1x00000000000000000000AA', // visible, always passes
  '2x00000000000000000000AB', // visible, always fails
  '1x00000000000000000000BB', // invisible, always passes
  '2x00000000000000000000BB', // invisible, always fails
  '3x00000000000000000000FF' // visible, forces an interactive challenge
]

/** The three public dummy secrets. */
export const TURNSTILE_TEST_SECRETS: readonly string[] = [
  '1x0000000000000000000000000000000AA', // siteverify always passes
  '2x0000000000000000000000000000000AA', // siteverify always fails
  '3x0000000000000000000000000000000AA' // siteverify yields "token already spent"
]

/** A loud one-line notice when the ACTIVE turnstile configuration uses a known dummy key, or
 *  null when it doesn't (including when the provider isn't turnstile — the dummy strings are
 *  inert under any other provider). Reads the same env vars auth/env.ts and server.ts read. */
export function turnstileTestKeyNotice(env: {
  SETU_CAPTCHA_PROVIDER?: string | undefined
  SETU_TURNSTILE_SECRET?: string | undefined
  SETU_TURNSTILE_SITE_KEY?: string | undefined
}): string | null {
  if ((env.SETU_CAPTCHA_PROVIDER ?? '') !== 'turnstile') return null
  const dummies: string[] = []
  if (TURNSTILE_TEST_SITEKEYS.includes(env.SETU_TURNSTILE_SITE_KEY ?? ''))
    dummies.push('sitekey')
  if (TURNSTILE_TEST_SECRETS.includes(env.SETU_TURNSTILE_SECRET ?? ''))
    dummies.push('secret')
  if (dummies.length === 0) return null
  return `TEST KEYS (${dummies.join(' + ')} are Cloudflare's public Turnstile dummies — every challenge auto-resolves; this protects nothing and must never ship to production)`
}
