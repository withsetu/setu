import { describe, expect, it } from 'vitest'
import { parseSettings, parseSettingsWithWarnings } from './schema'
import {
  EMAIL_TEMPLATE_MAX_BODY,
  EMAIL_TEMPLATE_MAX_ENTRIES,
  EMAIL_TEMPLATE_MAX_ENTRY_BYTES,
  EMAIL_TEMPLATE_MAX_SUBJECT
} from '../email/template-registry'

// #498: the `email` settings group — Git-backed, never holds secrets (epic #497).
// `fromAddress` is the outbound sender; empty string means "not set, fall back to
// SETU_FORMS_NOTIFY_FROM" (the precedence itself is server-side — apps/api).
describe('settings — email', () => {
  it('fills email defaults when absent', () => {
    const s = parseSettings({})
    expect(s.email).toEqual({ fromAddress: '', provider: '', templates: {} })
  })

  it('accepts a valid from-address', () => {
    const s = parseSettings({ email: { fromAddress: 'hello@example.com' } })
    expect(s.email.fromAddress).toBe('hello@example.com')
  })

  it('accepts an explicit empty from-address (means: fall back to env)', () => {
    const s = parseSettings({ email: { fromAddress: '' } })
    expect(s.email.fromAddress).toBe('')
  })

  it('resets an invalid from-address to default, with a warning, without touching other groups', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      general: { title: 'Kept' },
      email: { fromAddress: 'not-an-email' }
    })
    expect(settings.email.fromAddress).toBe('')
    expect(settings.general.title).toBe('Kept')
    expect(warnings.some((w) => w.startsWith('email.fromAddress'))).toBe(true)
  })

  it('a non-object email group is ignored (defaults), with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({ email: 42 })
    expect(settings.email).toEqual({
      fromAddress: '',
      provider: '',
      templates: {}
    })
    expect(warnings.some((w) => w.startsWith('email'))).toBe(true)
  })

  it('passes unknown future keys inside the email group through untouched', () => {
    const s = parseSettings({
      email: { fromAddress: 'a@b.co', futureTemplates: { reset: 'hi' } }
    })
    expect(
      (s.email as unknown as Record<string, unknown>).futureTemplates
    ).toEqual({ reset: 'hi' })
  })
})

// #890: `email.provider` — the admin's transport CHOICE (never a credential). Empty string is
// the default and means "not chosen here, fall back to the SETU_EMAIL_ADAPTER env var", so an
// existing deployment that never opens the screen behaves exactly as it did before this field
// existed. The settings-wins-over-env precedence itself is server-side
// (apps/api/src/capabilities.ts's resolveEmailProvider, pinned order-sensitively by
// apps/api/test/capabilities.test.ts).
describe('settings — email.provider', () => {
  it('defaults to the empty string (= defer to SETU_EMAIL_ADAPTER)', () => {
    expect(parseSettings({}).email.provider).toBe('')
    expect(parseSettings({ email: {} }).email.provider).toBe('')
  })

  it.each(['console', 'resend', 'smtp'] as const)('accepts %s', (provider) => {
    expect(parseSettings({ email: { provider } }).email.provider).toBe(provider)
  })

  it('accepts an explicit empty provider (means: fall back to env)', () => {
    expect(parseSettings({ email: { provider: '' } }).email.provider).toBe('')
  })

  it('resets an unknown provider to the default, with a warning, keeping the sibling from-address', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { fromAddress: 'keep@example.com', provider: 'sendgrid' }
    })
    expect(settings.email.provider).toBe('')
    expect(settings.email.fromAddress).toBe('keep@example.com')
    expect(warnings.some((w) => w.startsWith('email.provider'))).toBe(true)
  })

  it('resets a non-string provider to the default, with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { provider: 42 }
    })
    expect(settings.email.provider).toBe('')
    expect(warnings.some((w) => w.startsWith('email.provider'))).toBe(true)
  })
})

