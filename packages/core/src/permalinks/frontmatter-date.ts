/** Parse one frontmatter date value (YAML `Date`, string, number) to epoch ms, or null.
 *  YAML parses unquoted dates into Date objects; strings/numbers go through Date.parse. */
function toEpochMs(raw: unknown): number | null {
  const parsed =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'string' || typeof raw === 'number'
        ? Date.parse(String(raw))
        : NaN
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A post's **published date** from frontmatter: `date`, else `pubDate` (the alias migrated
 * content carries), parsed to epoch ms; null when neither yields a date.
 *
 * The ONE rule (#1121). Every consumer that dates publication reads it here — permalinks
 * (`apps/site/src/lib/permalinks.ts`), archives (`apps/site/src/lib/post-row.ts`, the query
 * block), the page/feed/sitemap resolver (`apps/site/src/lib/post-date.ts`, which adds the
 * git → mtime → now fallback) and the codegen (`scripts/gen-relations.mjs`, which adds the
 * mtime fallback). Their agreement is pinned by apps/site/test/post-date-agreement.test.ts.
 *
 * NEVER `updatedAt`/`modified` (a modified date: see {@link parseFrontmatterModifiedDate}),
 * and never git/mtime — an edit must not move a URL or re-date a post.
 */
export function parseFrontmatterDate(
  frontmatter: Record<string, unknown>
): number | null {
  return toEpochMs(frontmatter['date'] ?? frontmatter['pubDate'])
}

/** A post's **modified date** from frontmatter: `updatedAt`, else `modified`, as epoch ms;
 *  null when absent. Feeds `dateModified` / sitemap `<lastmod>` only — never a published
 *  date. */
export function parseFrontmatterModifiedDate(
  frontmatter: Record<string, unknown>
): number | null {
  return toEpochMs(frontmatter['updatedAt'] ?? frontmatter['modified'])
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
