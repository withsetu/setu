import { useCallback, useEffect, useRef, useState } from 'react'
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
import { createHttpGitPort, GitApiError } from '@setu/git-http'
import { createMediaIndexService } from '@setu/core'
import { createHttpSubmissionAdapter } from '@setu/submission-http'
import { bootstrapServices, ServicesProvider } from './store'
import type { Services } from './store'
import { createHttpMediaIndexService } from './http-media-index-service'
import { apiFetch } from '../lib/api-fetch'
import type { CapabilitiesError } from '../lib/useCapabilities'
import { ApiUnreachable } from '../auth/ApiUnreachable'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'

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

/** What the admin needed the API for at startup — the line under ApiUnreachable's title. */
export const BOOT_API_DESCRIPTION = 'The admin needs the API to load your site.'

type DegradeNotice = { message: string; description: string }

/** Why startup did not produce services.
 *  - `api` — the API could not be read (it is down, restarting, or answered with an error). A
 *    transient outage: ApiUnreachable retries it on its own.
 *  - `other` — something else failed (the in-browser fallback itself). Not an API outage, so it
 *    must not be described as one. */
type BootFailure = { kind: 'api'; error: CapabilitiesError } | { kind: 'other' }

type BootOutcome =
  | { ok: true; services: Services; degradeNotice: DegradeNotice | null }
  | { ok: false; failure: BootFailure }

/** How a failed git-http read maps onto the shared API-failure vocabulary: the API answered and
 *  refused (`http` + status), answered with a body that would not parse (`malformed`), or never
 *  answered at all (`network`). */
function classifyApiFailure(err: unknown): CapabilitiesError {
  if (err instanceof GitApiError) return { kind: 'http', status: err.status }
  if (err instanceof SyntaxError) return { kind: 'malformed' }
  return { kind: 'network' }
}

