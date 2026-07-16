/** Minimal HTML → markdown/text for AIC `description` fields.
 *
 *  AIC descriptions are simple editorial HTML (verified 2026-07-16 on live API
 *  records, e.g. https://api.artic.edu/api/v1/artworks/27992: `<p>`, `<em>`,
 *  `<strong>`, `<a href>`, occasional `<ul>/<li>`). A full HTML parser dependency
 *  is not warranted for that vocabulary (supply-chain rule: prefer no new deps) —
 *  this converter handles exactly those tags and strips anything else.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“'
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    )
    .replace(
      /&([a-zA-Z]+);/g,
      (match, name: string) => NAMED_ENTITIES[name] ?? match
    )
}

/** Convert AIC-vocabulary HTML into markdown. Unknown tags are stripped, never
 *  passed through — the output must be honest markdown. */
export function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r\n?/g, '\n')
  // Inline marks first (they may nest inside blocks).
  s = s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
  s = s.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
  s = s.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  // Blocks: list items become dashes; list/paragraph boundaries become blank lines.
  s = s.replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<\/li>/gi, '\n')
  s = s.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n\n')
  s = s.replace(/<\/p>/gi, '\n\n')
  s = s.replace(/<p[^>]*>/gi, '')
  // Anything else is stripped.
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  // Tidy: strip trailing space per line, collapse 3+ newlines, trim.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+(?!-)/, ''))
    .join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** Strip ALL markup to a single-line plain-text string (excerpt building).
 *  Block tags become whitespace (word boundaries); inline marks vanish so
 *  punctuation stays attached ("<strong>note</strong>." → "note."). */
export function htmlToText(html: string): string {
  const stripped = decodeEntities(
    html
      .replace(/<\/?(?:p|br|ul|ol|li|div|h[1-6])[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
  return stripped.replace(/\s+/g, ' ').trim()
}
