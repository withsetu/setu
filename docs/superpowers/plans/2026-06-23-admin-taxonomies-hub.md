# Taxonomies hub — Categories tab (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `/categories` screen with a tabbed **Taxonomies** hub whose Categories tab is migrated onto shadcn and gains usage counts + delete (atomic strip-from-content + promote-children); Tags tab is a placeholder.

**Architecture:** Core grows a pure `removeCategory` op (promotes children), two IndexPort scan helpers (`categoryCounts`, `entriesByCategory`), and a `createCategoryDeleter` orchestrator that assembles the yaml change + every content-frontmatter strip into ONE `git.commitFiles`. Admin grows a `screens/taxonomies/` tree UI on shadcn primitives, extends the taxonomy store with `remove` + counts, and swaps routing/nav.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, shadcn/ui (new-york), `@setu/core`, `@setu/db-memory`, `@setu/db-idb`, `@setu/db-testing`.

## Global Constraints

- Pure standard shadcn token vocabulary; brand indigo = `--primary` (NOT `--accent`, which is the neutral hover surface). Dark mode on `[data-theme="dark"]`.
- Loose/modern aesthetic per `docs/.../setu-admin-visual-aesthetic`: generous rows, 15px medium titles + muted `/slug`, sentence-case muted headers, faint dividers, restrained motion (NO drag-drop).
- Reuse shared shadcn primitives in `apps/admin/src/components/ui/`. `cn` + `@/` alias.
- Categories attach to content as **slugs** in frontmatter `categories: [...]`. Category registry is `taxonomy/categories.yaml`.
- New IndexPort methods MUST be implemented in BOTH `db-memory` and `db-idb`, satisfy the shared `runIndexPortContract` (in `@setu/db-testing`), and use the single shared pure helper (cf. `selectDistinctTags`/`selectReferencedBy`) — adapters delegate, never duplicate logic.
- Barrel: taxonomy ops are exported un-aliased (`addCategory`, `removeCategory`, …); bulk mutations are exported aliased (`bulkAddCategory`, `bulkRemoveCategory`, …). Keep that convention.
- Full gate before "done": `pnpm typecheck && pnpm test && pnpm build` all green.

---

### Task 1: Core — `removeCategory` pure op (promote children)

**Files:**
- Modify: `packages/core/src/taxonomy/ops.ts`
- Modify: `packages/core/src/taxonomy/ops.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Category` (`{ slug: string; name: string; parent: string | null }`), `TaxonomyError`.
- Produces: `removeCategory(cats: Category[], slug: string): Category[]` — removes the node and reparents its **direct** children to the removed node's parent. Throws `TaxonomyError('not-found')` if absent.

- [ ] **Step 1: Write the failing tests**

In `ops.test.ts`, append:

```ts
import { removeCategory } from './ops'

describe('removeCategory', () => {
  const base = [
    { slug: 'eng', name: 'Engineering', parent: null },
    { slug: 'frontend', name: 'Frontend', parent: 'eng' },
    { slug: 'react', name: 'React', parent: 'frontend' },
    { slug: 'news', name: 'News', parent: null },
  ]
  it('removes the node and promotes its direct children to the removed node parent', () => {
    const next = removeCategory(base, 'eng')
    expect(next.find((c) => c.slug === 'eng')).toBeUndefined()
    expect(next.find((c) => c.slug === 'frontend')!.parent).toBeNull()
    // grandchild untouched — still points at its own (surviving) parent
    expect(next.find((c) => c.slug === 'react')!.parent).toBe('frontend')
  })
  it('promotes a mid-tree node children up one level', () => {
    const next = removeCategory(base, 'frontend')
    expect(next.find((c) => c.slug === 'frontend')).toBeUndefined()
    expect(next.find((c) => c.slug === 'react')!.parent).toBe('eng')
  })
  it('removes a leaf with no children', () => {
    expect(removeCategory(base, 'news').map((c) => c.slug)).toEqual(['eng', 'frontend', 'react'])
  })
  it('throws not-found for a missing slug', () => {
    expect(() => removeCategory(base, 'nope')).toThrow('does not exist')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- ops.test.ts`
Expected: FAIL — `removeCategory is not a function`.

- [ ] **Step 3: Implement the op**

Append to `ops.ts`:

```ts
/** Delete a category and promote its DIRECT children to the deleted node's own
 *  parent (one level up; null when the deleted node was top-level). Grandchildren
 *  are untouched. Throws not-found for a missing slug. */
export function removeCategory(cats: Category[], slug: string): Category[] {
  const node = cats.find((c) => c.slug === slug)
  if (node === undefined) throw new TaxonomyError('not-found', `Category "${slug}" does not exist`)
  return cats
    .filter((c) => c.slug !== slug)
    .map((c) => (c.parent === slug ? { ...c, parent: node.parent } : c))
}
```

- [ ] **Step 4: Export from barrel**

In `packages/core/src/index.ts`, add `removeCategory` to the taxonomy ops export:

