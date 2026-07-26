/** The placeholder that replaces anything credential-shaped. Recognisable on sight in a log. */
const REDACTED = '[redacted]'

/** A URL run inside a logged body. Stops at whitespace and at the delimiters that end a URL in
 *  HTML (`"` `'` `<` `>`) — so an `href="…"` link is matched without its quotes. Trailing
 *  wrapping punctuation is trimmed off separately (see `URL_TRAILING_JUNK_RE`).
 *
 *  No `\b` in front: `\b` requires a non-word character before the `h`, so `_https://…/<token>_`
 *  (markdown emphasis around a link — an admin can write that in a template since #499) matched
 *  NOTHING and the whole URL, token included, printed verbatim. Without it the scan starts at any
 *  `http://`, which at worst matches one URL-ish run too many — the safe direction here.
 *  packages/email-console/test/redact.test.ts, "a word character directly in front". */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

/** The characters a URL may legitimately END with. Anything else trailing a matched run is prose
 *  or markup wrapping — a full stop, a markdown link's `)`, a `]`, an emphasis `*`, a typographic
 *  quote — and is cut off before the shape test, then re-appended verbatim.
 *
 *  An ALLOWLIST, deliberately: #910 was a denylist (`[.,;:!?]+$`) that listed sentence
 *  punctuation and no brackets, so `[Reset](…/<token>)` parsed `<token>)` as one path segment,
 *  failed the shape test and printed a credential. Every character nobody thinks of costs a leak,
 *  while trimming one too many costs nothing at all — the trimmed characters are put back
 *  unchanged, so the log line is byte-identical either way. That is also why balance-matching a
 *  wrapper (keeping the `)` of `…/wiki/Foo_(bar)`) is NOT attempted: it would buy no fidelity and
 *  would reopen the leak for any URL whose last segment happens to contain a bracket. Both
 *  directions pinned by packages/email-console/test/redact.test.ts. */
const URL_TRAILING_JUNK_RE = /[^A-Za-z0-9/_~%=+&#$@-]+$/

/** A credential-shaped RUN anywhere inside a URL component — see `isTokenShaped` for the shape
 *  and why it is blunt. Applied to path, fragment and query values rather than testing each whole
 *  component, so a token glued to something the trim does not reach (`…/<token>.html`,
 *  `?next=/reset/<token>`, `#https://…/<token>`) still goes. Pinned by the "#910" block of
 *  packages/email-console/test/redact.test.ts. */
const TOKEN_RUN_RE = /[A-Za-z0-9_-]{16,}/g

const redactTokenRuns = (value: string): string =>
  value.replace(TOKEN_RUN_RE, REDACTED)

/** Query-param names whose value is treated as a credential whatever it looks like. Substring
 *  match on the lowercased name, so `resetToken`, `api_key` and `X-Sig` are all covered. */
const SECRET_PARAM_WORDS = [
  'token',
  'secret',
  'key',
  'code',
  'password',
  'passwd',
  'pwd',
  'otp',
  'sig',
  'hash',
  'auth',
  'credential',
  'session',
  'jwt',
  'nonce'
]

const isSecretParamName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return SECRET_PARAM_WORDS.some((word) => lower.includes(word))
}

/** Credential shape: 16+ characters from the URL-safe token alphabet and nothing else. That is
 *  what better-auth's `generateId(24)` reset token looks like as a path segment
 *  (dist/api/routes/password.mjs), and equally what hex, base64url, nanoid and UUID tokens look
 *  like — the test that matters is the shape, not who produced it, so no future sender can leak
 *  a credential here by forgetting to flag it.
 *
 *  Deliberately blunt in the SAFE direction: a long human slug (`the-best-blog-post-ever`) has
 *  the same shape and is redacted too. The cost is one less-readable link in a dev log line; the
 *  cost of the other error is a live credential in stdout. Both directions are pinned by
 *  packages/email-console/test/redact.test.ts. */
const isTokenShaped = (value: string): boolean =>
  /^[A-Za-z0-9_-]{16,}$/.test(value)

function redactUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    // Unparseable: we cannot tell which part is the credential, so drop the whole thing.
    return REDACTED
  }

  const path = redactTokenRuns(url.pathname)

  let search = ''
  if (url.search) {
    const parts: string[] = []
    for (const [name, value] of url.searchParams) {
      // The NAME is redacted too (#943). `?<url-with-token>` — a click-tracking wrapper an admin
      // can write since #499 — makes `searchParams` read an entire inner URL, token included, as a
      // single NAME with an empty value, so a value-only pass printed the credential verbatim.
      // `redactParamValue` still receives the ORIGINAL name: `isSecretParamName` keys on the word
      // inside it, which redaction can consume. Pinned by
      // packages/email-console/test/redact.test.ts ("the query-NAME position").
      parts.push(`${redactParamName(name)}=${redactParamValue(name, value)}`)
    }
    search = `?${parts.join('&')}`
  }

  // The fragment gets the run treatment rather than a whole-value shape test, because a template
  // can park a whole other URL there (`…/x#https://…/<token>`) and that is not token-shaped.
  const hash = url.hash ? `#${redactTokenRuns(url.hash.slice(1))}` : ''

  // `url.host` (not `url.href`) is what drops any `user:password@` userinfo — a credential in
  // its own right, and one no other branch here would catch.
  return `${url.protocol}//${url.host}${path}${search}${hash}`
}

/** A param NAME, redacted to the same depth as a value: a nested URL recurses (which is what drops
 *  its `user:password@` userinfo — the run pass alone cannot see a short password), anything else
 *  gets the run treatment. Not percent-encoded, unlike the value path: a name is printed verbatim
 *  today and encoding it would cost log readability without covering any position.
 *  Pinned by packages/email-console/test/redact.test.ts ("the query-NAME position"). */
function redactParamName(name: string): string {
  if (/^https?:\/\//i.test(name)) return redactUrl(name)
  return redactTokenRuns(name)
}

function redactParamValue(name: string, value: string): string {
  if (isSecretParamName(name)) return REDACTED
  // A nested link (better-auth's own `callbackURL`, and any "next"/"return" param) can carry a
  // token of its own; recurse rather than trust the outer name.
  if (/^https?:\/\//i.test(value)) return encodeURIComponent(redactUrl(value))
  // Whole-value first, so the common case keeps a readable, unencoded `[redacted]`; the run pass
  // then catches a token that is only PART of the value (`?next=/reset/<token>`).
  if (isTokenShaped(value)) return REDACTED
  return encodeURIComponent(redactTokenRuns(value))
}

/**
 * Strip credential-shaped material out of every URL in `text`.
 *
 * This is the console adapter's defence in depth for #894: a password-reset link carries its
 * token in the URL path, so an adapter that prints message bodies verbatim can print a working
 * credential to stdout. Keying on the SHAPE of the value rather than on a sender-supplied "this
 * is sensitive" flag is the point: no sender has to remember to mark anything, so a send path
 * added later inherits the redaction (the reset gate in apps/api/src/reset-email-gate.ts is the
 * other half, and it can only cover the paths it knows about).
 *
 * What it does NOT do, because #910 is what over-claiming here cost: this is a heuristic over
 * text, not a parser, and it is only as good as its idea of where a URL starts and stops. A secret
 * pasted into prose as a bare word is not redacted (no Setu email does that, and a free-text
 * heuristic would eat real content), and neither is one inside a transport-encoded blob it cannot
 * see into. The layer is a net, not a guarantee — routing a credential-bearing message to a
 * logging transport is still the bug.
 *
 * The POSITIONS of a recognised URL, exhaustively, so the next reader can see which are scanned
 * rather than infer it (#943 was the query-NAME position, unscanned while its three siblings were
 * covered — a value-only loop, one string interpolation wide):
 *   - path, fragment, query NAMES and query VALUES → credential-shaped runs redacted, nested URLs
 *     recursed into; each pinned by its own case in packages/email-console/test/redact.test.ts
 *   - userinfo (`user:password@`) → dropped entirely, by rebuilding from `url.host`
 *   - protocol, host and port → NOT scanned, deliberately: a credential does not live there, and
 *     run-scanning a hostname would redact ordinary long subdomains for nothing (also pinned, so
 *     changing that is a deliberate act)
 *
 * Since #499 the bodies are ADMIN-authored, which is why the covered shapes now include markdown
 * links, parentheses, brackets and emphasis around a link: packages/email-console/test/redact.test.ts
 * ("wrapping punctuation and adjacency"), plus apps/api/test/reset-password-leak.test.ts against
 * a REAL better-auth token rendered through a REAL customized template.
 */
export function redactSecretsInUrls(text: string): string {
  return text.replace(URL_RE, (match) => {
    const trailing = URL_TRAILING_JUNK_RE.exec(match)?.[0] ?? ''
    const url = trailing ? match.slice(0, -trailing.length) : match
    return redactUrl(url) + trailing
  })
}