/** One startup attempt. Never rejects: every failure comes back as `{ ok: false }`. */
async function startServices(): Promise<BootOutcome> {
  const apiBase = import.meta.env.VITE_SETU_API
  try {
    if (apiBase) {
      // Server-backed GitPort (Cut A): Publish commits to the real repo via the API.
      // apiFetch threaded in as the adapter's injectable fetch: admin (localhost:5173) and api
      // (localhost:4444) are cross-origin, so every request must carry `credentials: 'include'`
      // or the Better Auth session cookie is silently dropped (#248 Task 6 — see lib/api-fetch.ts).
      const git = createHttpGitPort({ baseUrl: apiBase, fetch: apiFetch })
      // #1181: read the API FIRST, on its own. Startup needs it (seeding reads git.headSha()), and
      // only a read made in isolation can say truthfully that the API — not this browser's local
      // storage — is what failed. Before this, an API outage fell into the IndexedDB catch below,
      // logged "IndexedDB unavailable", and ended on a screen that blamed the connection with no
      // automatic retry. `/git/head` is the one ungated git read (apps/api/src/app.ts).
      try {
        await git.headSha()
      } catch (err) {
        console.error('[bootstrap] the Setu API could not be read.', err)
        return {
          ok: false,
          failure: { kind: 'api', error: classifyApiFailure(err) }
        }
      }
      const submissions = createHttpSubmissionAdapter({
        baseUrl: apiBase,
        fetchImpl: apiFetch
      })
      // Drafts stay in-browser (IndexedDB) this cut — but IDB is not guaranteed to be available
      // (wedged, over-quota, private-mode) and its open() has no native timeout, so this branch
      // degrades to in-memory equivalents on failure/timeout rather than hanging the app forever on
      // "Loading…" (#248 — the bug that motivated this).
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
        const services = await bootstrapServices(
          data,
          git,
          index,
          mediaIndex,
          submissions,
          apiBase
        )
        return { ok: true, services, degradeNotice: null }
      } catch (err) {
        // The API answered moments ago; if it refused now, that is still the API, not storage.
        if (err instanceof GitApiError) throw err
        console.error(
          'IndexedDB unavailable or timed out — local drafts/index will not persist this session.',
          err
        )
        // Same degrade-to-memory shape as the no-API branch below: the GitPort/submissions stay
        // server-backed (they were never IDB — nothing to fall back for), only the IDB-backed
        // pieces (drafts, content index, media index) swap to in-memory/no-op equivalents.
        // Index/media reads stay server-backed too — only their offline CACHE degrades to memory.
        const mediaIndex = createHttpMediaIndexService({
          apiBase,
          fetchImpl: apiFetch,
          mediaIndex: createMemoryMediaIndexPort()
        })
        const services = await bootstrapServices(
          createMemoryDataPort(),
          git,
          createMemoryIndexPort(),
          mediaIndex,
          submissions,
          apiBase
        )
        return {
          ok: true,
          services,
          degradeNotice: {
            message:
              'Local storage is unavailable — drafts won’t be saved between reloads this session.',
            description:
              'Publishing still works normally. Try a different browser or disabling private/incognito mode to restore local persistence.'
          }
        }
      }
    }
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
      const services = await bootstrapServices(data, git, index, mediaIndex)
      return { ok: true, services, degradeNotice: null }
    } catch (err) {
      console.error(
        'IndexedDB unavailable — using in-memory storage for this session.',
        err
      )
      const services = await bootstrapServices(
        createMemoryDataPort(),
        createMemoryGitPort()
      )
      return {
        ok: true,
        services,
        degradeNotice: {
          message:
            'Local storage is unavailable — nothing will be saved this session.',
          description:
            'Try a different browser or disabling private/incognito mode to restore local persistence.'
        }
      }
    }
  } catch (err) {
    console.error('Setu failed to start.', err)
    return {
      ok: false,
      failure:
        apiBase && err instanceof GitApiError
          ? { kind: 'api', error: classifyApiFailure(err) }
          : { kind: 'other' }
    }
  }
}

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
  const [degraded, setDegraded] = useState<DegradeNotice | null>(null)
  // Bootstrap is mounted OUTSIDE NotificationProvider/UnhandledRejectionReporter/<Toaster/> (they
  // are its children, gated behind services !== null in main.tsx), so a bootstrap-stage failure
  // is the one the global safety net cannot see (#835). Rather than the risky hoist of
  // NotificationProvider above Bootstrap — which would also break the carefully-sequenced
  // `degraded` toast that depends on <Toaster/> mounting with `services` — Bootstrap renders its
  // OWN error + retry instead: ApiUnreachable for an API outage (#1181), BootFailed otherwise.
  const [failure, setFailure] = useState<BootFailure | null>(null)
  // Only the latest attempt's outcome is applied (StrictMode's double effect run, a Retry click
  // racing an automatic retry), and nothing is applied after unmount.
  const latest = useRef(0)
  const mounted = useRef(true)

  const boot = useCallback(async () => {
    const seq = ++latest.current
    const outcome = await startServices()
    if (!mounted.current || seq !== latest.current) return
    if (outcome.ok) {
      setFailure(null)
      setServices(outcome.services)
      if (outcome.degradeNotice) setDegraded(outcome.degradeNotice)
    } else {
      // A fresh object every time, even for the same cause: ApiUnreachable schedules its next
      // automatic attempt off a new `error` (see its onRetry contract).
      setFailure(outcome.failure)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Never rejects: startServices reports every failure as an outcome.
    void (async () => {
      await boot()
    })()
    return () => {
      mounted.current = false
    }
  }, [boot])

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

  if (services === null && failure?.kind === 'api') {
    return (
      <ApiUnreachable
        error={failure.error}
        onRetry={boot}
        description={BOOT_API_DESCRIPTION}
      />
    )
  }
  if (services === null && failure?.kind === 'other') {
    return <BootFailed onRetry={boot} />
  }
  if (services === null) {
    return (
      <div className="boot-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}

/** Startup failed for a reason that is NOT the API being unreachable — the in-browser fallback
 *  itself could not start. Same card layout as ApiUnreachable, but it does not blame the
 *  connection and does not retry on its own: a retry loop cannot fix a broken browser store. */
function BootFailed({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    setRetrying(true)
    try {
      await onRetry() // never rejects: Bootstrap's boot reports failure through state
    } finally {
      setRetrying(false)
    }
  }
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md" role="alert">
        <CardHeader className="text-center">
          <CardTitle>Setu couldn&apos;t start</CardTitle>
          <CardDescription>
            The admin couldn&apos;t set itself up in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-center text-sm text-muted-foreground">
          <p>
            Something went wrong while starting the admin. Try again; if it
            keeps happening, reload the page — the browser console has the
            details.
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
