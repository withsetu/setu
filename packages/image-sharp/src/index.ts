import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { contentTypeFor } from '@setu/core'
import type {
  GeneratedVariant,
  ImageFormat,
  ImageMeta,
  ImagePort,
  VariantSpec
} from '@setu/core'

/** Conservative per-format defaults (good size/quality). PNG is lossless — no quality. */
const DEFAULT_QUALITY: Record<ImageFormat, number | undefined> = {
  avif: 55,
  webp: 75,
  jpeg: 80,
  png: undefined
}

/** A sharp/libvips ImagePort — resizes (never enlarging) + re-encodes to the requested format. */
export function createSharpImageAdapter(): ImagePort {
  return {
    async metadata(source: Uint8Array): Promise<ImageMeta> {
      const m = await sharp(Buffer.from(source)).metadata()
      // EXIF orientation 5-8 are 90°/270° rotations, so the displayed image swaps
      // width/height vs the stored pixels. Report the *oriented* (display) dims —
      // matching the auto-rotated variants below and what the browser shows.
      const swap = (m.orientation ?? 1) >= 5
      const w = m.width ?? 0
      const h = m.height ?? 0
      return {
        width: swap ? h : w,
        height: swap ? w : h,
        format: String(m.format ?? '')
      }
    },

    async generate(
      source: Uint8Array,
      specs: VariantSpec[]
    ): Promise<GeneratedVariant[]> {
      const out: GeneratedVariant[] = []
      for (const spec of specs) {
        const quality = spec.quality ?? DEFAULT_QUALITY[spec.format]
        // .rotate() with no args auto-orients from EXIF and bakes the rotation into
        // the pixels (stripping the orientation tag), so variants render upright
        // everywhere. Without it, phone photos come out sideways on the frontend.
        const resized = sharp(Buffer.from(source))
          .rotate()
          .resize(spec.width, null, { withoutEnlargement: true })
        const encoded = resized.toFormat(
          spec.format,
          quality !== undefined ? { quality } : {}
        )
        const { data, info } = await encoded.toBuffer({
          resolveWithObject: true
        })
        out.push({
          name: spec.name,
          width: info.width,
          height: info.height,
          format: spec.format,
          contentType: contentTypeFor(spec.format),
          body: new Uint8Array(data)
        })
      }
      return out
    },

    async placeholder(source: Uint8Array, width: number): Promise<string> {
      const buf = await sharp(Buffer.from(source))
        .rotate()
        .resize(width, null, { withoutEnlargement: true })
        .blur(1.2)
        .webp({ quality: 40 })
        .toBuffer()
      return `data:image/webp;base64,${buf.toString('base64')}`
    }
  }
}
