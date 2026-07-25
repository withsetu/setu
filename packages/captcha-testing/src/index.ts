import { describe, it, expect } from 'vitest'
import type { CaptchaPort } from '@setu/core'

/** One record per request an adapter made through the injected transport. */
export interface CaptchaRequestRecord {
  /** Absolute request URL, as the adapter addressed it. */
  url: string
  method: string
  /** Request body, read as text (both shipped adapters send form-encoded). */
  body: string
  /** Request headers, lower-cased names → values, as `Headers` yields them.
   *  Recorded because the wire FORMAT is half of what an adapter must get right
   *  and is invisible in the body text alone: a body the provider cannot parse
   *  takes captcha down entirely, and #911 proved the old body-only record could
   *  not see it (swapping URLSearchParams for JSON.stringify passed 10/10). */
  headers: Record<string, string>
}

/** The adapter's body parsed as the form encoding the contract requires, so
 *  assertions are per-FIELD. A substring match on the flattened body cannot tell
 *  `secret=<secret>&response=<token>` from the same two values swapped, which is
 *  a total outage plus the site secret landing in the field providers log
 *  (#911). Covered by test/recording-fetch.test.ts and by the 'what reaches the
 *  provider' cases below. */
export function captchaFields(req: CaptchaRequestRecord): URLSearchParams {
  return new URLSearchParams(req.body)
}

/** The record's Content-Type with any `;charset=…` parameter stripped. */
export function captchaContentType(req: CaptchaRequestRecord): string {
  return (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
}

/** What `captchaContentType` must equal: the encoding `captchaFields` parses.
 *  A provider needing JSON would mean widening the contract — deliberately, with
 *  its own field-level assertions — not relaxing this one. */
export const CAPTCHA_CONTRACT_CONTENT_TYPE = 'application/x-www-form-urlencoded'

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
    requests.push({
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      body: await req.text()
    })
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
 *  The transmission half constrains adapters to a POST whose form-encoded body
 *  carries the credentials in named fields; a provider needing query-string auth
 *  or a JSON body would need the contract widened — with its own field-level
 *  assertions — rather than the endpoint or encoding assertions relaxed. */
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

      it('form-encodes the body and declares that encoding in Content-Type', async () => {
        // The provider parses by Content-Type. An adapter that serialises some
        // other way sends a body every provider rejects — captcha fully down —
        // while the credential markers are all still present in the text, which
        // is why every assertion below reads FIELDS, not substrings (#911).
        const req = await capture(ok({ success: true }))
        expect(captchaContentType(req)).toBe(CAPTCHA_CONTRACT_CONTENT_TYPE)
      })

      it('transmits the configured secret in the `secret` field', async () => {
        const req = await capture(ok({ success: true }))
        expect(captchaFields(req).get('secret')).toBe(CAPTCHA_CONTRACT_SECRET)
      })

      it('transmits the token it was asked to verify in the `response` field', async () => {
        const req = await capture(ok({ success: true }))
        expect(captchaFields(req).get('response')).toBe(CAPTCHA_CONTRACT_TOKEN)
      })

      it('never puts the secret in the token field, or the token in the secret field', async () => {
        // Swapping the two is not merely a failed verification: the site secret
        // goes out in the field the provider treats as user input and logs.
        const fields = captchaFields(await capture(ok({ success: true })))
        expect(fields.get('response')).not.toBe(CAPTCHA_CONTRACT_SECRET)
        expect(fields.get('secret')).not.toBe(CAPTCHA_CONTRACT_TOKEN)
      })

      it('transmits remoteip in the `remoteip` field when the caller supplies one', async () => {
        const req = await capture(
          ok({ success: true }),
          CAPTCHA_CONTRACT_REMOTEIP
        )
        expect(captchaFields(req).get('remoteip')).toBe(
          CAPTCHA_CONTRACT_REMOTEIP
        )
      })

      it('omits remoteip when the caller supplies none', async () => {
        const req = await capture(ok({ success: true }))
        expect(captchaFields(req).has('remoteip')).toBe(false)
      })

      it('sends no fields beyond secret, response and remoteip', async () => {
        // Keeps the adapter from smuggling the secret out a second time under
        // another name, which the three assertions above would not notice.
        const req = await capture(
          ok({ success: true }),
          CAPTCHA_CONTRACT_REMOTEIP
        )
        expect([...captchaFields(req).keys()].sort()).toEqual([
          'remoteip',
          'response',
          'secret'
        ])
      })

      it('still transmits the credentials in their own fields when the provider rejects the token', async () => {
        // A failing verification must be a real round trip, not a short circuit.
        const fields = captchaFields(await capture(ok({ success: false })))
        expect(fields.get('secret')).toBe(CAPTCHA_CONTRACT_SECRET)
        expect(fields.get('response')).toBe(CAPTCHA_CONTRACT_TOKEN)
      })
    })
  })
}
