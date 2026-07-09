import { describe, it, expect, vi } from 'vitest'
import { safeFetch, SafeFetchError } from '../../src/net/safe-fetch'

/** A fetchImpl stub that records calls and returns scripted responses. */
function stubFetch(
  ...responses: Array<{
    status?: number
    headers?: Record<string, string>
    body?: string
  }>
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const impl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const script = responses[Math.min(calls.length - 1, responses.length - 1)]
    const status = script?.status ?? 200
    // 204/205/304 are null-body statuses — the Response constructor rejects a body.
    const body = [204, 205, 304].includes(status)
      ? null
      : (script?.body ?? 'ok')
    return new Response(body, { status, headers: script?.headers ?? {} })
  }) as unknown as typeof fetch
  return { impl, calls }
}

const expectBlocked = async (
  p: Promise<unknown>,
  reason: SafeFetchError['reason']
) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(SafeFetchError)
  expect((err as SafeFetchError).reason).toBe(reason)
}

describe('safeFetch — scheme and URL shape', () => {
  it('allows https and returns status, headers, and body text', async () => {
    const { impl } = stubFetch({
      status: 200,
      headers: { 'x-probe': 'yes' },
      body: 'hello'
    })
    const res = await safeFetch('https://example.com/page', undefined, {
      fetchImpl: impl
    })
    expect(res.status).toBe(200)
    expect(res.ok).toBe(true)
    expect(res.headers.get('x-probe')).toBe('yes')
    expect(res.text()).toBe('hello')
    expect(res.finalUrl).toBe('https://example.com/page')
  })

  it('blocks http by default', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('http://example.com/', undefined, { fetchImpl: impl }),
      'scheme'
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('allows http when allowHttp is set (dev opt-in)', async () => {
    const { impl } = stubFetch()
    const res = await safeFetch('http://example.com/', undefined, {
      fetchImpl: impl,
      allowHttp: true
    })
    expect(res.status).toBe(200)
  })

  it('blocks non-http(s) schemes outright', async () => {
    const { impl } = stubFetch()
    for (const url of ['ftp://example.com/', 'file:///etc/passwd']) {
      await expectBlocked(
        safeFetch(url, undefined, { fetchImpl: impl }),
        'scheme'
      )
    }
  })

  it('blocks URLs carrying credentials', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('https://user:pass@example.com/', undefined, {
        fetchImpl: impl
      }),
      'credentials'
    )
  })

  it('rejects unparseable URLs', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('not a url', undefined, { fetchImpl: impl }),
      'invalid-url'
    )
  })
})

describe('safeFetch — private / internal address blocking', () => {
  const blockedHosts = [
    'localhost',
    'sub.localhost',
    // IPv4 loopback / private / link-local / metadata / special
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.5.5',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '100.64.1.1', // CGNAT
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '255.255.255.255',
    // IPv6 loopback / unspecified / ULA / link-local / multicast
    '[::1]',
    '[::]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[ff02::1]',
    // IPv4-mapped and NAT64 forms embedding private v4
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::ffff:192.168.1.1]',
    '[64:ff9b::7f00:1]'
  ]

  for (const host of blockedHosts) {
    it(`blocks https://${host}/`, async () => {
      const { impl } = stubFetch()
      await expectBlocked(
        safeFetch(`https://${host}/`, undefined, { fetchImpl: impl }),
        'private-address'
      )
      expect(impl).not.toHaveBeenCalled()
    })
  }

  it('allows public literal IPv4 and IPv6 hosts', async () => {
    const { impl } = stubFetch()
    const v4 = await safeFetch('https://93.184.216.34/', undefined, {
      fetchImpl: impl
    })
    expect(v4.status).toBe(200)
    const v6 = await safeFetch('https://[2606:4700::1]/', undefined, {
      fetchImpl: impl
    })
    expect(v6.status).toBe(200)
  })

  it('blocks IPv4-mapped IPv6 of a public address only when the embedded v4 is private', async () => {
    const { impl } = stubFetch()
    const res = await safeFetch('https://[::ffff:5db8:d822]/', undefined, {
      fetchImpl: impl
    }) // ::ffff:93.184.216.34
    expect(res.status).toBe(200)
  })
})

describe('safeFetch — host allowlist', () => {
  it('passes an allowlisted host (case-insensitive) and blocks others', async () => {
    const { impl } = stubFetch()
    const res = await safeFetch('https://API.Example.COM/x', undefined, {
      fetchImpl: impl,
      allowHosts: ['api.example.com']
    })
    expect(res.status).toBe(200)
    await expectBlocked(
      safeFetch('https://evil.com/x', undefined, {
        fetchImpl: impl,
        allowHosts: ['api.example.com']
      }),
      'host-not-allowed'
    )
  })
})

