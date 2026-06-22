# Admin Content Lists Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Posts/Pages list on shadcn with Tags/Categories columns, a per-browser column picker, and restrained row animation — preserving all existing filter/sort/pagination/bulk behavior.

**Architecture:** Decompose the ~280-line `ContentList` into focused units (`useColumnPrefs`, `ColumnsMenu`, `ContentTable`, `ListToolbar`, `Pager`, restyled `BulkBar`). Tasks 1–6 are additive / in-place-compatible (package stays green); Task 7 rewires `ContentList` to compose them and removes the old inline table + dead CSS. The `index-store` query layer is untouched.

**Tech Stack:** React 19, shadcn/ui (`table`, `select`, `checkbox`, `dropdown-menu`, `badge`, `button`, `command`, `popover`), `motion/react`, react-router-dom 6, Tailwind v4 tokens, Vitest + Testing Library.

## Global Constraints

- Branch `admin-content-lists` off `main`.
- Use ONLY `@/components/ui/*` primitives + standard token utilities + lucide icons. No new bespoke CSS classes / custom token names (per `docs/admin-ui-conventions.md`).
- **Preserve behavior exactly:** URL state via `useSearchParams` (`q` debounced 200ms, `status`, `category`, `locale`, `tag`, `sort`); the `index.query({collection, offset, limit, sort, …filters})` seam; `index.distinctLocales()`; `PAGE_SIZE = 25`; page reset on filter/collection change; selection reset on page change; the deliberate no-`setRows(null)`-on-refilter; loading + both empty states. Do NOT touch `data/index-store`.
- Columns: `[select] · Title(always) · Status · Tags · Categories · Locale(auto when >1) · Updated`. Author deferred. Tags/Categories ≤2 chips + "+N", "—" when empty. Title is the click target (no whole-row click).
- Status → `Badge` via shared `statusBadge`; sortable headers only Title/Status/Updated.
- Column prefs persist to `localStorage` key `setu-list-columns`.
- Animation: `motion`, reduced-motion aware; stagger on mount + page change; no per-row stagger on filter/sort.
- Shared typeaheads (`TagAutocomplete`, `CategoryPicker`) are restyled-not-rebuilt.
- The table sits inside `PageBody` (page gutter) AND has comfortable internal horizontal padding (outer cells don't hug the card border).
- Verification per task: `pnpm --filter @setu/admin typecheck` + `pnpm --filter @setu/admin test <file>` green (cumulative typecheck stays green every task).

---

### Task 1: Move `statusBadge` + `relativeTime` to shared `lib/`

**Files:**
- Create: `apps/admin/src/lib/status-badge.ts`, `apps/admin/src/lib/format.ts`
- Modify: `apps/admin/src/dashboard/widgets/ResumeEditing.tsx`, `apps/admin/src/screens/Dashboard.tsx` (and any other importers) to import from `@/lib/...`
- Delete: `apps/admin/src/dashboard/status-badge.ts`, `apps/admin/src/dashboard/format.ts`
- Test: existing `dashboard-helpers.test.ts` retargeted; `resume-editing.test.tsx` still green

**Interfaces:**
- Produces: `statusBadge(lc): { label; variant }` from `@/lib/status-badge`; `greeting()`, `relativeTime(updatedAt, now?)` from `@/lib/format`.

- [ ] **Step 1: Find all importers**

Run: `grep -rn "dashboard/status-badge\|dashboard/format" apps/admin/src apps/admin/test`
Note every file — they all switch to `@/lib/status-badge` / `@/lib/format`.

- [ ] **Step 2: Move the files (git mv preserves history)**
```bash
cd apps/admin
git mv src/dashboard/status-badge.ts src/lib/status-badge.ts
git mv src/dashboard/format.ts src/lib/format.ts
cd ../..
```

- [ ] **Step 3: Update every importer**

In each file from Step 1, change the import path. Source files import `../lib/status-badge` (or `@/lib/status-badge`); test files import `../src/lib/status-badge`. Example in `ResumeEditing.tsx`: `import { statusBadge } from '../../lib/status-badge'` and `import { relativeTime } from '../../lib/format'` (adjust depth). In `Dashboard.tsx`: `import { greeting } from '../lib/format'`. In `dashboard-helpers.test.ts`: `from '../src/lib/status-badge'` / `'../src/lib/format'`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test dashboard-helpers resume-editing`
Expected: clean + green. Then `grep -rn "dashboard/status-badge\|dashboard/format" apps/admin` → no matches.

- [ ] **Step 5: Commit**
```bash
git add -A apps/admin
git commit -m "refactor(admin): move statusBadge + format helpers to shared lib/"
```

---

### Task 2: `useColumnPrefs` hook (visibility + persistence + locale auto-rule)

**Files:**
- Create: `apps/admin/src/screens/content-list/useColumnPrefs.ts`
- Test: `apps/admin/test/column-prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ColumnKey = 'status' | 'tags' | 'categories' | 'locale' | 'updated'
  function useColumnPrefs(multilingual: boolean): {
    visible: Record<ColumnKey, boolean>
    toggle: (k: ColumnKey) => void
  }
  ```
  Defaults: `status/tags/categories/updated` = true; `locale` = `multilingual`. Persists the user's explicit toggles to `localStorage['setu-list-columns']`; the stored value wins over the default when present.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/column-prefs.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnPrefs } from '../src/screens/content-list/useColumnPrefs'

describe('useColumnPrefs', () => {
  beforeEach(() => localStorage.clear())
  it('defaults: content columns on, locale follows multilingual', () => {
    const { result } = renderHook(() => useColumnPrefs(false))
    expect(result.current.visible).toMatchObject({ status: true, tags: true, categories: true, updated: true, locale: false })
    const { result: ml } = renderHook(() => useColumnPrefs(true))
    expect(ml.current.visible.locale).toBe(true)
  })
  it('toggle flips and persists', () => {
    const { result } = renderHook(() => useColumnPrefs(false))
    act(() => result.current.toggle('tags'))
    expect(result.current.visible.tags).toBe(false)
    expect(JSON.parse(localStorage.getItem('setu-list-columns')!).tags).toBe(false)
  })
  it('persisted choice wins over default on remount', () => {
    localStorage.setItem('setu-list-columns', JSON.stringify({ status: false }))
    const { result } = renderHook(() => useColumnPrefs(false))
    expect(result.current.visible.status).toBe(false)
    expect(result.current.visible.tags).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test column-prefs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { useCallback, useState } from 'react'

export type ColumnKey = 'status' | 'tags' | 'categories' | 'locale' | 'updated'
const KEY = 'setu-list-columns'

function load(): Partial<Record<ColumnKey, boolean>> {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : {} } catch { return {} }
}

export function useColumnPrefs(multilingual: boolean): {
  visible: Record<ColumnKey, boolean>
  toggle: (k: ColumnKey) => void
} {
  const [stored, setStored] = useState<Partial<Record<ColumnKey, boolean>>>(load)
  const defaults: Record<ColumnKey, boolean> = {
    status: true, tags: true, categories: true, updated: true, locale: multilingual,
  }
  const visible: Record<ColumnKey, boolean> = {
    status: stored.status ?? defaults.status,
    tags: stored.tags ?? defaults.tags,
    categories: stored.categories ?? defaults.categories,
    updated: stored.updated ?? defaults.updated,
    locale: stored.locale ?? defaults.locale,
  }
  const toggle = useCallback((k: ColumnKey) => {
    setStored((prev) => {
      const base: Record<ColumnKey, boolean> = {
        status: prev.status ?? true, tags: prev.tags ?? true, categories: prev.categories ?? true,
        updated: prev.updated ?? true, locale: prev.locale ?? multilingual,
      }
      const next = { ...prev, [k]: !base[k] }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [multilingual])
  return { visible, toggle }
}
```

- [ ] **Step 4: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test column-prefs && pnpm --filter @setu/admin typecheck`
Expected: PASS (3/3), clean.

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/screens/content-list/useColumnPrefs.ts apps/admin/test/column-prefs.test.ts
git commit -m "feat(admin): useColumnPrefs hook (column visibility + localStorage + locale auto-rule)"
```

---

### Task 3: `ColumnsMenu` (the column picker)

**Files:**
- Create: `apps/admin/src/screens/content-list/ColumnsMenu.tsx`
- Test: `apps/admin/test/columns-menu.test.tsx`

**Interfaces:**
- Consumes: `useColumnPrefs` return shape (Task 2); `@/components/ui/dropdown-menu`, `@/components/ui/button`; lucide `Columns3`.
- Produces: `<ColumnsMenu visible={Record<ColumnKey,boolean>} toggle={(k:ColumnKey)=>void} showLocale={boolean} />` — a "Columns" `DropdownMenu` of checkbox items (Status/Tags/Categories/Locale/Updated; Locale item only when `showLocale`).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/columns-menu.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColumnsMenu } from '../src/screens/content-list/ColumnsMenu'

