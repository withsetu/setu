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
import { DeployOutcomeUnknownError } from './deploy-errors'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

// Function-property syntax (not method syntax): these are standalone closures consumers
// destructure freely (`const { rebuild } = useDeploy()`), never `this`-bound methods.
// Method syntax makes @typescript-eslint/unbound-method flag every destructure.
interface DeployApi {
  /** Server truth from GET /api/deploy/status (#208); null while loading or where the
   *  actor can't see it (the API is the enforcement boundary — 401/403 → null). */
  status: DeployStatus | null
  /** Why the last status load failed, or null. Set only for a real failure — the server
   *  erred, was unreachable, or answered with something that isn't a status. A 401/403 is
   *  NOT a failure (the actor simply can't deploy) and leaves this null, so the control hides
   *  for them and shows an error with Retry for everyone else (#1158). User-facing prose.
   *  Pinned by apps/admin/test/deploy.test.tsx. */
  loadError: string | null
  /** The deploy picture in the shape core's lifecycle derivation consumes (#208).
   *  Reads a ref, so long-lived consumers (the index service) always see current truth. */
  deployInfo: () => DeployInfo
  refresh: () => Promise<void>
  /** Kick a rebuild (#209) and resolve when the build finishes; rejects with the
   *  server's message on 409 (already running / capability off) or a failed build. */
  rebuild: () => Promise<void>
  /** True while a build is in flight — ours (this tab called rebuild()) OR another
   *  session's, per server truth (#571). Controls are disabled off this. */
  running: boolean
  /** Epoch ms the in-flight build started, for the elapsed readout; null when idle.
   *  Ours is the client clock; another session's comes from the job (server clock). */
  startedAt: number | null
  /** Whether the deploy confirmation is open (#571). Deploying is outward and costly,
   *  so every entry point (sidebar control, command palette) asks first. */
  confirmOpen: boolean
  /** Ask to deploy: opens the confirmation. Never starts a build by itself. */
  requestRebuild: () => void
  closeConfirm: () => void
}

const DeployContext = createContext<DeployApi | null>(null)

/** Trust nothing off the wire: a proxy or test stub can answer this route with
 *  arbitrary JSON, and an unvalidated shape crashes lifecycle derivation downstream.
 *  Fail closed to null (no deploy UI) on anything that isn't a DeployStatus. */
function parseStatus(raw: unknown): DeployStatus | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  // headSha is null on a repo with no commits yet (#1158) — a real answer, not a malformed one.
  if (
    typeof s.pending !== 'boolean' ||
    (typeof s.headSha !== 'string' && s.headSha !== null)
  )
    return null
  if (!Array.isArray(s.changedPaths) || typeof s.canRebuild !== 'boolean')
    return null
  // Normalized rather than required (#1087): an api that predates the field is not a malformed
  // status, but the type promises `string | null`, so anything that is not a string becomes null
  // here instead of reaching consumers as undefined.
  return {
    ...(raw as DeployStatus),
    rebuildBlockedReason:
      typeof s.rebuildBlockedReason === 'string'
        ? s.rebuildBlockedReason
        : null,
    baselineUnresolvable: s.baselineUnresolvable === true
  }
}

const LOAD_FAILED = "Couldn't load the deploy status"

/** A non-ok status response the provider should treat as "this actor can't deploy", not as a
 *  failure: the API is the enforcement boundary, and the control hides for them. */
const isDenied = (code: number) => code === 401 || code === 403

const POLL_MS = 1500