describe('safeFetch — DNS resolution pre-check (resolveHost seam)', () => {
  it('blocks a hostname resolving to a private address', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('https://internal.example.com/', undefined, {
        fetchImpl: impl,
        resolveHost: async () => ['127.0.0.1']
      }),
      'private-address'
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('blocks when ANY resolved address is private', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('https://dual.example.com/', undefined, {
        fetchImpl: impl,
        resolveHost: async () => ['93.184.216.34', '10.0.0.5']
      }),
      'private-address'
    )
  })

  it('passes when all resolved addresses are public (v4 + v6 answers)', async () => {
    const { impl } = stubFetch()
    const res = await safeFetch('https://ok.example.com/', undefined, {
      fetchImpl: impl,
      resolveHost: async () => ['93.184.216.34', '2606:4700::1']
    })
    expect(res.status).toBe(200)
  })

  it('fails closed when the resolver errors or returns nothing', async () => {
    const { impl } = stubFetch()
    await expectBlocked(
      safeFetch('https://broken.example.com/', undefined, {
        fetchImpl: impl,
        resolveHost: async () => {
          throw new Error('dns down')
        }
      }),
      'resolve'
    )
    await expectBlocked(
      safeFetch('https://empty.example.com/', undefined, {
        fetchImpl: impl,
        resolveHost: async () => []
      }),
      'resolve'
    )
  })

  it('does not call the resolver for literal-IP hosts', async () => {
    const resolveHost = vi.fn(async () => ['93.184.216.34'])
    const { impl } = stubFetch()
    await safeFetch('https://93.184.216.34/', undefined, {
      fetchImpl: impl,
      resolveHost
    })
    expect(resolveHost).not.toHaveBeenCalled()
  })
})

describe('safeFetch — redirects (manual, every hop re-validated)', () => {
  it('follows a redirect to a public https URL and reports finalUrl', async () => {
    const { impl, calls } = stubFetch(
      { status: 301, headers: { location: 'https://cdn.example.com/real' } },
      { status: 200, body: 'moved' }
    )
    const res = await safeFetch('https://example.com/old', undefined, {
      fetchImpl: impl
    })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('moved')
    expect(res.finalUrl).toBe('https://cdn.example.com/real')
    expect(calls.map((c) => c.url)).toEqual([
      'https://example.com/old',
      'https://cdn.example.com/real'
    ])
  })

  it('resolves relative Location against the current hop', async () => {
    const { impl, calls } = stubFetch(
      { status: 302, headers: { location: '/next' } },
      { status: 200 }
    )
    await safeFetch('https://example.com/a/b', undefined, { fetchImpl: impl })
    expect(calls[1]?.url).toBe('https://example.com/next')
  })

  it('blocks a redirect to a private address', async () => {
    const { impl } = stubFetch({
      status: 302,
      headers: { location: 'https://169.254.169.254/latest/meta-data' }
    })
    await expectBlocked(
      safeFetch('https://example.com/', undefined, { fetchImpl: impl }),
      'private-address'
    )
  })

  it('blocks a redirect that downgrades to http', async () => {
    const { impl } = stubFetch({
      status: 302,
      headers: { location: 'http://example.com/' }
    })
    await expectBlocked(
      safeFetch('https://example.com/', undefined, { fetchImpl: impl }),
      'scheme'
    )
  })

  it('re-checks the allowlist and resolver on every hop', async () => {
    const { impl } = stubFetch({
      status: 302,
      headers: { location: 'https://evil.com/' }
    })
    await expectBlocked(
      safeFetch('https://api.example.com/', undefined, {
        fetchImpl: impl,
        allowHosts: ['api.example.com']
      }),
      'host-not-allowed'
    )
    const resolved: string[] = []
    const { impl: impl2 } = stubFetch(
      { status: 302, headers: { location: 'https://internal.example.com/' } },
      { status: 200 }
    )
    await expectBlocked(
      safeFetch('https://public.example.com/', undefined, {
        fetchImpl: impl2,
        resolveHost: async (host) => {
          resolved.push(host)
          return host === 'internal.example.com'
            ? ['192.168.0.10']
            : ['93.184.216.34']
        }
      }),
      'private-address'
    )
    expect(resolved).toEqual(['public.example.com', 'internal.example.com'])
  })

  it('gives up after maxRedirects hops', async () => {
    const { impl } = stubFetch({
      status: 302,
      headers: { location: 'https://example.com/loop' }
    })
    await expectBlocked(
      safeFetch('https://example.com/', undefined, {
        fetchImpl: impl,
        maxRedirects: 2
      }),
      'too-many-redirects'
    )
  })

  it('treats a 3xx without Location as a final response', async () => {
    const { impl } = stubFetch({ status: 304 })
    const res = await safeFetch('https://example.com/', undefined, {
      fetchImpl: impl
    })
    expect(res.status).toBe(304)
  })
})

describe('safeFetch — size and time limits', () => {
  it('rejects on an oversize Content-Length before reading the body', async () => {
    const { impl } = stubFetch({
      status: 200,
      headers: { 'content-length': String(10_000_000) }
    })
    await expectBlocked(
      safeFetch('https://example.com/big', undefined, {
        fetchImpl: impl,
        maxBytes: 1_000_000
      }),
      'too-large'
    )
  })

  it('rejects a body that exceeds maxBytes without a Content-Length', async () => {
    const { impl } = stubFetch({ status: 200, body: 'x'.repeat(2048) })
    await expectBlocked(
      safeFetch('https://example.com/stream', undefined, {
        fetchImpl: impl,
        maxBytes: 1024
      }),
      'too-large'
    )
  })

  it('passes a body within maxBytes', async () => {
    const { impl } = stubFetch({ status: 200, body: 'x'.repeat(512) })
    const res = await safeFetch('https://example.com/ok', undefined, {
      fetchImpl: impl,
      maxBytes: 1024
    })
    expect(res.text()).toBe('x'.repeat(512))
  })

  it('aborts a hung request after timeoutMs', async () => {
    const impl = ((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      })) as typeof fetch
    await expectBlocked(
      safeFetch('https://example.com/hang', undefined, {
        fetchImpl: impl,
        timeoutMs: 25
      }),
      'timeout'
    )
  })
})
