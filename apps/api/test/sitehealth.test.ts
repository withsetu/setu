import { describe, it, expect, vi } from 'vitest'
import type { Actor, Role, SafeFetchResult } from '@setu/core'
import { createSiteHealthApi } from '../src/sitehealth'
import type { ResolveActor } from '../src/auth/resolve-actor'

const asRole =
  (role: Role): ResolveActor =>
  () =>
    ({ id: 'u', role }) satisfies Actor
const unauthenticated: ResolveActor = () => null

const okResult = (over: Partial<SafeFetchResult> = {}): SafeFetchResult => ({
  status: 200,
  ok: true,
  headers: new Headers(),
  finalUrl: 'https://example.com/',
  body: new Uint8Array(),
  text: () => '',
  ...over
})

function make(opts?: {
  resolveActor?: ResolveActor
  siteUrl?: string
  safeFetchImpl?: typeof import('@setu/core').safeFetch
  now?: () => number
  throttleMs?: number
}) {
  return createSiteHealthApi({
    resolveActor: opts?.resolveActor ?? asRole('admin'),
    siteUrl: () => opts?.siteUrl ?? 'https://example.com',
    safeFetchImpl: opts?.safeFetchImpl ?? vi.fn(async () => okResult()),
    now: opts?.now ?? (() => 1_000_000),
    throttleMs: opts?.throttleMs ?? 60_000
  })
}

const probe = (app: ReturnType<typeof createSiteHealthApi>) =>
  app.fetch(new Request('http://x/api/sitehealth/probe', { method: 'POST' }))

describe('createSiteHealthApi — authz gate', () => {
  it('401 for an unauthenticated caller', async () => {
    const res = await probe(make({ resolveActor: unauthenticated }))
    expect(res.status).toBe(401)
  })

  it('403 for an authenticated actor lacking sitehealth.view (editor)', async () => {
    const res = await probe(make({ resolveActor: asRole('editor') }))
    expect(res.status).toBe(403)
  })

  it('allows admin and maintainer', async () => {
    expect((await probe(make({ resolveActor: asRole('admin') }))).status).toBe(
      200
    )
    expect(
      (await probe(make({ resolveActor: asRole('maintainer') }))).status
    ).toBe(200)
  })
})

describe('createSiteHealthApi — degradation (honest, never a false pass)', () => {
  it('reports unavailable with reason=no-url when the site URL is unset', async () => {
    const res = await probe(make({ siteUrl: '' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean; reason?: string }
    expect(body.available).toBe(false)
    expect(body.reason).toBe('no-url')
  })

  it('reports unavailable with the SafeFetchError reason when the probe is blocked', async () => {
    const { SafeFetchError } = await import('@setu/core')
    const safeFetchImpl = vi.fn(async () => {
      throw new SafeFetchError('private-address', 'blocked')
    }) as unknown as typeof import('@setu/core').safeFetch
    const res = await probe(make({ safeFetchImpl }))
    const body = (await res.json()) as { available: boolean; reason?: string }
    expect(body.available).toBe(false)
    expect(body.reason).toBe('private-address')
  })

  it('reports unavailable with reason=fetch-failed on a network error', async () => {
    const safeFetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof import('@setu/core').safeFetch
    const body = (await (await probe(make({ safeFetchImpl }))).json()) as {
      available: boolean
      reason?: string
    }
    expect(body.available).toBe(false)
    expect(body.reason).toBe('fetch-failed')
  })
})

describe('createSiteHealthApi — successful probe', () => {
  it('returns available results evaluated from the fetched response', async () => {
    const safeFetchImpl = vi.fn(async () =>
      okResult({
        finalUrl: 'https://example.com/',
        status: 200,
        headers: new Headers({
          'strict-transport-security': 'max-age=63072000'
        })
      })
    ) as unknown as typeof import('@setu/core').safeFetch
    const res = await probe(make({ safeFetchImpl }))
    const body = (await res.json()) as {
      available: true
      probedAt: string
      results: { id: string; status: string }[]
    }
    expect(body.available).toBe(true)
    expect(typeof body.probedAt).toBe('string')
    expect(body.results.find((r) => r.id === 'security.https')?.status).toBe(
      'pass'
    )
    expect(body.results.find((r) => r.id === 'security.hsts')?.status).toBe(
      'pass'
    )
  })

  it('passes the configured URL through safeFetch (with a resolveHost seam)', async () => {
    const safeFetchImpl = vi.fn(async () =>
      okResult()
    ) as unknown as typeof import('@setu/core').safeFetch
    await probe(make({ siteUrl: 'https://mysite.test', safeFetchImpl }))
    expect(safeFetchImpl).toHaveBeenCalledOnce()
    const call = (safeFetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(String(call?.[0])).toContain('mysite.test')
    expect(typeof call?.[2]?.resolveHost).toBe('function')
  })
})

describe('createSiteHealthApi — throttle (cost-safe)', () => {
  it('returns the cached report within the throttle window without re-fetching', async () => {
    const safeFetchImpl = vi.fn(async () =>
      okResult()
    ) as unknown as typeof import('@setu/core').safeFetch
    let t = 1_000_000
    const app = make({ safeFetchImpl, now: () => t, throttleMs: 60_000 })

    const first = (await (await probe(app)).json()) as { probedAt: string }
    t += 5_000 // still inside the window
    const second = (await (await probe(app)).json()) as { probedAt: string }

    expect(safeFetchImpl).toHaveBeenCalledOnce() // not re-fetched
    expect(second.probedAt).toBe(first.probedAt) // same cached report

    t += 60_000 // window elapsed
    await probe(app)
    expect(safeFetchImpl).toHaveBeenCalledTimes(2)
  })
})
