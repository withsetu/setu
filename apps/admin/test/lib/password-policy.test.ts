import { describe, expect, it } from 'vitest'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordField
} from '../../src/lib/password-policy'

describe('passwordField', () => {
  it('rejects below the minimum', () => {
    expect(
      passwordField.safeParse('x'.repeat(MIN_PASSWORD_LENGTH - 1)).success
    ).toBe(false)
  })

  it('accepts the minimum and the maximum', () => {
    expect(
      passwordField.safeParse('x'.repeat(MIN_PASSWORD_LENGTH)).success
    ).toBe(true)
    expect(
      passwordField.safeParse('x'.repeat(MAX_PASSWORD_LENGTH)).success
    ).toBe(true)
  })

  // #1186: better-auth 1.7.6+ rejects an over-long password with PASSWORD_TOO_LONG on every route
  // that takes one (including sign-in), so the form says so before the round trip.
  it('rejects above the maximum with a message naming the limit', () => {
    const r = passwordField.safeParse('x'.repeat(MAX_PASSWORD_LENGTH + 1))
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
    )
  })

  it('mirrors better-auth’s default maxPasswordLength (128)', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128)
  })
})
