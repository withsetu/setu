import { describe, it, expect } from 'vitest'
import { createHttpSubmissionAdapter, SubmissionApiError } from '../src/index'

/** A fetch that answers every request with one canned status + body. */
const canned =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })

const adapter = (status: number, body: unknown) =>
  createHttpSubmissionAdapter({
    baseUrl: 'http://x',
    fetchImpl: canned(status, body)
  })

// #899: every non-2xx used to collapse into `Error('forms api <status>')`, throwing
// away the `{ error: 'forbidden' | 'invalid' | 'too_large' }` reason apps/api/src/forms.ts
// sends — so the admin could not tell "you may not do this" from "that payload was
// rejected". Same shape as #870's MediaTransportError.
describe('SubmissionApiError', () => {
  it('carries the status and the API reason for a 403', async () => {
    const err = await adapter(403, { error: 'forbidden' })
      .listSubmissions()
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SubmissionApiError)
    const e = err as SubmissionApiError
    expect(e.status).toBe(403)
    expect(e.code).toBe('forbidden')
    expect(e.message).toContain('forbidden')
  })

  it('distinguishes a 400 invalid from a 403 forbidden', async () => {
    const invalid = (await adapter(400, { error: 'invalid' })
      .listSubmissions()
      .catch((e: unknown) => e)) as SubmissionApiError
    const forbidden = (await adapter(403, { error: 'forbidden' })
      .listSubmissions()
      .catch((e: unknown) => e)) as SubmissionApiError

    expect(invalid.code).not.toBe(forbidden.code)
    expect(invalid.message).not.toBe(forbidden.message)
  })

  it('still throws with the status when the body carries no reason', async () => {
    const err = (await adapter(500, {})
      .listSubmissions()
      .catch((e: unknown) => e)) as SubmissionApiError

    expect(err).toBeInstanceOf(SubmissionApiError)
    expect(err.status).toBe(500)
    expect(err.code).toBeUndefined()
    expect(err.message).toContain('500')
  })

  it('survives a non-JSON error body without masking the failure', async () => {
    const html = (async () =>
      new Response('<html>gateway</html>', { status: 502 })) as typeof fetch
    const err = (await createHttpSubmissionAdapter({
      baseUrl: 'http://x',
      fetchImpl: html
    })
      .listSubmissions()
      .catch((e: unknown) => e)) as SubmissionApiError

    expect(err).toBeInstanceOf(SubmissionApiError)
    expect(err.status).toBe(502)
  })

  it('reports the reason on a write path too (deleteSubmissions)', async () => {
    const err = (await adapter(403, { error: 'forbidden' })
      .deleteSubmissions(['a'])
      .catch((e: unknown) => e)) as SubmissionApiError

    expect(err).toBeInstanceOf(SubmissionApiError)
    expect(err.code).toBe('forbidden')
  })
})
