// Pure, edge-safe media-key helpers. No Node/DOM APIs (compiles under tsconfig.edge.json).
const MAX_SLUG = 60

/** Sanitize an upload filename into a URL-safe slug (no extension): NFKD-fold, lowercase ASCII,
 *  runs of non-alphanumerics → '-', trimmed/collapsed, capped at 60 chars. Empty → 'file'. */
export function mediaSlug(filename: string): string {
  const base = filename.replace(/\.[^./\\]*$/, '') // strip a trailing extension
  const slug = base
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // remove all Unicode combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  return slug || 'file'
}

/** `${yyyy}/${mm}/${slug}` with a zero-padded month. */
export function mediaKeyOf(yyyy: number, mm: number, slug: string): string {
  return `${yyyy}/${String(mm).padStart(2, '0')}/${slug}`
}

/** Storage key of the original: `${mediaKey}.${ext}`. */
export function originalKey(mediaKey: string, ext: string): string {
  return `${mediaKey}.${ext}`
}

/** Storage key of a width variant: `${mediaKey}-${width}w.${ext}`. */
export function variantKey(mediaKey: string, width: number, ext: string): string {
  return `${mediaKey}-${width}w.${ext}`
}

/** Storage key of the sidecar manifest: `${mediaKey}.manifest.json`. */
export function manifestKey(mediaKey: string): string {
  return `${mediaKey}.manifest.json`
}
