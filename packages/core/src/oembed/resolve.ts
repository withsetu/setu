import {
  matchProvider,
  oembedEndpoint,
  type OembedProvider,
  type OembedType
} from './providers'

/** Normalized oEmbed data — the stable shape stored in the embed block's props and read by the
 *  #367 video-sitemap emitter. Provider fields are ours (from the allowlist); the rest are the
 *  provider's oEmbed response, coerced defensively. */
export interface NormalizedOembed {
  /** Our provider id (e.g. `youtube`). */
  provider: string
  /** Our provider label (e.g. `YouTube`). */
  providerLabel: string
  /** Our medium — `video` is what feeds `<video:video>` in #367. */
  mediaType: OembedType
  /** The oEmbed response `type` (video/photo/rich/link). */
  oembedType: string
  title: string
  authorName?: string
  /** Provider embed HTML — third-party markup, rendered ONLY inside a sandboxed iframe. Capped.
   *  Kept as the fallback for script-based embeds (tweets) that aren't a single iframe. */
  html?: string
  /** The player/iframe URL extracted from `html` — a clean cross-origin src for a sandboxed
   *  `<iframe src>` (no fragile html-in-attribute) and the `player_loc` the video sitemap needs. */
  embedUrl?: string
  width?: number
  height?: number
  /** Poster/thumbnail (video providers → the video thumbnail #367 needs). */
  thumbnailUrl?: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  /** The original user URL — "open original" link + the video sitemap player location. */
  sourceUrl: string
}

export type OembedFailure = 'unsupported' | 'fetch_failed' | 'invalid_response'
export type OembedResult =
  { ok: true; data: NormalizedOembed } | { ok: false; reason: OembedFailure }

/** Cap on stored provider HTML. It's sandboxed at render, but we never persist an absurd payload. */
const MAX_HTML = 32_768
/** Cap on the raw response body we parse. Exported so the transport layer that actually fetches
 *  (apps/api's safeFetch adapter, #626) enforces the SAME ceiling while STREAMING — the check
 *  below is a last-resort backstop that runs after `res.text()` has already buffered. */
export const OEMBED_MAX_BODY_BYTES = 262_144
const MAX_BODY = OEMBED_MAX_BODY_BYTES
const TIMEOUT_MS = 5000

export interface ResolveOembedOptions {
  /** Injected fetch (edge-safe + testable; later routed through the shared safe-fetch helper #288). */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Resolve a pasted URL to normalized oEmbed data. SSRF-safe by construction: an unmatched URL
 *  returns `unsupported` with NO network call, and a matched one only ever fetches the provider's
 *  own fixed endpoint (never the user host). Never throws — all failures are typed results. */
export async function resolveOembed(
  url: string,
  opts: ResolveOembedOptions = {}
): Promise<OembedResult> {
  const provider = matchProvider(url)
  if (!provider) return { ok: false, reason: 'unsupported' }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const endpoint = oembedEndpoint(provider, url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS)

  let res: Response
  try {
    res = await fetchImpl(endpoint, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    })
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) return { ok: false, reason: 'fetch_failed' }

  let raw: unknown
  try {
    const text = await res.text()
    if (text.length > MAX_BODY) return { ok: false, reason: 'invalid_response' }
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }

  const data = normalize(provider, url, raw)
  return data ? { ok: true, data } : { ok: false, reason: 'invalid_response' }
}

const IFRAME_SRC = /<iframe[^>]*\ssrc=["']([^"']+)["']/i

/** Pull the iframe `src` out of provider embed HTML → a clean player URL. Protocol-relative
 *  `//host/…` is normalized to https; only http(s) results are kept. undefined when there's no
 *  single-iframe embed (e.g. a tweet blockquote). */
function extractEmbedUrl(html: string | undefined): string | undefined {
  if (!html) return undefined
  const src = IFRAME_SRC.exec(html)?.[1]
  if (!src) return undefined
  try {
    const u = new URL(src, 'https://_')
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.href
      : undefined
  } catch {
    return undefined
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Coerce a provider oEmbed response into NormalizedOembed, or null if it isn't usable. */
function normalize(
  provider: OembedProvider,
  sourceUrl: string,
  raw: unknown
): NormalizedOembed | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const oembedType = str(o.type)
  if (!oembedType) return null // a valid oEmbed response must declare a type

  const rawHtml = str(o.html)
  const html = rawHtml && rawHtml.length <= MAX_HTML ? rawHtml : undefined
  const photoUrl = str(o.url)
  // Nothing renderable (no html, no photo url) and not a bare link → not embeddable.
  if (!html && !photoUrl && oembedType !== 'link') return null

  return {
    provider: provider.name,
    providerLabel: provider.label,
    mediaType: provider.type,
    oembedType,
    title: str(o.title) ?? '',
    authorName: str(o.author_name),
    html,
    embedUrl: extractEmbedUrl(html),
    width: num(o.width),
    height: num(o.height),
    thumbnailUrl:
      str(o.thumbnail_url) ?? (oembedType === 'photo' ? photoUrl : undefined),
    thumbnailWidth: num(o.thumbnail_width),
    thumbnailHeight: num(o.thumbnail_height),
    sourceUrl
  }
}
