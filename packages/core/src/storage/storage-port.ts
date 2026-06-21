/** Options for storing an object. */
export interface PutOptions {
  /** MIME type, persisted with the object and returned by `get`. */
  contentType: string
}

/** A stored binary object: its bytes and content type. */
export interface StoredObject {
  body: Uint8Array
  contentType: string
}

/** A dumb keyed-blob store for binary assets (media originals + variants). Knows
 *  nothing about images/variants/optimization — variants are just more keys the
 *  ImagePort manages. Adapters: storage-local (disk), storage-s3 (later). Pure types,
 *  edge/browser-safe (no Node APIs). */
export interface StoragePort {
  /** Store `body` under `key`, overwriting any existing object. */
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void>
  /** Read the object at `key`, or null when absent. */
  get(key: string): Promise<StoredObject | null>
  /** Remove the object at `key`. No error when already absent. */
  delete(key: string): Promise<void>
  /** Whether an object exists at `key`. */
  exists(key: string): Promise<boolean>
  /** Public URL at which `key` is served (pure construction). Private/signed URLs are
   *  a later, separate concern. */
  url(key: string): string
  /** List storage keys (optionally under `prefix`). Excludes adapter-internal
   *  namespaces (e.g. `.meta`). Keys use forward slashes, no leading slash. */
  list(prefix?: string): Promise<string[]>
}
