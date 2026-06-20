# StoragePort foundation — media slice 1

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#1** (see `docs/roadmap.md` → Media). The storage foundation everything
else (upload API, image block, ImagePort, library UI, S3 adapter) builds on. Mirrors the `DataPort`
increment's shape: **Port (in `@setu/core`) + contract suite + a reference adapter + a real adapter.**

## Goal

A **`StoragePort`** — a *dumb keyed-blob store* for binary assets — plus a behavioural **contract
suite** every adapter runs, plus the first real adapter **`@setu/storage-local`** (disk). The port
stores and serves keyed bytes; it knows nothing about images, variants, or optimization — **variants
are just more keys** the (future) `ImagePort` manages. This is pure infrastructure with no UI consumer
yet, exactly like the `DataPort` increment.

**Explicitly NOT in this slice** (later media sub-projects, per the roadmap): the auth-gated upload
API (#2), the editor image block (#3), the `ImagePort`/optimization (#4), the media library UI (#5),
the `@setu/storage-s3` adapter (#6), presigned direct-upload, private/signed URLs, and the
draft→published asset sync lifecycle.

## Verified before designing (standing rules)

- **Rule #1 (read source / check docs):** mirrored the established `DataPort` pattern directly —
  `@setu/db-testing` exposes `runDataPortContract(makeAdapter)` (vitest a peerDependency); `@setu/core`
  holds the `DataPort` interface (`src/data/data-port.ts`); `@setu/db-sqlite`/`db-memory` are adapters
  that run the contract. This slice copies that structure for storage. Also web-verified (roadmap)
  that **sharp can't run on Cloudflare Workers** — which is *why* storage stays dumb and optimization
  is a separate port/sub-project.
- **Rule #2 (Cloudflare + cost):** the `StoragePort` **interface + types live in `@setu/core`** and
  must stay **edge/browser-safe** (no Node APIs — covered by core's edge guard `tsconfig.edge.json`).
  The Node-only `storage-local` adapter (uses `node:fs`) lives in its own package, exactly as
  `db-sqlite` keeps `better-sqlite3` out of core. No per-visitor runtime cost — storage is build/admin
  side.

## Architecture — three units

### 1. `StoragePort` interface (`@setu/core/src/storage/`)
Pure types, edge-safe. A dumb keyed-blob store:

```ts
// @setu/core/src/storage/storage-port.ts
export interface PutOptions { contentType: string }
export interface StoredObject { body: Uint8Array; contentType: string }

export interface StoragePort {
  /** Store bytes under `key` (overwrites). `contentType` is persisted with the object. */
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void>
  /** Read the object at `key`, or null if absent. */
  get(key: string): Promise<StoredObject | null>
  /** Remove the object at `key` (no error if already absent). */
  delete(key: string): Promise<void>
  /** Whether an object exists at `key`. */
  exists(key: string): Promise<boolean>
  /** Public URL at which the object is served (sync — pure construction). Private/signed
   *  URLs are a later, separate method (`signUrl`) — out of scope. */
  url(key: string): string
}
```

- `body` is `Uint8Array` (browser/edge/node-universal). `key` is opaque — the upload/ImagePort layer
  decides naming (e.g. `media/<id>/original.jpg`, `media/<id>/card.webp`).
- **No `createPresignedUpload`/`signUrl`/`close` in this slice.** Presigned direct-upload is an
  *optional capability S3 adds later* (a non-breaking interface extension); local + Node uploads use
  `put`. `signUrl` (private assets) is deferred. `fs`/S3 need no `close`.

### 2. `@setu/storage-testing` — the contract battery
Mirrors `@setu/db-testing`. Exports `runStoragePortContract(makeAdapter: () => Promise<StoragePort> |
StoragePort)` — a Vitest battery any adapter runs. `vitest` is a **peerDependency**. Self-tested
against an **inline in-memory reference** (a `Map<string, StoredObject>` adapter), exactly as
`db-testing` self-tests a Map-based reference.

The battery asserts: `put`→`get` round-trips the exact bytes **and** `contentType`; `get` of an absent
key → `null`; `put` overwrites; `delete` removes (and is a no-op when absent); `exists` reflects
put/delete; `url(key)` contains the key. `makeAdapter` must return a **fresh, empty** store each call.

### 3. `@setu/storage-local` — the disk adapter
`createLocalStorage({ dir, baseUrl }): StoragePort`:
- `put` writes the bytes to `dir/<key>` (creating parent dirs) **and** persists the `contentType`
  in a sibling sidecar (`<key>.ctype`), so `get` returns it honestly rather than guessing from the
  extension.
- `get` reads the file + sidecar (→ `null` if the file is absent); `delete` removes both; `exists`
  stats the file; `url(key)` = `` `${baseUrl}/${key}` `` (trailing/leading slashes normalised).
- **Security — key sanitisation (first-class):** a `key` like `../../etc/passwd` or an absolute path
  must NOT escape `dir`. The adapter rejects keys that are absolute, contain `..` segments, or resolve
  outside `dir` (throws a clear error). This is the one real hazard of a disk-backed blob store and is
  tested.
- The `dir` is gitignored (uploaded assets aren't committed by this layer); the draft→published sync
  is a later concern. For dev, `dir` points at a statically-served path so the site can render assets.

## Data flow

```
upload/ImagePort layer (later)  ──put(key, bytes, {contentType})──▶  StoragePort
                                                                      ├─ storage-local → dir/<key> (+ .ctype sidecar)
                                                                      └─ storage-s3 (later) → bucket object
site/serving  ──url(key)──▶  baseUrl/<key>   (a CDN/static path; signed URLs = later signUrl)
```

## Error handling

- `get`/`exists` on an absent key → `null`/`false` (never throw).
- `delete` of an absent key → no-op (idempotent).
- **Path traversal:** `storage-local` throws on a key that is absolute, contains `..`, or resolves
  outside `dir` — before any fs write/read.
- A genuine fs error (permissions, disk full) propagates (fail loud — not swallowed).

## Testing

- **`@setu/storage-testing`:** `runStoragePortContract` self-tested against the inline in-memory
  reference (proves the battery + the reference).
- **`@setu/storage-local`:** runs `runStoragePortContract(() => createLocalStorage({ dir: <tmp>,
  baseUrl: '/uploads' }))` against a fresh temp dir per case (mirrors `db-sqlite`'s on-disk contract
  run); plus targeted tests for **path-traversal rejection** (`..`/absolute/escaping keys throw) and
  an **on-disk persistence** check (bytes + contentType survive a fresh adapter over the same dir).
- **edge guard:** `@setu/core`'s `tsconfig.edge.json` includes `src/storage` and must compile with no
  Node/DOM types (the interface is pure) — adversarial check: importing `node:fs` into the port file
  fails the guard.
- Repo-wide tests + typecheck green.

## Out of scope (later media slices — roadmap)

Upload API + auth-gating (#2); editor image block + round-trip (#3); `ImagePort` + variants/srcset/
focal/quality (#4); media library UI (#5); `@setu/storage-s3` + presigned direct-upload (#6);
`signUrl`/private assets; draft→published asset sync; a standalone shippable in-memory storage adapter
(add only if the admin needs in-browser uploads).

## Success criteria

`StoragePort` (dumb keyed-blob store) is defined in `@setu/core` (edge-safe), `@setu/storage-testing`
runs a behavioural battery any adapter passes, and `@setu/storage-local` stores/serves keyed bytes
with their content type and is hardened against path traversal — all green, with the contract suite
ready for `@setu/storage-s3` to drop into later. No UI, no optimization, no S3 — the clean foundation.
