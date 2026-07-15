// apps/admin/src/hooks/use-dismissed.ts
import { useState } from 'react'

/** Generic "dismiss forever on this machine" persistence (localStorage). Default keys live in
 *  the `setu.dismissed.<key>` namespace (the dashboard widgets' convention); `raw: true` uses
 *  the key verbatim — for callers whose exact storage key is part of an agreed design (e.g.
 *  PasswordNudgeBanner's `setu.password-nudge-dismissed`, #386). */
export function useDismissed(
  key: string,
  { raw = false }: { raw?: boolean } = {}
): {
  dismissed: boolean
  dismiss: () => void
} {
  const storageKey = raw ? key : `setu.dismissed.${key}`
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(storageKey) === '1'
  )
  const dismiss = () => {
    localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }
  return { dismissed, dismiss }
}
