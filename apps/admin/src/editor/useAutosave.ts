import { useEffect, useRef } from 'react'
import type { DraftInput } from '@setu/core'

export type SaveStatus = 'idle' | 'saving' | 'saved'

/** Imperative handle for quiescing autosave around a lifecycle operation that
 *  mutates the same storage autosave writes to (slug rename #755, history restore
 *  #754). Without it, a debounce firing mid-operation — OR a save already in
 *  flight — resurrects a just-deleted draft. */
export interface AutosaveHandle {
  /** Suspend autosave: cancels the pending debounce and drops any queued
   *  follow-up, so no NEW save starts until `resume`. A save already in flight is
   *  NOT interrupted — await `settled()` to wait it out. */
  pause: () => void
  /** Re-enable autosave. The next `rev` change schedules normally. */
  resume: () => void
  /** Resolves once no save is in flight (immediately if none is). Pair with
   *  `pause()` first: pause stops new saves, `settled()` waits out the one that
   *  may already be mid-write — together they make the storage quiescent before a
   *  rename/restore moves or deletes the draft underneath it. */
  settled: () => Promise<void>
}

/** Debounced autosave with a single-in-flight guard. Fires `save(getInput())`
 *  ~`delayMs` after `rev` changes (skipping the initial rev 0). A change during
 *  an in-flight save queues exactly one follow-up. Callbacks are held in refs so
 *  only a real `rev` change schedules a save — re-renders from `onStatus` (or any
 *  other state) never re-trigger autosave. Returns a stable handle to pause/quiesce
 *  the loop around identity/lifecycle operations. */
export function useAutosave(opts: {
  enabled: boolean
  rev: number
  getInput: () => DraftInput
  save: (input: DraftInput) => Promise<{ saved: boolean }>
  onStatus: (s: SaveStatus) => void
  delayMs?: number
}): AutosaveHandle {
  const { enabled, rev, delayMs = 800 } = opts

  const getInputRef = useRef(opts.getInput)
  const saveRef = useRef(opts.save)
  const onStatusRef = useRef(opts.onStatus)
  getInputRef.current = opts.getInput
  saveRef.current = opts.save
  onStatusRef.current = opts.onStatus

  const inFlight = useRef(false)
  const pending = useRef(false)
  // Paused across a rename/restore: run() short-circuits so no save starts, and
  // the in-flight save's finally won't spawn a follow-up.
  const paused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True once a change is scheduled but not yet persisted. Cleared only when the
  // queue fully drains (a real 'saved'). Drives the unmount + beforeunload flush.
  const dirty = useRef(false)
  // Resolvers for settled() — drained when the in-flight save's queue goes idle.
  const settleWaiters = useRef<Array<() => void>>([])

  // Stable handle — its methods close over the refs above, so identity never
  // changes across renders (a lifecycle caller can hold it without re-subscribing).
  const handle = useRef<AutosaveHandle>({
    pause: () => {
      paused.current = true
      pending.current = false
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    },
    resume: () => {
      paused.current = false
    },
    settled: () =>
      new Promise<void>((resolve) => {
        if (!inFlight.current) resolve()
        else settleWaiters.current.push(resolve)
      })
  })

  useEffect(() => {
    if (!enabled || rev === 0) return
    if (timer.current) clearTimeout(timer.current)
    dirty.current = true

    const run = async (): Promise<void> => {
      // Paused for a lifecycle op: neither start a save nor queue one — the op
      // owns the storage until it resumes.
      if (paused.current) return
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
        if (pending.current && !paused.current) {
          pending.current = false
          void run()
        } else {
          // Queue idle (drained, or paused mid-queue). Only report 'saved' on a
          // real drain — a pause is not a completed save.
          if (!paused.current) {
            dirty.current = false
            onStatusRef.current('saved')
          }
          // Wake anyone awaiting quiescence (settled()).
          const waiters = settleWaiters.current
          settleWaiters.current = []
          for (const w of waiters) w()
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

  // Tab close / refresh with unsaved work: attempt a final save and warn. Skip
  // when a save is already in flight (#753 sibling) — the flush would duplicate
  // that write, mirroring the unmount flush's `!inFlight` guard.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!dirty.current || inFlight.current) return
      void saveRef.current(getInputRef.current())
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return handle.current
}
