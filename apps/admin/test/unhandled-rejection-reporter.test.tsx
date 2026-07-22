import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { NotificationProvider } from '../src/ui/notify'
import {
  UnhandledRejectionReporter,
  UNHANDLED_REJECTION_MESSAGE,
  UNHANDLED_REJECTION_WINDOW_MS
} from '../src/ui/UnhandledRejectionReporter'

/** Dispatch the event the browser fires when a promise rejects with nothing
 *  attached to handle it. jsdom does not synthesise one from a real floating
 *  rejection (the promise is a Node promise, which reports on `process`), so
 *  the event is built by hand — this pins the listener wiring, not the
 *  browser's delivery of it. Real delivery was verified by driving the app. */
function fireUnhandledRejection(reason: unknown) {
  const ev = new Event('unhandledrejection') as Event & { reason?: unknown }
  ev.reason = reason
  window.dispatchEvent(ev)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UnhandledRejectionReporter', () => {
  it('surfaces an otherwise-invisible rejection as an error notification', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <NotificationProvider>
        <UnhandledRejectionReporter />
      </NotificationProvider>
    )
    expect(screen.queryByRole('alert')).toBeNull()

    fireUnhandledRejection(new Error('offline'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(UNHANDLED_REJECTION_MESSAGE)
  })

  it('does not fire for a rejection that its own call site handled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <NotificationProvider>
        <UnhandledRejectionReporter />
      </NotificationProvider>
    )

    // The whole safety-net argument rests on this: `unhandledrejection` is
    // raised by the runtime ONLY when nothing handled the rejection, so a call
    // site that already reports its own failure can never be double-reported.
    await Promise.reject(new Error('handled')).catch(() => {})
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('alert')).toBeNull()

    // …and the reporter really was live throughout: an UNhandled one reports,
    // so the silence above is the runtime's contract, not a dead listener.
    fireUnhandledRejection(new Error('unhandled'))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
  })

  it('coalesces a burst so a failing loop cannot bury the screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <NotificationProvider>
        <UnhandledRejectionReporter />
      </NotificationProvider>
    )

    for (let i = 0; i < 5; i++) fireUnhandledRejection(new Error(`burst ${i}`))

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
    expect(UNHANDLED_REJECTION_WINDOW_MS).toBeGreaterThan(0)
  })

  it('unregisters its listener on unmount', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(
      <NotificationProvider>
        <UnhandledRejectionReporter />
      </NotificationProvider>
    )
    unmount()
    fireUnhandledRejection(new Error('after unmount'))
    await new Promise((r) => setTimeout(r, 20))

    // Asserting on the LOG, not on the toast: after unmount there is no
    // notification region left to render into, so "no alert on screen" would
    // pass even with the listener still attached (it did — that assertion
    // survived a kill-shot that deleted the removeEventListener).
    expect(logged).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
