# Categories & Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors create, nest, select, re-parent, and rename categories — creating them inline while writing a post, with no pre-definition step.

**Architecture:** A Git-native taxonomy stored at `taxonomy/categories.yaml` (flat list of `{slug, name, parent}`). A pure, topology-agnostic `core/taxonomy` module (parse/serialize, tree-build, validated mutation ops) backs a git-committing `TaxonomyService`. The admin wraps it in a `TaxonomyProvider`; a `CategoryField` in the editor's MetaPanel gives a checkbox tree + inline create, and a `/categories` screen offers re-parent + rename-label. Creating/editing categories commits immediately; applying a category to a post is draft metadata committed on publish.

**Tech Stack:** TypeScript, React 18, react-router-dom, js-yaml (already a `@setu/core` dep), Vitest + @testing-library/react.

## Global Constraints

- **Taxonomy file path:** `taxonomy/categories.yaml` (repo root, sibling to `content/`). Constant `TAXONOMY_PATH`.
- **Reference by slug:** posts store `categories: string[]` of **slugs** in frontmatter/draft metadata.
- **Categories commit immediately** via `GitPort.commitFile`; **applying a category to a post is draft metadata** (saved with the draft, committed on publish).
- **Single parent** per category (a tree, not a DAG); `parent: null` = root.
- **Tolerant of absent/empty file** → empty list, never throws on read.
- **No counts, no delete, no slug-rename in this slice** (deferred — see spec non-goals).
- **Cloudflare-Pages-compatible + cost-safe:** pure functions + existing ports only; no new runtime deps.
- **js-yaml** `dump`/`load` is the only YAML mechanism (mirror `packages/core/src/markdoc/frontmatter.ts`).
- Spec: `docs/superpowers/specs/2026-06-20-setu-categories-taxonomy-design.md`.

---

### Task 1: Core types + parse/serialize

**Files:**
- Create: `packages/core/src/taxonomy/types.ts`
- Create: `packages/core/src/taxonomy/parse.ts`
- Test: `packages/core/src/taxonomy/parse.test.ts`

**Interfaces:**
- Produces: `Category = { slug: string; name: string; parent: string | null }`, `CategoryNode = Category & { children: CategoryNode[]; depth: number }`; `parseCategories(raw: string): Category[]`; `serializeCategories(cats: Category[]): string`.

- [ ] **Step 1: Write the types**

`packages/core/src/taxonomy/types.ts`:
```ts
/** A single category. `parent` is the slug of its parent, or null for a root. */
export interface Category {
  slug: string
  name: string
  parent: string | null
}

/** A category assembled into the hierarchy, with its children and 0-based depth. */
export interface CategoryNode extends Category {
  children: CategoryNode[]
  depth: number
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/taxonomy/parse.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseCategories, serializeCategories } from './parse'
import type { Category } from './types'

describe('parseCategories', () => {
  it('returns [] for empty or whitespace input', () => {
    expect(parseCategories('')).toEqual([])
    expect(parseCategories('   \n')).toEqual([])
  })

  it('parses a flat list with parent refs', () => {
    const yaml = '- slug: tutorials\n  name: Tutorials\n  parent: null\n- slug: react\n  name: React\n  parent: tutorials\n'
    expect(parseCategories(yaml)).toEqual([
      { slug: 'tutorials', name: 'Tutorials', parent: null },
      { slug: 'react', name: 'React', parent: 'tutorials' },
    ])
  })

  it('defaults a missing parent to null and skips malformed rows', () => {
    expect(parseCategories('- slug: a\n  name: A\n- name: nope\n')).toEqual([
      { slug: 'a', name: 'A', parent: null },
    ])
  })

  it('returns [] on non-list / malformed YAML rather than throwing', () => {
    expect(parseCategories('not: a list')).toEqual([])
    expect(parseCategories('::: broken')).toEqual([])
  })
})

describe('serializeCategories', () => {
  it('round-trips through parseCategories', () => {
    const cats: Category[] = [
      { slug: 'tutorials', name: 'Tutorials', parent: null },
      { slug: 'react', name: 'React', parent: 'tutorials' },
    ]
    expect(parseCategories(serializeCategories(cats))).toEqual(cats)
  })

  it('serializes an empty list to empty string', () => {
    expect(serializeCategories([])).toBe('')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/taxonomy/parse.test.ts`
Expected: FAIL — cannot find module `./parse`.

- [ ] **Step 4: Implement parse/serialize**