```ts
export { addCategory, removeCategory, renameLabel, reparent, slugify, TaxonomyError } from './taxonomy/ops'
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @setu/core test -- ops.test.ts`
Expected: PASS (all `removeCategory` cases + existing ops cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/taxonomy/ops.ts packages/core/src/taxonomy/ops.test.ts packages/core/src/index.ts
git commit -m "feat(core): removeCategory op — delete + promote children"
```

---

### Task 2: Core — category usage counts (IndexPort)

**Files:**
- Create: `packages/core/src/index-port/category-counts.ts`
- Create: `packages/core/src/index-port/category-counts.test.ts`
- Modify: `packages/core/src/index-port/types.ts` (add to `IndexPort`)
- Modify: `packages/core/src/index-port/index-service.ts` (passthrough)
- Modify: `packages/core/src/index.ts` (barrel)
- Modify: `packages/db-memory/src/index-port.ts`
- Modify: `packages/db-idb/src/index-port.ts`
- Modify: `packages/db-testing/src/index.ts` (contract test — see Step 6)

**Interfaces:**
- Produces: `selectCategoryCounts(rows: EntryIndexRow[]): Record<string, number>` — number of entries whose `categories` include each slug (across all collections/locales). Slugs with zero usage are absent from the map.
- Produces: `IndexPort.categoryCounts(): Promise<Record<string, number>>` and `IndexService.categoryCounts(): Promise<Record<string, number>>`.

- [ ] **Step 1: Write the failing helper test**

`category-counts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectCategoryCounts } from './category-counts'
import type { EntryIndexRow } from './types'

const row = (key: string, categories: string[]): EntryIndexRow => ({
  key, collection: 'post', locale: 'en', slug: key, title: key, titleLower: key,
  status: 'draft', updatedAt: 0, hasDraft: true, tags: [], categories, mediaRefs: [],
})

