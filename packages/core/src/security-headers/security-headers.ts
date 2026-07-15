/**
 * Baseline security-header vocabulary for the PUBLISHED SITE (#289).
 *
 * Pure, dependency-free and edge-safe (typechecked by tsconfig.edge.json): topology adapters
 * consume it however they deliver headers — the SSG build writes a Cloudflare Pages / Netlify
 * `_headers` file, a Node server would set them on responses, docs can render them for nginx.
 *
 * Deliberate defaults (each loosening is an owner opt-in via a later settings increment):
 * - HSTS is `max-age` only — no `includeSubDomains` (could break unrelated subdomains the owner
 *   runs) and no `preload` (a near-irreversible browser-list commitment) by default.
 * - `X-Frame-Options: SAMEORIGIN`, NOT `DENY` — the admin previews the site in an iframe; the
 *   modern CSP equivalent `frame-ancestors 'self'` is emitted alongside it in the CSP below.
 * - The CSP ships as `Content-Security-Policy-Report-Only` BY DESIGN: it observes without
 *   breaking anything; the flip to enforcing is a later, explicit settings toggle (#289 part 2).
 */

export interface SecurityHeader {
  name: string
  value: string
}

/**
 * The default header set, in a stable emission order.
 *
 * @param opts.mediaOrigin origin of an off-site media host (e.g. `https://media.example.com`)
 *   to allow in `img-src`; omit when media is same-origin with the site.
 */
export function defaultSecurityHeaders(
  opts: { mediaOrigin?: string } = {}
): SecurityHeader[] {
  const imgSrc = opts.mediaOrigin
    ? `'self' data: ${opts.mediaOrigin}`
    : `'self' data:`
  const csp = [
    `default-src 'self'`,
    `script-src 'self'`,
    // 'unsafe-inline' for styles is required: the per-page CSS purge integration inlines each
    // page's purged block CSS as <style> blocks (apps/site/integrations/per-page-css-purge.mjs).
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${imgSrc}`,
    // data: fonts appear in self-hosted fontsource fallbacks; harmless for a static site.
    `font-src 'self' data:`,
    // CSP-level twin of X-Frame-Options: SAMEORIGIN (admin preview iframe must keep working).
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`
  ].join('; ')
  return [
    { name: 'Strict-Transport-Security', value: 'max-age=31536000' },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    { name: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      name: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()'
    },
    { name: 'Content-Security-Policy-Report-Only', value: csp }
  ]
}

/**
 * Render headers in the Cloudflare Pages `_headers` static file format (Netlify reads the same
 * shape): a URL-pattern line, then an indented `Name: value` line per header.
 *
 * Format verified 2026-07-09 against the official docs —
 * https://developers.cloudflare.com/pages/configuration/headers/ : "Header rules are defined in
 * multi-line blocks. The first line of a block is the URL or URL pattern where the rule's
 * headers should be applied. On the next line, an indented list of header names and header
 * values must be written." The docs' examples indent with two spaces; limits are 100 rules per
 * file and 2,000 characters per line — one `/*` rule with six short lines is far inside both.
 */
export function toCloudflareHeadersFile(headers: SecurityHeader[]): string {
  return ['/*', ...headers.map((h) => `  ${h.name}: ${h.value}`), ''].join('\n')
}
