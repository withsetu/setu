import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

export interface CapFlags {
  imageProcessing: boolean
  writableMediaStore: boolean
  backgroundJobs: boolean
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

export function useCapabilities() {
  const [caps, setCaps] = useState<CapFlags | null>(null)
  const [auth, setAuth] = useState<AuthCapabilities | null>(null)
  const [email, setEmail] = useState<EmailCapabilities | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // `needsSetup` is NOT boot-time-static — it flips from true to false the moment first-run setup or
  // an invite creates a user. So this is a `refetch`able thunk, not a one-shot fetch: SessionGate
  // re-runs it on sign-out, otherwise a stale `needsSetup:true` cached when the instance had 0 users
  // would route a signed-out admin to the SetupScreen instead of the LoginScreen (UAT 2026-07-05).
  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/capabilities`)
      const data = (await res.json()) as {
        capabilities?: CapFlags
        auth?: AuthCapabilities
        email?: EmailCapabilities
        mode?: string
      }
      setCaps(data.capabilities ?? null)
      setAuth(data.auth ?? null)
      setEmail(data.email ?? null)
      setMode(data.mode ?? null)
    } catch {
      setCaps(null)
      setAuth(null)
      setEmail(null)
      setMode(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { caps, auth, email, mode, loading, refetch }
}