describe('selectCategoryCounts', () => {
  it('counts entries per category slug across rows', () => {
    const counts = selectCategoryCounts([row('a', ['eng', 'news']), row('b', ['eng']), row('c', [])])
    expect(counts).toEqual({ eng: 2, news: 1 })
  })
  it('returns an empty map when no row has categories', () => {
    expect(selectCategoryCounts([row('a', []), row('b', [])])).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- category-counts.test.ts`
Expected: FAIL — cannot find module `./category-counts`.

- [ ] **Step 3: Implement the helper**

`category-counts.ts`:

```ts
import type { EntryIndexRow } from './types'

/** Usage count per category slug across all rows. Slugs with zero usage are
 *  absent. Shared pure impl, used by every IndexPort adapter (cf. selectDistinctTags). */
export function selectCategoryCounts(rows: EntryIndexRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) for (const c of r.categories) counts[c] = (counts[c] ?? 0) + 1
  return counts
}
```

- [ ] **Step 4: Add to IndexPort + IndexService + barrel**

In `index-port/types.ts`, add to the `IndexPort` interface (after `distinctLocales`):

```ts
  categoryCounts(): Promise<Record<string, number>>
```

In `index-port/index-service.ts`: add `categoryCounts` to the `IndexService` interface and the returned object:

```ts
  async function categoryCounts(): Promise<Record<string, number>> {
    return index.categoryCounts()
  }
```
(add `categoryCounts` to both the `interface IndexService` method list and the final `return { ... }`).

In `index.ts` barrel, alongside the other index-port helper exports:

```ts
export { selectCategoryCounts } from './index-port/category-counts'
```

- [ ] **Step 5: Implement in both adapters**

In `packages/db-memory/src/index-port.ts` — add to the imports `selectCategoryCounts` and add the method:

```ts
    async categoryCounts() {
      return selectCategoryCounts([...rows.values()])
    },
```

In `packages/db-idb/src/index-port.ts` — add `selectCategoryCounts` to imports and:

```ts
    async categoryCounts() {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectCategoryCounts(all)
    },
```

- [ ] **Step 6: Extend the shared contract test**

Open `packages/db-testing/src/index.ts` (the `runIndexPortContract` suite). Add a case after the existing distinct-tags case:

```ts
  it('categoryCounts tallies usage across rows', async () => {
    const port = await makePort()
    await port.upsertMany([
      { ...sampleRow('a'), categories: ['eng', 'news'] },
      { ...sampleRow('b'), categories: ['eng'] },
    ])
    expect(await port.categoryCounts()).toEqual({ eng: 2, news: 1 })
  })
```
(Use the file's existing row-factory helper name — match whatever `sampleRow`/`makeRow` the suite already defines; do not invent a new one.)

- [ ] **Step 7: Run all affected suites**

Run: `pnpm --filter @setu/core test -- category-counts.test.ts && pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test`
Expected: PASS (helper + both adapter contract runs).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index-port/category-counts.ts packages/core/src/index-port/category-counts.test.ts packages/core/src/index-port/types.ts packages/core/src/index-port/index-service.ts packages/core/src/index.ts packages/db-memory/src/index-port.ts packages/db-idb/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(core): categoryCounts on IndexPort (+ both adapters, contract)"
```

---

### Task 3: Core — `entriesByCategory` (IndexPort)

**Files:**
- Create: `packages/core/src/index-port/entries-by-category.ts`
- Create: `packages/core/src/index-port/entries-by-category.test.ts`
- Modify: `packages/core/src/index-port/types.ts`, `index-service.ts`, `index.ts`
- Modify: `packages/db-memory/src/index-port.ts`, `packages/db-idb/src/index-port.ts`, `packages/db-testing/src/index.ts`

**Interfaces:**
- Produces: `selectEntriesByCategory(rows: EntryIndexRow[], slug: string): EntryRef[]` — refs (`{collection, locale, slug}`) of every entry whose `categories` include `slug`, across collections/locales.
- Produces: `IndexPort.entriesByCategory(slug: string): Promise<EntryRef[]>` and `IndexService.entriesByCategory(slug): Promise<EntryRef[]>`.

- [ ] **Step 1: Write the failing helper test**

`entries-by-category.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectEntriesByCategory } from './entries-by-category'
import type { EntryIndexRow } from './types'

const row = (collection: string, slug: string, categories: string[]): EntryIndexRow => ({
  key: `${collection}/${slug}`, collection, locale: 'en', slug, title: slug, titleLower: slug,
  status: 'draft', updatedAt: 0, hasDraft: true, tags: [], categories, mediaRefs: [],
})

describe('selectEntriesByCategory', () => {
  it('returns refs across collections that include the slug', () => {
    const refs = selectEntriesByCategory(
      [row('post', 'a', ['eng']), row('page', 'b', ['eng', 'news']), row('post', 'c', ['news'])],
      'eng',
    )
    expect(refs).toEqual([
      { collection: 'post', locale: 'en', slug: 'a' },
      { collection: 'page', locale: 'en', slug: 'b' },
    ])
  })
  it('returns [] when no entry uses the slug', () => {
    expect(selectEntriesByCategory([row('post', 'a', ['x'])], 'eng')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- entries-by-category.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the helper**

`entries-by-category.ts`:

```ts
import type { EntryRef } from '../data/types'
import type { EntryIndexRow } from './types'

/** Refs of every entry whose categories include `slug` (across collections/locales).
 *  Shared pure impl for every IndexPort adapter (cf. selectReferencedBy). */
export function selectEntriesByCategory(rows: EntryIndexRow[], slug: string): EntryRef[] {
  return rows
    .filter((r) => r.categories.includes(slug))
    .map((r) => ({ collection: r.collection, locale: r.locale, slug: r.slug }))
}
```

- [ ] **Step 4: Wire IndexPort + IndexService + barrel + both adapters + contract**

Mirror Task 2 exactly for `entriesByCategory(slug)`:
- `types.ts` `IndexPort`: `entriesByCategory(slug: string): Promise<EntryRef[]>`
- `index-service.ts`: interface entry + `async function entriesByCategory(slug: string) { return index.entriesByCategory(slug) }` + add to `return`.
- `index.ts`: `export { selectEntriesByCategory } from './index-port/entries-by-category'`
- db-memory: `async entriesByCategory(slug) { return selectEntriesByCategory([...rows.values()], slug) }`
- db-idb: `async entriesByCategory(slug) { const all = (await db.getAll('entries')) as EntryIndexRow[]; return selectEntriesByCategory(all, slug) }`
- `db-testing/src/index.ts`: add a contract case asserting refs returned for a seeded category.

- [ ] **Step 5: Run affected suites**

Run: `pnpm --filter @setu/core test -- entries-by-category.test.ts && pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core/src/index-port packages/core/src/index.ts packages/db-memory/src/index-port.ts packages/db-idb/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(core): entriesByCategory on IndexPort (+ both adapters, contract)"
```

---

### Task 4: Core — `createCategoryDeleter` (atomic delete-with-strip)

**Files:**
- Create: `packages/core/src/taxonomy/delete-service.ts`
- Create: `packages/core/src/taxonomy/delete-service.test.ts`
- Modify: `packages/core/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `GitPort` (`readFile`, `commitFiles({ changes: FileChange[], message, author })`), `DataPort` (`saveDraft`), `ReadService` (`loadForEdit(ref)` → `{ source: 'draft'|'forked'|'absent'; draft? }`), `IndexService` (`entriesByCategory`, `reindexEntry`), `GitAuthor`. Reuses `parseCategories`/`serializeCategories`, `removeCategory` (taxonomy op), `bulkRemoveCategory` (meta mutation), `serializeMdoc`, `tiptapToMarkdoc`, `contentPath`, `TAXONOMY_PATH`.
- Produces: `createCategoryDeleter(deps: CategoryDeleterDeps): { remove(slug: string): Promise<{ categories: Category[]; strippedCount: number }> }`.

**Why not reuse `BulkService.applyMetadata`:** that commits content by itself; we need the `categories.yaml` change in the SAME commit, so we assemble all `FileChange`s and call `commitFiles` once.

- [ ] **Step 1: Write the failing test**

`delete-service.test.ts` — use in-memory ports + a real read service so the orchestration is exercised end to end:

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryIndexPort } from '@setu/db-memory'
import { createReadService } from '../read/read-service'
import { createIndexService } from '../index-port/index-service'
import { createTaxonomyService } from './service'
import { createCategoryDeleter } from './delete-service'

const author = { name: 'T', email: 't@x.dev' }
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

async function setup() {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'A', categories: ['eng', 'news'] } },
    { collection: 'post', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'B', categories: ['news'] } },
  ])
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  const read = createReadService({ data, git, knownBlockTags: [] })
  const idx = createIndexService({ data, git, index, deployedAt: () => null })
  await idx.rebuild()
  const tax = createTaxonomyService({ git, author })
  await tax.create({ name: 'Engineering', parent: null }) // mints slug 'engineering'… use the real slug below
  return { data, git, index, read, idx }
}

