import { useEffect, useSyncExternalStore } from 'react'
import { authClient } from './auth-client'

/** #386: does the CURRENT session's user have a password (a `credential` account row)?
 *
 *  Single source of truth for "passwordless" detection — the logout guard (UserMenu), the
 *  password-nudge banner, and the owner-password card (UsersScreen) all consume this instead of
 *  each re-deriving it. Derivation is `authClient.listAccounts()` → any `providerId ===
 *  'credential'` row; see OwnerPasswordCard's comment (UsersScreen.tsx) for why listAccounts
 *  (zero new server surface, already answers exactly this question for the current user) was
 *  chosen over a new session field.
 *
 *  The answer lives in ONE module-scoped store shared by every hook instance
 *  (useSyncExternalStore), not per-instance useState — deliberately, twice over:
 *    - Correctness: OwnerPasswordCard's `refresh()` after setting a password must flip the
 *      always-mounted PasswordNudgeBanner and UserMenu's logout guard IMMEDIATELY, not after a
 *      full reload (PR #493 review finding: per-instance state left the banner crying "you'll be
 *      locked out" at a user who had just set a password).
 *    - Efficiency: a known `true`/`false` is served from cache (no listAccounts round-trip per
 *      menu open), and concurrent first-askers share one in-flight request.
 *
 *  `hasPassword` semantics — three-valued on purpose:
 *    - `true` / `false`: the server answered.
 *    - `null`: loading OR the lookup failed. Errors map to null, NEVER to false — a transient
 *      fetch error must not scare a passwordful user with a lockout dialog/banner (fail-safe:
 *      consumers treat null as "don't intervene"). An unknown answer is never cached: the next
 *      enabled consumer (or menu open) asks again.
 *
 *  `enabled` keeps the fetch lazy: UserMenu only asks when its dropdown actually opens, and the
 *  nudge banner only when its cheap gates (local mode, admin role, not dismissed) already hold.
 *
 *  `refresh` resolves with the fresh value (not void) so the logout guard can AWAIT its single
 *  retry and branch on the outcome in one place, instead of racing a state update. It refetches
 *  (never serves the cache) and notifies ALL mounted consumers. */

const store: {
  value: boolean | null
  inflight: Promise<boolean | null> | null
  listeners: Set<() => void>
} = {
  value: null,
  inflight: null,
  listeners: new Set()
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

function getSnapshot(): boolean | null {
  return store.value
}

function startFetch(): Promise<boolean | null> {
  const promise = (async (): Promise<boolean | null> => {
    try {
      const { data, error } = await authClient.listAccounts()
      if (error) return null
      return !!data?.some((a) => a.providerId === 'credential')
    } catch {
      // Thrown (network-level) failure — same fail-safe as an API error: unknown, not false.
      return null
    }
  })().then((value) => {
    store.value = value
    store.inflight = null
    for (const listener of store.listeners) listener()
    return value
  })
  store.inflight = promise
  return promise
}

/** Serve the cached answer if the server ever gave one; otherwise (unknown) ask — joining any
 *  request already in flight rather than issuing a duplicate. */
function ensureFetched(): Promise<boolean | null> {
  if (store.inflight) return store.inflight
  if (store.value !== null) return Promise.resolve(store.value)
  return startFetch()
}

/** Refetch and notify every mounted consumer. A refresh that lands while another request is in
 *  flight joins it (one round-trip answers both askers). */
function refresh(): Promise<boolean | null> {
  return store.inflight ?? startFetch()
}

/** Vitest-only escape hatch: module state outlives each test's render, so suites that mock
 *  listAccounts with different answers must reset between tests. Deliberately does NOT notify
 *  listeners: it runs in afterEach, where mocks may already be restored but testing-library's
 *  auto-cleanup has not unmounted yet — re-rendering that half-torn-down tree crashes. The next
 *  test's mount reads the cleared snapshot fresh. Never called by product code. */
export function resetHasPasswordStoreForTests(): void {
  store.value = null
  store.inflight = null
}

export function useHasPassword(enabled = true): {
  hasPassword: boolean | null
  refresh: () => Promise<boolean | null>
} {
  const hasPassword = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (enabled) void ensureFetched()
  }, [enabled])

  return { hasPassword, refresh }
}