`packages/core/src/taxonomy/parse.ts`:
```ts
import { dump, load } from 'js-yaml'
import type { Category } from './types'

/** Parse `taxonomy/categories.yaml`. Tolerant: empty/absent/malformed → []. A row
 *  needs a string `slug` and `name`; `parent` defaults to null. Never throws. */
export function parseCategories(raw: string): Category[] {
  let data: unknown
  try {
    data = load(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: Category[] = []
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.slug !== 'string' || typeof r.name !== 'string') continue
    out.push({ slug: r.slug, name: r.name, parent: typeof r.parent === 'string' ? r.parent : null })
  }
  return out
}

/** Serialize categories to YAML. Empty list → empty string (no file content). */
export function serializeCategories(cats: Category[]): string {
  if (cats.length === 0) return ''
  return dump(cats.map((c) => ({ slug: c.slug, name: c.name, parent: c.parent })))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/taxonomy/parse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/taxonomy/types.ts packages/core/src/taxonomy/parse.ts packages/core/src/taxonomy/parse.test.ts
git commit -m "feat(taxonomy): category types + YAML parse/serialize"
```

---

### Task 2: buildTree

**Files:**
- Create: `packages/core/src/taxonomy/tree.ts`
- Test: `packages/core/src/taxonomy/tree.test.ts`

**Interfaces:**
- Consumes: `Category`, `CategoryNode` from `./types`.
- Produces: `buildTree(cats: Category[]): CategoryNode[]` — roots in input order; orphans (missing parent) and cycle members surface as roots; `depth` is 0-based.

- [ ] **Step 1: Write the failing test**

`packages/core/src/taxonomy/tree.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildTree } from './tree'
import type { Category } from './types'

const cat = (slug: string, parent: string | null = null): Category => ({ slug, name: slug, parent })

describe('buildTree', () => {
  it('nests children under parents with depth', () => {
    const tree = buildTree([cat('a'), cat('b', 'a'), cat('c', 'b')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.slug).toBe('a')
    expect(tree[0]!.depth).toBe(0)
    expect(tree[0]!.children[0]!.slug).toBe('b')
    expect(tree[0]!.children[0]!.depth).toBe(1)
    expect(tree[0]!.children[0]!.children[0]!.slug).toBe('c')
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2)
  })

  it('treats an orphan (missing parent) as a root', () => {
    const tree = buildTree([cat('x', 'ghost')])
    expect(tree.map((n) => n.slug)).toEqual(['x'])
    expect(tree[0]!.depth).toBe(0)
  })

  it('does not loop on a cycle; cycle members surface as roots', () => {
    const tree = buildTree([cat('a', 'b'), cat('b', 'a')])
    expect(tree.map((n) => n.slug).sort()).toEqual(['a', 'b'])
  })

  it('preserves input order of roots', () => {
    expect(buildTree([cat('z'), cat('m'), cat('a')]).map((n) => n.slug)).toEqual(['z', 'm', 'a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/taxonomy/tree.test.ts`
Expected: FAIL — cannot find module `./tree`.

- [ ] **Step 3: Implement buildTree**

`packages/core/src/taxonomy/tree.ts`:
```ts
import type { Category, CategoryNode } from './types'

/** Assemble categories into a forest. A category whose parent is null, missing,
 *  or part of a cycle becomes a root — so the function never drops a node and
 *  never loops on malformed data. Roots keep input order; depth is 0-based. */
export function buildTree(cats: Category[]): CategoryNode[] {
  const bySlug = new Map(cats.map((c) => [c.slug, c]))
  const nodes = new Map<string, CategoryNode>(cats.map((c) => [c.slug, { ...c, children: [], depth: 0 }]))

  // The parent to attach under: null when root, missing, or reachable-cycle.
  const effectiveParent = (c: Category): string | null => {
    if (c.parent === null || !bySlug.has(c.parent)) return null
    const seen = new Set<string>([c.slug])
    let p: string | null = c.parent
    while (p !== null) {
      if (seen.has(p)) return null // cycle
      seen.add(p)
      p = bySlug.get(p)?.parent ?? null
    }
    return c.parent
  }

  const roots: CategoryNode[] = []
  for (const c of cats) {
    const node = nodes.get(c.slug)!
    const ep = effectiveParent(c)
    if (ep === null) roots.push(node)
    else nodes.get(ep)!.children.push(node)
  }

  const assignDepth = (node: CategoryNode, depth: number): void => {
    node.depth = depth
    for (const child of node.children) assignDepth(child, depth + 1)
  }
  for (const r of roots) assignDepth(r, 0)
  return roots
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/taxonomy/tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/taxonomy/tree.ts packages/core/src/taxonomy/tree.test.ts
git commit -m "feat(taxonomy): buildTree with orphan/cycle safety"
```

---

### Task 3: Mutation ops (add / rename-label / reparent)

