import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as z from 'zod'
import type { Role } from '@setu/core'
import { outranks } from '@setu/core'
import { useActor, useCan } from '../../auth/actor'
import { authClient } from '../../auth/auth-client'
import { useHasPassword } from '../../auth/use-has-password'
import type { AdminUser } from '../../auth/auth-client'
import { useNotify } from '../../ui/notify'
import { apiFetch } from '../../lib/api-fetch'
import { useCapabilities } from '../../lib/useCapabilities'
import { passwordField } from '../../lib/password-policy'
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '@/components/ui/table'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { MoreHorizontal } from 'lucide-react'

/** Setu's fixed role set + the one-line descriptions from the authz matrix (packages/core's
 *  DEFAULT_ROLES) — shown in the invite dialog and the role-change picker so admins/maintainers
 *  pick a role by what it can DO, not by memorizing a name. Which of these are actually OFFERED to
 *  a given actor is rank-scoped (#364) — see `roleOptionsForActor` below, never a hand-listed
 *  per-role subset. */
const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full control — settings, users, and roles',
  maintainer: 'Runs the site day-to-day: content, forms, deploy, theme',
  editor: 'Full content lifecycle; no forms, ops, or config',
  author: 'Creates and manages their own content'
}

/** Every staff role, top-to-bottom of the rank ladder (packages/core's `ROLE_RANK`). The source
 *  list `roleOptionsForActor` is derived from, below — never hand-list a per-role subset. */
const ALL_ROLES: Role[] = ['admin', 'maintainer', 'editor', 'author']

/** Roles an actor may invite/hand out or offer in a role-change picker (#364): every role strictly
 *  below the ACTOR's own rank — an admin (rank 4) is offered maintainer/editor/author (the
 *  pre-#364 fixed list); a maintainer (rank 3) is offered editor/author only. 'admin' never
 *  appears in either actor's list, since no role outranks it. Derived from `outranks` (the same
 *  primitive packages/auth/src/rank-guard.ts enforces server-side) rather than hard-coded per-role
 *  arrays, so the UI can never drift from the rank ladder it mirrors. */
function roleOptionsForActor(actorRole: Role): Role[] {
  return ALL_ROLES.filter((r) => outranks(actorRole, r))
}

/** Whether `actorRole` may manage (change the role of / disable / offer a reset for) a row whose
 *  current role is `targetRole`. Mirrors packages/auth/src/rank-guard.ts's `rankGuardUpdateHook`
 *  EXACTLY, including its ORDER of checks:
 *  1. `if (actorRole === 'admin') return` — the admin exemption fires BEFORE the unknown-target
 *     check, so an admin may act even on a row with an unrecognized/legacy role string (that's the
 *     only way to repair one).
 *  2. For every other actor, the guard fails CLOSED on an unknown target — `targetRank <= 0 ->
 *     forbidden('cannot act on a user with an unrecognized role')`. `outranks` alone would treat an
 *     unknown role as rank 0 ("always outranked") — exactly the mismatch rank.ts's own
 *     division-of-responsibility note warns callers about — hence the explicit `isKnownRole` gate
 *     here (#364 review fix: without it a maintainer saw enabled controls the server 403s).
 *  3. Then the strict `outranks` comparison.
 *  This is UX honesty, not the security boundary — the server re-enforces via the same rank guard
 *  regardless of what this function returns. */
function canManageTarget(actorRole: Role, targetRole: string): boolean {
  if (actorRole === 'admin') return true
  return isKnownRole(targetRole) && outranks(actorRole, targetRole)
}

const apiBase = import.meta.env.VITE_SETU_API ?? ''

/** `users.view`-gated map of userId -> true for every user WITH a credential (password) account (#248
 *  Task 8 review, Finding 2) — better-auth's admin `listUsers` returns user rows, not their linked
 *  accounts, so this is a small dedicated endpoint (apps/api/src/users.ts) rather than something
 *  the admin plugin already exposes. Absence of a key means passwordless (can't sign in remotely)
 *  — the same contract OwnerPasswordCard already uses for the CURRENT user via
 *  `authClient.listAccounts()`; this is the multi-user generalization of that same question.
 *  Returns `{}` (i.e. "no one has a password", the conservative/fail-safe reading — see below) on
 *  any error rather than throwing, so a transient failure degrades the row status to "unknown
 *  password state" without breaking the rest of the user list. */
