import { Gallery, galleryImagesOf } from '@setu/blocks'
import type { GalleryProps } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrStringOrUndefined } from '../attr-string'
import { createAtomBlock, atomCoreView } from './atom-block'

/** Map the gallery node's raw mdAttrs onto Gallery's props for the read-only canvas view.
 *  Each image `src` is a `/media/…` path resolved against the canvas media origin (nested
 *  resolution the generic media-control path can't do); the rest pass through with the
 *  same coercions the site's Gallery.astro applies. */
function galleryProps(
  md: Record<string, unknown>,
  apiBase: string
): GalleryProps {
  return {
    images: galleryImagesOf(md['images']).map((img) => ({
      ...img,
      src: resolveMediaSrc(img.src, apiBase || undefined)
    })),
    layout: attrStringOrUndefined(md['layout']),
    columns: typeof md['columns'] === 'number' ? md['columns'] : undefined,
    gap: attrStringOrUndefined(md['gap']),
    captions: md['captions'] === true,
    width: attrStringOrUndefined(md['width'])
  }
}

/** The `{% gallery %}` block — atom (props-only, no body); images + options edited in
 *  the inspector rail (media-list control). Mirrors HeroBlock: mdAttrs JSON-only, kept
 *  out of the DOM, round-tripped by the core converter (to-tiptap maps
 *  gallery→galleryBlock, to-markdoc emits self-closing). Node.create boilerplate + the
 *  shared canvas view come from the atom-block factory (#562). */
export const GalleryBlock = createAtomBlock({
  name: 'galleryBlock',
  dataAttr: 'data-setu-gallery-block',
  view: atomCoreView('gallery', Gallery, galleryProps)
})
