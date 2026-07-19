/** Client for the dev-only /api/demo control plane (#513) and the polling
 *  hook the Demo Data panel renders from. Mirrors the reprocess polling
 *  pattern (MediaSettings): GET status on an interval while a job runs, stop
 *  on terminal — never SSE (per the #512 design). DEV-only code: everything
 *  importing this is gated `import.meta.env.DEV` and dead-code-eliminated
 *  from production builds. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api-fetch'

export interface DemoDataset {
  present: boolean
  kind: 'dump' | 'sample' | null
}

export type DemoJobKind =
  'seed' | 'unseed-generated' | 'reset-sample' | 'reset-zero' | 'fetch-dump'
export type DemoJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface DemoSeedUser {
  email: string
  role: string
  /** null = the account already existed; its password is unchanged. */
  password: string | null
}

export interface DemoSeedSummary {
  users: DemoSeedUser[]
  posts: number
  images: number
  imagesReused: number
  imageFailures: number
  commits: number
  skipped: Record<string, number>
  durationMs: number
}

export interface DemoRemoveSummary {
  posts: number
  media: number
  users: number
  userFailures: number
  usersSkipped: number
  categories: number
  durationMs: number
}

export interface DemoResetSummary {
  removed: DemoRemoveSummary
  filesRemoved: number
  filesRestored: number
}

export interface DemoJob {
  id: string
  kind: DemoJobKind
  status: DemoJobStatus
  phase: string
  done: number
  total: number
  imageFailures: number
  warnings: string[]
  cancellable: boolean
  error?: string
  startedAt: number
  finishedAt?: number
  seedSummary?: DemoSeedSummary
  removeSummary?: DemoRemoveSummary
  resetSummary?: DemoResetSummary
}

export interface DemoStatus {
  dataset: DemoDataset
  job: DemoJob | null
}

/** Named featured-image size preset — the api maps it to engine width arrays
 *  server-side (the wire never carries raw arrays). */
export type ImageSizeMix = 'mixed' | 'small' | 'large'

export interface SeedRequest {
  posts: number
  users: { admin: number; maintainer: number; editor: number; author: number }
  draftFraction: number
  relaxText: boolean
  imageSizeMix: ImageSizeMix
  limitImages?: number
}

export type ResetLevel = 'generated' | 'sample' | 'zero'

/** Turn a non-ok /api/demo response into a human-readable Error. */
async function toError(res: Response): Promise<Error> {
  let code = ''
  try {
    code = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    /* non-JSON body */
  }
  if (code === 'job-running')
    return new Error(
      'Another demo-data job is already running — wait for it to finish.'
    )
  if (code === 'source-missing')
    return new Error(
      'The demo dataset is not downloaded yet — use “Download dataset” first.'
    )
  if (code === 'not-cancellable')
    return new Error('The dataset download cannot be cancelled once started.')
  return new Error(code !== '' ? code : `Request failed (${res.status})`)
}

const POLL_MS = 1000

export interface DemoApi {
  status: DemoStatus | null
  /** Initial GET failed (api down / gated) — the panel shows an error state. */
  loadError: string | null
  refresh: () => Promise<void>
  startSeed: (body: SeedRequest) => Promise<void>
  startUnseed: (level: ResetLevel) => Promise<void>
  startFetchDump: () => Promise<void>
  cancel: () => Promise<void>
  /** True when THIS client started the job — fast jobs can reach a terminal
   *  state before a poll ever observes them 'running', so "did we watch it
   *  run" alone under-counts; a job we initiated is always ours to announce. */
  startedHere: (jobId: string) => boolean
}

export function useDemoApi(apiBase: string): DemoApi {
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/demo/status`)
      if (!mounted.current) return
      if (!res.ok) throw await toError(res)
      setStatus((await res.json()) as DemoStatus)
      setLoadError(null)
    } catch (e) {
      if (!mounted.current) return
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [apiBase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll while a job runs; stop on terminal (the refresh that flips the
  // status re-runs this effect and clears the interval).
  const running = status?.job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  const startedIds = useRef(new Set<string>())
  const post = useCallback(
    async (path: string, body?: unknown) => {
      const res = await apiFetch(`${apiBase}${path}`, {
        method: 'POST',
        ...(body !== undefined
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body)
            }
          : {})
      })
      if (!res.ok) throw await toError(res)
      try {
        const { id } = (await res.json()) as { id?: string }
        if (id) startedIds.current.add(id)
      } catch {
        /* cancel returns {ok} — nothing to record */
      }
      await refresh()
    },
    [apiBase, refresh]
  )

  return {
    status,
    loadError,
    refresh,
    startSeed: useCallback(
      (body: SeedRequest) => post('/api/demo/seed', body),
      [post]
    ),
    startUnseed: useCallback(
      (level: ResetLevel) => post('/api/demo/unseed', { level }),
      [post]
    ),
    startFetchDump: useCallback(() => post('/api/demo/fetch-dump'), [post]),
    cancel: useCallback(() => post('/api/demo/cancel'), [post]),
    startedHere: useCallback(
      (jobId: string) => startedIds.current.has(jobId),
      []
    )
  }
}
