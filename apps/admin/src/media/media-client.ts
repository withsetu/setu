import type { MediaRecord } from '@setu/core'
import { apiFetch } from '../lib/api-fetch'

/** The request never reached the server (offline, api down, DNS, CORS) — so there is
 *  no server message to show and `err.message` is fetch's own "Failed to fetch". Call
 *  sites curate this branch; every OTHER error out of this module came back from the
 *  API and carries its reason (e.g. a 409 "media is in use"), which is worth showing
 *  verbatim (#870, the #852 shape).
 *  Both directions are enforced by apps/admin/test/media-client.test.ts and, at the
 *  call site, by apps/admin/test/media-screen.test.tsx. */
export class MediaTransportError extends Error {
  constructor(cause: unknown) {
    super('media request failed')
    this.name = 'MediaTransportError'
    this.cause = cause
  }
}

/** `apiFetch`, with a network-level rejection tagged so callers can tell it apart
 *  from a server response error. */
async function mediaFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await apiFetch(url, init)
  } catch (err) {
    throw new MediaTransportError(err)
  }
}

export async function fetchMediaIndex(apiBase: string): Promise<MediaRecord[]> {
  const res = await mediaFetch(`${apiBase}/media/_index`)
  if (!res.ok) throw new Error(`media index fetch failed (${res.status})`)
  return ((await res.json()) as { records: MediaRecord[] }).records
}

export async function deleteMedia(
  apiBase: string,
  mediaKey: string
): Promise<void> {
  const res = await mediaFetch(`${apiBase}/media/${mediaKey}`, {
    method: 'DELETE'
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `delete failed (${res.status})`)
  }
}
