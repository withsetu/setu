import { ingestImage, manifestKey, mediaRecordKey } from '@setu/core'
import { GENERATABLE } from './media'
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

/** Reprocess one job key. A key is either a manifest (`.manifest.json`) — re-encode an image that
 *  already has variants — or a record (`.media.json`) of a generatable image with NO manifest, an
 *  upload whose ingest failed (#1161; enumerated by `reprocessKeys` in ./media). Throws when the
 *  image itself cannot be processed; `runReprocessJob` records that per item. */
export async function reprocessOne(
  deps: ReprocessDeps,
  mKey: string
): Promise<'done' | 'skipped'> {
  if (mKey.endsWith('.media.json')) return generateFromRecord(deps, mKey)
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

/** First-time variant generation for a manifest-less image record (#1161). Re-checks for a
 *  manifest — one may have been written since the job snapshotted its keys — and hands that case
 *  to the manifest path so old variants are cleaned up the usual way. */
async function generateFromRecord(
  deps: ReprocessDeps,
  recKey: string
): Promise<'done' | 'skipped'> {
  const raw = await deps.storage.get(recKey)
  if (!raw) return 'skipped'
  let rec: MediaRecord
  try {
    rec = JSON.parse(new TextDecoder().decode(raw.body)) as MediaRecord
  } catch {
    return 'skipped'
  }
  if (!GENERATABLE.has(rec.contentType)) return 'skipped'
  const mKey = manifestKey(rec.mediaKey)
  if (await deps.storage.exists(mKey)) return reprocessOne(deps, mKey)
  const origRaw = await deps.storage.get(rec.key)
  if (!origRaw) return 'skipped'
  const next = await ingestImage(
    { image: deps.image, storage: deps.storage },
    {
      mediaKey: rec.mediaKey,
      bytes: origRaw.body,
      originalKey: rec.key,
      formats: formatsFor(deps.media.imageFormat),
      widths: deps.widths,
      lqip: deps.media.imageLqip
    }
  )
  await rewriteRecord(deps, next)
  return 'done'
}

/** The name a user knows an item by, for a failure message: its record's filename, else its id. */
async function displayName(deps: ReprocessDeps, key: string): Promise<string> {
  const id = key.replace(/\.(manifest|media)\.json$/, '')
  const raw = await deps.storage.get(mediaRecordKey(id)).catch(() => null)
  if (raw) {
    try {
      const rec = JSON.parse(new TextDecoder().decode(raw.body)) as MediaRecord
      if (rec.filename) return rec.filename
    } catch {
      /* fall through to the id */
    }
  }
  return id
}

/** The job's closing message when some images could not be processed — named, so the user knows
 *  which files to replace. Capped so a large broken library cannot produce an unbounded string. */
export function failedItemsMessage(names: string[]): string {
  const shown = names.slice(0, 5).join(', ')
  const more = names.length > 5 ? ` and ${names.length - 5} more` : ''
  const n = names.length
  return (
    `${n} image${n === 1 ? '' : 's'} couldn't be processed (${shown}${more}) — ` +
    `${n === 1 ? 'it may be' : 'they may be'} corrupt. Replace ${n === 1 ? 'it' : 'them'} and run Reprocess again.`
  )
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
  // #1161: one undecodable image must not stop the rest of the library — with manifest-less
  // records now enumerated, a still-broken upload would otherwise fail every Reprocess at the
  // same key. Per-item failures are collected and named in the finished job's `error` (status
  // stays 'done': the job ran to the end). Failures from before a resume are not persisted, so
  // after a crash-resume the list covers only the resumed part. A storage failure while saving
  // progress still fails the whole job (outer catch). Pinned by
  // apps/api/test/media-ingest-failure.test.ts.
  const failed: string[] = []
  try {
    let processed = job.processed
    for (let i = job.cursor; i < job.keys.length; i += chunk) {
      for (let j = i; j < Math.min(i + chunk, job.keys.length); j++) {
        // Count only images we actually re-encoded. A 'skipped' key (missing/corrupt original) is
        // still walked — the cursor advances below so resume won't revisit it — but it must not
        // inflate the user-facing "Reprocessed N" count. cursor (position) and processed (success
        // count) are tracked independently, so honest counting costs no resume correctness.
        const key = job.keys[j]!
        try {
          if ((await reprocessOne(deps, key)) === 'done') processed++
        } catch (err) {
          console.warn(
            `reprocess failed for ${key}: ${err instanceof Error ? err.message : String(err)}`
          )
          failed.push(await displayName(deps, key))
        }
      }
      store.saveProgress(
        jobId,
        processed,
        Math.min(i + chunk, job.keys.length),
        now()
      )
    }
    store.finish(
      jobId,
      'done',
      now(),
      failed.length > 0 ? failedItemsMessage(failed) : undefined
    )
  } catch (err) {
    store.finish(
      jobId,
      'failed',
      now(),
      err instanceof Error ? err.message : String(err)
    )
  }
}
