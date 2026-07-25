import { describe, it, expect } from 'vitest'
import {
  resolveClientIp,
  parseTrustedProxies,
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

describe('resolveClientIp — the trust model (#918)', () => {
  it('DEFAULT: keys on the socket peer and ignores forwarded headers entirely', () => {
    const ip = resolveClientIp(
      req({
        socketIp: '203.0.113.9',
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'cf-connecting-ip': '5.6.7.8'
        }
      }),
      []
    )
    expect(ip).toBe('203.0.113.9')
  })

  it('a forged x-forwarded-for cannot change the key when no proxy is declared', () => {
    const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((f) =>
      resolveClientIp(
        req({ socketIp: '203.0.113.9', headers: { 'x-forwarded-for': f } }),
        []
      )
    )
    expect(new Set(forged)).toEqual(new Set(['203.0.113.9']))
  })

  it('a forged cf-connecting-ip cannot change the key when no proxy is declared', () => {
    const forged = ['1.1.1.1', '2.2.2.2'].map((f) =>
      resolveClientIp(
        req({ socketIp: '203.0.113.9', headers: { 'cf-connecting-ip': f } }),
        []
      )
    )
    expect(new Set(forged)).toEqual(new Set(['203.0.113.9']))
  })

  it('believes cf-connecting-ip ONLY when the socket peer is a declared proxy', () => {
    const trusted = ['198.51.100.1']
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'cf-connecting-ip': '1.2.3.4' }
        }),
        trusted
      )
    ).toBe('1.2.3.4')
    // Same header, a peer that is NOT the declared proxy → header ignored.
    expect(
      resolveClientIp(
        req({
          socketIp: '203.0.113.9',
          headers: { 'cf-connecting-ip': '1.2.3.4' }
        }),
        trusted
      )
    ).toBe('203.0.113.9')
  })

  it('takes the RIGHTMOST non-proxy hop of x-forwarded-for, not the client-controlled left', () => {
    // A client can prepend anything; only the entries a trusted proxy appended are meaningful,
    // so walk from the right and stop at the first hop that is not itself declared as a proxy.
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'x-forwarded-for': '9.9.9.9, 1.2.3.4, 198.51.100.2'
          }
        }),
        ['198.51.100.1', '198.51.100.2']
      )
    ).toBe('1.2.3.4')
  })

  it('prefers cf-connecting-ip over x-forwarded-for behind a declared proxy', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '9.9.9.9'
          }
        }),
        ['198.51.100.1']
      )
    ).toBe('1.2.3.4')
  })

  it('falls back to the proxy itself when it forwarded nothing usable', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': ' , ' }
        }),
        ['198.51.100.1']
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
        ['198.51.100.1', '198.51.100.2']
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
      ['198.51.100.1']
    )
    expect(performance.now() - t0).toBeLessThan(200)
    expect(typeof ip).toBe('string')
  })

  it('returns undefined when the topology exposes no socket peer — the caller must fail closed', () => {
    expect(
      resolveClientIp(req({ headers: { 'x-forwarded-for': '1.2.3.4' } }), [
        '198.51.100.1'
      ])
    ).toBeUndefined()
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
          headers: { 'cf-connecting-ip': '1.2.3.4' }
        }),
        parseTrustedProxies('198.51.100.1')
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

describe('UNRESOLVED_IP_KEY', () => {
  it('is a constant the limiter can key on so "no IP" means ONE shared bucket, not no bucket', () => {
    expect(typeof UNRESOLVED_IP_KEY).toBe('string')
    expect(UNRESOLVED_IP_KEY.length).toBeGreaterThan(0)
  })
})
