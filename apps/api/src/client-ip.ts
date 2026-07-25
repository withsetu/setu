/** #918: the client-IP TRUST MODEL, in one place, because getting it wrong makes every per-IP
 *  bound in the app decorative.
 *
 *  `cf-connecting-ip`, `x-real-ip` and `x-forwarded-for` are request headers. Any client can send
 *  any value in any of them — behind no proxy at all, `curl -H 'x-forwarded-for: <random>'` mints
 *  a fresh bucket per request, so a limiter keyed on a believed header bounds nothing. They are
 *  only meaningful when something in front of this server is known to OVERWRITE them, and only
 *  this deployment's operator knows whether that is true.
 *
 *  Three levels, each opting in to strictly more trust than the last:
 *
 *  1. **Default (no `SETU_TRUSTED_PROXIES`): the socket peer wins and EVERY header is ignored.**
 *     Unforgeable, because it is the TCP peer, not a claim.
 *  2. **`SETU_TRUSTED_PROXIES=<ip>[,<ip>…]`: `x-forwarded-for` becomes readable — and ONLY it —
 *     when the socket peer is one of the declared addresses.** It is walked from the RIGHT: a
 *     client can prepend anything to that list, so only the hops a trusted proxy appended mean
 *     anything, and the first right-to-left hop that is not itself a declared proxy is the real
 *     client. Every mainstream reverse proxy and CDN (nginx, Caddy, Traefik, HAProxy, ALB,
 *     Cloudflare) APPENDS to this header, which is what makes the right-walk safe by construction.
 *  3. **`SETU_TRUSTED_PROXY_HEADER=<name>`: additionally believe one named single-valued header**
 *     (`cf-connecting-ip`, `x-real-ip`, …), which only the operator can know their proxy actually
 *     SETS rather than forwards.
 *
 *  **Why level 3 is a separate opt-in and not folded into level 2** (this was a real hole, caught
 *  in review of PR #933 and fixed here): a generic reverse proxy forwards unknown request headers
 *  verbatim. So an operator who sets `SETU_TRUSTED_PROXIES=127.0.0.1` for an nginx/Caddy/Traefik
 *  front — the exact configuration added to make per-IP limiting work — would, if this module
 *  believed `cf-connecting-ip` from any declared proxy, hand every caller a fresh bucket per
 *  request via one extra `curl -H` flag. Unlike `x-forwarded-for`, a single-valued header has no
 *  append structure for a right-walk to exploit, so there is nothing to make it safe by
 *  construction — it can only be safe by declaration. Cloudflare deployments lose nothing by
 *  leaving level 3 off: Cloudflare also appends the visitor address to `x-forwarded-for`, so the
 *  level-2 right-walk already resolves it. Pinned by apps/api/test/client-ip.test.ts
 *  ("SETU_TRUSTED_PROXIES alone does NOT make a single-valued header believable").
 *
 *  **The accepted zero-config consequence:** run behind a reverse proxy or CDN *without* setting
 *  `SETU_TRUSTED_PROXIES` and every request arrives from the proxy's own address, so the whole
 *  internet collapses into ONE per-IP bucket. That is a deliberate trade, not an oversight: the
 *  failure is over-limiting (fail-closed), the fix is one env var, and layer 1 — the
 *  caller-independent notification ceiling in rate-limit.ts — is the bound that actually protects
 *  the operator's mail, so the per-IP layer is allowed to be the refinement rather than the
 *  guarantee. Same reasoning for an unresolvable peer: it keys on `UNRESOLVED_IP_KEY`, one shared
 *  bucket, never "unlimited".
 *
 *  Because that trade rests entirely on the operator NOTICING, `createFormsApi` reports the first
 *  refusal in each window through its `onSubmitLimited` seam (server.ts logs it), and names the
 *  proxy misconfiguration explicitly when no proxies are declared — see
 *  apps/api/test/forms.test.ts ("reports the first refusal in a window"). An earlier draft of this
 *  comment claimed the collapse was "loud in the api log" while nothing logged anything at all;
 *  the log line exists now, and this sentence names the test that proves it.
 *
 *  The claims in levels 1–3 above are pinned by apps/api/test/client-ip.test.ts — including the
 *  three forgery cases: a forged `x-forwarded-for` and a forged `cf-connecting-ip` under the
 *  default config, and a forged `cf-connecting-ip` through a DECLARED non-Cloudflare proxy.
 *
 *  NOTE — the captcha's `remoteip` now uses this same resolved value rather than a raw header;
 *  the reasoning, with the vendor documentation it rests on, is at its call site in
 *  apps/api/src/forms.ts. */

