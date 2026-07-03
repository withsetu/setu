import { useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'

const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

export interface CapFlags {
  imageProcessing: boolean
  writableMediaStore: boolean
  backgroundJobs: boolean
}

export function useCapabilities() {
  const [caps, setCaps] = useState<CapFlags | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/capabilities`)
        const data = (await res.json()) as { capabilities?: CapFlags }
        if (live) setCaps(data.capabilities ?? null)
      } catch {
        if (live) setCaps(null)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return { caps, loading }
}
