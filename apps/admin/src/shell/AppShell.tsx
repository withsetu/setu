import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'

export function AppShell({ children }: { children: ReactNode }) {
  // Desktop-only: collapse is handled by the SidebarRail (in AppSidebar) + the
  // ⌘/Ctrl+B shortcut — no separate trigger button needed.
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
