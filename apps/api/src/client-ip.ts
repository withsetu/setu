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
 *  2. **`SETU_TRUSTED_PROXIES=<ip>[,<ip>…]`: the two HOP-LIST headers become readable — and only
 *     those — when the socket peer is one of the declared addresses.** Those are `x-forwarded-for`
 *     and, since #934, the RFC 7239 `Forwarded` header. Both are walked from the RIGHT: a client
 *     can prepend anything to either list, so only the hops a trusted proxy appended mean anything,
 *     and the first right-to-left hop that is not itself a declared proxy is the real client. Every
 *     mainstream reverse proxy and CDN (nginx, Caddy, Traefik, HAProxy, ALB, Cloudflare) APPENDS to
 *     these, which is what makes the right-walk safe by construction — and is also why anything
 *     that could move that append boundary (an unbalanced quote in `Forwarded`) refuses the whole
 *     header rather than guessing. `x-forwarded-for` wins when both are present; the reasoning for
 *     that tie-break is at the read site below.
 *  3. **`SETU_TRUSTED_PROXY_HEADER=<name>`: additionally believe one named single-valued header**
 *     (`cf-connecting-ip`, `x-real-ip`, …), which only the operator can know their proxy actually
 *     SETS rather than forwards. Naming either hop-list header here is a no-op: a hop list has no
 *     single value to believe, and trusting the whole string would hand a client the key.
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
 *  **#934 — why `Forwarded` had to be a THIRD structured source and not a level-3 opt-in.** Before
 *  it, a deployment whose front sets only the standard header resolved every request to the proxy's
 *  own socket address, collapsing all callers into one bucket. That failed CLOSED, so it was a DX
 *  gap rather than an exposure, but it silently degraded per-IP limiting on a standards-compliant
 *  setup. It could not ride level 3 because that level is deliberately restricted to
 *  SINGLE-VALUED headers; being a hop list, it belongs at level 2 with the same walk and cap.
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

/** How many hops are walked before giving up — for `x-forwarded-for` and `Forwarded` alike (#934).
 *  Node caps request headers at ~16 KiB, which is thousands of hops — a real chain is single
 *  digits, so this bounds the work a hostile header can cause on the unauthenticated submit path.
 *
 *  Exported so the tests can assert the CUT rather than only a wall-clock bound: a 5,000-hop timing
 *  test passes with the cap removed (walking 5,000 array entries is microseconds either way), so it
 *  reads as coverage without being any — the #638 class. What discriminates is a client that sits
 *  BEYOND the cap being refused, which apps/api/test/client-ip.test.ts pins for both headers
 *  ("gives up rather than walking past the hop cap"). */
export const MAX_FORWARDED_HOPS = 50

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

/** Split on `sep` at the TOP level only — a separator inside a `"…"` value belongs to the value,
 *  not to the grammar. RFC 7239 values may be quoted strings, and a quoted string may legally
 *  contain both `,` and `;`, so a plain `split` would tear one element into two.
 *
 *  Returns null when the quotes do not BALANCE, which the caller must treat as "refuse the whole
 *  header" — see {@link parseForwardedHeader}. Deliberately NOT a best-effort split: an unbalanced
 *  quote is how a client merges the proxy's appended element into its own. */
function splitOutsideQuotes(raw: string, sep: string): string[] | null {
  const out: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quoted && ch === '\\') {
      i++ // the escaped character cannot close the quote or separate anything
      continue
    }
    if (ch === '"') quoted = !quoted
    else if (ch === sep && !quoted) {
      out.push(raw.slice(start, i))
      start = i + 1
    }
  }
  if (quoted) return null
  out.push(raw.slice(start))
  return out
}

/** Unwrap a quoted-string value: drop the surrounding quotes and undo `\x` escapes. */
function unquote(value: string): string | undefined {
  if (!value.startsWith('"')) return value
  if (value.length < 2 || !value.endsWith('"')) return undefined
  return value.slice(1, -1).replace(/\\(.)/g, '$1')
}

