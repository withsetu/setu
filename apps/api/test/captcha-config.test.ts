import { describe, it, expect, vi } from 'vitest'
import {
  CaptchaConfigError,
  createFormsCaptcha,
  parseRecaptchaMinScore,
  resolveCaptchaConfig,
  SUPPORTED_CAPTCHA_PROVIDERS
} from '../src/captcha-config'
import { authCaptchaFromEnv, captchaCapabilityFromEnv } from '../src/auth/env'

const quietLog = () => ({ error: vi.fn(), warn: vi.fn() })

describe('resolveCaptchaConfig — one provider→secret mapping (#1163)', () => {
  it('maps each supported provider to its own secret and site-key env', () => {
    expect(
      resolveCaptchaConfig({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SECRET: 'ts',
        SETU_TURNSTILE_SITE_KEY: 'tk',
        SETU_RECAPTCHA_SECRET: 'wrong'
      })
    ).toEqual({ provider: 'turnstile', secret: 'ts', siteKey: 'tk' })
    expect(
      resolveCaptchaConfig({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_RECAPTCHA_SECRET: 'rs',
        SETU_RECAPTCHA_SITE_KEY: 'rk',
        SETU_TURNSTILE_SECRET: 'wrong'
      })
    ).toEqual({ provider: 'recaptcha', secret: 'rs', siteKey: 'rk' })
  })

  it('reports no provider when SETU_CAPTCHA_PROVIDER is unset or blank', () => {
    expect(resolveCaptchaConfig({})).toEqual({ provider: null })
    expect(resolveCaptchaConfig({ SETU_CAPTCHA_PROVIDER: '' })).toEqual({
      provider: null
    })
  })

  it('reports an empty secret rather than borrowing another provider’s', () => {
    expect(
      resolveCaptchaConfig({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_TURNSTILE_SECRET: 'ts'
      })
    ).toEqual({ provider: 'recaptcha', secret: '', siteKey: '' })
  })

  it('refuses recaptcha-v3 with an actionable message (not supported end to end yet)', () => {
    const run = () =>
      resolveCaptchaConfig({
        SETU_CAPTCHA_PROVIDER: 'recaptcha-v3',
        SETU_RECAPTCHA_SECRET: 'rs'
      })
    expect(run).toThrow(CaptchaConfigError)
    expect(run).toThrow(/recaptcha-v3/)
    expect(run).toThrow(/turnstile|recaptcha/)
  })

  it('refuses an unknown provider instead of silently using another provider’s adapter', () => {
    expect(() =>
      resolveCaptchaConfig({
        SETU_CAPTCHA_PROVIDER: 'hcaptcha',
        SETU_TURNSTILE_SECRET: 'ts'
      })
    ).toThrow(CaptchaConfigError)
  })

  it('advertises only the providers it accepts', () => {
    expect([...SUPPORTED_CAPTCHA_PROVIDERS]).toEqual(['turnstile', 'recaptcha'])
  })

  it('fails on an invalid SETU_RECAPTCHA_MIN_SCORE whatever the provider', () => {
    expect(() =>
      resolveCaptchaConfig({ SETU_RECAPTCHA_MIN_SCORE: 'high' })
    ).toThrow(CaptchaConfigError)
  })
})

describe('parseRecaptchaMinScore (#1163)', () => {
  it('treats unset and empty as unset', () => {
    expect(parseRecaptchaMinScore(undefined)).toBeUndefined()
    expect(parseRecaptchaMinScore('')).toBeUndefined()
    expect(parseRecaptchaMinScore('   ')).toBeUndefined()
  })

  it('accepts 0 ≤ n ≤ 1, boundaries inclusive', () => {
    expect(parseRecaptchaMinScore('0')).toBe(0)
    expect(parseRecaptchaMinScore('0.5')).toBe(0.5)
    expect(parseRecaptchaMinScore('1')).toBe(1)
    expect(parseRecaptchaMinScore(' 0.7 ')).toBe(0.7)
  })

  it('rejects out-of-range and non-numeric values loudly', () => {
    for (const bad of [
      '-0.1',
      '1.01',
      '5',
      'abc',
      'NaN',
      'Infinity',
      '0x1',
      '1e0x'
    ]) {
      expect(() => parseRecaptchaMinScore(bad), bad).toThrow(CaptchaConfigError)
    }
  })

  it('names the variable and echoes the bad value in its message', () => {
    expect(() => parseRecaptchaMinScore('2')).toThrow(
      /SETU_RECAPTCHA_MIN_SCORE/
    )
  })
})

