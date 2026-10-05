import type { MediaRecord } from '@setu/core'
import { apiFetch } from '../lib/api-fetch'

export interface UploadResult {
  id: string
  key: string
  url: string
  contentType: string
  size: number
  filename: string
  record: MediaRecord
  /** True when the api stored the file but could not generate its resized versions (#1161).
   *  Optional so a response from an api that predates the flag still type-checks. */
  ingestFailed?: boolean
  /** The api's fixed, user-safe reason when `ingestFailed`. */
  ingestError?: string
}

/** The message every upload flow shows when the api stored a file but could not generate its
 *  resized versions (#1161) — null when there is nothing to report. The upload itself succeeded
 *  (the file is in the library and usable), so callers hand the result on AND report this.
 *  Shared by MediaDropzone and the editor's direct upload (image-insert.ts) so the two cannot
 *  word it differently; pinned by apps/admin/test/upload-client.test.ts. */
export function ingestFailureNotice(
  result: Pick<UploadResult, 'filename' | 'ingestFailed'>
): string | null {
  if (result.ingestFailed !== true) return null
  return (
    `Uploaded ${result.filename}, but resized versions couldn't be generated — the file may be ` +
    'corrupt. It will be shown at full size. Replace it, or fix it and run Reprocess in ' +
    'Settings → Media.'
  )
}

/** POST a file to the upload service and return the stored asset's details. */
export async function uploadFile(
  apiBase: string,
  file: File
): Promise<UploadResult> {
  const body = new FormData()
  body.append('file', file)
  const res = await apiFetch(`${apiBase}/media`, { method: 'POST', body })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `upload failed (${res.status})`)
  }
  return (await res.json()) as UploadResult
}
