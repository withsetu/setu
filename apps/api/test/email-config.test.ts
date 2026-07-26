import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type SiteSettings } from '@setu/core'
import { createLiveEmailTemplates } from '../src/email-templates'
import { createLiveEmailConfig, resolveEmailConfig } from '../src/email-config'

const settings = (over: {
  fromAddress?: string
  provider?: SiteSettings['email']['provider']
  templates?: SiteSettings['email']['templates']
  title?: string
}): SiteSettings => ({
  ...DEFAULT_SETTINGS,
  general: { ...DEFAULT_SETTINGS.general, title: over.title ?? 'My Site' },
  email: {
    ...DEFAULT_SETTINGS.email,
    ...(over.fromAddress === undefined
      ? {}
      : { fromAddress: over.fromAddress }),
    ...(over.provider === undefined ? {} : { provider: over.provider }),
    ...(over.templates === undefined ? {} : { templates: over.templates })
  }
})

describe('resolveEmailConfig', () => {
  it('resolves all four members from ONE settings reading', () => {
    const config = resolveEmailConfig(
      settings({
        fromAddress: 'site@example.test',
        provider: 'resend',
        templates: { 'password-reset': { subject: 'Custom' } },
        title: 'My Site'
      }),
      { RESEND_API_KEY: 'k' }
    )
    expect(config.from).toEqual({
      effective: 'site@example.test',
      source: 'settings'
    })
    expect(config.transport.effective).toBe('resend')
    expect(config.templates).toEqual({
      'password-reset': { subject: 'Custom' }
    })
    expect(config.siteTitle).toBe('My Site')
  })

  it('keeps the #498 precedence: a stored from-address beats SETU_FORMS_NOTIFY_FROM', () => {
    const env = { SETU_FORMS_NOTIFY_FROM: 'env@example.test' }
    expect(
      resolveEmailConfig(settings({ fromAddress: 'stored@example.test' }), env)
        .from
    ).toEqual({ effective: 'stored@example.test', source: 'settings' })
    // …and falls back to it when nothing is stored.
    expect(resolveEmailConfig(settings({}), env).from).toEqual({
      effective: 'env@example.test',
      source: 'env'
    })
  })

  it('keeps the #890 precedence: a stored provider beats SETU_EMAIL_ADAPTER', () => {
    const env = { SETU_EMAIL_ADAPTER: 'console', RESEND_API_KEY: 'k' }
    expect(
      resolveEmailConfig(settings({ provider: 'resend' }), env).transport
        .effective
    ).toBe('resend')
    expect(resolveEmailConfig(settings({}), env).transport.effective).toBe(
      'console'
    )
  })

  it('keeps the #890 fail-safe: an unusable stored provider degrades to console, it does not throw', () => {
    const config = resolveEmailConfig(settings({ provider: 'resend' }), {})
    expect(config.transport.selected).toBe('resend')
    expect(config.transport.effective).toBe('console')
  })

  it('undefined settings (an unreadable file) degrades to env-only rather than throwing', () => {
    const config = resolveEmailConfig(undefined, {
      SETU_FORMS_NOTIFY_FROM: 'env@example.test',
      SETU_EMAIL_ADAPTER: 'console'
    })
    expect(config.from.effective).toBe('env@example.test')
    expect(config.transport.effective).toBe('console')
    expect(config.templates).toBeUndefined()
    expect(config.siteTitle).toBeUndefined()
  })

  /** The two site-title fallbacks must agree, or `{{site_title}}` would render differently
   *  depending on which entry point the send path used. */
  it("matches createLiveEmailTemplates' own site-title fallback", () => {
    for (const title of ['', 'My Site']) {
      const s = settings({
        title,
        templates: { 'password-reset': { subject: '[{{site_title}}] reset' } }
      })
      const viaConfig = resolveEmailConfig(s, {}).siteTitle
      // The renderer's own reading of the same settings, observed through a rendered token —
      // so this compares the two fallbacks, not two copies of the same literal.
      const rendered = createLiveEmailTemplates({
        settings: () => s
      }).render('password-reset', { reset_url: 'https://x.test' })
      expect(rendered.subject).toBe(`[${viaConfig!}] reset`)
    }
    // Specifically: an empty General title becomes 'Setu', not ''.
    expect(resolveEmailConfig(settings({ title: '' }), {}).siteTitle).toBe(
      'Setu'
    )
  })
})

describe('createLiveEmailConfig', () => {
  it('calls the settings getter exactly ONCE per resolution', () => {
    const get = vi.fn(() => settings({ fromAddress: 'a@example.test' }))
    const live = createLiveEmailConfig({ settings: get, env: {} })
    live()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('re-reads on EVERY call, so a save applies to the next email with no restart', () => {
    let current = settings({ fromAddress: 'first@example.test' })
    const live = createLiveEmailConfig({ settings: () => current, env: {} })
    expect(live().from.effective).toBe('first@example.test')
    // The admin saves. The resolver is NOT rebuilt — this is the wave's headline property.
    current = settings({ fromAddress: 'second@example.test' })
    expect(live().from.effective).toBe('second@example.test')
  })

  it('a throwing settings getter degrades to env-only rather than failing the send', () => {
    const live = createLiveEmailConfig({
      settings: () => {
        throw new Error('ENOENT settings.json')
      },
      env: { SETU_FORMS_NOTIFY_FROM: 'env@example.test' }
    })
    expect(() => live()).not.toThrow()
    expect(live().from).toEqual({
      effective: 'env@example.test',
      source: 'env'
    })
    expect(live().templates).toBeUndefined()
  })
})
