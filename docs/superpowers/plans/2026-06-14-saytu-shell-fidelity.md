# Admin Shell Visual-Fidelity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin chrome match the Claude Design mockup — port the icon set + the real sidebar and content-list styling/markup — without re-Tailwinding and without building deferred interactive features.

**Architecture:** Port presentational primitives (`Icon`, `StatusPill`) + faithfully-ported CSS sections from `design/admin/` into `apps/admin`, and rebuild `Sidebar`/`ContentList` markup to the design's structure. Behavior is preserved (theme toggle, data flow); only presentation changes. Pixel-fidelity is a UAT check; tests cover behavior.

**Tech Stack:** React 18, Tailwind v4, the ported `tokens.css`; vitest + @testing-library/react + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-shell-fidelity-design.md`
**Design source of truth (in repo):** `design/admin/{components.jsx,components.css,shell.jsx,shell.css,screens-1.jsx,screens.css}`

**IMPORTANT for every task:** the app tsconfig extends the strict base → `verbatimModuleSyntax` is ON. Use `import type` for type-only imports; do NOT write `React.ReactNode` (use `import type { ReactNode } from 'react'`). `noUncheckedIndexedAccess` is ON.

---

### Task 1: `Icon` + `StatusPill` primitives + base CSS

**Files:** Create `apps/admin/src/ui/Icon.tsx`, `apps/admin/src/ui/StatusPill.tsx`, `apps/admin/src/styles/components.css`; Modify `apps/admin/src/index.css`; Test `apps/admin/test/icon.test.tsx`, `apps/admin/test/status-pill.test.tsx`

- [ ] **Step 1: Write the failing tests**

`apps/admin/test/icon.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon } from '../src/ui/Icon'

