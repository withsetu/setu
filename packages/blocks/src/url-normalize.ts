/** #968 — the pre-parse normalization every author-controlled URL guard in this package
 *  runs BEFORE it inspects a string's shape.
 *
 *  The WHATWG URL parser removes every ASCII tab (U+0009), LF (U+000A) and CR (U+000D)
 *  from its input before parsing anything, so a positional shape check on the raw string
 *  can be reading characters the browser will never see. The #857 guards tested only
 *  offsets 0–1 for a protocol-relative authority, which meant `"/\t/evil.example"` passed
 *  (offset 1 holds a tab, not `/` or `\`) and then resolved to `https://evil.example/`.
 *  Markdoc string escapes make that authorable verbatim: `href="/\t/evil.example"` in a
 *  `.mdoc` parses to an attribute containing a real tab.
 *
 *  Normalizing first — and handing the normalized value back to the caller, so the string
 *  that was validated is byte-identical to the one the browser parses — collapses
 *  `"/\t/evil.example"` to `"//evil.example"`, which the existing protocol-relative branch
 *  already rejects. No new positional special case, and every future branch inherits it.
 *  The trailing `.trim()` folds in the leading/trailing-whitespace handling the callers
 *  did separately.
 *
 *  Enforced by packages/blocks/test/url-normalize.test.ts (this function), by the
 *  smuggled-authority cases in packages/blocks/test/sanitize.test.ts and
 *  packages/blocks/test/safe-media-href.test.ts (the guards), and at the real render sink
 *  by apps/site/test/url-guard-sinks.test.ts (the built HTML). */
export function normalizeUrlInput(value: string): string {
  return value.replace(/[\t\n\r]/g, '').trim()
}
