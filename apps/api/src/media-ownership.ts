import { manifestKey, mediaRecordKey } from '@setu/core'
import type { StoragePort } from '@setu/core'

/** Whether `mediaKey` may delete the variant object at `key`.
 *
 *  A pre-#1159 variant key (`<id>-<w>w.<ext>`) can equal another upload's ORIGINAL
 *  (`<other>.<ext>`, where `<other>` = `<id>-<w>w`), and storage written before #1159 may hold
 *  manifests in exactly that state. Such a key is the other upload's file, so it is never
 *  deleted on this id's behalf. Keys written since #1159 (`<id>.<w>w.<ext>`) strip to
 *  `<id>.<w>w`, which no upload can own, so they are always this id's.
 *  Enforced by apps/api/test/reprocess-cleanup.test.ts ("…never deleted"). */
export async function mayDeleteVariant(
  storage: StoragePort,
  mediaKey: string,
  key: string
): Promise<boolean> {
  const asOriginalOf = key.replace(/\.[^./]*$/, '')
  if (asOriginalOf === mediaKey) return true
  return !(
    (await storage.exists(mediaRecordKey(asOriginalOf))) ||
    (await storage.exists(manifestKey(asOriginalOf)))
  )
}