**Files:**
- Create: `packages/core/src/taxonomy/ops.ts`
- Test: `packages/core/src/taxonomy/ops.test.ts`

**Interfaces:**
- Consumes: `Category` from `./types`.
- Produces:
  - `class TaxonomyError extends Error { code: 'parent-not-found' | 'not-found' | 'cycle' }`
  - `slugify(name: string): string`
  - `addCategory(cats: Category[], input: { name: string; parent: string | null }): { cats: Category[]; slug: string }`
  - `renameLabel(cats: Category[], slug: string, name: string): Category[]`
  - `reparent(cats: Category[], slug: string, parent: string | null): Category[]`
- All ops are pure (return new arrays); invariants throw `TaxonomyError`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/taxonomy/ops.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { addCategory, renameLabel, reparent, slugify, TaxonomyError } from './ops'
import type { Category } from './types'

const cat = (slug: string, parent: string | null = null): Category => ({ slug, name: slug, parent })

describe('slugify', () => {
  it('lowercases, hyphenates, drops punctuation', () => {
    expect(slugify('  React Native! ')).toBe('react-native')
  })
  it('falls back to "category" for empty/symbol-only', () => {
    expect(slugify('!!!')).toBe('category')
  })
})

describe('addCategory', () => {
  it('adds a root category, slugified', () => {
    const { cats, slug } = addCategory([], { name: 'Tutorials', parent: null })
    expect(slug).toBe('tutorials')
    expect(cats).toEqual([{ slug: 'tutorials', name: 'Tutorials', parent: null }])
  })
  it('de-duplicates slugs with a numeric suffix', () => {
    const { slug } = addCategory([cat('react')], { name: 'React', parent: null })
    expect(slug).toBe('react-2')
  })
  it('throws when parent does not exist', () => {
    expect(() => addCategory([], { name: 'X', parent: 'ghost' })).toThrow(TaxonomyError)
  })
  it('trims the display name', () => {
    const { cats } = addCategory([], { name: '  Spaced  ', parent: null })
    expect(cats[0]!.name).toBe('Spaced')
  })
})

describe('renameLabel', () => {
  it('changes only the name', () => {
    expect(renameLabel([cat('a')], 'a', 'Alpha')).toEqual([{ slug: 'a', name: 'Alpha', parent: null }])
  })
  it('throws when slug missing', () => {
    expect(() => renameLabel([], 'a', 'Alpha')).toThrow(TaxonomyError)
  })
})

