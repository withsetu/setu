// Coarse media kinds for the library's type filter. Derived from the MIME type so
// the filter can offer Images / Documents / Audio / Video / Other, not just images.
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'other'

export function mediaKind(contentType: string): MediaKind {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType.includes('word') ||
    contentType.includes('spreadsheet') ||
    contentType.includes('presentation') ||
    contentType.includes('officedocument')
  ) {
    return 'document'
  }
  return 'other'
}
