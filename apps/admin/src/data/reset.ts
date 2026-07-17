/** DEV-ONLY: wipe the persistent browser-side stores and reload (the bootstrap
 *  then re-syncs — from the api in the server-backed topology, or by re-seeding
 *  the samples in the no-API in-browser one). Never shipped — callers gate on
 *  import.meta.env.DEV so Vite eliminates it from production (#513's Demo Data
 *  panel is the only caller since the floating dev-reset button was absorbed,
 *  #492).
 *
 *  Two deliberate changes from the original floating-button implementation
 *  (found live during #513 UAT):
 *  - Enumerate every `setu-*` database instead of hard-coding two: the
 *    server-backed topology also caches `setu-index` / `setu-media-index`
 *    (#464), and the old fixed list left a stale drafts/index cache behind.
 *  - Do NOT await deletion. This page's own open connections BLOCK an IDB
 *    delete, so awaiting it hangs forever and the reload never happens.
 *    Deletion requests queue per-database; the reload closes this page's
 *    connections, the queued deletes then run, and the reloaded Bootstrap's
 *    open() calls queue behind them — so the fresh page always sees fresh
 *    stores (request ordering per database is guaranteed by the IndexedDB
 *    spec). */
export async function resetToSampleContent(): Promise<void> {
  let names: string[] = []
  try {
    names = (await indexedDB.databases())
      .map((db) => db.name)
      .filter((name): name is string => !!name && name.startsWith('setu-'))
  } catch {
    /* databases() unsupported → fall through to the known set */
  }
  if (names.length === 0)
    names = ['setu-data', 'setu-git', 'setu-index', 'setu-media-index']
  for (const name of names) indexedDB.deleteDatabase(name)
  // One macrotask so versionchange handlers that close politely get to run.
  await new Promise((resolve) => setTimeout(resolve, 50))
  location.reload()
}
