import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTransport } from 'nodemailer'
import { createSmtpEmailAdapter } from '../src/index'

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

  it('never constructs a real transport when one is injected', () => {
    createSmtpEmailAdapter({
      host: 'h',
      port: 1,
      transport: { sendMail: async () => ({}) }
    })
    expect(mockedCreateTransport).not.toHaveBeenCalled()
  })
})
