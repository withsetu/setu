// packages/blocks/src/contact/mount-captcha.ts
export type CaptchaProvider = 'turnstile' | 'recaptcha'

export function captchaScriptUrl(provider: CaptchaProvider): string {
  return provider === 'recaptcha'
    ? 'https://www.google.com/recaptcha/api.js?render=explicit'
    : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
}

interface WidgetApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    }
  ) => string
  reset: (id?: string) => void
}

const getWidgetApi = (provider: CaptchaProvider): WidgetApi | undefined => {
  const w = window as unknown as {
    turnstile?: WidgetApi
    grecaptcha?: WidgetApi
  }
  const api = provider === 'recaptcha' ? w.grecaptcha : w.turnstile
  return api && typeof api.render === 'function' ? api : undefined
}

/** Why a widget never mounted: the provider script failed to load (blocked, offline,
 *  CSP-refused), or it loaded but never exposed its API within CAPTCHA_LOAD_TIMEOUT_MS. */
export type CaptchaFailure = 'load' | 'timeout'

const POLL_MS = 200
/** How long a mount waits for the provider API before reporting `'timeout'`. */
export const CAPTCHA_LOAD_TIMEOUT_MS = 20_000

/** The in-flight or loaded script per provider. A provider is only remembered while its
 *  element is still in the document: a load error removes the element (and the entry), so
 *  the next mount — a retry — injects a fresh one instead of trusting a script that never
 *  arrived (#971). Enforced by packages/blocks/test/mount-captcha.test.ts. */
const scripts = new Map<CaptchaProvider, HTMLScriptElement>()

function ensureScript(provider: CaptchaProvider): HTMLScriptElement | null {
  if (getWidgetApi(provider)) return null
  const existing = scripts.get(provider)
  if (existing?.isConnected) return existing
  const s = document.createElement('script')
  s.src = captchaScriptUrl(provider)
  s.async = true
  s.defer = true
  s.addEventListener('error', () => {
    if (scripts.get(provider) === s) scripts.delete(provider)
    s.remove()
  })
  scripts.set(provider, s)
  document.head.appendChild(s)
  return s
}

/** Inject the provider's script (once per successful load), render its widget into `el`,
 *  and call onToken when solved. `onReady` fires once the widget has rendered; `onError`
 *  fires at most once if it never will (script load error, or no API within
 *  CAPTCHA_LOAD_TIMEOUT_MS) — after it, mount again to retry. Neither fires after
 *  cleanup(). Returns a handle with reset() and cleanup(). Provider-agnostic over
 *  Turnstile + reCAPTCHA v2 (both expose a `.render(el, opts)` global). */
export function mountCaptcha(opts: {
  provider: CaptchaProvider
  siteKey: string
  el: HTMLElement
  onToken: (token: string) => void
  onReady?: () => void
  onError?: (reason: CaptchaFailure) => void
}): { reset: () => void; cleanup: () => void } {
  const { provider, siteKey, el, onToken, onReady, onError } = opts
  let widgetId: string | null = null
  let done = false
  let interval: ReturnType<typeof setInterval> | null = null
  let script: HTMLScriptElement | null = null

  const stop = () => {
    done = true
    if (interval) clearInterval(interval)
    interval = null
    script?.removeEventListener('error', onScriptError)
  }
  const fail = (reason: CaptchaFailure) => {
    if (done) return
    stop()
    onError?.(reason)
  }
  function onScriptError() {
    fail('load')
  }
  const tryRender = (): boolean => {
    if (done) return true
    const api = getWidgetApi(provider)
    if (!api) return false
    stop()
    widgetId = api.render(el, {
      sitekey: siteKey,
      callback: (t) => onToken(t),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken('')
    })
    onReady?.()
    return true
  }

  if (!tryRender()) {
    script = ensureScript(provider)
    script?.addEventListener('error', onScriptError)
    let waited = 0
    interval = setInterval(() => {
      waited += POLL_MS
      if (tryRender()) return
      if (waited >= CAPTCHA_LOAD_TIMEOUT_MS) fail('timeout')
    }, POLL_MS)
  }
  return {
    reset() {
      const api = getWidgetApi(provider)
      if (api && widgetId !== null) api.reset(widgetId)
    },
    cleanup() {
      stop()
    }
  }
}
