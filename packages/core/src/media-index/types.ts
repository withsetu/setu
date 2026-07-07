// Pure, edge-safe media-index types. No Node/DOM APIs.
import type { MediaKind } from './media-kind'

export interface MediaIndexRow {
  mediaKey: string // '2026/06/cat' — identity
  key: string // storage key of the original (for direct fetch if needed)
  thumbKey: string | null // storage key of thumbnail variant, or null if not an image
  filename: string // original upload filename
  filenameLower: string // for case-insensitive search
  contentType: string // 'image/webp', etc.
  isImage: boolean // drives thumbnail vs file-icon + type filter
  width: number | null // from manifest; null for non-image
  height: number | null
  bytes: number // original size
  uploadedAt: number // epoch ms (UTC)
}

export type MediaSortKey = 'uploadedAt' | 'filename' | 'bytes'

export interface MediaIndexQuery {
  q?: string // filename substring
  type?: 'all' | MediaKind // 'all'/undefined → no kind filter
  sort?: { key: MediaSortKey; dir: 'asc' | 'desc' }
  offset: number
  limit: number
}

export interface MediaIndexMeta {
  version: number
}

export interface MediaIndexPort {
  query(q: MediaIndexQuery): Promise<{ rows: MediaIndexRow[]; total: number }>
  upsert(row: MediaIndexRow): Promise<void>
  upsertMany(rows: MediaIndexRow[]): Promise<void>
  remove(mediaKey: string): Promise<void>
  clear(): Promise<void>
  getMeta(): Promise<MediaIndexMeta>
  setMeta(meta: MediaIndexMeta): Promise<void>
}

/** Minimal media record sidecar (analogous to manifest). */
export interface MediaRecord {
  mediaKey: string
  key: string // storage key of the original, e.g. '2026/06/cat.jpg' -> src is `/media/${key}`
  thumbKey: string | null // smallest variant key for the grid thumbnail; null for non-images
  filename: string
  contentType: string
  isImage: boolean
  width: number | null
  height: number | null
  bytes: number
  uploadedAt: number
}

/** Convert a MediaRecord (sidecar) to a MediaIndexRow. */
export function mediaRowFromRecord(record: MediaRecord): MediaIndexRow {
  return { ...record, filenameLower: record.filename.toLowerCase() }
}
