export interface UploadResult {
  id: string
  key: string
  url: string
  contentType: string
  size: number
  filename: string
}

/** POST a file to the upload service and return the stored asset's details. */
export async function uploadFile(apiBase: string, file: File): Promise<UploadResult> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`${apiBase}/media`, { method: 'POST', body })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `upload failed (${res.status})`)
  }
  return (await res.json()) as UploadResult
}
