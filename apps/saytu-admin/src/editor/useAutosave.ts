import { useEffect, useRef } from 'react'
import type { DraftInput } from '@saytu/core'

export type SaveStatus = 'idle' | 'saving' | 'saved'

/** Debounced autosave with a single-in-flight guard. Fires `save(getInput())`
 *  ~`delayMs` after `rev` changes (skipping the initial rev 0). A change during
 *  an in-flight save queues exactly one follow-up. Callbacks are held in refs so
 *  only a real `rev` change schedules a save — re-renders from `onStatus` (or any
 *  other state) never re-trigger autosave. */
export function useAutosave(opts: {
  enabled: boolean
  rev: number
  getInput: () => DraftInput
  save: (input: DraftInput) => Promise<{ saved: boolean }>
  onStatus: (s: SaveStatus) => void
  delayMs?: number
}): void {
  const { enabled, rev, delayMs = 800 } = opts

  const getInputRef = useRef(opts.getInput)
  const saveRef = useRef(opts.save)
  const onStatusRef = useRef(opts.onStatus)
  getInputRef.current = opts.getInput
  saveRef.current = opts.save
  onStatusRef.current = opts.onStatus

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
      onStatusRef.current('saving')
      try {
        await saveRef.current(getInputRef.current())
      } finally {
        inFlight.current = false
        if (pending.current) {
          pending.current = false
          void run()
        } else {
          onStatusRef.current('saved')
        }
      }
    }

    timer.current = setTimeout(() => void run(), delayMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rev, enabled, delayMs])
}
