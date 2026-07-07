/** The oEmbed provider allowlist — the SSRF boundary for the embed block (#187).
 *
 *  A user pastes a URL; we NEVER fetch it. We parse it, match its hostname against this fixed
 *  allowlist, and — only on an exact match — fetch that provider's own fixed oEmbed `endpoint`.
 *  So the only hosts ever contacted are the provider hosts hard-coded here, never a user-supplied
 *  one. That is what makes the block SSRF-safe without needing to inspect resolved IPs. When the
 *  shared safe-fetch helper (#288) lands, the endpoint fetch routes through it as defence-in-depth.
 *
 *  Pure + edge-safe: parsing only, no network, no node built-ins. */

export type OembedType = 'video' | 'rich' | 'photo'

export interface OembedProvider {
  /** Stable id (stored in block props + used by the #367 video-sitemap emitter). */
  name: string
  /** Human label for the editor badge. */
  label: string
  /** Tabler icon name (no `ti-` prefix) for the slash menu + inspector. */
  icon: string
  /** oEmbed response type we expect — `video` providers feed `<video:video>` sitemap entries. */
  type: OembedType
  /** Exact hostnames that belong to this provider (lowercased). Matching is equality, never
   *  substring — `youtube.com.evil.example` must not match `youtube.com`. */
  hosts: string[]
  /** The provider's own fixed oEmbed endpoint (always https, provider-owned host). */
  endpoint: string
}

export const OEMBED_PROVIDERS: OembedProvider[] = [
  {
    name: 'youtube',
    label: 'YouTube',
    icon: 'brand-youtube',
    type: 'video',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
    endpoint: 'https://www.youtube.com/oembed'
  },
  {
    name: 'vimeo',
    label: 'Vimeo',
    icon: 'brand-vimeo',
    type: 'video',
    hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
    endpoint: 'https://vimeo.com/api/oembed.json'
  },
  {
    name: 'twitter',
    label: 'X (Twitter)',
    icon: 'brand-x',
    type: 'rich',
    hosts: [
      'twitter.com',
      'www.twitter.com',
      'mobile.twitter.com',
      'x.com',
      'www.x.com'
    ],
    endpoint: 'https://publish.twitter.com/oembed'
  }
]

/** hostname → provider, built once from the allowlist. */
const HOST_INDEX: Map<string, OembedProvider> = new Map(
  OEMBED_PROVIDERS.flatMap((p) => p.hosts.map((h) => [h, p] as const))
)

/** Return the allow-listed provider for a pasted URL, or null if the host isn't allow-listed
 *  (→ the caller must NOT fetch anything). Never throws. */
export function matchProvider(input: string): OembedProvider | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  // Only http(s) inputs are considered; the endpoint we actually fetch is always https regardless.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return HOST_INDEX.get(url.hostname.toLowerCase()) ?? null
}

/** Build the fixed oEmbed request URL for a matched provider. The host is always the provider's
 *  own endpoint host — the user's URL only ever travels as the `url` query param. */
export function oembedEndpoint(provider: OembedProvider, url: string): string {
  const ep = new URL(provider.endpoint)
  ep.searchParams.set('url', url)
  ep.searchParams.set('format', 'json')
  return ep.href
}
