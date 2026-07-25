import { describe, expect, it } from 'vitest'
import {
  renderEmailTemplate,
  passwordResetValues,
  PASSWORD_RESET_EMAIL
} from '@setu/core'
import {
  resetPasswordEmailContent,
  withDefaultResetCallback
} from '../src/reset-password-email'

// #499 (epic #497): the password-reset body moved into core's email TYPE registry so an admin
// can customize it in Settings → Email. This file pins the two properties that move must NOT
// have changed: the DEFAULT content is what it always was, and the emitted link is still the
// one better-auth built (withDefaultResetCallback's #364 behavior).

const URL_WITH_CB =
  'https://api.test/api/auth/reset-password/tok?callbackURL=%2Fadmin'
const URL_EMPTY_CB = 'https://api.test/api/auth/reset-password/tok?callbackURL='

describe('resetPasswordEmailContent', () => {
  it('is exactly the registry’s shipped default for the password-reset type', () => {
    const url = 'https://api.test/reset/abc'
    expect(resetPasswordEmailContent({ url })).toEqual(
      renderEmailTemplate(
        PASSWORD_RESET_EMAIL,
        undefined,
        passwordResetValues({ url })
      )
    )
  })

  it('places the url in the html link and the text body', () => {
    const out = resetPasswordEmailContent({ url: URL_WITH_CB })
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toContain(
      `<a href="${URL_WITH_CB}">Reset your password</a>`
    )
    expect(out.text).toContain(`Reset your password: ${URL_WITH_CB}`)
  })

  // The URL goes into an href, so it must NOT be entity-escaped — `&` between query parameters
  // has to survive as `&`, which is what the pre-#499 string interpolation did.
  it('keeps query separators in the emailed link unescaped', () => {
    const url = 'https://api.test/reset/abc?token=1&callbackURL=%2Fx'
    expect(resetPasswordEmailContent({ url }).html).toContain(`href="${url}"`)
  })
})

// #364, unchanged by #499 — retained here because nothing else covered it. better-auth 1.6.23+
// treats an EMPTY callbackURL as INVALID_TOKEN, so an emailed link without one is a dead end.
describe('withDefaultResetCallback', () => {
  it('fills in the default when the built link has an empty callbackURL', () => {
    const out = withDefaultResetCallback(
      URL_EMPTY_CB,
      'https://admin.test/reset-password'
    )
    expect(new URL(out).searchParams.get('callbackURL')).toBe(
      'https://admin.test/reset-password'
    )
  })

  it('fills in the default when the built link has no callbackURL at all', () => {
    const out = withDefaultResetCallback(
      'https://api.test/api/auth/reset-password/tok',
      'https://admin.test/reset-password'
    )
    expect(new URL(out).searchParams.get('callbackURL')).toBe(
      'https://admin.test/reset-password'
    )
  })

  // An explicit, origin-checked redirectTo the requester passed is returned BYTE-FOR-BYTE —
  // rewriting it would change where a reset click lands.
  it('leaves a link that already carries a callback untouched', () => {
    expect(
      withDefaultResetCallback(URL_WITH_CB, 'https://admin.test/reset-password')
    ).toBe(URL_WITH_CB)
  })

  it('leaves an unparseable url untouched rather than guessing', () => {
    expect(withDefaultResetCallback('not a url', 'https://admin.test/x')).toBe(
      'not a url'
    )
  })
})
