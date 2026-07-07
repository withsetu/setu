/** The oEmbed provider allowlist — the SSRF boundary for the embed block (#187).
 *
 *  A user pastes a URL; we NEVER fetch it. We parse it, match its hostname against this fixed
 *  allowlist, and — only on an exact registrable-domain match — fetch that provider's OWN fixed
 *  oEmbed `endpoint`. So the only hosts ever contacted are the provider hosts hard-coded here,
 *  never a user-supplied one. That is what makes the block SSRF-safe without inspecting resolved
 *  IPs. When the shared safe-fetch helper (#288) lands, the endpoint fetch routes through it as
 *  defence-in-depth (timeout/size caps); it is NOT what provides the SSRF guarantee here.
 *
 *  The provider set mirrors WordPress core (`WP_oEmbed`), so authors get the same breadth they
 *  know. `type` is medium-accurate (video/audio/photo/rich) rather than WP's coarse flag — only
 *  `video` providers feed `<video:video>` sitemap entries (#367).
 *
 *  Pure + edge-safe: URL parsing only, no network, no node built-ins. */

export type OembedType = 'video' | 'audio' | 'photo' | 'rich'

export interface OembedProvider {
  /** Stable id (stored in block props + read by the #367 video-sitemap emitter). */
  name: string
  /** Human label for the editor badge. */
  label: string
  /** Tabler icon name (no `ti-` prefix) for the slash menu + inspector; '' → UI falls back by type. */
  icon: string
  /** Medium — `video` providers are the ones that feed `<video:video>` sitemap entries (#367). */
  type: OembedType
  /** Registrable domains that belong to this provider (lowercased). A URL matches when its host
   *  equals a domain OR ends with `.` + domain — so subdomains work (`user.smugmug.com`) while
   *  look-alikes (`youtube.com.evil.example`, `notyoutube.com`) do not. */
  domains: string[]
  /** The provider's own fixed oEmbed endpoint (always https, provider-owned host). */
  endpoint: string
}

