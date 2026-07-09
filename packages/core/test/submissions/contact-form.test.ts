import { describe, it, expect, vi } from 'vitest'
import {
  validateContactFields,
  submitContact,
  isEmailish
} from '../../src/submissions/contact-form'

const req = { name: true, subject: false, message: true }

describe('isEmailish (linear email floor, #340)', () => {
  // The set below pins the EXACT behaviour of the old
  // `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` so the linear rewrite cannot drift.
  // `a@b.c.` / `a@.b.c` LOOK odd but the old regex accepted them (the domain just
  // needs an interior dot) — behaviour preservation means we accept them too.
  const accept = [
    'a@b.c',
    'ada@x.com',
    'ab@c.de',
    'a@b.c.d',
    'a@.b.c',
    'a@b..c',
    'a@b.c.'
  ]
  const reject = [
    '',
    'a',
    '@',
    'a@b',
    '@b.c',
    'a@.c',
    'a@b.',
    'a@@b.c',
    'a b@c.d',
    'a@b c.d',
    'a@b.c ',
    ' a@b.c'
  ]
  it('accepts the same addresses the old regex accepted', () => {
    for (const s of accept) expect(isEmailish(s), s).toBe(true)
  })
  it('rejects the same addresses the old regex rejected', () => {
    for (const s of reject) expect(isEmailish(s), s).toBe(false)
  })
  it('does not catastrophically backtrack on adversarial input', () => {
    // The old regex was quadratic on this shape (seconds at 60k; ~minutes here).
    const evil = 'a@' + '.'.repeat(100_000) + '@'
    const t = performance.now()
    expect(isEmailish(evil)).toBe(false)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

describe('validateContactFields', () => {
  it('passes a complete valid form', () => {
    const r = validateContactFields(
      { name: 'Ada', email: 'ada@x.com', message: 'hi' },
      req
    )
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual({})
  })
  it('flags a bad email and missing required fields', () => {
    const r = validateContactFields(
      { name: '', email: 'bad', message: '' },
      req
    )
    expect(r.ok).toBe(false)
    expect(Object.keys(r.errors).sort()).toEqual(['email', 'message', 'name'])
  })
  it('ignores non-required empty fields (subject)', () => {
    const r = validateContactFields(
      { name: 'A', email: 'a@x.com', subject: '', message: 'hi' },
      req
    )
    expect(r.ok).toBe(true)
  })
})

describe('submitContact', () => {
  it('POSTs to {apiBase}/forms/submit and returns the result', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, id: 'x' }), { status: 200 })
    ) as unknown as typeof fetch
    const r = await submitContact({
      apiBase: 'https://api.example.com',
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi' },
      captchaToken: 'tok',
      pageUrl: 'https://site/x',
      fetchImpl
    })
    expect(r).toEqual({ ok: true, id: 'x' })
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(call).toBeDefined()
    if (call) {
      expect(String(call[0])).toBe('https://api.example.com/forms/submit')
      const body = JSON.parse((call[1] as RequestInit).body as string)
      expect(body).toMatchObject({
        formId: 'contact',
        captchaToken: 'tok',
        source: { url: 'https://site/x' }
      })
    }
  })
  it('maps a non-ok HTTP status to a server error result', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch
    const r = await submitContact({
      apiBase: 'https://a',
      formId: 'c',
      fields: {},
      captchaToken: 't',
      fetchImpl
    })
    expect(r).toEqual({ ok: false, error: 'server' })
  })
})
