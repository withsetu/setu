import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET,
  EMAIL_TEMPLATE_MAX_BODY,
  passwordResetValues,
  formNotificationValues,
  type EmailTemplateOverrides,
  type SiteSettings
} from '@setu/core'
import { createLiveEmailTemplates } from '../src/email-templates'

// #499 (epic #497): template resolution is LIVE and server-side — the same live-getter pattern
// the from-address (#498) and the provider (#890) already use, deliberately not a second
// mechanism. A save in Settings → Email applies to the NEXT email with no api restart.

const RESET_URL =
  'https://api.test/api/auth/reset-password/tok?callbackURL=%2Fx'
const resetValues = () => passwordResetValues({ url: RESET_URL })

/** A whole SiteSettings, because that is what the resolver takes: ONE getter, so one send costs
 *  one settings read (#907 review F4 — it used to take a thunk per field, which made a form
 *  submission parse settings.json three times). */
const settingsWith = (
  templates: EmailTemplateOverrides,
  title = 'Example Site'
): SiteSettings => ({
  ...DEFAULT_SETTINGS,
  general: { ...DEFAULT_SETTINGS.general, title },
  email: { ...DEFAULT_SETTINGS.email, templates }
})

describe('createLiveEmailTemplates — live resolution', () => {
  it('renders the shipped default when nothing is stored', () => {
    const live = createLiveEmailTemplates({ settings: () => settingsWith({}) })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toContain(`href="${RESET_URL}"`)
  })

  it('re-reads settings on EVERY render, so a save needs no restart', () => {
    let stored: EmailTemplateOverrides = {}
    const settings = vi.fn(() => settingsWith(stored))
    const live = createLiveEmailTemplates({ settings })

    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Reset your Setu password'
    )
    stored = { 'password-reset': { subject: 'Saved after boot' } }
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Saved after boot'
    )
    // Kill-shot for "live": memoise the getter and the second assertion fails.
    expect(settings).toHaveBeenCalledTimes(2)
  })

  // #907 review F4. Form notifications are visitor-triggered, and that path already pays one
  // settings read for the from-address; this resolver must not add more. One render = one read,
  // so every token it needs comes out of the same parse — the shape #498/#890 already use.
  it('reads settings exactly ONCE per render, not once per token source', () => {
    const settings = vi.fn(() => settingsWith({}))
    const live = createLiveEmailTemplates({ settings })
    live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(settings).toHaveBeenCalledTimes(1)
  })

  it('an unreadable settings.json falls back to the shipped defaults instead of failing the send', () => {
    const live = createLiveEmailTemplates({
      settings: () => {
        throw new Error('ENOENT')
      }
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.subject).toBe('Reset your Setu password')
  })

  it('a malformed override falls back to the shipped default rather than sending garbage', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith({
          'password-reset': {
            subject: '   ',
            html: 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1)
          }
        })
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toContain('We received a request')
  })

  it('folds the live site title into the values, so {{site_title}} follows Settings → General', () => {
    let title = 'First'
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith({ 'password-reset': { subject: '{{site_title}}' } }, title)
    })
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'First'
    )
    title = 'Renamed'
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Renamed'
    )
  })

  // #907 review F6. resolve-seo.ts's `general.title || 'Setu'` means an empty General title still
  // renders a page title; without the same fallback here the token would vanish from an email
  // while SEO kept saying "Setu" — two answers to one question.
  it('falls back to "Setu" for an empty site title, exactly as the SEO title does', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith(
          { 'password-reset': { subject: 'Reset · {{site_title}}' } },
          ''
        )
    })
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Reset · Setu'
    )
  })

  it('a caller-supplied value wins over the folded-in site title', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith(
          { 'password-reset': { subject: '{{site_title}}' } },
          'Ambient'
        )
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, {
      ...resetValues(),
      site_title: 'Explicit'
    })
    expect(out.subject).toBe('Explicit')
  })

  it('renders the form-notification type from the same live map', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith({
          'form-notification': { subject: 'Ping from {{form_id}}' }
        })
    })
    const out = live.render(
      EMAIL_TYPE_FORM_NOTIFICATION,
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        formLabel: 'Contact',
        fields: { message: 'hi' },
        createdAt: 0
      })
    )
    expect(out.subject).toBe('Ping from contact')
  })
})

describe('createLiveEmailTemplates — security', () => {
  // KILL-SHOT TARGET. Substitution happens HERE, on the server, from values the server built.
  // A stored template can only name `{{reset_url}}`; it has no syntax with which to supply one,
  // so the emailed link is always the one better-auth generated.
  it('a stored template cannot supply or override the reset url', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith({
          'password-reset': {
            html:
              '<a href="{{reset_url=https://evil.test/steal}}">a</a>' +
              '<a href="{{reset_url}}">b</a>'
          }
        })
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.html).toContain(`href="${RESET_URL}"`)
    expect(out.html).not.toContain('href="https://evil.test/steal"')
  })

  // KILL-SHOT TARGET. Escaping is on by default, so a value that reaches the template from
  // outside — a form submitter's field, a user's display name — cannot carry markup into the
  // recipient's client.
  it('escapes a token value containing markup', () => {
    const live = createLiveEmailTemplates({ settings: () => settingsWith({}) })
    const out = live.render(
      EMAIL_TYPE_FORM_NOTIFICATION,
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: { message: '<script>alert(1)</script>' },
        createdAt: 0
      })
    )
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('a stored subject cannot inject a mail header', () => {
    const live = createLiveEmailTemplates({
      settings: () =>
        settingsWith({
          'password-reset': { subject: 'Reset\r\nBcc: evil@test' }
        })
    })
    expect(
      live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject
    ).not.toMatch(/[\r\n]/)
  })
})
