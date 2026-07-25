import { describe, expect, it } from 'vitest'
import { parseSettings, parseSettingsWithWarnings } from './schema'

// #498: the `email` settings group — Git-backed, never holds secrets (epic #497).
// `fromAddress` is the outbound sender; empty string means "not set, fall back to
// SETU_FORMS_NOTIFY_FROM" (the precedence itself is server-side — apps/api).
describe('settings — email', () => {
  it('fills email defaults when absent', () => {
    const s = parseSettings({})
    expect(s.email).toEqual({ fromAddress: '' })
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
    expect(settings.email).toEqual({ fromAddress: '' })
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
