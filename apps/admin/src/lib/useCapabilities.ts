import { useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'

const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

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

export function useCapabilities() {
  const [caps, setCaps] = useState<CapFlags | null>(null)
  const [auth, setAuth] = useState<AuthCapabilities | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/capabilities`)
        const data = (await res.json()) as { capabilities?: CapFlags; auth?: AuthCapabilities }
        if (live) {
          setCaps(data.capabilities ?? null)
          setAuth(data.auth ?? null)
        }
      } catch {
        if (live) {
          setCaps(null)
          setAuth(null)
        }
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return { caps, auth, loading }
}
