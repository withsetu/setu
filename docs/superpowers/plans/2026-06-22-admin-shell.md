# Admin Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the admin shell (sidebar, layout, header, theme toggle) onto shadcn with a collapsible desktop-only sidebar, and establish one shared `PageBody` container so every screen aligns at a consistent gutter.

**Architecture:** Replace the bespoke `.app`/`.sidebar`/`.main` layout with shadcn `SidebarProvider` + `AppSidebar` + `SidebarInset`. Add leaf primitives `PageBody` (gutter/max-width container) and a rebuilt `PageHeader`. Each task is additive or in-place-compatible so the package stays green until the shell goes live in Task 4.

**Tech Stack:** React 19, shadcn/ui (`sidebar`, `button`, `tooltip`), `lucide-react`, react-router-dom 6, Tailwind v4 tokens, Vitest + Testing Library.

## Global Constraints

- Branch `admin-shell` off `main` (foundation + dashboard already merged).
- Use ONLY `@/components/ui/*` primitives + standard token utilities + lucide icons. No new bespoke CSS classes / custom token names (per `docs/admin-ui-conventions.md`).
- Sidebar: shadcn `Sidebar` `collapsible="icon"`, **desktop-only** — the generated mobile `<Sheet>` branch is removed.
- Logo mark fills with **`--primary`** (the brand), never `--accent` (which is the neutral hover surface).
- Theme toggle: light/dark only (no system mode); sets `document.documentElement` `data-theme` + persists `localStorage('setu-theme')` (restore-on-load already lives in `index.html`).
- Deploy is a **global** sidebar-footer action; it is **removed from the dashboard header**.
- `PageBody` gutter = `px-[30px]` (aligns with the header), `max-w-[1400px]`, left-aligned. Editor opts out (full-bleed).
- Nav structure preserved: Dashboard · Content (Posts/Pages/Categories) · Workspace (Media/Forms/Appearance/Settings).
- Verification per task: `pnpm --filter @setu/admin typecheck` + `pnpm --filter @setu/admin test <file>` green (cumulative typecheck stays green every task).

---

### Task 1: `PageBody` container + rebuilt `PageHeader`

**Files:**
- Create: `apps/admin/src/shell/PageBody.tsx`
- Rewrite: `apps/admin/src/shell/PageHeader.tsx` (same export + props, shadcn/token styling — keeps every current importer compiling)
- Test: `apps/admin/test/page-body.test.tsx`

**Interfaces:**
- Produces: `<PageBody className?>{children}</PageBody>` — content container; `<PageHeader title subtitle? count? actions? />` (unchanged signature).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/page-body.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageBody } from '../src/shell/PageBody'

