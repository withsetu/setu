import { describe, it, expect, vi } from 'vitest'
import { createTurnstileVerifier } from '../../src/submissions/turnstile'

const fakeFetch = (success: boolean) =>
  vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 })) as unknown as typeof fetch

describe('createTurnstileVerifier', () => {
  it('returns true when Cloudflare reports success', async () => {
    const verify = createTurnstileVerifier('secret', fakeFetch(true))
    expect(await verify('token', '1.2.3.4')).toBe(true)
  })

  it('returns false when Cloudflare reports failure', async () => {
    const verify = createTurnstileVerifier('secret', fakeFetch(false))
    expect(await verify('token')).toBe(false)
  })

  it('returns false when the request throws', async () => {
    const verify = createTurnstileVerifier('secret', (() => Promise.reject(new Error('net'))) as unknown as typeof fetch)
    expect(await verify('token')).toBe(false)
  })
})
