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
    },
  ) => string
  reset: (id?: string) => void
}

const getWidgetApi = (provider: CaptchaProvider): WidgetApi | undefined => {
  const w = window as unknown as { turnstile?: WidgetApi; grecaptcha?: WidgetApi }
  const api = provider === 'recaptcha' ? w.grecaptcha : w.turnstile
  return api && typeof api.render === 'function' ? api : undefined
}

const injected = new Set<CaptchaProvider>()
function ensureScript(provider: CaptchaProvider): void {
  if (injected.has(provider)) return
  injected.add(provider)
  const s = document.createElement('script')
  s.src = captchaScriptUrl(provider)
  s.async = true
  s.defer = true
  document.head.appendChild(s)
}

/** Inject the provider's script (once), render its widget into `el`, and call
 *  onToken when solved. Returns a handle with reset() and cleanup(). Provider-agnostic over
 *  Turnstile + reCAPTCHA v2 (both expose a `.render(el, opts)` global). */
export function mountCaptcha(opts: {
  provider: CaptchaProvider
  siteKey: string
  el: HTMLElement
  onToken: (token: string) => void
}): { reset: () => void; cleanup: () => void } {
  const { provider, siteKey, el, onToken } = opts
  ensureScript(provider)
  let widgetId: string | null = null
  let cancelled = false
  let tries = 0
  let interval: ReturnType<typeof setInterval> | null = null
  const tryRender = (): boolean => {
    if (cancelled || widgetId !== null) return true
    const api = getWidgetApi(provider)
    if (!api) return false
    widgetId = api.render(el, {
      sitekey: siteKey,
      callback: (t) => onToken(t),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
    })
    return true
  }
  if (!tryRender()) {
    interval = setInterval(() => {
      tries++
      if (tryRender() || tries > 100) {
        if (interval) clearInterval(interval)
      }
    }, 200)
  }
  return {
    reset() {
      const api = getWidgetApi(provider)
      if (api && widgetId !== null) api.reset(widgetId)
    },
    cleanup() {
      cancelled = true
      if (interval) clearInterval(interval)
    },
  }
}
