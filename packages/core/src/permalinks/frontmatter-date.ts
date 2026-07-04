/** Frontmatter publish date for URL resolution: `date` ?? `pubDate`, parsed to epoch ms.
 *  YAML parses unquoted dates into Date objects; strings/numbers go through Date.parse.
 *  NEVER updatedAt/git/mtime — an edit must not move a URL. */
export function parseFrontmatterDate(
  frontmatter: Record<string, unknown>
): number | null {
  const raw = frontmatter['date'] ?? frontmatter['pubDate']
  const parsed =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'string' || typeof raw === 'number'
        ? Date.parse(String(raw))
        : NaN
  return Number.isNaN(parsed) ? null : parsed
}