/** The single bucket every request whose client cannot be identified shares. Fail-closed: "no
 *  IP" must mean "one shared bound", never "no bound". */
export const UNRESOLVED_IP_KEY = '@unresolved-client-ip'

/** How many `x-forwarded-for` hops are walked before giving up. Node caps request headers at
 *  ~16 KiB, which is thousands of hops — a real chain is single digits, so this bounds the work a
 *  hostile header can cause on the unauthenticated submit path. */
const MAX_FORWARDED_HOPS = 50

/** RFC 9110 token characters — what a legal HTTP field name may contain. A declared header name
 *  that is not one is dropped rather than looked up. */
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/

/** The slice of a request this module needs. Structural so it can be driven from a Hono
 *  `Context` (`c.req.header`) or a plain object in tests, without importing hono here. */
export interface ClientIpRequest {
  header(name: string): string | undefined
  /** The raw TCP peer address, or undefined on a topology that does not expose one. */
  socketIp: string | undefined
}

/** How much this deployment has declared about what sits in front of it. */
export interface ProxyTrust {
  /** Addresses the front proxies connect FROM. Empty = header-blind (level 1). */
  proxies: readonly string[]
  /** An additional single-valued header to believe from those proxies (level 3), already
   *  normalized by `parseTrustedProxyHeader`. Undefined = `x-forwarded-for` only. */
  header?: string | undefined
}

/** Canonical form for comparison and bucket keys: trimmed, lowercased, and with the IPv4-mapped
 *  IPv6 wrapper removed so `::ffff:203.0.113.9` and `203.0.113.9` are ONE peer (Node hands the
 *  mapped form to a dual-stack listener). Blank → undefined. */
export function normalizeIp(raw: string | undefined): string | undefined {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '') return undefined
  return v.startsWith('::ffff:') ? v.slice('::ffff:'.length) : v
}

/** Parse `SETU_TRUSTED_PROXIES` — a comma- and/or whitespace-separated list of the addresses this
 *  server's own front proxies connect FROM. Unset/blank declares none, which is what keeps the
 *  zero-config default header-blind. */
export function parseTrustedProxies(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((p) => normalizeIp(p))
    .filter((p): p is string => p !== undefined)
}

/** Parse `SETU_TRUSTED_PROXY_HEADER` — the ONE extra header name this deployment declares its
 *  proxy sets (not merely forwards). Unset, blank, malformed, or more than one name → undefined,
 *  which leaves the strictly safer `x-forwarded-for`-only behaviour in force. `x-forwarded-for`
 *  itself is accepted and is a no-op, since it is already read at level 2. */
export function parseTrustedProxyHeader(
  raw: string | undefined
): string | undefined {
  const name = (raw ?? '').trim().toLowerCase()
  if (name === '' || !HEADER_NAME.test(name)) return undefined
  return name
}

/** Resolve the address a per-IP bound may key on, per the trust model documented at the top of
 *  this file. Returns undefined only when the topology exposes no socket peer at all — callers
 *  key on `UNRESOLVED_IP_KEY` in that case. */
export function resolveClientIp(
  req: ClientIpRequest,
  trust: ProxyTrust
): string | undefined {
  const socket = normalizeIp(req.socketIp)
  if (socket === undefined) return undefined
  // Level 1, the header-blind default: nothing this request CLAIMS is consulted.
  if (!trust.proxies.includes(socket)) return socket

  // Level 3: one explicitly declared single-valued header, believed ahead of the chain because
  // the operator has asserted their proxy SETS it. A comma means the value was merged from more
  // than one instance of the header (Node joins duplicates with ", "), i.e. a client-supplied
  // copy survived alongside the proxy's — unknowable which is which, so fail closed to the chain
  // rather than guess. A genuine single-valued header never contains one.
  if (trust.header !== undefined && trust.header !== 'x-forwarded-for') {
    const declared = req.header(trust.header)
    if (declared !== undefined && !declared.includes(',')) {
      const ip = normalizeIp(declared)
      if (ip !== undefined) return ip
    }
  }

  // Level 2: the append-structured chain, walked from the right.
  const forwarded = req.header('x-forwarded-for')
  if (forwarded !== undefined && forwarded !== '') {
    const hops = forwarded.split(',')
    const first = Math.max(0, hops.length - MAX_FORWARDED_HOPS)
    for (let i = hops.length - 1; i >= first; i--) {
      const hop = normalizeIp(hops[i])
      if (hop !== undefined && !trust.proxies.includes(hop)) return hop
    }
  }
  // A declared proxy that forwarded nothing usable (or only other declared proxies): key on the
  // proxy itself rather than on a value we have no reason to believe.
  return socket
}
