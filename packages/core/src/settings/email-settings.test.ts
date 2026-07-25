import { describe, expect, it } from 'vitest'
import { parseSettings, parseSettingsWithWarnings } from './schema'

// #498: the `email` settings group — Git-backed, never holds secrets (epic #497).
// `fromAddress` is the outbound sender; empty string means "not set, fall back to
// SETU_FORMS_NOTIFY_FROM" (the precedence itself is server-side — apps/api).
describe('settings — email', () => {
  it('fills email defaults when absent', () => {
    const s = parseSettings({})
    expect(s.email).toEqual({ fromAddress: '', provider: '' })
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
    expect(settings.email).toEqual({ fromAddress: '', provider: '' })
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
