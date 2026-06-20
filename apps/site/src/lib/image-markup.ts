import type { MediaManifest } from '@setu/core'

export interface ImageAttrs {
  src: string
  alt: string
  title?: string
  srcset?: string
  sizes?: string
  width?: number
  height?: number
}

export interface ImageMarkupInput {
  manifest: MediaManifest | null
  /** The already-resolved (absolute) original URL. */
  resolvedSrc: string
  alt: string
  title?: string
  /** Resolves a root-relative `/uploads/<key>` to an absolute URL (the #3 resolver). */
  resolveUrl: (rootRelative: string) => string
  sizes: string
}

/** Build <img> attributes: a responsive srcset + intrinsic dims when a manifest is present,
 *  else a plain image (the #3 behaviour). Pure — no fs, no Astro. */
export function imageMarkup(input: ImageMarkupInput): ImageAttrs {
  const { manifest, resolvedSrc, alt, title, resolveUrl, sizes } = input
  if (!manifest || manifest.variants.length === 0) {
    return { src: resolvedSrc, alt, title }
  }
  const srcset = manifest.variants.map((v) => `${resolveUrl(`/media/${v.key}`)} ${v.width}w`).join(', ')
  return {
    src: resolvedSrc,
    alt,
    title,
    srcset,
    sizes,
    width: manifest.original.width,
    height: manifest.original.height,
  }
}
