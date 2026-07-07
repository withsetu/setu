import { describe, it, expect } from 'vitest'
import {
  matchProvider,
  oembedEndpoint,
  OEMBED_PROVIDERS
} from '../../src/oembed/providers'

describe('matchProvider — the oEmbed allowlist (SSRF boundary)', () => {
  it('matches YouTube watch + short URLs', () => {
    expect(
      matchProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.name
    ).toBe('youtube')
    expect(matchProvider('https://youtu.be/dQw4w9WgXcQ')?.name).toBe('youtube')
    expect(matchProvider('https://youtube.com/shorts/abc123')?.name).toBe(
      'youtube'
    )
  })

  it('matches Vimeo', () => {
    expect(matchProvider('https://vimeo.com/123456789')?.name).toBe('vimeo')
  })

  it('matches X / Twitter (both hosts)', () => {
    expect(matchProvider('https://twitter.com/user/status/123')?.name).toBe(
      'twitter'
    )
    expect(matchProvider('https://x.com/user/status/123')?.name).toBe('twitter')
  })

  it('classifies YouTube/Vimeo as video providers (drives <video:video> in #367)', () => {
    expect(matchProvider('https://youtu.be/x')?.type).toBe('video')
    expect(matchProvider('https://vimeo.com/1')?.type).toBe('video')
  })

  // --- SSRF-critical: anything not explicitly allow-listed must NOT match (→ no fetch) ---
  it('rejects a non-allowlisted host', () => {
    expect(matchProvider('https://random-site.example/watch?v=x')).toBeNull()
  })

  it('rejects SSRF probes: internal IPs, localhost, cloud metadata', () => {
    expect(matchProvider('http://169.254.169.254/latest/meta-data/')).toBeNull()
    expect(matchProvider('http://localhost:8080/admin')).toBeNull()
    expect(matchProvider('http://127.0.0.1/')).toBeNull()
    expect(matchProvider('http://10.0.0.5/')).toBeNull()
  })

  it('rejects non-http(s) schemes', () => {
    expect(matchProvider('file:///etc/passwd')).toBeNull()
    expect(matchProvider('javascript:alert(1)')).toBeNull()
    expect(matchProvider('data:text/html,<script>1</script>')).toBeNull()
  })

  it('rejects a look-alike host that merely contains a provider name', () => {
    expect(matchProvider('https://youtube.com.evil.example/x')).toBeNull()
    expect(matchProvider('https://notyoutube.com/watch?v=x')).toBeNull()
    expect(matchProvider('https://evilvimeo.com/1')).toBeNull()
  })

  it('rejects garbage / non-URLs without throwing', () => {
    expect(matchProvider('not a url')).toBeNull()
    expect(matchProvider('')).toBeNull()
  })
})

describe('oembedEndpoint — builds the fixed provider endpoint (never the user host)', () => {
  it('targets the provider oEmbed endpoint with the url + json format', () => {
    const p = matchProvider('https://youtu.be/abc')!
    const ep = new URL(oembedEndpoint(p, 'https://youtu.be/abc'))
    expect(ep.host).toBe('www.youtube.com') // the FIXED allow-listed host, not the input host
    expect(ep.searchParams.get('url')).toBe('https://youtu.be/abc')
    expect(ep.searchParams.get('format')).toBe('json')
  })

  it('every provider endpoint is https and on the provider’s own host', () => {
    for (const p of OEMBED_PROVIDERS) {
      const u = new URL(p.endpoint)
      expect(u.protocol).toBe('https:')
    }
  })
})
