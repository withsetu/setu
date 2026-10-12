// packages/blocks/test/mount-captcha.test.ts
//
// #971: a blocked / offline / CSP-refused captcha script must surface as a failure the
// caller can show and retry — never be cached as "done" with the widget silently absent.
// jsdom never fetches <script src>, so load/error are dispatched by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTCHA_LOAD_TIMEOUT_MS,
  captchaScriptUrl,
  mountCaptcha
} from '../src/contact/mount-captcha'

type W = { turnstile?: unknown; grecaptcha?: unknown }
const win = window as unknown as W

const scriptsFor = (provider: 'turnstile' | 'recaptcha') =>
  [...document.head.querySelectorAll('script')].filter(
    (s) => s.src === captchaScriptUrl(provider)
  )

const fakeApi = (token = 'tok-1') => {
  const render = vi.fn(
    (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      opts.callback(token)
      return 'widget-1'
    }
  )
  return { render, reset: vi.fn() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  delete win.turnstile
  delete win.grecaptcha
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})

describe('captchaScriptUrl', () => {
  it('returns the Turnstile explicit-render script', () => {
    expect(captchaScriptUrl('turnstile')).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    )
  })
  it('returns the reCAPTCHA explicit-render script', () => {
    expect(captchaScriptUrl('recaptcha')).toBe(
      'https://www.google.com/recaptcha/api.js?render=explicit'
    )
  })
})

describe('mountCaptcha — happy path', () => {
  it('injects the script once, renders when the API arrives, and reports ready + token', () => {
    const el = document.createElement('div')
    const onToken = vi.fn()
    const onReady = vi.fn()
    const onError = vi.fn()
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el,
      onToken,
      onReady,
      onError
    })
    // A second concurrent mount shares the in-flight script.
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn()
    })
    expect(scriptsFor('turnstile')).toHaveLength(1)
    expect(onReady).not.toHaveBeenCalled()

    const api = fakeApi()
    win.turnstile = api
    scriptsFor('turnstile')[0]!.dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(200)

    expect(api.render).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ sitekey: 'k' })
    )
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith('tok-1')
    vi.advanceTimersByTime(CAPTCHA_LOAD_TIMEOUT_MS * 2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('renders immediately without injecting when the provider API is already present', () => {
    const api = fakeApi()
    win.grecaptcha = api
    const onReady = vi.fn()
    mountCaptcha({
      provider: 'recaptcha',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onReady
    })
    expect(scriptsFor('recaptcha')).toHaveLength(0)
    expect(onReady).toHaveBeenCalledTimes(1)
  })
})

describe('mountCaptcha — failure is reported, not cached (#971)', () => {
  it('reports a script load error and stops polling', () => {
    const onError = vi.fn()
    const onReady = vi.fn()
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onReady,
      onError
    })
    scriptsFor('turnstile')[0]!.dispatchEvent(new Event('error'))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('load')
    // the failed element is removed so a retry can inject a fresh one
    expect(scriptsFor('turnstile')).toHaveLength(0)
    // polling stopped: a late API does not render into a widget the caller was told failed,
    // and the timeout does not fire a second error
    win.turnstile = fakeApi()
    vi.advanceTimersByTime(CAPTCHA_LOAD_TIMEOUT_MS * 2)
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('reports a timeout when the script never produces the API', () => {
    const onError = vi.fn()
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onError
    })
    vi.advanceTimersByTime(CAPTCHA_LOAD_TIMEOUT_MS - 400)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(800)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('timeout')
  })

  it('a retry after a load error injects a fresh script and can succeed', () => {
    const first = vi.fn()
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onError: first
    }).cleanup()
    // cleanup() before the failure: the unmounted caller hears nothing
    scriptsFor('turnstile')[0]!.dispatchEvent(new Event('error'))
    expect(first).not.toHaveBeenCalled()
    expect(scriptsFor('turnstile')).toHaveLength(0)

    const onReady = vi.fn()
    const onError = vi.fn()
    mountCaptcha({
      provider: 'turnstile',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onReady,
      onError
    })
    expect(scriptsFor('turnstile')).toHaveLength(1)
    win.turnstile = fakeApi()
    scriptsFor('turnstile')[0]!.dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(200)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('cleanup() cancels a pending timeout report', () => {
    const onError = vi.fn()
    const h = mountCaptcha({
      provider: 'recaptcha',
      siteKey: 'k',
      el: document.createElement('div'),
      onToken: vi.fn(),
      onError
    })
    h.cleanup()
    vi.advanceTimersByTime(CAPTCHA_LOAD_TIMEOUT_MS * 2)
    expect(onError).not.toHaveBeenCalled()
  })
})
