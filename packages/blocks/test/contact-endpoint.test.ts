// packages/blocks/test/contact-endpoint.test.ts
//
// #1248: a production build without PUBLIC_SETU_API_BASE renders the contact form as
// unavailable and says so ONCE at build time, naming the variable to set.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('../src/contact/endpoint')
let mod: Mod
beforeEach(async () => {
  vi.resetModules()
  mod = await import('../src/contact/endpoint')
})

describe('contactApiBaseForBuild', () => {
  it('passes a configured origin through without warning', () => {
    const warn = vi.fn()
    expect(
      mod.contactApiBaseForBuild('https://api.example.com', false, warn)
    ).toBe('https://api.example.com')
    expect(warn).not.toHaveBeenCalled()
  })

  it('uses the local dev API in dev without warning', () => {
    const warn = vi.fn()
    expect(mod.contactApiBaseForBuild(undefined, true, warn)).toBe(
      'http://localhost:4444'
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('is null in a production build and warns once, naming the variable', () => {
    const warn = vi.fn()
    expect(mod.contactApiBaseForBuild(undefined, false, warn)).toBeNull()
    expect(mod.contactApiBaseForBuild(undefined, false, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('PUBLIC_SETU_API_BASE')
  })
})
