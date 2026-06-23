# Taxonomies hub — Tags tab (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tags tab placeholder with a searchable/sortable list of all tags (with usage counts) supporting rename, merge (rename-to-existing), and delete — all as atomic content rewrites.

**Architecture:** Two new IndexPort scan methods (`tagCounts`, `entriesByTag`) mirror PR 1's category methods. Rename/delete are pure content rewrites composed in a new `useTags` admin hook from the existing `BulkService.applyMetadata` (one atomic commit) + the bulk `addTag`/`removeTag` mutations + per-ref reindex (the `BulkBar` precedent). No registry, no new core service.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, shadcn/ui, `@setu/core`, `@setu/db-memory`, `@setu/db-idb`, `@setu/db-testing`.

## Global Constraints

- Tags are normalized via `normalizeTag` (lowercase, hyphenate, strip punctuation). Stored as `metadata.tags: string[]`. There is NO tag registry and NO "unused" tag (every listed tag has count ≥ 1).
- New IndexPort methods MUST be implemented in BOTH `db-memory` and `db-idb`, delegate to a single shared pure helper (cf. `selectCategoryCounts`/`selectEntriesByCategory`), and get a case in the shared `runIndexPortContract` suite (`packages/db-testing/src/index.ts`; its row factory is `irow`, the port under test is `ix`).
- Barrel exports: bulk mutations are aliased — use `bulkAddTag` / `bulkRemoveTag` (NOT `addTag`/`removeTag`, which are unexported names internal to bulk/mutations). The new index helpers export un-aliased (`selectTagCounts`, `selectEntriesByTag`).
- `BulkService.applyMetadata(refs, mutate, message)` commits all in ONE commit and saves drafts but does NOT reindex — the caller reindexes each `result.applied` ref via `index.reindexEntry(ref)` (mirror `apps/admin/src/screens/BulkBar.tsx`).
- Loose/modern aesthetic per `docs/.../setu-admin-visual-aesthetic`: generous rows, 15px medium tag name, sentence-case muted header, faint dividers (`border-border/40`-ish), `--primary` indigo, restrained (no drag-drop). Reuse shadcn `Input`/`Select`/`Button`/`AlertDialog`.
- Provider order: `TagsProvider` mounts INSIDE `IndexProvider` (it calls `useIndex()`), same as `TaxonomyProvider`. Add it in `apps/admin/src/main.tsx` next to `TaxonomyProvider`, and any test harness that renders the Tags tab must include it.
- Full gate before "done": `pnpm typecheck && pnpm test && pnpm build` ALL green. NOTE: `vitest` does not typecheck — a per-package `test` pass is NOT a typecheck pass; the final gate must run `pnpm typecheck` too.

---

### Task 1: Core — `tagCounts` (IndexPort)

**Files:**
- Create: `packages/core/src/index-port/tag-counts.ts`
- Create: `packages/core/src/index-port/tag-counts.test.ts`
- Modify: `packages/core/src/index-port/types.ts` (IndexPort interface)
- Modify: `packages/core/src/index-port/index-service.ts` (IndexService interface + passthrough)
- Modify: `packages/core/src/index.ts` (barrel)
- Modify: `packages/db-memory/src/index-port.ts`, `packages/db-idb/src/index-port.ts`
- Modify: `packages/db-testing/src/index.ts` (contract)

**Interfaces:**
- Produces: `selectTagCounts(rows: EntryIndexRow[]): Record<string, number>` — count of entries whose `tags` include each tag; zero-usage tags absent.
- Produces: `IndexPort.tagCounts(): Promise<Record<string, number>>` and `IndexService.tagCounts(): Promise<Record<string, number>>`.

This is structurally identical to the shipped `categoryCounts` (commit on `main`); read `packages/core/src/index-port/category-counts.ts` and how it threads through every layer, and mirror it over `r.tags`.

- [ ] **Step 1: Write the failing helper test**

`tag-counts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectTagCounts } from './tag-counts'
import type { EntryIndexRow } from './types'

const row = (key: string, tags: string[]): EntryIndexRow => ({
  key, collection: 'post', locale: 'en', slug: key, title: key, titleLower: key,
  status: 'draft', updatedAt: 0, hasDraft: true, tags, categories: [], mediaRefs: [],
})

describe('selectTagCounts', () => {
  it('counts entries per tag across rows', () => {
    expect(selectTagCounts([row('a', ['react', 'css']), row('b', ['react']), row('c', [])]))
      .toEqual({ react: 2, css: 1 })
  })
  it('returns an empty map when no row has tags', () => {
    expect(selectTagCounts([row('a', []), row('b', [])])).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- tag-counts.test.ts`