/** Address SHAPE, checked before anything becomes a bucket key.
 *
 *  `x-forwarded-for` never needed this: every mainstream proxy APPENDS, so the right-walk reaches
 *  the proxy-supplied hop before any client-supplied text and returns it. `Forwarded` carries
 *  arbitrary quoted values, so an unshaped `for=` — `for=hello`, or a value merged with the rest of
 *  the header — could otherwise become the key.
 *
 *  What this does and does not do, stated narrowly because the difference matters: it NARROWS THE
 *  ALPHABET a bucket key can be built from, to IP characters. It does not by itself stop a client
 *  varying the key — `for=1:2:3` and `for=1:2:4` both pass it, exactly as two different addresses
 *  in `x-forwarded-for` would. What actually prevents per-request minting is the append ordering
 *  (the proxy's hop is always to the right of the client's text) together with the unbalanced-quote
 *  refusal that stops a client moving that boundary. This is the third line, not the first.
 *  Deliberately a shape test rather than a full IP parser. Pinned by
 *  apps/api/test/client-ip.test.ts ("refuses a node identifier that is not address-shaped rather
 *  than keying a bucket on it").
 *
 *  This is ALSO what rejects RFC 7239's two deliberately address-less node identifiers — `unknown`
 *  and an obfuscated `_id` — since neither contains a character the shapes below allow. An earlier
 *  draft tested for those two explicitly as well; the kill-shot proved that branch could be deleted
 *  with the whole suite still green, i.e. it was a guard that could never fire, which reads as
 *  coverage without being any (CLAUDE.md §3.3 #4). The behaviour it described is unchanged and is
 *  pinned by the enumerated cases in apps/api/test/client-ip.test.ts ("yields nothing for unknown,
 *  obfuscated and absent identifiers") — which is the property that actually matters, rather than
 *  which line refuses them. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6ISH = /^[0-9a-f:]*:[0-9a-f:]*(\.\d{1,3}){0,3}$/i
const looksLikeIp = (v: string): boolean =>
  IPV4.test(v) ? v.split('.').every((o) => Number(o) <= 255) : IPV6ISH.test(v)

/**
 * Strip the optional `node-port` from an RFC 7239 node identifier, leaving the address.
 *
 * Three shapes, and the third is why this is not a `split(':')`:
 * - `[2001:db8::1]:4711` / `[2001:db8::1]` — bracketed IPv6, the RFC's own form for a v6 address.
 * - `192.0.2.60:1234` / `192.0.2.60:_obf` — one colon, so the tail is a port (numeric or the RFC's
 *   obfuscated form).
 * - `2001:db8::1` — an unbracketed IPv6, which is NOT RFC-conformant but is emitted in the wild.
 *   It has several colons, and treating the last group as a port would key the bucket on a
 *   TRUNCATED address: a wrong key, which is worse than no key. Left intact.
 */
function stripNodePort(node: string): string {
  if (node.startsWith('[')) {
    const close = node.indexOf(']')
    return close === -1 ? node : node.slice(1, close)
  }
  const colon = node.indexOf(':')
  if (colon === -1 || colon !== node.lastIndexOf(':')) return node
  return node.slice(0, colon)
}

/**
 * Parse the RFC 7239 `Forwarded` header into its hop list — one entry per forwarded-element, in
 * the order the header carries them, `undefined` for any element that names no address (#934).
 *
 * `undefined` is the load-bearing part. `unknown` and an obfuscated `_id` are both LEGAL node
 * identifiers that deliberately name nothing, so they have to mean "try the next hop" — a bucket
 * keyed on the literal `unknown` would silently pool every such caller under a string that looks
 * like an address. Same for an element with no `for=` pair at all (`Forwarded: proto=https`), for a
 * malformed value, and for anything that is not address-shaped ({@link looksLikeIp}).
 *
 * An UNBALANCED quote anywhere in the header refuses the whole header (empty hop list), because
 * once a proxy has appended its element to a client-supplied malformed value there is no way to
 * know where the boundaries were — and guessing hands the client the key. Same fail-closed
 * reasoning as the merged-single-valued-header rule in {@link resolveClientIp}.
 *
 * Exported for the grammar tests, which is the only way to cover the shapes exhaustively
 * (apps/api/test/client-ip.test.ts, "parseForwardedHeader — the RFC 7239 grammar (#934)" and
 * "a client cannot merge away the proxy's Forwarded hop (#934)").
 */
export function parseForwardedHeader(
  raw: string | undefined
): (string | undefined)[] {
  if (raw === undefined || raw.trim() === '') return []
  const elements = splitOutsideQuotes(raw, ',')
  if (elements === null) return []
  return elements.map((element) => {
    const found: string[] = []
    for (const pair of splitOutsideQuotes(element, ';') ?? []) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      // Parameter names are case-insensitive per RFC 7239 §4.
      if (pair.slice(0, eq).trim().toLowerCase() !== 'for') continue
      found.push(pair.slice(eq + 1).trim())
    }
    // RFC 7239 §4: a parameter MUST NOT occur more than once per element. A duplicate is malformed,
    // and picking one of them would be an arbitrary choice between two client-supplied values —
    // unusable is the honest answer.
    if (found.length !== 1) return undefined
    const value = unquote(found[0]!)
    if (value === undefined || value === '') return undefined
    // Address-SHAPED or nothing — which also covers `unknown` and the RFC's obfuscated `_id`, both
    // of which name no address at all. See {@link looksLikeIp}.
    const node = stripNodePort(value)
    return looksLikeIp(node) ? node : undefined
  })
}

