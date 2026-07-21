/** Plain-text excerpt from a raw Markdoc body: strip {% tags %} + markdown syntax,
 *  collapse whitespace, truncate to `max` chars on a word boundary with an ellipsis. Pure. */
export function excerpt(body: string, max = 200): string {
  const text = body
    .replace(/\{%[\s\S]*?%\}/g, ' ') // markdoc tags (lazy: tolerates % / newlines in body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    // #787: whole lines that are PURE structure — a GFM delimiter row (`| --- | :-: |`),
    // a thematic break, a setext underline. Dropping the line is the only honest option:
    // strip their characters individually and the leftover `---` reads as prose. This
    // runs before the character strips below so the `|` rule cannot eat the row's shape
    // first. Anchored per line (`m`), so a hyphen inside a sentence is never touched.
    .replace(/^[ \t]*\|?[ \t:|-]*[-=]{2,}[ \t:|=-]*$/gm, ' ')
    .replace(/<br\s*\/?>/gi, ' ') // the folded multi-block cell marker (#752)
    .replace(/\|/g, ' ') // table pipes
    .replace(/[#>*_`~]/g, ' ') // md punctuation
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}
