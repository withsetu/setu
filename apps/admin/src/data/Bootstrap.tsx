import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import {
  createMemoryDataPort,
  createMemoryIndexPort,
  createMemoryMediaIndexPort
} from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import {
  createIdbDataPort,
  createIdbIndexPort,
  createIdbMediaIndexPort
} from '@setu/db-idb'
import { createIdbGitPort } from '@setu/git-idb'
import { createHttpGitPort } from '@setu/git-http'
import { createMediaIndexService } from '@setu/core'
import { createHttpSubmissionAdapter } from '@setu/submission-http'
import { bootstrapServices, ServicesProvider } from './store'
import type { Services } from './store'
import { createHttpMediaIndexService } from './http-media-index-service'
import { apiFetch } from '../lib/api-fetch'

/** Bounded wait on an IndexedDB open (or any promise): IDB opens have no native timeout, so a
 *  wedged/over-quota/private-mode browser can leave the app hung on "Loading…" forever (#248 —
 *  confirmed live). Races the real promise against a timer that REJECTS, so a caller's try/catch
 *  around this catches both an outright IDB failure and a hang the same way. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

const IDB_OPEN_TIMEOUT_MS = 5000

/** Opens the persistent (IndexedDB) adapters, seeds-if-empty, and provides the
 *  services once ready. Falls back to in-memory storage (non-persistent, but the
 *  app still works) if IndexedDB can't be opened. */
export function Bootstrap({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Services | null>(null)
  // Set alongside `services` when the IDB branch degraded to in-memory — read by the effect below
  // to fire the toast. NOT fired inline at catch-time: `<Toaster/>` (mounted in main.tsx) is a
  // CHILD of Bootstrap, gated behind `services !== null` same as `children` — so while services is
  // still null there is no mounted Toaster to receive it, and sonner does NOT replay toasts fired
  // before any Toaster instance has ever mounted (verified against sonner 2.0.7's source: Toaster
  // seeds its own `toasts` state as `[]` and only starts receiving via `ToastState.subscribe`
  // inside its own mount effect — a toast() call with zero subscribers is simply dropped). Waiting
  // until `services` itself has committed guarantees `<Toaster/>` is mounted by the time this
  // effect's toast() call runs.
  const [degraded, setDegraded] = useState<{
    message: string
    description: string
  } | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const apiBase = import.meta.env.VITE_SETU_API
      let ready: Services
      let degradeNotice: { message: string; description: string } | null = null
      if (apiBase) {
        // Server-backed GitPort (Cut A): Publish commits to the real repo via the API.
        // Drafts stay in-browser (IndexedDB) this cut — but IDB is not guaranteed to be
        // available (wedged, over-quota, private-mode) and its open() has no native timeout, so
        // this whole branch degrades to in-memory equivalents on failure/timeout rather than
        // hanging the app forever on "Loading…" (#248 — the bug that motivated this).
        // apiFetch threaded in as the adapter's injectable fetch: admin (localhost:5173) and api
        // (localhost:4444) are cross-origin, so every request must carry `credentials: 'include'`
        // or the Better Auth session cookie is silently dropped (#248 Task 6 — see lib/api-fetch.ts).
        const git = createHttpGitPort({ baseUrl: apiBase, fetch: apiFetch })
        const submissions = createHttpSubmissionAdapter({
          baseUrl: apiBase,
          fetchImpl: apiFetch
        })
        try {
          const data = await withTimeout(
            createIdbDataPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (drafts) open'
          )
          // Persistent, cross-tab content index (shared via IndexedDB).
          const index = await withTimeout(
            createIdbIndexPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (content index) open'
          )
          const mediaIndexPort = await withTimeout(
            createIdbMediaIndexPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (media index) open'
          )
          // Server-backed media index (#464 Increment B): reads go through
          // /api/index/media/query; the IDB port becomes the offline cache.
          const mediaIndex = createHttpMediaIndexService({
            apiBase,
            fetchImpl: apiFetch,
            mediaIndex: mediaIndexPort
          })
          ready = await bootstrapServices(
            data,
            git,
            index,
            mediaIndex,
            submissions,
            apiBase
          )
        } catch (err) {
          console.error(
            'IndexedDB unavailable or timed out — local drafts/index will not persist this session.',
            err
          )
          degradeNotice = {
            message:
              'Local storage is unavailable — drafts won’t be saved between reloads this session.',
            description:
              'Publishing still works normally. Try a different browser or disabling private/incognito mode to restore local persistence.'
          }
          // Same degrade-to-memory shape as the no-API branch below: the GitPort/submissions stay
          // server-backed (they were never IDB — nothing to fall back for), only the IDB-backed
          // pieces (drafts, content index, media index) swap to in-memory/no-op equivalents.
          // Index/media reads stay server-backed too — only their offline CACHE degrades to memory.
          const mediaIndex = createHttpMediaIndexService({
            apiBase,
            fetchImpl: apiFetch,
            mediaIndex: createMemoryMediaIndexPort()
          })
          ready = await bootstrapServices(
            createMemoryDataPort(),
            git,
            createMemoryIndexPort(),
            mediaIndex,
            submissions,
            apiBase
          )
        }
      } else {
        try {
          const data = await withTimeout(
            createIdbDataPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (drafts) open'
          )
          const git = await withTimeout(
            createIdbGitPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (git) open'
          )
          // Persistent, cross-tab content index (shared via IndexedDB).
          const index = await withTimeout(
            createIdbIndexPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (content index) open'
          )
          const mediaIndexPort = await withTimeout(
            createIdbMediaIndexPort(),
            IDB_OPEN_TIMEOUT_MS,
            'IndexedDB (media index) open'
          )
          const mediaIndex = createMediaIndexService({
            mediaIndex: mediaIndexPort,
            fetchRaw: async () => []
          })
          ready = await bootstrapServices(data, git, index, mediaIndex)
        } catch (err) {
          console.error(
            'IndexedDB unavailable — using in-memory storage for this session.',
            err
          )
          degradeNotice = {
            message:
              'Local storage is unavailable — nothing will be saved this session.',
            description:
              'Try a different browser or disabling private/incognito mode to restore local persistence.'
          }
          ready = await bootstrapServices(
            createMemoryDataPort(),
            createMemoryGitPort()
          )
        }
      }
      if (live) {
        setServices(ready)
        if (degradeNotice) setDegraded(degradeNotice)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  // Fires only once `services` has committed (i.e. `<Toaster/>` — a sibling inside the now-mounted
  // `children` — is guaranteed to exist to receive it). See the `degraded` state comment above.
  useEffect(() => {
    if (services !== null && degraded) {
      toast.error(degraded.message, {
        description: degraded.description,
        duration: 10000
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services])

  if (services === null) {
    return (
      <div className="boot-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}
