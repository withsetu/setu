/** SSRF-hardened fetch for every server-side URL Setu touches (#288, OWASP A01:2025).
 *
 *  Any URL that is attacker-influenceable or config-driven (oEmbed, live-site probes,
 *  deploy hooks, form webhooks, remote importers) MUST go through this helper — a raw
 *  `fetch` can reach cloud metadata (169.254.169.254), localhost-bound services, and the
 *  private LAN on the self-hosted topology. See docs/security-standards.md.
 *
 *  Design (all checks fail closed, and re-run on EVERY redirect hop):
 *  - https only (`allowHttp` is a dev opt-in); URLs carrying credentials are rejected.
 *  - Literal-IP hosts are range-checked: IPv4 private/loopback/link-local/metadata/
 *    multicast/reserved, IPv6 loopback/ULA/link-local/multicast — including IPv4-MAPPED
 *    (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`) forms, which are checked as their
 *    embedded IPv4.
 *  - `resolveHost` is the topology seam: Node callers inject a DNS resolver so every
 *    A/AAAA answer is range-checked BEFORE fetching; on Workers (no DNS API) omit it —
 *    the scheme/literal-IP/redirect checks still apply. Resolver failure = blocked.
 *  - Redirects are followed manually (capped), never blindly.
 *  - Responses are size-capped (Content-Length pre-check + hard cap while streaming)
 *    and time-capped (AbortSignal), then returned fully buffered — a probe can never
 *    stream 2 GB into memory.
 *
 *  Known limitation (documented, deliberate): resolve-then-fetch has a DNS-rebinding
 *  TOCTOU window; true pinning needs a custom Node agent, which isn't portable. The
 *  pre-check plus per-hop re-validation is the mitigation level #288 specifies.
 */

export type SafeFetchBlockReason =
  | 'invalid-url'
  | 'scheme'
  | 'credentials'
  | 'private-address'
  | 'host-not-allowed'
  | 'resolve'
  | 'too-many-redirects'
  | 'too-large'
  | 'timeout'

export class SafeFetchError extends Error {
  readonly reason: SafeFetchBlockReason
  constructor(reason: SafeFetchBlockReason, message: string) {
    super(message)
    this.name = 'SafeFetchError'
    this.reason = reason
  }
}

export interface SafeFetchOptions {
  /** Injectable fetch (tests, adapters). Defaults to the platform global. */
  fetchImpl?: typeof fetch
  /** Permit plain http (dev/local only — production surfaces stay https). */
  allowHttp?: boolean
  /** Exact-hostname allowlist (case-insensitive) for surfaces that have one,
   *  e.g. the oEmbed provider registry. Checked on every redirect hop. */
  allowHosts?: readonly string[]
  /** Max redirect hops to follow (each hop is fully re-validated). Default 3. */
  maxRedirects?: number
  /** Whole-operation deadline, connect through body read. Default 10s. */
  timeoutMs?: number
  /** Response body cap. Default 5 MB. */
  maxBytes?: number
  /** Topology seam: DNS resolver (host → A/AAAA answers) so private targets are
   *  caught BEFORE the socket opens. Node callers pass one; Workers omit it. */
  resolveHost?: (hostname: string) => Promise<string[]>
}

/** Buffered, validated result. Deliberately not a `Response`: the body is fully
 *  read under `maxBytes` (the cap is the point), and `finalUrl` reports where the
 *  redirect chain actually landed — which probes need to display honestly. */
export interface SafeFetchResult {
  status: number
  ok: boolean
  headers: Headers
  /** URL of the response actually returned (after any redirects). */
  finalUrl: string
  body: Uint8Array
  text(): string
}

const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

// ---------- IP range checks ----------

/** Dotted-quad string → unsigned 32-bit int, or null if not a v4 literal. */
function parseIpv4(s: string): number | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let ip = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    ip = ((ip << 8) | n) >>> 0
  }
  return ip
}

const inV4Range = (ip: number, base: number, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0
  return (ip & mask) >>> 0 === base
}

