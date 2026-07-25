import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTransport } from 'nodemailer'
import { createSmtpEmailAdapter, SMTP_TIMEOUT_DEFAULTS } from '../src/index'

/** The injected-transport seam used by contract.test.ts bypasses
 *  nodemailer.createTransport entirely, and the live Mailpit round-trip runs
 *  auth-less with secure:false — so without this file, a broken `secure`
 *  default or a dropped `auth` pass-through in src/index.ts would fail no
 *  test. These pin the exact options handed to createTransport when NO
 *  transport is injected. */
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn(async () => ({ messageId: 'mocked' }))
  }))
}))

const mockedCreateTransport = vi.mocked(createTransport)
const firstCallOptions = () =>
  mockedCreateTransport.mock.calls[0]![0] as unknown as Record<string, unknown>

describe('createSmtpEmailAdapter → nodemailer.createTransport wiring', () => {
  beforeEach(() => {
    mockedCreateTransport.mockClear()
  })

  it('passes host and port through, defaults secure to false, and sends no auth when none given', () => {
    createSmtpEmailAdapter({ host: 'smtp.example.com', port: 587 })
    expect(mockedCreateTransport).toHaveBeenCalledTimes(1)
    const opts = firstCallOptions()
    expect(opts.host).toBe('smtp.example.com')
    expect(opts.port).toBe(587)
    expect(opts.secure).toBe(false)
    expect(opts.auth).toBeUndefined()
  })

  it('passes secure: true through for implicit TLS (SMTPS)', () => {
    createSmtpEmailAdapter({ host: 'h', port: 465, secure: true })
    expect(firstCallOptions().secure).toBe(true)
  })

  it('passes an explicit secure: false through unchanged', () => {
    createSmtpEmailAdapter({ host: 'h', port: 587, secure: false })
    expect(firstCallOptions().secure).toBe(false)
  })

  it('passes the auth pair through verbatim when given', () => {
    createSmtpEmailAdapter({
      host: 'h',
      port: 587,
      auth: { user: 'u', pass: 'p' }
    })
    expect(firstCallOptions().auth).toEqual({ user: 'u', pass: 'p' })
  })

  it('sends through the transport it constructed', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'x' }))
    mockedCreateTransport.mockReturnValueOnce({
      sendMail
    } as unknown as ReturnType<typeof createTransport>)
    const adapter = createSmtpEmailAdapter({ host: 'h', port: 587 })
    await adapter.send({
      to: 'a@x.com',
      from: 's@x.com',
      subject: 'subj',
      html: '<p>x</p>'
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  // #928 — the notification send is awaited inside the PUBLIC /forms/submit request handler, so an
  // unset timeout is nodemailer's minutes-scale default holding an api request and a socket. Each
  // of the four is asserted by name: dropping ONE from src/index.ts must fail this file (the
  // kill-shot), because a single missing option silently restores the multi-minute stall.
  describe('bounded socket timeouts (#928)', () => {
    const TIMEOUT_KEYS = [
      'connectionTimeout',
      'greetingTimeout',
      'socketTimeout',
      'dnsTimeout'
    ] as const

    it('passes all four bounded defaults to createTransport', () => {
      createSmtpEmailAdapter({ host: 'h', port: 587 })
      const opts = firstCallOptions()
      for (const key of TIMEOUT_KEYS) {
        expect(opts[key], key).toBe(SMTP_TIMEOUT_DEFAULTS[key])
      }
    })

    it('keeps every default in the seconds range, not nodemailer’s minutes', () => {
      // The regression this guards is a value drifting back toward the 2 min / 10 min defaults.
      for (const key of TIMEOUT_KEYS) {
        expect(SMTP_TIMEOUT_DEFAULTS[key], key).toBeGreaterThan(0)
        expect(SMTP_TIMEOUT_DEFAULTS[key], key).toBeLessThanOrEqual(60_000)
      }
    })

    it('lets an operator override each one independently, keeping the defaults for the rest', () => {
      createSmtpEmailAdapter({
        host: 'h',
        port: 587,
        socketTimeout: 90_000
      })
      const opts = firstCallOptions()
      expect(opts.socketTimeout).toBe(90_000)
      expect(opts.connectionTimeout).toBe(
        SMTP_TIMEOUT_DEFAULTS.connectionTimeout
      )
      expect(opts.greetingTimeout).toBe(SMTP_TIMEOUT_DEFAULTS.greetingTimeout)
      expect(opts.dnsTimeout).toBe(SMTP_TIMEOUT_DEFAULTS.dnsTimeout)
    })

    it('overrides all four when all four are given', () => {
      createSmtpEmailAdapter({
        host: 'h',
        port: 587,
        connectionTimeout: 1_000,
        greetingTimeout: 2_000,
        socketTimeout: 3_000,
        dnsTimeout: 4_000
      })
      const opts = firstCallOptions()
      expect(opts.connectionTimeout).toBe(1_000)
      expect(opts.greetingTimeout).toBe(2_000)
      expect(opts.socketTimeout).toBe(3_000)
      expect(opts.dnsTimeout).toBe(4_000)
    })
  })

  it('never constructs a real transport when one is injected', () => {
    createSmtpEmailAdapter({
      host: 'h',
      port: 1,
      transport: { sendMail: async () => ({}) }
    })
    expect(mockedCreateTransport).not.toHaveBeenCalled()
  })
})
