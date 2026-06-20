# Listing Findability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Posts/Pages listing findable — a filter toolbar (search, status, locale, category, tag), sortable columns, and URL-persisted filter state.

**Architecture:** Extend the content-index projection to carry categories (mirroring tags), add `tag`/`category` filters to the pure `runQuery`, add a `distinctLocales` query, then rewrite `ContentList` to drive an `IndexQuery` from URL search params with a filter toolbar + sortable headers.

**Tech Stack:** TypeScript, React 18, react-router-dom (`useSearchParams`), idb, Vitest + @testing-library/react.

## Global Constraints

- **Single-select per filter, AND-combined**, plus a debounced search box. No multi-select / any-vs-all.
- **Filters live in the URL** via `useSearchParams`. Recognized params: `q`, `status`, `locale`, `category`, `tag`, `sort`. Absent param = no filter / default sort. Changing any param resets pagination to page 0.
- **`sort` param format:** `<key>-<dir>`, key ∈ {`updatedAt`,`title`,`status`}, dir ∈ {`asc`,`desc`}; default `updatedAt-desc`. Unrecognized → default.
- **Category filtering needs the index projection extended to carry categories** (slugs); `INDEX_VERSION` bumps 2→3.
- **Tag filter is a typeahead** reusing `distinctTags`; status/locale/category are bounded `<select>`s. Locale options come from `distinctLocales` (index-derived — the admin has no locale config). Category options come from `useTaxonomy()`.
- **Lifecycle states:** `draft` | `staged` | `live` | `unpublished`.
- **Cloudflare-Pages-compatible + cost-safe:** pure functions + existing ports/adapters only; no new runtime deps.
- **Core tests colocate** as `src/**/*.test.ts`; **admin tests live in `apps/admin/test/**`** (relative import depth: `../src/...`).
- Spec: `docs/superpowers/specs/2026-06-20-setu-findability-design.md`.

---

### Task 1: Project categories into the content index

**Files:**
- Modify: `packages/core/src/content-index/list-entries.ts` (`categories` on `ContentRow`, `categoriesOf` helper)
- Modify: `packages/core/src/index-port/types.ts` (`categories` on `EntryIndexRow`, `projectRow`, `rowToContentRow`)
- Modify: `packages/core/src/index-port/index-service.ts` (`INDEX_VERSION` 2→3)
- Modify: `packages/db-testing/src/index.ts` (`irow` default `categories: []`)
- Test: `packages/core/src/content-index/list-entries-categories.test.ts`
- Test: `packages/core/src/index-port/project-categories.test.ts`

**Interfaces:**
- Produces: `ContentRow.categories: string[]`, `EntryIndexRow.categories: string[]`; `projectRow`/`rowToContentRow` carry `categories`; `INDEX_VERSION === 3`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/content-index/list-entries-categories.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { listContentEntries } from './list-entries'
import type { Draft } from '../data/types'

const doc = { type: 'doc', content: [] } as unknown as Draft['content']
const draft = (over: Partial<Draft>): Draft => ({
  collection: 'post', locale: 'en', slug: 'p', content: doc,
  metadata: {}, baseSha: null, baseContent: null, updatedAt: 1, createdAt: 0,
  ...over,
})
const noDeploy = () => null

describe('listContentEntries — categories', () => {
  it('reads + dedupes category slugs from a draft', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', categories: ['react', 'react', 'tutorials'] } })],
      committed: [], deployedAt: noDeploy,
    })
    expect(rows[0]!.categories).toEqual(['react', 'tutorials'])
  })

  it('reads categories from committed frontmatter when there is no draft', () => {
    const committed = [{ ref: { collection: 'post', locale: 'en', slug: 'c' }, content: '---\ntitle: C\ncategories:\n  - guides\n---\nbody' }]
    const rows = listContentEntries({ drafts: [], committed, deployedAt: noDeploy })
    expect(rows[0]!.categories).toEqual(['guides'])
  })

  it('defaults to [] when categories are absent or non-array', () => {
    const rows = listContentEntries({
      drafts: [draft({ metadata: { title: 'P', categories: 'nope' } })],
      committed: [], deployedAt: noDeploy,
    })
    expect(rows[0]!.categories).toEqual([])
  })
})
```

`packages/core/src/index-port/project-categories.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { projectRow, rowToContentRow } from './types'
import type { ContentRow } from '../content-index/list-entries'

