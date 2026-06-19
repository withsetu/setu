# Setu Admin Dashboard "Home" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard` placeholder with a real "home of the admin" screen — recent edits, quick actions, counts, a site/topology card, a first-run checklist, a static tips deck, and a who's-editing view — and make `/` land there.

**Architecture:** A thin container (`Dashboard.tsx`) loads data once via existing hooks (`useServices`, `useDeploy`) and a pure data module, then passes plain props to small presentational widgets. Each widget is independently unit-tested. Honest stubs for Sync and deploy-detail; media count and who's-editing are best-effort.

**Tech Stack:** React 18 + react-router-dom 6, TypeScript, Vitest + Testing Library (jsdom), `@setu/core` (content listing, locks), token-based custom CSS.

## Global Constraints

- **No network calls.** Tips are bundled static data; no remote fetch (local-first / privacy).
- **Cloudflare-Pages compatible:** pure client-side SPA code; no server-only APIs.
- **Match existing conventions:** semantic CSS classes + tokens (`styles/tokens.css`), reuse `Icon`, `StatusPill`, `PageHeader`, `siteUrl`, `lifecycleLabel`. Do **not** introduce Tailwind utilities or shadcn.
- **Honest states:** stubbed affordances (Sync, deploy detail) render visibly-disabled, never broken; best-effort data (media count, locks) renders neutral empty/`—`, never an error.
- **TDD:** every task writes the failing test first. Baseline before work: **213 tests passing (53 files)** — run `cd apps/admin && pnpm test`.
- **Types (verified from codebase):**
  - `ContentRow` (`@setu/core`): `{ ref: EntryRef; title: string; updatedAt: number | null; lifecycle: Lifecycle }`.
  - `EntryRef`: `{ collection: string; locale: string; slug: string }`.
  - `Lifecycle`: `{ state: 'draft' | 'staged' | 'live' | 'unpublished'; pending?: string }`.
  - `Lock` (`@setu/core`): `EntryRef & { lockedBy: string }`.
  - `listContentEntries({ drafts, committed, deployedAt }): ContentRow[]` where `committed: { ref: EntryRef; content: string }[]` and `deployedAt: (path: string) => string | null`.
  - `parseContentPath(path: string): EntryRef | null`.
  - `DataPort`: `listDrafts({ collection }): Promise<Draft[]>`, `getLock(ref): Promise<Lock | null>`.
  - `GitPort`: `list(prefix?): Promise<string[]>`, `readFile(path): Promise<string | null>`, `headSha(): Promise<string | null>`.
  - `useDeploy(): { deployedAt(path): string | null; sha: string | null; deploy(): Promise<void> }`.
  - `lifecycleLabel(lc: Lifecycle): { label: string; pending?: string }` (from `../lifecycle/label`).
  - `StatusPill({ status: string })`; `Icon({ name: IconName; size?: number })` — `name` MUST be an existing `IconName` (e.g. `plus`, `external`).
  - `siteUrl(ref?: EntryRef): string` (no-arg returns the site root).

---

### Task 1: Dashboard data module (pure loaders + derivations)

**Files:**
- Create: `apps/admin/src/dashboard/entries.ts`
- Test: `apps/admin/test/dashboard-entries.test.ts`

**Interfaces:**
- Consumes: `DataPort`, `GitPort`, `listContentEntries`, `parseContentPath` from `@setu/core`.
- Produces:
  - `loadDashboardEntries(data: DataPort, git: GitPort, deployedAt: (path: string) => string | null, collections?: string[]): Promise<ContentRow[]>` — merged across collections (default `['post', 'page']`), sorted by `updatedAt` desc (nulls last).
  - `dashboardCounts(rows: ContentRow[]): { posts: number; pages: number; drafts: number; published: number }` — `drafts` = rows whose `lifecycle.state === 'draft'`; `published` = state `staged` or `live`.
  - `recentEntries(rows: ContentRow[], limit: number): ContentRow[]` — first `limit` rows.
  - `loadActiveLocks(data: DataPort, rows: ContentRow[]): Promise<Lock[]>` — `getLock` per row, keep non-null.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/test/dashboard-entries.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { loadDashboardEntries, dashboardCounts, recentEntries, loadActiveLocks } from '../src/dashboard/entries'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'p1', content: doc('a'), metadata: { title: 'First Post', status: 'draft' } },
  { collection: 'post', locale: 'en', slug: 'p2', content: doc('b'), metadata: { title: 'Second Post', status: 'draft' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('c'), metadata: { title: 'About', status: 'draft' } },
]
const noDeploy = () => null

