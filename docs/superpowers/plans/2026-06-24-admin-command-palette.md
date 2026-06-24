# Admin command palette (⌘⇧P / ⌘K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An app-wide command palette (⌘⇧P / ⌘K) backed by a dynamic action registry any screen can contribute to, with global actions (nav/create/deploy/theme) + context-aware editor actions.

**Architecture:** A dependency-light `CommandRegistryProvider` holds a `Map<id, CommandAction>`. `useRegisterCommands(actions)` registers stable wrappers whose `run`/`enabled` delegate to a live ref (no stale closures, no re-register loop), auto-unregistering on unmount. `CommandPalette` (shadcn `CommandDialog` + cmdk) owns the global keybinding and renders grouped, `enabled`-filtered items; selecting one closes the palette and runs it. `GlobalCommands` (in `AppShell`) registers the always-on actions; `EditorScreen` registers editor actions while mounted.

**Tech Stack:** React 19, Vite, Vitest + Testing Library, shadcn `command` (cmdk ^1.1.1), react-router-dom, lucide-react.

## Global Constraints

- Keybinding: open on **(metaKey||ctrlKey) + 'k'** OR **(metaKey||ctrlKey) + shiftKey + (code 'KeyP')**; `preventDefault` both. Do NOT bind plain ⌘P (browser print). No clash with the sidebar's ⌘B.
- `CommandAction` = `{ id: string; title: string; group: string; keywords?: string; icon?: LucideIcon; run: () => void; enabled?: () => boolean }`. Disabled (`enabled?.() === false`) actions are filtered OUT before render, not shown greyed.
- Group render order: `Editor`, `Create`, `Go to`, `Site`, then any other groups alphabetically.
- `useRegisterCommands` must NOT cause render loops: register ONCE on mount (the `register` fn is stable); `run`/`enabled` delegate to a `useRef` of the latest actions so closures stay fresh without re-registration.
- shadcn `CommandDialog` props: `open`, `onOpenChange`, `title` (default "Command Palette"), `description`, `showCloseButton`, `children`. cmdk does the fuzzy filtering over each `CommandItem`'s `value`.
- Theme toggle logic must live in ONE place (`shell/theme.ts`), used by both `ThemeToggle` and the command action.
- Brand indigo = `--primary`; tokens only. Reuse the project's jsdom test workarounds for Radix/cmdk (e.g. `scrollIntoView` stub) as established in the taxonomy/editor tests.
- Full gate before done: `pnpm typecheck && pnpm test && pnpm build` ALL green (typecheck included — vitest does not typecheck).

---

### Task 1: Command registry (`command/registry.tsx`)

**Files:**
- Create: `apps/admin/src/command/registry.tsx`
- Create: `apps/admin/test/command-registry.test.tsx`

**Interfaces:**
- Produces: `CommandAction` (type), `CommandRegistryProvider`, `useCommandRegistry(): { register(actions: CommandAction[]): () => void; commands: CommandAction[] }`, `useRegisterCommands(actions: CommandAction[]): void`.

- [ ] **Step 1: Write the failing test**

`command-registry.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useEffect, useState } from 'react'
import { CommandRegistryProvider, useCommandRegistry, useRegisterCommands, type CommandAction } from '../src/command/registry'

function Probe() {
  const { commands } = useCommandRegistry()
  return <div data-testid="ids">{commands.map((c) => c.id).join(',')}</div>
}
const act1: CommandAction = { id: 'a', title: 'Alpha', group: 'G', run: () => {} }

function Registrar({ actions }: { actions: CommandAction[] }) {
  useRegisterCommands(actions)
  return null
}

describe('command registry', () => {
  it('registers actions on mount and exposes them', () => {
    render(<CommandRegistryProvider><Registrar actions={[act1]} /><Probe /></CommandRegistryProvider>)
    expect(screen.getByTestId('ids').textContent).toBe('a')
  })
  it('unregisters on unmount', () => {
    function Host() {
      const [on, setOn] = useState(true)
      useEffect(() => { setOn(false) }, []) // unmount the registrar after first paint
      return <>{on && <Registrar actions={[act1]} />}<Probe /></>
    }
    render(<CommandRegistryProvider><Host /></CommandRegistryProvider>)
    expect(screen.getByTestId('ids').textContent).toBe('')
  })
  it('run delegates to the latest closure (no stale capture)', () => {
    const calls: number[] = []
    function Counter() {
      const [n, setN] = useState(0)
      useEffect(() => { setN(5) }, [])
      useRegisterCommands([{ id: 'c', title: 'C', group: 'G', run: () => calls.push(n) }])
      return null
    }
    const { container } = render(<CommandRegistryProvider><Counter /><Probe /></CommandRegistryProvider>)
    // grab the registered action via a consumer and run it
    function Runner() { const { commands } = useCommandRegistry(); commands.find((c) => c.id === 'c')?.run(); return null }
    act(() => { render(<CommandRegistryProvider><Counter /><Runner /></CommandRegistryProvider>, { container }) })
    expect(calls.at(-1)).toBe(5)
  })
})
```
(If the third test's double-render is awkward in your harness, assert the same property more simply: register an action whose `run` reads a ref/state set after mount, expose `commands` via a button that calls `run`, click it, assert the latest value was used. The REQUIREMENT being tested: `run` is not frozen to the mount-render closure.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- command-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`registry.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface CommandAction {
  id: string
  title: string
  group: string
  keywords?: string
  icon?: LucideIcon
  run: () => void
  enabled?: () => boolean
}

