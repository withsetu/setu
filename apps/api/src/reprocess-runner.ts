import { ingestImage } from '@setu/core'
import type { ImageFormat, ImagePort, MediaManifest, MediaSettings, ReprocessJobStore, StoragePort } from '@setu/core'

const formatsFor = (s: MediaSettings['imageFormat']): ImageFormat[] => (s === 'both' ? ['webp', 'avif'] : [s])

export interface ReprocessDeps { image: ImagePort; storage: StoragePort; media: MediaSettings; widths: number[] }

export async function reprocessOne(deps: ReprocessDeps, mKey: string): Promise<'done' | 'skipped'> {
  const manRaw = await deps.storage.get(mKey)
  if (!manRaw) return 'skipped'
  let old: MediaManifest
  try { old = JSON.parse(new TextDecoder().decode(manRaw.body)) as MediaManifest } catch { return 'skipped' }
  const origRaw = await deps.storage.get(old.original.key)
  if (!origRaw) return 'skipped'
  await ingestImage(
    { image: deps.image, storage: deps.storage },
    { mediaKey: old.id, bytes: origRaw.body, originalKey: old.original.key, formats: formatsFor(deps.media.imageFormat), widths: deps.widths, lqip: deps.media.imageLqip },
  )
  return 'done'
}

export async function runReprocessJob(
  store: ReprocessJobStore, deps: ReprocessDeps, jobId: string,
  opts: { chunkSize?: number; now?: () => number } = {},
): Promise<void> {
  const chunk = opts.chunkSize ?? 10
  const now = opts.now ?? (() => Date.now())
  const job = store.get(jobId)
  if (!job || job.status !== 'running') return
  try {
    let processed = job.processed
    for (let i = job.cursor; i < job.keys.length; i += chunk) {
      for (let j = i; j < Math.min(i + chunk, job.keys.length); j++) {
        // Count only images we actually re-encoded. A 'skipped' key (missing/corrupt original) is
        // still walked — the cursor advances below so resume won't revisit it — but it must not
        // inflate the user-facing "Reprocessed N" count. cursor (position) and processed (success
        // count) are tracked independently, so honest counting costs no resume correctness.
        if ((await reprocessOne(deps, job.keys[j]!)) === 'done') processed++
      }
      store.saveProgress(jobId, processed, Math.min(i + chunk, job.keys.length), now())
    }
    store.finish(jobId, 'done', now())
  } catch (err) {
    store.finish(jobId, 'failed', now(), err instanceof Error ? err.message : String(err))
  }
}
