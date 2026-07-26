import { describe, it, expect } from 'vitest'
import {
  MAX_FORWARDED_HOPS,
  parseForwardedHeader,
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

  // KILL-SHOT TARGET for the hop cap. The timing assertion above does NOT discriminate — walking
  // 5,000 array entries is microseconds with or without the cap, so it stays green when the cap is
  // deleted. This puts the only usable hop just BEYOND the cap: with the cap the walk gives up and
  // keys on the proxy, without it the walk reaches the address.
  it('gives up rather than walking past the hop cap (x-forwarded-for)', () => {
    const beyond = [
      '203.0.113.7',
      ...Array.from({ length: MAX_FORWARDED_HOPS }, () => '198.51.100.1')
    ]
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': beyond.join(', ') }
        }),
        trust
      )
    ).toBe('198.51.100.1')
    // One proxy hop shorter — so the address now sits INSIDE the cap — and it IS found, which is
    // what proves the test above is about the cut rather than about the address being unusable.
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { 'x-forwarded-for': beyond.slice(0, -1).join(', ') }
        }),
        trust
      )
    ).toBe('203.0.113.7')
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

// #934 — the RFC 7239 standard header. A deployment whose front sets only `Forwarded` used to
// resolve every request to the proxy's own socket address, collapsing all callers into one bucket.
// That failed CLOSED (over-limiting, never bypassable), so this is a DX gap rather than an
// exposure — but it silently degraded per-IP limiting on a standards-compliant setup.
//
// `Forwarded` is a hop list, so it rides the SAME level-2 declaration and the SAME right-to-left
// walk and hop cap as `x-forwarded-for`. It deliberately does NOT ride the level-3 single-valued
// opt-in, which exists precisely because a single value has no append structure to make a
// right-walk safe.
describe('parseForwardedHeader — the RFC 7239 grammar (#934)', () => {
  it('reads a plain node identifier and ignores the other parameters', () => {
    expect(
      parseForwardedHeader('for=192.0.2.60;proto=http;by=203.0.113.43')
    ).toEqual(['192.0.2.60'])
  })

  it('reads a comma-separated hop list in order', () => {
    expect(parseForwardedHeader('for=192.0.2.43, for=198.51.100.17')).toEqual([
      '192.0.2.43',
      '198.51.100.17'
    ])
  })

  it('parameter names are case-insensitive, per the RFC', () => {
    expect(parseForwardedHeader('For=192.0.2.60')).toEqual(['192.0.2.60'])
    expect(parseForwardedHeader('BY=1.1.1.1;FOR=192.0.2.60')).toEqual([
      '192.0.2.60'
    ])
  })

  it('unwraps a quoted value and strips a bracketed IPv6 wrapper, with or without a port', () => {
    expect(parseForwardedHeader('for="[2001:db8:cafe::17]:4711"')).toEqual([
      '2001:db8:cafe::17'
    ])
    expect(parseForwardedHeader('for="[2001:db8:cafe::17]"')).toEqual([
      '2001:db8:cafe::17'
    ])
  })

  it('strips an IPv4 port, numeric or obfuscated', () => {
    expect(parseForwardedHeader('for="192.0.2.60:1234"')).toEqual([
      '192.0.2.60'
    ])
    expect(parseForwardedHeader('for=192.0.2.60:1234')).toEqual(['192.0.2.60'])
    expect(parseForwardedHeader('for="192.0.2.60:_obfport"')).toEqual([
      '192.0.2.60'
    ])
  })

  it('leaves an unbracketed IPv6 intact instead of mistaking its last group for a port', () => {
    // Not RFC-conformant (the RFC requires brackets), but a proxy that emits it must not have its
    // address silently truncated to `2001:db8:cafe:` — that would be a WRONG bucket key, which is
    // worse than no key.
    expect(parseForwardedHeader('for=2001:db8:cafe::17')).toEqual([
      '2001:db8:cafe::17'
    ])
  })

  // THE hop-skipping requirement. `unknown` and an obfuscated `_id` are legal RFC 7239 node
  // identifiers that name no address at all, so they must yield "nothing here, try the next hop" —
  // never a bucket keyed on the literal string, which would put every such caller in one bucket
  // under a name that looks like an address.
  it('yields nothing for unknown, obfuscated and absent identifiers', () => {
    expect(
      parseForwardedHeader(
        'for=unknown, for=UNKNOWN, for=_hidden, for="_secret:_port", proto=https, for=, for="", for=192.0.2.60'
      )
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '192.0.2.60'
    ])
  })

  it('does not split an element on a comma or semicolon inside a quoted value', () => {
    // The realistic shape: a quoted parameter OTHER than `for` carrying a comma. A plain split
    // would tear this into three elements and lose the real hop list.
    expect(
      parseForwardedHeader('for=192.0.2.43;host="a,b;c", for=192.0.2.60')
    ).toEqual(['192.0.2.43', '192.0.2.60'])
  })

  it('unescapes a backslash-escaped quote inside a quoted value', () => {
    // `\\"` is a legal quoted-pair, so the escaped quote must not be read as closing the string —
    // otherwise this element and the next would merge. The value itself is then not address-shaped,
    // so the hop is unusable; what is being pinned is that the SPLIT survived it.
    expect(parseForwardedHeader('for="say \\"hi\\"", for=192.0.2.60')).toEqual([
      undefined,
      '192.0.2.60'
    ])
  })

  it('refuses the WHOLE header when the quotes do not balance', () => {
    // Not best-effort: an unbalanced quote is how a client merges the proxy's appended element into
    // its own, so there is no safe way to guess the boundaries. See the dedicated forgery block
    // below for why this matters.
    expect(parseForwardedHeader('for="192.0.2.60')).toEqual([])
    expect(parseForwardedHeader('for=192.0.2.60;host="x, for=1.1.1.1')).toEqual(
      []
    )
  })

  it('yields nothing for a value that is not address-shaped', () => {
    expect(
      parseForwardedHeader('for=hello, for="a b", for=192.0.2.999, for=1.2.3.4')
    ).toEqual([undefined, undefined, undefined, '1.2.3.4'])
  })

  it('an empty or absent header is an empty hop list', () => {
    expect(parseForwardedHeader('')).toEqual([])
    expect(parseForwardedHeader(undefined)).toEqual([])
    expect(parseForwardedHeader('   ')).toEqual([])
  })
})

