# Posts Query Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A placeable, configurable `{% posts %}` block that queries the content collection at build and renders post cards (grid/list) with featured-image thumbnails — static, zero-runtime, SEO-clean.

**Architecture:** A pure `selectPosts` filter/sort/slice function in `@setu/core` (unit-tested), and a repo-root auto-discovered block `blocks/posts/` whose `.astro` calls `getCollection` at build (spike-proven), maps entries to rows, runs `selectPosts`, and renders cards. The block imports `@setu/core`, so the site's Vite resolver is extended to resolve `@setu/core` from repo-root block files.

**Tech Stack:** `@setu/core` (vitest), Astro 7 + `@astrojs/markdoc` blocks, site vitest render tests.

**Spec:** `docs/superpowers/specs/2026-06-26-posts-query-block-design.md`

## Global Constraints

- **Self-closing usage:** the block is bodyless — authored as `{% posts /%}` (no contract flag; the markdoc generator emits no `selfClosing`, so self-close syntax is required).
- **`locale` defaults to `DEFAULT_LOCALE`** (from `@setu/core`) with a per-page override attribute.
- **Static + zero JS:** all querying at build via `getCollection`; the rendered list ships no client JS.
- **Card image:** plain `<img>` resolved via `PUBLIC_SETU_MEDIA` (no srcset); `http(s)` values pass through.
- **Filter/sort/slice logic lives in `@setu/core` `selectPosts`** (pure); the block is a thin render over it.
- **Defaults:** `collection='post'`, `limit=10`, `offset=0`, `sort='newest'`, `layout='grid'`, `showImage=true`. Sort `newest`/`oldest` put **null dates last**; all sorts have a stable `id` tiebreak.
- **Valid block `editor.group`** values: `text|media|layout|embed|dynamic|marketing|widget` — use `widget`.

---

### Task 1: `selectPosts` pure function (`@setu/core`)

**Files:**
- Create: `packages/core/src/posts/select-posts.ts`
- Test: `packages/core/src/posts/select-posts.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export)

**Interfaces:**
- Produces:
  - `interface PostRow { id: string; collection: string; locale: string; slug: string; title: string; date: number | null; tags: string[]; categories: string[]; featuredImage?: string }`
  - `interface PostsQuery { collection: string; locale: string; category?: string; tag?: string; sort: 'newest' | 'oldest' | 'title'; limit: number; offset: number }`
  - `function selectPosts(rows: PostRow[], q: PostsQuery): PostRow[]`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/posts/select-posts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectPosts, type PostRow } from './select-posts'

const row = (slug: string, extra: Partial<PostRow> = {}): PostRow => ({
  id: `post/en/${slug}`,
  collection: 'post',
  locale: 'en',
  slug,
  title: slug.toUpperCase(),
  date: null,
  tags: [],
  categories: [],
  ...extra,
})

const q = (extra: Partial<import('./select-posts').PostsQuery> = {}) => ({
  collection: 'post',
  locale: 'en',
  sort: 'newest' as const,
  limit: 10,
  offset: 0,
  ...extra,
})

describe('selectPosts', () => {
  it('filters by collection and locale (excludes other-locale and other-collection)', () => {
    const rows = [
      row('a'),
      { ...row('b'), id: 'post/fr/b', locale: 'fr' },
      { ...row('c'), id: 'page/en/c', collection: 'page' },
    ]
    expect(selectPosts(rows, q()).map((r) => r.slug)).toEqual(['a'])
  })

  it('filters by category and tag when provided', () => {
    const rows = [
      row('a', { categories: ['news'], tags: ['x'] }),
      row('b', { categories: ['guides'], tags: ['x'] }),
    ]
    expect(selectPosts(rows, q({ category: 'guides' })).map((r) => r.slug)).toEqual(['b'])
    expect(selectPosts(rows, q({ tag: 'x' })).map((r) => r.slug)).toEqual(['a', 'b'])
  })

  it('sorts newest first with null dates last, id tiebreak', () => {
    const rows = [row('a', { date: 100 }), row('b', { date: null }), row('c', { date: 200 })]
    expect(selectPosts(rows, q({ sort: 'newest' })).map((r) => r.slug)).toEqual(['c', 'a', 'b'])
  })

  it('sorts oldest first with null dates still last', () => {
    const rows = [row('a', { date: 100 }), row('b', { date: null }), row('c', { date: 200 })]
    expect(selectPosts(rows, q({ sort: 'oldest' })).map((r) => r.slug)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by title', () => {
    const rows = [row('b', { title: 'Banana' }), row('a', { title: 'Apple' })]
    expect(selectPosts(rows, q({ sort: 'title' })).map((r) => r.title)).toEqual(['Apple', 'Banana'])
  })

  it('applies offset and limit', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((s) => row(s, { title: s }))
    expect(selectPosts(rows, q({ sort: 'title', offset: 1, limit: 2 })).map((r) => r.slug)).toEqual([
      'b',
      'c',
    ])
  })

  it('returns [] when offset is past the end', () => {
    expect(selectPosts([row('a')], q({ offset: 5 }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/posts/select-posts.test.ts`