const v4 = (a: number, b: number, c: number, d: number): number =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0

/** Private / loopback / link-local / metadata / multicast / reserved / doc ranges. */
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local incl. cloud metadata
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4] // reserved + broadcast
]

const isBlockedV4 = (ip: number): boolean =>
  BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits))

/** IPv6 string (no brackets) → eight 16-bit groups, or null if unparseable.
 *  Handles `::` compression and dotted-quad tails (`::ffff:127.0.0.1`). */
function parseIpv6(raw: string): number[] | null {
  let s = raw
  // Zone index (fe80::1%eth0) — strip; the range check is on the address.
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  // Rewrite a dotted-quad tail as two hex groups so the rest is uniform.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const t = parseIpv4(tail)
    if (t === null) return null
    s =
      s.slice(0, lastColon + 1) +
      ((t >>> 16) & 0xff_ff).toString(16) +
      ':' +
      (t & 0xff_ff).toString(16)
  }
  const parts = s.split('::')
  if (parts.length > 2) return null
  const head = parts[0] === '' ? [] : (parts[0] ?? '').split(':')
  const tailGroups =
    parts.length === 2
      ? parts[1] === ''
        ? []
        : (parts[1] ?? '').split(':')
      : []
  const missing = 8 - head.length - tailGroups.length
  if (parts.length === 2 ? missing < 1 : head.length !== 8) return null
  const groupsRaw =
    parts.length === 2
      ? [...head, ...Array<string>(missing).fill('0'), ...tailGroups]
      : head
  const groups: number[] = []
  for (const g of groupsRaw) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    groups.push(parseInt(g, 16))
  }
  return groups
}

function isBlockedV6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups
  const allZero = groups.every((g) => g === 0)
  if (allZero) return true // :: unspecified
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 === 0 && g7 === 1) return true // ::1 loopback
  }
  if ((g0 & 0xfe_00) === 0xfc_00) return true // fc00::/7 ULA
  if ((g0 & 0xff_c0) === 0xfe_80) return true // fe80::/10 link-local
  if ((g0 & 0xff_00) === 0xff_00) return true // ff00::/8 multicast
  if (g0 === 0x20_01 && g1 === 0x0d_b8) return true // 2001:db8::/32 documentation
  // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded IPv4.
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xff_ff
  )
    return isBlockedV4(((g6 << 16) | g7) >>> 0)
  // NAT64 (64:ff9b::/96) — likewise.
  if (
    g0 === 0x00_64 &&
    g1 === 0xff_9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  )
    return isBlockedV4(((g6 << 16) | g7) >>> 0)
  return false
}

/** Is this address string (v4 or v6, as URL hostname or DNS answer) blocked? */
function isBlockedAddress(addr: string): boolean {
  const bare =
    addr.startsWith('[') && addr.endsWith(']') ? addr.slice(1, -1) : addr
  const asV4 = parseIpv4(bare)
  if (asV4 !== null) return isBlockedV4(asV4)
  const asV6 = parseIpv6(bare)
  if (asV6 !== null) return isBlockedV6(asV6)
  return false // not an IP literal — hostname checks handle it
}

const isIpLiteral = (hostname: string): boolean => {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
  return parseIpv4(bare) !== null || parseIpv6(bare) !== null
}

// ---------- URL validation (run on the initial URL and every redirect hop) ----------

