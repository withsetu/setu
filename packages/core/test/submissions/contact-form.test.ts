import { describe, it, expect, vi } from 'vitest'
import {
  validateContactFields,
  submitContact
} from '../../src/submissions/contact-form'

const req = { name: true, subject: false, message: true }

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
