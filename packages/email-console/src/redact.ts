/** The placeholder that replaces anything credential-shaped. Recognisable on sight in a log. */
const REDACTED = '[redacted]'

/** A URL run inside a logged body. Stops at whitespace and at the delimiters that end a URL in
 *  HTML (`"` `'` `<` `>`) — so an `href="…"` link is matched without its quotes. Trailing
 *  sentence punctuation is trimmed off separately (see `redactSecretsInUrls`), because
 *  `…/reset-password/<token>.` would otherwise parse the token and the full stop as ONE path
 *  segment and slip past the token shape test. */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi

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

  const path = url.pathname
    .split('/')
    .map((segment) => (isTokenShaped(segment) ? REDACTED : segment))
    .join('/')

  let search = ''
  if (url.search) {
    const parts: string[] = []
    for (const [name, value] of url.searchParams) {
      parts.push(`${name}=${redactParamValue(name, value)}`)
    }
    search = `?${parts.join('&')}`
  }

  const fragment = url.hash.slice(1)
  const hash = url.hash
    ? isTokenShaped(fragment)
      ? `#${REDACTED}`
      : url.hash
    : ''

  // `url.host` (not `url.href`) is what drops any `user:password@` userinfo — a credential in
  // its own right, and one no other branch here would catch.
  return `${url.protocol}//${url.host}${path}${search}${hash}`
}

function redactParamValue(name: string, value: string): string {
  if (isSecretParamName(name)) return REDACTED
  // A nested link (better-auth's own `callbackURL`, and any "next"/"return" param) can carry a
  // token of its own; recurse rather than trust the outer name.
  if (/^https?:\/\//i.test(value)) return encodeURIComponent(redactUrl(value))
  if (isTokenShaped(value)) return REDACTED
  return encodeURIComponent(value)
}

/**
 * Strip credential-shaped material out of every URL in `text`.
 *
 * This is the console adapter's defence in depth for #894: a password-reset link carries its
 * token in the URL path, so an adapter that prints message bodies verbatim can print a working
 * credential to stdout. Redacting by SHAPE rather than by a sender-supplied "this is sensitive"
 * flag is the point — it holds no matter which code path routes a message here, including
 * future ones (the reset gate in apps/api/src/reset-email-gate.ts is the other half, and it can
 * only cover the paths it knows about).
 *
 * Scope, stated honestly: this redacts URL path segments, query values and fragments. A secret
 * pasted into prose as a bare word is NOT redacted — no Setu email does that today, and a
 * heuristic over free text would eat real content. Enforced by
 * packages/email-console/test/redact.test.ts and, against a REAL better-auth token,
 * apps/api/test/reset-password-leak.test.ts.
 */
export function redactSecretsInUrls(text: string): string {
  return text.replace(URL_RE, (match) => {
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? ''
    const url = trailing ? match.slice(0, -trailing.length) : match
    return redactUrl(url) + trailing
  })
}
