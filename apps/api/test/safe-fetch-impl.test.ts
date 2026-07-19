import { describe, expect, it, vi } from 'vitest'
import { SafeFetchError } from '@setu/core'
import { createSafeFetchImpl } from '../src/net'

/** A transport stub that replays a scripted list of responses, recording the URLs it was
 *  asked for — so a test can assert not just the thrown error but that the dangerous hop
 *  was never actually requested. */
function scriptedTransport(responses: Response[]) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL) => {
    calls.push(String(input))
    const next = responses.shift()
    if (!next) throw new Error(`unexpected extra fetch: ${String(input)}`)
    return next
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } })

const ALLOW = ['provider.example'] as const
const resolveHost = async () => ['93.184.216.34']

const make = (
  transport: typeof fetch,
  extra: { maxBytes?: number } = {}
): typeof fetch =>
  createSafeFetchImpl({
    transport,
    allowHosts: ALLOW,
    resolveHost,
    ...extra
  })

describe('createSafeFetchImpl — SSRF guard adapter (#626)', () => {
  it('refuses a redirect to a cloud-metadata address and never fetches it', async () => {
    // https so the assertion pins the ADDRESS-range check, not the (also-blocking) scheme check.
    const { fetchImpl, calls } = scriptedTransport([
      redirect('https://169.254.169.254/latest/meta-data/')
    ])
    const safe = make(fetchImpl)
    await expect(safe('https://provider.example/oembed')).rejects.toMatchObject(
      { name: 'SafeFetchError', reason: 'private-address' }
    )
    expect(calls).toEqual(['https://provider.example/oembed'])
  })

  it('refuses a plain-http redirect (scheme downgrade)', async () => {
    const { fetchImpl } = scriptedTransport([
      redirect('http://169.254.169.254/latest/meta-data/')
    ])
    await expect(
      make(fetchImpl)('https://provider.example/oembed')
    ).rejects.toMatchObject({ reason: 'scheme' })
  })

  it('refuses a redirect to a loopback address', async () => {
    const { fetchImpl, calls } = scriptedTransport([
      redirect('https://127.0.0.1:9200/_cluster/health')
    ])
    await expect(
      make(fetchImpl)('https://provider.example/oembed')
    ).rejects.toMatchObject({ reason: 'private-address' })
    expect(calls).toHaveLength(1)
  })

  it('refuses a redirect to a host outside the allowlist', async () => {
    const { fetchImpl, calls } = scriptedTransport([
      redirect('https://evil.example/steal')
    ])
    await expect(
      make(fetchImpl)('https://provider.example/oembed')
    ).rejects.toMatchObject({ reason: 'host-not-allowed' })
    expect(calls).toHaveLength(1)
  })

  it('rejects an oversized body BEFORE buffering it (Content-Length pre-check)', async () => {
    const { fetchImpl } = scriptedTransport([
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(10_000_000) }
      })
    ])
    await expect(
      make(fetchImpl, { maxBytes: 1024 })('https://provider.example/oembed')
    ).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('caps a chunked body with no Content-Length while streaming', async () => {
    const chunk = new Uint8Array(4096)
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(chunk)
      }
    })
    const { fetchImpl } = scriptedTransport([
      new Response(stream, { status: 200 })
    ])
    await expect(
      make(fetchImpl, { maxBytes: 1024 })('https://provider.example/oembed')
    ).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('blocks a hostname whose DNS answer is a private address', async () => {
    const { fetchImpl, calls } = scriptedTransport([])
    const safe = createSafeFetchImpl({
      transport: fetchImpl,
      allowHosts: ALLOW,
      resolveHost: async () => ['10.0.0.5']
    })
    await expect(
      safe('https://provider.example/oembed')
    ).rejects.toBeInstanceOf(SafeFetchError)
    expect(calls).toEqual([])
  })

  it('passes a clean response through as a Response (status, headers, body)', async () => {
    const { fetchImpl } = scriptedTransport([
      new Response(JSON.stringify({ type: 'video' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ])
    const res = await make(fetchImpl)('https://provider.example/oembed')
    expect(res.status).toBe(200)
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ type: 'video' })
  })

  it('follows an allowed same-host redirect', async () => {
    const { fetchImpl, calls } = scriptedTransport([
      redirect('https://provider.example/oembed?v=2'),
      new Response(JSON.stringify({ type: 'rich' }), { status: 200 })
    ])
    const res = await make(fetchImpl)('https://provider.example/oembed')
    expect(await res.json()).toEqual({ type: 'rich' })
    expect(calls).toHaveLength(2)
  })

  it('reports a non-2xx upstream status without throwing', async () => {
    const { fetchImpl } = scriptedTransport([
      new Response('nope', { status: 404 })
    ])
    const res = await make(fetchImpl)('https://provider.example/oembed')
    expect(res.status).toBe(404)
    expect(res.ok).toBe(false)
  })
})
