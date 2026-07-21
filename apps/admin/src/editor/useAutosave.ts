import { useEffect, useRef } from 'react'
import type { DraftInput } from '@setu/core'

/** `error` = the last save attempt did NOT persist — it rejected (offline, 5xx, a
 *  throwing DataPort) or was refused (`{ saved: false }`). The buffer stays dirty and
 *  the tab-close warning stays armed; the next edit schedules another attempt (#782). */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Imperative handle for quiescing autosave around a lifecycle operation that
 *  mutates the same storage autosave writes to (slug rename #755, history restore
 *  #754). Without it, a debounce firing mid-operation — OR a save already in
 *  flight — resurrects a just-deleted draft. */
export interface AutosaveHandle {
  /** Suspend autosave: cancels the pending debounce and drops any queued
   *  follow-up, so no NEW save starts until `resume`. A save already in flight is
   *  NOT interrupted — await `settled()` to wait it out. The unmount and
   *  beforeunload flushes also hold off while paused, so a navigation or tab
   *  close mid-operation cannot write under it (#771).
   *
   *  `discard: true` additionally clears the unsaved-work flag: the caller is
   *  about to throw the current buffer away (history restore #754), so the
   *  buffer must not survive as a tab-close warning or a flush write. Renames
   *  keep the buffer (`followRename` persists it explicitly) and pass nothing. */
  pause: (opts?: { discard?: boolean }) => void
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
  // queue fully drains AND the last save actually persisted (#782) — a rejected or
  // refused save leaves it set. Drives the unmount + beforeunload flush.
  const dirty = useRef(false)
  // Resolvers for settled() — drained when the in-flight save's queue goes idle.
  const settleWaiters = useRef<Array<() => void>>([])

  // Stable handle — its methods close over the refs above, so identity never
  // changes across renders (a lifecycle caller can hold it without re-subscribing).
  const handle = useRef<AutosaveHandle>({
    pause: (opts?: { discard?: boolean }) => {
      paused.current = true
      pending.current = false
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      // The caller is discarding the buffer (restore): nothing is pending-unsaved
      // any more, so neither flush nor the tab-close warning should fire for it.
      if (opts?.discard) dirty.current = false
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
      // Did this attempt actually persist? Only a resolved call that did NOT
      // report `{ saved: false }` counts (#782). A rejection and a refusal are
      // the same thing to the author: their work is still only in the buffer.
      let persisted = false
      try {
        const result = await saveRef.current(getInputRef.current())
        persisted = result.saved === true
        if (!persisted) {
          // authoring.save returns { saved: false } when the draft lock is held
          // elsewhere — nothing was written. Silent today would mean silent loss.
          console.error('[autosave] save refused — nothing was written')
        }
      } catch (err) {
        console.error('[autosave] save failed', err)
      } finally {
        inFlight.current = false
        if (pending.current && !paused.current) {
          pending.current = false
          // The follow-up writes the NEWEST buffer, so it — not this attempt —
          // decides the final status. `run` handles its own save failure above,
          // so this catch only guards an unexpected throw (a status callback,
          // say) from becoming an unhandled rejection; it logs, never swallows.
          void run().catch((err: unknown) =>
            console.error('[autosave] unexpected autosave error', err)
          )
        } else {
          // Queue idle (drained, or paused mid-queue). Only report 'saved' on a
          // real drain of a save that PERSISTED — a pause is not a completed
          // save, and neither is a rejection or a refusal (#782). On failure the
          // buffer stays dirty, so the unmount/tab-close flush and the browser's
          // unsaved-work prompt (#770) both stay armed.
          if (!paused.current) {
            if (persisted) {
              dirty.current = false
              onStatusRef.current('saved')
            } else {
              onStatusRef.current('error')
            }
          }
          // Wake anyone awaiting quiescence (settled()).
          const waiters = settleWaiters.current
          settleWaiters.current = []
          for (const w of waiters) w()
        }
      }
    }

    timer.current = setTimeout(
      () =>
        void run().catch((err: unknown) =>
          console.error('[autosave] unexpected autosave error', err)
        ),
      delayMs
    )
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rev, enabled, delayMs])

  // Content safety: if we unmount (navigate away) with a scheduled-but-unfired
  // change, flush one final save so the debounce window can't drop it. Unmount-
  // only ([]) — NOT in the debounce cleanup, which runs on every rev change.
  // Paused (#771): a rename/restore owns the storage, so writing here would
  // re-create a just-deleted draft or land under the old ref after a move.
  useEffect(() => {
    return () => {
      if (dirty.current && !inFlight.current && !paused.current) {
        void saveRef
          .current(getInputRef.current())
          .catch((err: unknown) =>
            console.error('[autosave] unmount flush failed', err)
          )
      }
    }
  }, [])

  // Tab close / refresh with unsaved work: warn, and flush a final save when we
  // can. The warning and the write are separate decisions (#770):
  //  - warn whenever `dirty` — an in-flight save with a queued follow-up is
  //    exactly the case where the newest edit is provably unwritten and dies
  //    with the page, so suppressing the prompt there loses work silently;
  //  - skip only the WRITE when a save is in flight (it would duplicate that
  //    write, mirroring the unmount flush's `!inFlight` guard) or when paused
  //    for a rename/restore that owns the storage (#771).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!dirty.current) return
      if (!inFlight.current && !paused.current) {
        void saveRef
          .current(getInputRef.current())
          .catch((err: unknown) =>
            console.error('[autosave] beforeunload flush failed', err)
          )
      }
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return handle.current
}
