# Bulk Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select multiple entries on the Posts/Pages listing and bulk add/remove a category or tag, or delete — each as one atomic Git commit.

**Architecture:** A core `bulkService` (`applyMetadata` + `deleteEntries`, each one `commitFiles`) over pure metadata mutations; the admin adds row selection + a sticky `BulkBar` that calls the service, reindexes affected entries, and re-queries.

**Tech Stack:** TypeScript, React 18, Vitest + @testing-library/react.

## Global Constraints

- **Immediate commit:** each bulk action applies to every selected entry's current editable content (`read.loadForEdit`) and commits all in ONE `commitFiles`.
- **Action set (v1):** Add category, Remove category, Add tag, Remove tag, Delete. No status/author/select-all-matching/undo.
- **Selection is current-page-scoped** (ephemeral React `Set<string>` of `collection/locale/slug` keys), cleared on filter/page/collection change and after an action. Header "select all on this page".
- **Heads-up count:** entries with unpublished changes = `row.hasDraft && row.lifecycle.state !== 'live'`. Surface the count for metadata actions (informational).
- **Delete confirms** ("Delete N entries? This commits their removal."); metadata actions do not.
- **Atomic, skip-absent:** `read.loadForEdit` returning `absent` → skip + report; everything else commits in one batch. Single-writer assumption (no per-entry external-conflict detection).
- **Tags normalized** via `normalizeTag`; categories are slugs.
- Core tests colocate `src/**/*.test.ts`; admin tests under `apps/admin/test/`.
- Spec: `docs/superpowers/specs/2026-06-20-setu-bulk-operations-design.md`.

---

### Task 1: Core — pure metadata mutations

**Files:**
- Create: `packages/core/src/bulk/mutations.ts`
- Test: `packages/core/src/bulk/mutations.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export)

**Interfaces:**
- Produces: `addCategory(meta, slug)`, `removeCategory(meta, slug)`, `addTag(meta, rawTag)`, `removeTag(meta, rawTag)` — each `(meta: Record<string, unknown>, …) => Record<string, unknown>`, returning a NEW object (or the same ref unchanged when a no-op).

- [ ] **Step 1: Write the failing test**

`packages/core/src/bulk/mutations.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { addCategory, removeCategory, addTag, removeTag } from './mutations'