const visible = { status: true, tags: true, categories: true, updated: true, locale: false }

describe('ColumnsMenu', () => {
  it('opens and toggles a column', () => {
    const toggle = vi.fn()
    render(<ColumnsMenu visible={visible} toggle={toggle} showLocale={false} />)
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByText('Tags'))
    expect(toggle).toHaveBeenCalledWith('tags')
  })
  it('hides the Locale item when showLocale is false', () => {
    render(<ColumnsMenu visible={visible} toggle={() => {}} showLocale={false} />)
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.queryByText('Locale')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test columns-menu`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { Columns3 } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { ColumnKey } from './useColumnPrefs'

const ITEMS: { key: ColumnKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'tags', label: 'Tags' },
  { key: 'categories', label: 'Categories' },
  { key: 'locale', label: 'Locale' },
  { key: 'updated', label: 'Updated' },
]

export function ColumnsMenu({
  visible, toggle, showLocale,
}: { visible: Record<ColumnKey, boolean>; toggle: (k: ColumnKey) => void; showLocale: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm"><Columns3 className="size-4" />Columns</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ITEMS.filter((it) => it.key !== 'locale' || showLocale).map((it) => (
          <DropdownMenuCheckboxItem
            key={it.key}
            checked={visible[it.key]}
            onSelect={(e) => { e.preventDefault(); toggle(it.key) }}
          >
            {it.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```
(`e.preventDefault()` on `onSelect` keeps the menu open while toggling multiple columns.)

- [ ] **Step 4: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test columns-menu && pnpm --filter @setu/admin typecheck`
Expected: PASS (2/2), clean.

- [ ] **Step 5: Commit**
```bash
git add apps/admin/src/screens/content-list/ColumnsMenu.tsx apps/admin/test/columns-menu.test.tsx
git commit -m "feat(admin): ColumnsMenu column-visibility picker"
```

---

### Task 4: `ContentTable` (shadcn table, columns, badges, chips, selection, sort, animation)

**Files:**
- Create: `apps/admin/src/screens/content-list/ContentTable.tsx`, `apps/admin/src/screens/content-list/Chips.tsx`
- Test: `apps/admin/test/content-table.test.tsx`

**Interfaces:**
- Consumes: `statusBadge` (`@/lib/status-badge`), `relativeTime` (`@/lib/format`), `@/components/ui/{table,checkbox,badge}`, `motion/react`, `ColumnKey` visibility, `ContentRow`/`SortKey` from `@setu/core`, `siteUrl`, lucide `ArrowUp`/`ArrowDown`/`ExternalLink`.
- Produces:
  ```tsx
  <ContentTable
    rows={ContentRow[]} gen={number}
    visible={Record<ColumnKey,boolean>} showLocale={boolean}
    categoryName={(slug:string)=>string}
    selected={Set<string>} allSelected={boolean}
    onToggleRow={(k:string)=>void} onToggleAll={()=>void}
    sort={{key:SortKey;dir:'asc'|'desc'}} onSort={(k:SortKey)=>void}
  />
  ```
  `keyOf(row) = `${collection}/${locale}/${slug}``. `gen` increments on mount/page change → re-staggers (rows keyed `${gen}:${keyOf}`); on filter/sort `gen` is stable → no re-stagger.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/content-table.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { ContentTable } from '../src/screens/content-list/ContentTable'

const allCols = { status: true, tags: true, categories: true, updated: true, locale: true }
function row(o: Partial<ContentRow> = {}): ContentRow {
  return { ref: { collection: 'post', locale: 'en', slug: 'hi' }, title: 'Hi', locale: 'en',
    lifecycle: { state: 'draft' }, updatedAt: Date.now(), hasDraft: true,
    tags: ['a', 'b', 'c'], categories: ['news'], mediaRefs: [], ...o }
}
const base = {
  gen: 0, visible: allCols, showLocale: true, categoryName: (s: string) => s.toUpperCase(),
  selected: new Set<string>(), allSelected: false, onToggleRow: () => {}, onToggleAll: () => {},
  sort: { key: 'updatedAt' as const, dir: 'desc' as const }, onSort: () => {},
}
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ContentTable', () => {
  it('renders title link, status badge, tag chips (2 + overflow), category name', () => {
    wrap(<ContentTable {...base} rows={[row()]} />)
    expect(screen.getByRole('link', { name: 'Hi' })).toHaveAttribute('href', '/edit/post/en/hi')
    expect(screen.getByText('Draft').className).toContain('bg-warning')
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()      // 3 tags → 2 chips + "+1"
    expect(screen.getByText('NEWS')).toBeInTheDocument()     // category slug → name
  })
  it('shows an em dash for empty tags/categories', () => {
    wrap(<ContentTable {...base} rows={[row({ tags: [], categories: [] })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
  it('hides columns that are not visible', () => {
    wrap(<ContentTable {...base} visible={{ ...allCols, tags: false }} rows={[row()]} />)
    expect(screen.queryByText('a')).toBeNull()
  })
  it('per-row checkbox + sort header fire callbacks', () => {
    const onToggleRow = vi.fn(); const onSort = vi.fn()
    wrap(<ContentTable {...base} rows={[row()]} onToggleRow={onToggleRow} onSort={onSort} />)
    fireEvent.click(screen.getByLabelText('Select Hi'))
    expect(onToggleRow).toHaveBeenCalledWith('post/en/hi')
    fireEvent.click(screen.getByRole('button', { name: /Title/ }))
    expect(onSort).toHaveBeenCalledWith('title')
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @setu/admin test content-table`
Expected: FAIL.

- [ ] **Step 3: Implement `Chips.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'

export function Chips({ items, name }: { items: string[]; name?: (s: string) => string }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>
  const shown = items.slice(0, 2)
  const extra = items.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((it) => <Badge key={it} variant="outline" className="font-normal">{name ? name(it) : it}</Badge>)}
      {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
    </span>
  )
}
```

- [ ] **Step 4: Implement `ContentTable.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react'
import type { ContentRow, SortKey } from '@setu/core'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '@/lib/status-badge'
import { relativeTime } from '@/lib/format'
import { siteUrl } from '../../shell/site-url'
import { Chips } from './Chips'
import type { ColumnKey } from './useColumnPrefs'

const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

function SortHead({ label, k, sort, onSort }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void
}) {
  const active = sort.key === k
  return (
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
      {label}
      {active && (sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
    </button>
  )
}

export function ContentTable({
  rows, gen, visible, showLocale, categoryName,
  selected, allSelected, onToggleRow, onToggleAll, sort, onSort,
}: {
  rows: ContentRow[]; gen: number
  visible: Record<ColumnKey, boolean>; showLocale: boolean; categoryName: (slug: string) => string
  selected: Set<string>; allSelected: boolean
  onToggleRow: (k: string) => void; onToggleAll: () => void
  sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void
}) {
  const reduce = useReducedMotion()
  const localeCol = visible.locale && showLocale
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4"><Checkbox aria-label="Select all on this page" checked={allSelected} onCheckedChange={onToggleAll} /></TableHead>
          <TableHead><SortHead label="Title" k="title" sort={sort} onSort={onSort} /></TableHead>
          {visible.status && <TableHead className="w-24"><SortHead label="Status" k="status" sort={sort} onSort={onSort} /></TableHead>}
          {visible.tags && <TableHead className="w-40">Tags</TableHead>}
          {visible.categories && <TableHead className="w-32">Categories</TableHead>}
          {localeCol && <TableHead className="w-20">Locale</TableHead>}
          {visible.updated && <TableHead className="w-28 pr-4"><SortHead label="Updated" k="updatedAt" sort={sort} onSort={onSort} /></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const k = keyOf(r); const s = statusBadge(r.lifecycle)
          const published = r.lifecycle.state === 'staged' || r.lifecycle.state === 'live'
          return (
            <motion.tr
              key={`${gen}:${k}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: reduce ? 0 : Math.min(i, 12) * 0.025 }}
              className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
              data-state={selected.has(k) ? 'selected' : undefined}
            >
              <TableCell className="pl-4"><Checkbox aria-label={`Select ${r.title}`} checked={selected.has(k)} onCheckedChange={() => onToggleRow(k)} /></TableCell>
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Link to={`/edit/${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`} className="truncate hover:underline">{r.title}</Link>
                  {published && (
                    <a href={siteUrl(r.ref)} target="_blank" rel="noopener noreferrer" aria-label={`View ${r.title} on site`} className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /></a>
                  )}
                </span>
              </TableCell>
              {visible.status && <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>}
              {visible.tags && <TableCell><Chips items={r.tags} /></TableCell>}
              {visible.categories && <TableCell><Chips items={r.categories} name={categoryName} /></TableCell>}
              {localeCol && <TableCell className="text-muted-foreground">{r.ref.locale}</TableCell>}
              {visible.updated && <TableCell className="pr-4 text-muted-foreground">{relativeTime(r.updatedAt)}</TableCell>}
            </motion.tr>
          )
        })}
      </TableBody>
    </Table>
  )
}
```
(The `pl-4`/`pr-4` on the outer cells give the internal horizontal padding so content doesn't hug the card border.)

- [ ] **Step 5: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test content-table && pnpm --filter @setu/admin typecheck`
Expected: PASS (4/4), clean. (If `motion.tr` + jsdom raises a hydration warning, it does not fail assertions — the rows render synchronously.)