export const OEMBED_PROVIDERS: OembedProvider[] = [
  // --- video (feed #367) ---
  {
    name: 'youtube',
    label: 'YouTube',
    icon: 'brand-youtube',
    type: 'video',
    domains: ['youtube.com', 'youtu.be'],
    endpoint: 'https://www.youtube.com/oembed'
  },
  {
    name: 'vimeo',
    label: 'Vimeo',
    icon: 'brand-vimeo',
    type: 'video',
    domains: ['vimeo.com'],
    endpoint: 'https://vimeo.com/api/oembed.json'
  },
  {
    name: 'dailymotion',
    label: 'Dailymotion',
    icon: 'brand-dailymotion',
    type: 'video',
    domains: ['dailymotion.com', 'dai.ly'],
    endpoint: 'https://www.dailymotion.com/services/oembed'
  },
  {
    name: 'tiktok',
    label: 'TikTok',
    icon: 'brand-tiktok',
    type: 'video',
    domains: ['tiktok.com'],
    endpoint: 'https://www.tiktok.com/oembed'
  },
  {
    name: 'ted',
    label: 'TED',
    icon: 'brand-ted',
    type: 'video',
    domains: ['ted.com'],
    endpoint: 'https://www.ted.com/services/v1/oembed.json'
  },
  {
    name: 'animoto',
    label: 'Animoto',
    icon: 'movie',
    type: 'video',
    domains: ['animoto.com', 'video214.com'],
    endpoint: 'https://animoto.com/oembeds/create'
  },
  {
    name: 'videopress',
    label: 'VideoPress',
    icon: 'brand-wordpress',
    type: 'video',
    domains: ['videopress.com'],
    endpoint: 'https://public-api.wordpress.com/oembed/'
  },
  {
    name: 'wordpress-tv',
    label: 'WordPress.tv',
    icon: 'brand-wordpress',
    type: 'video',
    domains: ['wordpress.tv'],
    endpoint: 'https://wordpress.tv/oembed/'
  },
  // --- audio ---
  {
    name: 'soundcloud',
    label: 'SoundCloud',
    icon: 'brand-soundcloud',
    type: 'audio',
    domains: ['soundcloud.com'],
    endpoint: 'https://soundcloud.com/oembed'
  },
  {
    name: 'spotify',
    label: 'Spotify',
    icon: 'brand-spotify',
    type: 'audio',
    domains: ['spotify.com'],
    endpoint: 'https://open.spotify.com/oembed'
  },
  {
    name: 'mixcloud',
    label: 'Mixcloud',
    icon: 'music',
    type: 'audio',
    domains: ['mixcloud.com'],
    endpoint: 'https://app.mixcloud.com/oembed/'
  },
  {
    name: 'reverbnation',
    label: 'ReverbNation',
    icon: 'music',
    type: 'audio',
    domains: ['reverbnation.com'],
    endpoint: 'https://www.reverbnation.com/oembed'
  },
  {
    name: 'anghami',
    label: 'Anghami',
    icon: 'music',
    type: 'audio',
    domains: ['anghami.com'],
    endpoint: 'https://api.anghami.com/rest/v1/oembed.view'
  },
  {
    name: 'pocketcasts',
    label: 'Pocket Casts',
    icon: 'microphone',
    type: 'audio',
    domains: ['pca.st'],
    endpoint: 'https://pca.st/oembed.json'
  },
  // --- photo ---
  {
    name: 'flickr',
    label: 'Flickr',
    icon: 'brand-flickr',
    type: 'photo',
    domains: ['flickr.com', 'flic.kr'],
    endpoint: 'https://www.flickr.com/services/oembed/'
  },
  {
    name: 'smugmug',
    label: 'SmugMug',
    icon: 'photo',
    type: 'photo',
    domains: ['smugmug.com'],
    endpoint: 'https://api.smugmug.com/services/oembed/'
  },
  {
    name: 'imgur',
    label: 'Imgur',
    icon: 'photo',
    type: 'photo',
    domains: ['imgur.com'],
    endpoint: 'https://api.imgur.com/oembed'
  },
  // --- rich / other ---
  {
    name: 'twitter',
    label: 'X (Twitter)',
    icon: 'brand-x',
    type: 'rich',
    domains: ['twitter.com', 'x.com'],
    endpoint: 'https://publish.twitter.com/oembed'
  },
  {
    name: 'bluesky',
    label: 'Bluesky',
    icon: 'brand-bluesky',
    type: 'rich',
    domains: ['bsky.app'],
    endpoint: 'https://embed.bsky.app/oembed'
  },
  {
    name: 'reddit',
    label: 'Reddit',
    icon: 'brand-reddit',
    type: 'rich',
    domains: ['reddit.com'],
    endpoint: 'https://www.reddit.com/oembed'
  },
  {
    name: 'tumblr',
    label: 'Tumblr',
    icon: 'brand-tumblr',
    type: 'rich',
    domains: ['tumblr.com'],
    endpoint: 'https://www.tumblr.com/oembed/1.0'
  },
  {
    name: 'pinterest',
    label: 'Pinterest',
    icon: 'brand-pinterest',
    type: 'rich',
    domains: ['pinterest.com', 'pin.it'],
    endpoint: 'https://www.pinterest.com/oembed.json'
  },
  {
    name: 'canva',
    label: 'Canva',
    icon: 'brand-canva',
    type: 'rich',
    domains: ['canva.com'],
    endpoint: 'https://www.canva.com/_oembed'
  },
  {
    name: 'scribd',
    label: 'Scribd',
    icon: 'file-text',
    type: 'rich',
    domains: ['scribd.com'],
    endpoint: 'https://www.scribd.com/services/oembed'
  },
  {
    name: 'speakerdeck',
    label: 'Speaker Deck',
    icon: 'presentation',
    type: 'rich',
    domains: ['speakerdeck.com'],
    endpoint: 'https://speakerdeck.com/oembed.json'
  },
  {
    name: 'kickstarter',
    label: 'Kickstarter',
    icon: 'brand-kickstarter',
    type: 'rich',
    domains: ['kickstarter.com', 'kck.st'],
    endpoint: 'https://www.kickstarter.com/services/oembed'
  },
  {
    name: 'issuu',
    label: 'Issuu',
    icon: 'book',
    type: 'rich',
    domains: ['issuu.com'],
    endpoint: 'https://issuu.com/oembed_wp'
  },
  {
    name: 'crowdsignal',
    label: 'Crowdsignal',
    icon: 'chart-bar',
    type: 'rich',
    domains: ['crowdsignal.net', 'polldaddy.com', 'poll.fm', 'survey.fm'],
    endpoint: 'https://api.crowdsignal.com/oembed'
  },
  {
    name: 'cloudup',
    label: 'Cloudup',
    icon: 'cloud',
    type: 'rich',
    domains: ['cloudup.com'],
    endpoint: 'https://cloudup.com/oembed'
  },
  {
    name: 'someecards',
    label: 'Someecards',
    icon: 'mail',
    type: 'rich',
    domains: ['someecards.com', 'some.ly'],
    endpoint: 'https://www.someecards.com/v2/oembed/'
  },
  {
    name: 'wolframcloud',
    label: 'Wolfram Cloud',
    icon: 'math-function',
    type: 'rich',
    domains: ['wolframcloud.com'],
    endpoint: 'https://www.wolframcloud.com/oembed'
  },
  {
    name: 'amazon',
    label: 'Amazon',
    icon: 'brand-amazon',
    type: 'rich',
    domains: ['amazon.com', 'a.co', 'amzn.to'],
    endpoint: 'https://read.amazon.com/kp/api/oembed'
  }
]

/** domain → provider, built once from the allowlist (longest-suffix wins on match). */
const DOMAIN_INDEX: [string, OembedProvider][] = OEMBED_PROVIDERS.flatMap((p) =>
  p.domains.map((d) => [d, p] as [string, OembedProvider])
)

/** Return the allow-listed provider for a pasted URL, or null if the host isn't allow-listed
 *  (→ the caller must NOT fetch anything). Matches on registrable-domain suffix so provider
 *  subdomains resolve, while look-alike hosts do not. Never throws. */
export function matchProvider(input: string): OembedProvider | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  // Only http(s) inputs are considered; the endpoint we actually fetch is always https regardless.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  for (const [domain, provider] of DOMAIN_INDEX) {
    if (host === domain || host.endsWith('.' + domain)) return provider
  }
  return null
}

/** Build the fixed oEmbed request URL for a matched provider. The host is always the provider's
 *  own endpoint host — the user's URL only ever travels as the `url` query param. */
export function oembedEndpoint(provider: OembedProvider, url: string): string {
  const ep = new URL(provider.endpoint)
  ep.searchParams.set('url', url)
  ep.searchParams.set('format', 'json')
  return ep.href
}
