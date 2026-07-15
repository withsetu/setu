import { useCallback, useEffect, useState } from 'react'
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
 *  `hasPassword` semantics — three-valued on purpose:
 *    - `true` / `false`: the server answered.
 *    - `null`: loading OR the lookup failed. Errors map to null, NEVER to false — a transient
 *      fetch error must not scare a passwordful user with a lockout dialog/banner (fail-safe:
 *      consumers treat null as "don't intervene").
 *
 *  `enabled` keeps the fetch lazy: UserMenu only asks when its dropdown actually opens, and the
 *  nudge banner only when its cheap gates (local mode, admin role, not dismissed) already hold.
 *
 *  `refresh` resolves with the fresh value (not void) so the logout guard can AWAIT its single
 *  retry and branch on the outcome in one place, instead of racing a state update. */
export function useHasPassword(enabled = true): {
  hasPassword: boolean | null
  refresh: () => Promise<boolean | null>
} {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)

  const refresh = useCallback(async (): Promise<boolean | null> => {
    try {
      const { data, error } = await authClient.listAccounts()
      if (error) {
        setHasPassword(null)
        return null
      }
      const has = !!data?.some((a) => a.providerId === 'credential')
      setHasPassword(has)
      return has
    } catch {
      // Thrown (network-level) failure — same fail-safe as an API error: unknown, not false.
      setHasPassword(null)
      return null
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  return { hasPassword, refresh }
}
