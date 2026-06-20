import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaManifest } from '@setu/core'

/** mediaKey for a root-relative `/media/<y>/<m>/<slug>.<ext>` src (strip prefix + extension);
 *  null for external/absolute or non-`/media/` srcs (they have no manifest). */
export function manifestKeyFromSrc(src: string): string | null {
  if (!src.startsWith('/media/')) return null
  const rest = src.slice('/media/'.length)
  const key = rest.replace(/\.[^./]*$/, '') // strip the extension
  return key.length > 0 ? key : null
}

/** Read + parse `${SETU_MEDIA_DIR}/<mediaKey>.manifest.json` at build time; null when the env is
 *  unset, the file is absent/unreadable, or the JSON is malformed. Never throws. */
export function loadManifest(mediaKey: string): MediaManifest | null {
  const dir = process.env.SETU_MEDIA_DIR
  if (!dir) return null
  try {
    const raw = readFileSync(join(dir, `${mediaKey}.manifest.json`), 'utf8')
    const m = JSON.parse(raw) as MediaManifest
    if (!m || !Array.isArray(m.variants) || !m.original) return null
    return m
  } catch {
    return null
  }
}
