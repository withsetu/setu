/** Plain-text excerpt from a raw Markdoc body: strip {% tags %} + markdown syntax,
 *  collapse whitespace, truncate to `max` chars on a word boundary with an ellipsis. Pure. */
export function excerpt(body: string, max = 200): string {
  const text = body
    .replace(/\{%[\s\S]*?%\}/g, ' ') // markdoc tags (lazy: tolerates % / newlines in body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[#>*_`~]/g, ' ') // md punctuation
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}
