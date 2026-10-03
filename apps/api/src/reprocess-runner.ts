import { ingestImage, mediaRecordKey } from '@setu/core'
import { mayDeleteVariant } from './media-ownership'
import type {
  ImageFormat,
  ImagePort,
  MediaIndexService,
  MediaManifest,
  MediaRecord,
  MediaSettings,
  ReprocessJobStore,
  StoragePort
} from '@setu/core'

const formatsFor = (s: MediaSettings['imageFormat']): ImageFormat[] =>
  s === 'both' ? ['webp', 'avif'] : [s]

export interface ReprocessDeps {
  image: ImagePort
  storage: StoragePort
  media: MediaSettings
  widths: number[]
  /** Server media index, kept fresh when Reprocess rewrites a record's thumbnail/dimensions.
   *  Best-effort, like upload's: the `.media.json` sidecar is canonical. */
  mediaIndex?: Pick<MediaIndexService, 'upsertOne'>
}

export async function reprocessOne(
  deps: ReprocessDeps,
  mKey: string
): Promise<'done' | 'skipped'> {
  const manRaw = await deps.storage.get(mKey)
  if (!manRaw) return 'skipped'
  let old: MediaManifest
  try {
    old = JSON.parse(new TextDecoder().decode(manRaw.body)) as MediaManifest
  } catch {
    return 'skipped'
  }
  const origRaw = await deps.storage.get(old.original.key)
  if (!origRaw) return 'skipped'
  const next = await ingestImage(
    { image: deps.image, storage: deps.storage },
    {
      mediaKey: old.id,
      bytes: origRaw.body,
      originalKey: old.original.key,
      formats: formatsFor(deps.media.imageFormat),
      widths: deps.widths,
      lqip: deps.media.imageLqip
    }
  )
  // #1160: the new manifest is written, so the previous variants it no longer lists are now
  // unreferenced — and DELETE only removes what the CURRENT manifest lists, so leaving them
  // would keep them publicly served after the item is deleted. Delete after the manifest write:
  // a crash in between leaves orphans, never a manifest pointing at missing files.
  const keep = new Set(next.variants.map((v) => v.key))
  keep.add(next.original.key)
  for (const v of old.variants)
    if (
      !keep.has(v.key) &&
      (await mayDeleteVariant(deps.storage, old.id, v.key))
    )
      await deps.storage.delete(v.key)
  await rewriteRecord(deps, next)
  return 'done'
}

/** Point the library record at the new variants (thumbnail + dimensions); everything else in
 *  it (filename, uploadedAt, …) is preserved. Media with no record (pre-record uploads) stay
 *  record-less — Reprocess re-encodes, it does not register media. */
async function rewriteRecord(
  deps: ReprocessDeps,
  manifest: MediaManifest
): Promise<void> {
  const recKey = mediaRecordKey(manifest.id)
  const raw = await deps.storage.get(recKey)
  if (!raw) return
  let rec: MediaRecord
  try {
    rec = JSON.parse(new TextDecoder().decode(raw.body)) as MediaRecord
  } catch {
    return
  }
  const smallest = manifest.variants
    .slice()
    .sort((a, b) => a.width - b.width)[0]
  const next: MediaRecord = {
    ...rec,
    thumbKey: smallest ? smallest.key : null,
    width: manifest.original.width,
    height: manifest.original.height
  }
  await deps.storage.put(
    recKey,
    new TextEncoder().encode(JSON.stringify(next)),
    { contentType: 'application/json' }
  )
  if (deps.mediaIndex) {
    try {
      await deps.mediaIndex.upsertOne(next)
    } catch (err) {
      console.warn(
        `media index upsert failed for ${manifest.id}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

export async function runReprocessJob(
  store: ReprocessJobStore,
  deps: ReprocessDeps,
  jobId: string,
  opts: { chunkSize?: number; now?: () => number } = {}
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
      store.saveProgress(
        jobId,
        processed,
        Math.min(i + chunk, job.keys.length),
        now()
      )
    }
    store.finish(jobId, 'done', now())
  } catch (err) {
    store.finish(
      jobId,
      'failed',
      now(),
      err instanceof Error ? err.message : String(err)
    )
  }
}