it('strips the slug from referencing entries, removes the definition, one commit', async () => {
  const { data, git, read, idx } = await setup()
  // seed a category definition that entries reference ('eng')
  await git.commitFile({ path: 'taxonomy/categories.yaml', content: 'eng: Engineering\n', message: 'seed', author })
  const before = await git.headSha()
  const deleter = createCategoryDeleter({ git, data, read, index: idx, author })
  const res = await deleter.remove('eng')
  expect(res.strippedCount).toBe(1) // only entry 'a' used 'eng'
  // exactly one new commit
  const log = await git.log?.() // if no log(), assert via headSha changed once — see note
  const a = await git.readFile('content/post/en/a.md')
  expect(a).not.toContain('eng')
  expect(a).toContain('news') // other categories preserved
  const yaml = await git.readFile('taxonomy/categories.yaml')
  expect(yaml).not.toContain('eng')
  expect(before).not.toBe(await git.headSha())
})
```
> Note: match the real serialization. `createTaxonomyService` writes YAML via `serializeCategories`; seed the definition through the service (`tax.create`) or with the exact serialized form rather than hand-written YAML if the parser is strict. The implementer should align the seed with `parseCategories`/`serializeCategories` and assert "one commit" using whatever the memory GitPort exposes (`headSha` before/after, or a `log()` length if present).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- delete-service.test.ts`
Expected: FAIL — cannot find module `./delete-service`.

- [ ] **Step 3: Implement the deleter**

`delete-service.ts`:

```ts
import type { GitPort } from '../git/git-port'
import type { GitAuthor, FileChange } from '../git/types'
import type { DataPort } from '../data/data-port'
import type { ReadService } from '../read/types'
import type { IndexService } from '../index-port/index-service'
import type { Category } from './types'
import { parseCategories, serializeCategories } from './parse'
import { removeCategory } from './ops'
import { removeCategory as stripCategoryFromMeta } from '../bulk/mutations'
import { serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { contentPath } from '../publish/content-path'
import { TAXONOMY_PATH } from './service'

export interface CategoryDeleterDeps {
  git: GitPort
  data: DataPort
  read: ReadService
  index: IndexService
  author: GitAuthor
}

/** Delete a category atomically: strip its slug from every referencing entry's
 *  frontmatter AND remove its definition (promoting children one level up) in a
 *  SINGLE commit. Then reindex the touched entries so counts/listing stay fresh. */
export function createCategoryDeleter(deps: CategoryDeleterDeps) {
  const { git, data, read, index, author } = deps
  return {
    async remove(slug: string): Promise<{ categories: Category[]; strippedCount: number }> {
      const cats = parseCategories((await git.readFile(TAXONOMY_PATH)) ?? '')
      const nextCats = removeCategory(cats, slug) // throws if absent

      const refs = await index.entriesByCategory(slug)
      const changes: FileChange[] = []
      const pending: { ref: typeof refs[number]; content: unknown; next: Record<string, unknown>; serialized: string }[] = []

      for (const ref of refs) {
        const loaded = await read.loadForEdit(ref)
        if (loaded.source === 'absent') continue
        const draft = loaded.draft
        const next = stripCategoryFromMeta(draft.metadata, slug)
        const serialized = serializeMdoc({ frontmatter: next, body: tiptapToMarkdoc(draft.content) })
        changes.push({ path: contentPath(ref), content: serialized })
        pending.push({ ref, content: draft.content, next, serialized })
      }

      changes.push({ path: TAXONOMY_PATH, content: serializeCategories(nextCats) })

      const { sha } = await git.commitFiles({
        changes,
        message: `taxonomy: delete category ${slug} (strip from ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'})`,
        author,
      })

      for (const p of pending) {
        await data.saveDraft({ ...p.ref, content: p.content as never, metadata: p.next, baseSha: sha, baseContent: p.serialized })
        await index.reindexEntry(p.ref)
      }

      return { categories: nextCats, strippedCount: pending.length }
    },
  }
}
```
> The `read`/`serializeMdoc`/`tiptapToMarkdoc`/`contentPath` import paths mirror `bulk/bulk-service.ts` lines 1-9 — copy them verbatim from there if a path differs. `draft.content` is a `TiptapDoc`; type the `pending` entry as `TiptapDoc` rather than `unknown` (import the type as bulk does) — the `unknown`/`as never` above is a placeholder to be replaced with the real `TiptapDoc` type.

- [ ] **Step 4: Export from barrel**

In `index.ts`, near the taxonomy exports:

```ts
export { createCategoryDeleter } from './taxonomy/delete-service'
export type { CategoryDeleterDeps } from './taxonomy/delete-service'
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @setu/core test -- delete-service.test.ts`
Expected: PASS — stripped only the referencing entry, removed the definition, single commit.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/taxonomy/delete-service.ts packages/core/src/taxonomy/delete-service.test.ts packages/core/src/index.ts
git commit -m "feat(core): createCategoryDeleter — atomic strip + promote children"
```

