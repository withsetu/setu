import type { MediaRecord } from '@setu/core'
import { apiFetch } from '../lib/api-fetch'

export async function fetchMediaIndex(apiBase: string): Promise<MediaRecord[]> {
  const res = await apiFetch(`${apiBase}/media/_index`)
  if (!res.ok) throw new Error(`media index fetch failed (${res.status})`)
  return ((await res.json()) as { records: MediaRecord[] }).records
}

export async function deleteMedia(
  apiBase: string,
  mediaKey: string
): Promise<void> {
  const res = await apiFetch(`${apiBase}/media/${mediaKey}`, {
    method: 'DELETE'
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `delete failed (${res.status})`)
  }
}
