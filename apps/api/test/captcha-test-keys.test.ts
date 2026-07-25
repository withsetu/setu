import { describe, it, expect } from 'vitest'
import { turnstileTestKeyNotice } from '../src/captcha-test-keys'

// #868: Cloudflare Turnstile ships permanent, public dummy keys that pass (or fail) EVERY
// challenge on any domain — great for dev/e2e, catastrophic if they reach a production boot.
// The boot log line in server.ts appends this notice so a misconfigured deployment is loudly
// visible. Key values verified against
// developers.cloudflare.com/turnstile/troubleshooting/testing (fetched 2026-07-25).

describe('turnstileTestKeyNotice', () => {
  it('is null when no captcha provider is configured', () => {
    expect(turnstileTestKeyNotice({})).toBeNull()
  })

  it('is null for a turnstile config with real-looking keys', () => {
    expect(
      turnstileTestKeyNotice({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SECRET: '0x4AAAAAAABkMYinukE8nzY',
        SETU_TURNSTILE_SITE_KEY: '0x4AAAAAAABkMYinukE8nzL'
      })
    ).toBeNull()
  })

  it('is null when the dummy strings sit under a NON-turnstile provider (unused there)', () => {
    expect(
      turnstileTestKeyNotice({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
        SETU_TURNSTILE_SITE_KEY: '1x00000000000000000000AA'
      })
    ).toBeNull()
  })

  it.each([
    ['1x00000000000000000000AA', 'visible always-pass'],
    ['2x00000000000000000000AB', 'visible always-fail'],
    ['1x00000000000000000000BB', 'invisible always-pass'],
    ['2x00000000000000000000BB', 'invisible always-fail'],
    ['3x00000000000000000000FF', 'forced interactive']
  ])('flags dummy sitekey %s (%s)', (siteKey) => {
    const notice = turnstileTestKeyNotice({
      SETU_CAPTCHA_PROVIDER: 'turnstile',
      SETU_TURNSTILE_SECRET: '0x4AAAAAAABkMYinukE8nzY',
      SETU_TURNSTILE_SITE_KEY: siteKey
    })
    expect(notice).toContain('TEST KEYS')
    expect(notice).toContain('sitekey')
  })

  it.each([
    ['1x0000000000000000000000000000000AA', 'always-pass'],
    ['2x0000000000000000000000000000000AA', 'always-fail'],
    ['3x0000000000000000000000000000000AA', 'token-already-spent']
  ])('flags dummy secret %s (%s)', (secret) => {
    const notice = turnstileTestKeyNotice({
      SETU_CAPTCHA_PROVIDER: 'turnstile',
      SETU_TURNSTILE_SECRET: secret
    })
    expect(notice).toContain('TEST KEYS')
    expect(notice).toContain('secret')
  })

  it('names both halves when sitekey AND secret are dummies', () => {
    const notice = turnstileTestKeyNotice({
      SETU_CAPTCHA_PROVIDER: 'turnstile',
      SETU_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
      SETU_TURNSTILE_SITE_KEY: '1x00000000000000000000AA'
    })
    expect(notice).toContain('TEST KEYS')
    expect(notice).toContain('sitekey')
    expect(notice).toContain('secret')
    // The notice must say plainly that this configuration protects nothing.
    expect(notice?.toLowerCase()).toContain('protect')
  })
})