async function fetchCredentialStatus(): Promise<Record<string, boolean>> {
  try {
    const res = await apiFetch(`${apiBase}/api/users/credential-status`)
    if (!res.ok) return {}
    return (await res.json()) as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Built per-actor (`roleOptions` = `roleOptionsForActor(actor.role)`) rather than a fixed schema —
 *  the offered/valid roles depend on who's inviting (#364). `roleOptions` is always non-empty for
 *  any actor that can reach InviteUserDialog at all (gated on `users.invite`, which only
 *  admin/maintainer hold, and both have at least editor+author below them). */
function makeInviteSchema(roleOptions: Role[]) {
  return z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email'),
    password: passwordField,
    role: z.enum(roleOptions as [Role, ...Role[]], {
      message: 'Choose a role'
    })
  })
}
type InviteValues = {
  name: string
  email: string
  password: string
  role: Role
}
type InviteErrors = Partial<Record<keyof InviteValues, string>>

const passwordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: passwordField,
    confirm: z.string()
  })
  .refine((data) => data.newPassword === data.confirm, {
    message: "Passwords don't match",
    path: ['confirm']
  })
type PasswordErrors = {
  currentPassword?: string
  newPassword?: string
  confirm?: string
}

function initialOf(name: string, email: string): string {
  return (name || email || '?').charAt(0).toUpperCase()
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/** True if `role` is one of Setu's four staff roles — better-auth's `role` field is a loose string. */
function isKnownRole(role: string | null | undefined): role is Role {
  return (
    !!role &&
    (['admin', 'maintainer', 'editor', 'author'] as const).includes(
      role as Role
    )
  )
}

/** better-auth's admin plugin enforces some guard rails server-side (self-ban is rejected with
 *  `YOU_CANNOT_BAN_YOURSELF` — verified in node_modules/better-auth/dist/plugins/admin/routes.mjs)
 *  but NOT self-role-change or "last admin" protection for either role changes or bans — those
 *  endpoints only check the caller's own permission, not the effect on the target. This screen
 *  enforces both client-side, computed from the same list already loaded for the table. */
function isLastAdmin(users: AdminUser[], userId: string): boolean {
  const admins = users.filter((u) => u.role === 'admin')
  return admins.length === 1 && admins[0]?.id === userId
}

interface RowGuard {
  disabled: boolean
  reason?: string
}

function roleChangeGuard(
  user: AdminUser,
  selfId: string,
  users: AdminUser[]
): RowGuard {
  if (user.id === selfId)
    return { disabled: true, reason: 'You cannot change your own role' }
  if (isLastAdmin(users, user.id))
    return { disabled: true, reason: 'Cannot demote the last admin' }
  return { disabled: false }
}

function disableGuard(
  user: AdminUser,
  selfId: string,
  users: AdminUser[]
): RowGuard {
  if (user.id === selfId)
    return { disabled: true, reason: 'You cannot disable yourself' }
  if (isLastAdmin(users, user.id))
    return { disabled: true, reason: 'Cannot disable the last admin' }
  return { disabled: false }
}

function GuardedTrigger({
  guard,
  children
}: {
  guard: RowGuard
  children: React.ReactNode
}) {
  if (!guard.disabled) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span wrapper: Radix Tooltip needs a focusable/hoverable child even when the inner
         *  control is disabled (disabled elements don't fire pointer events in most browsers). */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{guard.reason}</TooltipContent>
    </Tooltip>
  )
}

function StatusBadge({ user }: { user: AdminUser }) {
  if (user.banned) return <Badge variant="destructive">Disabled</Badge>
  return <Badge variant="success">Active</Badge>
}

/** The third row status (#248 Task 8 review, Finding 2): a user with no credential (password)
 *  account can't sign in remotely at all — distinct from Active/Disabled, which are about whether
 *  a user WHO CAN sign in currently may.
 *
 *  Contract (matches apps/api/src/users.ts's endpoint exactly): the credential-status map contains
 *  `true` ONLY for users WITH a credential account — absence of a key (not an explicit `false`) is
 *  how "passwordless" is represented. So `hasCredential` here is `true` (has a password) or
 *  `undefined` (either passwordless, OR the status genuinely hasn't loaded yet/the endpoint
 *  errored — both cases degrade to the same "don't claim they have a password" reading, which is
 *  the conservative, security-relevant direction to be wrong in). Renders the badge whenever
 *  `hasCredential` is not `true`. */
function NoPasswordBadge({
  hasCredential
}: {
  hasCredential: boolean | undefined
}) {
  if (hasCredential === true) return null
  return <Badge variant="secondary">No password</Badge>
}

/** The invite/add-user Dialog. Uses the admin plugin's `createUser` — the created user gets a real
 *  credential account with the temporary password (unlike the passwordless local owner — see
 *  ensure-local-owner.ts — this path always supplies a password, so the invited user can sign in
 *  remotely immediately). */
function InviteUserDialog({ onCreated }: { onCreated: () => void }) {
  const actor = useActor()
  const notify = useNotify()
  const roleOptions = roleOptionsForActor(actor.role)
  const inviteSchema = makeInviteSchema(roleOptions)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [errors, setErrors] = useState<InviteErrors>({})
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName('')
    setEmail('')
    setPassword('')
    setRole('')
    setErrors({})
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const parsed = inviteSchema.safeParse({ name, email, password, role })
    if (!parsed.success) {
      const next: InviteErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof InviteValues | undefined
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const { error } = await authClient.admin.createUser({ ...parsed.data })
      if (error) {
        notify.error(error.message || 'Could not create user')
        return
      }
      notify.success(`Invited ${parsed.data.name}`)
      reset()
      setOpen(false)
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>Add user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Creates an account with a temporary password. Share it with them
            securely.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="grid gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="invite-name">Name</Label>
            <Input
              id="invite-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-password">Temporary password</Label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger
                id="invite-role"
                className="w-full"
                aria-invalid={!!errors.role}
              >
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="flex flex-col">
                      <span className="capitalize">{r}</span>
                      <span className="text-xs text-muted-foreground">
                        {ROLE_DESCRIPTIONS[r]}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-sm text-destructive">{errors.role}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The disabled-tooltip copy shown on "Send password reset email" when the workspace's email
 *  transport can't actually deliver (apps/api/src/capabilities.ts's `email.deliverable` — false for
 *  the dev/no-op console transport). Exact copy agreed for #364. */
const EMAIL_NOT_DELIVERABLE_REASON =
  'Password reset emails need an email provider — this workspace logs emails to the console.'

/** One row's role-change control + disable/enable/reset-password menu. Kept together since all
 *  three need the same guard computation (self / last-admin / rank) against the full `users` list. */
function UserRowActions({
  user,
  selfId,
  actorRole,
  users,
  emailDeliverable,
  hasCredential,
  onChanged
}: {
  user: AdminUser
  selfId: string
  actorRole: Role
  users: AdminUser[]
  emailDeliverable: boolean
  hasCredential: boolean
  onChanged: () => void
}) {
  const notify = useNotify()
  const [changingRole, setChangingRole] = useState(false)
  const [banning, setBanning] = useState(false)
  const [resetting, setResetting] = useState(false)
  const roleGuard = roleChangeGuard(user, selfId, users)
  const disableGuardResult = disableGuard(user, selfId, users)
  // #364: the roles this actor may hand THIS row — capped below the actor's own rank, same list
  // the invite dialog offers. When the row's CURRENT role sits at/above that (only reachable for an
  // admin viewing an admin peer — rank-scoping hides the row entirely for anyone else, see
  // canManageTarget), it's prepended frozen/disabled so the picker still shows the true current
  // value rather than silently coercing it into the below-rank list.
  const roleOptions = roleOptionsForActor(actorRole)
  const selectRoleOptions =
    isKnownRole(user.role) && !roleOptions.includes(user.role)
      ? ([user.role, ...roleOptions] as Role[])
      : roleOptions
  // Only offered strictly below the actor's rank — even for an admin viewing an admin peer
  // (unlike role-change/disable, which admins are exempt from rank-scoping for): asking to reset a
  // peer's password without them present is a more invasive action than the ones better-auth's own
  // admin plugin exempts admins from, so this one stays rank-strict for every actor, admin included.
  // #364 review fix: also requires a KNOWN target role — `outranks` alone treats an unrecognized
  // role as rank 0 ("always outranked", see rank.ts's division-of-responsibility note), which would
  // offer the reset on a legacy/garbage-role row. Fail closed instead, for every actor: repair the
  // row's role first (the admin-only path canManageTarget leaves open), then reset.
  const resetOffered =
    isKnownRole(user.role) && outranks(actorRole, user.role) && hasCredential
  const resetGuard: RowGuard = emailDeliverable
    ? { disabled: false }
    : { disabled: true, reason: EMAIL_NOT_DELIVERABLE_REASON }

  async function changeRole(next: Role) {
    if (changingRole || next === user.role) return
    setChangingRole(true)
    // NOT optimistic: the Select's displayed value doesn't change until the request resolves.
    // `changingRole` only disables the control while in flight; on success `onChanged()` re-fetches
    // the whole list from the server (the source of truth) — including this row's role — and on
    // error the Select simply re-renders with `user.role` unchanged (nothing to roll back, since
    // nothing was ever changed client-side ahead of the response).
    try {
      const { error } = await authClient.admin.setRole({
        userId: user.id,
        role: next
      })
      if (error) {
        notify.error(error.message || 'Could not change role')
        return
      }
      notify.success(`${user.name || user.email} is now ${next}`)
      onChanged()
    } finally {
      setChangingRole(false)
    }
  }

  async function toggleBan() {
    if (banning) return
    setBanning(true)
    try {
      const action = user.banned
        ? authClient.admin.unbanUser({ userId: user.id })
        : authClient.admin.banUser({ userId: user.id })
      const { error } = await action
      if (error) {
        notify.error(error.message || 'Could not update user status')
        return
      }
      notify.success(
        user.banned
          ? `${user.name || user.email} re-enabled`
          : `${user.name || user.email} disabled`
      )
      onChanged()
    } finally {
      setBanning(false)
    }
  }

  /** Triggers better-auth's public `/request-password-reset` (Task 3's `withDefaultResetCallback`
   *  only fills in a MISSING `redirectTo` — passing it explicitly here, rather than relying on that
   *  default, keeps the emailed link's destination visible at the call site and origin-checked
   *  against whatever admin origin actually sent the request). No confirm step: unlike disable,
   *  sending an email is non-destructive and reversible (the user just ignores it). */
  async function sendReset() {
    if (resetting) return
    setResetting(true)
    try {
      const { error } = await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: `${window.location.origin}/reset-password`
      })
      if (error) {
        notify.error(error.message || 'Could not send the reset email')
        return
      }
      notify.success(`Password reset email sent to ${user.email}`)
    } finally {
      setResetting(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-2">
        <GuardedTrigger guard={roleGuard}>
          <Select
            value={isKnownRole(user.role) ? user.role : undefined}
            onValueChange={(v) => void changeRole(v as Role)}
            disabled={
              roleGuard.disabled ||
              changingRole ||
              // A KNOWN role outside the actor's below-rank options (an admin peer's row) is
              // frozen. An UNKNOWN/legacy role is NOT frozen: this control is only reachable on
              // such a row by an admin (canManageTarget hides it for everyone else), and the
              // server's rank guard exempts admin before its unknown-target check
              // (rank-guard.ts) — assigning a real role here is exactly the repair path.
              (isKnownRole(user.role) && !roleOptions.includes(user.role))
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={`Change role for ${user.name || user.email}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectRoleOptions.map((r) => (
                <SelectItem
                  key={r}
                  value={r}
                  disabled={!roleOptions.includes(r)}
                >
                  <span className="capitalize">{r}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </GuardedTrigger>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More actions for ${user.name || user.email}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {resetOffered && (
              <GuardedTrigger guard={resetGuard}>
                <DropdownMenuItem
                  disabled={resetGuard.disabled || resetting}
                  onSelect={() => void sendReset()}
                >
                  {resetting ? 'Sending…' : 'Send password reset email'}
                </DropdownMenuItem>
              </GuardedTrigger>
            )}
            <AlertDialog>
              <GuardedTrigger guard={disableGuardResult}>
                <AlertDialogTrigger
                  asChild
                  disabled={disableGuardResult.disabled}
                >
                  <DropdownMenuItem
                    variant={user.banned ? 'default' : 'destructive'}
                    disabled={disableGuardResult.disabled}
                    onSelect={(e) => {
                      // Always prevent the default close: for "enable" there's no confirm step, so
                      // toggle immediately; for "disable" the AlertDialogTrigger (wrapping this
                      // item) needs the dropdown to stay mounted long enough to hand off to the
                      // alert-dialog it opens — closing first would unmount it before it can show.
                      e.preventDefault()
                      if (user.banned) void toggleBan()
                    }}
                  >
                    {user.banned ? 'Enable user' : 'Disable user'}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </GuardedTrigger>
              {!user.banned && (
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Disable {user.name || user.email}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Their active sessions end immediately and they can no
                      longer sign in until re-enabled.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={banning}
                      onClick={() => void toggleBan()}
                    >
                      {banning ? 'Disabling…' : 'Disable'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              )}
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  )
}

/** `refreshSignal`: bumped by `UsersScreen` whenever `OwnerPasswordCard` changes the CURRENT
 *  user's own credential state — without this, a user's own row would keep showing a stale "No
 *  password" badge after they set a password via that card, since the two are otherwise
 *  independent components with no shared data. Any value change (not the value itself) re-triggers
 *  `load()`, mirroring the same "re-fetch from source of truth" pattern `onChanged` already uses
 *  for role/ban actions. */
function UserList({ refreshSignal }: { refreshSignal: number }) {
  const actor = useActor()
  const can = useCan()
  const { email: emailCaps } = useCapabilities()
  const notify = useNotify()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [credentialStatus, setCredentialStatus] = useState<
    Record<string, boolean>
  >({})

  // #364: full user management (invite / change role / disable) is rank-scoped, not admin-only.
  // `canInvite` gates the "Add user" button; per-row manageability (below) additionally requires
  // the actor to outrank the row (admins exempt — see `canManageTarget`). Both `users.setRole` and
  // `users.disable` are granted together on every role that holds either (maintainer/admin — see
  // packages/core/src/authz/default-roles.ts), so checking either is equivalent to checking "can
  // this actor manage users at all"; checking both defends against that ever changing silently.
  const canInvite = can('users.invite')
  const canManageAny = can('users.setRole') || can('users.disable')

  async function load() {
    setLoading(true)
    try {
      // The roster comes from Setu's own `users.view`-gated route (apps/api/src/users.ts), NOT
      // better-auth's admin `listUsers` — the plugin authorizes list against its own admin-only role
      // map, which denied a maintainer who holds `users.view` (UAT 2026-07-05). credential-status is
      // fetched alongside (an independent read whose own failure mode is handled in
      // fetchCredentialStatus), so it never blocks or fails the user list.
      const [listRes, status] = await Promise.all([
        apiFetch(`${apiBase}/api/users`),
        fetchCredentialStatus()
      ])
      setCredentialStatus(status)
      if (!listRes.ok) {
        notify.error(
          listRes.status === 403
            ? 'You are not allowed to view users'
            : 'Could not load users'
        )
        setUsers([])
        return
      }
      // Dates arrive as ISO strings over JSON (formatDate handles both string and Date).
      const data = (await listRes.json()) as { users: AdminUser[] }
      setUsers(data.users ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Users</CardTitle>
          <CardDescription>
            Who can sign in and what they can do.
          </CardDescription>
        </div>
        {canInvite && <InviteUserDialog onCreated={() => void load()} />}
      </CardHeader>
      <CardContent>
        {loading || users === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        {user.image && <AvatarImage src={user.image} alt="" />}
                        <AvatarFallback>
                          {initialOf(user.name, user.email)}
                        </AvatarFallback>
                      </Avatar>
                      {/* #554: names are free text — cap + truncate so a long one can't
                          stretch the table; full name on hover. */}
                      <span
                        title={user.name || undefined}
                        className="max-w-72 truncate font-medium"
                      >
                        {user.name || '—'}
                      </span>
                      {user.id === actor.id && (
                        <span className="text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* #554: same cap-and-truncate treatment as the name. */}
                    <span
                      title={user.email}
                      className="block max-w-80 truncate"
                    >
                      {user.email}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge user={user} />
                      <NoPasswordBadge
                        hasCredential={credentialStatus[user.id]}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManageAny &&
                    canManageTarget(actor.role, user.role ?? '') ? (
                      <UserRowActions
                        user={user}
                        selfId={actor.id}
                        actorRole={actor.role}
                        users={users}
                        emailDeliverable={!!emailCaps?.deliverable}
                        hasCredential={credentialStatus[user.id] === true}
                        onChanged={() => void load()}
                      />
                    ) : (
                      <span className="text-sm capitalize text-muted-foreground">
                        {user.role}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/** The "remote access" owner-password card. better-auth cannot distinguish "passwordless owner" at
 *  login (see LoginScreen's mapSignInError comment) — this settings screen is where that honest
 *  state lives instead: the local owner starts with NO credential account (ensure-local-owner.ts),
 *  so remote/tunnel sign-in is impossible until a password is set here.
 *
 *  "Has a password" is derived from `authClient.listAccounts()` — the base client's `/list-accounts`
 *  route, already part of every better-auth client (not admin-plugin-specific) — checking for a
 *  `credential` provider entry. This was chosen over adding a new field to the session/actor payload
 *  because it is zero new server surface: the route already exists and answers exactly this
 *  question for the CURRENT session's user, which is all this card needs (it never asks about
 *  other users' password state). Since #386 the derivation itself lives in the shared
 *  `useHasPassword` hook (auth/use-has-password.ts) — the logout guard and the password-nudge
 *  banner ask the identical question. Setting the password itself uses the sanctioned better-auth
 *  admin path `authClient.admin.setUserPassword({ userId: self, newPassword })` — verified in
 *  node_modules/better-auth/dist/api/routes/update-user.mjs that the base client's `setPassword`
 *  endpoint is `createAuthEndpoint.serverOnly`, i.e. NOT reachable over HTTP from this browser
 *  client at all; the admin endpoint is the only client-reachable route that can set a password
 *  with no existing credential account. Owners already hold `user:set-password` in the admin
 *  plugin's role map (packages/auth/src/index.ts), so no new permission is needed. */
function OwnerPasswordCard({ onChanged }: { onChanged: () => void }) {
  const actor = useActor()
  const notify = useNotify()
  const { hasPassword, refresh: refreshHasPassword } = useHasPassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const parsed = passwordSchema.safeParse({
      currentPassword,
      newPassword,
      confirm
    })
    if (!parsed.success) {
      const next: PasswordErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof PasswordErrors | undefined
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    if (hasPassword && !currentPassword) {
      setErrors({ currentPassword: 'Current password is required' })
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      if (hasPassword) {
        const { error } = await authClient.changePassword({
          newPassword,
          currentPassword
        })
        if (error) {
          notify.error(error.message || 'Could not change password')
          return
        }
      } else {
        const { error } = await authClient.admin.setUserPassword({
          userId: actor.id,
          newPassword
        })
        if (error) {
          notify.error(error.message || 'Could not set password')
          return
        }
      }
      notify.success(hasPassword ? 'Password changed' : 'Remote access enabled')
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      await refreshHasPassword()
      // Only the "set password" branch (no prior credential) actually flips the credential-status
      // boolean the Users list reads — "change password" keeps the same true/false state — but
      // notifying unconditionally is simpler and harmless (an extra re-fetch, not an extra
      // mutation) and keeps this card from needing to know UserList's internals.
      onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {hasPassword ? 'Change password' : 'Remote access'}
        </CardTitle>
        <CardDescription>
          {hasPassword === false
            ? 'Signing in from this machine needs no password. Signing in remotely — over a tunnel or a hosted server — requires one.'
            : 'Update the password you use to sign in.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasPassword === null ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <form
            onSubmit={(e) => void onSubmit(e)}
            noValidate
            className="grid max-w-sm gap-4"
          >
            {hasPassword && (
              <div className="grid gap-1.5">
                <Label htmlFor="pw-current">Current password</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  aria-invalid={!!errors.currentPassword}
                />
                {errors.currentPassword && (
                  <p className="text-sm text-destructive">
                    {errors.currentPassword}
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new">
                {hasPassword ? 'New password' : 'Password'}
              </Label>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={!!errors.newPassword}
              />
              {errors.newPassword && (
                <p className="text-sm text-destructive">{errors.newPassword}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-confirm">Confirm password</Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!errors.confirm}
              />
              {errors.confirm && (
                <p className="text-sm text-destructive">{errors.confirm}</p>
              )}
            </div>
            <Button type="submit" disabled={submitting} className="w-fit">
              {submitting
                ? 'Saving…'
                : hasPassword
                  ? 'Change password'
                  : 'Set password'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

/** #248: Users & Roles as a first-class top-level screen (promoted out of Settings) — same
 *  full-width PageHeader/PageBody shell Posts/Pages use (ContentList), not the narrow centered
 *  Settings panel. Gated entirely on `users.view`: the sidebar nav item is gated at
 *  registration (AppSidebar), and the route itself re-checks (app.tsx), so this component only
 *  ever renders for an actor who already has the permission — no internal gate needed here. */
export function UsersScreen() {
  // Bumped whenever OwnerPasswordCard changes the current user's own credential state, so
  // UserList's "No password" badge for that same row doesn't go stale within the same page
  // session (#248 Task 8 review, Finding 2).
  const [refreshSignal, setRefreshSignal] = useState(0)
  return (
    <>
      <PageHeader
        title="Users & Roles"
        subtitle="Who can sign in and what they can do."
      />
      <PageBody>
        <div className="space-y-5">
          <UserList refreshSignal={refreshSignal} />
          <OwnerPasswordCard onChanged={() => setRefreshSignal((n) => n + 1)} />
        </div>
      </PageBody>
    </>
  )
}
