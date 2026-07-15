import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'
import { PasswordNudgeBanner } from '../auth/PasswordNudgeBanner'
import { GlobalCommands } from '../command/GlobalCommands'
import { CommandPalette } from '../command/CommandPalette'

export function AppShell({ children }: { children: ReactNode }) {
  // Desktop-only: collapse is handled by the SidebarRail (in AppSidebar) + the
  // ⌘/Ctrl+B shortcut — no separate trigger button needed.
  // #386: the password nudge sits ABOVE the scroll container (SidebarInset is a flex column), so
  // it shows on every screen and content — editor canvas included — simply flexes below it
  // instead of being overlapped or pushed out of view.
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen overflow-hidden">
        <PasswordNudgeBanner />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
      <GlobalCommands />
      <CommandPalette />
    </SidebarProvider>
  )
}
