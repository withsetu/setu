import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import type { DeployInfo, DeployStatus } from '@setu/core'
import { apiFetch } from '../lib/api-fetch'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

// Function-property syntax (not method syntax): these are standalone closures consumers
// destructure freely (`const { rebuild } = useDeploy()`), never `this`-bound methods.
// Method syntax makes @typescript-eslint/unbound-method flag every destructure.
interface DeployApi {
  /** Server truth from GET /api/deploy/status (#208); null while loading or where the
   *  actor can't see it (the API is the enforcement boundary — 401/403 → null). */
  status: DeployStatus | null
  /** The deploy picture in the shape core's lifecycle derivation consumes (#208).
   *  Reads a ref, so long-lived consumers (the index service) always see current truth. */
  deployInfo: () => DeployInfo
  refresh: () => Promise<void>
  /** Kick a rebuild (#209) and resolve when the build finishes; rejects with the
   *  server's message on 409 (already running / capability off) or a failed build. */
  rebuild: () => Promise<void>
}

const DeployContext = createContext<DeployApi | null>(null)

/** Trust nothing off the wire: a proxy or test stub can answer this route with
 *  arbitrary JSON, and an unvalidated shape crashes lifecycle derivation downstream.
 *  Fail closed to null (no deploy UI) on anything that isn't a DeployStatus. */
function parseStatus(raw: unknown): DeployStatus | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  if (typeof s.pending !== 'boolean' || typeof s.headSha !== 'string')
    return null
  if (!Array.isArray(s.changedPaths) || typeof s.canRebuild !== 'boolean')
    return null
  return raw as DeployStatus
}

const POLL_MS = 1500

export function DeployProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const statusRef = useRef<DeployStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/deploy/status`)
      if (!res.ok) throw new Error(String(res.status))
      const s = parseStatus(await res.json())
      if (s === null) throw new Error('malformed status')
      statusRef.current = s
      setStatus(s)
    } catch {
      // API absent (tests), unauthenticated, or actor below site.deploy → no deploy UI.
      statusRef.current = null
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const deployInfo = useCallback((): DeployInfo => {
    const s = statusRef.current
    return s === null
      ? { deployedSha: null, changed: [] }
      : { deployedSha: s.deployedSha, changed: s.changedPaths }
  }, [])

  const rebuild = useCallback(async () => {
    const res = await apiFetch(`${apiBase}/api/deploy/rebuild`, {
      method: 'POST'
    })
    const body = (await res.json()) as { error?: string; job?: { id: string } }
    if (!res.ok) throw new Error(body.error ?? `rebuild failed (${res.status})`)
    // Poll until the job leaves 'running'; surface a failed build as a rejection.
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const s = await apiFetch(`${apiBase}/api/deploy/status`)
      if (!s.ok) throw new Error(`status failed (${s.status})`)
      const st = parseStatus(await s.json())
      if (st === null) throw new Error('malformed status')
      statusRef.current = st
      setStatus(st)
      if (st.job === null || st.job.status !== 'running') {
        if (st.job?.status === 'failed')
          throw new Error(st.job.error ?? 'Build failed.')
        return
      }
    }
  }, [])

  return (
    <DeployContext.Provider value={{ status, deployInfo, refresh, rebuild }}>
      {children}
    </DeployContext.Provider>
  )
}

export function useDeploy(): DeployApi {
  const ctx = useContext(DeployContext)
  if (ctx === null)
    throw new Error('useDeploy must be used within a DeployProvider')
  return ctx
}