- [ ] **Step 6: Commit**
```bash
git add apps/admin/src/screens/content-list/ContentTable.tsx apps/admin/src/screens/content-list/Chips.tsx apps/admin/test/content-table.test.tsx
git commit -m "feat(admin): ContentTable on shadcn — tags/categories chips, badges, sort, row animation"
```

---

### Task 5: `ListToolbar` + `Pager`

**Files:**
- Create: `apps/admin/src/screens/content-list/ListToolbar.tsx`, `apps/admin/src/screens/content-list/Pager.tsx`
- Test: `apps/admin/test/list-toolbar.test.tsx`, `apps/admin/test/pager.test.tsx`

**Interfaces:**
- `ListToolbar` consumes `@/components/ui/{input,select,button}`, the existing `TagFilter` (restyled in Task 6 area; here just rendered), `ColumnsMenu` (Task 3), lucide `Search`. Props:
  ```tsx
  <ListToolbar
    title={string}
    search={string} onSearch={(v:string)=>void}
    status={string} onStatus={(v:string)=>void}
    category={string} onCategory={(v:string)=>void} catRows={{slug:string;name:string;depth:number}[]}
    tag={string} onTag={(v:string)=>void}
    hasFilters={boolean} onClear={()=>void}
    columnsMenu={React.ReactNode}
  />
  ```
