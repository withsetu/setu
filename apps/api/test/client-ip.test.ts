import { describe, it, expect } from 'vitest'
import {
  resolveClientIp,
  parseTrustedProxies,
  parseTrustedProxyHeader,
  normalizeIp,
  UNRESOLVED_IP_KEY
} from '../src/client-ip'

const req = (opts: {
  socketIp?: string | undefined
  headers?: Record<string, string>
}) => ({
  socketIp: opts.socketIp,
  header: (name: string) => opts.headers?.[name.toLowerCase()]
})

/** Level 1 — nothing declared. */
const NONE = { proxies: [] as string[] }

describe('resolveClientIp — level 1, the header-blind default (#918)', () => {
  it('keys on the socket peer and ignores forwarded headers entirely', () => {
    const ip = resolveClientIp(
      req({
        socketIp: '203.0.113.9',
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'cf-connecting-ip': '5.6.7.8',
          'x-real-ip': '9.9.9.9'
        }
      }),
      NONE
    )
    expect(ip).toBe('203.0.113.9')
  })

  it('a forged x-forwarded-for cannot change the key when no proxy is declared', () => {
    const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((f) =>
      resolveClientIp(
        req({ socketIp: '203.0.113.9', headers: { 'x-forwarded-for': f } }),
        NONE
      )
    )
    expect(new Set(forged)).toEqual(new Set(['203.0.113.9']))
  })

  it('a forged cf-connecting-ip cannot change the key when no proxy is declared', () => {
    const forged = ['1.1.1.1', '2.2.2.2'].map((f) =>
      resolveClientIp(
        req({ socketIp: '203.0.113.9', headers: { 'cf-connecting-ip': f } }),
        NONE
      )
    )
    expect(new Set(forged)).toEqual(new Set(['203.0.113.9']))
  })

  it('returns undefined when the topology exposes no socket peer — the caller must fail closed', () => {
    expect(
      resolveClientIp(req({ headers: { 'x-forwarded-for': '1.2.3.4' } }), {
        proxies: ['198.51.100.1']
      })
    ).toBeUndefined()
  })
})

describe('resolveClientIp — level 2, SETU_TRUSTED_PROXIES (#918)', () => {
  const trust = { proxies: ['198.51.100.1'] }

  it('reads x-forwarded-for once the socket peer is a declared proxy', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': '1.2.3.4' }
        }),
        trust
      )
    ).toBe('1.2.3.4')
  })

  it('takes the RIGHTMOST non-proxy hop, not the client-controlled left', () => {
    // A client can prepend anything; only the entries a trusted proxy appended are meaningful,
    // so walk from the right and stop at the first hop that is not itself declared as a proxy.
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': '9.9.9.9, 1.2.3.4, 198.51.100.2' }
        }),
        { proxies: ['198.51.100.1', '198.51.100.2'] }
      )
    ).toBe('1.2.3.4')
  })

  it('ignores the header when the peer is NOT one of the declared proxies', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '203.0.113.9',
          headers: { 'x-forwarded-for': '1.2.3.4' }
        }),
        trust
      )
    ).toBe('203.0.113.9')
  })

  it('falls back to the proxy itself when it forwarded nothing usable', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': ' , ' }
        }),
        trust
      )
    ).toBe('198.51.100.1')
  })

  it('ignores an all-proxy x-forwarded-for rather than keying on a proxy hop', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': '198.51.100.2, 198.51.100.1' }
        }),
        { proxies: ['198.51.100.1', '198.51.100.2'] }
      )
    ).toBe('198.51.100.1')
  })

  it('bounds how much of a hostile x-forwarded-for it walks', () => {
    const hops = Array.from({ length: 5_000 }, (_, i) => `10.0.0.${i % 255}`)
    const t0 = performance.now()
    const ip = resolveClientIp(
      req({
        socketIp: '198.51.100.1',
        headers: { 'x-forwarded-for': hops.join(', ') }
      }),
      trust
    )
    expect(performance.now() - t0).toBeLessThan(200)
    expect(typeof ip).toBe('string')
  })
})

// THE review finding (PR #933, F1). A generic reverse proxy forwards unknown request headers
// verbatim, so declaring the proxy's ADDRESS must not by itself make a single-valued header
// believable — otherwise the very env var an operator adds to get working per-IP limiting hands
// every caller a fresh bucket per request via one extra `curl -H` flag.
describe('resolveClientIp — SETU_TRUSTED_PROXIES alone does NOT make a single-valued header believable (#918)', () => {
  const nginxFront = { proxies: ['127.0.0.1'] } // a declared, NON-Cloudflare front proxy

  it('a forged cf-connecting-ip through a DECLARED non-Cloudflare proxy cannot mint fresh quota', () => {
    // The proxy sets a correct x-forwarded-for; the attacker adds cf-connecting-ip per request.
    const keys = ['9.9.9.1', '9.9.9.2', '9.9.9.3', '9.9.9.4', '9.9.9.5'].map(
      (forged) =>
        resolveClientIp(
          req({
            socketIp: '127.0.0.1',
            headers: {
              'x-forwarded-for': '203.0.113.7',
              'cf-connecting-ip': forged
            }
          }),
          nginxFront
        )
    )
    // One bucket — the real client the proxy reported — not five.
    expect(new Set(keys)).toEqual(new Set(['203.0.113.7']))
  })

  it('ignores a forged x-real-ip through a declared proxy for the same reason', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '127.0.0.1',
          headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '9.9.9.9' }
        }),
        nginxFront
      )
    ).toBe('203.0.113.7')
  })

  it('a forged cf-connecting-ip cannot even substitute for an ABSENT x-forwarded-for', () => {
    // The nastier shape: no chain to fall back on, so a believed header would be the whole key.
    const keys = ['9.9.9.1', '9.9.9.2', '9.9.9.3'].map((forged) =>
      resolveClientIp(
        req({ socketIp: '127.0.0.1', headers: { 'cf-connecting-ip': forged } }),
        nginxFront
      )
    )
    expect(new Set(keys)).toEqual(new Set(['127.0.0.1']))
  })

  it('Cloudflare loses nothing: CF appends the visitor to x-forwarded-for, so the right-walk resolves it', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'x-forwarded-for': '203.0.113.7',
            'cf-connecting-ip': '203.0.113.7'
          }
        }),
        { proxies: ['198.51.100.1'] }
      )
    ).toBe('203.0.113.7')
  })
})