describe('PageBody', () => {
  it('renders children inside a gutter container', () => {
    const { getByText, container } = render(<PageBody><p>hi</p></PageBody>)
    expect(getByText('hi')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('px-[30px]')
  })
  it('merges a passthrough className', () => {
    const { container } = render(<PageBody className="pb-20"><span /></PageBody>)
    expect(container.firstChild).toHaveClass('pb-20')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test page-body`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `PageBody.tsx`**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The one content container: consistent gutters (aligned to the page header),
 *  a max width so content doesn't sprawl on wide screens, left-aligned so it
 *  tracks the page title. Screens render their content inside this. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-0 max-w-[1400px] space-y-5 px-[30px] pt-6 pb-10', className)}>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `PageHeader.tsx` on tokens (same signature)**

```tsx
import type { ReactNode } from 'react'

export function PageHeader({
  title, count, subtitle, actions,
}: { title: string; count?: number; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-border bg-background px-[30px] pt-[22px] pb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[21px] font-bold tracking-tight text-foreground">
          {title}
          {count !== undefined && (
            <span className="ml-2.5 align-[3px] rounded-full bg-secondary px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">{count}</span>
          )}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2.5">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 5: Run — verify pass + cumulative typecheck**

Run: `pnpm --filter @setu/admin test page-body && pnpm --filter @setu/admin typecheck`
Expected: PASS (2/2). Typecheck clean — `PageHeader`'s signature is unchanged so all current importers still compile. (The header now has its own padding via utilities; the old `.page-header` CSS becomes dead and is removed in Task 6.)

- [ ] **Step 6: Commit**
```bash
git add apps/admin/src/shell/PageBody.tsx apps/admin/src/shell/PageHeader.tsx apps/admin/test/page-body.test.tsx
git commit -m "feat(admin): PageBody container + PageHeader on tokens"
```

---

### Task 2: Make the shadcn sidebar desktop-only

**Files:**
- Modify: `apps/admin/src/components/ui/sidebar.tsx` (remove the mobile `<Sheet>` branch + now-unused Sheet imports)
- Test: `apps/admin/test/sidebar-desktop-only.test.tsx`

**Interfaces:**
- Consumes: nothing prior.
- Produces: a `Sidebar` that always renders its desktop variant (no off-canvas Sheet).

- [ ] **Step 1: Confirm `use-mobile` consumers (scope check)**

Run: `grep -rn "use-mobile" apps/admin/src`
Expected: only `components/ui/sidebar.tsx` imports it. (If another file does, leave the hook alone — this task only edits `sidebar.tsx`.)

- [ ] **Step 2: Write the failing test**

Create `apps/admin/test/sidebar-desktop-only.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SidebarProvider, Sidebar, SidebarContent } from '@/components/ui/sidebar'

describe('sidebar is desktop-only', () => {
  it('never renders a mobile dialog/sheet', () => {
    const { queryByRole } = render(
      <SidebarProvider><Sidebar><SidebarContent>nav</SidebarContent></Sidebar></SidebarProvider>,
    )
    expect(queryByRole('dialog')).toBeNull()
  })
})
```
(jsdom's default viewport keeps `useIsMobile` false anyway; this test guards against the Sheet branch being reachable.)

- [ ] **Step 3: Run — verify it passes against the CURRENT file, then prove the edit keeps it green**

Run: `pnpm --filter @setu/admin test sidebar-desktop-only`
Expected: PASS now (jsdom width → not mobile). This test is a regression guard; proceed to make the desktop-only edit so the Sheet branch can't render at any width.

- [ ] **Step 4: Remove the mobile branch in `sidebar.tsx`**

In the `Sidebar` function (around the `if (isMobile) { return (<Sheet …>…</Sheet>) }` block near line 183), delete that entire `if (isMobile)` block. Then remove the now-unused imports from `@/components/ui/sheet` at the top (`Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`) and drop `isMobile` from the destructure in `Sidebar` if it becomes unused (keep it in `useSidebar`/provider — it's still referenced by `toggleSidebar` and the menu-button tooltip). Leave the rest of the file unchanged.

- [ ] **Step 5: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test sidebar-desktop-only && pnpm --filter @setu/admin typecheck`
Expected: PASS; typecheck clean (no unused-import / undefined errors). If `isMobile` is now unused in `Sidebar`, removing it from the destructure clears the TS6133 warning.

- [ ] **Step 6: Commit**
```bash
git add apps/admin/src/components/ui/sidebar.tsx apps/admin/test/sidebar-desktop-only.test.tsx
git commit -m "feat(admin): make shadcn sidebar desktop-only (drop mobile Sheet branch)"
```

---

### Task 3: `ThemeToggle` + `AppSidebar`

**Files:**
- Create: `apps/admin/src/shell/ThemeToggle.tsx`
- Create: `apps/admin/src/shell/AppSidebar.tsx`
- Test: `apps/admin/test/theme-toggle.test.tsx`, `apps/admin/test/app-sidebar.test.tsx`

**Interfaces:**
- Consumes: `@/components/ui/sidebar` exports (`Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarRail`); `siteUrl`, `useDeploy`, `useCan`; lucide icons.
- Produces: `<ThemeToggle />`, `<AppSidebar />`. (Additive — not wired until Task 4.)

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/test/theme-toggle.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '../src/shell/ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => { document.documentElement.removeAttribute('data-theme'); localStorage.clear() })
  it('flips and persists the theme', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('setu-theme')).toBe('dark')
  })
})
```

Create `apps/admin/test/app-sidebar.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '../src/shell/AppSidebar'

const wrap = () => render(
  <MemoryRouter initialEntries={['/dashboard']}>
    <SidebarProvider><AppSidebar /></SidebarProvider>
  </MemoryRouter>,
)

describe('AppSidebar', () => {
  it('renders the nav with correct routes', () => {
    wrap()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /Posts/ })).toHaveAttribute('href', '/posts')
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute('href', '/appearance')
  })
  it('renders the workspace name and footer actions', () => {
    wrap()
    expect(screen.getByText('Setu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View site/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `pnpm --filter @setu/admin test theme-toggle app-sidebar`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `ThemeToggle.tsx`**

```tsx
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { SidebarMenuButton } from '@/components/ui/sidebar'

function current(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(current)
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('setu-theme', next) } catch { /* private mode */ }
  }
  return (
    <SidebarMenuButton onClick={toggle} aria-label="Toggle theme" tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
```

- [ ] **Step 4: Implement `AppSidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Files, Folder, Image, ClipboardList, Palette, Settings,
  ExternalLink, Rocket,
} from 'lucide-react'
import {
  Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarRail,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
} from '@/components/ui/sidebar'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'
import { siteUrl } from './site-url'
import { ThemeToggle } from './ThemeToggle'
import { useState } from 'react'

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> }
type Group = { label?: string; items: Item[] }

const NAV: Group[] = [
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Content', items: [
    { to: '/posts', label: 'Posts', icon: FileText },
    { to: '/pages', label: 'Pages', icon: Files },
    { to: '/categories', label: 'Categories', icon: Folder },
  ] },
  { label: 'Workspace', items: [
    { to: '/media', label: 'Media', icon: Image },
    { to: '/forms', label: 'Forms', icon: ClipboardList },
    { to: '/appearance', label: 'Appearance', icon: Palette },
    { to: '/settings', label: 'Settings', icon: Settings },
  ] },
]

function DeployFooterButton() {
  const can = useCan()
  const { sha, deploy } = useDeploy()
  const [busy, setBusy] = useState(false)
  if (!can('site.deploy')) return null
  return (
    <SidebarMenuButton onClick={() => { setBusy(true); void deploy().finally(() => setBusy(false)) }}
      aria-label="Deploy site" tooltip={sha ? `Deployed ${sha.slice(0, 7)}` : 'Deploy site'}>
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
              <path d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
                stroke="var(--primary-foreground)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
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
                  <SidebarMenuButton asChild tooltip={it.label}>
                    <NavLink to={it.to} className={({ isActive }) => (isActive ? 'data-[active]' : '')} data-active={undefined}>
                      <it.icon />
                      <span>{it.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
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
              <a href={siteUrl()} target="_blank" rel="noopener noreferrer"><ExternalLink /><span>View site</span></a>
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
```
Note on active state: shadcn's `SidebarMenuButton` styles active via `data-[active=true]`. To drive it from `NavLink`, set the attribute from `isActive`. Replace the `NavLink` line with:
```tsx
<NavLink to={it.to} end={it.to === '/dashboard'}>
  {({ isActive }) => (<><it.icon /><span>{it.label}</span>{isActive && <span data-active-marker hidden />}</>)}
</NavLink>
```
— but simpler and correct: render the `SidebarMenuButton` with `isActive` by lifting it out. Use this final form for each item instead of the inline `asChild` above:
```tsx
<SidebarMenuItem key={it.to}>
  <NavLink to={it.to} end={it.to === '/dashboard'}>
    {({ isActive }) => (
      <SidebarMenuButton asChild isActive={isActive} tooltip={it.label}>
        <span><it.icon /><span>{it.label}</span></span>
      </SidebarMenuButton>
    )}
  </NavLink>
</SidebarMenuItem>
```
(`SidebarMenuButton` accepts an `isActive` prop that sets `data-active`. Wrapping the inner content in a `<span>` keeps `asChild`'s single-child requirement. The `NavLink` provides the anchor + href the test asserts.)

- [ ] **Step 5: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test theme-toggle app-sidebar && pnpm --filter @setu/admin typecheck`
Expected: PASS. If the active-state wiring fights `asChild` typing, prefer the second (lifted `NavLink` render-prop) form shown above; confirm the nav links still expose `href` (the test asserts it).

- [ ] **Step 6: Commit**
```bash
git add apps/admin/src/shell/ThemeToggle.tsx apps/admin/src/shell/AppSidebar.tsx apps/admin/test/theme-toggle.test.tsx apps/admin/test/app-sidebar.test.tsx
git commit -m "feat(admin): AppSidebar (shadcn, collapsible, brand logo) + ThemeToggle"
```

---

### Task 4: `AppShell` + wire into `app.tsx` (shell goes live)

**Files:**
- Create: `apps/admin/src/shell/AppShell.tsx`
- Modify: `apps/admin/src/app.tsx`
- Delete: `apps/admin/src/shell/Sidebar.tsx`, `apps/admin/src/shell/DeployButton.tsx`
- Test: existing `apps/admin/test/sidebar.test.tsx` (rewrite to target AppSidebar/AppShell if it referenced the old `Sidebar`), plus `apps/admin/test/smoke.test.tsx` if it mounts the shell

**Interfaces:**
- Consumes: `AppSidebar` (Task 3), `@/components/ui/sidebar` (`SidebarProvider`, `SidebarInset`, `SidebarTrigger`).
- Produces: `<AppShell>{children}</AppShell>` wrapping the routed content.

- [ ] **Step 1: Inspect the old sidebar test**

Run: `cat apps/admin/test/sidebar.test.tsx`
If it imports `shell/Sidebar`, it will break when that file is deleted — rewrite it to import `AppSidebar` wrapped in `SidebarProvider` + `MemoryRouter` (reuse the assertions from `app-sidebar.test.tsx` if overlapping, or delete it in favor of `app-sidebar.test.tsx`). Decide based on what it currently asserts; do not invent new coverage.

- [ ] **Step 2: Implement `AppShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen overflow-hidden">
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-1 px-2 pt-2 md:hidden">
            <SidebarTrigger />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```
(The `SidebarTrigger` row is hidden on normal widths; the rail handles collapse on desktop. Keep it for keyboard/edge cases — it's tiny.)

- [ ] **Step 3: Rewire `app.tsx`**

Replace the `App` body:
```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { Placeholder } from './screens/Placeholder'
import { ContentList } from './screens/ContentList'
import { Appearance } from './screens/Appearance'
import { EditorScreen } from './editor/EditorScreen'
import { Dashboard } from './screens/Dashboard'
import { Media } from './screens/Media'
import { Categories } from './screens/Categories'

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/posts" element={<ContentList collection="post" title="Posts" />} />
        <Route path="/pages" element={<ContentList collection="page" title="Pages" />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/media" element={<Media />} />
        <Route path="/forms" element={<Placeholder title="Forms" />} />
        <Route path="/appearance" element={<Appearance />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
        <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </AppShell>
  )
}
```

- [ ] **Step 4: Delete the old shell files**
```bash
git rm apps/admin/src/shell/Sidebar.tsx apps/admin/src/shell/DeployButton.tsx
```

- [ ] **Step 5: Verify — typecheck + full suite + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green. If anything still imports `shell/Sidebar` or `shell/DeployButton`, fix it (only `app.tsx` should have imported `Sidebar`; `DeployButton` was only used by the old `Sidebar`). Confirm with `grep -rn "shell/Sidebar\|DeployButton" apps/admin/src` → no matches.

- [ ] **Step 6: Commit**
```bash
git add -A apps/admin
git commit -m "feat(admin): AppShell on shadcn SidebarProvider; retire custom Sidebar + DeployButton"
```

---

### Task 5: Adopt `PageBody` across screens; drop the dashboard's duplicate Deploy

**Files:**
- Modify: `apps/admin/src/screens/Dashboard.tsx` (use `PageBody`; remove Deploy from `HeaderActions`)
- Modify: `apps/admin/src/screens/ContentList.tsx`, `apps/admin/src/screens/Media.tsx`, `apps/admin/src/screens/Appearance.tsx` (wrap content in `PageBody`)
- Test: existing screen tests stay green; update any that asserted the dashboard Deploy

**Interfaces:**
- Consumes: `PageBody` (Task 1).

- [ ] **Step 1: Dashboard — swap wrapper + remove Deploy**

In `screens/Dashboard.tsx`: replace the `<div className="page-body">…</div>` wrapper with `<PageBody>…</PageBody>` (drop the hand-rolled `max-w-[1400px] px-[30px] pt-6 pb-10` div — `PageBody` provides it; keep the inner content). In `HeaderActions`, remove the `Deploy` `Button` block and the now-unused `useCan`/`useDeploy`/`busy` wiring (New post + New page remain). Import `PageBody` from `../shell/PageBody`.

- [ ] **Step 2: ContentList / Media / Appearance — wrap in `PageBody`**

In each, replace `<div className="page-body">` with `<PageBody className="...">` (and the matching close tag). For ContentList, move the screen's content into `PageBody`; remove the hardcoded horizontal `30px` from `.list-toolbar` (and similar) in `styles/components.css` so the gutter comes only from `PageBody` (verify no double gutter). Media's grid and Appearance's two-column layout sit inside `PageBody` unchanged.

- [ ] **Step 3: Reconcile any per-screen 30px in CSS**

Run: `grep -rn "30px" apps/admin/src/styles/components.css` — for rules that were faking the page gutter on these three screens (toolbars/list bodies), change horizontal `30px` to `0` (or remove), since `PageBody` now owns the gutter. Leave non-gutter 30px (e.g. unrelated spacing) alone. (Categories' `.category-new`/`.category-manage-list` are out of scope — Categories keeps its layout this PR.)

- [ ] **Step 4: Update tests touching the dashboard Deploy**

Run: `grep -rn "Deploy" apps/admin/test/dashboard.test.tsx apps/admin/test/smoke.test.tsx` — if any asserts a Deploy control in the dashboard header, update it (Deploy is now sidebar-only). Do not weaken unrelated assertions.

- [ ] **Step 5: Verify — typecheck + full suite + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green.

- [ ] **Step 6: Commit**
```bash
git add -A apps/admin
git commit -m "feat(admin): adopt PageBody gutter across screens; move Deploy to the sidebar"
```

---

### Task 6: Remove dead shell CSS + final sweep

**Files:**
- Modify: `apps/admin/src/styles/shell.css` (remove the now-dead bespoke shell rules)
- Modify: `apps/admin/src/index.css` if a removed stylesheet leaves an empty import

**Interfaces:** none.

- [ ] **Step 1: Remove dead rules from `shell.css`**

Delete the rules that the shadcn shell + `PageBody`/`PageHeader` replaced: `.app`, `.main`, `.sidebar`, `.sidebar-top`, `.sidebar-bottom`, `.ws`, `.ws-*`, `.logo-mark`, `.nav`, `.nav-group*`, `.nav-item*`, `.nav-label`, `.theme-toggle`, `.page-header`, `.page-header-main`, `.page-title`, `.page-count`, `.page-subtitle`, `.page-actions`, `.page-body`, `.deploy-btn`. Keep any rule still referenced elsewhere — verify each before deleting:
```bash
for sel in app main sidebar nav-item theme-toggle page-header page-body deploy-btn ws-name logo-mark; do
  echo "== $sel =="; grep -rn "\"[^\"]*\\b$sel\\b" apps/admin/src --include='*.tsx' --include='*.ts' | grep -v test | head -3
done
```
Only delete a rule whose class has no remaining TSX/TS user. (`.empty-state`, `.muted`, `.surface-tx`, scrollbar/base rules stay.)

- [ ] **Step 2: Verify — full gate**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green. The build's CSS shrinks; no "unknown utility" errors.

- [ ] **Step 3: Manual run-check (controller will also do this)**

Note in the commit that manual verification on `:5174` is pending: collapse/expand rail persists; nav active states; light/dark toggle persists; logo is brand indigo; every screen aligns at the same gutter; editor full-bleed; no duplicate Deploy on the dashboard.

- [ ] **Step 4: Commit**
```bash
git add -A apps/admin
git commit -m "chore(admin): remove dead bespoke shell CSS (replaced by shadcn shell + PageBody)"
```

---

## Self-Review

**Spec coverage:**
- §2 sidebar collapsible desktop-only → Task 2 (desktop-only) + Task 3 (AppSidebar `collapsible="icon"`). ✓
- §2 app layout (SidebarProvider/Inset) → Task 4. ✓
- §2 PageBody + editor opt-out → Task 1 (primitive) + Task 5 (adoption; editor untouched). ✓
- §2 PageHeader → Task 1. ✓
- §2 theme toggle carry-over → Task 3 (ThemeToggle). ✓
- §2 logo→`--primary` → Task 3 (AppSidebar logo uses `var(--primary)`). ✓
- §2 Deploy global + removed from dashboard header → Task 3 (footer) + Task 5 (remove from Dashboard). ✓
- §3 removed files (Sidebar, DeployButton, dead CSS) → Task 4 + Task 6. ✓
- §4 nav structure + lucide → Task 3. ✓
- §7 tests → each task. ✓
- Categories PageBody adoption: **deferred** to the Categories content PR (noted in handoff) — Categories already aligns at 30px; its bespoke full-height layout is reconciled there. Trim from spec §5.

**Placeholder scan:** none — every step has concrete code/commands. Task 3's active-state wiring gives the definitive lifted-`NavLink` form; Task 4/5/6's "inspect then reuse/reconcile" steps name the exact command to run and the rule for deciding.

**Type consistency:** `PageBody({children, className})` (Task 1) consumed in Task 5; `AppSidebar`/`ThemeToggle` (Task 3) consumed by `AppShell` (Task 4); `PageHeader` signature unchanged so existing importers compile through Tasks 1–4; `useCan('site.deploy')` gate used in both the footer deploy (Task 3) and removed-from-dashboard (Task 5) consistently.

**Gating:** Tasks 1–3 are additive / signature-compatible (package stays green). Task 4 swaps the shell live and deletes the old files (cumulative gate). Tasks 5–6 adopt + clean up, each ending green.
