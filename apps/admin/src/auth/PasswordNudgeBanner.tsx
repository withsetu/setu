import { useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActor } from './actor'
import { useHasPassword } from './use-has-password'
import { useCapabilities } from '../lib/useCapabilities'

/** Deliberately NOT dashboard/use-dismissed.ts's `setu.dismissed.*` namespace: #386's agreed
 *  design names this exact key, and it reads as a standalone flag ("this machine was warned")
 *  rather than a dismissed dashboard widget. Machine-scoped on purpose — localStorage means the
 *  nudge reappears in another browser/machine, where the lockout risk is fresh again. */
const STORAGE_KEY = 'setu.password-nudge-dismissed'

/** #386: quiet shell-top nudge for the one actor who can actually fix the lockout hazard — the
 *  LOCAL-mode admin who has not set a password yet (local instances start with a passwordless
 *  owner; remote access stays off until a password exists — see UsersScreen's OwnerPasswordCard).
 *  Shows on every screen until dismissed or a password is set. Non-admins don't see it (they
 *  can't reach the Users screen to act on it — their guard is UserMenu's sign-out dialog), and
 *  unknown password state shows nothing: a transient fetch error must not cry lockout. */
export function PasswordNudgeBanner() {
  const { mode } = useCapabilities()
  const actor = useActor()
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  )
  // Cheap gates first so the accounts lookup only ever fires when the banner could matter.
  const eligible = mode === 'local' && actor.role === 'admin' && !dismissed
  const { hasPassword } = useHasPassword(eligible)

  if (!eligible || hasPassword !== false) return null

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b bg-muted/50 py-2 pr-2 pl-4 text-sm text-muted-foreground"
    >
      <p className="min-w-0 flex-1">
        You haven't set a password — remote access is off and signing out will
        lock you out of this browser.{' '}
        <Link
          to="/users"
          className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
        >
          Set a password
        </Link>
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss password reminder"
        onClick={dismiss}
      >
        <X />
      </Button>
    </div>
  )
}
