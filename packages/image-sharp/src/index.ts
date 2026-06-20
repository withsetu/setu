import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { contentTypeFor } from '@setu/core'
import type { GeneratedVariant, ImageFormat, ImageMeta, ImagePort, VariantSpec } from '@setu/core'

/** Conservative per-format defaults (good size/quality). PNG is lossless — no quality. */
const DEFAULT_QUALITY: Record<ImageFormat, number | undefined> = {
  avif: 55,
  webp: 75,
  jpeg: 80,
  png: undefined,
}

/** A sharp/libvips ImagePort — resizes (never enlarging) + re-encodes to the requested format. */
export function createSharpImageAdapter(): ImagePort {
  return {
    async metadata(source: Uint8Array): Promise<ImageMeta> {
      const m = await sharp(Buffer.from(source)).metadata()
      return { width: m.width ?? 0, height: m.height ?? 0, format: String(m.format ?? '') }
    },

    async generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]> {
      const out: GeneratedVariant[] = []
      for (const spec of specs) {
        const quality = spec.quality ?? DEFAULT_QUALITY[spec.format]
        const resized = sharp(Buffer.from(source)).resize(spec.width, null, { withoutEnlargement: true })
        const encoded = resized.toFormat(spec.format, quality !== undefined ? { quality } : {})
        const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
        out.push({
          name: spec.name,
          width: info.width,
          height: info.height,
          format: spec.format,
          contentType: contentTypeFor(spec.format),
          body: new Uint8Array(data),
        })
      }
      return out
    },
  }
}
