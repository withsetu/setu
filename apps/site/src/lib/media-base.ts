/** Resolve the origin that root-relative media paths (`/media/...`) are prefixed
 *  with when rendering the site.
 *
 *  - `PUBLIC_SETU_MEDIA` set → that origin (a CDN or a separate media host),
 *    trailing slash trimmed. This is how production points at wherever media is
 *    actually served.
 *  - unset, in dev → `http://localhost:4444` (the dev media API, which runs on its
 *    own port separate from the site).
 *  - unset, in a production build → `''`, so URLs stay **relative** (`/media/...`).
 *    Relative URLs are portable and correct when media is served same-origin as the
 *    site. The localhost fallback is deliberately dev-only so a production build can
 *    never bake a `localhost:4444` URL into the static HTML.
 */
export function resolveMediaBase(configured: string | undefined, isDev: boolean): string {
  const raw = configured ?? (isDev ? 'http://localhost:4444' : '')
  return raw.replace(/\/+$/, '')
}