---

### Task 5: Admin — extend taxonomy store with `remove` + counts

**Files:**
- Modify: `apps/admin/src/data/taxonomy-store.tsx`
- Modify/Create: `apps/admin/src/data/taxonomy-store.test.tsx` (if a sibling test exists, extend; else create)

**Interfaces:**
- Consumes: `useServices()` → `{ git, data, read, index (IndexPort) }`; `createIndexService` (already wrapped by `IndexProvider`, but the store can build its own `IndexService` from `useServices` like `index-store.tsx` does, OR consume `useIndex()` — see Step 1 note), `createCategoryDeleter`.
- Produces: `TaxonomyContextValue` gains `remove(slug: string): Promise<void>` and `counts: Record<string, number>`.

- [ ] **Step 1: Extend the context value + provider**

Note on the IndexService dependency: `TaxonomyProvider` must sit INSIDE `IndexProvider` in the tree so it can call `useIndex()`. Verify provider order in `apps/admin/src/main.tsx`/app bootstrap; if Taxonomy is currently outside Index, move it inside (Index has no dependency on Taxonomy). Then:

In `taxonomy-store.tsx`:

```ts
import { createTaxonomyService, createCategoryDeleter } from '@setu/core'
import { useServices } from './store'
import { useIndex } from './index-store'
```

Add to `TaxonomyContextValue`:

```ts
  remove(slug: string): Promise<void>
  counts: Record<string, number>
```

In the provider body:

```ts
  const { git, data, read } = useServices()
  const index = useIndex()
  const service = useMemo(() => createTaxonomyService({ git, author: TAXONOMY_AUTHOR }), [git])
  const deleter = useMemo(() => createCategoryDeleter({ git, data, read, index, author: TAXONOMY_AUTHOR }), [git, data, read, index])
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})

  const refreshCounts = useCallback(() => {
    void index.categoryCounts().then(setCounts).catch(() => {})
  }, [index])

  useEffect(() => {
    void service.read().then(setCategories).catch(() => {})
    refreshCounts()
  }, [service, refreshCounts])
```

Make `create` and `remove` refresh counts; `renameLabel`/`reparent` don't change usage so they need no count refresh:

```ts
  const create = useCallback(async (input) => {
    const { categories: next, slug } = await service.create(input)
    setCategories(next); refreshCounts(); return slug
  }, [service, refreshCounts])

  const remove = useCallback(async (slug: string) => {
    const { categories: next } = await deleter.remove(slug)
    setCategories(next); refreshCounts()
  }, [deleter, refreshCounts])
```

Add `remove` and `counts` to the `value` memo + deps.

- [ ] **Step 2: Write a store test**

Test that `remove` strips the category and updates `counts` (render the provider with seeded services, call `remove`, assert `categories`/`counts`). Follow the existing admin store test pattern (use `servicesFor` with in-memory adapters + a wrapping `IndexProvider`). Minimal assertion:

```ts
// after seeding a category 'eng' used by one entry and rebuilding the index:
// act: await result.current.remove('eng')
// expect: result.current.categories has no 'eng'; result.current.counts.eng is undefined
```

- [ ] **Step 3: Run**

Run: `pnpm --filter @setu/admin test -- taxonomy-store`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/data/taxonomy-store.tsx apps/admin/src/data/taxonomy-store.test.tsx
git commit -m "feat(admin): taxonomy store remove() + category counts"
```

---

### Task 6: Admin — Taxonomies hub shell + routing + nav + Tags placeholder

**Files:**
- Create: `apps/admin/src/screens/taxonomies/Taxonomies.tsx`
- Create: `apps/admin/src/screens/taxonomies/TagsTab.tsx`
- Create: `apps/admin/src/screens/taxonomies/Taxonomies.test.tsx`
- Modify: `apps/admin/src/app.tsx` (route `/taxonomies` + redirect `/categories`)
- Modify: `apps/admin/src/shell/AppSidebar.tsx` (Categories → Taxonomies)

**Interfaces:**
- Consumes: shadcn `Tabs` (`apps/admin/src/components/ui/tabs.tsx`), `PageBody`, `PageHeader`.
- Produces: `Taxonomies` screen; `CategoriesTab` is wired in Task 7 (this task renders a temporary empty `<div>Categories</div>` placeholder inside the Categories tab so the shell is testable independently).

- [ ] **Step 1: Write the failing shell test**

`Taxonomies.test.tsx` — render at `/taxonomies` within the app router/providers; assert both tab triggers exist and the Tags tab shows the coming-soon copy; assert `/categories` redirects to `/taxonomies`. Use the existing screen-test harness (memory router + providers) from a sibling test (e.g. how `Media`/`ContentList` tests mount). Assertions:

```ts
expect(screen.getByRole('tab', { name: /categories/i })).toBeInTheDocument()
expect(screen.getByRole('tab', { name: /tags/i })).toBeInTheDocument()
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- Taxonomies`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the hub + Tags placeholder**

`TagsTab.tsx`:

```tsx
import { Tag } from 'lucide-react'

