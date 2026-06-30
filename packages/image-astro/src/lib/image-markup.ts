import type { MediaManifest } from '@setu/core'

export interface ImageSource { type: string; srcset: string }
export interface ImageMarkup {
  src: string
  alt: string
  title?: string
  sources?: ImageSource[]
  srcset?: string
  sizes?: string
  width?: number
  height?: number
  lqip?: string
}

/** @deprecated Use ImageMarkup */
export type ImageAttrs = ImageMarkup

export interface ImageMarkupInput {
  manifest: MediaManifest | null
  /** The already-resolved (absolute) original URL. */
  resolvedSrc: string
  alt: string
  title?: string
  /** Resolves a root-relative `/media/<key>` to an absolute URL (the #3 resolver). */
  resolveUrl: (rootRelative: string) => string
  sizes: string
}

const TYPE_BY_FORMAT: Record<string, string> = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' }
// <picture> source order: best (smallest) first.
const FORMAT_ORDER = ['avif', 'webp', 'jpeg', 'png']

/** Build <img>/<picture> attributes: a responsive srcset + intrinsic dims when a manifest is
 *  present. When >1 format is present, emits `sources` (AVIF first) for `<picture>` and sets
 *  `srcset` to the manifest's primary format ladder for the `<img>` fallback.
 *  Pure — no fs, no Astro. Edge/SSR safe. */
export function imageMarkup(input: ImageMarkupInput): ImageMarkup {
  const { manifest, resolvedSrc, alt, title, resolveUrl, sizes } = input
  if (!manifest || manifest.variants.length === 0) {
    return { src: resolvedSrc, alt, title }
  }
  const fmtOf = (v: { format?: string }) => v.format ?? manifest.format
  const byFormat = new Map<string, typeof manifest.variants>()
  for (const v of manifest.variants) {
    const f = fmtOf(v)
    ;(byFormat.get(f) ?? byFormat.set(f, []).get(f)!).push(v)
  }
  const srcsetFor = (vs: typeof manifest.variants) =>
    vs.map((v) => `${resolveUrl(`/media/${v.key}`)} ${v.width}w`).join(', ')

  const base: ImageMarkup = {
    src: resolvedSrc, alt, title, sizes,
    width: manifest.original.width, height: manifest.original.height,
    ...(manifest.lqip ? { lqip: manifest.lqip } : {}),
  }

  if (byFormat.size <= 1) {
    return { ...base, srcset: srcsetFor(manifest.variants) }
  }
  const sources: ImageSource[] = FORMAT_ORDER.filter((f) => byFormat.has(f)).map((f) => ({
    type: TYPE_BY_FORMAT[f] ?? `image/${f}`,
    srcset: srcsetFor(byFormat.get(f)!),
  }))
  // <img> fallback uses the manifest's primary format ladder.
  return { ...base, sources, srcset: srcsetFor(byFormat.get(manifest.format) ?? manifest.variants) }
}
