import './gallery.css'
import { galleryClasses, type GalleryImage } from './gallery-classes'

export interface GalleryProps {
  images?: GalleryImage[]
  /** 'grid' (default) or 'masonry' (#533); untyped string — mdAttrs arrive
   *  unvalidated and galleryClasses falls back to grid. */
  layout?: string
  columns?: number
  /** One of GalleryGap; untyped string because mdAttrs arrive unvalidated
   *  (galleryClasses falls back to 'medium' for unknown values). */
  gap?: string
  captions?: boolean
  width?: string
}

/** The gallery visual core. Rendered read-only in the editor canvas (props from the
 *  node's mdAttrs); the site mirrors this exact class structure in Gallery.astro,
 *  sharing gallery.css — except images, which the site routes through
 *  @setu/image-astro for real srcset/LQIP output, and the lightbox (#553), which
 *  is site-only behavior: tiles in the editor canvas never navigate or open dialogs. */
export function Gallery({
  images = [],
  layout = 'grid',
  columns = 3,
  gap = 'medium',
  captions = false,
  width
}: GalleryProps) {
  if (images.length === 0) {
    // Editor-only: Gallery.astro renders nothing for an empty gallery, so this
    // invitation never reaches the published site.
    return (
      <div className="blk-gallery-empty" role="note">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2.4" />
          <circle cx="8.5" cy="8.5" r="1.6" />
          <path d="M21 15.5l-4.5-4.5L5 21" />
        </svg>
        <span>
          Empty gallery — select it, then <strong>Add images</strong> from the
          panel on the right.
        </span>
      </div>
    )
  }
  return (
    <div className={galleryClasses(columns, gap, width, layout)}>
      {images.map((img, i) => (
        <figure className="blk-gallery-item" key={`${img.src}-${i}`}>
          <img src={img.src} alt={img.alt ?? ''} loading="lazy" />
          {captions && img.caption ? (
            <figcaption className="blk-gallery-caption">
              {img.caption}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  )
}
