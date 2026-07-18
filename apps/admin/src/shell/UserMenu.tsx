import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authClient } from '../auth/auth-client'
import { useHasPassword } from '../auth/use-has-password'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { LogOut, UserPen } from 'lucide-react'
import { ProfileDialog } from './ProfileDialog'

/** Sidebar-footer user menu (#248 Task 6). Only renders when a REAL Better Auth session exists —
 *  the no-API in-browser topology (see main.tsx's AuthBoundary) never has a session, so this
 *  correctly renders nothing there rather than showing a sign-out action for a local owner with
 *  no session to end. Signing out routes back to SessionGate's LoginScreen automatically: it
 *  re-renders once useSession's data goes null.
 *
 *  #410: also hosts the "Your profile" self display-name dialog — see ProfileDialog.tsx's comment
 *  for why this is its home rather than the Users screen (gated on `users.view`, which
 *  editor/author don't hold).
 *
 *  #386 logout guard: a PASSWORDLESS user (no `credential` account — any role, since a
 *  passwordless user of any role faces the same lockout) who signs out of a local instance can
 *  only get back in with a fresh loopback sign-in link. So "Sign out" first checks
 *  useHasPassword: true → sign out as always; false → an AlertDialog offers "Set password"
 *  before leaving; null (unknown) → ONE awaited refresh with a brief pending state, then sign
 *  out anyway if still unknown — a transient fetch error must never trap a user who wants to
 *  leave. The check is lazy (fires when the dropdown opens, not per shell render). */
export function UserMenu() {
  const { data } = authClient.useSession()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [guardOpen, setGuardOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const { hasPassword, refresh } = useHasPassword(menuOpen)
  const user = data?.user as
    | { name?: string | null; email?: string | null; image?: string | null }
    | undefined
  if (!user) return null

  const label = user.name || user.email || 'Signed in'
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase()

  async function onSignOutSelect() {
    if (checking) return
    let known = hasPassword
    if (known === null) {
      // Unknown (still loading, or the lazy fetch failed): one awaited retry, then decide.
      setChecking(true)
      try {
        known = await refresh()
      } finally {
        setChecking(false)
      }
    }
    setMenuOpen(false)
    if (known === false) {
      setGuardOpen(true)
      return
    }
    // Has a password — or still unknown after the retry (never trap a user who wants to leave).
    void authClient.signOut()
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton aria-label={label} className="gap-2">
            <Avatar size="sm">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="grid text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{label}</span>
              {user.name && user.email && (
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserPen /> Your profile
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={checking}
            // preventDefault keeps the menu open while the single awaited refresh runs, so the
            // pending label is actually visible; onSignOutSelect closes the menu itself.
            onSelect={(e) => {
              e.preventDefault()
              void onSignOutSelect()
            }}
          >
            <LogOut /> {checking ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={guardOpen} onOpenChange={setGuardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Set a password before signing out?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You haven't set a password. If you sign out, you'll need a fresh
              sign-in link from the machine running Setu (run{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] text-foreground">
                pnpm auth:login-link
              </code>
              ) to get back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void navigate('/users')
              }}
            >
              Set password
            </AlertDialogAction>
            <AlertDialogAction
              variant="ghost"
              onClick={() => void authClient.signOut()}
            >
              Sign out anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        currentName={user.name ?? ''}
      />
    </>
  )
}
