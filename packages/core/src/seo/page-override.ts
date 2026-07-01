/** Per-document SEO overrides, authored in the editor and stored under frontmatter `seo:`.
 *  Every field is optional — an absent field falls back to the derived default (title, featured
 *  image, site description, etc.) in the resolvers. */
export interface PageSeoOverride {
  /** Overrides the <title> / og:title (not the visible page heading). */
  title?: string
  /** Overrides the meta description / og:description. */
  description?: string
  /** Overrides the og:image / twitter:image (media src or absolute URL). */
  image?: string
  /** Force this page to noindex,nofollow. */
  noindex?: boolean
  /** Override the canonical URL (e.g. for syndicated / duplicate content). */
  canonical?: string
}

/** Read the `seo:` override block from a document's frontmatter (`entry.data`), defensively.
 *  Missing/malformed → an empty override. Pure. */
export function parsePageSeoOverride(data: unknown): PageSeoOverride {
  const seo =
    data && typeof data === 'object' ? (data as Record<string, unknown>)['seo'] : undefined
  if (!seo || typeof seo !== 'object') return {}
  const s = seo as Record<string, unknown>
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const out: PageSeoOverride = {}
  const title = str(s['title'])
  const description = str(s['description'])
  const image = str(s['image'])
  const canonical = str(s['canonical'])
  if (title) out.title = title
  if (description) out.description = description
  if (image) out.image = image
  if (canonical) out.canonical = canonical
  if (s['noindex'] === true) out.noindex = true
  return out
}