describe('resolveClientIp — Forwarded rides the SAME level-2 declaration (#934)', () => {
  const trust = { proxies: ['198.51.100.1'] }

  // KILL-SHOT TARGET. Move the Forwarded read outside the `trust.proxies.includes(socket)` gate
  // and this fails: five forged headers mint five buckets under the zero-config default.
  it('a forged Forwarded cannot change the key when no proxy is declared', () => {
    const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'].map(
      (f) =>
        resolveClientIp(
          req({ socketIp: '203.0.113.9', headers: { forwarded: `for=${f}` } }),
          NONE
        )
    )
    expect(new Set(forged)).toEqual(new Set(['203.0.113.9']))
  })

  it('a forged Forwarded through an UNdeclared proxy address cannot change the key either', () => {
    expect(
      resolveClientIp(
        req({ socketIp: '203.0.113.9', headers: { forwarded: 'for=1.2.3.4' } }),
        trust
      )
    ).toBe('203.0.113.9')
  })

  it('reads Forwarded once the socket peer IS a declared proxy', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { forwarded: 'for=192.0.2.60;proto=https' }
        }),
        trust
      )
    ).toBe('192.0.2.60')
  })

  it('separates genuinely distinct Forwarded-reported clients — the DX gap this closes', () => {
    const keys = ['192.0.2.60', '192.0.2.61'].map((ip) =>
      resolveClientIp(
        req({ socketIp: '198.51.100.1', headers: { forwarded: `for=${ip}` } }),
        trust
      )
    )
    expect(keys).toEqual(['192.0.2.60', '192.0.2.61'])
  })

  it('takes the RIGHTMOST non-proxy hop here too — a client can prepend to Forwarded as well', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            forwarded: 'for=9.9.9.9, for=192.0.2.60, for=198.51.100.2'
          }
        }),
        { proxies: ['198.51.100.1', '198.51.100.2'] }
      )
    ).toBe('192.0.2.60')
  })

  it('skips an unknown or obfuscated rightmost hop instead of keying a bucket on the literal', () => {
    for (const tail of ['unknown', '_hidden']) {
      expect(
        resolveClientIp(
          req({
            socketIp: '198.51.100.1',
            headers: { forwarded: `for=192.0.2.60, for=${tail}` }
          }),
          trust
        ),
        tail
      ).toBe('192.0.2.60')
    }
  })

  it('falls back to the proxy — never to the literal — when EVERY hop is unusable', () => {
    const key = resolveClientIp(
      req({
        socketIp: '198.51.100.1',
        headers: { forwarded: 'for=unknown, for=_hidden' }
      }),
      trust
    )
    expect(key).toBe('198.51.100.1')
    expect(key).not.toBe('unknown')
  })

  it('normalizes an IPv4-mapped address inside Forwarded to the same bucket as its plain form', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { forwarded: 'for="[::ffff:192.0.2.60]"' }
        }),
        trust
      )
    ).toBe('192.0.2.60')
  })

  it('bounds how much of a hostile Forwarded it walks', () => {
    const hops = Array.from(
      { length: 5_000 },
      (_, i) => `for=10.0.0.${i % 255}`
    )
    const t0 = performance.now()
    const ip = resolveClientIp(
      req({
        socketIp: '198.51.100.1',
        headers: { forwarded: hops.join(', ') }
      }),
      trust
    )
    expect(performance.now() - t0).toBeLessThan(200)
    expect(typeof ip).toBe('string')
  })

  // The same discriminating shape as the x-forwarded-for cap test — the walk is shared, so it has
  // to be pinned for both entry points or one of them could lose the cap silently.
  it('gives up rather than walking past the hop cap (Forwarded)', () => {
    const beyond = [
      'for=203.0.113.7',
      ...Array.from({ length: MAX_FORWARDED_HOPS }, () => 'for=198.51.100.1')
    ]
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { forwarded: beyond.join(', ') }
        }),
        trust
      )
    ).toBe('198.51.100.1')
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: { forwarded: beyond.slice(0, -1).join(', ') }
        }),
        trust
      )
    ).toBe('203.0.113.7')
  })
})

