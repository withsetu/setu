import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  postSiteverify,
  SITEVERIFY_TIMEOUT_MS
} from '../../src/captcha/siteverify'

const body = () => new URLSearchParams({ secret: 's', response: 't' })
const respond =
  (r: Response): typeof fetch =>
  async () =>
    r

describe('postSiteverify', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the parsed JSON body on a 2xx', async () => {
    const data = await postSiteverify({
      fetchImpl: respond(new Response('{"success":true}')),
      url: 'https://example.test/siteverify',
      body: body()
    })
    expect(data).toEqual({ success: true })
  })

  it('returns null on a non-OK status, a throw, or an unparseable body', async () => {
    const url = 'https://example.test/siteverify'
    expect(
      await postSiteverify({
        fetchImpl: respond(new Response('{}', { status: 503 })),
        url,
        body: body()
      })
    ).toBeNull()
    expect(
      await postSiteverify({
        fetchImpl: () => Promise.reject(new Error('net')),
        url,
        body: body()
      })
    ).toBeNull()
    expect(
      await postSiteverify({
        fetchImpl: respond(new Response('not json')),
        url,
        body: body()
      })
    ).toBeNull()
  })

  it('defaults to a 10s deadline and resolves null when it passes', async () => {
    expect(SITEVERIFY_TIMEOUT_MS).toBe(10_000)
    vi.useFakeTimers()
    let out: unknown = 'pending'
    void postSiteverify({
      fetchImpl: () => new Promise<Response>(() => {}),
      url: 'https://example.test/siteverify',
      body: body()
    }).then((v) => {
      out = v
    })
    await vi.advanceTimersByTimeAsync(SITEVERIFY_TIMEOUT_MS - 1)
    expect(out).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(out).toBeNull()
  })

  it('does not leave its timer running after a fast answer', async () => {
    vi.useFakeTimers()
    await postSiteverify({
      fetchImpl: respond(new Response('{"success":true}')),
      url: 'https://example.test/siteverify',
      body: body()
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
