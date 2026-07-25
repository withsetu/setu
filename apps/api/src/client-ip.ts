/** #918: the client-IP TRUST MODEL, in one place, because getting it wrong makes every per-IP
 *  bound in the app decorative.
 *
 *  `cf-connecting-ip` and `x-forwarded-for` are request headers. Any client can send any value in
 *  them — behind no proxy at all, `curl -H 'x-forwarded-for: <random>'` mints a fresh bucket per
 *  request, so a limiter keyed on a believed header bounds nothing. They are only meaningful when
 *  something in front of this server is known to OVERWRITE them, and only this deployment's
 *  operator knows whether that is true.
 *
 *  So the rule, and it has no zero-config exception:
 *
 *  - **Default (no `SETU_TRUSTED_PROXIES`): the socket peer address wins and both headers are
 *    ignored outright.** Unforgeable, because it is the TCP peer, not a claim.
 *  - **`SETU_TRUSTED_PROXIES=<ip>[,<ip>…]`: headers are believed, but only when the socket peer
 *    is one of the declared addresses.** `cf-connecting-ip` (single-valued, set by Cloudflare)
 *    wins; otherwise `x-forwarded-for` is walked from the RIGHT — a client can prepend anything
 *    to that list, so only the hops a trusted proxy appended mean anything, and the first
 *    right-to-left hop that is not itself a declared proxy is the real client.
 *
 *  **The accepted zero-config consequence:** run behind a reverse proxy or CDN *without* setting
 *  `SETU_TRUSTED_PROXIES` and every request arrives from the proxy's own address, so the whole
 *  internet collapses into ONE per-IP bucket. That is a deliberate trade, not an oversight: the
 *  failure is over-limiting (fail-closed, and loud in the api log the moment it bites), the fix is
 *  one env var, and layer 1 — the caller-independent notification ceiling in rate-limit.ts — is
 *  the bound that actually protects the operator's mail, so the per-IP layer is allowed to be the
 *  refinement rather than the guarantee. Same reasoning for an unresolvable peer: it keys on
 *  `UNRESOLVED_IP_KEY`, one shared bucket, never "unlimited".
 *
 *  Every claim above is pinned by apps/api/test/client-ip.test.ts, including the two forgery
 *  cases (a forged `x-forwarded-for` and a forged `cf-connecting-ip` cannot change the key under
 *  the default config).
 *
 *  NOTE — the captcha's `remoteip` is a SEPARATE question and deliberately still header-derived
 *  at its call site in apps/api/src/forms.ts. See the comment there: it is advisory input to a
 *  third-party verifier that fails closed on a mismatch, so a forged value only breaks the
 *  forger's own submission. It must never be used as a limiter key. */

/** The single bucket every request whose client cannot be identified shares. Fail-closed: "no
 *  IP" must mean "one shared bound", never "no bound". */
export const UNRESOLVED_IP_KEY = '@unresolved-client-ip'

/** How many `x-forwarded-for` hops are walked before giving up. Node caps request headers at
 *  ~16 KiB, which is thousands of hops — a real chain is single digits, so this bounds the work a
 *  hostile header can cause on the unauthenticated submit path. */
const MAX_FORWARDED_HOPS = 50

/** The slice of a request this module needs. Structural so it can be driven from a Hono
 *  `Context` (`c.req.header`) or a plain object in tests, without importing hono here. */
export interface ClientIpRequest {
  header(name: string): string | undefined
  /** The raw TCP peer address, or undefined on a topology that does not expose one. */
  socketIp: string | undefined
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

/** Resolve the address a per-IP bound may key on, per the trust model documented at the top of
 *  this file. Returns undefined only when the topology exposes no socket peer at all — callers
 *  key on `UNRESOLVED_IP_KEY` in that case. */
export function resolveClientIp(
  req: ClientIpRequest,
  trustedProxies: readonly string[]
): string | undefined {
  const socket = normalizeIp(req.socketIp)
  if (socket === undefined) return undefined
  // The header-blind default: nothing this request CLAIMS is consulted.
  if (!trustedProxies.includes(socket)) return socket

  const cf = normalizeIp(req.header('cf-connecting-ip'))
  if (cf !== undefined) return cf

  const forwarded = req.header('x-forwarded-for')
  if (forwarded !== undefined && forwarded !== '') {
    const hops = forwarded.split(',')
    const first = Math.max(0, hops.length - MAX_FORWARDED_HOPS)
    for (let i = hops.length - 1; i >= first; i--) {
      const hop = normalizeIp(hops[i])
      if (hop !== undefined && !trustedProxies.includes(hop)) return hop
    }
  }
  // A declared proxy that forwarded nothing usable (or only other declared proxies): key on the
  // proxy itself rather than on a value we have no reason to believe.
  return socket
}