const row: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'a' },
  title: 'A', locale: 'en', lifecycle: { state: 'draft' }, updatedAt: 1, hasDraft: true,
  tags: [], categories: ['react', 'tutorials'],
}

describe('projectRow / rowToContentRow — categories', () => {
  it('projects categories onto the index row', () => {
    expect(projectRow(row).categories).toEqual(['react', 'tutorials'])
  })
  it('round-trips categories back to a content row', () => {
    expect(rowToContentRow(projectRow(row)).categories).toEqual(['react', 'tutorials'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm vitest run src/content-index/list-entries-categories.test.ts src/index-port/project-categories.test.ts`
Expected: FAIL — `categories` missing on `ContentRow`/`EntryIndexRow`.

- [ ] **Step 3: Add `categories` to `ContentRow` + `categoriesOf`**

In `packages/core/src/content-index/list-entries.ts`:

Add to the `ContentRow` interface (after the `tags` field):
```ts
  tags: string[]
  /** Category slugs for this entry (draft's win when a draft exists). */
  categories: string[]
```

In the `order.map(...)` return object, after `tags: tagsOf(draft, committedStr),`:
```ts
      tags: tagsOf(draft, committedStr),
      categories: categoriesOf(draft, committedStr),
```

Add the helper near `tagsOf` (bottom of file):
```ts
/** Category slugs from the live version: the draft's when a draft exists, else
 *  committed frontmatter. Slugs are already canonical (no normalization);
 *  deduped, first-seen order; tolerant of absent/non-array. */
function categoriesOf(draft: Draft | null, committedStr: string | null): string[] {
  const raw = draft
    ? draft.metadata['categories']
    : committedStr !== null
      ? parseMdoc(committedStr).frontmatter['categories']
      : undefined
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x === 'string' && x !== '' && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}
```

- [ ] **Step 4: Add `categories` to `EntryIndexRow`, `projectRow`, `rowToContentRow`**

In `packages/core/src/index-port/types.ts`:

Add to the `EntryIndexRow` interface (after `tags: string[]`):
```ts
  tags: string[]
  categories: string[]
```

In `projectRow`, after `tags: row.tags,`:
```ts
    tags: row.tags,
    categories: row.categories,
```

In `rowToContentRow`, after `tags: r.tags,`:
```ts
    tags: r.tags,
    categories: r.categories,
```

- [ ] **Step 5: Bump `INDEX_VERSION`**

In `packages/core/src/index-port/index-service.ts`: `export const INDEX_VERSION = 3`.

- [ ] **Step 6: Fix the `irow` test helper**

In `packages/db-testing/src/index.ts`, in the `irow` `base` object, add `categories: [] as string[]` alongside `tags`:
```ts
    status: 'draft' as const, updatedAt: 0, hasDraft: true, tags: [] as string[], categories: [] as string[],
```

- [ ] **Step 7: Run tests + typecheck across ALL affected packages**

Run: `cd packages/core && pnpm vitest run src/content-index/list-entries-categories.test.ts src/index-port/project-categories.test.ts && pnpm typecheck`
Then typecheck every package that builds a `ContentRow`/`EntryIndexRow` literal: `cd packages/db-testing && pnpm typecheck`, `cd packages/db-memory && pnpm typecheck`, `cd packages/db-idb && pnpm typecheck`, `cd apps/admin && pnpm typecheck`.
Expected: PASS. Wherever typecheck flags a literal missing `categories`, add `categories: []` there (the tags slice hit `packages/core/test/index-port/run-query.test.ts`, `packages/core/test/index-port/types.test.ts`, `apps/admin/test/index-provider.test.tsx`, `apps/admin/test/recent-edits.test.tsx` — expect the same set here). Then run the full core suite: `cd packages/core && pnpm vitest run` — expected all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(findability): project categories into the content index (INDEX_VERSION 3)"
```

---

### Task 2: tag + category filters in runQuery

**Files:**
- Modify: `packages/core/src/index-port/types.ts` (`tag?`, `category?` on `IndexQuery`)
- Modify: `packages/core/src/index-port/run-query.ts` (two filters)
- Test: `packages/core/src/index-port/run-query-filters.test.ts`

**Interfaces:**
- Consumes: `EntryIndexRow.tags`, `EntryIndexRow.categories`.
- Produces: `IndexQuery.tag?: string`, `IndexQuery.category?: string`; `runQuery` filters by them (AND).

- [ ] **Step 1: Write the failing test**

`packages/core/src/index-port/run-query-filters.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runQuery } from './run-query'
import type { EntryIndexRow } from './types'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`, collection: 'post', locale: 'en',
  slug: 'x', title: 'X', titleLower: 'x', status: 'draft', updatedAt: 0,
  hasDraft: true, tags: [], categories: [], ...over,
})

describe('runQuery — tag & category filters', () => {
  const rows = [
    row({ slug: 'a', title: 'A', tags: ['react'], categories: ['guides'], status: 'draft' }),
    row({ slug: 'b', title: 'B', tags: ['vue'], categories: ['guides'], status: 'live' }),
    row({ slug: 'c', title: 'C', tags: ['react'], categories: ['news'], status: 'draft' }),
  ]
  const base = { collection: 'post', offset: 0, limit: 10 }

  it('filters by tag', () => {
    const r = runQuery(rows, { ...base, tag: 'react' })
    expect(r.rows.map((x) => x.slug).sort()).toEqual(['a', 'c'])
  })
  it('filters by category', () => {
    const r = runQuery(rows, { ...base, category: 'guides' })
    expect(r.rows.map((x) => x.slug).sort()).toEqual(['a', 'b'])
  })
  it('combines tag + category + status with AND', () => {
    const r = runQuery(rows, { ...base, tag: 'react', category: 'guides', status: 'draft' })
    expect(r.rows.map((x) => x.slug)).toEqual(['a'])
  })
  it('no tag/category filter returns all in the collection', () => {
    expect(runQuery(rows, base).total).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/index-port/run-query-filters.test.ts`
Expected: FAIL — `tag`/`category` not on `IndexQuery` and not filtered.

- [ ] **Step 3: Add `tag`/`category` to `IndexQuery`**

In `packages/core/src/index-port/types.ts`, in the `IndexQuery` interface (after `locale?: string`):
```ts
  locale?: string
  tag?: string
  category?: string
```

- [ ] **Step 4: Add the filters in `runQuery`**

In `packages/core/src/index-port/run-query.ts`, after the existing `if (q.q && q.q.length > 0) { ... }` block and before the `const sort = ...` line:
```ts
  if (q.tag) xs = xs.filter((r) => r.tags.includes(q.tag!))
  if (q.category) xs = xs.filter((r) => r.categories.includes(q.category!))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/index-port/run-query-filters.test.ts && pnpm typecheck`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index-port/types.ts packages/core/src/index-port/run-query.ts packages/core/src/index-port/run-query-filters.test.ts
git commit -m "feat(findability): tag + category filters in runQuery"
```

---

### Task 3: distinctLocales query

**Files:**
- Modify: `packages/core/src/index-port/distinct-tags.ts` (add `selectDistinctLocales`)
- Test: `packages/core/src/index-port/distinct-locales.test.ts`
- Modify: `packages/core/src/index-port/types.ts` (`distinctLocales` on `IndexPort`)
- Modify: `packages/core/src/index-port/index-service.ts` (`distinctLocales` on `IndexService`)
- Modify: `packages/core/src/index.ts` (barrel export `selectDistinctLocales`)
- Modify: `packages/db-memory/src/index-port.ts`, `packages/db-idb/src/index-port.ts` (implement)
- Modify: `packages/db-testing/src/index.ts` (contract case)

**Interfaces:**
- Produces: `selectDistinctLocales(rows: EntryIndexRow[]): string[]` (distinct `locale`, sorted asc); `IndexPort.distinctLocales(): Promise<string[]>`; `IndexService.distinctLocales(): Promise<string[]>`.

- [ ] **Step 1: Write the failing test (pure helper)**

`packages/core/src/index-port/distinct-locales.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { selectDistinctLocales } from './distinct-tags'
import type { EntryIndexRow } from './types'

const row = (locale: string, slug: string): EntryIndexRow => ({
  key: `post\0${locale}\0${slug}`, collection: 'post', locale, slug,
  title: slug, titleLower: slug, status: 'draft', updatedAt: 0, hasDraft: true, tags: [], categories: [],
})

describe('selectDistinctLocales', () => {
  it('returns distinct locales sorted ascending', () => {
    expect(selectDistinctLocales([row('fr', 'a'), row('en', 'b'), row('en', 'c')])).toEqual(['en', 'fr'])
  })
  it('returns [] for no rows', () => {
    expect(selectDistinctLocales([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/index-port/distinct-locales.test.ts`
Expected: FAIL — `selectDistinctLocales` not exported.

- [ ] **Step 3: Implement the pure helper**

In `packages/core/src/index-port/distinct-tags.ts`, append:
```ts
/** Distinct locales across rows, sorted ascending. Locales are a tiny bounded
 *  set, so no prefix/limit — the whole list feeds a filter dropdown. */
export function selectDistinctLocales(rows: EntryIndexRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) set.add(r.locale)
  return [...set].sort()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/index-port/distinct-locales.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `distinctLocales` to interfaces + service**

In `packages/core/src/index-port/types.ts`, in the `IndexPort` interface (after `distinctTags`):
```ts
  distinctTags(prefix: string, limit: number): Promise<string[]>
  distinctLocales(): Promise<string[]>
```

In `packages/core/src/index-port/index-service.ts`:
Add to the `IndexService` interface (after `distinctTags`):
```ts
  distinctTags(prefix: string, limit: number): Promise<string[]>
  distinctLocales(): Promise<string[]>
```
Add the impl inside `createIndexService` (next to `distinctTags`) and include it in the returned object:
```ts
  async function distinctLocales(): Promise<string[]> {
    return index.distinctLocales()
  }

  return { rebuild, ensureBuilt, reindexEntry, reindexAfterDeploy, query, distinctTags, distinctLocales }
```

- [ ] **Step 6: Export the helper from the barrel**

In `packages/core/src/index.ts`, alongside the `selectDistinctTags` export:
```ts
export { selectDistinctTags, selectDistinctLocales } from './index-port/distinct-tags'
```

- [ ] **Step 7: Implement in both adapters**

In `packages/db-memory/src/index-port.ts` — update the import and add the method:
```ts
import { runQuery, selectDistinctTags, selectDistinctLocales } from '@setu/core'
```
After the `distinctTags` method:
```ts
    async distinctLocales() {
      return selectDistinctLocales([...rows.values()])
    },
```

In `packages/db-idb/src/index-port.ts` — update the import and add the method:
```ts
import { runQuery, selectDistinctTags, selectDistinctLocales } from '@setu/core'
```
After the `distinctTags` method:
```ts
    async distinctLocales() {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectDistinctLocales(all)
    },
```

- [ ] **Step 8: Add the contract case**

In `packages/db-testing/src/index.ts`, inside `runIndexPortContract`'s `describe`, add:
```ts
    it('distinctLocales: returns distinct locales sorted', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', locale: 'fr' }),
        irow({ slug: 'b', locale: 'en' }),
        irow({ slug: 'c', locale: 'en' }),
      ])
      expect(await ix.distinctLocales()).toEqual(['en', 'fr'])
    })
```

- [ ] **Step 9: Run tests + typecheck across the affected packages**

Run: `cd packages/core && pnpm vitest run src/index-port && pnpm typecheck`
Then: `cd packages/db-memory && pnpm vitest run && pnpm typecheck`
Then: `cd packages/db-idb && pnpm vitest run && pnpm typecheck`
Expected: all PASS — both adapters' contract suites include the distinctLocales case.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/index-port/distinct-tags.ts packages/core/src/index-port/distinct-locales.test.ts packages/core/src/index-port/types.ts packages/core/src/index-port/index-service.ts packages/core/src/index.ts packages/db-memory/src/index-port.ts packages/db-idb/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(findability): distinctLocales query across IndexPort + adapters"
```

---

### Task 4: TagFilter component (single-select tag typeahead)

**Files:**
- Create: `apps/admin/src/screens/TagFilter.tsx`
- Create: `apps/admin/test/TagFilter.test.tsx`

**Interfaces:**
- Consumes: `useIndex()` → `IndexService.distinctTags`.
- Produces: `TagFilter({ value, onChange }: { value: string; onChange: (tag: string) => void })` — when `value` is set, shows a chip + clear; otherwise a typeahead that calls `onChange(slug)` on pick. Reuses the `tag-chip`/`tag-suggestions`/`tag-suggestion` CSS classes from the tags slice.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/TagFilter.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagFilter } from '../src/screens/TagFilter'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function setup(value: string) {
  const onChange = vi.fn()
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'seed', content: doc('x'), metadata: { title: 'Seed', tags: ['react', 'redux'] } },
  ])
  render(
    <ServicesProvider services={servicesFor(data, createMemoryGitPort())}>
      <DeployProvider><IndexProvider>
        <TagFilter value={value} onChange={onChange} />
      </IndexProvider></DeployProvider>
    </ServicesProvider>,
  )
  return { onChange }
}

describe('TagFilter', () => {
  it('suggests tags from the index and selects one on click', async () => {
    const { onChange } = setup('')
    fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: 're' } })
    const opt = await screen.findByRole('option', { name: 'redux' })
    fireEvent.click(opt)
    expect(onChange).toHaveBeenCalledWith('redux')
  })

  it('shows the active tag as a chip and clears it', () => {
    const { onChange } = setup('react')
    fireEvent.click(screen.getByLabelText('Clear tag filter'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/TagFilter.test.tsx`
Expected: FAIL — cannot find module `../src/screens/TagFilter`.

- [ ] **Step 3: Implement TagFilter**

`apps/admin/src/screens/TagFilter.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useIndex } from '../data/index-store'

export function TagFilter({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  const index = useIndex()
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    const q = input.trim()
    if (q === '') {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void index
        .distinctTags(q, 8)
        .then((tags) => {
          if (!cancelled) setSuggestions(tags)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, index])

  if (value) {
    return (
      <span className="tag-chip">
        {value}
        <button type="button" className="tag-chip-x" aria-label="Clear tag filter" onClick={() => onChange('')}>
          ×
        </button>
      </span>
    )
  }

  return (
    <div className="tag-filter tag-input-wrap">
      <input
        type="text"
        className="tag-input"
        placeholder="Filter by tag"
        aria-label="Filter by tag"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="tag-suggestions" role="listbox">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              className="tag-suggestion"
              role="option"
              aria-selected={false}
              onClick={() => {
                onChange(t)
                setInput('')
                setSuggestions([])
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/TagFilter.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/TagFilter.tsx apps/admin/test/TagFilter.test.tsx
git commit -m "feat(findability): single-select tag filter typeahead"
```

---

### Task 5: ContentList rewrite — filter toolbar + sortable headers + URL state

**Files:**
- Modify: `apps/admin/src/screens/ContentList.tsx` (full rewrite)
- Create: `apps/admin/test/content-list-filters.test.tsx`

**Interfaces:**
- Consumes: `useIndex()` (`query`, `ensureBuilt`, `distinctLocales`), `useTaxonomy()` (`categories`), `buildTree`, `IndexQuery`/`ContentRow`/`SortKey`/`LifecycleState` from `@setu/core`, `TagFilter`, `useSearchParams`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/content-list-filters.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

function setup(initialEntries = ['/posts']) {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'alpha', content: doc('x'), metadata: { title: 'Alpha', status: 'draft', categories: ['guides'], tags: ['react'] } },
    { collection: 'post', locale: 'en', slug: 'beta', content: doc('x'), metadata: { title: 'Beta', status: 'draft', categories: ['news'], tags: ['vue'] } },
  ])
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ServicesProvider services={servicesFor(data, createMemoryGitPort())}>
        <DeployProvider><IndexProvider><TaxonomyProvider>
          <ContentList collection="post" title="Posts" />
        </TaxonomyProvider></IndexProvider></DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('ContentList — filters', () => {
  it('lists all entries with no filter', async () => {
    setup()
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('search box narrows the list', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alph' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('category filter narrows the list', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'news' } })
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('pre-populates filters from the URL (deep link)', async () => {
    setup(['/posts?status=draft&q=beta'])
    await waitFor(() => expect(screen.getByText('Beta')).toBeTruthy())
    expect(screen.queryByText('Alpha')).toBeNull()
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('beta')
  })

  it('shows a filtered-empty state with a clear action', async () => {
    setup(['/posts?q=zzzznomatch'])
    expect(await screen.findByText(/match these filters/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/clear filters/i))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/content-list-filters.test.tsx`
Expected: FAIL — current ContentList has no search/filter controls.

- [ ] **Step 3: Rewrite ContentList**

Replace the entire contents of `apps/admin/src/screens/ContentList.tsx` with:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { CategoryNode, ContentRow, IndexQuery, LifecycleState, SortKey } from '@setu/core'
import { buildTree } from '@setu/core'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'
import { lifecycleLabel } from '../lifecycle/label'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'
import { siteUrl } from '../shell/site-url'
import { TagFilter } from './TagFilter'

const PAGE_SIZE = 25
const STATUSES: LifecycleState[] = ['draft', 'staged', 'live', 'unpublished']
const STATUS_LABELS: Record<LifecycleState, string> = { draft: 'Draft', staged: 'Staged', live: 'Live', unpublished: 'Unpublished' }
const SORT_KEYS: SortKey[] = ['updatedAt', 'title', 'status']

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

function parseSort(raw: string | null): { key: SortKey; dir: 'asc' | 'desc' } {
  if (raw) {
    const [key, dir] = raw.split('-')
    if (SORT_KEYS.includes(key as SortKey) && (dir === 'asc' || dir === 'desc')) {
      return { key: key as SortKey, dir }
    }
  }
  return { key: 'updatedAt', dir: 'desc' }
}

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const index = useIndex()
  const { categories } = useTaxonomy()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [locales, setLocales] = useState<string[]>([])

  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const locale = params.get('locale') ?? ''
  const category = params.get('category') ?? ''
  const tag = params.get('tag') ?? ''
  const sortRaw = params.get('sort')
  const sort = parseSort(sortRaw)
  const hasFilters = Boolean(q || status || locale || category || tag)

  const catRows = useMemo(() => flatten(buildTree(categories)), [categories])

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  // Debounced search: local input → URL `q`.
  const [search, setSearch] = useState(q)
  useEffect(() => {
    setSearch(q)
  }, [q])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== q) setParam('q', search)
    }, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Reset to page 0 when collection or any filter/sort changes.
  useEffect(() => {
    setPage(0)
  }, [collection, q, status, locale, category, tag, sortRaw])

  // Locale dropdown options.
  useEffect(() => {
    let live = true
    void index.distinctLocales().then((ls) => { if (live) setLocales(ls) }).catch(() => {})
    return () => { live = false }
  }, [index])

  // Run the query.
  useEffect(() => {
    let live = true
    setRows(null)
    void (async () => {
      await index.ensureBuilt()
      const query: IndexQuery = { collection, offset: page * PAGE_SIZE, limit: PAGE_SIZE, sort }
      if (q) query.q = q
      if (status) query.status = status as LifecycleState
      if (locale) query.locale = locale
      if (category) query.category = category
      if (tag) query.tag = tag
      const r = await index.query(query)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }
    })()
    return () => { live = false }
  }, [index, collection, page, q, status, locale, category, tag, sort.key, sort.dir])

  const toggleSort = (key: SortKey) => {
    const dir = sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'
    setParam('sort', `${key}-${dir}`)
  }
  const sortIndicator = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  const clearFilters = () => setParams({}, { replace: true })

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  const noun = collection

  return (
    <>
      <PageHeader
        title={title}
        count={rows !== null ? total : undefined}
        subtitle={collection === 'post' ? 'Articles, field notes and announcements.' : 'Standalone pages and landing pages.'}
        actions={
          <Link to={`/edit/${collection}/en/new`} className="btn btn-primary btn-md">
            <Icon name="plus" size={16} />
            <span>New {noun}</span>
          </Link>
        }
      />
      <div className="page-body">
        <div className="list-toolbar">
          <input
            type="search"
            className="list-search"
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">All status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select aria-label="Filter by category" value={category} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">All categories</option>
            {catRows.map((c) => (
              <option key={c.slug} value={c.slug}>{' '.repeat(c.depth * 2)}{c.name}</option>
            ))}
          </select>
          {locales.length > 1 && (
            <select aria-label="Filter by locale" value={locale} onChange={(e) => setParam('locale', e.target.value)}>
              <option value="">All locales</option>
              {locales.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}
          <TagFilter value={tag} onChange={(t) => setParam('tag', t)} />
          {hasFilters && (
            <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        {rows === null ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 ? (
          hasFilters ? (
            <p className="empty-state">No {title.toLowerCase()} match these filters. <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button></p>
          ) : (
            <p className="empty-state">No {title.toLowerCase()} yet.</p>
          )
        ) : (
          <div className="list-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('title')}>Title{sortIndicator('title')}</button></th>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</button></th>
                  <th>Locale</th>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('updatedAt')}>Updated{sortIndicator('updatedAt')}</button></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { label, pending } = lifecycleLabel(row.lifecycle)
                  return (
                    <tr key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                      <td className="ctable-title">
                        <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>{row.title}</Link>
                        {(row.lifecycle.state === 'staged' || row.lifecycle.state === 'live') && (
                          <a className="ctable-view" href={siteUrl(row.ref)} target="_blank" rel="noopener noreferrer" aria-label={`View ${row.title} on site`} title="View on site">
                            <Icon name="external" size={14} />
                          </a>
                        )}
                      </td>
                      <td>
                        <StatusPill status={label} />
                        {pending !== undefined && <span className="status-pending">· {pending}</span>}
                      </td>
                      <td className="ctable-muted">{row.ref.locale}</td>
                      <td className="ctable-muted">{row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {total > 0 && (
              <div className="list-pager">
                <span className="ctable-muted">{from}–{to} of {total}</span>
                <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <button className="btn btn-sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next">Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/content-list-filters.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full admin suite + typecheck**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS. The existing `ContentList` smoke/listing tests should still pass (the table + pager markup is preserved). If a prior test rendered `ContentList` without `MemoryRouter` or `TaxonomyProvider`, wrap it (ContentList now uses `useSearchParams` + `useTaxonomy`) — add only the wrapper, don't change assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/screens/ContentList.tsx apps/admin/test/content-list-filters.test.tsx
git commit -m "feat(findability): ContentList filter toolbar + sortable headers + URL state"
```

---

### Task 6: CSS polish + whole-feature verification

**Files:**
- Modify: `apps/admin/src/styles/` (toolbar + sortable-header styling)

- [ ] **Step 1: Run the full monorepo test + typecheck**

Run (repo root): `pnpm -r test && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean. Fix any cross-package fallout before continuing.

- [ ] **Step 2: Style the toolbar + sortable headers**

Read `apps/admin/src/styles/` (the listing/table styles — likely `components.css` and the `.ctable`/`.list-wrap`/`.empty-state` rules; and `tokens.css`). Style the new classes — `list-toolbar` (a horizontal, wrapping row of controls with a comfortable gap above the table), `list-search`, the `<select>`s (consistent height/border/radius with existing inputs), `ctable-sort` (a borderless button that looks like the old `<th>` text, with a hover affordance and the ▲/▼ indicator), and `tag-filter` (the typeahead wrapper; the `tag-chip`/`tag-suggestions`/`tag-suggestion` classes are already styled from the tags slice — reuse them, only add what's missing). Use ONLY existing design tokens; match the admin look. Then:
```bash
git add apps/admin/src/styles
git commit -m "style(findability): filter toolbar + sortable headers"
```

- [ ] **Step 3: Manual smoke (dev server)**

Run the admin dev server, open Posts, and confirm: search narrows live; status/category/locale dropdowns filter; the tag typeahead filters and shows a clearable chip; sortable headers toggle and show ▲/▼; filters appear in the URL and survive refresh; Clear filters resets; the filtered-empty state shows when nothing matches. Confirm the toolbar looks clean.

---

## Self-Review

**Spec coverage:**
- §1 category projection (`categories` on rows, `categoriesOf`, `INDEX_VERSION` 2→3) → Task 1. ✓
- §2 `tag`/`category` filters on `runQuery` → Task 2. ✓
- §3 `distinctLocales` (helper + port + service + adapters + contract) → Task 3. ✓
- §4 UI: search/status/locale/category dropdowns → Task 5; tag typeahead → Tasks 4+5; sortable headers, URL state, page-0 reset, Clear filters → Task 5. ✓
- §5 filtered-empty vs empty states → Task 5. ✓
- Decisions: single-select + AND (Task 2 filters + Task 5 single-value controls); URL params (Task 5); tag typeahead scale-safe (Task 4); locale from index (Task 3+5). ✓
- Error handling: garbage param → matches nothing / default sort (`parseSort` fallback + filter semantics, Task 5); empty index → `[]` dropdowns (Tasks 3/5). ✓
- Non-goals (multi-select, lock indicators, saved views, archive pages, locale sort) → none built. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Step 6.2 (CSS) is open-ended by nature but names exact classes + token conventions.

**Type consistency:** `categories: string[]` consistent on `ContentRow`/`EntryIndexRow`; `IndexQuery.tag`/`.category` ↔ `runQuery` filters ↔ `ContentList` query build; `selectDistinctLocales`/`distinctLocales` consistent across helper/port/service/adapters; `parseSort` emits `{key: SortKey, dir}` matching `IndexQuery.sort`; `INDEX_VERSION = 3` single source; `TagFilter({value,onChange})` ↔ ContentList usage.
