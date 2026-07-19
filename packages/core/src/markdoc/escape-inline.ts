/** The inline escaping contract (#652 / #675 / #676 / #677).
 *
 *  ## Why this module exists
 *
 *  Reading and writing are supposed to be exact inverses: `write(read(s)) === s`.
 *  The reader (`to-tiptap`) gets its text from markdown-it, which has ALREADY
 *  resolved every `\x` escape — a Tiptap text node therefore holds the LITERAL
 *  characters the author meant. Nothing is lost there and nothing should be
 *  "un-stripped"; the inverse is owed entirely by the writer.
 *
 *  The writer used to owe it to `Markdoc.format`, which escapes text with two
 *  ad-hoc rules (`/[*_~]/g` inside strong/em/s, `/^\*|#+\s|^>/` — non-global —
 *  everywhere else). That is not an inverse of markdown-it:
 *
 *    - it never escapes `\`, so `\\` eroded to `\` and `\_x` to `_x` (#675);
 *    - it never escapes `` ` ``, `[`, `]`, so `a \*x\* b` re-parsed as real
 *      emphasis and `\[y\](/x)` became a live link (#652);
 *    - `#+\s` matches ANYWHERE, not just at a line start, so a `#` mid-text
 *      gained a backslash on one pass and lost it on the next — the file never
 *      settled and two consecutive saves produced two different diffs (#676).
 *
 *  So the writer now owns escaping outright, in this one place.
 *
 *  ## The contract
 *
 *  Text-node content is LITERAL. On the way out it is escaped so that reading it
 *  back yields exactly the same literal string, and so that escaping is
 *  IDEMPOTENT (escape(unescape(escape(x))) === escape(x)).
 *
 *  Escaped everywhere in text content, because these can start an inline
 *  construct at any offset:
 *
 *    `\`  — otherwise it consumes the next character
 *    '`'  — opens a code span
 *    `*`  — emphasis (CommonMark allows it intraword)
 *    `[`  `]` — links, images, reference definitions
 *    `<`  — autolinks and raw HTML
 *
 *  Escaped conditionally, because escaping them unconditionally would rewrite
 *  huge amounts of already-canonical prose for no gain:
 *
 *    `_`  — only when NOT intraword; GFM never emphasises `snake_case`
 *    `~`  — only in a run of two or more (GFM strikethrough)
 *    `&`  — only when it opens an HTML entity (`&amp;`, `&#8212;`, `&#x27;`)
 *    `{`  — only when followed by `%` (a Markdoc tag opening)
 *
 *  Escaped ONLY at the start of a block's inline content — this is the
 *  context-sensitivity #676 got wrong, and the reason it is a parameter here
 *  rather than a regex over the whole string:
 *
 *    `#` (1–6, then space or end) — ATX heading
 *    `>` — blockquote
 *    `-` / `+` followed by space — bullet marker
 *    `1.` / `1)` followed by space — ordered marker
 *    a `-` run of 3+ — thematic break
 *
 *  "Block start" means offset 0 of the first inline child of a paragraph or a
 *  list item, and only when that child carries no marks (a leading `**`/`[`
 *  from a mark already displaces the marker). Heading and table-cell content is
 *  never at a block start: `# a # b` and `| a - b |` need no escape.
 *
 *  ## Inside a code span
 *
 *  Code-span content is literal by definition and must NOT be backslash-escaped
 *  — `` `a\*b` `` means a backslash. Instead the FENCE carries the ambiguity:
 *  the fence is one backtick longer than the longest backtick run in the
 *  content, plus a one-space pad when the content begins or ends with a
 *  backtick (or with a space at both ends). `Markdoc.format` hard-codes a
 *  single backtick and no padding, which split or destroyed any span containing
 *  a backtick (#677).
 *
 *  ## Keeping Markdoc.format's own escaper out of the way
 *
 *  The serializer still routes structure through `Markdoc.format`, so its text
 *  escaper would run on top of ours and double-escape. Escaped output is
 *  therefore handed over with the characters that escaper reacts to (`* _ ~ #
 *  >`) encoded as a two-char sentinel sequence, and `decodeProtected` restores
 *  them once, at the very end of `tiptapToMarkdoc`. The sentinel is U+0000,
 *  which cannot survive a markdown parse (markdown-it rewrites NUL to U+FFFD)
 *  and therefore can never occur in real content.
 */

const SENTINEL = '\u0000'

/** Characters `Markdoc.format`'s text escaper reacts to, and the sentinel digit
 *  each is encoded as. Anything not listed here passes through untouched. */
const PROTECTED: Record<string, string> = {
  '*': '0',
  _: '1',
  '~': '2',
  '#': '3',
  '>': '4'
}