describe('reparent', () => {
  it('moves a category under a new parent', () => {
    expect(reparent([cat('a'), cat('b')], 'b', 'a')).toEqual([
      { slug: 'a', name: 'a', parent: null },
      { slug: 'b', name: 'b', parent: 'a' },
    ])
  })
  it('moves a category to root', () => {
    expect(reparent([cat('a'), cat('b', 'a')], 'b', null)[1]!.parent).toBeNull()
  })
  it('throws on self-parent', () => {
    expect(() => reparent([cat('a')], 'a', 'a')).toThrow(TaxonomyError)
  })
  it('throws when the move would create a cycle', () => {
    // a -> b -> c; reparenting a under c loops
    const cats = [cat('a'), cat('b', 'a'), cat('c', 'b')]
    expect(() => reparent(cats, 'a', 'c')).toThrow(TaxonomyError)
  })
  it('throws when parent does not exist', () => {
    expect(() => reparent([cat('a')], 'a', 'ghost')).toThrow(TaxonomyError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/taxonomy/ops.test.ts`
Expected: FAIL — cannot find module `./ops`.

- [ ] **Step 3: Implement ops**

`packages/core/src/taxonomy/ops.ts`:
```ts
import type { Category } from './types'

export type TaxonomyErrorCode = 'parent-not-found' | 'not-found' | 'cycle'

/** A validation failure from a taxonomy op. `code` lets the UI show a message. */
export class TaxonomyError extends Error {
  code: TaxonomyErrorCode
  constructor(code: TaxonomyErrorCode, message: string) {
    super(message)
    this.name = 'TaxonomyError'
    this.code = code
  }
}

/** Name → URL-safe slug. Keeps letters/numbers, hyphenates the rest; 'category'
 *  when nothing survives. (Mirrors the editor's entry slugify.) */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'category'
}

const uniqueSlug = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Append a new category. Slugified + de-duplicated. Throws if `parent` is set
 *  but absent. Returns the new list and the minted slug. */
export function addCategory(
  cats: Category[],
  input: { name: string; parent: string | null },
): { cats: Category[]; slug: string } {
  if (input.parent !== null && !cats.some((c) => c.slug === input.parent)) {
    throw new TaxonomyError('parent-not-found', `Parent "${input.parent}" does not exist`)
  }
  const slug = uniqueSlug(slugify(input.name), new Set(cats.map((c) => c.slug)))
  return { cats: [...cats, { slug, name: input.name.trim(), parent: input.parent }], slug }
}

/** Change a category's display name only (posts reference the slug, untouched). */
export function renameLabel(cats: Category[], slug: string, name: string): Category[] {
  if (!cats.some((c) => c.slug === slug)) throw new TaxonomyError('not-found', `Category "${slug}" does not exist`)
  return cats.map((c) => (c.slug === slug ? { ...c, name: name.trim() } : c))
}

/** Move a category under a new parent (or null for root). Throws on missing
 *  slug/parent, self-parent, or a move that would create a cycle. */
export function reparent(cats: Category[], slug: string, parent: string | null): Category[] {
  if (!cats.some((c) => c.slug === slug)) throw new TaxonomyError('not-found', `Category "${slug}" does not exist`)
  if (parent !== null) {
    if (!cats.some((c) => c.slug === parent)) {
      throw new TaxonomyError('parent-not-found', `Parent "${parent}" does not exist`)
    }
    const bySlug = new Map(cats.map((c) => [c.slug, c]))
    let p: string | null = parent
    while (p !== null) {
      if (p === slug) throw new TaxonomyError('cycle', 'Move would create a cycle')
      p = bySlug.get(p)?.parent ?? null
    }
  }
  return cats.map((c) => (c.slug === slug ? { ...c, parent } : c))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/taxonomy/ops.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/taxonomy/ops.ts packages/core/src/taxonomy/ops.test.ts
git commit -m "feat(taxonomy): validated add/rename/reparent ops"
```

---

### Task 4: Git-backed TaxonomyService + barrel exports

**Files:**
- Create: `packages/core/src/taxonomy/service.ts`
- Test: `packages/core/src/taxonomy/service.test.ts`
- Modify: `packages/core/src/index.ts` (add taxonomy exports)

**Interfaces:**
- Consumes: `GitPort` (`./git/git-port`), `GitAuthor` (`./git/types`); `Category`, `parseCategories`/`serializeCategories`, `addCategory`/`renameLabel`/`reparent`.
- Produces:
  - `TAXONOMY_PATH = 'taxonomy/categories.yaml'`
  - `interface TaxonomyService { read(): Promise<Category[]>; create(input: { name: string; parent: string | null }): Promise<{ categories: Category[]; slug: string }>; renameLabel(slug: string, name: string): Promise<Category[]>; reparent(slug: string, parent: string | null): Promise<Category[]> }`
  - `createTaxonomyService(deps: { git: GitPort; author: GitAuthor }): TaxonomyService`

- [ ] **Step 1: Write the failing test**

`packages/core/src/taxonomy/service.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createMemoryGitPort } from '@setu/git-memory'
import { createTaxonomyService, TAXONOMY_PATH } from './service'
import { parseCategories } from './parse'

const author = { name: 'Test', email: 'test@setu.dev' }

describe('TaxonomyService', () => {
  it('reads [] when the file is absent', async () => {
    const svc = createTaxonomyService({ git: createMemoryGitPort(), author })
    expect(await svc.read()).toEqual([])
  })

  it('create commits the category and returns the new list + slug', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    const { categories, slug } = await svc.create({ name: 'Tutorials', parent: null })
    expect(slug).toBe('tutorials')
    expect(categories).toEqual([{ slug: 'tutorials', name: 'Tutorials', parent: null }])
    expect(parseCategories((await git.readFile(TAXONOMY_PATH))!)).toEqual(categories)
  })

  it('create nests under an existing parent', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    await svc.create({ name: 'Tutorials', parent: null })
    const { slug } = await svc.create({ name: 'React', parent: 'tutorials' })
    expect(slug).toBe('react')
    expect((await svc.read()).find((c) => c.slug === 'react')!.parent).toBe('tutorials')
  })

  it('renameLabel and reparent persist to git', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    await svc.create({ name: 'Tutorials', parent: null })
    await svc.create({ name: 'React', parent: null })
    await svc.renameLabel('tutorials', 'Guides')
    const afterReparent = await svc.reparent('react', 'tutorials')
    expect(afterReparent.find((c) => c.slug === 'tutorials')!.name).toBe('Guides')
    expect(afterReparent.find((c) => c.slug === 'react')!.parent).toBe('tutorials')
    expect(parseCategories((await git.readFile(TAXONOMY_PATH))!)).toEqual(afterReparent)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/taxonomy/service.test.ts`
Expected: FAIL — cannot find module `./service`.

- [ ] **Step 3: Implement the service**

`packages/core/src/taxonomy/service.ts`:
```ts
import type { GitPort } from '../git/git-port'
import type { GitAuthor } from '../git/types'
import type { Category } from './types'
import { parseCategories, serializeCategories } from './parse'
import { addCategory, renameLabel as renameLabelOp, reparent as reparentOp } from './ops'

export const TAXONOMY_PATH = 'taxonomy/categories.yaml'

export interface TaxonomyService {
  read(): Promise<Category[]>
  create(input: { name: string; parent: string | null }): Promise<{ categories: Category[]; slug: string }>
  renameLabel(slug: string, name: string): Promise<Category[]>
  reparent(slug: string, parent: string | null): Promise<Category[]>
}

/** Git-backed category store. Each mutation reads the current file, applies a
 *  pure op, and commits the whole file — categories are shared infrastructure,
 *  committed immediately (not staged with a draft). */
export function createTaxonomyService(deps: { git: GitPort; author: GitAuthor }): TaxonomyService {
  const { git, author } = deps

  async function read(): Promise<Category[]> {
    const raw = await git.readFile(TAXONOMY_PATH)
    return parseCategories(raw ?? '')
  }

  async function commit(cats: Category[], message: string): Promise<Category[]> {
    await git.commitFile({ path: TAXONOMY_PATH, content: serializeCategories(cats), message, author })
    return cats
  }

  return {
    read,
    async create({ name, parent }) {
      const { cats, slug } = addCategory(await read(), { name, parent })
      const categories = await commit(cats, `taxonomy: add category ${slug}`)
      return { categories, slug }
    },
    async renameLabel(slug, name) {
      return commit(renameLabelOp(await read(), slug, name), `taxonomy: rename ${slug}`)
    },
    async reparent(slug, parent) {
      return commit(reparentOp(await read(), slug, parent), `taxonomy: reparent ${slug}`)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/taxonomy/service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add barrel exports**

In `packages/core/src/index.ts`, after the index-port export block (around line 71), add:
```ts
export type { Category, CategoryNode } from './taxonomy/types'
export { parseCategories, serializeCategories } from './taxonomy/parse'
export { buildTree } from './taxonomy/tree'
export { addCategory, renameLabel, reparent, slugify, TaxonomyError } from './taxonomy/ops'
export type { TaxonomyErrorCode } from './taxonomy/ops'
export type { TaxonomyService } from './taxonomy/service'
export { createTaxonomyService, TAXONOMY_PATH } from './taxonomy/service'
```

- [ ] **Step 6: Verify the package builds + all core tests pass**

Run: `cd packages/core && pnpm vitest run src/taxonomy && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/taxonomy/service.ts packages/core/src/taxonomy/service.test.ts packages/core/src/index.ts
git commit -m "feat(taxonomy): git-backed TaxonomyService + barrel exports"
```

---

### Task 5: Admin TaxonomyProvider

**Files:**
- Create: `apps/admin/src/data/taxonomy-store.tsx`
- Test: `apps/admin/src/data/taxonomy-store.test.tsx`
- Modify: `apps/admin/src/main.tsx` (mount the provider)

**Interfaces:**
- Consumes: `useServices()` (`./store`) → `{ git }`; `createTaxonomyService`, `buildTree`, types from `@setu/core`.
- Produces:
  - `interface TaxonomyContextValue { categories: Category[]; create(input: { name: string; parent: string | null }): Promise<string>; renameLabel(slug: string, name: string): Promise<void>; reparent(slug: string, parent: string | null): Promise<void> }`
  - `TaxonomyProvider({ children }: { children: ReactNode })`
  - `useTaxonomy(): TaxonomyContextValue`

- [ ] **Step 1: Write the failing test**

`apps/admin/src/data/taxonomy-store.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { servicesFor } from './store'
import { ServicesProvider } from './store'
import { TaxonomyProvider, useTaxonomy } from './taxonomy-store'

function Probe() {
  const { categories, create } = useTaxonomy()
  return (
    <div>
      <button onClick={() => void create({ name: 'Tutorials', parent: null })}>add</button>
      <ul>{categories.map((c) => <li key={c.slug}>{c.slug}</li>)}</ul>
    </div>
  )
}

function wrap() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <ServicesProvider services={services}>
      <TaxonomyProvider>
        <Probe />
      </TaxonomyProvider>
    </ServicesProvider>,
  )
}

describe('TaxonomyProvider', () => {
  it('starts empty and adds a category on create', async () => {
    wrap()
    expect(screen.queryByText('tutorials')).toBeNull()
    screen.getByText('add').click()
    await waitFor(() => expect(screen.getByText('tutorials')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run src/data/taxonomy-store.test.tsx`
Expected: FAIL — cannot find module `./taxonomy-store`.

- [ ] **Step 3: Implement the provider**

`apps/admin/src/data/taxonomy-store.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Category } from '@setu/core'
import { createTaxonomyService } from '@setu/core'
import { useServices } from './store'

/** The editor's identity stamped on taxonomy commits (matches the editor's). */
const TAXONOMY_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

export interface TaxonomyContextValue {
  categories: Category[]
  /** Create a category; returns the minted slug. */
  create(input: { name: string; parent: string | null }): Promise<string>
  renameLabel(slug: string, name: string): Promise<void>
  reparent(slug: string, parent: string | null): Promise<void>
}

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null)

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const service = useMemo(() => createTaxonomyService({ git, author: TAXONOMY_AUTHOR }), [git])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    void service.read().then(setCategories).catch(() => {})
  }, [service])

  const create = useCallback(
    async (input: { name: string; parent: string | null }) => {
      const { categories: next, slug } = await service.create(input)
      setCategories(next)
      return slug
    },
    [service],
  )
  const renameLabel = useCallback(
    async (slug: string, name: string) => setCategories(await service.renameLabel(slug, name)),
    [service],
  )
  const reparent = useCallback(
    async (slug: string, parent: string | null) => setCategories(await service.reparent(slug, parent)),
    [service],
  )

  const value = useMemo<TaxonomyContextValue>(
    () => ({ categories, create, renameLabel, reparent }),
    [categories, create, renameLabel, reparent],
  )
  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>
}

export function useTaxonomy(): TaxonomyContextValue {
  const ctx = useContext(TaxonomyContext)
  if (ctx === null) throw new Error('useTaxonomy must be used within a TaxonomyProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run src/data/taxonomy-store.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount the provider in `main.tsx`**

In `apps/admin/src/main.tsx`, add the import after the `IndexProvider` import:
```tsx
import { TaxonomyProvider } from './data/taxonomy-store'
```
Then wrap `IndexProvider` so the tree reads (note added `TaxonomyProvider`):
```tsx
          <DeployProvider>
            <IndexProvider>
              <TaxonomyProvider>
                <App />
              </TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
```

- [ ] **Step 6: Verify build + commit**

Run: `cd apps/admin && pnpm vitest run src/data/taxonomy-store.test.tsx && pnpm typecheck`
Expected: PASS; typecheck clean.

```bash
git add apps/admin/src/data/taxonomy-store.tsx apps/admin/src/data/taxonomy-store.test.tsx apps/admin/src/main.tsx
git commit -m "feat(taxonomy): admin TaxonomyProvider + mount"
```

---

### Task 6: CategoryField in the MetaPanel (the writing flow)

**Files:**
- Create: `apps/admin/src/editor/CategoryField.tsx`
- Create: `apps/admin/src/editor/CategoryField.test.tsx`
- Modify: `apps/admin/src/editor/MetaPanel.tsx` (render the field)

**Interfaces:**
- Consumes: `useTaxonomy()` (`../data/taxonomy-store`); `buildTree`, `CategoryNode` from `@setu/core`.
- Produces: `CategoryField({ selected, onChange, editable }: { selected: string[]; onChange: (next: string[]) => void; editable: boolean })`.
- MetaPanel reads/writes the selection at `metadata.categories` (a `string[]` of slugs).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/editor/CategoryField.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../data/store'
import { TaxonomyProvider } from '../data/taxonomy-store'
import { CategoryField } from './CategoryField'

function setup(selected: string[] = []) {
  const onChange = vi.fn()
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  render(
    <ServicesProvider services={services}>
      <TaxonomyProvider>
        <CategoryField selected={selected} onChange={onChange} editable />
      </TaxonomyProvider>
    </ServicesProvider>,
  )
  return { onChange }
}

describe('CategoryField', () => {
  it('inline-creates a category and selects it', async () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'Tutorials' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByLabelText('Tutorials')).toBeTruthy())
    expect(onChange).toHaveBeenCalledWith(['tutorials'])
  })

  it('toggles an existing category off when checked', async () => {
    // create first so it exists, then render selected
    const git = createMemoryGitPort()
    const services = servicesFor(createMemoryDataPort(), git)
    const onChange = vi.fn()
    const { rerender } = render(
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <CategoryField selected={[]} onChange={onChange} editable />
        </TaxonomyProvider>
      </ServicesProvider>,
    )
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'News' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByLabelText('News')).toBeTruthy())
    onChange.mockClear()
    rerender(
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <CategoryField selected={['news']} onChange={onChange} editable />
        </TaxonomyProvider>
      </ServicesProvider>,
    )
    fireEvent.click(screen.getByLabelText('News'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run src/editor/CategoryField.test.tsx`
Expected: FAIL — cannot find module `./CategoryField`.

- [ ] **Step 3: Implement CategoryField**

`apps/admin/src/editor/CategoryField.tsx`:
```tsx
import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'

/** Flatten the tree depth-first so it renders as indented checkbox rows. */
function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function CategoryField({
  selected,
  onChange,
  editable,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editable: boolean
}) {
  const { categories, create } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')

  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const slug = await create({ name: trimmed, parent: parent || null })
    if (!selected.includes(slug)) onChange([...selected, slug])
    setName('')
    setParent('')
  }

  return (
    <div className="category-field">
      <div className="category-tree" role="group" aria-label="Categories">
        {rows.length === 0 && <p className="muted">No categories yet — add one below.</p>}
        {rows.map((node) => (
          <label key={node.slug} className="category-row" style={{ paddingLeft: `${node.depth * 16}px` }}>
            <input
              type="checkbox"
              checked={selected.includes(node.slug)}
              disabled={!editable}
              onChange={() => toggle(node.slug)}
            />
            <span>{node.name}</span>
          </label>
        ))}
      </div>
      <div className="category-new">
        <input
          type="text"
          placeholder="New category"
          value={name}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <select value={parent} disabled={!editable} onChange={(e) => setParent(e.target.value)} aria-label="Parent category">
          <option value="">No parent</option>
          {rows.map((node) => (
            <option key={node.slug} value={node.slug}>
              {' '.repeat(node.depth * 2)}
              {node.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!editable} onClick={() => void submit()}>
          Add
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run src/editor/CategoryField.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Render the field in MetaPanel**

In `apps/admin/src/editor/MetaPanel.tsx`, add the import at the top:
```tsx
import { CategoryField } from './CategoryField'
```
Then add a Categories section between the Status and Permalink sections (after the Status `</section>`, before the Permalink `<section>`):
```tsx
      <section className="meta-section">
        <h2 className="meta-title">Categories</h2>
        <CategoryField
          selected={Array.isArray(metadata['categories']) ? (metadata['categories'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, categories: next })}
          editable={editable}
        />
      </section>
```

- [ ] **Step 6: Verify MetaPanel still builds (it now needs the provider in any render)**

Run: `cd apps/admin && pnpm vitest run src/editor && pnpm typecheck`
Expected: PASS. Note: if an existing editor test renders `EditorScreen` without `TaxonomyProvider`, wrap it — `EditorScreen` is mounted under `TaxonomyProvider` in `main.tsx`, so tests must mirror that. Search: `grep -rln "EditorScreen" apps/admin/src/**/*.test.tsx`; add `TaxonomyProvider` around the rendered tree in any that fail.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/CategoryField.tsx apps/admin/src/editor/CategoryField.test.tsx apps/admin/src/editor/MetaPanel.tsx
git commit -m "feat(taxonomy): MetaPanel CategoryField with inline create"
```

---

### Task 7: Categories management screen (cheap tier)

**Files:**
- Create: `apps/admin/src/screens/Categories.tsx`
- Create: `apps/admin/src/screens/Categories.test.tsx`
- Modify: `apps/admin/src/app.tsx` (route)
- Modify: `apps/admin/src/shell/Sidebar.tsx` (nav link)

**Interfaces:**
- Consumes: `useTaxonomy()`; `buildTree`, `CategoryNode` from `@setu/core`; `PageHeader` (`../shell/PageHeader`).
- Produces: `Categories()` screen at route `/categories`. Re-parent (a `<select>` per row) + rename label (editable name). No counts (deferred).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/screens/Categories.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../data/store'
import { TaxonomyProvider } from '../data/taxonomy-store'
import { Categories } from './Categories'

function wrap() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <Categories />
        </TaxonomyProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('Categories screen', () => {
  it('shows the empty state', () => {
    wrap()
    expect(screen.getByText(/no categories yet/i)).toBeTruthy()
  })

  it('creates then renames a category label', async () => {
    wrap()
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'Tutorials' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByDisplayValue('Tutorials')).toBeTruthy())
    const nameInput = screen.getByDisplayValue('Tutorials')
    fireEvent.change(nameInput, { target: { value: 'Guides' } })
    fireEvent.blur(nameInput)
    await waitFor(() => expect(screen.getByDisplayValue('Guides')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run src/screens/Categories.test.tsx`
Expected: FAIL — cannot find module `./Categories`.

- [ ] **Step 3: Implement the screen**

`apps/admin/src/screens/Categories.tsx`:
```tsx
import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { useTaxonomy } from '../data/taxonomy-store'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function Categories() {
  const { categories, create, renameLabel, reparent } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create({ name: trimmed, parent: null })
    setName('')
  }

  const onReparent = async (slug: string, parent: string) => {
    setError(null)
    try {
      await reparent(slug, parent || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="categories-screen">
      <PageHeader title="Categories" subtitle="Organize how posts are grouped." />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="category-new">
        <input
          type="text"
          placeholder="New category"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <button type="button" onClick={() => void add()}>Add</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No categories yet — add one above.</p>
      ) : (
        <ul className="category-manage-list">
          {rows.map((node) => (
            <li key={node.slug} className="category-manage-row" style={{ paddingLeft: `${node.depth * 16}px` }}>
              <input
                className="category-name-input"
                defaultValue={node.name}
                aria-label={`Name of ${node.slug}`}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== node.name) void renameLabel(node.slug, v)
                }}
              />
              <label className="category-parent">
                <span className="muted">Parent</span>
                <select value={node.parent ?? ''} aria-label={`Parent of ${node.slug}`} onChange={(e) => void onReparent(node.slug, e.target.value)}>
                  <option value="">None</option>
                  {rows
                    .filter((o) => o.slug !== node.slug)
                    .map((o) => (
                      <option key={o.slug} value={o.slug}>{o.name}</option>
                    ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run src/screens/Categories.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the route**

In `apps/admin/src/app.tsx`, add the import with the other screen imports:
```tsx
import { Categories } from './screens/Categories'
```
Add the route after the `/pages` route:
```tsx
          <Route path="/categories" element={<Categories />} />
```

- [ ] **Step 6: Add the sidebar nav link**

In `apps/admin/src/shell/Sidebar.tsx`, add to the `Content` group's `items` array (after Pages):
```tsx
      { to: '/categories', label: 'Categories', icon: 'folder' },
```

- [ ] **Step 7: Verify whole admin app builds + tests pass**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/screens/Categories.tsx apps/admin/src/screens/Categories.test.tsx apps/admin/src/app.tsx apps/admin/src/shell/Sidebar.tsx
git commit -m "feat(taxonomy): categories management screen + route + nav"
```

---

### Task 8: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full monorepo test + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean. Fix any cross-package fallout (most likely an editor test that renders `EditorScreen`/`MetaPanel` without `TaxonomyProvider` — wrap it).

- [ ] **Step 2: Add minimal CSS for the new controls**

The new class names (`category-field`, `category-tree`, `category-row`, `category-new`, `category-manage-list`, `category-manage-row`, `category-name-input`, `category-parent`) need styling to meet the visual bar. Locate the admin stylesheet (`apps/admin/src/index.css` or `apps/admin/src/styles/`), and add focused rules: indented rows, aligned checkboxes, an inline create row (input + select + button on one line), and management rows with the name input + parent select. Match existing token usage (`var(--accent)`, surface/border tokens) seen in `MetaPanel`/`Sidebar`. Commit:
```bash
git add apps/admin/src/index.css
git commit -m "style(taxonomy): category controls styling"
```

- [ ] **Step 3: Manual smoke (dev server)**

Run the admin dev server, open a post, confirm: inline-create a category (with and without a parent) checks it on the post; the checkbox tree nests; `/categories` lists them with working rename + re-parent. Confirm `taxonomy/categories.yaml` is written.

---

## Self-Review

**Spec coverage:**
- §1 data model → Tasks 1, 4 (`TAXONOMY_PATH`, slug refs). ✓
- §2 core module (parse/serialize/buildTree/ops/slugify) → Tasks 1–3. ✓
- §3 admin taxonomy service (immediate commit; draft-metadata split) → Task 4 (service), Task 5 (provider), Task 6 (selection = draft metadata). ✓
- §4 MetaPanel checkbox tree + inline create → Task 6. ✓
- §5 management screen (tree, re-parent, rename label; no counts) → Task 7. ✓
- Error handling (absent file, dup slug, cycle, commit failure surfaced) → Tasks 1/3/4/7. ✓
- Non-goals (tags, delete, slug-rename, counts) → none built. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; CSS step (8.2) is the one open-ended step by nature (visual polish) but names exact classes + token conventions.

**Type consistency:** `Category`/`CategoryNode` consistent across tasks; service returns `{ categories, slug }`, provider `create` returns `string` (slug) — consistent with CategoryField/Categories usage; `reparent(slug, parent: string | null)` consistent in ops/service/provider/UI; `selected: string[]` ↔ `metadata.categories` consistent in Task 6.