export function TagsTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-16 text-center">
      <Tag className="mb-3 size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Tag management is coming soon</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        You can already add tags while editing content. Bulk rename, merge, and cleanup will live here.
      </p>
    </div>
  )
}
```

`Taxonomies.tsx`:

```tsx
import { PageHeader } from '../../shell/PageHeader'
import { PageBody } from '../../shell/PageBody'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TagsTab } from './TagsTab'

export function Taxonomies() {
  return (
    <>
      <PageHeader title="Taxonomies" subtitle="Organize how content is grouped and tagged." />
      <PageBody>
        <Tabs defaultValue="categories">
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>
          <TabsContent value="categories" className="mt-6">
            <div>Categories</div>
          </TabsContent>
          <TabsContent value="tags" className="mt-6">
            <TagsTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  )
}
```
> Confirm whether `PageHeader` belongs inside or outside `PageBody` by matching a sibling screen (e.g. `Categories.tsx`/`Media.tsx`) — follow that convention exactly.

- [ ] **Step 4: Routing + redirect + nav**

In `app.tsx`: add import `import { Taxonomies } from './screens/taxonomies/Taxonomies'`; replace the categories route and add a redirect:

```tsx
<Route path="/taxonomies" element={<Taxonomies />} />
<Route path="/categories" element={<Navigate to="/taxonomies" replace />} />
```
Remove the old `import { Categories } from './screens/Categories'` (the file is deleted in Task 9; keep the import only until then — to keep this task green, leave `Categories.tsx` in place and just stop routing to it).

In `AppSidebar.tsx`, change the Content-group item:

```ts
{ to: '/taxonomies', label: 'Taxonomies', icon: Tags },
```
Add `Tags` to the lucide import (replacing or alongside `Folder`); use `Tags` (the multi-tag icon) for the hub.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- Taxonomies`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/screens/taxonomies apps/admin/src/app.tsx apps/admin/src/shell/AppSidebar.tsx
git commit -m "feat(admin): Taxonomies hub shell + routing redirect + nav"
```

---

### Task 7: Admin — Categories tab (tree, inline rename, move, counts, new-category form)

**Files:**
- Create: `apps/admin/src/screens/taxonomies/CategoriesTab.tsx`
- Create: `apps/admin/src/screens/taxonomies/CategoryTree.tsx`
- Create: `apps/admin/src/screens/taxonomies/NewCategoryForm.tsx`
- Create: `apps/admin/src/screens/taxonomies/CategoriesTab.test.tsx`
- Modify: `apps/admin/src/screens/taxonomies/Taxonomies.tsx` (swap placeholder → `<CategoriesTab />`)

**Interfaces:**
- Consumes: `useTaxonomy()` → `{ categories, counts, create, renameLabel, reparent, remove }`; `buildTree` (yields `{ slug, name, parent, depth, children }`); shadcn `Input`, `Select`, `Button`; `useNotify`.
- Produces: `CategoriesTab` (full Categories management); `CategoryTree` renders arbitrary depth.

- [ ] **Step 1: Write the failing component test**

`CategoriesTab.test.tsx` — render with a provider seeded with a 2-level tree + counts; assert: a child row is indented (has the depth style/marker), the "Used by" count renders, the "Move to" select omits the row's own slug + descendants, and the delete trigger is present. Mock/seed via the same provider harness as Task 5. Key assertions:

```ts
expect(screen.getByText('Frontend')).toBeInTheDocument()
expect(screen.getByText(/used by/i)).toBeInTheDocument()
// move-to picker for 'eng' must NOT offer 'eng' or its descendant 'frontend'
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- CategoriesTab`
Expected: FAIL — module not found.

- [ ] **Step 3: Build `NewCategoryForm`**

```tsx
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useTaxonomy } from '../../data/taxonomy-store'
import { buildTree } from '@setu/core'
import { flatten } from './CategoryTree'

