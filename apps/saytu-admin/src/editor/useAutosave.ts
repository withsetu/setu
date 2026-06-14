import { useEffect, useRef } from 'react'
import type { DraftInput } from '@saytu/core'

export type SaveStatus = 'idle' | 'saving' | 'saved'

/** Debounced autosave with a single-in-flight guard. Fires `save(getInput())`
 *  ~`delayMs` after `rev` changes (skipping the initial rev 0). A change during
 *  an in-flight save queues exactly one follow-up. */
export function useAutosave(opts: {
  enabled: boolean
  rev: number
  getInput: () => DraftInput
  save: (input: DraftInput) => Promise<{ saved: boolean }>
  onStatus: (s: SaveStatus) => void
  delayMs?: number
}): void {
  const { enabled, rev, getInput, save, onStatus, delayMs = 800 } = opts
  const inFlight = useRef(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || rev === 0) return
    if (timer.current) clearTimeout(timer.current)

    const run = async (): Promise<void> => {
      if (inFlight.current) {
        pending.current = true
        return
      }
      inFlight.current = true
      onStatus('saving')
      try {
        await save(getInput())
      } finally {
        inFlight.current = false
        if (pending.current) {
          pending.current = false
          void run()
        } else {
          onStatus('saved')
        }
      }
    }

    timer.current = setTimeout(() => void run(), delayMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rev, enabled, delayMs, getInput, save, onStatus])
}
