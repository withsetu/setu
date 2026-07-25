import { afterEach, expect, test, vi } from 'vitest'
import type { WritableAtom } from 'nanostores'
import { authClient } from '../src/auth/auth-client'
import { disposeAuthSessionAtom } from './lib/session-atom'

// Regression test for #495: a fully-passing admin suite exited 1 with "1 unhandled error",
//   ReferenceError: window is not defined
//     ❯ Object.cleanupBroadcastSetup better-auth/dist/client/broadcast-channel.mjs
//     ❯ Object.cleanup            better-auth/dist/client/session-refresh.mjs
//     ❯ Timeout._onTimeout        nanostores/lifecycle/index.js
// because nanostores defers a mounted store's destroy by 1000 ms and vitest deletes
// `globalThis.window` when it tears the jsdom environment down. This test recreates that gap
// deterministically instead of waiting for CI to lose the race: mount the real session atom, drop
// the listener (which is what schedules the destroy), run the disposer that test/setup.ts registers
// in `afterAll`, then delete `window` and advance the clock past the delay.
//
// Kill-shot: delete the `await disposeAuthSessionAtom()` line and this test fails with that exact
// ReferenceError.

const session = (
  authClient as unknown as {
    $store: { atoms: { session: WritableAtom<unknown> } }
  }
).$store.atoms.session

afterEach(() => {
  vi.useRealTimers()
})

test('the mounted session atom leaves no window-touching timer behind at environment teardown', async () => {
  vi.useFakeTimers()

  // Mounting is what installs better-auth's `storage` listener on `window` — the thing whose
  // removal later blows up. `listen()` is nanostores' subscribe-without-immediate-call; dropping it
  // takes the listener count to zero, which is what arms the deferred destroy.
  const unbind = session.listen(() => {})
  unbind()

  await disposeAuthSessionAtom()

  // Exactly what vitest's jsdom environment teardown does to the global before the worker exits.
  const globals = globalThis as unknown as { window?: unknown }
  const realWindow = globals.window
  delete globals.window
  try {
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow()
  } finally {
    globals.window = realWindow
  }
})
