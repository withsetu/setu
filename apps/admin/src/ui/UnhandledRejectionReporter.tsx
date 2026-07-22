import { useEffect, useRef } from 'react'
import { useNotify } from './notify'

/** Deliberately says nothing about WHAT failed or whether anything persisted: this
 *  net catches rejections nobody claimed, so it cannot know. Naming a specific
 *  action here would be the same lie #798/#804 fixed, in the other direction. */
export const UNHANDLED_REJECTION_MESSAGE =
  'Something went wrong and that action may not have completed. Check your connection, then try again — if it keeps happening, reload the page.'

/** One toast per window: a retrying poll or a loop of failing promises must not
 *  bury the screen under identical alerts.
 *  Enforced by apps/admin/test/unhandled-rejection-reporter.test.tsx
 *  ("coalesces a burst so a failing loop cannot bury the screen"). */
export const UNHANDLED_REJECTION_WINDOW_MS = 5000

/** Last-resort reporter for promise rejections no call site handled (#833).
 *
 *  The admin has ~130 sites that start async work without awaiting it —
 *  `void someAsync()`, `.then()` chains, async event handlers, async effect
 *  IIFEs. React does not route any of those to an error boundary, and the SPA
 *  had no `unhandledrejection` listener at all, so a call site that forgot its
 *  `catch` produced literally nothing: no toast, no boundary, not even a state
 *  change. That default is what produced #782, #798, #804 and #833 one at a
 *  time; this makes the DEFAULT visible instead of requiring vigilance at every
 *  call site.
 *
 *  It cannot double-report a failure a call site already handled: the runtime
 *  raises `unhandledrejection` only for rejections with no handler attached.
 *  Enforced by apps/admin/test/unhandled-rejection-reporter.test.tsx ("does not
 *  fire for a rejection that its own call site handled").
 *
 *  This is a net, not a substitute for handling: a generic toast cannot restore
 *  a stuck loading state or tell the author what to retry. Call sites still owe
 *  their users a specific message (see MediaGrid.tsx for the shape). */
export function UnhandledRejectionReporter() {
  const notify = useNotify()
  const lastReportedAt = useRef(0)

  useEffect(() => {
    const onRejection = (event: Event) => {
      // Intentionally no preventDefault(): the browser's own "Uncaught (in
      // promise)" console entry carries the stack this toast omits, and a
      // developer needs it to find the unhandled call site.
      const now = Date.now()
      if (now - lastReportedAt.current < UNHANDLED_REJECTION_WINDOW_MS) return
      lastReportedAt.current = now
      console.error(
        '[setu] unhandled promise rejection',
        (event as Event & { reason?: unknown }).reason
      )
      notify.error(UNHANDLED_REJECTION_MESSAGE)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [notify])

  return null
}