Expected: FAIL — `Cannot find module './select-posts'`.

- [ ] **Step 3: Implement `selectPosts`**

Create `packages/core/src/posts/select-posts.ts`:

```ts
/** A content entry projected for the posts query block. `date` is epoch ms or null. */
export interface PostRow {
  id: string
  collection: string
  locale: string
  slug: string
  title: string
  date: number | null
  tags: string[]
  categories: string[]
  featuredImage?: string
}

export interface PostsQuery {
  collection: string
  locale: string
  category?: string
  tag?: string
  sort: 'newest' | 'oldest' | 'title'
  limit: number
  offset: number
}

const byId = (a: PostRow, b: PostRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Filter (collection + locale, optional category/tag) → sort → offset/limit slice.
 * `newest`/`oldest` sort by `date` (null always last); `title` sorts ascending. All
 * sorts use a stable `id` tiebreak for deterministic output. Pure — no I/O.
 */
export function selectPosts(rows: PostRow[], q: PostsQuery): PostRow[] {
  const filtered = rows.filter(
    (r) =>
      r.collection === q.collection &&
      r.locale === q.locale &&
      (q.category === undefined || r.categories.includes(q.category)) &&
      (q.tag === undefined || r.tags.includes(q.tag)),
  )

  const sorted = [...filtered].sort((a, b) => {
    if (q.sort === 'title') return a.title.localeCompare(b.title) || byId(a, b)
    const an = a.date === null
    const bn = b.date === null
    if (an !== bn) return an ? 1 : -1 // null dates always last
    if (an && bn) return byId(a, b)
    const cmp = q.sort === 'newest' ? b.date! - a.date! : a.date! - b.date!
    return cmp || byId(a, b)
  })

  const start = Math.max(0, q.offset)
  return sorted.slice(start, start + Math.max(0, q.limit))
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/core/src/index.ts`, add (near the other domain exports):

```ts
export type { PostRow, PostsQuery } from './posts/select-posts'
export { selectPosts } from './posts/select-posts'
```

- [ ] **Step 5: Run the test + full core suite + typecheck**

Run: `pnpm --filter @setu/core exec vitest run src/posts/select-posts.test.ts && pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — 7 new tests, full suite green, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/posts/select-posts.ts packages/core/src/posts/select-posts.test.ts packages/core/src/index.ts
git commit -m "feat(core): selectPosts query (filter + sort + offset/limit)"
```

---

### Task 2: The `{% posts %}` block + site wiring

**Files:**
- Create: `blocks/posts/block.ts`
- Create: `blocks/posts/posts.astro`
- Modify: `apps/site/astro.config.mjs` (extend the resolver for `@setu/core`)
- Create: `content/page/en/posts-demo.mdoc`
- Test: `apps/site/test/posts-block.test.ts`

