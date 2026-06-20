import type { ImageFormat } from './image-port'

export interface ManifestVariant {
  width: number
  height: number
  key: string
  contentType: string
}

/** Describes a stored image: its original + the generated single-format variant ladder. */
export interface MediaManifest {
  id: string
  format: ImageFormat
  original: { key: string; width: number; height: number; format: string }
  variants: ManifestVariant[]
}
