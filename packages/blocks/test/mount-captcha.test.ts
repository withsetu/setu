// packages/blocks/test/mount-captcha.test.ts
import { describe, it, expect } from 'vitest'
import { captchaScriptUrl } from '../src/contact/mount-captcha'

describe('captchaScriptUrl', () => {
  it('returns the Turnstile explicit-render script', () => {
    expect(captchaScriptUrl('turnstile')).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    )
  })
  it('returns the reCAPTCHA explicit-render script', () => {
    expect(captchaScriptUrl('recaptcha')).toBe('https://www.google.com/recaptcha/api.js?render=explicit')
  })
})
