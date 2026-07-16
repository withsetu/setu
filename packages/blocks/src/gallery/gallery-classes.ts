/** One gallery item as rendered (mirrors the zod contract in
 *  @setu/core blocks/standard/gallery.ts). */
export interface GalleryImage {
  src: string
  alt?: string
  caption?: string
}

export type GalleryGap = 'none' | 'small' | 'medium' | 'large'

const GAPS: ReadonlySet<string> = new Set(['none', 'small', 'medium', 'large'])

/** Clamp an unknown `columns` attr into the contract's 1..6 range (default 3). */
export function clampColumns(columns?: unknown): number {
  const n =
    typeof columns === 'number' && Number.isFinite(columns)
      ? Math.round(columns)
      : 3
  return Math.min(6, Math.max(1, n))
}

/** Coerce the unknown `images` Markdoc attr into well-formed gallery items.
 *  Attrs arrive untyped from Markdoc/mdAttrs; anything without a non-empty string
 *  `src` is dropped, and non-string alt/caption are ignored — never `undefined`
 *  rendered on screen. */
export function galleryImagesOf(value: unknown): GalleryImage[] {
  if (!Array.isArray(value)) return []
  const items: GalleryImage[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (typeof o.src !== 'string' || o.src === '') continue
    items.push({
      src: o.src,
      ...(typeof o.alt === 'string' ? { alt: o.alt } : {}),
      ...(typeof o.caption === 'string' ? { caption: o.caption } : {})
    })
  }
  return items
}

/** Shared class string for the gallery root — the canvas core (Gallery.tsx) and the
 *  site renderer (Gallery.astro) must emit identical classes so gallery.css and any
 *  theme override style both the same way. */
export function galleryClasses(
  columns?: unknown,
  gap?: string,
  width?: string
): string {
  const g = gap && GAPS.has(gap) ? gap : 'medium'
  let cls = `blk-gallery cols-${clampColumns(columns)} gap-${g}`
  if (width === 'wide' || width === 'full') cls += ` w-${width}`
  return cls
}

/** Responsive `sizes` estimate for one grid slot: full-viewport at 1 column, halves on
 *  small screens (where the CSS collapses the grid), otherwise ~100/columns vw. */
export function sizesForColumns(columns?: unknown): string {
  const cols = clampColumns(columns)
  if (cols === 1) return '100vw'
  const pct = Math.round(100 / cols)
  return `(max-width: 480px) 100vw, (max-width: 768px) 50vw, ${pct}vw`
}