// PRECEDENCE, pinned deliberately. Both headers are hop lists gated on the same declaration, so
// neither is more trustworthy than the other — this is a tie-break, not a security ranking.
// `x-forwarded-for` wins for CONTINUITY: it is what every mainstream proxy and CDN sets by default,
// it is what every deployment working today is already keyed on, and it is what an operator
// debugging their own buckets has been reasoning about. Reversing it would silently re-key live
// deployments that send both.
describe('resolveClientIp — precedence when both hop-list headers are present (#934)', () => {
  const trust = { proxies: ['198.51.100.1'] }

  it('x-forwarded-for wins over Forwarded', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'x-forwarded-for': '192.0.2.60',
            forwarded: 'for=203.0.113.7'
          }
        }),
        trust
      )
    ).toBe('192.0.2.60')
  })

  it('but Forwarded IS consulted when x-forwarded-for yields no usable hop', () => {
    // An all-proxy or blank chain is not an answer, so falling through costs nothing and rescues
    // the exact deployment #934 is about.
    for (const xff of [' , ', '198.51.100.2']) {
      expect(
        resolveClientIp(
          req({
            socketIp: '198.51.100.1',
            headers: { 'x-forwarded-for': xff, forwarded: 'for=203.0.113.7' }
          }),
          { proxies: ['198.51.100.1', '198.51.100.2'] }
        ),
        xff
      ).toBe('203.0.113.7')
    }
  })

  it('a declared single-valued header (level 3) still beats both', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '192.0.2.60',
            forwarded: 'for=203.0.113.7'
          }
        }),
        { proxies: ['198.51.100.1'], header: 'cf-connecting-ip' }
      )
    ).toBe('1.2.3.4')
  })

  it('declaring `forwarded` as the single-valued header is a no-op, not a second read', () => {
    // Level 3 is documented as being for SINGLE-VALUED headers only. `Forwarded` is a hop list, so
    // believing it wholesale would hand a client the whole value — the same hole #933 closed for
    // `x-forwarded-for`. The right-walk below still resolves it.
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            forwarded: 'for=9.9.9.9, for=192.0.2.60, for=198.51.100.1'
          }
        }),
        { proxies: ['198.51.100.1'], header: 'forwarded' }
      )
    ).toBe('192.0.2.60')
  })
})

