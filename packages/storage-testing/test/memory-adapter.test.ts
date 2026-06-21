import type { StoragePort, StoredObject } from '@setu/core'
import { runStoragePortContract } from '../src/index'

/** Minimal Map-backed StoragePort — the reference the contract self-tests against.
 *  Copies bytes in + out so callers can't mutate stored state (value semantics). */
function createMemoryStorage(baseUrl = '/uploads'): StoragePort {
  const store = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) {
      store.set(key, { body: new Uint8Array(body), contentType: opts.contentType })
    },
    async get(key) {
      const o = store.get(key)
      return o ? { body: new Uint8Array(o.body), contentType: o.contentType } : null
    },
    async delete(key) {
      store.delete(key)
    },
    async exists(key) {
      return store.has(key)
    },
    url(key) {
      return `${baseUrl}/${key}`
    },
    async list(prefix?: string): Promise<string[]> {
      const keys = [...store.keys()]
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
    },
  }
}

runStoragePortContract(() => createMemoryStorage())