// #499 (epic #497): `email.templates.<type>` — the admin's per-type subject/body overrides.
// settings.json is Git-canonical, so a template can arrive by `git push` without ever passing
// the api's settings-write gate: everything below is the PARSE-side half of the safety net
// (the render-side half is renderEmailTemplate's per-field fallback, in
// packages/core/test/email/email-registry.test.ts). Salvage is per entry and per field, like
// permalinks.patterns — one bad template never costs you another one.
describe('settings — email.templates', () => {
  it('defaults to an empty map', () => {
    expect(parseSettings({}).email.templates).toEqual({})
    expect(parseSettings({ email: {} }).email.templates).toEqual({})
  })

  it('keeps a well-formed override', () => {
    const s = parseSettings({
      email: {
        templates: {
          'password-reset': { subject: 'Hi', html: '<p>{{reset_url}}</p>' }
        }
      }
    })
    expect(s.email.templates['password-reset']).toEqual({
      subject: 'Hi',
      html: '<p>{{reset_url}}</p>'
    })
  })

  it('keeps an override for a type this build does not know (plugin forward-compat)', () => {
    const s = parseSettings({
      email: { templates: { 'plugin-welcome': { subject: 'Hey' } } }
    })
    expect(s.email.templates['plugin-welcome']).toEqual({ subject: 'Hey' })
  })

  it('drops an oversized body, with a warning, keeping the sibling subject', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: {
        templates: {
          'password-reset': {
            subject: 'Keep me',
            html: 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1)
          }
        }
      }
    })
    expect(settings.email.templates['password-reset']).toEqual({
      subject: 'Keep me'
    })
    expect(
      warnings.some((w) => w.startsWith('email.templates.password-reset.html'))
    ).toBe(true)
  })

  it('drops an oversized subject, with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: {
        templates: {
          'password-reset': {
            subject: 'x'.repeat(EMAIL_TEMPLATE_MAX_SUBJECT + 1)
          }
        }
      }
    })
    expect(settings.email.templates['password-reset']).toEqual({})
    expect(
      warnings.some((w) =>
        w.startsWith('email.templates.password-reset.subject')
      )
    ).toBe(true)
  })

  it('drops a non-string field, with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: {
        templates: { 'password-reset': { subject: 42, html: '<p>ok</p>' } }
      }
    })
    expect(settings.email.templates['password-reset']).toEqual({
      html: '<p>ok</p>'
    })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('drops a non-object entry, with a warning, keeping the good sibling entry', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: {
        templates: {
          'password-reset': 'oops',
          'form-notification': { subject: 'Fine' }
        }
      }
    })
    expect(settings.email.templates['password-reset']).toBeUndefined()
    expect(settings.email.templates['form-notification']).toEqual({
      subject: 'Fine'
    })
    expect(
      warnings.some((w) => w.startsWith('email.templates.password-reset'))
    ).toBe(true)
  })

  it('drops an entry whose id is not a slug, with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { templates: { 'Not A Slug': { subject: 'x' } } }
    })
    expect(settings.email.templates).toEqual({})
    expect(warnings.some((w) => w.startsWith('email.templates'))).toBe(true)
  })

  // #935. The per-field caps above only measure `subject`/`html`/`text`. The entry itself is
  // `.partial().passthrough()` (the repo-wide forward-compat convention), so a field this build
  // does not know passed through UNMEASURED, and nothing bounded the number of entries either —
  // while template-registry.ts's cap doc asserted the opposite ("small enough that no one can
  // turn settings.json into a payload store"). settings.json is Git-canonical, so the arriving
  // path is `git push`, with no request-body cap in the way.
  //
  // Passthrough is KEPT and the whole serialized entry is measured instead — see the note on
  // salvageEmailTemplates for why.
  describe('the whole entry is bounded (#935)', () => {
    // KILL-SHOT TARGET. Drop the serialized-size check in salvageEmailTemplates and the payload
    // survives verbatim.
    it('drops an entry whose unknown fields blow the entry cap, keeping the sibling entry', () => {
      const { settings, warnings } = parseSettingsWithWarnings({
        email: {
          templates: {
            'password-reset': {
              subject: 'Fine',
              futureField: 'p'.repeat(EMAIL_TEMPLATE_MAX_ENTRY_BYTES)
            },
            'form-notification': { subject: 'Kept' }
          }
        }
      })
      expect(settings.email.templates['password-reset']).toBeUndefined()
      expect(settings.email.templates['form-notification']).toEqual({
        subject: 'Kept'
      })
      expect(
        warnings.some((w) => w.startsWith('email.templates.password-reset'))
      ).toBe(true)
    })

    // The entry cap must never reject an entry whose KNOWN fields are all legal — that is the
    // whole reason it is not simply the sum of the field caps. The rows are the escaping regimes
    // `JSON.stringify` applies: 2x for quotes/backslashes/newlines, and 6x (`\u00XX`) for C0
    // control characters and lone surrogates, which is the case that makes a maximal legal entry
    // serialize to 241,834 characters. The cap started at 100,000 and would have rejected the
    // last two rows, so "can never reject a legal entry" was false as written.
    it.each([
      ['quotes', '"'],
      ['backslashes', '\\'],
      ['newlines', '\n'],
      ['C0 control characters', '\u0001'],
      ['lone surrogates', '\uD800']
    ])(
      'keeps an entry of %s whose known fields all sit at their own caps',
      (_name, ch) => {
        const { settings, warnings } = parseSettingsWithWarnings({
          email: {
            templates: {
              'password-reset': {
                subject: ch.repeat(EMAIL_TEMPLATE_MAX_SUBJECT),
                html: ch.repeat(EMAIL_TEMPLATE_MAX_BODY),
                text: ch.repeat(EMAIL_TEMPLATE_MAX_BODY)
              }
            }
          }
        })
        expect(settings.email.templates['password-reset']?.html).toHaveLength(
          EMAIL_TEMPLATE_MAX_BODY
        )
        expect(warnings).toEqual([])
      }
    )

    // KILL-SHOT TARGET. Drop the entry-count bound and all 300 survive.
    it('bounds the number of entries, with a warning', () => {
      const templates: Record<string, unknown> = {}
      for (let i = 0; i < EMAIL_TEMPLATE_MAX_ENTRIES + 200; i += 1)
        templates[`type-${i}`] = { subject: 'x' }
      const { settings, warnings } = parseSettingsWithWarnings({
        email: { templates }
      })
      expect(Object.keys(settings.email.templates)).toHaveLength(
        EMAIL_TEMPLATE_MAX_ENTRIES
      )
      expect(warnings.some((w) => w.startsWith('email.templates'))).toBe(true)
    })
  })

  it('a non-object templates value is ignored, with a warning, keeping siblings', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { fromAddress: 'keep@example.com', templates: 42 }
    })
    expect(settings.email.templates).toEqual({})
    expect(settings.email.fromAddress).toBe('keep@example.com')
    expect(warnings.some((w) => w.startsWith('email.templates'))).toBe(true)
  })
})
