# Admin Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin dashboard on the shadcn foundation — work-first (Resume editing) over a site-health strip — as the first visibly-redesigned surface.

**Architecture:** Replace the 7 ad-hoc `dash-*`-CSS widgets with focused components built on `@/components/ui` primitives + tokens. Reuse the existing data layer (`dashboard/entries.ts`) untouched. Restrained `motion` for a one-time staggered entrance; `Skeleton` for loading. No new data.

**Tech Stack:** React 19, shadcn/ui (Card, Badge, Avatar, Skeleton, Button), `motion/react`, react-router-dom 6, Tailwind v4 tokens, Vitest + Testing Library.

## Global Constraints

- Branch off `admin-shadcn-foundation` (this is `dashboard-redesign`); needs the standard tokens + primitives.
- Use ONLY `@/components/ui/*` primitives + standard token utilities (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`, `bg-primary`, Badge `variant`). No new bespoke CSS classes, no new custom token names (per `docs/admin-ui-conventions.md`).
- Status → Badge variant: `draft`→`warning`, `staged`→`info`, `live`→`success`, `unpublished`→`secondary`.
- Routes: edit = `/edit/{collection}/{locale}/{slug}`; new post = `/edit/post/en/new`; new page = `/edit/page/en/new`; drafts filter = `/posts?status=draft`.
- No invented data: `ContentRow` has `{ref{collection,locale,slug}, title, locale, lifecycle, updatedAt, hasDraft, tags, categories, mediaRefs}` — **no author**. `Actor` is `{id, role}` — **no name** (greeting is time-of-day only).
- Deploy action is header-only (gated by `useCan('site.deploy')`); not duplicated in the site card.
- Motion respects `prefers-reduced-motion` (via `useReducedMotion`); the entrance animation is the only motion.
- Verification per task: `pnpm --filter @setu/admin typecheck` + `pnpm --filter @setu/admin test <file>` green.

---

### Task 1: Pure helpers — status badge, greeting, relative time (+ matchMedia test polyfill)

**Files:**
- Create: `apps/admin/src/dashboard/status-badge.ts`
- Create: `apps/admin/src/dashboard/format.ts`
- Modify: `apps/admin/test/setup.ts` (add `matchMedia` stub — `motion`'s `useReducedMotion` needs it)
- Test: `apps/admin/test/dashboard-helpers.test.ts`

**Interfaces:**
- Consumes: `lifecycleLabel` from `../lifecycle/label`; `Lifecycle` from `@setu/core`.
- Produces:
  - `statusBadge(lc: Lifecycle): { label: string; variant: 'warning'|'info'|'success'|'secondary' }`
  - `greeting(now?: Date): string` → "Good morning"|"Good afternoon"|"Good evening"
  - `relativeTime(updatedAt: number | null, now?: number): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/test/dashboard-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { statusBadge } from '../src/dashboard/status-badge'
import { greeting, relativeTime } from '../src/dashboard/format'

describe('statusBadge', () => {
  it('maps lifecycle states to badge variants + labels', () => {
    expect(statusBadge({ state: 'draft' })).toEqual({ label: 'Draft', variant: 'warning' })
    expect(statusBadge({ state: 'staged' })).toEqual({ label: 'Staged', variant: 'info' })
    expect(statusBadge({ state: 'live' })).toEqual({ label: 'Live', variant: 'success' })
    expect(statusBadge({ state: 'unpublished' })).toEqual({ label: 'Unpublished', variant: 'secondary' })
  })
})

describe('greeting', () => {
  it('is time-of-day based', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening')
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000_000
  it('formats recent edits', () => {
    expect(relativeTime(null)).toBe('—')
    expect(relativeTime(now, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test dashboard-helpers`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `status-badge.ts`**

```ts
import type { Lifecycle } from '@setu/core'
import { lifecycleLabel } from '../lifecycle/label'

export type StatusVariant = 'warning' | 'info' | 'success' | 'secondary'

const STATE_VARIANT: Record<Lifecycle['state'], StatusVariant> = {
  draft: 'warning',
  staged: 'info',
  live: 'success',
  unpublished: 'secondary',
}

export function statusBadge(lc: Lifecycle): { label: string; variant: StatusVariant } {
  return { label: lifecycleLabel(lc).label, variant: STATE_VARIANT[lc.state] }
}
```

- [ ] **Step 4: Implement `format.ts`**

```ts
export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function relativeTime(updatedAt: number | null, now: number = Date.now()): string {
  if (updatedAt === null) return '—'
  const mins = Math.max(0, Math.round((now - updatedAt) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
```

- [ ] **Step 5: Add the `matchMedia` stub to `test/setup.ts`**

Append to `apps/admin/test/setup.ts`:
```ts
// jsdom does not implement window.matchMedia — motion's useReducedMotion needs it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
```

- [ ] **Step 6: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test dashboard-helpers && pnpm --filter @setu/admin typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/dashboard/status-badge.ts apps/admin/src/dashboard/format.ts apps/admin/test/setup.ts apps/admin/test/dashboard-helpers.test.ts
git commit -m "feat(admin): dashboard helpers (status badge, greeting, relative time) + matchMedia test stub"
```

---

### Task 2: ResumeEditing widget (replaces RecentEdits)

**Files:**
- Create: `apps/admin/src/dashboard/widgets/ResumeEditing.tsx`
- Test: `apps/admin/test/resume-editing.test.tsx`
- (The old `RecentEdits.tsx` + `recent-edits.test.tsx` stay until Task 7, so the package stays green.)

**Interfaces:**
- Consumes: `statusBadge`, `relativeTime` (Task 1); `Card`/`CardHeader`/`CardTitle`/`CardContent` from `@/components/ui/card`; `Badge` from `@/components/ui/badge`; `ContentRow` from `@setu/core`.
- Produces: `<ResumeEditing rows={ContentRow[]} />`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/resume-editing.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { ResumeEditing } from '../src/dashboard/widgets/ResumeEditing'

function row(over: Partial<ContentRow> = {}): ContentRow {
  return {
    ref: { collection: 'post', locale: 'en', slug: 'hello' },
    title: 'Hello world', locale: 'en', lifecycle: { state: 'draft' },
    updatedAt: Date.now(), hasDraft: true, tags: [], categories: [], mediaRefs: [],
    ...over,
  }
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ResumeEditing', () => {
  it('renders a row with title, collection and a status badge', () => {
    wrap(<ResumeEditing rows={[row()]} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('post')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
  it('links each row to its editor route', () => {
    wrap(<ResumeEditing rows={[row()]} />)
    expect(screen.getByRole('link', { name: /Hello world/ })).toHaveAttribute('href', '/edit/post/en/hello')
  })
  it('maps live state to the success badge', () => {
    wrap(<ResumeEditing rows={[row({ lifecycle: { state: 'live' } })]} />)
    expect(screen.getByText('Live').className).toContain('bg-success')
  })
  it('shows an empty state with a create link when there are no rows', () => {
    wrap(<ResumeEditing rows={[]} />)
    expect(screen.getByText(/No edits yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first post/ })).toHaveAttribute('href', '/edit/post/en/new')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test resume-editing`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ResumeEditing.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import type { ContentRow } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '../status-badge'
import { relativeTime } from '../format'

export function ResumeEditing({ rows }: { rows: ContentRow[] }) {
  const reduce = useReducedMotion()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Resume editing</CardTitle>
        <Link to="/posts" className="text-sm text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No edits yet — <Link to="/edit/post/en/new" className="text-primary hover:underline">create your first post</Link>.
          </p>
        ) : (
          <ul>
            {rows.map((r, i) => {
              const s = statusBadge(r.lifecycle)
              return (
                <motion.li
                  key={`${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: reduce ? 0 : i * 0.04 }}
                  className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
                >
                  <Link to={`/edit/${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`} className="group min-w-0">
                    <span className="block truncate text-sm font-medium group-hover:underline">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="mr-2 rounded border border-border px-1.5 py-0.5">{r.ref.collection}</span>
                      edited {relativeTime(r.updatedAt)}
                    </span>
                  </Link>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </motion.li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run — verify pass + full gate**

Run: `pnpm --filter @setu/admin test resume-editing && pnpm --filter @setu/admin typecheck`
Expected: PASS (4/4), typecheck clean. The old `RecentEdits` stays in place (still imported by `Dashboard.tsx`), so the whole package stays green; it's removed in Task 7 when `Dashboard.tsx` switches over.

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/dashboard/widgets/ResumeEditing.tsx apps/admin/test/resume-editing.test.tsx
git commit -m "feat(admin): add ResumeEditing widget on shadcn (RecentEdits removed in Task 7)"
```

---

### Task 3: StatTiles widget (replaces CountsTiles)

**Files:**
- Create: `apps/admin/src/dashboard/widgets/StatTiles.tsx`
- Test: `apps/admin/test/stat-tiles.test.tsx`
- (Old `CountsTiles.tsx` + `counts-tiles.test.tsx` stay until Task 7.)

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent` from `@/components/ui/card`; `Link`.
- Produces: `<StatTiles posts={number} pages={number} published={number} drafts={number} />`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/stat-tiles.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatTiles } from '../src/dashboard/widgets/StatTiles'

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('StatTiles', () => {
  it('renders the four counts', () => {
    wrap(<StatTiles posts={128} pages={14} published={9} drafts={5} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('128')
    expect(screen.getByText('Published').previousSibling).toHaveTextContent('9')
  })
  it('links Drafts to the filtered list', () => {
    wrap(<StatTiles posts={1} pages={1} published={1} drafts={5} />)
    expect(screen.getByRole('link', { name: /Drafts/ })).toHaveAttribute('href', '/posts?status=draft')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test stat-tiles`
Expected: FAIL.

- [ ] **Step 3: Implement `StatTiles.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function Stat({ value, label, emphasis }: { value: number; label: string; emphasis?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-medium ${emphasis ? 'text-warning' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function StatTiles({
  posts, pages, published, drafts,
}: { posts: number; pages: number; published: number; drafts: number }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">At a glance</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Stat value={posts} label="Posts" />
        <Stat value={pages} label="Pages" />
        <Stat value={published} label="Published" />
        <Link to="/posts?status=draft" className="rounded hover:bg-accent">
          <Stat value={drafts} label="Drafts" emphasis />
        </Link>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run — verify pass + full gate**

Run: `pnpm --filter @setu/admin test stat-tiles && pnpm --filter @setu/admin typecheck`
Expected: PASS (2/2), typecheck clean (old `CountsTiles` still present).

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/dashboard/widgets/StatTiles.tsx apps/admin/test/stat-tiles.test.tsx
git commit -m "feat(admin): add StatTiles widget with Drafts filter link (CountsTiles removed in Task 7)"
```

---

### Task 4: SiteDeployCard widget (replaces SiteStatusCard)

**Files:**
- Create: `apps/admin/src/dashboard/widgets/SiteDeployCard.tsx`
- Test: `apps/admin/test/site-deploy-card.test.tsx`
- (Old `SiteStatusCard.tsx` + `site-status-card.test.tsx` stay until Task 7.)

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent` from `@/components/ui/card`; `Button` from `@/components/ui/button`.
- Produces: `<SiteDeployCard url={string} deployedSha={string | null} />`. (Status only — no Deploy action.)

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/site-deploy-card.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteDeployCard } from '../src/dashboard/widgets/SiteDeployCard'

describe('SiteDeployCard', () => {
  it('shows the url and deployed sha', () => {
    render(<SiteDeployCard url="https://maya.setu.site" deployedSha="a1b2c3d4e5" />)
    expect(screen.getByText('maya.setu.site')).toBeInTheDocument()
    expect(screen.getByText(/a1b2c3d/)).toBeInTheDocument()
  })
  it('says not deployed when there is no sha', () => {
    render(<SiteDeployCard url="https://maya.setu.site" deployedSha={null} />)
    expect(screen.getByText(/Not deployed/)).toBeInTheDocument()
  })
  it('links View site to the url', () => {
    render(<SiteDeployCard url="https://maya.setu.site" deployedSha={null} />)
    expect(screen.getByRole('link', { name: /View site/ })).toHaveAttribute('href', 'https://maya.setu.site')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test site-deploy-card`
Expected: FAIL.

- [ ] **Step 3: Implement `SiteDeployCard.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

export function SiteDeployCard({ url, deployedSha }: { url: string; deployedSha: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Site &amp; deploy</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm hover:underline">{hostOf(url)}</a>
        <p className="text-xs text-muted-foreground">
          {deployedSha === null ? 'Not deployed yet' : <>Deployed · <span className="font-mono">{deployedSha.slice(0, 7)}</span></>}
        </p>
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">View site</a>
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run — verify pass + full gate**

Run: `pnpm --filter @setu/admin test site-deploy-card && pnpm --filter @setu/admin typecheck`
Expected: PASS (3/3), typecheck clean (old `SiteStatusCard` still present).

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/dashboard/widgets/SiteDeployCard.tsx apps/admin/test/site-deploy-card.test.tsx
git commit -m "feat(admin): add SiteDeployCard widget (SiteStatusCard removed in Task 7; deploy moves to header)"
```

---

### Task 5: WhosEditing widget (shadcn rewrite)

**Files:**
- Rewrite: `apps/admin/src/dashboard/widgets/WhosEditing.tsx`
- Rewrite: `apps/admin/test/whos-editing.test.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`; `Avatar`/`AvatarFallback` from `@/components/ui/avatar`; `Lock` from `@setu/core`.
- Produces: `<WhosEditing locks={Lock[]} />` — renders `null` when `locks` is empty.

- [ ] **Step 1: Write the failing test (replace contents)**

Replace `apps/admin/test/whos-editing.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Lock } from '@setu/core'
import { WhosEditing } from '../src/dashboard/widgets/WhosEditing'

const lock = (over: Partial<Lock> = {}): Lock =>
  ({ collection: 'page', locale: 'en', slug: 'about', lockedBy: 'arjun', lockedAt: 0, ...over } as Lock)

describe('WhosEditing', () => {
  it('renders nothing when no one is editing', () => {
    const { container } = render(<WhosEditing locks={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('lists the lock holder and what they hold', () => {
    render(<WhosEditing locks={[lock()]} />)
    expect(screen.getByText('arjun')).toBeInTheDocument()
    expect(screen.getByText(/about/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test whos-editing`
Expected: FAIL (old widget never returns null / shape differs).

- [ ] **Step 3: Rewrite `WhosEditing.tsx`**

```tsx
import type { Lock } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export function WhosEditing({ locks }: { locks: Lock[] }) {
  if (locks.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Who's editing</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {locks.map((l) => (
          <div key={`${l.collection}/${l.locale}/${l.slug}`} className="flex items-center gap-3">
            <Avatar className="size-7"><AvatarFallback className="text-xs">{initials(l.lockedBy)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <div className="text-sm font-medium">{l.lockedBy}</div>
              <div className="truncate text-xs text-muted-foreground">editing “{l.slug}”</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @setu/admin test whos-editing`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/dashboard/widgets/WhosEditing.tsx apps/admin/test/whos-editing.test.tsx
git commit -m "feat(admin): WhosEditing widget on shadcn (Avatar; renders only when locks exist)"
```

---

### Task 6: GettingStarted widget (shadcn rewrite, conditional)

**Files:**
- Rewrite: `apps/admin/src/dashboard/widgets/GettingStarted.tsx`
- Rewrite: `apps/admin/test/getting-started.test.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`; `useDismissed` from `../use-dismissed`; lucide `Check`/`Circle`.
- Produces: `<GettingStarted hasSiteUrl hasPost hasDeployed />` — renders `null` when `(hasSiteUrl && hasPost && hasDeployed)` OR dismissed.

- [ ] **Step 1: Write the failing test (replace contents)**

Replace `apps/admin/test/getting-started.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GettingStarted } from '../src/dashboard/widgets/GettingStarted'

describe('GettingStarted', () => {
  it('renders the checklist on a fresh site', () => {
    render(<GettingStarted hasSiteUrl={false} hasPost={false} hasDeployed={false} />)
    expect(screen.getByText('Getting started')).toBeInTheDocument()
    expect(screen.getByText('Create your first post')).toBeInTheDocument()
  })
  it('renders nothing once everything is done', () => {
    const { container } = render(<GettingStarted hasSiteUrl hasPost hasDeployed />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test getting-started`
Expected: FAIL (old widget shows even when complete).

- [ ] **Step 3: Rewrite `GettingStarted.tsx`**

```tsx
import { Check, Circle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDismissed } from '../use-dismissed'

function Item({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {done
        ? <Check className="size-4 text-success" aria-hidden />
        : <Circle className="size-4 text-muted-foreground" aria-hidden />}
      <span className={done ? 'text-muted-foreground line-through' : ''}>{label}</span>
    </li>
  )
}

export function GettingStarted({
  hasSiteUrl, hasPost, hasDeployed,
}: { hasSiteUrl: boolean; hasPost: boolean; hasDeployed: boolean }) {
  const { dismissed, dismiss } = useDismissed('getting-started')
  if (dismissed || (hasSiteUrl && hasPost && hasDeployed)) return null
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Getting started</CardTitle>
        <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss getting started">Dismiss</Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          <Item done={hasSiteUrl} label="Set your site URL" />
          <Item done={hasPost} label="Create your first post" />
          <Item done={hasDeployed} label="Deploy your site" />
        </ul>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @setu/admin test getting-started`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/dashboard/widgets/GettingStarted.tsx apps/admin/test/getting-started.test.tsx
git commit -m "feat(admin): GettingStarted widget on shadcn (auto-hides when onboarding complete)"
```

---

### Task 7: Dashboard orchestration + skeleton + cleanup

**Files:**
- Create: `apps/admin/src/dashboard/DashboardSkeleton.tsx`
- Rewrite: `apps/admin/src/screens/Dashboard.tsx`
- Delete (all superseded widgets + their old tests): `RecentEdits.tsx`, `CountsTiles.tsx`, `SiteStatusCard.tsx`, `TipsDeck.tsx`, `QuickActions.tsx` and `recent-edits.test.tsx`, `counts-tiles.test.tsx`, `site-status-card.test.tsx`, `tips-deck.test.tsx`, `quick-actions.test.tsx`
- Rewrite: `apps/admin/test/dashboard.test.tsx`
- Modify: `apps/admin/src/index.css` (drop `dashboard.css` import if now unused) and delete `apps/admin/src/styles/dashboard.css` if unused

**Interfaces:**
- Consumes: every widget from Tasks 2–6; `greeting` (Task 1); `PageHeader`; `Button`; `useServices`, `useDeploy`, `useCan`, `siteUrl`; `loadDashboardEntries`/`dashboardCounts`/`recentEntries`/`loadActiveLocks` from `../dashboard/entries`; `Skeleton`.
- Produces: the `/dashboard` route screen.

- [ ] **Step 1: Implement `DashboardSkeleton.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { ContentRow, Lock } from '@setu/core'
import { useServices } from '../data/store'
import { useDeploy } from '../deploy/deploy'
import { useCan } from '../auth/actor'
import { siteUrl } from '../shell/site-url'
import { PageHeader } from '../shell/PageHeader'
import { Button } from '@/components/ui/button'
import { loadDashboardEntries, dashboardCounts, recentEntries, loadActiveLocks } from '../dashboard/entries'
import { greeting } from '../dashboard/format'
import { DashboardSkeleton } from '../dashboard/DashboardSkeleton'
import { ResumeEditing } from '../dashboard/widgets/ResumeEditing'
import { StatTiles } from '../dashboard/widgets/StatTiles'
import { SiteDeployCard } from '../dashboard/widgets/SiteDeployCard'
import { WhosEditing } from '../dashboard/widgets/WhosEditing'
import { GettingStarted } from '../dashboard/widgets/GettingStarted'

function HeaderActions() {
  const can = useCan()
  const { deploy } = useDeploy()
  const [busy, setBusy] = useState(false)
  const onDeploy = () => { setBusy(true); void deploy().finally(() => setBusy(false)) }
  return (
    <div className="flex items-center gap-2">
      <Button asChild><Link to="/edit/post/en/new"><Plus className="size-4" />New post</Link></Button>
      <Button asChild variant="outline"><Link to="/edit/page/en/new">New page</Link></Button>
      {can('site.deploy') && (
        <Button variant="outline" disabled={busy} onClick={onDeploy}>{busy ? 'Deploying…' : 'Deploy'}</Button>
      )}
    </div>
  )
}

export function Dashboard() {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [locks, setLocks] = useState<Lock[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      setError(false)
      try {
        const loaded = await loadDashboardEntries(data, git, deployedAt)
        if (!live) return
        setRows(loaded)
        setLocks(await loadActiveLocks(data, loaded))
      } catch {
        if (live) setError(true)
      }
    })()
    return () => { live = false }
  }, [data, git, deployedAt, deploySha])

  const counts = dashboardCounts(rows ?? [])
  const hasContent = counts.posts + counts.pages > 0
  const hasDeployed = deploySha !== null
  const url = siteUrl()

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${greeting()} — here's your site at a glance.`} actions={<HeaderActions />} />
      <div className="page-body space-y-5">
        {error && <p className="text-sm text-destructive">Couldn't load your dashboard. Try refreshing.</p>}
        {rows === null && !error ? (
          <DashboardSkeleton />
        ) : (
          <>
            <GettingStarted hasSiteUrl={url !== ''} hasPost={counts.posts > 0} hasDeployed={hasDeployed} />
            <ResumeEditing rows={recentEntries(rows ?? [], 5)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTiles posts={counts.posts} pages={counts.pages} published={counts.published} drafts={counts.drafts} />
              <SiteDeployCard url={url} deployedSha={deploySha} />
              <WhosEditing locks={locks} />
            </div>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Delete all superseded widgets + their old tests**

Only now that `Dashboard.tsx` no longer imports them:
```bash
git rm \
  apps/admin/src/dashboard/widgets/RecentEdits.tsx apps/admin/test/recent-edits.test.tsx \
  apps/admin/src/dashboard/widgets/CountsTiles.tsx apps/admin/test/counts-tiles.test.tsx \
  apps/admin/src/dashboard/widgets/SiteStatusCard.tsx apps/admin/test/site-status-card.test.tsx \
  apps/admin/src/dashboard/widgets/TipsDeck.tsx apps/admin/test/tips-deck.test.tsx \
  apps/admin/src/dashboard/widgets/QuickActions.tsx apps/admin/test/quick-actions.test.tsx
```

- [ ] **Step 4: Rewrite `dashboard.test.tsx`**

Replace `apps/admin/test/dashboard.test.tsx` with a render smoke that matches the new screen. First inspect the old file's provider/mock setup (`cat apps/admin/test/dashboard.test.tsx`) and reuse its harness (it already mounts the data/services providers). Keep its existing provider wrapper; replace the assertions with:
```tsx
// keep the file's existing imports + provider render helper (renderDashboard or similar)
it('shows the greeting and header actions', async () => {
  renderDashboard() // existing helper from the old test
  expect(await screen.findByText(/here's your site at a glance/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /New post/ })).toHaveAttribute('href', '/edit/post/en/new')
  expect(screen.getByRole('link', { name: /New page/ })).toHaveAttribute('href', '/edit/page/en/new')
})
```
If the old test had no reusable helper, wrap with the same providers the old test used (it previously rendered `<Dashboard/>` successfully, so copy that exact wrapper). Do NOT introduce new mocking patterns.

- [ ] **Step 5: Remove the now-unused dashboard stylesheet**

Run: `grep -rn "dash-\|className=\"[^\"]*\\bdash\\b" apps/admin/src` to find remaining `dash-*` / `dash` class users.
- If ZERO matches: remove the `@import './styles/dashboard.css';` line from `apps/admin/src/index.css` and `git rm apps/admin/src/styles/dashboard.css`.
- If matches remain (a class defined in `dashboard.css` still used by a non-dashboard file): leave `dashboard.css` and its import in place, and note which class/file in the commit message.

- [ ] **Step 6: Cumulative gate — typecheck + full suite + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green. This is the first point the whole package typechecks again (Dashboard.tsx no longer imports deleted widgets). Fix any remaining import/type errors here.

- [ ] **Step 7: Commit**
```bash
git add -A apps/admin
git commit -m "feat(admin): rebuild Dashboard on shadcn — work-first layout, skeleton, header actions; remove TipsDeck/QuickActions + dash CSS"
```

---

## Self-Review

**Spec coverage:**
- §2 IA (header + greeting + actions; Resume editing hero; 3-card health strip; conditional Getting started; cut TipsDeck/QuickActions) → Tasks 1–7. ✓
- §3 component structure (each widget file + DashboardSkeleton + Dashboard orchestration; removed widgets) → Tasks 2–7. ✓
- §4 data flow (reuse entries.ts; status→variant; hasContent/hasDeployed; time-only greeting) → Task 1 (helpers) + Task 7 (wiring). ✓
- §5 polish (Skeleton, restrained motion + reduced-motion, empty states, error state) → Task 2 (motion + empty), Task 7 (skeleton + error). ✓
- §6 testing (per-widget tests + dashboard smoke) → every task. ✓
- §7 non-goals (no shell migration, no new data, single-site, keep notify) → honored (reuses PageHeader, entries.ts; no notify/Sonner change). ✓

**Placeholder scan:** none — every step has concrete code/commands. The dashboard.test rewrite (Task 7 Step 4) intentionally defers to the old file's provider harness rather than inventing one; the instruction names the exact command to inspect it.

**Type consistency:** `statusBadge`→`{label, variant}` (Task 1) consumed by ResumeEditing (Task 2); `StatusVariant` values match the Badge variants added in foundation Task 4 (`success`/`warning`/`info`) plus stock `secondary`; widget prop shapes (`ResumeEditing rows`, `StatTiles posts/pages/published/drafts`, `SiteDeployCard url/deployedSha`, `WhosEditing locks`, `GettingStarted hasSiteUrl/hasPost/hasDeployed`) are defined in their tasks and consumed identically in Dashboard.tsx (Task 7).

**Note on gating:** Tasks 1–6 each stay fully green — new widgets are additive (and the two in-place rewrites keep compatible prop shapes), so the old widgets keep `Dashboard.tsx` compiling. Task 7 is the integration step that rewires `Dashboard.tsx`, deletes all five superseded widgets + their old tests, and runs the cumulative typecheck/test/build gate. Every task ends with a green `typecheck`.