export function DeployProvider({
  children,
  enabled = true
}: {
  children: ReactNode
  /** False in the no-api topology (main.tsx `hasApi`): there is no deploy control plane to
   *  ask, so nothing is fetched and no error is shown. */
  enabled?: boolean
}) {
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const statusRef = useRef<DeployStatus | null>(null)
  // #571: in-flight bookkeeping. `busy` covers the window between POST /rebuild and the
  // first poll that reports the job, where server truth hasn't caught up yet.
  const [busy, setBusy] = useState(false)
  const [ownStartedAt, setOwnStartedAt] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!enabled) return
    let res: Response
    try {
      res = await apiFetch(`${apiBase}/api/deploy/status`)
    } catch {
      statusRef.current = null
      setStatus(null)
      setLoadError(`${LOAD_FAILED}. Check your connection and try again.`)
      return
    }
    if (isDenied(res.status)) {
      // Unauthenticated or below site.deploy → no deploy UI, and nothing to report.
      statusRef.current = null
      setStatus(null)
      setLoadError(null)
      return
    }
    let s: DeployStatus | null = null
    if (res.ok) {
      try {
        s = parseStatus(await res.json())
      } catch {
        s = null
      }
    }
    if (s === null) {
      statusRef.current = null
      setStatus(null)
      setLoadError(
        res.ok
          ? `${LOAD_FAILED} — the server sent a response Setu doesn't understand.`
          : `${LOAD_FAILED} — the server had a problem (${res.status}).`
      )
      return
    }
    statusRef.current = s
    setStatus(s)
    setLoadError(null)
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const deployInfo = useCallback((): DeployInfo => {
    const s = statusRef.current
    // An unresolvable baseline (#1158) carries an EMPTY diff that means "unknown", so passing
    // the recorded sha through would derive every entry as live — the saved ≠ live inversion.
    // Claim nothing is live instead, the same as never deployed.
    return s === null || s.baselineUnresolvable
      ? { deployedSha: null, changed: [] }
      : { deployedSha: s.deployedSha, changed: s.changedPaths }
  }, [])

  const rebuild = useCallback(async () => {
    setBusy(true)
    setOwnStartedAt(Date.now())
    try {
      const res = await apiFetch(`${apiBase}/api/deploy/rebuild`, {
        method: 'POST'
      })
      const body = (await res.json()) as {
        error?: string
        job?: { id: string }
      }
      if (!res.ok)
        throw new Error(body.error ?? `rebuild failed (${res.status})`)
      // Poll until the job leaves 'running'; surface a failed build as a rejection.
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        let s: Response
        try {
          s = await apiFetch(`${apiBase}/api/deploy/status`)
        } catch {
          throw new DeployOutcomeUnknownError(
            'lost contact with the server while the build was running'
          )
        }
        if (!s.ok)
          throw new DeployOutcomeUnknownError(
            `the build status could not be read (server error ${s.status})`
          )
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
    } finally {
      // Always release the control — a rejected rebuild must not leave the UI
      // stuck "Building…" forever (the toast is the caller's job).
      setBusy(false)
      setOwnStartedAt(null)
    }
  }, [])

  const requestRebuild = useCallback(() => setConfirmOpen(true), [])
  const closeConfirm = useCallback(() => setConfirmOpen(false), [])

  // Someone else's build (another tab, another session, or one this tab lost track of): keep
  // re-reading until it leaves 'running', so the control reports how it ended — including a
  // job the api failed at boot as interrupted (#1157) — instead of "Building…" forever. Our own
  // rebuild() polls for itself. A failed read stops the chain and surfaces as loadError.
  const othersRunning = !busy && status?.job?.status === 'running'
  useEffect(() => {
    if (!othersRunning) return
    const id = setTimeout(() => void refresh(), POLL_MS)
    return () => clearTimeout(id)
  }, [othersRunning, status, refresh])

  const serverJobStartedAt =
    status?.job?.status === 'running' ? status.job.startedAt : null
  const running = busy || serverJobStartedAt !== null
  const startedAt = running ? (ownStartedAt ?? serverJobStartedAt) : null

  return (
    <DeployContext.Provider
      value={{
        status,
        loadError,
        deployInfo,
        refresh,
        rebuild,
        running,
        startedAt,
        confirmOpen,
        requestRebuild,
        closeConfirm
      }}
    >
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