interface RegistryValue {
  register: (actions: CommandAction[]) => () => void
  commands: CommandAction[]
}

const CommandRegistryContext = createContext<RegistryValue | null>(null)

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<string, CommandAction>>(() => new Map())
  const register = useCallback((incoming: CommandAction[]) => {
    setMap((prev) => {
      const next = new Map(prev)
      for (const a of incoming) next.set(a.id, a)
      return next
    })
    return () => setMap((prev) => {
      const next = new Map(prev)
      for (const a of incoming) next.delete(a.id)
      return next
    })
  }, [])
  const value = useMemo<RegistryValue>(() => ({ register, commands: [...map.values()] }), [register, map])
  return <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>
}

export function useCommandRegistry(): RegistryValue {
  const ctx = useContext(CommandRegistryContext)
  if (ctx === null) throw new Error('useCommandRegistry must be used within a CommandRegistryProvider')
  return ctx
}

/** Register `actions` while the calling component is mounted. Static fields (title/
 *  group/icon/keywords) are captured at mount; `run`/`enabled` delegate to a live
 *  ref so they always see the latest closures — no stale capture, and we register
 *  exactly once (no render loop). */
export function useRegisterCommands(actions: CommandAction[]): void {
  const { register } = useCommandRegistry()
  const ref = useRef(actions)
  ref.current = actions
  useEffect(() => {
    const wrapped: CommandAction[] = ref.current.map((a) => ({
      id: a.id, title: a.title, group: a.group, keywords: a.keywords, icon: a.icon,
      run: () => ref.current.find((x) => x.id === a.id)?.run(),
      enabled: () => ref.current.find((x) => x.id === a.id)?.enabled?.() ?? true,
    }))
    return register(wrapped)
  }, [register])
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- command-registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/command/registry.tsx apps/admin/test/command-registry.test.tsx
git commit -m "feat(admin): command action registry (register/useRegisterCommands)"
```

---

### Task 2: Theme util (`shell/theme.ts`) + refactor ThemeToggle

**Files:**
- Create: `apps/admin/src/shell/theme.ts`
- Create: `apps/admin/test/theme.test.ts`
- Modify: `apps/admin/src/shell/ThemeToggle.tsx`

**Interfaces:**
- Produces: `currentTheme(): 'light' | 'dark'`, `toggleTheme(): 'light' | 'dark'` (flips `[data-theme]` + `localStorage('setu-theme')`, returns the NEW theme).

- [ ] **Step 1: Write the failing test**

`theme.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { currentTheme, toggleTheme } from '../src/shell/theme'

beforeEach(() => { document.documentElement.removeAttribute('data-theme'); localStorage.clear() })

describe('theme util', () => {
  it('defaults to light', () => { expect(currentTheme()).toBe('light') })
  it('toggle sets dark then light, persisting to localStorage + data-theme', () => {
    expect(toggleTheme()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('setu-theme')).toBe('dark')
    expect(toggleTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('setu-theme')).toBe('light')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- theme.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`theme.ts`:

```ts
export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Flip the theme, persist to [data-theme] + localStorage, return the new theme. */
export function toggleTheme(): 'light' | 'dark' {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try { localStorage.setItem('setu-theme', next) } catch { /* private mode */ }
  return next
}
```

Refactor `ThemeToggle.tsx` to use them (behavior identical):

```tsx
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { currentTheme, toggleTheme } from './theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme)
  const onToggle = () => setTheme(toggleTheme())
  return (
    <SidebarMenuButton onClick={onToggle} aria-label="Toggle theme" tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- theme.test ThemeToggle`
Expected: PASS (theme util + any existing ThemeToggle test).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/shell/theme.ts apps/admin/test/theme.test.ts apps/admin/src/shell/ThemeToggle.tsx
git commit -m "refactor(admin): extract toggleTheme/currentTheme util"
```

---

### Task 3: `CommandPalette` (dialog + keybinding + grouped render)

**Files:**
- Create: `apps/admin/src/command/CommandPalette.tsx`
- Create: `apps/admin/test/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `useCommandRegistry()` (Task 1); shadcn `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`.
- Produces: `CommandPalette` (no props).

- [ ] **Step 1: Write the failing test**

`CommandPalette.test.tsx` — render inside `CommandRegistryProvider` with a registrar seeding actions across groups (one with `enabled: () => false`); cover:

```tsx
// helper opens via keydown: fireEvent.keyDown(window, { key: 'k', metaKey: true })
// 1. ⌘K opens the dialog (CommandInput visible)
// 2. ⌘⇧P opens it too: fireEvent.keyDown(window, { code: 'KeyP', key: 'P', metaKey: true, shiftKey: true })
// 3. an action with enabled()===false does NOT render
// 4. selecting an item runs its `run` and closes the dialog (run spy called; input gone)
// 5. groups render under their headings
```
Add the established `scrollIntoView`/pointer jsdom stubs used by other Radix/cmdk tests in this repo. Open the dialog, then `fireEvent.click(screen.getByText('Alpha'))` to select (cmdk items are selectable by text).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- CommandPalette`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`CommandPalette.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { useCommandRegistry, type CommandAction } from './registry'

const GROUP_ORDER = ['Editor', 'Create', 'Go to', 'Site']

function orderedGroups(actions: CommandAction[]): string[] {
  const groups = [...new Set(actions.map((a) => a.group))]
  return groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
}

export function CommandPalette() {
  const { commands } = useCommandRegistry()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const isK = mod && !e.shiftKey && e.key.toLowerCase() === 'k'
      const isShiftP = mod && e.shiftKey && e.code === 'KeyP'
      if (isK || isShiftP) { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const enabled = useMemo(() => commands.filter((a) => a.enabled?.() !== false), [commands, open])
  const groups = orderedGroups(enabled)

  const select = (a: CommandAction) => { setOpen(false); a.run() }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search for a command to run">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {enabled.filter((a) => a.group === g).map((a) => (
              <CommandItem key={a.id} value={`${a.title} ${a.keywords ?? ''}`} onSelect={() => select(a)}>
                {a.icon && <a.icon className="size-4" />}
                <span>{a.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
```
> Note: `enabled` is memo-keyed on `[commands, open]` so it re-filters each time the palette opens (picking up live `enabled()` values). If the project's `CommandItem`/`CommandGroup` need a `key`/`value` shape different from above, match the actual `command.tsx` exports (read it).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- CommandPalette`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/command/CommandPalette.tsx apps/admin/test/CommandPalette.test.tsx
git commit -m "feat(admin): CommandPalette — keybinding + grouped registry render"
```

---

### Task 4: `GlobalCommands` (nav / create / deploy / theme)

**Files:**
- Create: `apps/admin/src/command/GlobalCommands.tsx`
- Create: `apps/admin/test/GlobalCommands.test.tsx`

**Interfaces:**
- Consumes: `useRegisterCommands` (Task 1), `toggleTheme` (Task 2), `useNavigate` (react-router), `useDeploy` (`../deploy/deploy`), `useCan` (`../auth/actor`), `useNotify` (`../ui/notify`), lucide icons.
- Produces: `GlobalCommands` (renders null).

- [ ] **Step 1: Write the failing test**

`GlobalCommands.test.tsx` — render `<CommandRegistryProvider>` + a `MemoryRouter` + the needed providers (Deploy/Actor/Notify — follow how other tests build these; if heavy, mock `useDeploy`/`useCan` via the real providers with a permissive actor) + `<GlobalCommands/>` + a probe that reads `useCommandRegistry().commands`. Assert:

```tsx
// 'New post', 'Posts', 'Deploy site', 'Toggle theme' are registered (by title)
// when can('site.deploy') is false, the Deploy action's enabled() returns false
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- GlobalCommands`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`GlobalCommands.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, Files, Folders, Image, Palette, Settings, Plus, Rocket, SunMoon } from 'lucide-react'
import { useRegisterCommands, type CommandAction } from './registry'
import { toggleTheme } from '../shell/theme'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'
import { useNotify } from '../ui/notify'

export function GlobalCommands() {
  const navigate = useNavigate()
  const { deploy } = useDeploy()
  const can = useCan()
  const notify = useNotify()

  const actions: CommandAction[] = [
    { id: 'create.post', title: 'New post', group: 'Create', icon: Plus, run: () => navigate('/edit/post/en/new') },
    { id: 'create.page', title: 'New page', group: 'Create', icon: Plus, run: () => navigate('/edit/page/en/new') },
    { id: 'nav.dashboard', title: 'Dashboard', group: 'Go to', icon: LayoutDashboard, run: () => navigate('/dashboard') },
    { id: 'nav.posts', title: 'Posts', group: 'Go to', icon: FileText, run: () => navigate('/posts') },
    { id: 'nav.pages', title: 'Pages', group: 'Go to', icon: Files, run: () => navigate('/pages') },
    { id: 'nav.taxonomies', title: 'Taxonomies', group: 'Go to', icon: Folders, keywords: 'categories tags', run: () => navigate('/taxonomies') },
    { id: 'nav.media', title: 'Media', group: 'Go to', icon: Image, run: () => navigate('/media') },
    { id: 'nav.appearance', title: 'Appearance', group: 'Go to', icon: Palette, run: () => navigate('/appearance') },
    { id: 'nav.settings', title: 'Settings', group: 'Go to', icon: Settings, run: () => navigate('/settings') },
    { id: 'site.deploy', title: 'Deploy site', group: 'Site', icon: Rocket, enabled: () => can('site.deploy'),
      run: () => { void deploy().then(() => notify.success('Deploy started')).catch((e) => notify.error(e instanceof Error ? e.message : String(e))) } },
    { id: 'site.theme', title: 'Toggle theme', group: 'Site', icon: SunMoon, keywords: 'dark light mode', run: () => { toggleTheme() } },
  ]

  useRegisterCommands(actions)
  return null
}
```
> Confirm each lucide icon name exists (e.g. `Folders`, `SunMoon`) — substitute the closest valid lucide export if one is missing (the import will fail to typecheck otherwise).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- GlobalCommands`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/command/GlobalCommands.tsx apps/admin/test/GlobalCommands.test.tsx
git commit -m "feat(admin): GlobalCommands — nav/create/deploy/theme actions"
```

---

### Task 5: Wire provider + mount palette (integration)

**Files:**
- Modify: `apps/admin/src/main.tsx` (add `CommandRegistryProvider` around `<App />`)
- Modify: `apps/admin/src/shell/AppShell.tsx` (mount `<GlobalCommands />` + `<CommandPalette />`)
- Create: `apps/admin/test/command-palette-integration.test.tsx`

**Interfaces:**
- Consumes: `CommandRegistryProvider` (Task 1), `GlobalCommands` (Task 4), `CommandPalette` (Task 3).

- [ ] **Step 1: Add the provider in main.tsx**

Wrap `<App />` with `CommandRegistryProvider` (innermost, inside `TagsProvider`):

```tsx
import { CommandRegistryProvider } from './command/registry'
// …
<TagsProvider>
  <CommandRegistryProvider>
    <App />
  </CommandRegistryProvider>
</TagsProvider>
```

- [ ] **Step 2: Mount palette + global commands in AppShell**

```tsx
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'
import { GlobalCommands } from '../command/GlobalCommands'
import { CommandPalette } from '../command/CommandPalette'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">{children}</div>
      </SidebarInset>
      <GlobalCommands />
      <CommandPalette />
    </SidebarProvider>
  )
}
```

- [ ] **Step 3: Write the integration test**

`command-palette-integration.test.tsx` — render the full `App` within its providers (follow an existing full-app/screen test harness; the app must be wrapped in `CommandRegistryProvider` + router + Deploy/Actor/Notify). Assert: pressing ⌘K opens the palette, and a global action ("Posts") is listed. (If wiring the whole `App` is heavy, render `<CommandRegistryProvider><MemoryRouter><…providers><AppShell>…</AppShell></…></MemoryRouter></CommandRegistryProvider>` and assert the same.)

```tsx
// fireEvent.keyDown(window, { key: 'k', metaKey: true })
// expect(await screen.findByPlaceholderText(/type a command/i)).toBeInTheDocument()
// expect(screen.getByText('Posts')).toBeInTheDocument()
```

- [ ] **Step 4: Run + broad check**

Run: `pnpm --filter @setu/admin test -- command-palette-integration`
Then: `pnpm --filter @setu/admin test` (ensure main.tsx/AppShell changes didn't break shell/editor tests; if a test that renders AppShell now needs `CommandRegistryProvider`, wrap it — pure provider addition, no assertion change).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/main.tsx apps/admin/src/shell/AppShell.tsx apps/admin/test/command-palette-integration.test.tsx
git commit -m "feat(admin): wire CommandRegistryProvider + mount palette in AppShell"
```

---

### Task 6: Editor context actions

**Files:**
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (register editor actions while mounted)
- Create: `apps/admin/test/editor-commands.test.tsx`

**Interfaces:**
- Consumes: `useRegisterCommands` (Task 1); the editor's local `onPublish`/`onUnpublish`/`onPreview`, `can`, `phase`, `composing`, `metadata`, `previewApi`.

- [ ] **Step 1: Register editor actions in EditorScreen**

Inside `EditorScreen`, after the handlers are defined, add (icons from lucide):

```tsx
import { Rocket, Eye, ArchiveX } from 'lucide-react'
import { useRegisterCommands } from '../command/registry'
// …inside the component, after onPublish/onUnpublish/onPreview exist:
useRegisterCommands([
  { id: 'editor.publish', title: 'Publish', group: 'Editor', icon: Rocket,
    enabled: () => can('content.publish') && phase === 'ready' && !composing, run: () => onPublish() },
  { id: 'editor.preview', title: 'Preview draft', group: 'Editor', icon: Eye,
    enabled: () => Boolean(previewApi) && !composing, run: () => void onPreview() },
  { id: 'editor.unpublish', title: 'Unpublish', group: 'Editor', icon: ArchiveX,
    enabled: () => can('content.unpublish') && phase === 'ready' && !composing && metadata['published'] !== false, run: () => onUnpublish() },
])
```
(`useRegisterCommands` registers once on mount; the `enabled`/`run` closures stay live via the registry's ref, so they see the current `phase`/`composing`/`metadata`. Auto-unregisters on navigate-away, so the Editor group only shows while editing. Place the call unconditionally — not inside the `phase==='loading'` early return path; if EditorScreen early-returns before this line, move the early returns below the hook or guard via `enabled` only.)

- [ ] **Step 2: Write the test**

`editor-commands.test.tsx` — render `EditorScreen` in its existing harness (which must include `CommandRegistryProvider` now) + a probe reading `useCommandRegistry().commands`. With a ready, non-composing entry and `content.publish` granted: assert a `Publish` command (group 'Editor') is registered and its `enabled()` is true; assert it's gated false when composing (render at `/edit/post/en/new`). Reuse the editor test harness; add `CommandRegistryProvider` to it.

- [ ] **Step 3: Run**

Run: `pnpm --filter @setu/admin test -- editor-commands editor-screen`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/editor/EditorScreen.tsx apps/admin/test/editor-commands.test.tsx
git commit -m "feat(admin): editor registers Publish/Preview/Unpublish commands"
```

---

### Task 7: Full gate + editor-visible spot check

- [ ] **Step 1: Full gate**

Run from repo root: `pnpm typecheck && pnpm test && pnpm build`
Expected: ALL green (typecheck included). Note the admin test count.

- [ ] **Step 2: Manual spot check (optional, if dev server up)**

⌘K and ⌘⇧P open the palette anywhere; typing filters; Enter runs (nav jumps, theme flips, Deploy when permitted); inside an editor the Editor group (Publish/Preview) appears and works; leaving the editor removes them.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore(admin): command palette gate fixes"
```
(Skip if the gate was already green with no changes.)

---

## Self-Review

**Spec coverage:**
- Registry (provider + useRegisterCommands, ref-delegated to avoid stale closures/loops) → Task 1. ✓
- Theme util DRY extraction → Task 2. ✓
- Palette (CommandDialog + ⌘K/⌘⇧P keybinding + grouped + enabled-filtered + run-on-select) → Task 3. ✓
- Global actions (nav/create/deploy/theme, deploy gated) → Task 4. ✓
- Wiring (provider + AppShell mount) + integration → Task 5. ✓
- Editor context actions (Publish/Preview/Unpublish, gated, mount-scoped) → Task 6. ✓
- Group order Editor/Create/Go to/Site → Task 3 `GROUP_ORDER`. ✓
- Full gate → Task 7. ✓

**Placeholder scan:** No "TBD"/"add error handling". The `>`-notes (icon-name validity, CommandItem shape, editor early-return placement) flag real-code checks the implementer resolves against the repo — concrete, not skipped work.

**Type consistency:** `CommandAction` shape identical across Tasks 1/3/4/6. `useRegisterCommands(actions)` (no deps param — ref-delegated) used the same way in 4 and 6. `useCommandRegistry(): { register, commands }` consumed by palette (3) + tests. `toggleTheme()/currentTheme()` (Task 2) consumed by GlobalCommands (4). Keybinding spec identical in constraints + Task 3.
