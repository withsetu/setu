import { describe, it, expect } from 'vitest'
import {
  createRecordingFetch,
  captchaFields,
  captchaContentType,
  CAPTCHA_CONTRACT_CONTENT_TYPE
} from '../src/index'

// The contract's assertions are only as good as its ability to see the request —
// #891 was exactly a harness that could not. These cover the recording itself.
describe('createRecordingFetch', () => {
  it('records nothing before the transport is called', () => {
    const { requests } = createRecordingFetch(() => new Response('{}'))
    expect(requests).toEqual([])
  })

  it('records the url, method and form body of a POST', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response(JSON.stringify({ success: true }))
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      body: new URLSearchParams({ secret: 's3cret', response: 'tok' })
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://provider.test/verify')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.body).toContain('secret=s3cret')
    expect(requests[0]?.body).toContain('response=tok')
  })

  it('records the request headers, so the wire format is observable', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      body: new URLSearchParams({ secret: 's3cret' })
    })

    // `fetch` derives Content-Type from the body type; recording it is what lets
    // the contract catch an adapter that serialises some other way (#911).
    expect(captchaContentType(requests[0]!)).toBe(CAPTCHA_CONTRACT_CONTENT_TYPE)
  })

  // `captchaContentType` indexes the record with the literal 'content-type', so a record
  // that kept the caller's casing would read as "no Content-Type at all" and every format
  // assertion built on it would pass vacuously. #914 found the claim documented but
  // unenforced.
  it('lower-cases header names, whatever casing the caller used', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'secret=s3cret'
    })

    expect(Object.keys(requests[0]!.headers)).toContain('content-type')
    expect(Object.keys(requests[0]!.headers)).not.toContain('Content-Type')
    expect(captchaContentType(requests[0]!)).toBe(CAPTCHA_CONTRACT_CONTENT_TYPE)
  })

  // The charset parameter is not hypothetical: `fetch` derives
  // 'application/x-www-form-urlencoded;charset=UTF-8' from a URLSearchParams body, so
  // every other Content-Type assertion here depends on the strip.
  it('strips a ;charset parameter off the recorded Content-Type', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: 'secret=s3cret'
    })

    expect(requests[0]!.headers['content-type']).toContain('charset')
    expect(captchaContentType(requests[0]!)).toBe(CAPTCHA_CONTRACT_CONTENT_TYPE)
  })

  it('records a JSON body as JSON — the format the contract must reject', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      body: JSON.stringify({ secret: 's3cret', response: 'tok' })
    })

    expect(captchaContentType(requests[0]!)).not.toBe(
      CAPTCHA_CONTRACT_CONTENT_TYPE
    )
    // And field parsing does not accidentally succeed on it.
    expect(captchaFields(requests[0]!).get('secret')).toBeNull()
  })

  it('parses swapped fields as swapped, which a substring match cannot', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/verify', {
      method: 'POST',
      body: new URLSearchParams({ secret: 'tok', response: 's3cret' })
    })

    expect(requests[0]?.body).toContain('s3cret') // the old, blind assertion
    expect(captchaFields(requests[0]!).get('secret')).toBe('tok')
    expect(captchaFields(requests[0]!).get('response')).toBe('s3cret')
  })

  it('records each call separately, in order', async () => {
    const { fetchImpl, requests } = createRecordingFetch(
      () => new Response('{}')
    )
    await fetchImpl('https://provider.test/a', {
      method: 'POST',
      body: 'first'
    })
    await fetchImpl('https://provider.test/b', {
      method: 'POST',
      body: 'second'
    })

    expect(requests.map((r) => r.url)).toEqual([
      'https://provider.test/a',
      'https://provider.test/b'
    ])
    expect(requests.map((r) => r.body)).toEqual(['first', 'second'])
  })

  it('returns the canned response to the caller', async () => {
    const { fetchImpl } = createRecordingFetch(
      () => new Response(JSON.stringify({ success: true }), { status: 418 })
    )
    const res = await fetchImpl('https://provider.test/verify')
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ success: true })
  })
})
