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
  // True once a change is scheduled but not yet persisted. Cleared only when the
  // queue fully drains (a real 'saved'). Drives the unmount + beforeunload flush.
  const dirty = useRef(false)

  useEffect(() => {
    if (!enabled || rev === 0) return
    if (timer.current) clearTimeout(timer.current)
    dirty.current = true

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
          dirty.current = false
          onStatusRef.current('saved')
        }
      }
    }

    timer.current = setTimeout(() => void run(), delayMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rev, enabled, delayMs])

  // Content safety: if we unmount (navigate away) with a scheduled-but-unfired
  // change, flush one final save so the debounce window can't drop it. Unmount-
  // only ([]) — NOT in the debounce cleanup, which runs on every rev change.
  useEffect(() => {
    return () => {
      if (dirty.current && !inFlight.current) {
        void saveRef.current(getInputRef.current())
      }
    }
  }, [])

  // Tab close / refresh with unsaved work: attempt a final save and warn.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!dirty.current) return
      void saveRef.current(getInputRef.current())
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}