**Interfaces:**
- Consumes: `selectPosts`, `PostRow`, `entryUrlPath`, `DEFAULT_LOCALE` from `@setu/core`; `getCollection` from `astro:content`; `defineBlock` + `z` for the contract.

- [ ] **Step 1: Write the failing render test**

Create `apps/site/test/posts-block.test.ts`:

```ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('page/posts-demo')
})

describe('posts query block', () => {
  it('renders a grid of post cards', () => {
    expect(html).toContain('class="setu-posts setu-posts--grid"')
  })
  it('lists same-default-locale (en) posts and excludes other locales', () => {
    expect(html).toContain('href="/post/kitchen-sink"')
    expect(html).toContain('href="/post/astro-on-the-edge"')
    expect(html).not.toContain('/post/fr/') // the French Bonjour post is excluded by locale default
  })
  it('renders a thumbnail for a post that has a featured image', () => {
    // featured-demo.mdoc has featuredImage: /media/2026/06/test-cat.jpg
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toMatch(/<img[^>]+src="[^"]*\/media\/2026\/06\/test-cat\.jpg"/)
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 2: Run the render test to verify it fails**

Run: `pnpm --filter @setu/site exec vitest run test/posts-block.test.ts`
Expected: FAIL — `page/posts-demo` does not exist / no `setu-posts` markup (and/or a build error because the `posts` block / `@setu/core` resolution isn't wired yet).

- [ ] **Step 3: Extend the site Vite resolver for `@setu/core`**

In `apps/site/astro.config.mjs`, inside the `resolveMarkdocFromApp` plugin's `resolveId(id)`, add a clause alongside the existing `@setu/blocks` one:

```js
    if (id === '@setu/core' || id.startsWith('@setu/core/')) {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
```

(This lets the repo-root `blocks/posts/posts.astro` resolve its `@setu/core` import during the site build — mirroring how `@setu/blocks` is already resolved.)

- [ ] **Step 4: Create the block contract**

Create `blocks/posts/block.ts`:

```ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    collection: z.string().default('post'),
    category: z.string().optional(),
    tag: z.string().optional(),
    locale: z.string().optional(),
    limit: z.number().default(10),
    offset: z.number().default(0),
    sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
    layout: z.enum(['grid', 'list']).default('grid'),
    showImage: z.boolean().default(true),
  }),
  editor: { label: 'Posts', icon: 'info', group: 'widget', keywords: ['list', 'query', 'archive', 'blog'] },
})
```

- [ ] **Step 5: Create the block component**

Create `blocks/posts/posts.astro`:

```astro
---
import { getCollection } from 'astro:content'
import { selectPosts, entryUrlPath, DEFAULT_LOCALE, type PostRow } from '@setu/core'

const {
  collection = 'post',
  category,
  tag,
  locale,
  limit = 10,
  offset = 0,
  sort = 'newest',
  layout = 'grid',
  showImage = true,
} = Astro.props

