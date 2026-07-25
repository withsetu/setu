import { describe, it, expect } from 'vitest'
import type { CaptchaPort } from '@setu/core'

/** One record per request an adapter made through the injected transport. The
 *  request is flattened to strings so the runner stays provider-agnostic: it
 *  asserts that the identifying values survived the hop, not how a given
 *  provider encodes them. */
export interface CaptchaRequestRecord {
  /** Absolute request URL, as the adapter addressed it. */
  url: string
  method: string
  /** Request body, read as text (both shipped providers send form-encoded). */
  body: string
}

/** A `fetch` that records what an adapter transmits and then returns `respond()`.
 *  This is the piece #891 was missing: the old contract injected a zero-parameter
 *  `async () => Response`, so URL, secret and token were structurally unobservable
 *  and therefore unasserted. `test/recording-fetch.test.ts` covers the recording. */
export function createRecordingFetch(
  respond: () => Response | Promise<Response>
): {
  fetchImpl: typeof fetch
  requests: CaptchaRequestRecord[]
} {
  const requests: CaptchaRequestRecord[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    requests.push({ url: req.url, method: req.method, body: await req.text() })
    return respond()
  }
  return { fetchImpl, requests }
}

/** The secret every harness must configure its adapter with. Deliberately a
 *  distinctive marker so a substring assertion cannot pass by coincidence. */
export const CAPTCHA_CONTRACT_SECRET = 'setu-contract-secret-marker'

/** The token the contract passes to `verify()`. Same reasoning as the secret. */
export const CAPTCHA_CONTRACT_TOKEN = 'setu-contract-token-marker'

/** The client IP the contract passes as `remoteip`. Documentation range
 *  (RFC 5737 TEST-NET-3) and URL-safe, so form encoding leaves it intact. */
export const CAPTCHA_CONTRACT_REMOTEIP = '203.0.113.7'

/** Everything an adapter must expose for the CaptchaPort contract to drive it. */
export interface CaptchaContractHarness {
  /** Build the adapter under test, configured with `CAPTCHA_CONTRACT_SECRET` and
   *  wiring `fetchImpl` as its transport. Must return a FRESH adapter per call. */
  makeAdapter: (fetchImpl: typeof fetch) => CaptchaPort
  /** The absolute URL the adapter must POST its verification to. Restated by the
   *  caller rather than read from the adapter, so the assertion is independent of
   *  the value under test — reading `SITEVERIFY` from the adapter would make the
   *  check vacuous. */
  endpoint: string
}

const ok = (body: unknown, status = 200): (() => Response) => {
  return () => new Response(JSON.stringify(body), { status })
}

/** Behavioural contract for any CaptchaPort adapter — both what it does with the
 *  provider's answer (fail-closed on every non-success) and what it puts on the
 *  wire (endpoint, secret, token, remoteip).
 *
 *  The transmission half constrains adapters to a POST whose body carries the
 *  credentials; a provider needing query-string auth would need the contract
 *  widened rather than the endpoint assertion relaxed. */
export function runCaptchaPortContract(harness: CaptchaContractHarness): void {
  const { makeAdapter, endpoint } = harness

  /** Run one `verify()` against a canned response and return every request it made. */
  const captureAll = async (
    respond: () => Response,
    remoteip?: string
  ): Promise<CaptchaRequestRecord[]> => {
    const { fetchImpl, requests } = createRecordingFetch(respond)
    await makeAdapter(fetchImpl).verify(CAPTCHA_CONTRACT_TOKEN, remoteip)
    return requests
  }

  /** As `captureAll`, narrowed to the single request an adapter is expected to
   *  make. Throws rather than returning `undefined` so a silent no-request
   *  adapter fails with a message that says what happened. */
  const capture = async (
    respond: () => Response,
    remoteip?: string
  ): Promise<CaptchaRequestRecord> => {
    const [req] = await captureAll(respond, remoteip)
    if (!req) throw new Error('adapter sent no request to the provider')
    return req
  }

  describe('CaptchaPort contract', () => {
    describe('provider response handling', () => {
      it('returns true when the provider reports success', async () => {
        const { fetchImpl } = createRecordingFetch(ok({ success: true }))
        expect(await makeAdapter(fetchImpl).verify('tok')).toBe(true)
      })

      it('returns false when the provider reports failure', async () => {
        const { fetchImpl } = createRecordingFetch(ok({ success: false }))
        expect(await makeAdapter(fetchImpl).verify('tok')).toBe(false)
      })

      it('returns false on a non-OK HTTP status (fail-closed)', async () => {
        const { fetchImpl } = createRecordingFetch(ok({}, 500))
        expect(await makeAdapter(fetchImpl).verify('tok')).toBe(false)
      })

      it('returns false when the request throws (fail-closed)', async () => {
        const throwing = (() =>
          Promise.reject(new Error('net'))) as unknown as typeof fetch
        expect(await makeAdapter(throwing).verify('tok')).toBe(false)
      })
    })

    describe('what reaches the provider', () => {
      it('POSTs exactly one verification to the provider endpoint', async () => {
        const requests = await captureAll(ok({ success: true }))
        expect(requests).toHaveLength(1)
        expect(requests[0]?.url).toBe(endpoint)
        expect(requests[0]?.method).toBe('POST')
      })

      it('transmits the configured secret', async () => {
        const req = await capture(ok({ success: true }))
        expect(req.body).toContain(CAPTCHA_CONTRACT_SECRET)
      })

      it('transmits the token it was asked to verify', async () => {
        const req = await capture(ok({ success: true }))
        expect(req.body).toContain(CAPTCHA_CONTRACT_TOKEN)
      })

      it('transmits remoteip when the caller supplies one', async () => {
        const req = await capture(
          ok({ success: true }),
          CAPTCHA_CONTRACT_REMOTEIP
        )
        expect(req.body).toContain(CAPTCHA_CONTRACT_REMOTEIP)
      })

      it('omits remoteip when the caller supplies none', async () => {
        const req = await capture(ok({ success: true }))
        expect(req.body).not.toContain('remoteip')
      })

      it('still transmits the credentials when the provider rejects the token', async () => {
        // A failing verification must be a real round trip, not a short circuit.
        const req = await capture(ok({ success: false }))
        expect(req.body).toContain(CAPTCHA_CONTRACT_SECRET)
        expect(req.body).toContain(CAPTCHA_CONTRACT_TOKEN)
      })
    })
  })
}