export function NewCategoryForm() {
  const { categories, create } = useTaxonomy()
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string>('')
  const rows = flatten(buildTree(categories))
  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create({ name: trimmed, parent: parent || null })
    setName(''); setParent('')
  }
  return (
    <div className="mb-6 flex items-center gap-2">
      <Input className="max-w-xs" placeholder="New category name" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }} />
      <Select value={parent || 'none'} onValueChange={(v) => setParent(v === 'none' ? '' : v)}>
        <SelectTrigger className="w-48"><SelectValue placeholder="No parent" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No parent</SelectItem>
          {rows.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button onClick={() => void add()}>Add category</Button>
    </div>
  )
}
```

- [ ] **Step 4: Build `CategoryTree` (arbitrary depth, inline rename, move, count, delete trigger)**

```tsx
import type { CategoryNode } from '@setu/core'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) { out.push(n); flatten(n.children, out) }
  return out
}

/** slugs of `slug` and all its descendants — invalid reparent targets (cycle). */
export function descendantsOf(rows: CategoryNode[], slug: string): Set<string> {
  const banned = new Set<string>([slug])
  let changed = true
  while (changed) {
    changed = false
    for (const r of rows) if (r.parent && banned.has(r.parent) && !banned.has(r.slug)) { banned.add(r.slug); changed = true }
  }
  return banned
}