describe('createFormsCaptcha — selected provider, missing secret (#1163)', () => {
  const missing = { provider: 'turnstile', secret: '', siteKey: '' } as const

  it('rejects every submission outside local mode — SETU_MODE unset counts as self-hosted', async () => {
    // Keyed on resolveSetuMode, not NODE_ENV: the api's start script sets no NODE_ENV, so a
    // NODE_ENV-only check passed every submission through on a plain self-hosted boot.
    for (const env of [
      {},
      { SETU_MODE: 'self-hosted' },
      { SETU_MODE: 'edge' }
    ]) {
      const log = quietLog()
      const captcha = createFormsCaptcha(missing, env, log)
      expect(await captcha.verify('any-token')).toBe(false)
      expect(log.error).toHaveBeenCalledOnce()
      expect(String(log.error.mock.calls[0]?.[0])).toMatch(
        /SETU_TURNSTILE_SECRET/
      )
      expect(String(log.error.mock.calls[0]?.[0])).toMatch(/rejecting/)
    }
  })

  it('stays fail-closed when NODE_ENV says development but the mode is not local', async () => {
    const captcha = createFormsCaptcha(
      missing,
      { NODE_ENV: 'development', SETU_MODE: 'self-hosted' },
      quietLog()
    )
    expect(await captcha.verify('any-token')).toBe(false)
  })

  it('passes through only in local mode, with a warning that says so', async () => {
    const log = quietLog()
    const captcha = createFormsCaptcha(missing, { SETU_MODE: 'local' }, log)
    expect(await captcha.verify('any-token')).toBe(true)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0])).toMatch(/local/)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('names the reCAPTCHA secret for the recaptcha provider', () => {
    const log = quietLog()
    createFormsCaptcha(
      { provider: 'recaptcha', secret: '', siteKey: '' },
      {},
      log
    )
    expect(String(log.error.mock.calls[0]?.[0])).toMatch(
      /SETU_RECAPTCHA_SECRET/
    )
  })

  it('never echoes a secret value', () => {
    const log = quietLog()
    createFormsCaptcha({ provider: null }, {}, log)
    createFormsCaptcha(
      { provider: 'turnstile', secret: 'super-secret-value', siteKey: '' },
      {},
      log
    )
    const all = [...log.error.mock.calls, ...log.warn.mock.calls]
      .flat()
      .join(' ')
    expect(all).not.toContain('super-secret-value')
  })
})

describe('createFormsCaptcha — other branches', () => {
  it('is a pass-through with the #918 notice when no provider is selected outside local', async () => {
    const log = quietLog()
    const captcha = createFormsCaptcha({ provider: null }, {}, log)
    expect(await captcha.verify('x')).toBe(true)
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('verifies through the provider when the secret is set', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input instanceof Request ? input.url : input))
      return new Response('{"success":false}')
    }
    const captcha = createFormsCaptcha(
      { provider: 'recaptcha', secret: 'rs', siteKey: '' },
      {},
      quietLog(),
      fetchImpl
    )
    expect(await captcha.verify('tok')).toBe(false)
    expect(calls).toEqual(['https://www.google.com/recaptcha/api/siteverify'])
  })
})

describe('auth + capabilities read the same mapping (#1163)', () => {
  it('give better-auth the selected provider’s own secret', () => {
    expect(
      authCaptchaFromEnv({
        SETU_CAPTCHA_PROVIDER: 'recaptcha',
        SETU_RECAPTCHA_SECRET: 'rs',
        SETU_TURNSTILE_SECRET: 'ts'
      })
    ).toEqual({ provider: 'google-recaptcha', secretKey: 'rs' })
    expect(
      authCaptchaFromEnv({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SECRET: 'ts'
      })
    ).toEqual({ provider: 'cloudflare-turnstile', secretKey: 'ts' })
  })

  it('advertise a site key only when the secret is also configured', () => {
    expect(
      captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SITE_KEY: 'tk'
      })
    ).toBeNull()
    expect(
      captchaCapabilityFromEnv({
        SETU_CAPTCHA_PROVIDER: 'turnstile',
        SETU_TURNSTILE_SITE_KEY: 'tk',
        SETU_TURNSTILE_SECRET: 'ts'
      })
    ).toEqual({ provider: 'turnstile', siteKey: 'tk' })
  })
})
