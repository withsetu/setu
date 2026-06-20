// @setu/core/src/image/image-port.ts — a dumb image transform engine (edge-safe types).
export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png'

/** One requested output: a named variant at a target width + format (+ optional quality 1–100). */
export interface VariantSpec {
  name: string
  width: number
  format: ImageFormat
  quality?: number
}

/** Intrinsic properties of a source image. */
export interface ImageMeta {
  width: number
  height: number
  format: string
}

/** A produced variant — the bytes plus the actual dimensions / format / content-type. */
export interface GeneratedVariant {
  name: string
  width: number
  height: number
  format: ImageFormat
  contentType: string
  body: Uint8Array
}

export interface ImagePort {
  /** Intrinsic width / height / format of the source bytes. */
  metadata(source: Uint8Array): Promise<ImageMeta>
  /** Produce one output per spec, in order. Never upscales; preserves aspect ratio. */
  generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]>
}
