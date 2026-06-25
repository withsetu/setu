import { describe, it, expect } from 'vitest'
import { createNoopCaptcha } from '../../src/captcha/captcha-port'

describe('createNoopCaptcha', () => {
  it('accepts any token (dev/no-provider pass-through)', async () => {
    const c = createNoopCaptcha()
    expect(await c.verify('anything')).toBe(true)
    expect(await c.verify('')).toBe(true)
  })
})