const mediaBase = (import.meta.env.PUBLIC_SETU_MEDIA as string) ?? ''
const resolveImg = (s: string): string =>
  !s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${mediaBase}${s}` : s

function toPostRow(entry: { id: string; data: Record<string, unknown> }): PostRow {
  const [col = '', loc = '', ...rest] = entry.id.split('/')
  const d = entry.data
  const dateRaw = d['date'] ?? d['pubDate'] ?? d['updatedAt']
  const parsed =
    typeof dateRaw === 'string' || typeof dateRaw === 'number' ? Date.parse(String(dateRaw)) : NaN
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    id: entry.id,
    collection: col,
    locale: loc,
    slug: rest.join('/'),
    title: typeof d['title'] === 'string' ? (d['title'] as string) : entry.id,
    date: Number.isNaN(parsed) ? null : parsed,
    tags: strArr(d['tags']),
    categories: strArr(d['categories']),
    featuredImage: typeof d['featuredImage'] === 'string' ? (d['featuredImage'] as string) : undefined,
  }
}

const rows = (await getCollection('entries')).map((e) => toPostRow({ id: e.id, data: e.data as Record<string, unknown> }))
const selected = selectPosts(rows, {
  collection,
  locale: locale ?? DEFAULT_LOCALE,
  category: category ?? undefined,
  tag: tag ?? undefined,
  sort,
  limit,
  offset,
})
const hrefOf = (p: PostRow) => `/${entryUrlPath({ collection: p.collection, locale: p.locale, slug: p.slug })}`
---

<ul class={`setu-posts setu-posts--${layout}`}>
  {selected.map((p) => (
    <li class="setu-post-card">
      {showImage && p.featuredImage && (
        <a href={hrefOf(p)} class="setu-post-card__media">
          <img src={resolveImg(p.featuredImage)} alt={p.title} loading="lazy" />
        </a>
      )}
      <a href={hrefOf(p)} class="setu-post-card__title">{p.title}</a>
    </li>
  ))}
</ul>

<style>
  .setu-posts { list-style: none; padding: 0; margin: 1.5rem 0; display: grid; gap: 1.25rem; }
  .setu-posts--grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .setu-posts--list { grid-template-columns: 1fr; }
  .setu-post-card__media img {
    width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover;
    border-radius: var(--r-md, 8px); display: block;
  }
  .setu-post-card__title {
    display: inline-block; margin-top: 0.5rem;
    font-family: var(--font-heading, inherit); font-weight: 600;
    color: var(--text, inherit); text-decoration: none;
  }
  .setu-post-card__title:hover { color: var(--accent, #4f46e5); }
</style>
```

- [ ] **Step 6: Add the demo page fixture**

Create `content/page/en/posts-demo.mdoc`:

```
---
title: Posts Demo
---

A page that lists posts via the query block.

{% posts limit=10 layout="grid" /%}
```

- [ ] **Step 7: Run the render test to verify it passes**

Run: `pnpm --filter @setu/site exec vitest run test/posts-block.test.ts`
Expected: PASS — grid of cards, en posts listed, `/post/fr/` excluded, featured-demo thumbnail present, zero JS.

- [ ] **Step 8: Run the full site + theme + core suites + typecheck**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/site typecheck`
Expected: PASS — existing render/related/featured tests unaffected (the demo page adds a route only; `gen-blocks` now reports a `posts` block).

- [ ] **Step 9: Commit**

```bash
git add blocks/posts/block.ts blocks/posts/posts.astro apps/site/astro.config.mjs content/page/en/posts-demo.mdoc apps/site/test/posts-block.test.ts
git commit -m "feat(site): {% posts %} query block — placeable, configurable post list"
```

---

## Self-Review

**Spec coverage:**
- Pure filter/sort/offset/limit logic (`selectPosts`) → Task 1. ✓
- Block attributes (collection/category/tag/locale/limit/offset/sort/layout/showImage) → Task 2 block.ts. ✓
- Static `getCollection` query at build; thin render over `selectPosts` → Task 2 posts.astro. ✓
- `locale` defaults to `DEFAULT_LOCALE`, per-page override → Task 2 (`locale ?? DEFAULT_LOCALE`). ✓
- Self-closing usage (`{% posts /%}`) → Task 2 fixture. ✓
- Card image via `PUBLIC_SETU_MEDIA`, http passthrough → Task 2 `resolveImg`. ✓
- `@setu/core` resolution from repo-root block → Task 2 step 3. ✓
- Zero JS → Task 2 test. ✓
- Deferred (route pagination, AJAX, srcset thumbnails, host-locale auto-detect, excerpt) → not implemented. ✓

**Placeholder scan:** No TBD/TODO. Every code step is complete; every run step has the command + expected result.

**Type consistency:** `PostRow`/`PostsQuery`/`selectPosts` defined in Task 1 are imported and used verbatim in Task 2's `posts.astro`. The `/media/<key>` `featuredImage` shape matches the featured-image feature on `main` and the `featured-demo` fixture. The block attribute names/types in `block.ts` match the `Astro.props` destructure in `posts.astro`. `entryUrlPath` href form (`/` + path) matches the site's route convention.
