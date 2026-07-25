/** Resolve a media `src` to a safe anchor `href`, or `null` when it must not become
 *  a link. Allowlist (not blocklist): absolute http(s) URLs pass through unchanged;
 *  root-relative `/...` paths get the media base prefixed. Everything else returns
 *  null — `javascript:`/`data:`/`vbscript:`/any other scheme, protocol-relative
 *  `//host` (which would resolve to a foreign origin once the base is `''` in a
 *  production build), its backslash twin `/\host` (the WHATWG URL parser
 *  normalizes `\` to `/` in special-scheme URLs, so it is the same external
 *  authority in disguise), and bare relative paths (no reliable full-size
 *  resolution).
 *
 *  Callers render the media itself either way and simply skip the anchor wrapper on
 *  null: an author-persisted `src: "javascript:alert(1)"` must never become a live
 *  link on the published site (middle-click / open-in-new-tab / no-JS all bypass any
 *  client-side preventDefault). Shared here so every media block that links out to
 *  its asset (gallery lightbox today; video/section-style blocks tomorrow) goes
 *  through the same seam. */
export function safeMediaHref(src: string, base: string): string | null {
  if (/^https?:\/\//i.test(src)) return src
  // Root-relative only: a second `/` OR `\` would form a protocol-relative
  // authority (`//host`, `/\host`) instead of a same-origin path.
  if (src.startsWith('/') && !/^\/[/\\]/.test(src)) return `${base}${src}`
  return null
}

/** Resolve a media `src`/`poster` to the URL a block renders it from, or `null` when it
 *  must not be loaded. Same allowlist as `safeMediaHref` — absolute `http(s):` unchanged,
 *  root-relative `/…` prefixed with the media base — but named for the display sink (a
 *  `<video src>`/`<img src>`) rather than an anchor. #857: the {% video %} block used a
 *  local `resolveUrl` that returned non-http/non-root strings UNCHANGED, so a
 *  protocol-relative `//host` src (or its `/\host` backslash twin) loaded media from an
 *  attacker-chosen origin. Routing through here closes that; behavior for http(s) and
 *  root-relative srcs is identical to the old local resolver. Callers skip rendering the
 *  element (or drop the attribute) on null. */
export function resolveMediaSrc(src: string, base: string): string | null {
  return safeMediaHref(src, base)
}