describe('resolveClientIp — level 3, SETU_TRUSTED_PROXY_HEADER (#918)', () => {
  const cf = {
    proxies: ['198.51.100.1'],
    header: 'cf-connecting-ip'
  }

  it('believes the declared header, but only from a declared proxy', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'cf-connecting-ip': '1.2.3.4' }
        }),
        cf
      )
    ).toBe('1.2.3.4')
    // Same header, a peer that is NOT the declared proxy → still ignored.
    expect(
      resolveClientIp(
        req({
          socketIp: '203.0.113.9',
          headers: { 'cf-connecting-ip': '1.2.3.4' }
        }),
        cf
      )
    ).toBe('203.0.113.9')
  })

  it('separates distinct forwarded clients once the header is declared', () => {
    const keys = ['1.2.3.4', '5.6.7.8'].map((ip) =>
      resolveClientIp(
        req({ socketIp: '198.51.100.1', headers: { 'cf-connecting-ip': ip } }),
        cf
      )
    )
    expect(keys).toEqual(['1.2.3.4', '5.6.7.8'])
  })

  it('prefers the declared header over x-forwarded-for', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '9.9.9.9'
          }
        }),
        cf
      )
    ).toBe('1.2.3.4')
  })

  it('falls back to the chain when the declared header is absent', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': '9.9.9.9' }
        }),
        cf
      )
    ).toBe('9.9.9.9')
  })

  it('fails closed to the chain when the declared header arrived merged (a comma)', () => {
    // Node joins duplicate headers with ", ": a client-supplied copy survived alongside the
    // proxy's, and there is no way to tell which is which.
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'cf-connecting-ip': '9.9.9.9, 1.2.3.4',
            'x-forwarded-for': '203.0.113.7'
          }
        }),
        cf
      )
    ).toBe('203.0.113.7')
  })

  it('declaring x-forwarded-for as the header is a no-op, not a second single-valued read', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': '9.9.9.9, 1.2.3.4, 198.51.100.1' }
        }),
        { proxies: ['198.51.100.1'], header: 'x-forwarded-for' }
      )
    ).toBe('1.2.3.4')
  })
})

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6 so the same peer is one bucket, not two', () => {
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(normalizeIp('::FFFF:203.0.113.9')).toBe('203.0.113.9')
  })

  it('lowercases and trims, and treats blank as absent', () => {
    expect(normalizeIp('  2001:DB8::1 ')).toBe('2001:db8::1')
    expect(normalizeIp('   ')).toBeUndefined()
    expect(normalizeIp(undefined)).toBeUndefined()
  })

  it('matches a mapped socket peer against a plain-IPv4 trusted-proxy entry', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '::ffff:198.51.100.1',
          headers: { 'x-forwarded-for': '1.2.3.4' }
        }),
        { proxies: parseTrustedProxies('198.51.100.1') }
      )
    ).toBe('1.2.3.4')
  })
})

describe('parseTrustedProxies', () => {
  it('splits on commas and whitespace, normalizes, and drops blanks', () => {
    expect(
      parseTrustedProxies(' 198.51.100.1, ::FFFF:10.0.0.1 ,, 10.0.0.2 ')
    ).toEqual(['198.51.100.1', '10.0.0.1', '10.0.0.2'])
  })

  it('an unset or blank value declares NO proxies (headers stay untrusted)', () => {
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies('   ')).toEqual([])
  })
})

describe('parseTrustedProxyHeader', () => {
  it('normalizes a declared header name', () => {
    expect(parseTrustedProxyHeader(' CF-Connecting-IP ')).toBe(
      'cf-connecting-ip'
    )
    expect(parseTrustedProxyHeader('x-real-ip')).toBe('x-real-ip')
  })

  it('unset or blank declares none, leaving the safer x-forwarded-for-only behaviour', () => {
    expect(parseTrustedProxyHeader(undefined)).toBeUndefined()
    expect(parseTrustedProxyHeader('  ')).toBeUndefined()
  })

  it('rejects anything that is not a single legal header name', () => {
    for (const bad of [
      'cf-connecting-ip, x-real-ip',
      'x real ip',
      'x-real-ip:',
      'a/b'
    ]) {
      expect(parseTrustedProxyHeader(bad), bad).toBeUndefined()
    }
  })
})

describe('UNRESOLVED_IP_KEY', () => {
  it('is a constant the limiter can key on so "no IP" means ONE shared bucket, not no bucket', () => {
    expect(typeof UNRESOLVED_IP_KEY).toBe('string')
    expect(UNRESOLVED_IP_KEY.length).toBeGreaterThan(0)
  })
})
