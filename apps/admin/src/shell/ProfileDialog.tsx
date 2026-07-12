import { useState } from 'react'
import type { FormEvent } from 'react'
import * as z from 'zod'
import { authClient } from '../auth/auth-client'
import { useNotify } from '../ui/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(100, 'Display name must be 100 characters or fewer')

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
}

/** #410: any signed-in user edits their OWN display name, from behind the sidebar-footer
 *  UserMenu rather than a route/screen — the Users screen (`UsersScreen.tsx`) is gated on
 *  `users.view`, which only `maintainer`/`admin` hold (packages/core's `DEFAULT_ROLES`), so
 *  `editor`/`author` can never reach a card placed there. `UserMenu` renders for every signed-in
 *  role (it only checks for a session, not a permission), so this dialog hangs off it instead —
 *  one home, reachable by all four roles, no new route/nav gating to invent.
 *
 *  Uses better-auth's SELF `updateUser` (see `SetuAuthClient.updateUser`'s citation in
 *  auth-client.ts for the verified request/response shape and why the session updates itself
 *  without a manual `refetch()`). */
export function ProfileDialog({
  open,
  onOpenChange,
  currentName
}: ProfileDialogProps) {
  const notify = useNotify()
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)

  // Re-seed the field from the CURRENT session name every time the dialog transitions from
  // closed to open (a fresh open after a previous save, or a re-open after a Cancel/Escape that
  // left local edits in place) — React's documented "adjust state during render" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // not a useEffect, so it runs synchronously with this render rather than one tick later.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(currentName)
      setError(null)
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const parsed = nameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const { error: reqError } = await authClient.updateUser({
        name: parsed.data
      })
      if (reqError) {
        notify.error(reqError.message || 'Could not update name')
        return
      }
      notify.success('Name updated')
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>
            Update the name shown across the admin.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="grid gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="profile-display-name">Display name</Label>
            <Input
              id="profile-display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              maxLength={100}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
