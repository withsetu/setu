// Pure, edge-safe media-index types. No Node/DOM APIs.

export interface MediaIndexRow {
  mediaKey: string        // '2026/06/cat' — identity
  key: string             // storage key of the original (for direct fetch if needed)
  thumbKey: string | null // storage key of thumbnail variant, or null if not an image
  filename: string        // original upload filename
  filenameLower: string   // for case-insensitive search
  contentType: string     // 'image/webp', etc.
  isImage: boolean        // drives thumbnail vs file-icon + type filter
  width: number | null    // from manifest; null for non-image
  height: number | null
  bytes: number           // original size
  uploadedAt: number      // epoch ms (UTC)
}

export type MediaSortKey = 'uploadedAt' | 'filename' | 'bytes'

export interface MediaIndexQuery {
  q?: string                              // filename substring
  type?: 'image' | 'all'                  // default 'all'
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
  return {
    mediaKey: record.mediaKey,
    key: record.mediaKey, // placeholder; will be filled by the storage API
    thumbKey: null,        // placeholder; will be filled when manifest is read
    filename: record.filename,
    filenameLower: record.filename.toLowerCase(),
    contentType: record.contentType,
    isImage: record.isImage,
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    uploadedAt: record.uploadedAt,
  }
}