describe('dashboard entries', () => {
  it('loads entries across post + page collections', async () => {
    const rows = await loadDashboardEntries(createMemoryDataPort(seed), createMemoryGitPort(), noDeploy)
    expect(rows.map((r) => r.title).sort()).toEqual(['About', 'First Post', 'Second Post'])
  })

  it('counts by collection and lifecycle', async () => {
    const rows = await loadDashboardEntries(createMemoryDataPort(seed), createMemoryGitPort(), noDeploy)
    const c = dashboardCounts(rows)
    expect(c).toEqual({ posts: 2, pages: 1, drafts: 3, published: 0 })
  })

  it('recentEntries caps to the limit', async () => {
    const rows = await loadDashboardEntries(createMemoryDataPort(seed), createMemoryGitPort(), noDeploy)
    expect(recentEntries(rows, 2)).toHaveLength(2)
  })

  it('loadActiveLocks returns only locked entries', async () => {
    const data = createMemoryDataPort(seed)
    await data.putLock({ collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'sarah' })
    const rows = await loadDashboardEntries(data, createMemoryGitPort(), noDeploy)
    const locks = await loadActiveLocks(data, rows)
    expect(locks).toEqual([{ collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'sarah' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test dashboard-entries`
Expected: FAIL — `Failed to resolve import '../src/dashboard/entries'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/admin/src/dashboard/entries.ts
import type { ContentRow, DataPort, EntryRef, GitPort, Lock } from '@setu/core'
import { listContentEntries, parseContentPath } from '@setu/core'

const DEFAULT_COLLECTIONS = ['post', 'page']

export async function loadDashboardEntries(
  data: DataPort,
  git: GitPort,
  deployedAt: (path: string) => string | null,
  collections: string[] = DEFAULT_COLLECTIONS,
): Promise<ContentRow[]> {
  const all: ContentRow[] = []
  for (const collection of collections) {
    const drafts = await data.listDrafts({ collection })
    const committed: { ref: EntryRef; content: string }[] = []
    for (const p of await git.list(`content/${collection}/`)) {
      const ref = parseContentPath(p)
      if (ref === null) continue
      const content = await git.readFile(p)
      if (content !== null) committed.push({ ref, content })
    }
    all.push(...listContentEntries({ drafts, committed, deployedAt }))
  }
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function dashboardCounts(rows: ContentRow[]): {
  posts: number; pages: number; drafts: number; published: number
} {
  let posts = 0, pages = 0, drafts = 0, published = 0
  for (const r of rows) {
    if (r.ref.collection === 'post') posts++
    else if (r.ref.collection === 'page') pages++
    if (r.lifecycle.state === 'draft') drafts++
    else if (r.lifecycle.state === 'staged' || r.lifecycle.state === 'live') published++
  }
  return { posts, pages, drafts, published }
}

export function recentEntries(rows: ContentRow[], limit: number): ContentRow[] {
  return rows.slice(0, limit)
}

export async function loadActiveLocks(data: DataPort, rows: ContentRow[]): Promise<Lock[]> {
  const locks: Lock[] = []
  for (const r of rows) {
    const lock = await data.getLock(r.ref)
    if (lock !== null) locks.push(lock)
  }
  return locks
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test dashboard-entries`
Expected: PASS (4 tests). If `metadata.status` does not drive `lifecycle.state` (git is empty so all derive to `draft`), the counts test already assumes all-draft — consistent with the existing `content-list.test.tsx` note.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/entries.ts apps/admin/test/dashboard-entries.test.ts
git commit -m "feat(admin): dashboard data module — cross-collection entries, counts, locks"
```

---

### Task 2: localStorage dismiss hook

**Files:**
- Create: `apps/admin/src/dashboard/use-dismissed.ts`
- Test: `apps/admin/test/use-dismissed.test.tsx`

**Interfaces:**
- Produces: `useDismissed(key: string): { dismissed: boolean; dismiss: () => void }` — reads/writes `localStorage[`setu.dismissed.${key}`]`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/use-dismissed.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useDismissed } from '../src/dashboard/use-dismissed'

function Probe({ k }: { k: string }) {
  const { dismissed, dismiss } = useDismissed(k)
  return <button onClick={dismiss}>{dismissed ? 'gone' : 'visible'}</button>
}

describe('useDismissed', () => {
  beforeEach(() => localStorage.clear())

  it('starts visible and persists dismissal', () => {
    render(<Probe k="tips" />)
    expect(screen.getByRole('button')).toHaveTextContent('visible')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('gone')
    expect(localStorage.getItem('setu.dismissed.tips')).toBe('1')
  })

  it('reads an existing dismissed flag', () => {
    localStorage.setItem('setu.dismissed.tips', '1')
    render(<Probe k="tips" />)
    expect(screen.getByRole('button')).toHaveTextContent('gone')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test use-dismissed`
Expected: FAIL — cannot resolve `../src/dashboard/use-dismissed`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/admin/src/dashboard/use-dismissed.ts
import { useState } from 'react'

export function useDismissed(key: string): { dismissed: boolean; dismiss: () => void } {
  const storageKey = `setu.dismissed.${key}`
  const [dismissed, setDismissed] = useState<boolean>(() => localStorage.getItem(storageKey) === '1')
  const dismiss = () => {
    localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }
  return { dismissed, dismiss }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test use-dismissed`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/use-dismissed.ts apps/admin/test/use-dismissed.test.tsx
git commit -m "feat(admin): useDismissed — localStorage-backed dismissal"
```

---

### Task 3: QuickActions widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/QuickActions.tsx`
- Test: `apps/admin/test/quick-actions.test.tsx`

**Interfaces:**
- Produces: `QuickActions()` — renders `<Link>`s to `/edit/post/en/new` and `/edit/page/en/new`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/quick-actions.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuickActions } from '../src/dashboard/widgets/QuickActions'

describe('QuickActions', () => {
  it('links to the new-post and new-page editor routes', () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /new post/i })).toHaveAttribute('href', '/edit/post/en/new')
    expect(screen.getByRole('link', { name: /new page/i })).toHaveAttribute('href', '/edit/page/en/new')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test quick-actions`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/QuickActions.tsx
import { Link } from 'react-router-dom'
import { Icon } from '../../ui/Icon'

export function QuickActions() {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Quick actions</h2>
      <div className="dash-actions">
        <Link to="/edit/post/en/new" className="btn btn-primary btn-md">
          <Icon name="plus" size={16} />
          <span>New post</span>
        </Link>
        <Link to="/edit/page/en/new" className="btn btn-md">
          <Icon name="plus" size={16} />
          <span>New page</span>
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test quick-actions`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/QuickActions.tsx apps/admin/test/quick-actions.test.tsx
git commit -m "feat(admin): QuickActions dashboard widget"
```

---

### Task 4: CountsTiles widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/CountsTiles.tsx`
- Test: `apps/admin/test/counts-tiles.test.tsx`

**Interfaces:**
- Consumes: nothing (presentational).
- Produces: `CountsTiles({ posts, pages, drafts, media }: { posts: number; pages: number; drafts: number; media: number | null })` — renders four labeled tiles; media renders `—` when `null`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/counts-tiles.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CountsTiles } from '../src/dashboard/widgets/CountsTiles'

describe('CountsTiles', () => {
  it('renders counts and an em dash for unavailable media', () => {
    render(<CountsTiles posts={2} pages={1} drafts={3} media={null} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('2')
    expect(screen.getByText('Media').previousSibling).toHaveTextContent('—')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test counts-tiles`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/CountsTiles.tsx
function Tile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="dash-tile">
      <span className="dash-tile-value">{value}</span>
      <span className="dash-tile-label">{label}</span>
    </div>
  )
}

export function CountsTiles({
  posts, pages, drafts, media,
}: { posts: number; pages: number; drafts: number; media: number | null }) {
  return (
    <div className="dash-tiles">
      <Tile value={posts} label="Posts" />
      <Tile value={pages} label="Pages" />
      <Tile value={drafts} label="Drafts" />
      <Tile value={media ?? '—'} label="Media" />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test counts-tiles`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/CountsTiles.tsx apps/admin/test/counts-tiles.test.tsx
git commit -m "feat(admin): CountsTiles dashboard widget"
```

---

### Task 5: RecentEdits widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/RecentEdits.tsx`
- Test: `apps/admin/test/recent-edits.test.tsx`

**Interfaces:**
- Consumes: `ContentRow` from `@setu/core`; `lifecycleLabel`, `StatusPill`.
- Produces: `RecentEdits({ rows }: { rows: ContentRow[] })` — list of entries (title links to `/edit/<collection>/<locale>/<slug>`, status pill, updated date); empty state when `rows` is empty.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/recent-edits.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { RecentEdits } from '../src/dashboard/widgets/RecentEdits'

const row: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'p1' },
  title: 'First Post',
  updatedAt: 0,
  lifecycle: { state: 'draft' },
}

describe('RecentEdits', () => {
  it('links each entry to its editor route', () => {
    render(<MemoryRouter><RecentEdits rows={[row]} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /first post/i })).toHaveAttribute('href', '/edit/post/en/p1')
  })

  it('shows an empty state when there are no entries', () => {
    render(<MemoryRouter><RecentEdits rows={[]} /></MemoryRouter>)
    expect(screen.getByText(/nothing edited yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test recent-edits`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/RecentEdits.tsx
import { Link } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { lifecycleLabel } from '../../lifecycle/label'
import { StatusPill } from '../../ui/StatusPill'

export function RecentEdits({ rows }: { rows: ContentRow[] }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Recently edited</h2>
      {rows.length === 0 ? (
        <p className="empty-state">Nothing edited yet.</p>
      ) : (
        <ul className="dash-recent">
          {rows.map((row) => (
            <li key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`} className="dash-recent-row">
              <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>{row.title}</Link>
              <StatusPill status={lifecycleLabel(row.lifecycle).label} />
              <span className="ctable-muted">
                {row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test recent-edits`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/RecentEdits.tsx apps/admin/test/recent-edits.test.tsx
git commit -m "feat(admin): RecentEdits dashboard widget"
```

---

### Task 6: WhosEditing widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/WhosEditing.tsx`
- Test: `apps/admin/test/whos-editing.test.tsx`

**Interfaces:**
- Consumes: `Lock` from `@setu/core`.
- Produces: `WhosEditing({ locks }: { locks: Lock[] })` — one row per lock (`<slug> · 🔒 <lockedBy>`); neutral empty state otherwise.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/whos-editing.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhosEditing } from '../src/dashboard/widgets/WhosEditing'

describe('WhosEditing', () => {
  it('lists each locked entry and its holder', () => {
    render(<WhosEditing locks={[{ collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'sarah' }]} />)
    expect(screen.getByText(/p1/)).toBeInTheDocument()
    expect(screen.getByText(/sarah/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is being edited', () => {
    render(<WhosEditing locks={[]} />)
    expect(screen.getByText(/no one is editing/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test whos-editing`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/WhosEditing.tsx
import type { Lock } from '@setu/core'

export function WhosEditing({ locks }: { locks: Lock[] }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Currently editing</h2>
      {locks.length === 0 ? (
        <p className="empty-state">No one is editing right now.</p>
      ) : (
        <ul className="dash-locks">
          {locks.map((l) => (
            <li key={`${l.collection}/${l.locale}/${l.slug}`} className="dash-lock-row">
              <span className="dash-lock-slug">{l.slug}</span>
              <span className="ctable-muted">🔒 {l.lockedBy}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test whos-editing`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/WhosEditing.tsx apps/admin/test/whos-editing.test.tsx
git commit -m "feat(admin): WhosEditing dashboard widget"
```

---

### Task 7: SiteStatusCard widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/SiteStatusCard.tsx`
- Test: `apps/admin/test/site-status-card.test.tsx`

**Interfaces:**
- Produces: `SiteStatusCard({ url, deployedSha, topology }: { url: string; deployedSha: string | null; topology: string })` — shows the site URL, a topology chip, deploy state (`Deployed <sha7>` or `Not deployed`), and a **disabled** Sync button labeled as not-yet-connected.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/site-status-card.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteStatusCard } from '../src/dashboard/widgets/SiteStatusCard'

describe('SiteStatusCard', () => {
  it('shows topology, deploy state, and a disabled Sync affordance', () => {
    render(<SiteStatusCard url="http://localhost:4321" deployedSha={null} topology="Local" />)
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText(/not deployed/i)).toBeInTheDocument()
    const sync = screen.getByRole('button', { name: /sync/i })
    expect(sync).toBeDisabled()
  })

  it('shows a short sha when deployed', () => {
    render(<SiteStatusCard url="http://localhost:4321" deployedSha="abcdef1234567890" topology="Local" />)
    expect(screen.getByText(/abcdef1/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test site-status-card`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/SiteStatusCard.tsx
export function SiteStatusCard({
  url, deployedSha, topology,
}: { url: string; deployedSha: string | null; topology: string }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Site</h2>
      <dl className="dash-status">
        <div className="dash-status-row">
          <dt>Topology</dt>
          <dd><span className="badge badge-neutral badge-soft pill-sm">{topology}</span></dd>
        </div>
        <div className="dash-status-row">
          <dt>URL</dt>
          <dd><a href={url} target="_blank" rel="noopener noreferrer" className="ctable-muted">{url}</a></dd>
        </div>
        <div className="dash-status-row">
          <dt>Deploy</dt>
          <dd>{deployedSha === null ? 'Not deployed' : `Deployed ${deployedSha.slice(0, 7)}`}</dd>
        </div>
      </dl>
      <button type="button" className="btn btn-md" disabled title="Remote sync is not connected yet">
        Sync remote changes
      </button>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test site-status-card`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/SiteStatusCard.tsx apps/admin/test/site-status-card.test.tsx
git commit -m "feat(admin): SiteStatusCard widget with stubbed Sync"
```

---

### Task 8: GettingStarted widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/GettingStarted.tsx`
- Test: `apps/admin/test/getting-started.test.tsx`

**Interfaces:**
- Consumes: `useDismissed` (Task 2).
- Produces: `GettingStarted({ hasSiteUrl, hasPost, hasDeployed }: { hasSiteUrl: boolean; hasPost: boolean; hasDeployed: boolean })` — a checklist; renders nothing once dismissed (key `getting-started`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/getting-started.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GettingStarted } from '../src/dashboard/widgets/GettingStarted'

describe('GettingStarted', () => {
  beforeEach(() => localStorage.clear())

  it('renders checklist items and reflects completion', () => {
    render(<GettingStarted hasSiteUrl={true} hasPost={false} hasDeployed={false} />)
    expect(screen.getByText(/create your first post/i)).toBeInTheDocument()
    // a completed item is marked done via aria-checked
    expect(screen.getByRole('checkbox', { name: /set your site url/i })).toBeChecked()
  })

  it('disappears after dismissal', () => {
    render(<GettingStarted hasSiteUrl={false} hasPost={false} hasDeployed={false} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test getting-started`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/GettingStarted.tsx
import { useDismissed } from '../use-dismissed'

function Item({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="dash-check-item">
      <span role="checkbox" aria-checked={done} aria-label={label} className={`dash-check ${done ? 'is-done' : ''}`} />
      <span className={done ? 'dash-check-done' : ''}>{label}</span>
    </li>
  )
}

export function GettingStarted({
  hasSiteUrl, hasPost, hasDeployed,
}: { hasSiteUrl: boolean; hasPost: boolean; hasDeployed: boolean }) {
  const { dismissed, dismiss } = useDismissed('getting-started')
  if (dismissed) return null
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <h2 className="dash-card-title">Getting started</h2>
        <button type="button" className="btn btn-sm" onClick={dismiss} aria-label="Dismiss getting started">Dismiss</button>
      </div>
      <ul className="dash-checklist">
        <Item done={hasSiteUrl} label="Set your site URL" />
        <Item done={hasPost} label="Create your first post" />
        <Item done={hasDeployed} label="Deploy your site" />
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test getting-started`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/GettingStarted.tsx apps/admin/test/getting-started.test.tsx
git commit -m "feat(admin): GettingStarted dashboard checklist"
```

---

### Task 9: TipsDeck widget

**Files:**
- Create: `apps/admin/src/dashboard/widgets/TipsDeck.tsx`
- Test: `apps/admin/test/tips-deck.test.tsx`

**Interfaces:**
- Consumes: `useDismissed` (Task 2).
- Produces: `TipsDeck()` — renders a bundled static list of tips/Pro teasers; renders nothing once dismissed (key `tips`). Tips are a module-level constant array — no network.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/tips-deck.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TipsDeck } from '../src/dashboard/widgets/TipsDeck'

describe('TipsDeck', () => {
  beforeEach(() => localStorage.clear())

  it('renders bundled tips and hides after dismissal', () => {
    render(<TipsDeck />)
    expect(screen.getByText(/tips/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/tips/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test tips-deck`
Expected: FAIL — cannot resolve the import.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/dashboard/widgets/TipsDeck.tsx
import { useDismissed } from '../use-dismissed'

interface Tip { title: string; body: string; pro?: boolean }

const TIPS: Tip[] = [
  { title: 'Press / in the editor', body: 'The slash menu inserts any block — headings, lists, callouts, images.' },
  { title: 'Everything is Git', body: 'Each save is a commit. Your content history lives in your repo.' },
  { title: 'Scheduled publishing', body: 'Queue posts to go live later.', pro: true },
]

export function TipsDeck() {
  const { dismissed, dismiss } = useDismissed('tips')
  if (dismissed) return null
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <h2 className="dash-card-title">Tips</h2>
        <button type="button" className="btn btn-sm" onClick={dismiss} aria-label="Dismiss tips">Dismiss</button>
      </div>
      <ul className="dash-tips">
        {TIPS.map((tip) => (
          <li key={tip.title} className="dash-tip">
            <span className="dash-tip-title">
              {tip.title}
              {tip.pro && <span className="badge badge-accent badge-soft pill-sm">Pro</span>}
            </span>
            <span className="ctable-muted">{tip.body}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm test tips-deck`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard/widgets/TipsDeck.tsx apps/admin/test/tips-deck.test.tsx
git commit -m "feat(admin): TipsDeck — bundled static tips, no network"
```

---

### Task 10: Dashboard container + styles + route

**Files:**
- Create: `apps/admin/src/screens/Dashboard.tsx`
- Create: `apps/admin/src/styles/dashboard.css`
- Modify: `apps/admin/src/index.css` (add `@import './styles/dashboard.css';` alongside the other style imports)
- Modify: `apps/admin/src/App.tsx` (route `/` → `/dashboard`; render `<Dashboard />` instead of `<Placeholder title="Dashboard" />`; remove the now-unused dashboard placeholder import if no longer referenced)
- Test: `apps/admin/test/dashboard.test.tsx`

**Interfaces:**
- Consumes: `loadDashboardEntries`, `dashboardCounts`, `recentEntries`, `loadActiveLocks` (Task 1); all widgets (Tasks 3–9); `useServices`, `useDeploy`, `siteUrl`.
- Produces: `Dashboard()` — loads on mount, composes widgets into the grid.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/dashboard.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DataPort, GitPort, DraftInput, TiptapDoc } from '@setu/core'
import { DeployProvider } from '../src/deploy/deploy'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { Dashboard } from '../src/screens/Dashboard'
import { App } from '../src/App'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'p1', content: doc('a'), metadata: { title: 'First Post', status: 'draft' } },
]

function renderDash(data: DataPort, git: GitPort) {
  return render(
    <MemoryRouter>
      <ServicesProvider services={servicesFor(data, git)}>
        <DeployProvider>
          <Dashboard />
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => localStorage.clear())

  it('composes the recent edits widget from seeded drafts', async () => {
    renderDash(createMemoryDataPort(seed), createMemoryGitPort())
    expect(await screen.findByText('First Post')).toBeInTheDocument()
    expect(screen.getByText('Quick actions')).toBeInTheDocument()
  })
})

describe('admin landing route', () => {
  it('redirects / to the dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ServicesProvider services={servicesFor(createMemoryDataPort(seed), createMemoryGitPort())}>
          <DeployProvider>
            <App />
          </DeployProvider>
        </ServicesProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Quick actions')).toBeInTheDocument()
  })
})
```

Note: confirm how the existing top-level test (`test/bootstrap.test.tsx`) wraps `<App />` with providers and match it; if `App` already mounts its own providers, drop the wrappers here and just supply the in-memory adapter the same way that test does.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test dashboard.test`
Expected: FAIL — cannot resolve `../src/screens/Dashboard`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/admin/src/screens/Dashboard.tsx
import { useEffect, useState } from 'react'
import type { ContentRow, Lock } from '@setu/core'
import { useServices } from '../data/store'
import { useDeploy } from '../deploy/deploy'
import { siteUrl } from '../shell/site-url'
import { PageHeader } from '../shell/PageHeader'
import { loadDashboardEntries, dashboardCounts, recentEntries, loadActiveLocks } from '../dashboard/entries'
import { CountsTiles } from '../dashboard/widgets/CountsTiles'
import { RecentEdits } from '../dashboard/widgets/RecentEdits'
import { QuickActions } from '../dashboard/widgets/QuickActions'
import { WhosEditing } from '../dashboard/widgets/WhosEditing'
import { SiteStatusCard } from '../dashboard/widgets/SiteStatusCard'
import { GettingStarted } from '../dashboard/widgets/GettingStarted'
import { TipsDeck } from '../dashboard/widgets/TipsDeck'

export function Dashboard() {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [locks, setLocks] = useState<Lock[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      const loaded = await loadDashboardEntries(data, git, deployedAt)
      if (!live) return
      setRows(loaded)
      setLocks(await loadActiveLocks(data, loaded))
    })()
    return () => { live = false }
  }, [data, git, deployedAt, deploySha])

  const counts = dashboardCounts(rows ?? [])

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your site at a glance." />
      <div className="page-body dash">
        <CountsTiles posts={counts.posts} pages={counts.pages} drafts={counts.drafts} media={null} />
        <div className="dash-grid">
          <div className="dash-col-main">
            <RecentEdits rows={recentEntries(rows ?? [], 6)} />
            <QuickActions />
            <WhosEditing locks={locks} />
          </div>
          <div className="dash-col-side">
            <SiteStatusCard url={siteUrl()} deployedSha={deploySha} topology="Local" />
            <GettingStarted hasSiteUrl={siteUrl() !== ''} hasPost={counts.posts > 0} hasDeployed={deploySha !== null} />
            <TipsDeck />
          </div>
        </div>
      </div>
    </>
  )
}
```

```css
/* apps/admin/src/styles/dashboard.css — use existing tokens; keep calm + responsive */
.dash { display: flex; flex-direction: column; gap: var(--space-5, 1.5rem); }
.dash-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3, 0.75rem); }
.dash-tile { display: flex; flex-direction: column; gap: 0.25rem; padding: var(--space-3, 0.75rem);
  border: 1px solid var(--border, #e5e7eb); border-radius: var(--radius-md, 10px); background: var(--surface, #fff); }
.dash-tile-value { font-size: 1.5rem; font-weight: 600; }
.dash-tile-label { color: var(--text-muted, #6b7280); font-size: 0.85rem; }
.dash-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-4, 1rem); align-items: start; }
.dash-col-main, .dash-col-side { display: flex; flex-direction: column; gap: var(--space-4, 1rem); }
.dash-card { padding: var(--space-4, 1rem); border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius-md, 10px); background: var(--surface, #fff); }
.dash-card-head { display: flex; align-items: center; justify-content: space-between; }
.dash-card-title { font-size: 0.95rem; font-weight: 600; margin: 0 0 var(--space-3, 0.75rem); }
.dash-actions { display: flex; gap: var(--space-2, 0.5rem); }
.dash-recent, .dash-locks, .dash-checklist, .dash-tips { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--space-2, 0.5rem); }
.dash-recent-row, .dash-lock-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.dash-check { width: 16px; height: 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 4px; display: inline-block; }
.dash-check.is-done { background: var(--accent, #2563eb); border-color: var(--accent, #2563eb); }
.dash-check-item { display: flex; align-items: center; gap: 0.5rem; }
.dash-check-done { color: var(--text-muted, #6b7280); text-decoration: line-through; }
.dash-status { margin: 0 0 var(--space-3, 0.75rem); display: flex; flex-direction: column; gap: 0.4rem; }
.dash-status-row { display: flex; justify-content: space-between; gap: 0.5rem; }
.dash-status-row dt { color: var(--text-muted, #6b7280); }
.dash-tip { display: flex; flex-direction: column; gap: 0.15rem; }
.dash-tip-title { font-weight: 600; display: flex; align-items: center; gap: 0.4rem; }
@media (max-width: 900px) { .dash-grid { grid-template-columns: 1fr; } .dash-tiles { grid-template-columns: repeat(2, 1fr); } }
```

App.tsx route change (replace the two relevant lines):

```tsx
// was: <Route path="/" element={<Navigate to="/posts" replace />} />
<Route path="/" element={<Navigate to="/dashboard" replace />} />
// was: <Route path="/dashboard" element={<Placeholder title="Dashboard" />} />
<Route path="/dashboard" element={<Dashboard />} />
```

Add `import { Dashboard } from './screens/Dashboard'` at the top of `App.tsx`. Keep the `Placeholder` import if still used by other routes (it is — `/media`, `/forms`, `/settings`).

Add to `apps/admin/src/index.css` (next to the existing style imports):

```css
@import './styles/dashboard.css';
```

- [ ] **Step 4: Run the dashboard tests and the full suite**

Run: `cd apps/admin && pnpm test dashboard.test`
Expected: PASS.
Run: `cd apps/admin && pnpm test`
Expected: all green — 213 prior + new tests (no regressions). Also run `pnpm typecheck`; expect no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/Dashboard.tsx apps/admin/src/styles/dashboard.css \
  apps/admin/src/index.css apps/admin/src/App.tsx apps/admin/test/dashboard.test.tsx
git commit -m "feat(admin): dashboard home screen + / -> /dashboard"
```

---

## Self-Review

**Spec coverage:**
- Replace `/dashboard` placeholder → Task 10. ✅
- `/` → `/dashboard` → Task 10. ✅
- RecentEdits (wired) → Tasks 1 + 5. ✅
- QuickActions (wired, plain links) → Task 3. ✅
- CountsTiles (wired; media best-effort `—`) → Tasks 1 + 4 + 10 (passes `media={null}`). ✅
- SiteStatusCard (deploy state via `sha`; Sync stub) → Task 7. ✅
- GettingStarted (derived checks + localStorage dismiss) → Tasks 2 + 8. ✅
- TipsDeck (bundled static, no network; localStorage dismiss) → Tasks 2 + 9. ✅
- WhosEditing (best-effort `getLock` loop) → Tasks 1 + 6. ✅
- Per-widget tests + container smoke + route test → every task + Task 10. ✅
- Styling via tokens, no Tailwind/shadcn → Task 10 CSS. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one judgement call (how `<App />` is wrapped in tests) carries an explicit instruction to match `bootstrap.test.tsx`.

**Type consistency:** Widget prop names (`rows`, `locks`, `posts/pages/drafts/media`, `url/deployedSha/topology`, `hasSiteUrl/hasPost/hasDeployed`) are consistent between their defining task and the Task 10 container call sites. `ContentRow`/`Lock`/`Lifecycle` shapes match the Global Constraints (verified against `ContentList.tsx` and `@setu/core`).

**Open verification during execution:** Confirm `metadata.status` → `lifecycle.state` behavior with empty git (the existing content-list test implies everything derives to `draft`); the Task 1 counts test assumes that. If a seeded committed file is needed to exercise `published`, add it then.
