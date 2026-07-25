import { describe, it, expect } from 'vitest'
import { noCaptchaProviderNotice } from '../src/captcha-notice'

describe('noCaptchaProviderNotice (#918)', () => {
  it('is LOUD when no provider is configured outside local mode', () => {
    const notice = noCaptchaProviderNotice({})
    expect(notice).not.toBeNull()
    expect(notice).toContain('SETU_CAPTCHA_PROVIDER')
    expect(notice).toContain('/forms/submit')
  })

  it('stays loud when SETU_MODE names any non-local topology', () => {
    expect(noCaptchaProviderNotice({ SETU_MODE: 'self-hosted' })).not.toBeNull()
    expect(noCaptchaProviderNotice({ SETU_MODE: 'edge' })).not.toBeNull()
    // Fail closed: an operator who forgot SETU_MODE on a real server must not get the dev
    // silence, which is why this keys on resolveSetuMode rather than on NODE_ENV.
    expect(noCaptchaProviderNotice({ SETU_MODE: '' })).not.toBeNull()
  })

  it('stays silent in local dev, where the pass-through is the point', () => {
    expect(noCaptchaProviderNotice({ SETU_MODE: 'local' })).toBeNull()
  })

  it('says nothing once a provider IS selected — those branches already warn', () => {
    for (const p of ['turnstile', 'recaptcha', 'recaptcha-v3']) {
      expect(noCaptchaProviderNotice({ SETU_CAPTCHA_PROVIDER: p })).toBeNull()
      expect(
        noCaptchaProviderNotice({
          SETU_CAPTCHA_PROVIDER: p,
          SETU_MODE: 'local'
        })
      ).toBeNull()
    }
  })

  it('treats a blank provider as unset', () => {
    expect(
      noCaptchaProviderNotice({ SETU_CAPTCHA_PROVIDER: '' })
    ).not.toBeNull()
  })

  it('names no secret and echoes no value', () => {
    const notice = String(noCaptchaProviderNotice({ SETU_MODE: 'self-hosted' }))
    expect(notice).not.toContain('SECRET=')
  })
})