- `Pager`: `<Pager from={number} to={number} total={number} page={number} onPage={(p:number)=>void} />`.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/test/pager.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pager } from '../src/screens/content-list/Pager'

describe('Pager', () => {
  it('shows range and pages forward', () => {
    const onPage = vi.fn()
    render(<Pager from={1} to={25} total={128} page={0} onPage={onPage} />)
    expect(screen.getByText('1–25 of 128')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPage).toHaveBeenCalledWith(1)
  })
})
```

Create `apps/admin/test/list-toolbar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ListToolbar } from '../src/screens/content-list/ListToolbar'

const base = {
  title: 'Posts', search: '', onSearch: () => {}, status: '', onStatus: () => {},
  category: '', onCategory: () => {}, catRows: [{ slug: 'news', name: 'News', depth: 0 }],
  tag: '', onTag: () => {}, hasFilters: false, onClear: () => {}, columnsMenu: <button>Columns</button>,
}

describe('ListToolbar', () => {
  it('search input calls onSearch', () => {
    const onSearch = vi.fn()
    render(<ListToolbar {...base} onSearch={onSearch} />)
    fireEvent.change(screen.getByPlaceholderText(/search posts/i), { target: { value: 'hi' } })
    expect(onSearch).toHaveBeenCalledWith('hi')
  })
  it('shows Clear only when filters are active', () => {
    const { rerender } = render(<ListToolbar {...base} hasFilters={false} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
    rerender(<ListToolbar {...base} hasFilters />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `pnpm --filter @setu/admin test pager list-toolbar`
Expected: FAIL.

- [ ] **Step 3: Implement `Pager.tsx`**

```tsx
import { Button } from '@/components/ui/button'

export function Pager({ from, to, total, page, onPage }: {
  from: number; to: number; total: number; page: number; onPage: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <span>{from}–{to} of {total}</span>
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</Button>
      <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  )
}
```

- [ ] **Step 4: Implement `ListToolbar.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { TagFilter } from '../TagFilter'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', staged: 'Staged', live: 'Live', unpublished: 'Unpublished' }
const STATUSES = ['draft', 'staged', 'live', 'unpublished']

export function ListToolbar({
  title, search, onSearch, status, onStatus, category, onCategory, catRows, tag, onTag, hasFilters, onClear, columnsMenu,
}: {
  title: string
  search: string; onSearch: (v: string) => void
  status: string; onStatus: (v: string) => void
  category: string; onCategory: (v: string) => void; catRows: { slug: string; name: string; depth: number }[]
  tag: string; onTag: (v: string) => void
  hasFilters: boolean; onClear: () => void; columnsMenu: ReactNode
}) {
  // shadcn Select uses a sentinel for "all" (empty string is not a valid SelectItem value).
  const ALL = '__all__'
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder={`Search ${title.toLowerCase()}`} aria-label="Search" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <Select value={status || ALL} onValueChange={(v) => onStatus(v === ALL ? '' : v)}>
        <SelectTrigger size="sm" aria-label="Filter by status" className="w-36"><SelectValue placeholder="All status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All status</SelectItem>
          {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={category || ALL} onValueChange={(v) => onCategory(v === ALL ? '' : v)}>
        <SelectTrigger size="sm" aria-label="Filter by category" className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          {catRows.map((c) => <SelectItem key={c.slug} value={c.slug}><span style={{ paddingLeft: c.depth * 12 }}>{c.name}</span></SelectItem>)}
        </SelectContent>
      </Select>
      <TagFilter value={tag} onChange={onTag} />
      {hasFilters && <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>}
      <div className="ml-auto">{columnsMenu}</div>
    </div>
  )
}
```
(Note the shadcn `Select` empty-value sentinel — Radix Select forbids `value=""` on an item. Verify the installed `SelectTrigger` accepts a `size` prop; if not, drop it and use `className` for height.)

- [ ] **Step 5: Run — verify pass + typecheck**

Run: `pnpm --filter @setu/admin test pager list-toolbar && pnpm --filter @setu/admin typecheck`
Expected: PASS. If `SelectTrigger size` isn't a prop in the installed component, remove it (typecheck will tell you).

- [ ] **Step 6: Commit**
```bash
git add apps/admin/src/screens/content-list/ListToolbar.tsx apps/admin/src/screens/content-list/Pager.tsx apps/admin/test/list-toolbar.test.tsx apps/admin/test/pager.test.tsx
git commit -m "feat(admin): ListToolbar (shadcn search/select filters) + Pager"
```

---

### Task 6: Restyle `BulkBar` + `TagFilter` on shadcn (keep typeaheads)

**Files:**
- Modify: `apps/admin/src/screens/BulkBar.tsx` (container + buttons + count → shadcn; keep `CategoryPicker`/`TagAutocomplete` logic)
- Modify: `apps/admin/src/screens/TagFilter.tsx` (active-tag chip → `Badge`; input shadcn-styled; keep `TagAutocomplete`)
- Test: existing `tag-autocomplete.test.tsx` stays green; add/keep a `BulkBar` smoke if one exists

**Interfaces:**
- Both keep their current exported signatures (so `ContentList` keeps compiling). Only presentation changes.

- [ ] **Step 1: Restyle `TagFilter.tsx`**

Keep the logic; replace the bespoke chip markup. Active value → `<Badge variant="secondary" className="gap-1">{value}<button aria-label="Clear tag filter" onClick={() => onChange('')}><X className="size-3" /></button></Badge>` (import `Badge` from `@/components/ui/badge`, `X` from `lucide-react`). The `TagAutocomplete` branch stays; only drop the `tag-chip`/`tag-chip-x` bespoke classes.

- [ ] **Step 2: Restyle `BulkBar.tsx`**

Keep ALL handlers/logic (`run`, `applyCat`, `applyTag`, `del`, the `CategoryPicker`/`TagAutocomplete` usage). Replace the container `<div className="bulk-bar">` and the bespoke `btn`/`btn-sm`/`btn-danger`/`bulk-*` classes with shadcn: wrap in a `flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2` row; the count as `text-sm font-medium`; the action buttons as `<Button size="sm" variant="outline">`/`variant="destructive"` for Delete; the note as `text-xs text-muted-foreground`. Do not change the `CategoryPicker`/`TagAutocomplete` components themselves.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test tag-autocomplete bulk` (run whatever bulk/tag tests exist) and `pnpm --filter @setu/admin test` (full suite).
Expected: green. These are presentational changes; behavior tests should be unaffected.

- [ ] **Step 4: Commit**
```bash
git add apps/admin/src/screens/BulkBar.tsx apps/admin/src/screens/TagFilter.tsx
git commit -m "feat(admin): restyle BulkBar + TagFilter on shadcn (keep index-backed typeaheads)"
```

---

### Task 7: Recompose `ContentList`; remove dead list CSS; final gate

**Files:**
- Rewrite: `apps/admin/src/screens/ContentList.tsx` (slim orchestrator composing the new pieces)
- Modify: `apps/admin/src/styles/shell.css` / `components.css` — remove dead `.ctable*`, `.list-toolbar`, `.list-wrap`, `.list-search`, `.list-pager`, `.bulk-*`, `.tag-chip*`, `.status-pending` rules that are now unused
- Test: update `apps/admin/test/*` that rendered the old ContentList markup (find them)

**Interfaces:**
- Consumes everything from Tasks 2–6.

- [ ] **Step 1: Rewrite `ContentList.tsx`**

Keep ALL the existing state + effects (params, page, rows, total, locales, selected, refreshKey, the debounced search, the page-reset effect, the selection-reset effect, the distinctLocales effect, the `index.query` effect — unchanged). Add a `gen` counter that increments on mount and whenever `page` changes (NOT on filter/sort):
```tsx
const [gen, setGen] = useState(0)
useEffect(() => { setGen((g) => g + 1) }, [page])   // mount fires once + each page change
```
Compute `multilingual = locales.length > 1`; `const { visible, toggle } = useColumnPrefs(multilingual)`; build `categoryName` from the taxonomy (`new Map(catRows.map((c) => [c.slug, c.name]))` → `(slug) => map.get(slug) ?? slug`). Replace the JSX body (everything inside `<PageBody>`) with:
```tsx
<PageBody>
  <ListToolbar
    title={title} search={search} onSearch={setSearch}
    status={status} onStatus={(v) => setParam('status', v)}
    category={category} onCategory={(v) => setParam('category', v)} catRows={catRows}
    tag={tag} onTag={(t) => setParam('tag', t)}
    hasFilters={hasFilters} onClear={clearFilters}
    columnsMenu={<ColumnsMenu visible={visible} toggle={toggle} showLocale={multilingual} />}
  />
  {rows === null ? (
    <p className="text-sm text-muted-foreground">Loading…</p>
  ) : rows.length === 0 ? (
    hasFilters
      ? <p className="text-sm text-muted-foreground">No {title.toLowerCase()} match these filters. <Button variant="link" size="sm" onClick={clearFilters}>Clear filters</Button></p>
      : <p className="text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>
  ) : (
    <>
      {selected.size > 0 && <BulkBar rows={rows} selected={selected} onClear={() => setSelected(new Set())} onDone={() => { setSelected(new Set()); setRefreshKey((k) => k + 1) }} />}
      <div className="overflow-hidden rounded-lg border">
        <ContentTable
          rows={rows} gen={gen} visible={visible} showLocale={multilingual} categoryName={categoryName}
          selected={selected} allSelected={allSelected} onToggleRow={toggleRow} onToggleAll={toggleAll}
          sort={sort} onSort={toggleSort}
        />
        {total > 0 && <Pager from={from} to={to} total={total} page={page} onPage={setPage} />}
      </div>
    </>
  )}
</PageBody>
```
Keep the `PageHeader` (replace the `Icon`+`btn` New-button with a shadcn `<Button asChild><Link …><Plus/>New {noun}</Link></Button>`). Remove the now-unused imports (`Icon`, `StatusPill`, `lifecycleLabel`, the inline `STATUSES`/`SORT_KEYS` if moved, etc. — let typecheck guide you).

- [ ] **Step 2: Remove dead CSS**

Run the user-grep (per the shell PR's Task 6 method) for each candidate class (`ctable`, `ctable-check`, `ctable-title`, `ctable-view`, `ctable-muted`, `ctable-sort`, `list-toolbar`, `list-wrap`, `list-search`, `list-pager`, `bulk-bar`, `bulk-count`, `bulk-group`, `bulk-note`, `tag-chip`, `tag-chip-x`, `status-pending`). Delete a rule from `shell.css`/`components.css` ONLY when its className has 0 TSX/TS users. Leave anything still referenced.

- [ ] **Step 3: Update old ContentList tests**

Run: `grep -rln "ctable\|list-toolbar\|ContentList" apps/admin/test`. For any test that asserted the OLD markup/classes, update it to the new structure (reuse the new component tests' patterns; don't weaken coverage). For a ContentList integration test, render it within its existing provider harness (IndexProvider/TaxonomyProvider/etc.) and assert: header + New button, a row's title link, status badge, a tag chip, the pager range — behavior the new structure preserves.

- [ ] **Step 4: Cumulative gate**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green. Manual run-check is the controller's job (filter/sort/search/page/bulk/columns all still work; animation only on mount/page).

- [ ] **Step 5: Commit**
```bash
git add -A apps/admin
git commit -m "feat(admin): recompose ContentList on shadcn (table, column picker, animation); remove dead list CSS"
```

---

## Self-Review

**Spec coverage:**
- §2 new columns (Tags/Categories), locale auto, author deferred, column picker, padding → Tasks 2/3/4/7. ✓
- §3 columns + sortable Title/Status/Updated + chips + view link → Task 4. ✓
- §4 toolbar (search/Status Select/Category Select/TagFilter restyle/Clear/Columns) → Tasks 5/6. ✓
- §5 table/selection/BulkBar/Pager → Tasks 4/5/6. ✓
- §6 animation (mount+page stagger via `gen`; no stagger on filter/sort) → Task 4 (`gen` keying) + Task 7 (`gen` increments only on page change). ✓
- §7 behavior preserved (state/effects/URL/no-flicker/empty states) → Task 7 keeps all effects verbatim. ✓
- §8 structure + shared `statusBadge`/`relativeTime` move → Task 1 + the `content-list/` split. ✓
- §9 testing → each task. ✓
- §10 non-goals respected (no author, no row-click, index-store untouched, typeaheads restyled-not-rebuilt). ✓

**Placeholder scan:** none — concrete code/commands throughout. The two "verify the installed component's prop" notes (Select `size`) name the exact fallback. Task 7's "let typecheck guide you" for unused imports is a real, bounded instruction, not a placeholder.

**Type consistency:** `ColumnKey` (Task 2) used by ColumnsMenu (3), ContentTable (4), ContentList (7); `useColumnPrefs(multilingual) → {visible, toggle}` consistent; `ContentTable` prop shape (4) matches the call site (7); `statusBadge`/`relativeTime` from `@/lib/*` (Task 1) used in Task 4; `keyOf` format `${collection}/${locale}/${slug}` consistent with the existing selection keys.

**Gating:** Tasks 1–6 additive / in-place signature-compatible (ContentList keeps using its old inline table + the same-signature BulkBar/TagFilter), so the package stays green. Task 7 recomposes + deletes dead CSS, with the cumulative gate. Every task ends with a green typecheck.
