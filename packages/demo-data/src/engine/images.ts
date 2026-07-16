/** Resumable featured-image batch (#512): bounded-concurrency downloads via
 *  core's SSRF-hardened `safeFetch`, ingest through core `ingestImage` (the
 *  same width ladder + manifest the upload route produces), and a
 *  `.media.json` record sidecar mirroring `apps/api/src/media.ts` so the
 *  media library lists seeded images.
 *
 *  Deliberately NOT dependent on product background-job infra (epic #509):
 *  resume comes from the caller-owned checkpoint (`onResult` after every
 *  item), abort from the AbortSignal (checked between items). Failures are
 *  counted, never fatal — a flaky IIIF response must not kill a 30k seed. */
import {
  ingestImage,
  manifestKey,
  mediaRecordKey,
  originalKey,
  safeFetch
} from '@setu/core'
import type {
  ImagePort,
  MediaManifest,
  MediaRecord,
  SafeFetchOptions,
  StoragePort
} from '@setu/core'

/** Same ladder/format defaults as the upload route (apps/api/src/media.ts). */
export const IMAGE_WIDTHS: number[] = [400, 800, 1200, 1600]
/** Per-image download cap. IIIF full-width JPEGs run single-digit MiB; 15 MiB
 *  leaves headroom while bounding a hostile/broken response. */
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024
export const IMAGE_TIMEOUT_MS = 60_000

export interface ImageTask {
  /** Pack post id — the checkpoint key. */
  id: string
  url: string
  mediaKey: string
  /** Original filename recorded in the media library (e.g. `<slug>.jpg`). */
  filename: string
}

export interface ImageBatchOptions {
  tasks: ImageTask[]
  storage: StoragePort
  image: ImagePort
  fetchOpts?: Pick<SafeFetchOptions, 'fetchImpl' | 'resolveHost'>
  concurrency?: number
  signal?: AbortSignal
  /** Return true to skip a task (already completed by a previous run). */
  isDone: (task: ImageTask) => boolean
  /** Called after every task settles — the checkpoint/manifest write seam. */
  onResult: (
    task: ImageTask,
    result: 'done' | 'failed' | 'reused',
    error?: string
  ) => Promise<void> | void
  now?: () => number
}

export interface ImageBatchSummary {
  done: number
  failed: number
  reused: number
}

async function ingestOne(
  task: ImageTask,
  opts: ImageBatchOptions
): Promise<void> {
  const res = await safeFetch(task.url, undefined, {
    ...opts.fetchOpts,
    maxBytes: IMAGE_MAX_BYTES,
    timeoutMs: IMAGE_TIMEOUT_MS
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${res.finalUrl}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/'))
    throw new Error(`not an image: content-type "${contentType}"`)

  const { storage, image } = opts
  const key = originalKey(task.mediaKey, 'jpg')
  await storage.put(key, res.body, { contentType: 'image/jpeg' })
  const manifest: MediaManifest = await ingestImage(
    { image, storage },
    {
      mediaKey: task.mediaKey,
      bytes: res.body,
      originalKey: key,
      formats: ['webp'],
      widths: IMAGE_WIDTHS,
      lqip: false
    }
  )

  // `.media.json` record sidecar — the media-library inventory row (mirrors
  // apps/api/src/media.ts's upload route field-for-field).
  const smallest = manifest.variants
    .slice()
    .sort((a, b) => a.width - b.width)[0]
  const record: MediaRecord = {
    mediaKey: task.mediaKey,
    key,
    thumbKey: smallest ? smallest.key : null,
    filename: task.filename,
    contentType: 'image/jpeg',
    isImage: true,
    width: manifest.original.width,
    height: manifest.original.height,
    bytes: res.body.byteLength,
    uploadedAt: (opts.now ?? Date.now)()
  }
  await storage.put(
    mediaRecordKey(task.mediaKey),
    new TextEncoder().encode(JSON.stringify(record)),
    { contentType: 'application/json' }
  )
}

/** True when a previous run fully ingested this media key (its storage-side
 *  manifest sidecar exists) — the cross-run reuse check. */
export async function mediaAlreadyIngested(
  storage: StoragePort,
  mediaKey: string
): Promise<boolean> {
  return storage.exists(manifestKey(mediaKey))
}

export async function runImageBatch(
  opts: ImageBatchOptions
): Promise<ImageBatchSummary> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const summary: ImageBatchSummary = { done: 0, failed: 0, reused: 0 }
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      opts.signal?.throwIfAborted()
      const index = next++
      if (index >= opts.tasks.length) return
      const task = opts.tasks[index]!
      if (opts.isDone(task)) {
        summary.reused++
        await opts.onResult(task, 'reused')
        continue
      }
      try {
        await ingestOne(task, opts)
        summary.done++
        await opts.onResult(task, 'done')
      } catch (err) {
        // An abort mid-download is a stop request, not a failure to record.
        if (opts.signal?.aborted) throw err
        summary.failed++
        await opts.onResult(
          task,
          'failed',
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, opts.tasks.length) }, worker)
  )
  return summary
}
