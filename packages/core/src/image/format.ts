import type { ImageFormat } from './image-port'

/** File extension for an output format (jpeg → jpg; others identity). */
export function extensionFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** MIME content-type for an output format. */
export function contentTypeFor(format: ImageFormat): string {
  return `image/${format}`
}