const UNPROTECT: Record<string, string> = Object.fromEntries(
  Object.entries(PROTECTED).map(([char, digit]) => [digit, char])
)

/** Hide the characters `Markdoc.format` would re-escape. Applied to every piece
 *  of already-final inline text the serializer hands to Markdoc. */
export const protectText = (s: string): string =>
  s.replace(/[*_~#>]/g, (c) => SENTINEL + PROTECTED[c]!)

/** Undo `protectText`. Called exactly once, on the finished document. */
export const decodeProtected = (s: string): string =>
  // The control character IS the point: U+0000 is the one byte that cannot
  // survive a markdown parse (markdown-it rewrites it to U+FFFD), which is what
  // makes it collision-proof as a sentinel.
  // eslint-disable-next-line no-control-regex
  s.replace(/\u0000([0-4])/g, (_, digit: string) => UNPROTECT[digit]!)

/** Word character for the intraword-underscore rule. */
const WORD = /[\p{L}\p{N}_]/u

/** An HTML entity reference markdown-it would decode. */
const ENTITY = /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/

/** A thematic break: three or more `-`, optionally spaced. (`*` and `_` runs are
 *  covered because those characters are always escaped.) */
const THEMATIC_BREAK = /^ {0,3}-(?:[ \t]*-){2,}[ \t]*$/

/** A trailing `#` run that CommonMark would eat as an ATX heading's optional
 *  CLOSING sequence. It only counts when preceded by whitespace or when it is the
 *  whole content, so `# a#` is safe but `# a #` silently loses the `#`. */
const ATX_CLOSING = /(^|\s)(#+)$/

/** Where an inline run sits, for the position-dependent rules. */
export interface TextPosition {
  /** Offset 0 of a paragraph's or list item's inline content, where `#`, `>`,
   *  `-` and `1.` are block markers. */
  atBlockStart?: boolean
  /** The LAST inline run of a heading, where a trailing `#` run is the ATX
   *  closing sequence rather than literal text. */
  atHeadingEnd?: boolean
}

/** Escape literal text so that re-parsing it yields the same literal text.
 *  See the module comment for the full contract. */
export function escapeText(text: string, position: TextPosition = {}): string {
  const { atBlockStart = false, atHeadingEnd = false } = position
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const prev = text[i - 1]
    const next = text[i + 1]
    let escape = false
    switch (c) {
      case '\\':
      case '`':
      case '*':
      case '[':
      case ']':
      case '<':
        escape = true
        break
      case '_':
        // Intraword underscores are never emphasis in GFM, so leave
        // `snake_case_name` alone rather than churning every such file.
        escape = !(
          prev !== undefined &&
          next !== undefined &&
          WORD.test(prev) &&
          WORD.test(next)
        )
        break
      case '~':
        escape = prev === '~' || next === '~'
        break
      case '&':
        escape = ENTITY.test(text.slice(i))
        break
      case '{':
        escape = next === '%'
        break
    }
    if (!escape && atBlockStart && i === 0) {
      if (c === '>') escape = true
      else if (c === '#' && /^#{1,6}(?:\s|$)/.test(text)) escape = true
      else if (
        (c === '-' || c === '+') &&
        (next === undefined || /\s/.test(next))
      )
        escape = true
      else if (c === '-' && THEMATIC_BREAK.test(text)) escape = true
    }
    out += escape ? '\\' + c : c
  }
  // An ordered-list marker escapes at the delimiter, not the digits: `1\. x`.
  if (atBlockStart) out = out.replace(/^(\d{1,9})([.)])(\s|$)/, '$1\\$2$3')
  // EVERY `#` in the trailing run is escaped, not just the first: leaving `\###`
  // would put the surviving `##` next to a `#` rather than whitespace, which is
  // not a closing sequence today but relies on a subtler rule than it needs to.
  if (atHeadingEnd)
    out = out.replace(ATX_CLOSING, (_, lead: string, hashes: string) =>
      lead.concat(hashes.replace(/#/g, '\\#'))
    )
  return out
}

/** Render literal text as a code span with a fence wide enough to contain it.
 *  The reader strips the pad, so `read(codeSpan(x)) === x`. */
export function codeSpan(content: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce(
    (n, run) => Math.max(n, run.length),
    0
  )
  const fence = '`'.repeat(longestRun + 1)
  // CommonMark strips one space from each side when the span begins AND ends
  // with a space and is not all spaces — so pad only when that stripping is
  // what we want (content touching the fence with a backtick), or when the
  // content's own leading/trailing spaces would otherwise be eaten.
  const needsPad =
    content.startsWith('`') ||
    content.endsWith('`') ||
    (content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '')
  const pad = needsPad ? ' ' : ''
  return `${fence}${pad}${content}${pad}${fence}`
}
