import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises'
import { dirname, join, normalize, sep, isAbsolute, relative } from 'node:path'
import type { StoragePort, StoredObject } from '@setu/core'
import { isInsideRoot, rootOf } from './root'

export interface LocalStorageOptions {
  /** Directory under which objects are written. */
  dir: string
  /** Base URL objects are served from (trailing slash optional). */
  baseUrl: string
}

const META = '.meta'

/** Drop any run of trailing `/` from a URL base. Exactly equivalent to
 *  `.replace(/\/+$/, '')` but a single linear scan — the anchored `\/+$` form is
 *  polynomial because the engine re-tries the quantifier from every start position (#340).
 *  `/`-only on purpose: this is for `baseUrl`, where a backslash is an ordinary path
 *  character. Filesystem paths use `rootOf` in ./root.ts instead, which also strips `sep`. */
function stripTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--
  return end === s.length ? s : s.slice(0, end)
}

/** Reject keys that are absolute, contain `..` segments, or otherwise escape `dir`;
 *  return the safe absolute path under `dir`. The absolute/`..` rejections are covered by
 *  packages/storage-local/test/local.test.ts and test/root.test.ts; the containment backstop
 *  below is covered as `isInsideRoot` in test/root.test.ts (see its comment for why it
 *  cannot be reached through this function). */
function resolveKey(dir: string, key: string): string {
  if (key.trim() === '') throw new Error('storage-local: empty key')
  if (isAbsolute(key) || key.split(/[\\/]/).includes('..')) {
    throw new Error(`storage-local: unsafe key "${key}"`)
  }
  const root = rootOf(dir)
  const abs = normalize(join(root, key))
  if (!isInsideRoot(root, abs)) {
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
  const base = stripTrailingSlashes(baseUrl)

  // key has already passed resolveKey in the calling method (not absolute, no '..', not in .meta)
  const metaPathFor = (key: string) => join(rootOf(dir), META, key)

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
      const root = rootOf(dir)
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
          const child = join(abs, ent.name)
          const rel = relative(root, child).split(sep).join('/')
          // Skip the content-type sidecar namespace — but only where it IS the
          // namespace: `resolveKey` reserves `.meta` as the first segment only, so
          // matching on `ent.name` at every depth hid legitimate keys like
          // `uploads/.meta/x.png` that put/exists accept (#899).
          // packages/storage-local/test/list.test.ts covers both halves.
          if (rel.split('/')[0] === META) continue
          if (ent.isDirectory()) await walk(child)
          else out.push(rel)
        }
      }
      await walk(root)
      return prefix ? out.filter((k) => k.startsWith(prefix)) : out
    }
  }
}
