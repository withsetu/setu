import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Files, Tags, Image, ClipboardList, Palette, Settings,
  ExternalLink, Rocket, Activity,
} from 'lucide-react'
import {
  Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarRail,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
} from '@/components/ui/sidebar'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'
import { siteUrl } from './site-url'
import { ThemeToggle } from './ThemeToggle'

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> }
type Group = { label?: string; items: Item[] }

const NAV: Group[] = [
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Content', items: [
    { to: '/posts', label: 'Posts', icon: FileText },
    { to: '/pages', label: 'Pages', icon: Files },
    { to: '/taxonomies', label: 'Taxonomies', icon: Tags },
  ] },
  { label: 'Workspace', items: [
    { to: '/media', label: 'Media', icon: Image },
    { to: '/forms', label: 'Forms', icon: ClipboardList },
    { to: '/appearance', label: 'Appearance', icon: Palette },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/health', label: 'Site Health', icon: Activity },
  ] },
]

function DeployFooterButton() {
  const can = useCan()
  const { sha, deploy } = useDeploy()
  const [busy, setBusy] = useState(false)
  if (!can('site.deploy')) return null
  return (
    <SidebarMenuButton
      onClick={() => { setBusy(true); void deploy().finally(() => setBusy(false)) }}
      aria-label="Deploy site"
      tooltip={sha ? `Deployed ${sha.slice(0, 7)}` : 'Deploy site'}
    >
      <Rocket />
      <span>{busy ? 'Deploying…' : sha ? `Deployed · ${sha.slice(0, 7)}` : 'Deploy'}</span>
    </SidebarMenuButton>
  )
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center">
            <svg viewBox="0 0 32 32" width={28} height={28} fill="none">
              <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--primary)" />
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
            <span className="text-xs text-muted-foreground">Local workspace</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((g, i) => (
          <SidebarGroup key={g.label ?? `g${i}`}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {g.items.map((it) => (
                <SidebarMenuItem key={it.to}>
                  <NavLink to={it.to} end={it.to === '/dashboard'}>
                    {({ isActive }) => (
                      <SidebarMenuButton asChild isActive={isActive} tooltip={it.label}>
                        <span><it.icon /><span>{it.label}</span></span>
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
                <ExternalLink /><span>View site</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem><DeployFooterButton /></SidebarMenuItem>
          <SidebarMenuItem><ThemeToggle /></SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
