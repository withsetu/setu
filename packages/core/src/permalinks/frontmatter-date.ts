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

/** A Date → frontmatter `date` string (`YYYY-MM-DD`), using the Date's LOCAL calendar
 *  parts. The resolver reads date tokens in UTC and a bare `YYYY-MM-DD` parses to UTC
 *  midnight, so formatting from local parts keeps the author's wall-clock day: an evening
 *  edit west of UTC stays on today's date instead of shifting the URL forward a day. */
export function formatFrontmatterDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