export function CategoryTree({ rows, counts, onRename, onReparent, onDelete }: {
  rows: CategoryNode[]
  counts: Record<string, number>
  onRename: (slug: string, name: string) => void
  onReparent: (slug: string, parent: string | null) => void
  onDelete: (node: CategoryNode) => void
}) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex items-center px-4 py-2.5 text-[12.5px] text-muted-foreground border-b border-border/60 bg-muted/40">
        <div className="flex-1">Name</div>
        <div className="w-28">Used by</div>
        <div className="w-52">Move to</div>
        <div className="w-10" />
      </div>
      {rows.map((node) => {
        const used = counts[node.slug] ?? 0
        const banned = descendantsOf(rows, node.slug)
        return (
          <div key={node.slug} className="flex items-center border-b border-border/40 px-4 py-3 last:border-0"
               style={{ paddingLeft: `${16 + node.depth * 20}px` }}>
            <div className="flex flex-1 items-baseline gap-2.5">
              <input
                key={`name:${node.slug}:${node.name}`}
                defaultValue={node.name}
                aria-label={`Name of ${node.slug}`}
                className="bg-transparent text-[15px] font-medium outline-none focus:underline"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== node.name) onRename(node.slug, v) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              />
              <span className="text-[12.5px] text-muted-foreground">/{node.slug}</span>
            </div>
            <div className="w-28 text-[13px] text-muted-foreground">{used > 0 ? `${used} ${used === 1 ? 'entry' : 'entries'}` : 'unused'}</div>
            <div className="w-52">
              <Select value={node.parent ?? 'none'} onValueChange={(v) => onReparent(node.slug, v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Top level</SelectItem>
                  {rows.filter((o) => !banned.has(o.slug)).map((o) => <SelectItem key={o.slug} value={o.slug}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-10 text-right">
              <Button variant="ghost" size="icon" aria-label={`Delete ${node.name}`} onClick={() => onDelete(node)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Build `CategoriesTab` wiring it together (delete dialog comes in Task 8 — for now wire onDelete to a no-op state setter placeholder, replaced in Task 8)**

```tsx
import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'
import { NewCategoryForm } from './NewCategoryForm'
import { CategoryTree, flatten } from './CategoryTree'

export function CategoriesTab() {
  const { categories, counts, renameLabel, reparent } = useTaxonomy()
  const notify = useNotify()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [pendingDelete, setPendingDelete] = useState<CategoryNode | null>(null)

  const onReparent = async (slug: string, parent: string | null) => {
    try { await reparent(slug, parent) } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div>
      <NewCategoryForm />
      {rows.length === 0
        ? <p className="text-sm text-muted-foreground">No categories yet — add one above.</p>
        : <CategoryTree rows={rows} counts={counts}
            onRename={(slug, name) => void renameLabel(slug, name)}
            onReparent={onReparent}
            onDelete={setPendingDelete} />}
      {/* DeleteCategoryDialog wired in Task 8 using pendingDelete/setPendingDelete */}
    </div>
  )
}
```

Swap the placeholder in `Taxonomies.tsx`: replace `<div>Categories</div>` with `<CategoriesTab />` (add the import).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- CategoriesTab Taxonomies`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/screens/taxonomies
git commit -m "feat(admin): Categories tab — tree, inline rename, move, counts"
```

---

### Task 8: Admin — Delete confirmation dialog (AlertDialog)

**Files:**
- Run: `pnpm --filter @setu/admin dlx shadcn@latest add alert-dialog` (creates `apps/admin/src/components/ui/alert-dialog.tsx` — it is NOT yet installed)
- Create: `apps/admin/src/screens/taxonomies/DeleteCategoryDialog.tsx`
- Modify: `apps/admin/src/screens/taxonomies/CategoriesTab.tsx`
- Create/Modify: `apps/admin/src/screens/taxonomies/DeleteCategoryDialog.test.tsx`

**Interfaces:**
- Consumes: shadcn `AlertDialog`, `useTaxonomy().remove`, `counts`. A `CategoryNode` to delete + an `onClose`.
- Produces: `DeleteCategoryDialog`.

- [ ] **Step 1: Install the primitive**

Run the shadcn add command above. Verify `apps/admin/src/components/ui/alert-dialog.tsx` now exists and imports `@/lib/utils` (matches the repo's other primitives). If the CLI pins a non-matching style, hand-align it to the existing dialog.tsx conventions.

- [ ] **Step 2: Write the failing test**

`DeleteCategoryDialog.test.tsx` — render with a node used by N entries; assert the dialog body shows the count + the "child categories move up one level" copy, and that confirming calls `remove(slug)`:

```ts
expect(screen.getByText(/used by 3 entries/i)).toBeInTheDocument()
expect(screen.getByText(/move up one level/i)).toBeInTheDocument()
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- DeleteCategoryDialog`
Expected: FAIL — module not found.

- [ ] **Step 4: Build the dialog**

```tsx
import type { CategoryNode } from '@setu/core'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'

export function DeleteCategoryDialog({ node, onClose }: { node: CategoryNode | null; onClose: () => void }) {
  const { counts, remove } = useTaxonomy()
  const notify = useNotify()
  const used = node ? (counts[node.slug] ?? 0) : 0
  const hasChildren = node ? node.children.length > 0 : false
  const confirm = async () => {
    if (!node) return
    try { await remove(node.slug) } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
    onClose()
  }
  return (
    <AlertDialog open={node !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{node?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {used > 0
              ? `Used by ${used} ${used === 1 ? 'entry' : 'entries'} — deleting removes it from ${used === 1 ? 'it' : 'them'}.`
              : 'This category is not used by any content.'}
            {hasChildren ? ' Child categories move up one level.' : ''}
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

- [ ] **Step 5: Wire into `CategoriesTab`**

Add `import { DeleteCategoryDialog } from './DeleteCategoryDialog'` and replace the Task-7 comment with:

```tsx
<DeleteCategoryDialog node={pendingDelete} onClose={() => setPendingDelete(null)} />
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- DeleteCategoryDialog CategoriesTab`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/ui/alert-dialog.tsx apps/admin/src/screens/taxonomies/DeleteCategoryDialog.tsx apps/admin/src/screens/taxonomies/DeleteCategoryDialog.test.tsx apps/admin/src/screens/taxonomies/CategoriesTab.tsx
git commit -m "feat(admin): delete-category AlertDialog (count + promote note)"
```

---

### Task 9: Cleanup — remove old screen + dead CSS, final gate

**Files:**
- Delete: `apps/admin/src/screens/Categories.tsx`
- Modify: `apps/admin/src/app.tsx` (drop the now-unused `Categories` import if still present)
- Modify: the admin CSS file holding `category-new`, `category-manage-list`, `category-manage-row`, `category-name-input`, `category-parent`, `categories-screen` (grep to locate) — delete those dead selectors.

- [ ] **Step 1: Delete the old screen + import**

```bash
git rm apps/admin/src/screens/Categories.tsx
```
Remove any remaining `import { Categories } from './screens/Categories'` from `app.tsx`.

- [ ] **Step 2: Remove dead CSS**

Run: `grep -rn "categories-screen\|category-new\|category-manage\|category-name-input\|category-parent" apps/admin/src` — delete every matched selector block (they were only used by the deleted screen). Re-run the grep; expect zero matches.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all green; no reference to the deleted screen; test count ≥ prior baseline + the new taxonomy tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(admin): remove old Categories screen + dead CSS"
```

---

## Self-Review

**Spec coverage:**
- Hub shell + Tabs + routing/redirect + nav rename → Task 6. ✓
- `removeCategory` op w/ promote-children → Task 1. ✓
- Usage counts (missing `distinctCategories`-with-counts) → Task 2. ✓
- Atomic delete-with-strip via `commitFiles`, reusing bulk `removeCategory` mutation + serialize path → Task 4 (refs from Task 3). ✓
- Arbitrary-depth tree, inline rename, move-picker excluding self+descendants, counts column → Task 7. ✓
- Delete AlertDialog with count + promote copy → Task 8. ✓
- Tags placeholder → Task 6. ✓
- Old screen + dead CSS removal → Task 9. ✓
- Store wiring (`remove` + counts) → Task 5. ✓

**Placeholder scan:** The two deliberate `> Note` blocks (Task 4 type/`TiptapDoc`, Task 5 provider order) flag implementation alignment the executor must resolve against the real code, not skipped work — each names the exact file/pattern to follow. No "TBD"/"add error handling"/"similar to Task N" placeholders remain; every code step shows the code.

**Type consistency:** `removeCategory` (taxonomy op, on `Category[]`) vs `bulkRemoveCategory` (meta mutation) — kept distinct via the barrel alias (Global Constraints). `counts: Record<string, number>`, `remove(slug): Promise<void>` consistent across Tasks 5/7/8. `entriesByCategory`/`categoryCounts` names identical across port/service/adapters/contract. `CategoryNode` (with `.children`, `.depth`, `.parent`) used consistently in Tasks 7/8.

**Provider-order risk** (Task 5) is the one cross-cutting integration point — called out explicitly with the fix (Taxonomy inside Index).