/**
 * A hole found while implementing #934, in the implementation's own first draft — worth a named
 * block because the shape is not obvious and nothing else in the suite would have caught it.
 *
 * `Forwarded` needs a quote-aware split (a legal quoted value may contain `,` and `;`), and every
 * mainstream proxy APPENDS its element — which is the entire reason the right-walk is safe: the
 * client's own text can only ever sit to the LEFT of the hop the proxy added. A quote-aware split
 * hands the client a way to break that: send a value with an UNBALANCED quote and the proxy's
 * appended element gets swallowed into the client's element, so the walk never sees it and the
 * client dictates the key — a fresh rate-limit bucket per request through one `curl -H` flag,
 * exactly the hole #933 closed for single-valued headers.
 *
 * Two independent guards, and each of these cases needs both to be present:
 *  1. unbalanced quotes ⇒ refuse the WHOLE header (a well-formed one is always balanced, and once
 *     a client's malformed value has been appended to there is no way to know the boundaries);
 *  2. a node identifier must LOOK like an address, so a merged or garbage value can never become a
 *     bucket key even if it somehow reaches the walk.
 */
describe('resolveClientIp — a client cannot merge away the proxy’s Forwarded hop (#934)', () => {
  const trust = { proxies: ['198.51.100.1'] }
  /** What the wire looks like after a proxy appends its own element to a client-supplied value. */
  const throughProxy = (clientPart: string, realClient: string) =>
    resolveClientIp(
      req({
        socketIp: '198.51.100.1',
        headers: { forwarded: `${clientPart}, for=${realClient}` }
      }),
      trust
    )

  // KILL-SHOT TARGET for guard 1. The unbalanced quote is in a NON-`for` parameter, so the client's
  // own `for=` is a perfectly valid address — only the swallowing is malicious.
  it('an unbalanced quote in another parameter cannot hide the appended hop', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].map((forged) =>
      throughProxy(`for=${forged};host="x`, '203.0.113.9')
    )
    // One bucket, and NOT one the client chose. The whole header is refused, so this falls back to
    // the declared proxy's own address.
    expect(new Set(keys)).toEqual(new Set(['198.51.100.1']))
  })

  it('an unbalanced quote in the for= value cannot hide it either', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((forged) =>
      throughProxy(`for="${forged}`, '203.0.113.9')
    )
    expect(new Set(keys)).toEqual(new Set(['198.51.100.1']))
  })

  // KILL-SHOT TARGET for guard 2. Nothing that is not address-shaped may key a bucket, however it
  // got there: a client varying opaque text would otherwise mint quota per request.
  it('refuses a node identifier that is not address-shaped rather than keying a bucket on it', () => {
    for (const junk of [
      'for=hello',
      'for="a,b"',
      'for=192.0.2.60;for=hello',
      'for=$(whoami)',
      'for="192.0.2.60 "'
    ]) {
      expect(
        resolveClientIp(
          req({ socketIp: '198.51.100.1', headers: { forwarded: junk } }),
          trust
        ),
        junk
      ).toBe('198.51.100.1')
    }
  })

  it('still accepts the well-formed header a real proxy sends, quoted parameters and all', () => {
    expect(
      resolveClientIp(
        req({
          socketIp: '198.51.100.1',
          headers: {
            forwarded:
              'for=192.0.2.43;host="a,b";proto=https, for=203.0.113.9;proto=https'
          }
        }),
        trust
      )
    ).toBe('203.0.113.9')
  })
})
