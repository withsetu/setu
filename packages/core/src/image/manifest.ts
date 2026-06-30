import type { ImageFormat } from './image-port'

export interface ManifestVariant {
  width: number
  height: number
  key: string
  contentType: string
  /** The variant's image format. Absent on legacy manifests → treat as the manifest's `format`. */
  format?: ImageFormat
}

/** Describes a stored image: its original + the generated variant ladder (one or more formats). */
export interface MediaManifest {
  id: string
  /** The primary/fallback format (the `<img>` src format when multiple are present). */
  format: ImageFormat
  original: { key: string; width: number; height: number; format: string }
  variants: ManifestVariant[]
  /** Optional LQIP blur-up placeholder: a tiny blurred WebP as a base64 data: URI. */
  lqip?: string
}
