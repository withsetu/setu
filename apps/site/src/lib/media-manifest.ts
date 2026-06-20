import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaManifest } from '@setu/core'

/** Extract the media id from a root-relative upload src `/uploads/media/<id>/...`;
 *  null for external/absolute or non-upload srcs (they have no manifest). */
export function manifestIdFromSrc(src: string): string | null {
  const m = /^\/uploads\/media\/([^/]+)\//.exec(src)
  return m ? m[1]! : null
}

/** Read + parse media/<id>/manifest.json from SETU_MEDIA_DIR at build time; null when the
 *  env is unset, the file is absent/unreadable, or the JSON is malformed. Never throws. */
export function loadManifest(id: string): MediaManifest | null {
  const dir = process.env.SETU_MEDIA_DIR
  if (!dir) return null
  try {
    const raw = readFileSync(join(dir, 'media', id, 'manifest.json'), 'utf8')
    const m = JSON.parse(raw) as MediaManifest
    if (!m || !Array.isArray(m.variants) || !m.original) return null
    return m
  } catch {
    return null
  }
}
