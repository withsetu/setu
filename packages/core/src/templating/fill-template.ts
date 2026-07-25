/**
 * The shared `{{token}}` engine (#499, epic #497).
 *
 * Setu has exactly two mini-DSLs: `:colon` path tokens (permalinks — strict and
 * traversal-hardened, unrelated to this file) and `{{mustache}}` CONTENT tokens. Everything
 * content-shaped — SEO titles, email subjects and bodies, and whatever comes next —
 * standardizes on `{{token}}` and goes through this module, so there is one syntax, one
 * escaping policy and one unknown-token rule instead of a per-feature reinvention. This code
 * was `fillTemplate` inside seo/resolve-seo.ts until #499 promoted it; resolveSeo now calls it
 * with `{ singleLine: true }`, which is exactly what it used to do inline.
 *
 * Two rules worth reading before you use it:
 *
 * 1. **Escaping is on by default in an HTML context.** Every substituted value is
 *    HTML-escaped unless the token's own {@link TokenSpec} declares `rawHtml`. `rawHtml` lives
 *    in the VOCABULARY — i.e. in code — never in the template text, so a template author (an
 *    admin editing Settings → Email) has no syntax with which to opt a value out of escaping.
 *    Enforced by packages/core/test/templating/fill-template.test.ts ("escapes a rawHtml-named
 *    token when the vocabulary does not declare it") and, end to end, by
 *    packages/core/test/email/email-registry.test.ts.
 *
 * 2. **Unknown tokens are STRIPPED, not left literal.** `{{nope}}` renders as the empty string.
 *    That is the behavior the promoted SEO helper always had, so one rule now covers every
 *    context, and a typo can never ship `{{nope}}` into a recipient's inbox. Authoring-time
 *    feedback is the right place to catch the typo instead: {@link unknownTokensIn} drives the
 *    inline warning in the template editor.
 */

/** A token in some context's vocabulary — the palette the editor shows, and the list that
 *  decides which values skip escaping. */
export interface TokenSpec {
  /** The name between the braces, e.g. `reset_url` for `{{reset_url}}`. */
  name: string
  /** One-line explanation shown in the editor's token palette. */
  description: string
  /**
   * Substitute this token's value VERBATIM in an HTML context instead of escaping it.
   *
   * Reserved for values the SERVER produces: a reset URL that goes inside an `href`, or a
   * pre-escaped block of markup such as a submission's field table. It must never be set for
   * anything a template author, a form submitter or an email recipient can influence — the
   * value's own producer is then responsible for escaping the parts that came from outside
   * (see `formNotificationValues` in ../email/templates/form-notification.ts, whose per-field
   * escaping is kill-shot tested in packages/core/test/email/email-registry.test.ts).
   */
  rawHtml?: boolean
}

/**
 * A token's value. A plain string is used in both the HTML and the plain-text part; the
 * `{ html, text }` pair supplies each part separately, which is how one `{{fields}}` token can
 * be a table in the HTML body and indented lines in the text body without the author having to
 * know which part they are editing.
 */
export type TokenValue = string | { html: string; text: string } | undefined

export type TokenValues = Record<string, TokenValue>

/** The token grammar: `{{name}}`, optionally padded. Deliberately `\w+` and nothing else —
 *  there is no syntax for an argument, a value, a filter or a nested expression, which is the
 *  structural reason a template can never supply its own value for a server-generated token
 *  like `{{reset_url}}`. Pinned by fill-template.test.ts ("leaves non-token braces alone"). */
const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g

/** Escape the five HTML-significant characters. The single implementation for the whole
 *  codebase — submission-service.ts used to carry a private copy. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface FillOptions {
  /** `'html'` escapes every substituted value except the vocabulary's `rawHtml` tokens;
   *  `'text'` substitutes verbatim, there being no markup context to break out of.
   *  Default `'text'`. */
  context?: 'html' | 'text'
  /** The context's token vocabulary. Only `rawHtml` is read here — an unlisted token still
   *  substitutes (escaped), so a caller with no vocabulary gets escape-everything, the safe
   *  default. */
  vocabulary?: readonly TokenSpec[]
  /** Collapse every whitespace run (including CR/LF) to a single space and trim. Used for
   *  values that are structurally one line: SEO titles and email SUBJECTS. For a subject this
   *  is also the header-injection floor — a CR/LF from the template OR from a substituted
   *  value cannot survive into a mail header. */
  singleLine?: boolean
}

const partOf = (v: TokenValue, context: 'html' | 'text'): string => {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return context === 'html' ? v.html : v.text
}

/**
 * Replace every `{{token}}` in `tpl` with its value from `values`.
 *
 * Single pass: a substituted value is never re-scanned, so a value that happens to contain
 * `{{...}}` is inert rather than a second round of expansion (pinned by
 * fill-template.test.ts "does not re-scan a substituted value for tokens").
 */
export function fillTemplate(
  tpl: string,
  values: TokenValues,
  opts: FillOptions = {}
): string {
  const context = opts.context ?? 'text'
  const raw = new Set(
    (opts.vocabulary ?? []).filter((t) => t.rawHtml === true).map((t) => t.name)
  )
  const out = tpl.replace(TOKEN_RE, (_, name: string) => {
    const part = partOf(values[name], context)
    if (part === '') return ''
    return context === 'html' && !raw.has(name) ? escapeHtml(part) : part
  })
  return opts.singleLine === true ? out.replace(/\s+/g, ' ').trim() : out
}

/** The token names a template uses, in first-appearance order, de-duplicated. */
export function tokenNamesIn(tpl: string): string[] {
  const seen = new Set<string>()
  for (const m of tpl.matchAll(TOKEN_RE)) seen.add(m[1] as string)
  return [...seen]
}

/** The token names a template uses that the vocabulary does NOT define — i.e. the ones that
 *  will render as nothing. Drives the editor's inline "unknown token" warning, which is the
 *  authoring-time counterpart to the strip-at-render rule. */
export function unknownTokensIn(
  tpl: string,
  vocabulary: readonly TokenSpec[]
): string[] {
  const known = new Set(vocabulary.map((t) => t.name))
  return tokenNamesIn(tpl).filter((n) => !known.has(n))
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

/**
 * Derive a plain-text email part from an HTML one.
 *
 * Used only when an admin has overridden a template's HTML body but not its (optional) text
 * body: without this the multipart message would pair the customized HTML with the SHIPPED
 * text, so a text-only client would show wording the admin thought they had replaced. Every
 * shipped type also carries a hand-written `defaultText`, which is preferred whenever the HTML
 * has not been overridden — this is the fallback, not the primary path
 * (packages/core/test/email/email-registry.test.ts, "text part").
 *
 * Deliberately a small deterministic transform, not an HTML parser: block-level tags become
 * line breaks, `<a>` keeps its URL in parentheses, script/style content is dropped, entities
 * are decoded, and blank-line runs are collapsed.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // A link keeps its destination — an email body whose URLs vanished is useless.
    .replace(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, label: string) => `${label.trim()} (${href})`
    )
    .replace(/<\/t[dh]>\s*(?=<t[dh]\b)/gi, ': ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#?\w+;/g, (m) => ENTITIES[m.toLowerCase()] ?? m)
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