/**
 * Walk a hop list from the RIGHT and return the first entry that is a usable address and is not
 * itself a declared proxy — the one rule both hop-list headers share (#934).
 *
 * Shared rather than duplicated because the safety argument is identical: a client can PREPEND
 * anything to either header, so only the entries a trusted proxy appended mean anything, and the
 * first right-to-left hop that is not itself declared is the real client. The hop cap bounds the
 * work a hostile header can cause. Pinned for both headers by apps/api/test/client-ip.test.ts
 * ("takes the RIGHTMOST non-proxy hop, not the client-controlled left" for `x-forwarded-for`, and
 * "takes the RIGHTMOST non-proxy hop here too" for `Forwarded`).
 */
function rightmostClientHop(
  hops: readonly (string | undefined)[],
  trust: ProxyTrust
): string | undefined {
  const first = Math.max(0, hops.length - MAX_FORWARDED_HOPS)
  for (let i = hops.length - 1; i >= first; i--) {
    const hop = normalizeIp(hops[i])
    if (hop !== undefined && !trust.proxies.includes(hop)) return hop
  }
  return undefined
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
  // Level 1, the header-blind default: nothing this request CLAIMS is consulted. Both hop-list
  // reads below sit behind this gate — see the forgery cases in
  // apps/api/test/client-ip.test.ts, which cover `Forwarded` too.
  if (!trust.proxies.includes(socket)) return socket

  // Level 3: one explicitly declared single-valued header, believed ahead of the chain because
  // the operator has asserted their proxy SETS it. A comma means the value was merged from more
  // than one instance of the header (Node joins duplicates with ", "), i.e. a client-supplied
  // copy survived alongside the proxy's — unknowable which is which, so fail closed to the chain
  // rather than guess. A genuine single-valued header never contains one.
  //
  // `forwarded` is excluded alongside `x-forwarded-for` for the same reason (#934): it is a hop
  // list, so believing the whole value would hand a client the key, which is exactly the hole #933
  // closed. Declaring either name is a no-op; the right-walk below reads them properly.
  if (
    trust.header !== undefined &&
    trust.header !== 'x-forwarded-for' &&
    trust.header !== 'forwarded'
  ) {
    const declared = req.header(trust.header)
    if (declared !== undefined && !declared.includes(',')) {
      const ip = normalizeIp(declared)
      if (ip !== undefined) return ip
    }
  }

  // Level 2: the append-structured chains, walked from the right.
  //
  // PRECEDENCE (#934): `x-forwarded-for` first. Both headers are hop lists gated on the same
  // declaration, so neither is more trustworthy — this is a tie-break, and it goes to continuity.
  // `x-forwarded-for` is what nginx/Caddy/Traefik/HAProxy/ALB/Cloudflare set by default, so it is
  // what every working deployment is already keyed on and what an operator debugging their own
  // buckets has been reasoning about; reversing it would silently re-key live deployments that
  // send both. `Forwarded` is still consulted when the chain yields no usable hop (blank, or only
  // declared proxies), which costs nothing and is the whole point of #934. Pinned by
  // apps/api/test/client-ip.test.ts ("precedence when both hop-list headers are present").
  // A PLAIN comma split, unchanged from before #934 and deliberately not the quote-aware one:
  // `x-forwarded-for` has no quoted-string grammar, so quote-awareness there would be meaningless
  // AND harmful — a client-supplied `"` would merge the proxy's appended hop into the client's own
  // text, which is the hole the Forwarded block above refuses the whole header over. The safety of
  // this walk rests on the proxy appending LAST, so nothing may be allowed to move that boundary.
  const chain = rightmostClientHop(
    (req.header('x-forwarded-for') ?? '').split(','),
    trust
  )
  if (chain !== undefined) return chain
  const rfc7239 = rightmostClientHop(
    parseForwardedHeader(req.header('forwarded')),
    trust
  )
  if (rfc7239 !== undefined) return rfc7239

  // A declared proxy that forwarded nothing usable (or only other declared proxies): key on the
  // proxy itself rather than on a value we have no reason to believe.
  return socket
}
