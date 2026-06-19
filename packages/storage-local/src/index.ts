import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep, isAbsolute } from 'node:path'
import type { StoragePort, StoredObject } from '@setu/core'

export interface LocalStorageOptions {
  /** Directory under which objects are written. */
  dir: string
  /** Base URL objects are served from (trailing slash optional). */
  baseUrl: string
}

/** Reject keys that are absolute, contain `..` segments, or otherwise escape `dir`;
 *  return the safe absolute path under `dir`. */
function resolveKey(dir: string, key: string): string {
  if (isAbsolute(key) || key.split(/[\\/]/).includes('..')) {
    throw new Error(`storage-local: unsafe key "${key}"`)
  }
  const root = normalize(dir)
  const abs = normalize(join(root, key))
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`storage-local: key "${key}" escapes the storage dir`)
  }
  return abs
}

/** A disk-backed StoragePort. Writes `dir/<key>` plus a `<key>.ctype` sidecar holding
 *  the content type (so `get` returns it honestly, not by guessing the extension).
 *  Hardened against path traversal. */
export function createLocalStorage({ dir, baseUrl }: LocalStorageOptions): StoragePort {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    async put(key, body, opts) {
      const path = resolveKey(dir, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      await writeFile(`${path}.ctype`, opts.contentType, 'utf8')
    },
    async get(key): Promise<StoredObject | null> {
      const path = resolveKey(dir, key)
      try {
        const body = await readFile(path)
        let contentType = 'application/octet-stream'
        try {
          contentType = (await readFile(`${path}.ctype`, 'utf8')).trim() || contentType
        } catch {
          /* sidecar missing → default content type */
        }
        return { body: new Uint8Array(body), contentType }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async delete(key) {
      const path = resolveKey(dir, key)
      await rm(path, { force: true })
      await rm(`${path}.ctype`, { force: true })
    },
    async exists(key) {
      const path = resolveKey(dir, key)
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
    url(key) {
      return `${base}/${key.replace(/^\/+/, '')}`
    },
  }
}
