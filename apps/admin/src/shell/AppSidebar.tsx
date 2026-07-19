import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Files,
  Tags,
  Image,
  ClipboardList,
  Palette,
  Settings,
  ExternalLink,
  Activity,
  Users,
  FlaskConical
} from 'lucide-react'
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton
} from '@/components/ui/sidebar'
import type { Action } from '@setu/core'
import { DeployControl } from '../deploy/DeployControl'
import { useCan } from '../auth/actor'
import { siteUrl } from './site-url'
import { ThemeToggle } from './ThemeToggle'
import { UserMenu } from './UserMenu'

// `can` is the capability required to SEE this nav item (#362). Omitted = visible to every signed-in
// role (Posts/Pages/Taxonomies/Media stay visible to content roles; their destructive actions gate
// inside the screen). The gated screens map to the epic #359 table: Forms → forms.view, Users →
// users.view, Appearance → theme.manage, Settings → settings.view, Site Health → sitehealth.view —
// all Maintainer+/Admin. The server re-enforces each of these; this hiding is UX only.
type Item = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  can?: Action
}
type Group = { label?: string; items: Item[] }

const BASE_NAV: Group[] = [
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Content',
    items: [
      { to: '/posts', label: 'Posts', icon: FileText },
      { to: '/pages', label: 'Pages', icon: Files },
      { to: '/taxonomies', label: 'Taxonomies', icon: Tags }
    ]
  },
  {
    label: 'Workspace',
    items: [
      { to: '/media', label: 'Media', icon: Image },
      { to: '/forms', label: 'Forms', icon: ClipboardList, can: 'forms.view' },
      { to: '/users', label: 'Users', icon: Users, can: 'users.view' },
      {
        to: '/appearance',
        label: 'Appearance',
        icon: Palette,
        can: 'theme.manage'
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        can: 'settings.view'
      },
      {
        to: '/health',
        label: 'Site Health',
        icon: Activity,
        can: 'sitehealth.view'
      }
    ]
  },
  // Demo Data panel (#513): DEV-ONLY — the spread is empty in production
  // builds, so the group (like the screen itself) is dead-code-eliminated,
  // not merely hidden. Gated `users.delete` (admin-only): seeding creates and
  // unseeding deletes accounts; the server enforces the same action.
  ...(import.meta.env.DEV
    ? [
        {
          label: 'Developer',
          items: [
            {
              to: '/demo-data',
              label: 'Demo Data',
              icon: FlaskConical,
              can: 'users.delete'
            }
          ]
        } satisfies Group
      ]
    : [])
]

export function AppSidebar() {
  const can = useCan()
  // #362: each item declares the capability required to see it; drop the ones this actor lacks, then
  // drop any group left empty. An actor never sees a nav item for a screen it can't enter (mirrors
  // how gated groups disappear rather than render-then-hide). Route-level guards in app.tsx
  // re-check the same capability for direct-URL visits; the server is the real enforcement boundary.
  const nav: Group[] = BASE_NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.can || can(it.can))
  })).filter((g) => g.items.length > 0)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center"
          >
            <svg viewBox="0 0 32 32" width={28} height={28} fill="none">
              <rect
                x="1"
                y="1"
                width="30"
                height="30"
                rx="9"
                fill="var(--primary)"
              />
              <path
                d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
                stroke="var(--primary-foreground)"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Setu</span>
            <span className="text-xs text-muted-foreground">
              Local workspace
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((g, i) => (
          <SidebarGroup key={g.label ?? `g${i}`}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {g.items.map((it) => (
                <SidebarMenuItem key={it.to}>
                  <NavLink to={it.to} end={it.to === '/dashboard'}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={it.label}
                      >
                        <span>
                          <it.icon />
                          <span>{it.label}</span>
                        </span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="View site">
              <a href={siteUrl()} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                <span>View site</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DeployControl />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
