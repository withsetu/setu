import { deleteDB } from 'idb'

/** DEV-ONLY: wipe the persistent stores and reload (the bootstrap re-seeds the
 *  samples because the DB is then empty). Never shipped — callers gate on
 *  import.meta.env.DEV so Vite eliminates it from production. */
export async function resetToSampleContent(): Promise<void> {
  await Promise.all([deleteDB('setu-data'), deleteDB('setu-git')])
  location.reload()
}
