import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises'
import { dirname, join, normalize, sep, isAbsolute, relative } from 'node:path'
import type { StoragePort, StoredObject } from '@setu/core'

export interface LocalStorageOptions {
  /** Directory under which objects are written. */
  dir: string
  /** Base URL objects are served from (trailing slash optional). */
  baseUrl: string
}

const META = '.meta'

/** Reject keys that are absolute, contain `..` segments, or otherwise escape `dir`;
 *  return the safe absolute path under `dir`. */
function resolveKey(dir: string, key: string): string {
  if (key.trim() === '') throw new Error('storage-local: empty key')
  if (isAbsolute(key) || key.split(/[\\/]/).includes('..')) {
    throw new Error(`storage-local: unsafe key "${key}"`)
  }
  const root = normalize(dir)
  const abs = normalize(join(root, key))
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`storage-local: key "${key}" escapes the storage dir`)
  }
  if (key.split(/[\\/]/)[0] === META) {
    throw new Error(
      `storage-local: key "${key}" uses the reserved "${META}" namespace`
    )
  }
  return abs
}

/** A disk-backed StoragePort. Writes `dir/<key>` for the object body and
 *  `dir/.meta/<key>` for the content-type, keeping object keys and metadata
 *  in separate on-disk namespaces (no sidecar collision).
 *  Hardened against path traversal and empty keys. */
export function createLocalStorage({
  dir,
  baseUrl
}: LocalStorageOptions): StoragePort {
  const base = baseUrl.replace(/\/+$/, '')

  // key has already passed resolveKey in the calling method (not absolute, no '..', not in .meta)
  const metaPathFor = (key: string) => join(normalize(dir), META, key)

  return {
    async put(key, body, opts) {
      const path = resolveKey(dir, key)
      const meta = metaPathFor(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      await mkdir(dirname(meta), { recursive: true })
      await writeFile(meta, opts.contentType, 'utf8')
    },
    async get(key): Promise<StoredObject | null> {
      const path = resolveKey(dir, key)
      try {
        const body = await readFile(path)
        let contentType = 'application/octet-stream'
        try {
          contentType =
            (await readFile(metaPathFor(key), 'utf8')).trim() || contentType
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
          /* meta missing → default content type */
        }
        return { body: new Uint8Array(body), contentType }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async delete(key) {
      await rm(resolveKey(dir, key), { force: true })
      await rm(metaPathFor(key), { force: true })
    },
    async exists(key) {
      const path = resolveKey(dir, key)
      try {
        await stat(path)
        return true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw e
      }
    },
    url(key) {
      return `${base}/${key.replace(/^\/+/, '')}`
    },
    async list(prefix?: string): Promise<string[]> {
      const root = normalize(dir)
      const out: string[] = []
      async function walk(abs: string): Promise<void> {
        let entries
        try {
          entries = await readdir(abs, { withFileTypes: true })
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
          throw e
        }
        for (const ent of entries) {
          if (ent.name === META) continue // skip the content-type sidecar namespace
          const child = join(abs, ent.name)
          if (ent.isDirectory()) await walk(child)
          else out.push(relative(root, child).split(sep).join('/'))
        }
      }
      await walk(root)
      return prefix ? out.filter((k) => k.startsWith(prefix)) : out
    }
  }
}
