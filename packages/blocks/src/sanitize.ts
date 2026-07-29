/** #857 — validation boundary for author-controlled block fields that reach an `href`
 *  or inline-`style` sink in the published (public) site output. Content can be POSTed
 *  directly regardless of what the editor UI validates (the #362/#13 "UI-only gate"
 *  class), so the guard must live at the render sink, not the editor.
 *
 *  Every export here is an ALLOWLIST (accept the known-good shapes, reject everything
 *  else → null/false), not a blocklist. Kill-shotted in
 *  packages/blocks/test/sanitize.test.ts — disable a guard and its RED case fires. */
import { normalizeUrlInput } from './url-normalize'

/** Resolve an author-controlled link `href` to a value safe to put on an `<a href>`, or
 *  `null` when it must NOT become a live link. Allowlist: absolute `http(s):`, root-relative
 *  `/…` paths (but NOT `//host` / `/\host`, which are protocol-relative authorities pointing
 *  off-origin), `mailto:`, `tel:`, and pure `#…` fragments. Everything else — `javascript:`,
 *  `data:`, `vbscript:`, `file:`, any other scheme, and bare-relative paths — returns null.
 *
 *  Astro escapes the attribute *value* but not the URL *scheme*, so a persisted
 *  `javascript:`/`data:text/html` href renders as a clickable link that executes in the
 *  site origin — and middle-click / open-in-new-tab / no-JS all bypass any client-side
 *  guard, so callers must render the label as non-link text (a `<span>`, keeping classes)
 *  when this returns null. Sibling of `safeMediaHref` (media assets) — same allowlist
 *  philosophy, different accepted set (media never linked via mailto/tel/#).
 *
 *  #968: the accepted value comes back NORMALIZED (`normalizeUrlInput`), never the raw
 *  input — callers put the return value on the element, so the string that was validated
 *  has to be the one the browser parses. Enforced by the '#968: an accepted href comes
 *  back normalized' case in packages/blocks/test/sanitize.test.ts. */
export function safeLinkHref(href: string | undefined): string | null {
  if (typeof href !== 'string') return null
  // #968: strip the ASCII tab/LF/CR the URL parser drops before parsing, FIRST — every
  // shape check below is positional, and a stripped character sitting inside the window
  // it inspects made the string mean something different to the parser than to the check
  // (`"/\t/evil.example"` → `https://evil.example/`). Normalized, it collapses to
  // `"//evil.example"` and the protocol-relative branch rejects it.
  const raw = normalizeUrlInput(href)
  if (raw === '') return null
  if (/^https?:\/\//i.test(raw)) return raw
  // Root-relative only: a second `/` OR `\` forms a protocol-relative authority
  // (`//host`, `/\host` — the WHATWG URL parser normalizes `\` to `/`) instead of a
  // same-origin path.
  if (raw.startsWith('/') && !/^\/[/\\]/.test(raw)) return raw
  if (/^(mailto:|tel:)/i.test(raw)) return raw
  if (raw.startsWith('#')) return raw
  return null
}

// A CSS injection needs a `;` (to append a declaration), a `(` (a function like
// `url(...)`/`expression(...)`), a `:` (a nested declaration), or whitespace — none of
// which appear in any of the shapes below. So the allowlist doubles as the guard.
const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB =
  /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i
const HSL =
  /^hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+%?\s*)?\)$/i
const NAMED = /^[a-zA-Z]+$/ // keyword/named color: letters only can't break out of a value

/** True when `value` is a CSS color safe to interpolate into an inline `style` string:
 *  a hex color (matches the `#rrggbbaa` shape the editor's color control emits), an
 *  `rgb()/rgba()/hsl()/hsla()` function, or a bare keyword/named color. A value like
 *  `red;background:url(https://third-party/x)` injects an extra declaration (off-origin
 *  request / full-viewport overlay) — it fails every branch and is rejected. Callers drop
 *  the custom property entirely when this is false. */
export function isSafeColor(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    (HEX.test(value) || RGB.test(value) || HSL.test(value) || NAMED.test(value))
  )
}

const TEXT_ALIGN = new Set(['center', 'right', 'justify'])

/** Clamp a node's author-controlled `align` attribute to the value safe to interpolate
 *  into `text-align:${align}`, or `undefined` to emit no style at all. `left`/absent are
 *  the clean default (no style, matching the converter, which only annotates center/right),
 *  so they also return undefined. Anything outside the allowlist — `right;position:fixed`
 *  and friends — is dropped. Mirrored by the `matches` constraint on the paragraph/heading/
 *  th/td `align` attributes in apps/site/markdoc.config.mjs (declaration + render-sink
 *  clamp, defence in depth). */
export function safeTextAlign(align: string | undefined): string | undefined {
  return typeof align === 'string' && TEXT_ALIGN.has(align) ? align : undefined
}