describe('Icon', () => {
  it('renders an svg for a known icon name', () => {
    const { container } = render(<Icon name="dashboard" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.innerHTML.length).toBeGreaterThan(0) // has path markup
  })

  it('renders nothing for an unknown name', () => {
    // @ts-expect-error — exercising the runtime guard for an invalid name
    const { container } = render(<Icon name="not-an-icon" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
```

`apps/admin/test/status-pill.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from '../src/ui/StatusPill'

describe('StatusPill', () => {
  it('renders a known status with its toned class', () => {
    const { container } = render(<StatusPill status="published" />)
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(container.querySelector('.badge-green')).not.toBeNull()
  })

  it('renders an unknown status as a neutral pill with the raw label', () => {
    const { container } = render(<StatusPill status="weird" />)
    expect(screen.getByText('weird')).toBeInTheDocument()
    expect(container.querySelector('.badge-neutral')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`Icon`/`StatusPill` missing). `pnpm --filter @setu/admin test -- icon status-pill`

- [ ] **Step 3: Implement `Icon`** — Create `apps/admin/src/ui/Icon.tsx`.

Copy the `ICONS` object **verbatim** from `design/admin/components.jsx` (the `const ICONS = { … }` block, ~70 entries) into this file, adding `as const`. Then add the typed component:
```tsx
const ICONS = {
  // ⬇️ paste the ENTIRE ICONS object verbatim from design/admin/components.jsx here
  // (dashboard, post, pages, image, forms, globe, settings, search, plus, lock,
  //  sparkle, check, x, sun, moon, chevDown, layers, tag, clock, trash, … ~70)
} as const

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 18,
  stroke = 1.75,
  className = '',
}: {
  name: IconName
  size?: number
  stroke?: number
  className?: string
}) {
  const d = ICONS[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      // The ICONS set is a static, trusted, in-repo design asset (never user
      // input), so injecting the SVG inner markup is safe — same as the design.
      dangerouslySetInnerHTML={{ __html: d }}
      aria-hidden="true"
    />
  )
}
```
(The runtime `if (!d) return null` guard handles the test's `@ts-expect-error` unknown-name case.)

- [ ] **Step 4: Implement `StatusPill`** — Create `apps/admin/src/ui/StatusPill.tsx`:
```tsx
type Tone = 'neutral' | 'amber' | 'green' | 'blue' | 'red' | 'accent'

// Maps a draft's `metadata.status` to a toned label. Mirrors the design's
// STATUS_MAP but keyed on the lowercase values our drafts actually carry
// (draft/published/staged/deployed/…), with a neutral fallback for anything else.
const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  published: { tone: 'green', label: 'Published' },
  staged: { tone: 'amber', label: 'Staged' },
  deployed: { tone: 'green', label: 'Deployed' },
  building: { tone: 'blue', label: 'Building' },
  failed: { tone: 'red', label: 'Failed' },
  scheduled: { tone: 'accent', label: 'Scheduled' },
}

export function StatusPill({ status }: { status: string }) {
  const known = STATUS_TONE[status.toLowerCase()]
  const tone: Tone = known ? known.tone : 'neutral'
  const label = known ? known.label : status
  return (
    <span className={`badge badge-${tone} badge-soft pill-sm`}>
      <span className="badge-dot" />
      {label}
    </span>
  )
}
```

- [ ] **Step 5: Port the base component CSS** — Create `apps/admin/src/styles/components.css` by porting from `design/admin/components.css` the rules for: the icon-bearing primitives we use now — **`.badge` / `.badge-soft` / `.badge-<tone>` / `.badge-dot` / `.pill-sm`** (the StatusPill), and the **`.btn` / `.btn-*`** button rules (used by the content-list "New" action in Task 3). Read `design/admin/components.css`, copy those rule blocks verbatim (they reference `tokens.css` vars), and OMIT rules for primitives not used yet (inputs, prochip, prolock, empty-art, etc.) to avoid dead CSS for unbuilt features. If a tone color var referenced isn't in `tokens.css`, use the nearest token present (note it).

Then import it in `apps/admin/src/index.css` — add after the tokens import, before shell:
```css
@import './styles/components.css';
```
(Order: `tailwindcss` → `tokens.css` → `components.css` → `shell.css`.)

- [ ] **Step 6: Run tests (PASS) + typecheck**

```bash
pnpm --filter @setu/admin test -- icon status-pill
pnpm --filter @setu/admin typecheck
```
Expected: 4 new tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): port Icon set + StatusPill primitives + base component CSS"
```

---

### Task 2: Sidebar visual fidelity (icons + workspace header)

**Files:** Modify `apps/admin/src/shell/Sidebar.tsx`, `apps/admin/src/styles/shell.css`; Test `apps/admin/test/sidebar.test.tsx`

- [ ] **Step 1: Extend the failing Sidebar test** — Update `apps/admin/test/sidebar.test.tsx` to add icon + workspace assertions (keep the existing nav-label + theme-toggle tests):
```tsx
  it('renders an icon for every nav item', () => {
    renderSidebar()
    for (const label of ['Dashboard', 'Posts', 'Pages', 'Media', 'Forms', 'Site', 'Settings']) {
      const link = screen.getByRole('link', { name: new RegExp(label, 'i') })
      expect(link.querySelector('svg')).not.toBeNull()
    }
  })

  it('shows the workspace name', () => {
    renderSidebar()
    expect(screen.getByText('Saytu')).toBeInTheDocument()
  })
```
(Note: the existing `getByRole('link', { name: 'Posts' })` assertions may need the `name` matcher relaxed to a regex if the accessible name now includes icon context — adjust those existing assertions to `name: /Posts/` etc. if needed so they still pass.)

- [ ] **Step 2: Run — expect FAIL** (no icons yet). `pnpm --filter @setu/admin test -- sidebar`

- [ ] **Step 3: Rebuild the Sidebar markup** — Replace `apps/admin/src/shell/Sidebar.tsx`:
```tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

interface NavItem {
  to: string
  label: string
  icon: IconName
}
interface NavGroup {
  group: string
  items: NavItem[]
}

// PRD §24 information architecture, with the design's icons.
const NAV: NavGroup[] = [
  { group: '', items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'Content',
    items: [
      { to: '/posts', label: 'Posts', icon: 'post' },
      { to: '/pages', label: 'Pages', icon: 'pages' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { to: '/media', label: 'Media', icon: 'image' },
      { to: '/forms', label: 'Forms', icon: 'forms' },
      { to: '/site', label: 'Site', icon: 'globe' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

function getTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function Sidebar() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getTheme)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('saytu-theme', next)
    } catch {
      // ignore (e.g. private mode)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="ws">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width={28} height={28} fill="none">
              <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
              <path
                d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
                stroke="var(--on-accent)"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="ws-meta">
            <span className="ws-name">Saytu</span>
            <span className="ws-sub">Local workspace</span>
          </span>
          <Icon name="chevDown" size={14} className="ws-chev" />
        </div>
      </div>

      <nav className="nav" aria-label="Primary">
        {NAV.map((g, i) => (
          <div className="nav-group-block" key={g.group || `g${i}`}>
            {g.group && <div className="nav-group">{g.group}</div>}
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}
              >
                <Icon name={item.icon} size={18} />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}
```
(Deferred vs the design — do NOT add: the collapse button, the ⌘K search button, the topology indicator, the user chip, `Tip` tooltips. Those are later increments. `ws-sub` is a neutral placeholder.)

- [ ] **Step 4: Port the sidebar CSS** — In `apps/admin/src/styles/shell.css`, REPLACE the current `.sidebar*`/`.nav*`/`.theme-toggle` rules with a faithful port of the **sidebar section** of `design/admin/shell.css`. Read `design/admin/shell.css` and copy the rule blocks for: `.sidebar`, `.sidebar-top`, `.ws`, `.ws-meta`, `.ws-name`, `.ws-sub`, `.ws-chev`, `.logo-mark`, `.nav`, `.nav-group`, `.nav-item`, `.nav-item.on`, `.nav-item:hover`, `.nav-label`, `.sidebar-bottom`, `.theme-toggle` (and any sub-rules they need). Keep the existing `.app` and `.main` layout rules (and the `.content-table`/`.placeholder`/`.empty-state` rules — Task 3 revisits content-list). OMIT rules for the deferred bits (`.search-btn`, `.sidebar-collapse`, `.topology`, `.userchip`, `.is-collapsed` rail). If a referenced token var isn't in `tokens.css`, use the nearest present token (note adjustments).

- [ ] **Step 5: Run tests (PASS) + typecheck**

```bash
pnpm --filter @setu/admin test -- sidebar
pnpm --filter @setu/admin typecheck
```
Expected: sidebar tests (nav labels, icons, workspace name, theme toggle) pass; typecheck clean. If the existing `getByRole('link', {name:'Posts'})` assertions broke because the accessible name changed, relax them to regex (`name: /Posts/`).

- [ ] **Step 6: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): sidebar fidelity — icons, workspace header, ported shell CSS"
```

---

### Task 3: Content-list visual fidelity (PageHeader + ctable + StatusPill)

**Files:** Create `apps/admin/src/shell/PageHeader.tsx`; Modify `apps/admin/src/screens/ContentList.tsx`, `apps/admin/src/styles/shell.css`; Test `apps/admin/test/content-list.test.tsx`

- [ ] **Step 1: Extend the failing content-list test** — Update `apps/admin/test/content-list.test.tsx`: keep the existing rows/filter/empty tests; the status assertions now go through StatusPill (the label is title-cased). Change the status assertion in the first test from `getByText('published')` to `getByText('Published')` (StatusPill renders the title-cased label). Add a header test:
```tsx
  it('renders a page header with the title and an entry count', async () => {
    renderList(createMemoryDataPort(seed), 'post', 'Posts')
    expect(await screen.findByRole('heading', { name: 'Posts' })).toBeInTheDocument()
    // 2 posts in the seed
    expect(screen.getByText('2')).toBeInTheDocument()
  })
```
(Keep the empty-state test as `findByText(/no posts yet/i)`.)

- [ ] **Step 2: Run — expect FAIL** (PageHeader + StatusPill not wired). `pnpm --filter @setu/admin test -- content-list`

- [ ] **Step 3: Implement a simplified PageHeader** — Create `apps/admin/src/shell/PageHeader.tsx`:
```tsx
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string
  count?: number
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1 className="page-title">
          {title}
          {count !== undefined && <span className="page-count">{count}</span>}
        </h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}
```
(Deferred vs the design's PageHeader: tabs + search — later, with the content-management increment.)

- [ ] **Step 4: Rebuild ContentList** — Replace `apps/admin/src/screens/ContentList.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draft } from '@setu/core'
import { useData } from '../data/store'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const data = useData()
  const [drafts, setDrafts] = useState<Draft[] | null>(null)

  useEffect(() => {
    let live = true
    void data.listDrafts({ collection }).then((d) => {
      if (live) setDrafts(d)
    })
    return () => {
      live = false
    }
  }, [data, collection])

  const noun = title.toLowerCase().replace(/s$/, '')

  return (
    <>
      <PageHeader
        title={title}
        count={drafts?.length}
        subtitle={collection === 'post' ? 'Articles, notes and announcements.' : 'Standalone pages.'}
        actions={
          <Link to={`/edit/${collection}/en/new`} className="btn btn-primary btn-md">
            <Icon name="plus" size={16} />
            <span>New {noun}</span>
          </Link>
        }
      />
      <div className="page-body">
        {drafts === null ? (
          <p className="empty-state">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="empty-state">No {title.toLowerCase()} yet.</p>
        ) : (
          <table className="ctable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Locale</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={`${d.collection}/${d.locale}/${d.slug}`}>
                  <td className="ctable-title">
                    <Link to={`/edit/${d.collection}/${d.locale}/${d.slug}`}>
                      {String(d.metadata.title ?? d.slug)}
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={String(d.metadata.status ?? 'draft')} />
                  </td>
                  <td className="ctable-muted">{d.locale}</td>
                  <td className="ctable-muted">{new Date(d.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
```
(Deferred vs the design's list: tabs, search, bulk-select, row menus, the filter button — later. The "New" button links to a `/edit/.../new` route that currently hits the editor placeholder.)

- [ ] **Step 5: Port the content-list CSS** — In `apps/admin/src/styles/shell.css`, add a faithful port of the **page-header + content-table** rules from `design/admin/screens.css`: read it and copy the rule blocks for `.page-header`, `.page-title`, `.page-count`, `.page-subtitle`, `.page-actions`, `.page-body`, `.ctable`, `.ctable th/td`, `.ctable tr:hover`, `.ctable-title`, `.ctable-muted` (map the design's actual class names — they may differ slightly; match what the markup above uses, adding small bridging rules if a design class name differs). Remove the now-superseded basic `.content-table` rules from Task-#9. If token vars are missing, use nearest present (note it).

- [ ] **Step 6: Full verification + commit**

```bash
pnpm --filter @setu/admin test
pnpm --filter @setu/admin typecheck
pnpm --filter @setu/admin build     # confirm it builds + brand fonts still in dist/index.html
pnpm test && pnpm typecheck           # whole monorepo green
```
Expected: all admin tests pass (icon 2 + status-pill 2 + sidebar [4] + content-list [4] + smoke 2); db/core suites unaffected; typecheck clean; build succeeds.

```bash
git add apps/admin
git commit -m "feat(admin): content-list fidelity — PageHeader, ctable, status pills"
```

---

## Self-Review

**Spec coverage:**
- `Icon` (port ICONS + component, TS, null-on-unknown, dangerouslySetInnerHTML w/ safety note) → Task 1. ✓
- `StatusPill` (toned known statuses + neutral fallback) → Task 1. ✓
- Base `components.css` (badge/btn) ported, imported in order → Task 1. ✓
- Sidebar fidelity: workspace header + icon nav (§24 IA) + theme toggle; ported sidebar CSS; deferred collapse/⌘K/topology/userchip/tooltips → Task 2. ✓
- Content-list fidelity: PageHeader (title/count/subtitle/New) + ctable + StatusPill; ported page-header/ctable CSS; deferred tabs/search/bulk/menus → Task 3. ✓
- Behavior tests added (Icon, StatusPill, sidebar icons + ws name, content-list header + status pill); existing 7 stay green (with the noted assertion relaxations) → all tasks. ✓
- Fidelity = UAT; fonts/build preserved → Task 3 Step 6. ✓
- `verbatimModuleSyntax` (`import type` for ReactNode/IconName/Draft) → all tasks. ✓
- Deferred (command palette, toasts, tweaks, pro modals, list interactivity, other screens, editor) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO. The "paste ICONS verbatim from design/admin/components.jsx" and "port the named CSS rule blocks from design/admin/{shell,screens,components}.css" instructions are precise port-from-source directives against in-repo files (the design IS the detailed spec for a fidelity port) — each names the exact file + the exact rule blocks/classes, not vague "make it look right." The implementer matches design class names to the authored markup and notes any token/name adjustments.

**Type consistency:** `IconName = keyof typeof ICONS` (from `as const`); `Icon({name: IconName})` used in Sidebar's `NavItem.icon: IconName` (so nav icons are compile-checked to exist) and ContentList. `StatusPill({status: string})`. `PageHeader({title,count?,subtitle?,actions?: ReactNode})`. `ContentList({collection,title})` props unchanged from #9 (call sites in app.tsx still valid). `useData()`/`Draft` unchanged. CSS class names in the authored markup (`.sidebar`,`.ws`,`.nav-item`,`.ctable`,`.page-header`,`.badge-*`) are what the ported CSS must target — the plan flags matching them. ✓