Expected: FAIL — cannot find module `./tag-counts`.

- [ ] **Step 3: Implement the helper**

`tag-counts.ts`:

```ts
import type { EntryIndexRow } from './types'

/** Usage count per tag across all rows. Tags with zero usage are absent. Shared
 *  pure impl, used by every IndexPort adapter (cf. selectCategoryCounts). */
export function selectTagCounts(rows: EntryIndexRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) for (const t of r.tags) counts[t] = (counts[t] ?? 0) + 1
  return counts
}
```

- [ ] **Step 4: Wire all layers**

- `types.ts` `IndexPort` (after `distinctLocales`): `tagCounts(): Promise<Record<string, number>>`
- `index-service.ts`: add `tagCounts(): Promise<Record<string, number>>` to the `IndexService` interface AND `async function tagCounts() { return index.tagCounts() }` plus it in the returned object.
- `index.ts` barrel: `export { selectTagCounts } from './index-port/tag-counts'`
- `db-memory/src/index-port.ts`: import `selectTagCounts`; add `async tagCounts() { return selectTagCounts([...rows.values()]) }`
- `db-idb/src/index-port.ts`: import `selectTagCounts`; add `async tagCounts() { const all = (await db.getAll('entries')) as EntryIndexRow[]; return selectTagCounts(all) }`

- [ ] **Step 5: Extend the contract**

