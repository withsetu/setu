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

/** Storage key of a width variant: `${mediaKey}.${width}w.${ext}` (#1159).
 *
 *  Every key an id writes is `${mediaKey}.<suffix>`, and a mediaKey's last segment is a
 *  `mediaSlug` — `[a-z0-9-]` only, never a dot — so the id is everything before the first dot of
 *  the last segment, and keys of two different ids can never be equal. Within an id the suffixes
 *  are distinct: `<ext>` (one dot-free word), `manifest.json`, `media.json`, `<w>w.<ext>`.
 *  Enforced by packages/core/test/media-key.test.ts ("key namespaces are disjoint across ids").
 *
 *  Media stored before #1159 used `${mediaKey}-${width}w.${ext}`, which CAN equal another id's
 *  original. Those keys stay valid — every reader resolves variants through the manifest's
 *  stored `key`, never by re-deriving the name — and the upload id probe checks the original
 *  key, so a new upload never takes a legacy variant's key as its own original. */
export function variantKey(
  mediaKey: string,
  width: number,
  ext: string
): string {
  return `${mediaKey}.${width}w.${ext}`
}

/** Storage key of the sidecar manifest: `${mediaKey}.manifest.json`. */
export function manifestKey(mediaKey: string): string {
  return `${mediaKey}.manifest.json`
}

/** Storage key of the per-upload media-record sidecar: `${mediaKey}.media.json`. */
export function mediaRecordKey(mediaKey: string): string {
  return `${mediaKey}.media.json`
}
