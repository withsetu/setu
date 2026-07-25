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
 * 1. **The context is a REQUIRED argument, and an HTML context escapes everything.** In an HTML
 *    context every substituted value is HTML-escaped unless the token's own {@link TokenSpec}
 *    declares `rawHtml`. `rawHtml` lives in the VOCABULARY — i.e. in code — never in the template
 *    text, so a template author (an admin editing Settings → Email) has no syntax with which to
 *    opt a value out of escaping.
 *
 *    There is deliberately NO default context (#936). It used to default to `'text'`, the
 *    non-escaping mode, so an HTML caller that omitted it substituted verbatim with no type
 *    error and no runtime symptom until some value carried markup — the one place in this
 *    subsystem where the safe path was opt-in. Flipping the default to `'html'` instead would
 *    have entity-escaped SEO titles, so the signature carries the decision: omitting `context`
 *    (or `opts` entirely) is a compile error, pinned by
 *    packages/core/test/templating/fill-template.test.ts ("is a compile error to omit the
 *    context", whose `@ts-expect-error` directives fail the typecheck the moment the member goes
 *    back to optional). The escaping behavior itself is enforced by the same file ("escapes a
 *    rawHtml-named token when the vocabulary does not declare it") and, end to end, by
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
   *
   *  REQUIRED, with no default — see rule 1 in the module header (#936). Every caller knows
   *  which part of a message it is building; the type system now makes it say so. */
  context: 'html' | 'text'
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
  opts: FillOptions
): string {
  const context = opts.context
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
 * The hard ceiling on what {@link htmlToPlainText} will scan (#941).
 *
 * The 20 KB template cap does NOT bound this function's input: the input is the RENDERED body,
 * which carries visitor-supplied field content and grows again when that content is
 * HTML-escaped. Since `renderEmailTemplate` reaches here on every send whose HTML body was
 * overridden, and that send is triggered by the anonymous `/forms/submit` route, "however big
 * the render came out" is not an acceptable answer for how much work one submission may cost.
 *
 * 100 KB is several times the largest body any shipped template can produce, and small enough
 * that the worst adversarial input found for the whole chain costs ~56 ms rather than minutes
 * (measured; see packages/core/test/templating/fill-template.test.ts, "finishes pathological
 * markup inside a generous wall-clock bound", which asserts the bound this backs). The cut is a
 * plain slice, so it can land inside a tag — this is a best-effort text derivation, and a
 * truncated tail is stripped by the tag pass like any other.
 */
export const HTML_TO_TEXT_MAX_INPUT = 100_000

/**
 * Remove every `<!-- … -->` span in one forward pass.
 *
 * Exactly what `/<!--[\s\S]*?-->/g` matched, without its cost: that pattern re-scanned the whole
 * remaining input from EVERY unclosed `<!--`: on 100 KB of them the pattern measures ~470 ms and
 * this walk ~1 ms. `indexOf` resumes where the last span ended, and the first `<!--` with no
 * `-->` after it ends the walk — no later one can have one either.
 *
 * The BOUND is pinned by packages/core/test/templating/fill-template.test.ts ("drops unclosed
 * comments in one pass, not one per comment"). The OUTPUT — that this still removes what the
 * pattern removed, and still leaves what it left — is pinned by the same file's "removes comment
 * spans exactly as the pattern it replaced did", which is the assertion that fails if the walk's
 * arithmetic drifts. It needed writing: no existing input in the suite contained an HTML comment
 * at all, so changing `close + 3` to `close + 2` passed all 1439 core tests.
 */
function stripComments(html: string): string {
  let out = ''
  let cursor = 0
  for (;;) {
    const open = html.indexOf('<!--', cursor)
    if (open === -1) break
    const close = html.indexOf('-->', open + 4)
    if (close === -1) break
    out += html.slice(cursor, open)
    cursor = close + 3
  }
  return cursor === 0 ? html : out + html.slice(cursor)
}

/** Closers for {@link stripScriptStyle}, built per call — a module-level `/g` regex would carry
 *  `lastIndex` between calls. */
const scriptStyleClosers = (): Map<string, RegExp> =>
  new Map([
    ['script', /<\/script>/gi],
    ['style', /<\/style>/gi]
  ])

/**
 * Remove every `<script …>…</script>` / `<style …>…</style>` span in one forward pass.
 *
 * Same shape and same reason as {@link stripComments}, for the same defect:
 * `/<(script|style)\b[^<>]*>[\s\S]*?<\/\1>/gi` re-scanned the remaining input from every UNCLOSED
 * opener: on 100 KB of `<script>` the pattern measures ~100 ms and this walk ~2 ms. Each closer
 * search resumes from its own opener and every consumed span moves the cursor forward, so
 * successful searches cost O(input) in total; `exhausted` caps the failing ones at one scan per
 * tag name, since a closer not found from position p can never be found from any q >= p.
 *
 * Output equivalence to the pattern it replaced is pinned by
 * packages/core/test/templating/fill-template.test.ts ("removes script and style spans exactly as
 * the pattern it replaced did"), which covers the cases the tag-name backreference decides:
 * `<script>` may not be closed by `</style>`, an unclosed `<script>` must not swallow a later
 * well-formed `<style>` span, and the match is case-insensitive on both ends.
 */
function stripScriptStyle(html: string): string {
  const open = /<(script|style)\b[^<>]*>/gi
  const closers = scriptStyleClosers()
  const exhausted = new Set<string>()
  let out = ''
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(html)) !== null) {
    const tag = (m[1] as string).toLowerCase()
    if (exhausted.has(tag)) continue
    const closer = closers.get(tag) as RegExp
    closer.lastIndex = m.index + m[0].length
    const close = closer.exec(html)
    if (close === null) {
      exhausted.add(tag)
      continue
    }
    out += html.slice(cursor, m.index)
    cursor = close.index + close[0].length
    // Resume scanning after the span we just consumed, which is what a /g replace would do.
    open.lastIndex = cursor
  }
  return cursor === 0 ? html : out + html.slice(cursor)
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
 * One case is deliberately conceded back (#920): when this returns nothing — markup with no
 * words in it, such as an image-only body — `renderEmailTemplate` sends the shipped text after
 * all, accepting exactly the mismatch described above. An empty text part is worse than a stale
 * one, because a text-only client would render a blank message. See
 * {@link RenderedEmail.textSource} in ../email/template-registry.ts; pinned by
 * packages/core/test/email/email-registry.test.ts ("an overridden body whose text derivation is
 * empty falls back to the shipped text").
 *
 * Deliberately a small deterministic transform, not an HTML parser: block-level tags become
 * line breaks, `<a>` keeps its URL in parentheses, script/style content is dropped, entities
 * are decoded, and blank-line runs are collapsed.
 *
 * **Every tag-internal run is `[^<>]`, never `[^>]` (#941).** An attribute run that may swallow
 * `<` does not stop at the next tag, so on markup with unterminated tags the engine re-scans
 * from every `<a`/`<` in the document: with `[^>]` this measured ~2 s on 100 KB of `'<a'`, and
 * ~22 minutes (cubic in the input) on 100 KB of `'<a href="x'`. Bounding each run to its own tag
 * makes the same corpus finish in single-digit milliseconds. `[^<>]` also rejects a `<` inside an
 * attribute VALUE, which the old runs accepted — no shipped template has one, and this was never
 * an HTML parser. Enforced by packages/core/test/templating/fill-template.test.ts ("finishes
 * pathological markup inside a generous wall-clock bound").
 *
 * The anchor LABEL is a BOUNDED lazy run, `{0,4000}?` rather than `*?`. Unbounded, it was the
 * second-largest cost left: an unclosed `<a>` made it scan the whole remainder, i.e. the
 * O(unclosed anchors x input) shape #941 named. Flattening it to `[^<]*` would have removed the
 * cost but also the URL from `<a href="…"><strong>Reset</strong></a>` — ordinary HTML-email shape
 * whose URL is the only actionable thing in a password-reset body. The bound keeps both: a label
 * with inline markup still resolves, and a missing `</a>` costs 4000 steps instead of 100,000. A
 * label longer than 4000 characters is not treated as a link (its text survives, its URL does
 * not); no shipped template comes within two orders of magnitude of that. Both halves are pinned
 * by packages/core/test/templating/fill-template.test.ts ("keeps the URL of a link whose label
 * carries inline markup" and "finishes pathological markup inside a generous wall-clock bound").
 */
export function htmlToPlainText(html: string): string {
  const bounded =
    html.length > HTML_TO_TEXT_MAX_INPUT
      ? html.slice(0, HTML_TO_TEXT_MAX_INPUT)
      : html
  // Step order is unchanged from before #941: script/style spans go first, then comments.
  const text = stripComments(stripScriptStyle(bounded))
    .replace(/<br\s*\/?>/gi, '\n')
    // A link keeps its destination — an email body whose URLs vanished is useless.
    .replace(
      /<a\b[^<>]*\bhref\s*=\s*["']([^"']*)["'][^<>]*>([\s\S]{0,4000}?)<\/a>/gi,
      (_, href: string, label: string) => `${label.trim()} (${href})`
    )
    .replace(/<\/t[dh]>\s*(?=<t[dh]\b)/gi, ': ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|blockquote)>/gi, '\n\n')
    .replace(/<[^<>]+>/g, '')
    .replace(/&#?\w+;/g, (m) => ENTITIES[m.toLowerCase()] ?? m)
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
