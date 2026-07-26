import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { Resend } from 'resend'
import type { EmailMessage } from '@setu/core'
import {
  createResendEmailAdapter,
  RESEND_REQUEST_TIMEOUT_DEFAULT
} from '../src/index'

/** #930 — the twin of #928's SMTP bound. The failure to bound is not "the API refused" (that
 *  answers instantly) but an endpoint that ACCEPTS the connection and then stalls: the form
 *  notification is awaited inside the public, unauthenticated `POST /forms/submit` handler, and the
 *  submission row is already persisted by then, so the wait buys nothing and holds an anonymous
 *  request plus a socket.
 *
 *  Verified against the INSTALLED SDK rather than from memory — resend 6.18.0, which is also the
 *  npm `latest` (checked 2026-07-26), `dist/index.mjs`: `fetchRequest` is a bare
 *  `await fetch(url, options)`, `ResendOptions` is `{ baseUrl, userAgent }` with no timeout, and
 *  `PostOptions` (so `CreateEmailRequestOptions`) declares only `{ query, headers }`. So the SDK
 *  offers no bound at either level and does not even DECLARE a `signal` — which is why the adapter
 *  owns the deadline itself and only forwards the signal opportunistically. */
const MSG: EmailMessage = {
  to: 'a@x.com',
  from: 's@x.com',
  subject: 'subj',
  html: '<p>x</p>'
}

describe('the resend adapter bounds its own request (#930)', () => {
  it('rejects a stalled send within the configured timeout instead of waiting forever', async () => {
    // A client that never settles — the pure "stalled upstream" shape, with no socket involved.
    const send = vi.fn(() => new Promise<never>(() => {}))
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client: { emails: { send } },
      requestTimeoutMs: 100
    })
    const started = Date.now()
    await expect(adapter.send(MSG)).rejects.toThrow(/timed out after 100ms/)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('names a bounded default so an adapter constructed with no options is still bounded', () => {
    expect(RESEND_REQUEST_TIMEOUT_DEFAULT).toBeGreaterThan(0)
    // Seconds-scale, like SMTP_TIMEOUT_DEFAULTS in packages/email-smtp/src/index.ts. A minute or
    // more would be the bug this closes wearing a smaller number.
    expect(RESEND_REQUEST_TIMEOUT_DEFAULT).toBeLessThanOrEqual(30_000)
  })

  it('leaves a prompt send alone — the bound must not cost a normal delivery', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null }))
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client: { emails: { send } },
      requestTimeoutMs: 50
    })
    await expect(adapter.send(MSG)).resolves.toBeUndefined()
  })

  // The scenario the deleted `signal.aborted` re-check claimed to handle (review F2). It never
  // could — this passes because the deadline listener is registered BEFORE the send, so `abort()`
  // settles the race before the SDK's resolution arrives. That ordering is the real invariant, so
  // it gets the real test: move the `deadline` promise below the `client.emails.send(...)` call in
  // src/index.ts and this fails with the SDK's generic message instead.
  it('reports the timeout even when the SDK resolves with its own generic error on abort', async () => {
    const client = {
      emails: {
        send: (_m: EmailMessage, o?: { signal?: AbortSignal }) =>
          new Promise<{
            data: unknown
            error: { message: string; name: string } | null
          }>((resolve) => {
            // Exactly what resend 6.18.0's `fetchRequest` does when its fetch is aborted: it
            // catches and RESOLVES with an opaque error object rather than rejecting.
            o?.signal?.addEventListener('abort', () =>
              resolve({
                data: null,
                error: {
                  message:
                    'Unable to fetch data. The request could not be resolved.',
                  name: 'application_error'
                }
              })
            )
          })
      }
    }
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client,
      requestTimeoutMs: 50
    })
    await expect(adapter.send(MSG)).rejects.toThrow(/timed out after 50ms/)
    await expect(adapter.send(MSG)).rejects.not.toThrow(/Unable to fetch data/)
  })

  it('reports a genuine API error as itself, not as a timeout', async () => {
    const send = vi.fn(async () => ({
      data: null,
      error: { message: 'bad key', name: 'invalid_api_key' }
    }))
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client: { emails: { send } },
      requestTimeoutMs: 5_000
    })
    await expect(adapter.send(MSG)).rejects.toThrow('bad key')
  })
})

/** The other half of the bound: the deadline must also CANCEL the in-flight HTTP request, not just
 *  stop waiting for it. A `Promise.race` alone would return the handler to the caller while the
 *  socket stayed open, so a sustained flood of stalled sends would still accumulate sockets.
 *
 *  This drives the REAL SDK (`new Resend`, injected through the adapter's existing `client` seam
 *  with its `baseUrl` pointed at a local blackhole) so it proves the signal survives the SDK's own
 *  option handling — which matters precisely because `PostOptions` does not declare it. The
 *  listener watching its own socket close is the whole point: with the signal dropped, the socket
 *  stays open and this test fails. */
describe('the deadline cancels the in-flight request, not just the wait (#930)', () => {
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

  it('closes the socket of a stalled request', async () => {
    let closed = false
    server = createServer((socket) => {
      // Accept the connection, read the request, and then never answer.
      held.push(socket)
      socket.on('close', () => {
        closed = true
      })
      socket.resume()
    })
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve)
    )
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('expected a TCP address')

    const adapter = createResendEmailAdapter({
      apiKey: 're_test',
      client: new Resend('re_test', {
        baseUrl: `http://127.0.0.1:${address.port}`
      }),
      requestTimeoutMs: 250
    })
    const started = Date.now()
    await expect(adapter.send(MSG)).rejects.toThrow(/timed out after 250ms/)
    expect(Date.now() - started).toBeLessThan(5_000)
    // The abort has to reach the socket, which happens a tick or two after the rejection.
    for (let i = 0; i < 100 && !closed; i++)
      await new Promise((r) => setTimeout(r, 20))
    expect(closed, 'the aborted request left its socket open').toBe(true)
  })
})
