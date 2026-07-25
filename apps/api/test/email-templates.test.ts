import { describe, expect, it, vi } from 'vitest'
import {
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET,
  EMAIL_TEMPLATE_MAX_BODY,
  passwordResetValues,
  formNotificationValues,
  type EmailTemplateOverrides
} from '@setu/core'
import { createLiveEmailTemplates } from '../src/email-templates'

// #499 (epic #497): template resolution is LIVE and server-side — the same live-getter pattern
// the from-address (#498) and the provider (#890) already use, deliberately not a second
// mechanism. A save in Settings → Email applies to the NEXT email with no api restart.

const RESET_URL =
  'https://api.test/api/auth/reset-password/tok?callbackURL=%2Fx'
const resetValues = () => passwordResetValues({ url: RESET_URL })

describe('createLiveEmailTemplates — live resolution', () => {
  it('renders the shipped default when nothing is stored', () => {
    const live = createLiveEmailTemplates({ overrides: () => ({}) })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toContain(`href="${RESET_URL}"`)
  })

  it('re-reads the overrides on EVERY render, so a save needs no restart', () => {
    let stored: EmailTemplateOverrides = {}
    const overrides = vi.fn(() => stored)
    const live = createLiveEmailTemplates({ overrides })

    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Reset your Setu password'
    )
    stored = { 'password-reset': { subject: 'Saved after boot' } }
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Saved after boot'
    )
    // Kill-shot for "live": memoise the getter and the second assertion fails.
    expect(overrides).toHaveBeenCalledTimes(2)
  })

  it('an unreadable settings.json falls back to the shipped defaults instead of failing the send', () => {
    const live = createLiveEmailTemplates({
      overrides: () => {
        throw new Error('ENOENT')
      }
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues())
    expect(out.subject).toBe('Reset your Setu password')
  })

  it('a malformed override falls back to the shipped default rather than sending garbage', () => {
    const live = createLiveEmailTemplates({
      overrides: () => ({
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
      overrides: () => ({ 'password-reset': { subject: '{{site_title}}' } }),
      siteTitle: () => title
    })
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'First'
    )
    title = 'Renamed'
    expect(live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject).toBe(
      'Renamed'
    )
  })

  it('a caller-supplied value wins over the folded-in site title', () => {
    const live = createLiveEmailTemplates({
      overrides: () => ({ 'password-reset': { subject: '{{site_title}}' } }),
      siteTitle: () => 'Ambient'
    })
    const out = live.render(EMAIL_TYPE_PASSWORD_RESET, {
      ...resetValues(),
      site_title: 'Explicit'
    })
    expect(out.subject).toBe('Explicit')
  })

  it('renders the form-notification type from the same live map', () => {
    const live = createLiveEmailTemplates({
      overrides: () => ({
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
      overrides: () => ({
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
    const live = createLiveEmailTemplates({ overrides: () => ({}) })
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
      overrides: () => ({
        'password-reset': { subject: 'Reset\r\nBcc: evil@test' }
      })
    })
    expect(
      live.render(EMAIL_TYPE_PASSWORD_RESET, resetValues()).subject
    ).not.toMatch(/[\r\n]/)
  })
})