async function validateHop(
  raw: string | URL,
  opts: SafeFetchOptions
): Promise<URL> {
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    throw new SafeFetchError('invalid-url', `Not a valid URL: ${String(raw)}`)
  }
  if (
    url.protocol !== 'https:' &&
    !(opts.allowHttp && url.protocol === 'http:')
  )
    throw new SafeFetchError(
      'scheme',
      `Blocked scheme "${url.protocol}" — only https is allowed${opts.allowHttp ? ' (and http via allowHttp)' : ''}.`
    )
  if (url.username !== '' || url.password !== '')
    throw new SafeFetchError(
      'credentials',
      'URLs carrying credentials are not allowed.'
    )
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw new SafeFetchError(
      'private-address',
      `Blocked host "${host}" — localhost is not reachable through safeFetch.`
    )
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host))
      throw new SafeFetchError(
        'private-address',
        `Blocked address "${host}" — private, loopback, link-local, and metadata ranges are not reachable.`
      )
  } else {
    if (
      opts.allowHosts &&
      !opts.allowHosts.some((h) => h.toLowerCase() === host)
    )
      throw new SafeFetchError(
        'host-not-allowed',
        `Host "${host}" is not on this surface's allowlist.`
      )
    if (opts.resolveHost) {
      let answers: string[]
      try {
        answers = await opts.resolveHost(host)
      } catch (e) {
        throw new SafeFetchError(
          'resolve',
          `DNS resolution failed for "${host}": ${e instanceof Error ? e.message : String(e)}`
        )
      }
      if (answers.length === 0)
        throw new SafeFetchError(
          'resolve',
          `DNS returned no addresses for "${host}".`
        )
      for (const a of answers) {
        if (isBlockedAddress(a))
          throw new SafeFetchError(
            'private-address',
            `Host "${host}" resolves to blocked address ${a}.`
          )
      }
    }
  }
  // Literal IPs skip allowHosts by design: an allowlist implies hostnames; a raw
  // IP is never "the allowlisted host". Enforce that explicitly.
  if (isIpLiteral(host) && opts.allowHosts)
    throw new SafeFetchError(
      'host-not-allowed',
      `Literal-IP host "${host}" cannot match a hostname allowlist.`
    )
  return url
}

// ---------- body reading under a byte cap ----------

async function readCapped(
  res: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = res.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes)
    throw new SafeFetchError(
      'too-large',
      `Response Content-Length ${declared} exceeds the ${maxBytes}-byte cap.`
    )
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > maxBytes)
      throw new SafeFetchError(
        'too-large',
        `Response exceeded the ${maxBytes}-byte cap.`
      )
    return buf
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    // In core's Node-lib-free type environment the reader's chunk types as `any`;
    // a fetch body's chunks are always Uint8Array — pin that.
    const { done, value } = (await reader.read()) as {
      done: boolean
      value?: Uint8Array
    }
    if (done || value === undefined) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new SafeFetchError(
        'too-large',
        `Response exceeded the ${maxBytes}-byte cap.`
      )
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

// ---------- the helper ----------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export async function safeFetch(
  url: string | URL,
  init?: RequestInit,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  // Honor a caller-supplied signal by forwarding its abort.
  if (init?.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', () => controller.abort())
  }

  try {
    let current = await validateHop(url, opts)
    let method = init?.method ?? 'GET'
    let body = init?.body

    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(current.toString(), {
        ...init,
        method,
        body,
        redirect: 'manual',
        signal: controller.signal
      }).catch((e: unknown) => {
        if (timedOut)
          throw new SafeFetchError(
            'timeout',
            `Request timed out after ${timeoutMs}ms.`
          )
        throw e
      })

      const location = res.headers.get('location')
      if (REDIRECT_STATUSES.has(res.status) && location !== null) {
        if (hop >= maxRedirects)
          throw new SafeFetchError(
            'too-many-redirects',
            `Gave up after ${maxRedirects} redirect hops.`
          )
        current = await validateHop(new URL(location, current), opts)
        // Per fetch semantics: 303 (and 301/302 for non-GET) switch to GET.
        if (res.status === 303 || (res.status <= 302 && method !== 'GET')) {
          method = 'GET'
          body = undefined
        }
        continue
      }

      const bytes = await readCapped(res, maxBytes).catch((e: unknown) => {
        if (timedOut)
          throw new SafeFetchError(
            'timeout',
            `Request timed out after ${timeoutMs}ms.`
          )
        throw e
      })
      let decoded: string | undefined
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        headers: res.headers,
        finalUrl: current.toString(),
        body: bytes,
        text: () => (decoded ??= new TextDecoder().decode(bytes))
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
