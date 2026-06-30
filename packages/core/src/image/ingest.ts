import type { ImageFormat, ImagePort } from './image-port'
import type { StoragePort } from '../storage/storage-port'
import type { ManifestVariant, MediaManifest } from './manifest'
import { contentTypeFor, extensionFor } from './format'
import { variantKey, manifestKey } from './media-key'

// TextEncoder is a universal WHATWG global (Node ≥11, Deno, browsers, edge runtimes).
// Declare it locally so the edge tsconfig (lib: ["ES2022"], no DOM) can compile this file.
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } }

export interface IngestDeps {
  image: ImagePort
  storage: StoragePort
}
export interface IngestInput {
  mediaKey: string
  bytes: Uint8Array
  /** Key of the already-stored original (e.g. 2026/06/cat.png). */
  originalKey: string
  /** One or more formats to generate; the first is the manifest's fallback format. */
  formats: ImageFormat[]
  widths: number[]
  /** When true, also generate an LQIP blur-up placeholder. */
  lqip?: boolean
}

/** Generate a responsive multi-format width ladder for an already-stored original,
 *  persist each variant + a manifest to storage, and return the manifest. Edge-safe —
 *  pure orchestration over the injected ImagePort + StoragePort. */
export async function ingestImage(deps: IngestDeps, input: IngestInput): Promise<MediaManifest> {
  const { image, storage } = deps
  const { mediaKey, bytes, originalKey, formats, widths, lqip } = input

  const meta = await image.metadata(bytes)

  // Effective widths: configured widths below the source, plus the source width (cap).
  // Never upscale; dedupe; ascending — so each spec width equals its actual output width.
  const effective = [...new Set([...widths.filter((w) => w < meta.width), meta.width])].sort((a, b) => a - b)

  // One spec per (format × width).
  const specs = formats.flatMap((fmt) => effective.map((w) => ({ name: `w${w}-${fmt}`, width: w, format: fmt })))
  const generated = await image.generate(bytes, specs)

  const manifestVariants: ManifestVariant[] = []
  for (const v of generated) {
    const ext = extensionFor(v.format)
    const contentType = contentTypeFor(v.format)
    const key = variantKey(mediaKey, v.width, ext)
    await storage.put(key, v.body, { contentType })
    manifestVariants.push({ width: v.width, height: v.height, key, contentType, format: v.format })
  }

  const manifest: MediaManifest = {
    id: mediaKey,
    format: formats[0]!,
    original: { key: originalKey, width: meta.width, height: meta.height, format: meta.format },
    variants: manifestVariants,
    ...(lqip ? { lqip: await image.placeholder(bytes, 20) } : {}),
  }
  await storage.put(manifestKey(mediaKey), new TextEncoder().encode(JSON.stringify(manifest)), {
    contentType: 'application/json',
  })
  return manifest
}
