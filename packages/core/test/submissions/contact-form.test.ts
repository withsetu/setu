import { describe, it, expect, vi } from 'vitest'
import {
  validateContactFields,
  submitContact,
  isEmailish,
  resolveContactApiBase,
  CONTACT_DEFAULT_TEXT
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

// #1248: the contact island's API origin. localhost is a dev-only convenience — a production
// build without PUBLIC_SETU_API_BASE must NOT bake it into static HTML (it would post visitors'
// messages to their own machine); null tells the renderer to show an honest unavailable state.
describe('resolveContactApiBase (#1248)', () => {
  it('uses the configured origin in any mode', () => {
    expect(resolveContactApiBase('https://api.example.com', false)).toBe(
      'https://api.example.com'
    )
    expect(resolveContactApiBase('https://api.example.com', true)).toBe(
      'https://api.example.com'
    )
  })
  it('falls back to the local dev API only in dev', () => {
    expect(resolveContactApiBase(undefined, true)).toBe('http://localhost:4444')
  })
  it('is null (unavailable) in a production build with nothing configured', () => {
    expect(resolveContactApiBase(undefined, false)).toBeNull()
    expect(resolveContactApiBase('', false)).toBeNull()
    expect(resolveContactApiBase('   ', false)).toBeNull()
  })
  it('treats a blank value as unset in dev too', () => {
    expect(resolveContactApiBase('', true)).toBe('http://localhost:4444')
  })
})

describe('CONTACT_DEFAULT_TEXT (#1248)', () => {
  it('keeps the shipped English defaults', () => {
    expect(CONTACT_DEFAULT_TEXT).toEqual({
      nameLabel: 'Name',
      emailLabel: 'Email',
      subjectLabel: 'Subject',
      messageLabel: 'Message',
      submitLabel: 'Send',
      successMessage: 'Thanks — your message has been sent.',
      errorMessage: 'Something went wrong. Please try again.'
    })
  })
})
