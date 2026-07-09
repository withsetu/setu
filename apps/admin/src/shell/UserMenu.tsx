import { useState } from 'react'
import { authClient } from '../auth/auth-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
 *  editor/author don't hold). */
export function UserMenu() {
  const { data } = authClient.useSession()
  const [profileOpen, setProfileOpen] = useState(false)
  const user = data?.user as
    | { name?: string | null; email?: string | null; image?: string | null }
    | undefined
  if (!user) return null

  const label = user.name || user.email || 'Signed in'
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase()

  return (
    <>
      <DropdownMenu>
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
          <DropdownMenuItem onClick={() => void authClient.signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        currentName={user.name ?? ''}
      />
    </>
  )
}