In `packages/db-testing/src/index.ts`, after the `categoryCounts` contract case, add (using the suite's real `irow` factory + `ix` port):

```ts
  it('tagCounts tallies usage across rows', async () => {
    await ix.upsertMany([
      { ...irow('a'), tags: ['react', 'css'] },
      { ...irow('b'), tags: ['react'] },
    ])
    expect(await ix.tagCounts()).toEqual({ react: 2, css: 1 })
  })
```
(If `irow` does not set `tags`, spread it and override `tags` as shown. Match the exact factory/port names already in the file.)

- [ ] **Step 6: Run affected suites**

Run: `pnpm --filter @setu/core test -- tag-counts.test.ts && pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index-port/tag-counts.ts packages/core/src/index-port/tag-counts.test.ts packages/core/src/index-port/types.ts packages/core/src/index-port/index-service.ts packages/core/src/index.ts packages/db-memory/src/index-port.ts packages/db-idb/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(core): tagCounts on IndexPort (+ both adapters, contract)"
```

---

### Task 2: Core — `entriesByTag` (IndexPort)

**Files:** mirror Task 1's file set with `entries-by-tag` names.

**Interfaces:**
- Produces: `selectEntriesByTag(rows: EntryIndexRow[], tag: string): EntryRef[]` — refs (`{collection,locale,slug}`) of every entry whose `tags` include `tag`.
- Produces: `IndexPort.entriesByTag(tag): Promise<EntryRef[]>` and `IndexService.entriesByTag(tag): Promise<EntryRef[]>`.

Structurally identical to the shipped `entriesByCategory`; read `packages/core/src/index-port/entries-by-category.ts` and mirror over `r.tags`.

- [ ] **Step 1: Write the failing helper test**

`entries-by-tag.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectEntriesByTag } from './entries-by-tag'
import type { EntryIndexRow } from './types'

const row = (collection: string, slug: string, tags: string[]): EntryIndexRow => ({
  key: `${collection}/${slug}`, collection, locale: 'en', slug, title: slug, titleLower: slug,
  status: 'draft', updatedAt: 0, hasDraft: true, tags, categories: [], mediaRefs: [],
})

describe('selectEntriesByTag', () => {
  it('returns refs across collections that include the tag', () => {
    expect(selectEntriesByTag([row('post', 'a', ['react']), row('page', 'b', ['react', 'css']), row('post', 'c', ['css'])], 'react'))
      .toEqual([
        { collection: 'post', locale: 'en', slug: 'a' },
        { collection: 'page', locale: 'en', slug: 'b' },
      ])
  })
  it('returns [] when no entry uses the tag', () => {
    expect(selectEntriesByTag([row('post', 'a', ['x'])], 'react')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- entries-by-tag.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the helper**

`entries-by-tag.ts`:

```ts
import type { EntryRef } from '../data/types'
import type { EntryIndexRow } from './types'

/** Refs of every entry whose tags include `tag` (across collections/locales).
 *  Shared pure impl for every IndexPort adapter (cf. selectEntriesByCategory). */
export function selectEntriesByTag(rows: EntryIndexRow[], tag: string): EntryRef[] {
  return rows
    .filter((r) => r.tags.includes(tag))
    .map((r) => ({ collection: r.collection, locale: r.locale, slug: r.slug }))
}
```

- [ ] **Step 4: Wire all layers** (mirror Task 1 Step 4)

- `types.ts` `IndexPort`: `entriesByTag(tag: string): Promise<EntryRef[]>`
- `index-service.ts`: interface + `async function entriesByTag(tag: string) { return index.entriesByTag(tag) }` + return.
- `index.ts`: `export { selectEntriesByTag } from './index-port/entries-by-tag'`
- db-memory: `async entriesByTag(tag) { return selectEntriesByTag([...rows.values()], tag) }`
- db-idb: `async entriesByTag(tag) { const all = (await db.getAll('entries')) as EntryIndexRow[]; return selectEntriesByTag(all, tag) }`

- [ ] **Step 5: Extend the contract**

After the `entriesByCategory` contract case, add an `entriesByTag` case seeding two rows with `tags` and asserting the returned refs (sort slugs for adapter-order-agnostic comparison, mirroring the `entriesByCategory` case).

- [ ] **Step 6: Run affected suites**

Run: `pnpm --filter @setu/core test -- entries-by-tag.test.ts && pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/core/src/index-port packages/core/src/index.ts packages/db-memory/src/index-port.ts packages/db-idb/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(core): entriesByTag on IndexPort (+ both adapters, contract)"
```

---

### Task 3: Admin — `useTags` store (rename/merge + delete + counts)

**Files:**
- Create: `apps/admin/src/data/tags-store.tsx`
- Create: `apps/admin/test/tags-store.test.tsx`
- Modify: `apps/admin/src/main.tsx` (mount `TagsProvider` inside `IndexProvider`)

**Interfaces:**
- Consumes: `useServices()` → `bulk` (BulkService); `useIndex()` → IndexService (`tagCounts`, `entriesByTag`, `reindexEntry`); `bulkAddTag`/`bulkRemoveTag`/`normalizeTag` from `@setu/core`.
- Produces: `useTags()` → `{ counts: Record<string,number>; rename(from,to): Promise<{applied:number; merged:boolean}>; remove(tag): Promise<{applied:number}> }`.

- [ ] **Step 1: Write the failing store test**

`tags-store.test.tsx` — follow the harness in `apps/admin/test/taxonomy-store.test.tsx` (ServicesProvider → DeployProvider → IndexProvider → the new TagsProvider; seed drafts in the DataPort; `await idx.rebuild()` so the index is live). Cover three cases:

```ts
// pure rename: seed 2 posts tagged 'react'; rename('react','reactjs')
//   → counts.react undefined, counts.reactjs === 2, result.merged === false, result.applied === 2
// merge: seed post A tags ['react','reactjs'], post B tags ['react']; rename('react','reactjs')
//   → counts.react undefined, counts.reactjs === 2 (A dedupes to one 'reactjs', B becomes 'reactjs')
//   → result.merged === true
// delete: seed 2 posts tagged 'css'; remove('css') → counts.css undefined; result.applied === 2
```
Assert by reading `result.current.counts` after `await act(async () => { ... })`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- tags-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

`tags-store.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { bulkAddTag, bulkRemoveTag, normalizeTag } from '@setu/core'
import { useServices } from './store'
import { useIndex } from './index-store'

export interface TagsContextValue {
  counts: Record<string, number>
  rename(from: string, to: string): Promise<{ applied: number; merged: boolean }>
  remove(tag: string): Promise<{ applied: number }>
}

const TagsContext = createContext<TagsContextValue | null>(null)

export function TagsProvider({ children }: { children: ReactNode }) {
  const { bulk } = useServices()
  const index = useIndex()
  const [counts, setCounts] = useState<Record<string, number>>({})

  const refreshCounts = useCallback(() => {
    void index.tagCounts().then(setCounts).catch(() => {})
  }, [index])

  useEffect(() => { refreshCounts() }, [refreshCounts])

  const rename = useCallback(
    async (from: string, to: string) => {
      const target = normalizeTag(to)
      if (target === '' || target === from) return { applied: 0, merged: false }
      const merged = counts[target] !== undefined
      const refs = await index.entriesByTag(from)
      const res = await bulk.applyMetadata(refs, (m) => bulkAddTag(bulkRemoveTag(m, from), target), `tags: rename ${from} → ${target}`)
      for (const ref of res.applied) await index.reindexEntry(ref).catch(() => {})
      refreshCounts()
      return { applied: res.applied.length, merged }
    },
    [bulk, index, counts, refreshCounts],
  )

  const remove = useCallback(
    async (tag: string) => {
      const refs = await index.entriesByTag(tag)
      const res = await bulk.applyMetadata(refs, (m) => bulkRemoveTag(m, tag), `tags: delete ${tag}`)
      for (const ref of res.applied) await index.reindexEntry(ref).catch(() => {})
      refreshCounts()
      return { applied: res.applied.length }
    },
    [bulk, index, refreshCounts],
  )

  const value = useMemo<TagsContextValue>(() => ({ counts, rename, remove }), [counts, rename, remove])
  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>
}

export function useTags(): TagsContextValue {
  const ctx = useContext(TagsContext)
  if (ctx === null) throw new Error('useTags must be used within a TagsProvider')
  return ctx
}
```

- [ ] **Step 4: Mount the provider**

In `apps/admin/src/main.tsx`, import `TagsProvider` and nest it inside `IndexProvider` (alongside/within the existing `TaxonomyProvider` block — order among siblings doesn't matter as long as both are inside `IndexProvider`):

```tsx
<IndexProvider>
  <AppMediaIndexProvider>
    <TaxonomyProvider>
      <TagsProvider>
        {/* existing children */}
      </TagsProvider>
    </TaxonomyProvider>
  </AppMediaIndexProvider>
</IndexProvider>
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- tags-store`
Expected: PASS (pure rename, merge-dedupe, delete).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/data/tags-store.tsx apps/admin/test/tags-store.test.tsx apps/admin/src/main.tsx
git commit -m "feat(admin): useTags store — rename/merge + delete + counts"
```

---

### Task 4: Admin — Tags tab UI (list + search/sort + rename + merge/delete dialogs)

**Files:**
- Modify: `apps/admin/src/screens/taxonomies/TagsTab.tsx` (replace the placeholder)
- Create: `apps/admin/src/screens/taxonomies/TagToolbar.tsx`
- Create: `apps/admin/src/screens/taxonomies/TagList.tsx`
- Create: `apps/admin/src/screens/taxonomies/DeleteTagDialog.tsx`
- Create: `apps/admin/src/screens/taxonomies/MergeTagDialog.tsx`
- Create: `apps/admin/src/screens/taxonomies/TagsTab.test.tsx`

**Interfaces:**
- Consumes: `useTags()` (Task 3); shadcn `Input`, `Select`, `Button`, `AlertDialog` (`apps/admin/src/components/ui/alert-dialog.tsx` exists from PR 1); `useNotify` (`../../ui/notify`); lucide `Search`/`Trash2`.
- Produces: a working Tags tab.

- [ ] **Step 1: Write the failing component test**

`TagsTab.test.tsx` — render inside the same provider harness used by `CategoriesTab.test.tsx` (now including `TagsProvider`), seeded with entries tagged so `tagCounts` returns e.g. `{ react: 2, css: 1 }`. Cover:

```ts
// renders tags with counts, sorted most-used first (react before css)
// search 'cs' filters to only 'css'
// inline-rename 'css' to a NEW name 'styles' → calls useTags().rename (no merge dialog), toast
// inline-rename 'react' to existing 'css' → opens merge dialog; confirming calls rename
// delete 'css' → opens delete dialog; confirming calls remove
// empty state when counts is empty
```
Use the Radix interaction workarounds established in PR 1's taxonomy tests (Space-to-open Select, `scrollIntoView` stub, `mouseDown` for tabs).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- TagsTab`
Expected: FAIL.

- [ ] **Step 3: Build `TagToolbar`**

```tsx
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

export type TagSort = 'count' | 'alpha'

export function TagToolbar({ q, onQ, sort, onSort }: {
  q: string; onQ: (v: string) => void; sort: TagSort; onSort: (s: TagSort) => void
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="relative max-w-xs flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search tags" value={q} onChange={(e) => onQ(e.target.value)} />
      </div>
      <span className="text-sm text-muted-foreground">Sort</span>
      <Select value={sort} onValueChange={(v) => onSort(v as TagSort)}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="count">Most used</SelectItem>
          <SelectItem value="alpha">A–Z</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 4: Build `TagList` (+ row with inline rename)**

```tsx
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type TagRow = { tag: string; count: number }

export function TagList({ rows, onRename, onDelete }: {
  rows: TagRow[]
  onRename: (from: string, to: string) => void
  onDelete: (row: TagRow) => void
}) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex items-center border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[12.5px] text-muted-foreground">
        <div className="flex-1">Tag</div>
        <div className="w-28">Used by</div>
        <div className="w-10" />
      </div>
      {rows.map((r) => (
        <div key={r.tag} className="flex items-center border-b border-border/40 px-4 py-3 last:border-0">
          <div className="flex-1">
            <input
              key={`tag:${r.tag}`}
              defaultValue={r.tag}
              aria-label={`Rename ${r.tag}`}
              className="bg-transparent text-[15px] font-medium outline-none focus:underline"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.tag) onRename(r.tag, v) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <div className="w-28 text-[13px] text-muted-foreground">{r.count} {r.count === 1 ? 'entry' : 'entries'}</div>
          <div className="w-10 text-right">
            <Button variant="ghost" size="icon" aria-label={`Delete ${r.tag}`} onClick={() => onDelete(r)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Build `DeleteTagDialog` + `MergeTagDialog`**

`DeleteTagDialog.tsx`:

```tsx
import type { TagRow } from './TagList'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'

export function DeleteTagDialog({ row, onClose }: { row: TagRow | null; onClose: () => void }) {
  const { remove } = useTags()
  const notify = useNotify()
  const confirm = async () => {
    if (!row) return
    try { await remove(row.tag) } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
    onClose()
  }
  return (
    <AlertDialog open={row !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{row?.tag}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {row ? `Used by ${row.count} ${row.count === 1 ? 'entry' : 'entries'} — this removes the tag from ${row.count === 1 ? 'that entry' : 'them'}.` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

`MergeTagDialog.tsx` (shown when a rename target already exists):

```tsx
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'

export type PendingMerge = { from: string; to: string; fromCount: number; toCount: number }

export function MergeTagDialog({ pending, onClose }: { pending: PendingMerge | null; onClose: () => void }) {
  const { rename } = useTags()
  const notify = useNotify()
  const confirm = async () => {
    if (!pending) return
    try {
      const { applied } = await rename(pending.from, pending.to)
      notify.success(`Merged “${pending.from}” into “${pending.to}” across ${applied} ${applied === 1 ? 'entry' : 'entries'}`)
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
    onClose()
  }
  return (
    <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge into “{pending?.to}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending ? `“${pending.to}” already exists (${pending.toCount} ${pending.toCount === 1 ? 'entry' : 'entries'}). Renaming “${pending.from}” (${pending.fromCount}) merges them — this can’t be auto-undone.` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>Merge</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```
> `useNotify().success` — confirm the method name against `apps/admin/src/ui/notify`; if it only exposes `error`/`info`, use the available equivalent for the success toast.

- [ ] **Step 6: Build `TagsTab` (compose everything)**

```tsx
import { useMemo, useState } from 'react'
import { normalizeTag } from '@setu/core'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'
import { TagToolbar, type TagSort } from './TagToolbar'
import { TagList, type TagRow } from './TagList'
import { DeleteTagDialog } from './DeleteTagDialog'
import { MergeTagDialog, type PendingMerge } from './MergeTagDialog'

export function TagsTab() {
  const { counts, rename } = useTags()
  const notify = useNotify()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<TagSort>('count')
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null)
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null)

  const rows = useMemo<TagRow[]>(() => {
    const all = Object.entries(counts).map(([tag, count]) => ({ tag, count }))
    const filtered = q.trim() ? all.filter((r) => r.tag.includes(q.trim().toLowerCase())) : all
    filtered.sort((a, b) => sort === 'alpha' ? a.tag.localeCompare(b.tag) : (b.count - a.count || a.tag.localeCompare(b.tag)))
    return filtered
  }, [counts, q, sort])

  const onRename = async (from: string, to: string) => {
    const target = normalizeTag(to)
    if (!target || target === from) return
    if (counts[target] !== undefined) {
      setPendingMerge({ from, to: target, fromCount: counts[from] ?? 0, toCount: counts[target] })
      return
    }
    try {
      const { applied } = await rename(from, target)
      notify.success(`Renamed “${from}” → “${target}” across ${applied} ${applied === 1 ? 'entry' : 'entries'}`)
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
  }

  if (Object.keys(counts).length === 0) {
    return <p className="text-sm text-muted-foreground">Tags appear here as you add them to content.</p>
  }

  return (
    <div>
      <TagToolbar q={q} onQ={setQ} sort={sort} onSort={setSort} />
      <TagList rows={rows} onRename={onRename} onDelete={setPendingDelete} />
      <div className="mt-3.5 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
        Renaming a tag to a name that already exists merges them — you’ll be asked to confirm first.
      </div>
      <DeleteTagDialog row={pendingDelete} onClose={() => setPendingDelete(null)} />
      <MergeTagDialog pending={pendingMerge} onClose={() => setPendingMerge(null)} />
    </div>
  )
}
```
> Note: the merge-on-rename detection lives in `TagsTab.onRename` (it has `counts`), so the inline edit opens `MergeTagDialog` instead of calling `rename` directly. The store's `rename` also recomputes `merged` defensively, but the UI gate is what surfaces the confirm.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- TagsTab`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/screens/taxonomies/TagsTab.tsx apps/admin/src/screens/taxonomies/TagToolbar.tsx apps/admin/src/screens/taxonomies/TagList.tsx apps/admin/src/screens/taxonomies/DeleteTagDialog.tsx apps/admin/src/screens/taxonomies/MergeTagDialog.tsx apps/admin/src/screens/taxonomies/TagsTab.test.tsx
git commit -m "feat(admin): Tags tab — list, search/sort, rename, merge, delete"
```

---

### Task 5: Full gate + polish sweep

**Files:** none expected (verification task; fix anything the gate surfaces).

- [ ] **Step 1: Run the full gate**

Run from repo root: `pnpm typecheck && pnpm test && pnpm build`
Expected: ALL green. `pnpm typecheck` MUST pass (vitest does not typecheck — catch any `Set`/type mismatch here). Note the admin test count.

- [ ] **Step 2: Confirm no placeholder remnants**

Run: `grep -rn "coming soon\|Coming soon" apps/admin/src/screens/taxonomies/` — expect zero matches (the placeholder copy is gone; the real TagsTab replaced it).

- [ ] **Step 3: Manual sanity (optional, if a dev server is running)**

Switch to the Tags tab: list shows tags + counts, search filters, sort toggles, inline rename of a new name toasts, rename to an existing tag prompts merge, delete prompts then untags. (Reviewer-level confidence comes from Task 4 tests; this is a spot check.)

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(admin): Tags tab gate fixes"
```
(Skip the commit if the gate was already green with no changes.)

---

## Self-Review

**Spec coverage:**
- `tagCounts` (list + counts source) → Task 1. ✓
- `entriesByTag` (rewrite targets) → Task 2. ✓
- `useTags` rename/merge (single closure `bulkAddTag(bulkRemoveTag(m,from),target)`) + delete + counts refresh + reindex → Task 3. ✓
- Tags tab: list + search + sort + inline rename + merge confirm + delete confirm + empty state + merge hint → Task 4. ✓
- Atomic rewrite via `applyMetadata` (one commit) + caller reindex → Tasks 3/4. ✓
- Full gate incl. typecheck → Task 5. ✓
- Out of scope (multi-select merge, registry) → not built. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Two `>` notes (Task 1 `irow.tags` spread; Task 5 `useNotify.success` name) flag real-code alignment the executor resolves against the repo, naming the exact file — not skipped work.

**Type consistency:** `tagCounts`/`entriesByTag` identical across port/service/adapters/contract. `useTags` returns `{counts, rename, remove}` with the signatures used in Task 4. `TagRow = {tag, count}` and `PendingMerge = {from,to,fromCount,toCount}` consistent across TagList/TagsTab/dialogs. `bulkAddTag`/`bulkRemoveTag`/`normalizeTag` are the real barrel names (verified in `packages/core/src/index.ts`).
