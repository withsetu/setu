import { describe, expect, it } from 'vitest'
import { sendableFromAddress } from './from-address'
import { parseSettings, parseSettingsWithWarnings } from './schema'

/**
 * #957: `SETU_FORMS_NOTIFY_FROM` accepted a From header with a display name —
 * `Setu <hello@example.com>`, which is how both transports document one — while
 * `emailSchema.fromAddress` was `z.string().email()` over the WHOLE value and rejected it. So an
 * operator with a working env var who tried to move it into Settings → Email was told their
 * address was invalid, and got a bare address if they complied.
 *
 * One rule now serves both sides: this function, which the api resolver, the settings schema and
 * the admin field all call. The control-character branch is the header-injection guard — a display
 * name is the one half of the value that is not an addr-spec, so it is where a CR/LF could ride in.
 */

describe('sendableFromAddress', () => {
  it('accepts a bare addr-spec and returns it', () => {
    expect(sendableFromAddress('hello@example.com')).toBe('hello@example.com')
  })

  it('accepts the display-name form and keeps the display name', () => {
    expect(sendableFromAddress('Setu <hello@example.com>')).toBe(
      'Setu <hello@example.com>'
    )
  })

  it('accepts a quoted display name', () => {
    expect(sendableFromAddress('"Setu Mail" <hello@example.com>')).toBe(
      '"Setu Mail" <hello@example.com>'
    )
  })

  it('trims, and reports the trimmed value as the sendable one', () => {
    expect(sendableFromAddress('  hello@example.com  ')).toBe(
      'hello@example.com'
    )
  })

  it('rejects a value with no usable addr-spec', () => {
    expect(sendableFromAddress('')).toBeNull()
    expect(sendableFromAddress('   ')).toBeNull()
    expect(sendableFromAddress('not-an-address')).toBeNull()
    expect(sendableFromAddress('Setu <not-an-address>')).toBeNull()
    expect(sendableFromAddress('Setu <>')).toBeNull()
  })

  // THE security case: a From header is a single line, so a control character anywhere in the
  // value — including in the display name, the half that is not validated as an addr-spec — makes
  // the whole value unusable. Kill-shot: delete the CONTROL_CHAR guard in from-address.ts and
  // every expectation below flips.
  it('rejects a control character anywhere in the value', () => {
    expect(sendableFromAddress('Setu\n<hello@example.com>')).toBeNull()
    expect(sendableFromAddress('Setu\r\nBcc: x@y.co <hello@example.com>')).toBe(
      null
    )
    // Escapes, not literal control bytes, so the case is visible when reading the file.
    expect(sendableFromAddress('Se\u0000tu <hello@example.com>')).toBeNull()
    // Inside the addr-spec half too, where z.string().email() would have rejected it anyway —
    // asserted so the guard cannot later be narrowed to the display name alone.
    expect(sendableFromAddress('hel\u0009lo@example.com')).toBeNull()
    expect(sendableFromAddress('hello@example.com\u007f')).toBeNull()
    // A leading/trailing newline ALONE is trimmed away rather than rejected: trimming happens
    // first, so that is a valid address with whitespace around it, not an injection attempt.
    expect(sendableFromAddress('hello@example.com\n')).toBe('hello@example.com')
  })
})

describe('emailSchema.fromAddress shares that rule (#957)', () => {
  it('keeps a stored display-name from-address, with no warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { fromAddress: 'Setu <hello@example.com>' }
    })
    expect(settings.email.fromAddress).toBe('Setu <hello@example.com>')
    expect(warnings.filter((w) => w.startsWith('email.fromAddress'))).toEqual(
      []
    )
  })

  it('still drops a malformed stored from-address, with a warning', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: { fromAddress: 'Setu <not-an-address>' }
    })
    expect(settings.email.fromAddress).toBe('')
    expect(warnings.some((w) => w.startsWith('email.fromAddress'))).toBe(true)
  })

  // Same kill-shot target as above, reached through the schema: settings.json is Git-canonical, so
  // this value arrives by `git push` with no request-body validation in the way, and
  // `resolveFromAddress` returns a settings value as the effective from WITHOUT re-checking it.
  it('drops a stored from-address carrying a control character', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      email: {
        fromAddress: 'Setu\r\nBcc: evil@example.com <hello@example.com>'
      }
    })
    expect(settings.email.fromAddress).toBe('')
    expect(warnings.some((w) => w.startsWith('email.fromAddress'))).toBe(true)
  })

  it('still accepts the empty string as "not set here — fall back to the env var"', () => {
    expect(
      parseSettings({ email: { fromAddress: '' } }).email.fromAddress
    ).toBe('')
  })

  it('rejects a padded value, so the stored form is the sendable form', () => {
    // `resolveFromAddress` hands a settings value straight to the transport, so the schema accepts
    // only values that are ALREADY what would be sent — `sendableFromAddress(v) === v`.
    const { settings } = parseSettingsWithWarnings({
      email: { fromAddress: ' hello@example.com ' }
    })
    expect(settings.email.fromAddress).toBe('')
  })
})
