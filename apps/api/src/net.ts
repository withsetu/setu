import { lookup } from 'node:dns/promises'
import { safeFetch } from '@setu/core'

/** Node DNS resolver for safeFetch's `resolveHost` seam (#288): resolve every A/AAAA
 *  answer so a hostname pointing at an internal address is caught before the socket
 *  opens. Node-only — the Workers build omits this and keeps the other guards. */
export const nodeResolveHost = async (hostname: string): Promise<string[]> => {
  const answers = await lookup(hostname, { all: true })
  return answers.map((a) => a.address)
}

export interface SafeFetchImplOptions {
  /** Raw transport safeFetch drives (tests). Defaults to the platform fetch. */
  transport?: typeof fetch
  /** Exact-hostname allowlist, re-checked on EVERY redirect hop. */
  allowHosts?: readonly string[]
  /** Response body cap, enforced by Content-Length pre-check AND while streaming. */
  maxBytes?: number
  timeoutMs?: number
  /** DNS seam. Defaults to Node's resolver; pass a stub in tests to stay off the network. */
  resolveHost?: (hostname: string) => Promise<string[]>
}

/** Adapt `safeFetch` (buffered, validated, `SafeFetchResult`) to the plain `fetch` signature that
 *  `@setu/core` resolvers take as `fetchImpl` (#626).
 *
 *  Why an adapter rather than a raw `fetch`: `resolveOembed` declares `fetchImpl?: typeof fetch`
 *  and falls back to `globalThis.fetch`, whose default `redirect: 'follow'` silently follows a
 *  provider 302 anywhere — the allowlist would pin only the first hop. safeFetch does
 *  `redirect: 'manual'` and re-runs the FULL validation (scheme, credentials, literal-IP ranges,
 *  allowHosts, DNS answers) on every hop, plus a Content-Length pre-check and a streaming byte cap
 *  so an oversized body is never buffered.
 *
 *  Failure contract: a blocked or oversized request REJECTS with `SafeFetchError` — the same shape
 *  a network failure has, so a caller that already treats a throwing fetch as an upstream failure
 *  (resolveOembed → `fetch_failed` → 502) maps it correctly and nothing escapes as a 500. Non-2xx
 *  upstream statuses are NOT throws: they come back as a normal `Response`.
 *
 *  Note: only the buffered body, status and headers survive; `Response.url` is set to the final
 *  URL of the redirect chain so a caller can see where it actually landed. */
export function createSafeFetchImpl(
  opts: SafeFetchImplOptions = {}
): typeof fetch {
  const { transport, allowHosts, maxBytes, timeoutMs, resolveHost } = opts
  // `RequestInfo` isn't in apps/api's lib set (no DOM lib) — derive the parameter type from the
  // platform `fetch` itself so this stays accurate wherever it's compiled.
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url
    const result = await safeFetch(url, init, {
      ...(transport ? { fetchImpl: transport } : {}),
      ...(allowHosts ? { allowHosts } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      resolveHost: resolveHost ?? nodeResolveHost
    })
    // 204/205/304 forbid a body in the Response constructor; safeFetch buffers an empty one anyway.
    const bodyless =
      result.status === 204 || result.status === 205 || result.status === 304
    return new Response(bodyless ? null : result.body, {
      status: result.status,
      headers: result.headers
    })
  }
}
