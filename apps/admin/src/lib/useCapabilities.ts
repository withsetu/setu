import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './api-fetch'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

export interface CapFlags {
  imageProcessing: boolean
  writableMediaStore: boolean
  backgroundJobs: boolean
  /** #466: the server's git adapter implements the optional log/readFileAt
   *  capability — false hides the editor's History UI entirely (honest
   *  degradation on git-http/git-idb topologies; card #6). */
  history: boolean
}

/** #248 Task 5's auth capability block — mirrors apps/api/src/capabilities.ts's AuthCapabilities. */
export interface AuthCapabilities {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

/** #364's email capability block — mirrors apps/api/src/capabilities.ts's EmailCapabilities.
 *  `deliverable` is false for dev/no-op transports (console) — the admin UI should only promise
 *  password-reset emails actually arrive when this is true. */
export interface EmailCapabilities {
  transport: string
  deliverable: boolean
}

/** Why `/api/capabilities` could not be read (#1165). Kept distinct from "the API reports this
 *  capability off": a consumer that sees `error` must not render a claim about the server's
 *  configuration, because it never learned what that configuration is.
 *  - `network` — the request never got an HTTP response (API stopped, restarting, offline)
 *  - `http` — the API answered with a non-2xx status (`status` carries it)
 *  - `malformed` — a 2xx whose body was not a JSON object */
export interface CapabilitiesError {
  kind: 'network' | 'http' | 'malformed'
  status?: number
}

/** Plain-words description of a capabilities failure, for screens that surface it. */
export function describeCapabilitiesError(error: CapabilitiesError): string {
  switch (error.kind) {
    case 'network':
      return "The Setu API didn't respond. It may be stopped, restarting, or unreachable from this browser."
    case 'http':
      return `The Setu API answered with an error (HTTP ${error.status ?? 'unknown'}).`
    case 'malformed':
      return "The Setu API sent a response the admin couldn't read."
  }
}

export function useCapabilities() {
  const [caps, setCaps] = useState<CapFlags | null>(null)
  const [auth, setAuth] = useState<AuthCapabilities | null>(null)
  const [email, setEmail] = useState<EmailCapabilities | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [error, setError] = useState<CapabilitiesError | null>(null)
  const [loading, setLoading] = useState(true)
  // Overlapping refetches (sign-out refetch, a Retry click, an auto-retry tick) must not let an
  // older response overwrite a newer one: only the latest request's outcome is applied.
  const latest = useRef(0)

  // `needsSetup` is NOT boot-time-static — it flips from true to false the moment first-run setup or
  // an invite creates a user. So this is a `refetch`able thunk, not a one-shot fetch: SessionGate
  // re-runs it on sign-out, otherwise a stale `needsSetup:true` cached when the instance had 0 users
  // would route a signed-out admin to the SetupScreen instead of the LoginScreen (UAT 2026-07-05).
  //
  // Never rejects: every failure lands in `error` (apps/admin/test/use-capabilities.test.tsx covers
  // network, non-2xx and malformed-body cases), so `void refetch()` call sites cannot lose one.
  const refetch = useCallback(async () => {
    const seq = ++latest.current
    let outcome:
      | { ok: true; data: CapabilitiesBody }
      | { ok: false; error: CapabilitiesError }
    try {
      const res = await apiFetch(`${apiBase}/api/capabilities`)
      if (!res.ok) {
        outcome = { ok: false, error: { kind: 'http', status: res.status } }
      } else {
        let body: unknown
        try {
          body = await res.json()
        } catch {
          body = undefined
        }
        outcome =
          typeof body === 'object' && body !== null && !Array.isArray(body)
            ? { ok: true, data: body }
            : { ok: false, error: { kind: 'malformed' } }
      }
    } catch {
      outcome = { ok: false, error: { kind: 'network' } }
    }
    if (seq !== latest.current) return
    if (outcome.ok) {
      setCaps(outcome.data.capabilities ?? null)
      setAuth(outcome.data.auth ?? null)
      setEmail(outcome.data.email ?? null)
      setMode(outcome.data.mode ?? null)
      setError(null)
    } else {
      setCaps(null)
      setAuth(null)
      setEmail(null)
      setMode(null)
      setError(outcome.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { caps, auth, email, mode, error, loading, refetch }
}

interface CapabilitiesBody {
  capabilities?: CapFlags
  auth?: AuthCapabilities
  email?: EmailCapabilities
  mode?: string
}