describe('bulk metadata mutations', () => {
  it('addCategory appends a slug, deduped; absent/non-array → []', () => {
    expect(addCategory({}, 'react')).toEqual({ categories: ['react'] })
    expect(addCategory({ categories: ['react'] }, 'vue')).toEqual({ categories: ['react', 'vue'] })
    expect(addCategory({ categories: ['react'] }, 'react')).toEqual({ categories: ['react'] })
  })
  it('addCategory returns the SAME object when already present (no-op)', () => {
    const m = { categories: ['react'] }
    expect(addCategory(m, 'react')).toBe(m)
  })
  it('removeCategory drops a slug; no-op when absent', () => {
    expect(removeCategory({ categories: ['react', 'vue'] }, 'react')).toEqual({ categories: ['vue'] })
    const m = { categories: ['vue'] }
    expect(removeCategory(m, 'react')).toBe(m)
  })
  it('addTag normalizes then appends, deduped; empty after normalize → no-op', () => {
    expect(addTag({}, 'React Native')).toEqual({ tags: ['react-native'] })
    const m = { tags: ['react'] }
    expect(addTag(m, 'React')).toBe(m)
    expect(addTag(m, '!!!')).toBe(m)
  })
  it('removeTag normalizes then drops; no-op when absent', () => {
    expect(removeTag({ tags: ['react', 'vue'] }, 'React')).toEqual({ tags: ['vue'] })
    const m = { tags: ['vue'] }
    expect(removeTag(m, 'react')).toBe(m)
  })
  it('preserves other metadata keys', () => {
    expect(addCategory({ title: 'X', categories: [] }, 'a')).toEqual({ title: 'X', categories: ['a'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/bulk/mutations.test.ts`
Expected: FAIL — cannot find module `./mutations`.

- [ ] **Step 3: Implement**

`packages/core/src/bulk/mutations.ts`:
```ts
import { normalizeTag } from '../tags/normalize'

type Meta = Record<string, unknown>

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Add a category slug to `meta.categories` (deduped). No-op (same ref) if present. */
export function addCategory(meta: Meta, slug: string): Meta {
  const cats = asStringArray(meta['categories'])
  if (cats.includes(slug)) return meta
  return { ...meta, categories: [...cats, slug] }
}

/** Remove a category slug. No-op (same ref) if absent. */
export function removeCategory(meta: Meta, slug: string): Meta {
  const cats = asStringArray(meta['categories'])
  if (!cats.includes(slug)) return meta
  return { ...meta, categories: cats.filter((c) => c !== slug) }
}

/** Normalize `rawTag` and add to `meta.tags` (deduped). No-op if empty-after-normalize or present. */
export function addTag(meta: Meta, rawTag: string): Meta {
  const tag = normalizeTag(rawTag)
  if (!tag) return meta
  const tags = asStringArray(meta['tags'])
  if (tags.includes(tag)) return meta
  return { ...meta, tags: [...tags, tag] }
}

/** Normalize `rawTag` and remove from `meta.tags`. No-op if empty-after-normalize or absent. */
export function removeTag(meta: Meta, rawTag: string): Meta {
  const tag = normalizeTag(rawTag)
  if (!tag) return meta
  const tags = asStringArray(meta['tags'])
  if (!tags.includes(tag)) return meta
  return { ...meta, tags: tags.filter((t) => t !== tag) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/bulk/mutations.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Barrel export**

In `packages/core/src/index.ts`, after the tags export (`export { normalizeTag, normalizeTags } …`):
```ts
export { addCategory, removeCategory, addTag, removeTag } from './bulk/mutations'
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bulk/mutations.ts packages/core/src/bulk/mutations.test.ts packages/core/src/index.ts
git commit -m "feat(bulk): pure category/tag metadata mutations"
```

---

### Task 2: Core — bulkService

**Files:**
- Create: `packages/core/src/bulk/bulk-service.ts`
- Test: `packages/core/src/bulk/bulk-service.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: `DataPort`, `GitPort` (`commitFiles`, `readFile`), `ReadService.loadForEdit`, `GitAuthor`, `FileChange`, `contentPath`, `serializeMdoc`, `tiptapToMarkdoc`.
- Produces:
  - `interface BulkResult { committedSha: string | null; applied: EntryRef[]; skipped: { ref: EntryRef; reason: 'absent' }[] }`
  - `interface BulkDeps { data: DataPort; git: GitPort; read: ReadService; author: GitAuthor }`
  - `interface BulkService { applyMetadata(refs, mutate, message?): Promise<BulkResult>; deleteEntries(refs, message?): Promise<BulkResult> }`
  - `createBulkService(deps: BulkDeps): BulkService`

- [ ] **Step 1: Write the failing test**

`packages/core/src/bulk/bulk-service.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createBulkService } from './bulk-service'
import { createReadService } from '../read/read-service'
import { addCategory } from './mutations'
import { contentPath } from '../publish/content-path'
import { serializeMdoc } from '../markdoc/frontmatter'
import { parseMdoc } from '../markdoc/frontmatter'
import type { TiptapDoc } from '../authoring/types'

const author = { name: 'T', email: 't@x.com' }
const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function setup(seedCommitted: { ref: { collection: string; locale: string; slug: string }; frontmatter: Record<string, unknown>; body: string }[] = []) {
  const git = createMemoryGitPort(seedCommitted.map((s) => ({ path: contentPath(s.ref), content: serializeMdoc({ frontmatter: s.frontmatter, body: s.body }) })))
  const data = createMemoryDataPort()
  const read = createReadService({ data, git })
  const bulk = createBulkService({ data, git, read, author })
  return { git, data, read, bulk }
}

const ref = (slug: string) => ({ collection: 'post', locale: 'en', slug })

describe('bulkService.applyMetadata', () => {
  it('applies a mutation to several entries in ONE commit', async () => {
    const { git, bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'a body' },
      { ref: ref('b'), frontmatter: { title: 'B' }, body: 'b body' },
    ])
    const r = await bulk.applyMetadata([ref('a'), ref('b')], (m) => addCategory(m, 'news'))
    expect(r.applied).toHaveLength(2)
    expect(r.skipped).toEqual([])
    expect(typeof r.committedSha).toBe('string')
    expect(await git.headSha()).toBe(r.committedSha)
    const a = parseMdoc((await git.readFile(contentPath(ref('a'))))!)
    expect(a.frontmatter.categories).toEqual(['news'])
    const b = parseMdoc((await git.readFile(contentPath(ref('b'))))!)
    expect(b.frontmatter.categories).toEqual(['news'])
  })

  it('skips and reports an absent entry', async () => {
    const { bulk } = setup([{ ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }])
    const r = await bulk.applyMetadata([ref('a'), ref('ghost')], (m) => addCategory(m, 'news'))
    expect(r.applied.map((x) => x.slug)).toEqual(['a'])
    expect(r.skipped).toEqual([{ ref: ref('ghost'), reason: 'absent' }])
  })

  it('advances the draft base so a re-edit forks from the new commit', async () => {
    const { data, bulk } = setup([{ ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }])
    const r = await bulk.applyMetadata([ref('a')], (m) => addCategory(m, 'news'))
    const draft = await data.getDraft(ref('a'))
    expect(draft?.baseSha).toBe(r.committedSha)
    expect((draft?.metadata as { categories?: string[] }).categories).toEqual(['news'])
  })
})

describe('bulkService.deleteEntries', () => {
  it('removes committed files + drafts in one commit', async () => {
    const { git, data, bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' },
      { ref: ref('b'), frontmatter: { title: 'B' }, body: 'y' },
    ])
    const r = await bulk.deleteEntries([ref('a'), ref('b')])
    expect(r.applied).toHaveLength(2)
    expect(await git.readFile(contentPath(ref('a')))).toBeNull()
    expect(await git.readFile(contentPath(ref('b')))).toBeNull()
    expect(await data.getDraft(ref('a'))).toBeNull()
  })

  it('deletes a draft-only entry without committing', async () => {
    const { git, data, bulk } = setup()
    await data.saveDraft({ ...ref('d'), content: doc('x'), metadata: { title: 'D' }, baseSha: null })
    const r = await bulk.deleteEntries([ref('d')])
    expect(r.committedSha).toBeNull()
    expect(await data.getDraft(ref('d'))).toBeNull()
    expect(await git.headSha()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/bulk/bulk-service.test.ts`
Expected: FAIL — cannot find module `./bulk-service`.

- [ ] **Step 3: Implement**

`packages/core/src/bulk/bulk-service.ts`:
```ts
import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { GitAuthor, FileChange } from '../git/types'
import type { EntryRef, Draft } from '../data/types'
import type { ReadService } from '../read/types'
import { contentPath } from '../publish/content-path'
import { serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'

export interface BulkResult {
  /** The one commit's sha, or null when nothing was committed. */
  committedSha: string | null
  applied: EntryRef[]
  skipped: { ref: EntryRef; reason: 'absent' }[]
}

export interface BulkDeps {
  data: DataPort
  git: GitPort
  read: ReadService
  author: GitAuthor
}

export interface BulkService {
  /** Apply `mutate` to each entry's metadata and commit all in ONE commit. */
  applyMetadata(
    refs: EntryRef[],
    mutate: (meta: Record<string, unknown>) => Record<string, unknown>,
    message?: string,
  ): Promise<BulkResult>
  /** Delete entries: remove committed files (one commit) + their drafts. */
  deleteEntries(refs: EntryRef[], message?: string): Promise<BulkResult>
}

export function createBulkService(deps: BulkDeps): BulkService {
  const { data, git, read, author } = deps

  return {
    async applyMetadata(refs, mutate, message) {
      const applied: EntryRef[] = []
      const skipped: { ref: EntryRef; reason: 'absent' }[] = []
      const changes: FileChange[] = []
      const pending: { ref: EntryRef; draft: Draft; next: Record<string, unknown>; content: string }[] = []
      for (const ref of refs) {
        const loaded = await read.loadForEdit(ref)
        if (loaded.source === 'absent') {
          skipped.push({ ref, reason: 'absent' })
          continue
        }
        const draft = loaded.draft
        const next = mutate(draft.metadata)
        const content = serializeMdoc({ frontmatter: next, body: tiptapToMarkdoc(draft.content) })
        changes.push({ path: contentPath(ref), content })
        pending.push({ ref, draft, next, content })
        applied.push(ref)
      }
      if (changes.length === 0) return { committedSha: null, applied, skipped }
      const { sha } = await git.commitFiles({
        changes,
        message: message ?? `Bulk update ${applied.length} entr${applied.length === 1 ? 'y' : 'ies'}`,
        author,
      })
      for (const p of pending) {
        await data.saveDraft({ ...p.ref, content: p.draft.content, metadata: p.next, baseSha: sha, baseContent: p.content })
      }
      return { committedSha: sha, applied, skipped }
    },

    async deleteEntries(refs, message) {
      const applied: EntryRef[] = []
      const changes: FileChange[] = []
      for (const ref of refs) {
        const committed = await git.readFile(contentPath(ref))
        if (committed !== null) changes.push({ path: contentPath(ref), delete: true })
        await data.deleteDraft(ref)
        applied.push(ref)
      }
      let committedSha: string | null = null
      if (changes.length > 0) {
        const { sha } = await git.commitFiles({
          changes,
          message: message ?? `Bulk delete ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'}`,
          author,
        })
        committedSha = sha
      }
      return { committedSha, applied, skipped: [] }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/bulk/bulk-service.test.ts`
Expected: PASS. (If `TiptapDoc` isn't exported from `../authoring/types`, import it from wherever the codebase exports it — `grep -rn "export.*TiptapDoc" packages/core/src` — and adjust the test import.)

- [ ] **Step 5: Barrel export**

In `packages/core/src/index.ts`, after the bulk mutations export:
```ts
export type { BulkService, BulkDeps, BulkResult } from './bulk/bulk-service'
export { createBulkService } from './bulk/bulk-service'
```

- [ ] **Step 6: Verify + commit**

Run: `cd packages/core && pnpm vitest run src/bulk && pnpm typecheck`
Expected: PASS; typecheck clean.
```bash
git add packages/core/src/bulk/bulk-service.ts packages/core/src/bulk/bulk-service.test.ts packages/core/src/index.ts
git commit -m "feat(bulk): bulkService — applyMetadata + deleteEntries (one commit each)"
```

---

### Task 3: Admin — wire `bulk` into the services bundle

**Files:**
- Modify: `apps/admin/src/data/store.tsx` (`Services.bulk` + `servicesFor`)
- Modify (fallout): any test that builds a `Services` literal without `bulk`.

**Interfaces:**
- Consumes: `createBulkService`, `BulkService` from `@setu/core`.
- Produces: `Services.bulk: BulkService`.

- [ ] **Step 1: Add `bulk` to the bundle**

In `apps/admin/src/data/store.tsx`:
- Add to the type imports from `@setu/core`: `BulkService` (type) and `createBulkService` (value).
- Add a module-level author const near the top (after imports):
```ts
/** Editor identity stamped on bulk commits (matches the editor's OWNER_AUTHOR). */
const OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }
```
- Add `bulk: BulkService` to the `Services` interface (after `publish`).
- Rewrite `servicesFor` so `read` is constructed once and reused by `bulk`:
```ts
export function servicesFor(data: DataPort, git: GitPort, index: IndexPort = createMemoryIndexPort()): Services {
  const read = createReadService({ data, git, knownBlockTags: registry.knownBlockTags })
  return {
    data,
    git,
    index,
    read,
    authoring: createAuthoringService({ data }),
    publish: createPublishService({ data, git }),
    bulk: createBulkService({ data, git, read, author: OWNER_AUTHOR }),
  }
}
```

- [ ] **Step 2: Typecheck + fix fallout**

Run: `cd apps/admin && pnpm typecheck`
Expected: FAIL where a test constructs a `Services` literal without `bulk` (e.g. `apps/admin/test/editor-screen.test.tsx`'s `fakeServices`). For each, add `bulk: createBulkService({ data, git, read, author: { name: 'T', email: 't@x.com' } })` (constructing `read` if not already present in that fake, or reuse the fake's `read`). Re-run until typecheck is clean. Then run the full admin suite: `pnpm vitest run` — expected all PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/data/store.tsx apps/admin/test
git commit -m "feat(bulk): expose bulkService in the admin services bundle"
```

---

### Task 4: Admin — listing row selection

**Files:**
- Modify: `apps/admin/src/screens/ContentList.tsx`
- Test: `apps/admin/test/content-list-selection.test.tsx`

**Interfaces:**
- Produces (within `ContentList`): a `selected: Set<string>` keyed by `` `${collection}/${locale}/${slug}` ``; a checkbox column + select-all-page header; a `refreshKey` state (bumped to force re-query); a minimal selection bar ("N selected" + Clear) shown when `selected.size > 0`. (Task 5 replaces the minimal bar with the action `BulkBar`.)

- [ ] **Step 1: Write the failing test**

`apps/admin/test/content-list-selection.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { ContentList } from '../src/screens/ContentList'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function setup() {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'alpha', content: doc('x'), metadata: { title: 'Alpha' } },
    { collection: 'post', locale: 'en', slug: 'beta', content: doc('x'), metadata: { title: 'Beta' } },
  ])
  render(
    <MemoryRouter initialEntries={['/posts']}>
      <ServicesProvider services={servicesFor(data, createMemoryGitPort())}>
        <DeployProvider><IndexProvider><TaxonomyProvider>
          <ContentList collection="post" title="Posts" />
        </TaxonomyProvider></IndexProvider></DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('ContentList — selection', () => {
  it('selects a row and shows the count, then clears', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    expect(await screen.findByText(/1 selected/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/clear selection/i))
    await waitFor(() => expect(screen.queryByText(/selected/i)).toBeNull())
  })

  it('select-all-page toggles every row', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByLabelText('Select all on this page'))
    expect(await screen.findByText(/2 selected/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select all on this page'))
    await waitFor(() => expect(screen.queryByText(/selected/i)).toBeNull())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/content-list-selection.test.tsx`
Expected: FAIL — no checkboxes / no "N selected".

- [ ] **Step 3: Add selection to ContentList**

In `apps/admin/src/screens/ContentList.tsx`:

Add state (after the existing `useState`s):
```ts
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
```
Add a key helper (near `parseSort`, module scope):
```ts
const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`
```
Clear selection whenever the view changes — extend the page-reset effect's body:
```ts
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [collection, q, status, locale, category, tag, sortRaw])
```
Add `refreshKey` to the query effect's dependency array (so an action can force a re-query):
```ts
  }, [index, collection, page, q, status, locale, category, tag, sort.key, sort.dir, refreshKey])
```
Selection helpers (in the component body):
```ts
  const toggleRow = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const pageKeys = (rows ?? []).map(keyOf)
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () =>
    setSelected((prev) => {
      if (pageKeys.every((k) => prev.has(k))) return new Set()
      return new Set(pageKeys)
    })
```
Add a checkbox header cell as the FIRST `<th>` in the table head row:
```tsx
                  <th className="ctable-check">
                    <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} />
                  </th>
```
Add a checkbox cell as the FIRST `<td>` in each row (inside `rows.map`):
```tsx
                      <td className="ctable-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(keyOf(row))}
                          onChange={() => toggleRow(keyOf(row))}
                        />
                      </td>
```
Render a minimal selection bar directly above the `list-wrap`/table (inside `page-body`, after the toolbar) when something is selected:
```tsx
        {selected.size > 0 && (
          <div className="bulk-bar">
            <span>{selected.size} selected</span>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/content-list-selection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full admin suite + typecheck**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS (existing content-list tests still pass — the added column/bar don't change their assertions; if a test counts cells, adjust only if it genuinely broke).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/screens/ContentList.tsx apps/admin/test/content-list-selection.test.tsx
git commit -m "feat(bulk): listing row selection + select-all-page"
```

---

### Task 5: Admin — BulkBar actions

**Files:**
- Create: `apps/admin/src/screens/BulkBar.tsx`
- Create: `apps/admin/test/bulk-bar.test.tsx`
- Modify: `apps/admin/src/screens/ContentList.tsx` (render `BulkBar` in place of the minimal bar)

**Interfaces:**
- Consumes: `useServices().bulk`, `useIndex()` (`reindexEntry`), `useTaxonomy()` (`categories`), `buildTree`, `addCategory`/`removeCategory`/`addTag`/`removeTag` from `@setu/core`, `ContentRow`.
- Produces: `BulkBar({ rows, selected, onClear, onDone }: { rows: ContentRow[]; selected: Set<string>; onClear: () => void; onDone: () => void })`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/bulk-bar.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ContentRow, TiptapDoc } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { BulkBar } from '../src/screens/BulkBar'

const row = (slug: string, over: Partial<ContentRow> = {}): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug, locale: 'en', lifecycle: { state: 'live' }, updatedAt: 1, hasDraft: false, tags: [], categories: [],
  ...over,
})

function setup(rows: ContentRow[]) {
  // seed committed files so loadForEdit can fork them
  const git = createMemoryGitPort(rows.map((r) => ({ path: contentPath(r.ref), content: serializeMdoc({ frontmatter: { title: r.title }, body: 'x' }) })))
  const data = createMemoryDataPort()
  const services = servicesFor(data, git)
  const onDone = vi.fn()
  const onClear = vi.fn()
  const selected = new Set(rows.map((r) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`))
  render(
    <ServicesProvider services={services}>
      <DeployProvider><IndexProvider><TaxonomyProvider>
        <BulkBar rows={rows} selected={selected} onClear={onClear} onDone={onDone} />
      </TaxonomyProvider></IndexProvider></DeployProvider>
    </ServicesProvider>,
  )
  return { git, data, onDone, onClear }
}

describe('BulkBar', () => {
  it('adds a tag to all selected entries and calls onDone', async () => {
    const { git, onDone } = setup([row('a'), row('b')])
    fireEvent.change(screen.getByLabelText('Bulk tag'), { target: { value: 'news' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const { parseMdoc } = await import('@setu/core')
    const a = parseMdoc((await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' })))!)
    expect(a.frontmatter.tags).toEqual(['news'])
  })

  it('shows the unpublished-changes heads-up count', () => {
    setup([row('a', { hasDraft: true, lifecycle: { state: 'staged' } }), row('b')])
    expect(screen.getByText(/1 of 2 have unpublished changes/i)).toBeTruthy()
  })

  it('deletes selected entries after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { git, onDone } = setup([row('a')])
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/bulk-bar.test.tsx`
Expected: FAIL — cannot find module `../src/screens/BulkBar`.

- [ ] **Step 3: Implement BulkBar**

`apps/admin/src/screens/BulkBar.tsx`:
```tsx
import { useMemo, useState } from 'react'
import type { CategoryNode, ContentRow, EntryRef } from '@setu/core'
import { buildTree, addCategory, removeCategory, addTag, removeTag } from '@setu/core'
import { useServices } from '../data/store'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function BulkBar({
  rows,
  selected,
  onClear,
  onDone,
}: {
  rows: ContentRow[]
  selected: Set<string>
  onClear: () => void
  onDone: () => void
}) {
  const { bulk } = useServices()
  const index = useIndex()
  const { categories } = useTaxonomy()
  const catRows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [cat, setCat] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)))
  const refs: EntryRef[] = selectedRows.map((r) => r.ref)
  const pendingCount = selectedRows.filter((r) => r.hasDraft && r.lifecycle.state !== 'live').length

  const run = async (op: () => Promise<{ applied: EntryRef[]; skipped: { ref: EntryRef }[] }>, verb: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await op()
      for (const ref of r.applied) await index.reindexEntry(ref).catch(() => {})
      setMsg(`${verb} ${r.applied.length}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`)
      onDone()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyCat = (mut: typeof addCategory) => {
    if (!cat) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, cat)), 'Updated')
  }
  const applyTag = (mut: typeof addTag) => {
    if (!tag.trim()) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, tag)), 'Updated')
  }
  const del = () => {
    if (!window.confirm(`Delete ${refs.length} entr${refs.length === 1 ? 'y' : 'ies'}? This commits their removal.`)) return
    void run(() => bulk.deleteEntries(refs), 'Deleted')
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selected.size} selected</span>

      <span className="bulk-group">
        <select aria-label="Bulk category" value={cat} onChange={(e) => setCat(e.target.value)} disabled={busy}>
          <option value="">Category…</option>
          {catRows.map((c) => (
            <option key={c.slug} value={c.slug}>{' '.repeat(c.depth * 2)}{c.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(addCategory)}>Add</button>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(removeCategory)}>Remove</button>
      </span>

      <span className="bulk-group">
        <input type="text" aria-label="Bulk tag" placeholder="Tag…" value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy} />
        <button type="button" className="btn btn-sm" disabled={busy || !tag.trim()} onClick={() => applyTag(addTag)}>Add tag</button>
        <button type="button" className="btn btn-sm" disabled={busy || !tag.trim()} onClick={() => applyTag(removeTag)}>Remove tag</button>
      </span>

      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={del}>Delete</button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onClear}>Clear selection</button>

      {pendingCount > 0 && (
        <span className="bulk-note">{pendingCount} of {selected.size} have unpublished changes that will also go live.</span>
      )}
      {msg && <span className="bulk-msg" role="status">{msg}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/bulk-bar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Render BulkBar in ContentList**

In `apps/admin/src/screens/ContentList.tsx`, add the import:
```tsx
import { BulkBar } from './BulkBar'
```
Replace the minimal selection bar (the `{selected.size > 0 && (<div className="bulk-bar">…</div>)}` block from Task 4) with:
```tsx
        {selected.size > 0 && rows !== null && (
          <BulkBar
            rows={rows}
            selected={selected}
            onClear={() => setSelected(new Set())}
            onDone={() => { setSelected(new Set()); setRefreshKey((k) => k + 1) }}
          />
        )}
```

- [ ] **Step 6: Run the full admin suite + typecheck**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS (the Task 4 selection test still passes — it asserts "N selected" + "Clear selection", both present in BulkBar).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/screens/BulkBar.tsx apps/admin/test/bulk-bar.test.tsx apps/admin/src/screens/ContentList.tsx
git commit -m "feat(bulk): BulkBar actions — add/remove category & tag, delete"
```

---

### Task 6: CSS polish + whole-feature verification

**Files:**
- Modify: `apps/admin/src/styles/` (checkbox column + bulk bar styling)

- [ ] **Step 1: Whole-monorepo verification**

Run (repo root): `pnpm -r test`
Then: `pnpm --filter @setu/site exec astro sync && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean (the `astro sync` is the pre-existing fresh-worktree codegen need; if `apps/site` still fails, confirm it doesn't reference the bulk changes).

- [ ] **Step 2: Style the checkbox column + bulk bar**

Read `apps/admin/src/styles/` (the listing/table styles — `.ctable`, `.list-toolbar` from prior work — and `tokens.css`). Style: `ctable-check` (narrow checkbox column, vertically centered, ~36px), and `bulk-bar` (a horizontal, wrapping row above the table — surface background, border, radius, comfortable gap; `bulk-group` clusters the category/tag controls; `bulk-count` emphasized; `bulk-note` muted/accent; `bulk-msg` muted; `btn-danger` uses an existing danger/red token if present, else the accent — check tokens, don't invent a color). Use ONLY existing design tokens; match the toolbar look. Then:
```bash
git add apps/admin/src/styles
git commit -m "style(bulk): selection column + bulk action bar"
```

- [ ] **Step 3: Manual smoke (dev server)**

Run the admin dev server, open Posts: select rows (and select-all-page); the bulk bar appears; Add/Remove a category and a tag (confirm the listing reflects it after refresh); the unpublished-changes note shows when a staged entry is selected; Delete prompts a confirm then removes the rows. Confirm the bar + checkboxes look clean.

---

## Self-Review

**Spec coverage:**
- Immediate one-commit per action → Task 2 (`commitFiles`). ✓
- Action set (add/remove category & tag, delete) → Task 1 (mutations) + Task 5 (BulkBar wiring). ✓
- Current-page selection + select-all-page + clear-on-change → Task 4. ✓
- Heads-up count (`hasDraft && state !== 'live'`) → Task 5. ✓
- Delete confirm → Task 5. ✓
- Core `bulkService` (`applyMetadata` + `deleteEntries`, skip-absent, advance base) → Task 2. ✓
- Services wiring + post-action reindex + re-query → Task 3 (bundle) + Task 5 (reindex + `onDone`→refreshKey). ✓
- Atomic/skip-absent/no-op → Task 2. ✓
- Non-goals (status/author/select-all-matching/undo) → none built. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Step 6.2 (CSS) is open-ended by nature but names exact classes + token conventions. The `TiptapDoc` import path in Task 2's test has a fallback grep instruction (the export location is verified to exist; the grep covers a differing path).

**Type consistency:** `BulkResult`/`BulkDeps`/`BulkService` consistent across service/barrel/wiring; `applyMetadata(refs, mutate, message?)` + `deleteEntries(refs, message?)` identical in service and BulkBar calls; mutation signatures `(meta, slug|rawTag)` match BulkBar usage; `keyOf` format `collection/locale/slug` identical in ContentList + BulkBar; `Services.bulk` consumed via `useServices().bulk`.
