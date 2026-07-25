import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { createSmtpEmailAdapter } from '../src/index'

/** #928: the failure this adapter must bound is not "connection refused" — that fails instantly
 *  anyway — but a host that ACCEPTS the TCP connection and then says nothing. Because the form
 *  notification is awaited inside the public /forms/submit handler, an unbounded greeting wait
 *  holds an api request and a socket for as long as the transport allows (nodemailer 9.0.3's
 *  default is 30 s for the greeting and 10 min for socket inactivity).
 *
 *  This drives a real socket against a real blackhole listener with a small `greetingTimeout`, so
 *  it proves the option is WIRED (not merely present in an options object) and that the send
 *  REJECTS rather than hanging. Hermetic: the listener is this process, on an ephemeral port. */
describe('a blackholing SMTP host fails the send within the bound (#928)', () => {
  let server: Server | undefined
  const held: Socket[] = []

  afterEach(async () => {
    for (const s of held) s.destroy()
    held.length = 0
    await new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    })
    server = undefined
  })

  const blackhole = async (): Promise<number> => {
    server = createServer((socket) => {
      // Accept and then say nothing at all — never send the 220 greeting.
      held.push(socket)
    })
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve)
    )
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('expected a TCP address')
    return address.port
  }

  const send = (port: number, opts: Record<string, number>) =>
    createSmtpEmailAdapter({ host: '127.0.0.1', port, ...opts }).send({
      to: 'a@x.com',
      from: 's@x.com',
      subject: 'subj',
      html: '<p>x</p>'
    })

  // greetingTimeout is isolated deliberately — the other three are left large, so a pass here
  // cannot be another bound doing the work. Both greetingTimeout and socketTimeout do fire
  // against this shape (verified by driving each alone against this listener); the second case
  // below pins that the OTHER one is wired too, so neither can silently stop being passed.
  it('rejects inside the configured greeting timeout, not nodemailer’s 30 s default', async () => {
    const port = await blackhole()
    const started = Date.now()
    await expect(
      send(port, {
        greetingTimeout: 250,
        connectionTimeout: 60_000,
        socketTimeout: 60_000,
        dnsTimeout: 60_000
      })
    ).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('rejects inside the configured socket-inactivity timeout, not nodemailer’s 10 min default', async () => {
    const port = await blackhole()
    const started = Date.now()
    await expect(
      send(port, {
        greetingTimeout: 60_000,
        connectionTimeout: 60_000,
        socketTimeout: 250,
        dnsTimeout: 60_000
      })
    ).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
