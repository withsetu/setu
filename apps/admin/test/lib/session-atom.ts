import { cleanStores, type WritableAtom } from 'nanostores'

/** better-auth's session store, reached through the client's public `$store` surface
 *  (`$store.atoms.session` — the installed better-auth 1.6.24 builds `$store` from
 *  `getSessionAtom()`'s atom in dist/client/config.mjs). `SetuAuthClient`
 *  (src/auth/auth-client.ts) deliberately narrows the client's type to what the APP calls, and
 *  `$store` is not part of that contract, so this reads it through a structural cast rather than
 *  widening the app's type for a test-only concern. Every hop is optional: when a test file has
 *  `vi.mock`ed the auth client the mock has no `$store`, and the disposer below then does nothing —
 *  which is correct, because nothing real was ever mounted in that file. */
interface ClientWithStore {
  $store?: { atoms?: { session?: WritableAtom<unknown> } }
}

/** Run better-auth's session-atom teardown NOW, while the jsdom environment is still standing (#495).
 *
 *  WHY THIS EXISTS. Mounting `authClient.useSession()` mounts a nanostores atom whose `onMount`
 *  registers a `storage` listener on `window` (better-auth's broadcast channel). nanostores does not
 *  tear a store down the moment its last listener leaves: `lifecycle/index.js` schedules the destroy
 *  list on a `setTimeout` of STORE_UNMOUNT_DELAY, 1000 ms. Under vitest's jsdom environment that is a
 *  NODE timer (verified: `setTimeout` inside the env returns a Node `Timeout`), so the `window.close()`
 *  in environment teardown does not cancel it — and that teardown DELETES `globalThis.window`. If the
 *  timer lands in the gap between teardown and the worker process exiting, the destroy runs
 *  `window.removeEventListener` against a deleted global and throws `ReferenceError: window is not
 *  defined` from a callback no test owns. Vitest reports it as "1 unhandled error" and exits 1 with
 *  every test passing.
 *
 *  `cleanStores` is nanostores' own test-time API for exactly this: it invokes the store's registered
 *  destroy functions synchronously (clean-stores/index.js, via the `clean` symbol that `onMount`
 *  installs) and empties the list, so the still-pending timer finds nothing to run whenever it fires.
 *  Called from an `afterAll` in test/setup.ts — i.e. before the environment goes away.
 *
 *  Enforced by apps/admin/test/session-atom-teardown.test.ts: it mounts the real atom, calls this,
 *  deletes `globalThis.window` and advances the clock past the delay. Without this call that test
 *  throws the exact ReferenceError above. */
export async function disposeAuthSessionAtom(): Promise<void> {
  // This runs in an `afterAll` for EVERY jsdom suite, most of which have nothing to do with
  // auth. A throw here — a mock factory that fails to import, a shape that moves under a
  // dependency bump — would fail those files in a hook they never asked for, turning a
  // teardown convenience into exactly the kind of unexplained red this change exists to
  // remove. So it reports and stands down instead. Not a silent swallow (§3.2): the message
  // names the consequence, and the happy path has its own gate in
  // apps/admin/test/session-atom-teardown.test.ts, which fails loudly if disposal stops
  // working.
  try {
    const { authClient } = await import('../../src/auth/auth-client')
    const session = (authClient as unknown as ClientWithStore | undefined)
      ?.$store?.atoms?.session
    if (session) cleanStores(session)
  } catch (err) {
    console.error(
      '[test-setup] could not dispose the better-auth session atom; a stray teardown timer may reappear as an unhandled "window is not defined" (#495)',
      err
    )
  }
}
