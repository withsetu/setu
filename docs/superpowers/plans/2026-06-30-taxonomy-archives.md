# Category & Tag Archive Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/category/<slug>` and `/tag/<slug>` paginated archive pages plus clickable taxonomy chips on the single post page, so visitors can browse posts by category/tag.

**Architecture:** Two new Astro routes mirror the existing `/posts` archive (`getStaticPaths` + `paginate` + `selectPosts({category|tag})`), both rendering one new shared `ArchiveList.astro` (card grid + pager). A tiny `loadCategories` site loader maps category slugs → display names. A new `TaxonomyChips.astro` renders links on the single post page. The existing posts archive and posts block are NOT touched (they're in #174's lane).

**Tech Stack:** Astro 7 (`getStaticPaths`/`paginate`, static prerender), `@setu/core` (`selectPosts`, taxonomy), Vitest (unit + build-based route tests).

## Global Constraints

- Default locale only (`DEFAULT_LOCALE = 'en'`); per-locale archives are out of scope.
- Do NOT modify `apps/site/src/pages/posts/[...page].astro` or `blocks/posts/*` (in-flight #174).
- All output is static prerender — no native deps, no request-time fs (edge-safe).
- Per-page count = Reading settings `postsPerPage`, overridable via `SETU_ARCHIVE_PER_PAGE` env (matches the posts archive).
- Branch `feat/taxonomy-archives`; commits/PR cite #152 and #153; PR closes both.

---

## File Structure

- Create `packages/core/src/posts/archive-slugs.ts` — pure `distinctCategorySlugs`, `distinctTagSlugs`, `categoryNameMap`.
- Create `packages/core/test/archive-slugs.test.ts` — their unit tests.
- Modify `packages/core/src/index.ts` — export the three helpers.
- Create `apps/site/src/lib/categories.ts` — `loadCategories()` reading `taxonomy/categories.yaml`.
- Create `apps/site/test/categories-loader.test.ts` — missing-file → `[]`.
- Create `packages/theme-default/ArchiveList.astro` — shared card grid + pager.
- Create `packages/theme-default/TaxonomyChips.astro` — category/tag chip links.
- Create `apps/site/src/pages/category/[slug]/[...page].astro` — category archive route.
- Create `apps/site/src/pages/tag/[slug]/[...page].astro` — tag archive route.
- Modify `apps/site/src/pages/[...path].astro` — render `TaxonomyChips` on posts.
- Create `taxonomy/categories.yaml` (repo-root fixture) + add `categories: [recipes]` to 3 post fixtures.
- Create `apps/site/test/taxonomy-archive.test.ts` — build-based route + chip assertions.

---

### Task 1: Core archive-slug helpers

**Files:**
- Create: `packages/core/src/posts/archive-slugs.ts`
- Test: `packages/core/test/archive-slugs.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `PostRow` from `./select-posts`, `Category` from `../taxonomy/types`.
- Produces:
  - `distinctCategorySlugs(rows: PostRow[], locale: string): string[]`
  - `distinctTagSlugs(rows: PostRow[], locale: string): string[]`
  - `categoryNameMap(categories: Category[]): Map<string, string>`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/archive-slugs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { distinctCategorySlugs, distinctTagSlugs, categoryNameMap } from '../src/posts/archive-slugs'
import type { PostRow } from '../src/posts/select-posts'
import type { Category } from '../src/taxonomy/types'

const row = (over: Partial<PostRow>): PostRow => ({
  id: 'post/en/x', collection: 'post', locale: 'en', slug: 'x',
  title: 'X', date: 0, tags: [], categories: [], ...over,
})

describe('distinctCategorySlugs', () => {
  it('dedupes + sorts category slugs for the locale, ignoring other collections/locales', () => {
    const rows = [
      row({ id: 'post/en/a', slug: 'a', categories: ['recipes', 'dinner'] }),
      row({ id: 'post/en/b', slug: 'b', categories: ['recipes'] }),
      row({ id: 'post/fr/c', slug: 'c', locale: 'fr', categories: ['soupe'] }),
      row({ id: 'page/en/p', slug: 'p', collection: 'page', categories: ['ignored'] }),
    ]
    expect(distinctCategorySlugs(rows, 'en')).toEqual(['dinner', 'recipes'])
  })
  it('returns [] when nothing matches', () => {
    expect(distinctCategorySlugs([], 'en')).toEqual([])
  })
})

describe('distinctTagSlugs', () => {
  it('dedupes + sorts tags for the locale', () => {
    const rows = [
      row({ id: 'post/en/a', slug: 'a', tags: ['astro', 'cms'] }),
      row({ id: 'post/en/b', slug: 'b', tags: ['astro'] }),
    ]
    expect(distinctTagSlugs(rows, 'en')).toEqual(['astro', 'cms'])
  })
})

describe('categoryNameMap', () => {
  it('maps slug → name', () => {
    const cats: Category[] = [
      { slug: 'recipes', name: 'Recipes', parent: null },
      { slug: 'dinner', name: 'Dinner Ideas', parent: 'recipes' },
    ]
    const m = categoryNameMap(cats)
    expect(m.get('recipes')).toBe('Recipes')
    expect(m.get('dinner')).toBe('Dinner Ideas')
    expect(m.get('missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/archive-slugs.test.ts`
Expected: FAIL — `Cannot find module '../src/posts/archive-slugs'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/posts/archive-slugs.ts`:

```ts
import type { PostRow } from './select-posts'
import type { Category } from '../taxonomy/types'

function distinct(rows: PostRow[], locale: string, pick: (r: PostRow) => string[]): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    if (r.collection !== 'post' || r.locale !== locale) continue
    for (const v of pick(r)) if (v) set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Category slugs appearing on a post in `locale`, deduped + sorted. Drives archive getStaticPaths. */
export function distinctCategorySlugs(rows: PostRow[], locale: string): string[] {
  return distinct(rows, locale, (r) => r.categories)
}

/** Tags appearing on a post in `locale`, deduped + sorted. */
export function distinctTagSlugs(rows: PostRow[], locale: string): string[] {
  return distinct(rows, locale, (r) => r.tags)
}

/** slug → display name from categories.yaml rows. */
export function categoryNameMap(categories: Category[]): Map<string, string> {
  return new Map(categories.map((c) => [c.slug, c.name]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/archive-slugs.test.ts`
Expected: PASS (3 describes).

- [ ] **Step 5: Export from the barrel**

In `packages/core/src/index.ts`, add immediately after the existing line
`export { selectPosts } from './posts/select-posts'` (search for it):

```ts
export { distinctCategorySlugs, distinctTagSlugs, categoryNameMap } from './posts/archive-slugs'
```

- [ ] **Step 6: Verify the package typechecks + builds**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/posts/archive-slugs.ts packages/core/test/archive-slugs.test.ts packages/core/src/index.ts
git commit -m "feat(core): archive-slug helpers for taxonomy pages (#152, #153)"
```

---

### Task 2: `loadCategories` site loader

**Files:**
- Create: `apps/site/src/lib/categories.ts`
- Test: `apps/site/test/categories-loader.test.ts`

**Interfaces:**
- Consumes: `parseCategories`, `Category` from `@setu/core`.
- Produces: `loadCategories(): Category[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/test/categories-loader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadCategories } from '../src/lib/categories'

describe('loadCategories', () => {
  it('returns [] when taxonomy/categories.yaml is absent (never throws)', () => {
    const prev = process.env.SETU_CONTENT_DIR
    // point at a dir whose parent has no taxonomy/categories.yaml
    process.env.SETU_CONTENT_DIR = '/nonexistent-xyz/content'
    try {
      expect(loadCategories()).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.SETU_CONTENT_DIR
      else process.env.SETU_CONTENT_DIR = prev
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && npx vitest run test/categories-loader.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/categories'`.

- [ ] **Step 3: Write the implementation**

Create `apps/site/src/lib/categories.ts` (path resolution mirrors `src/lib/site-config.ts`):

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCategories, type Category } from '@setu/core'

/** taxonomy/categories.yaml lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../taxonomy/categories.yaml`; otherwise this repo's root. Mirrors loadThemeOptions. */
function categoriesFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'taxonomy', 'categories.yaml')
  return fileURLToPath(new URL('../../../../taxonomy/categories.yaml', import.meta.url))
}

/** Categories from taxonomy/categories.yaml. Read fresh per call. Missing/malformed → [] (never throws). */
export function loadCategories(): Category[] {
  try {
    return parseCategories(readFileSync(categoriesFilePath(), 'utf8'))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && npx vitest run test/categories-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/categories.ts apps/site/test/categories-loader.test.ts
git commit -m "feat(site): loadCategories from taxonomy/categories.yaml (#152)"
```

---

### Task 3: Fixtures + `ArchiveList.astro` + category route

**Files:**
- Create: `taxonomy/categories.yaml`
- Modify: `content/post/en/kitchen-sink.mdoc`, `content/post/en/astro-on-the-edge.mdoc`, `content/post/en/featured-demo.mdoc` (add `categories: [recipes]`)
- Create: `packages/theme-default/ArchiveList.astro`
- Create: `apps/site/src/pages/category/[slug]/[...page].astro`
- Test: `apps/site/test/taxonomy-archive.test.ts`

**Interfaces:**
- Consumes: `selectPosts`, `distinctCategorySlugs`, `categoryNameMap`, `entryUrlPath`, `DEFAULT_LOCALE`, `PostRow` from `@setu/core`; `loadCategories` from `../../../lib/categories`; `loadThemeOptions`, `loadSiteSettings`; `resolveMediaBase` from `@setu/image-astro`.
- Produces: `ArchiveList.astro` props `{ page: Page<PostRow>; heading: string; basePath: string; mediaBase: string }`.

- [ ] **Step 1: Add the fixtures**

Create `taxonomy/categories.yaml`:

```yaml
- slug: recipes
  name: Recipes
  parent: null
```

Then add the line `categories: [recipes]` to the YAML frontmatter of each of these three files, directly under the existing `title:` line (leave all other frontmatter untouched):
- `content/post/en/kitchen-sink.mdoc`
- `content/post/en/astro-on-the-edge.mdoc`
- `content/post/en/featured-demo.mdoc`

- [ ] **Step 2: Write the failing build test**

Create `apps/site/test/taxonomy-archive.test.ts`:

```ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string => readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
const exists = (route: string): boolean => {
  try { page(route); return true } catch { return false }
}

beforeAll(() => {
  // 2 posts/page forces the 3 recipes posts onto two category pages.
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit', env: { ...process.env, SETU_ARCHIVE_PER_PAGE: '2' } })
}, 180_000)

describe('category archive', () => {
  it('page 1 at /category/recipes shows the human name + first page of posts', () => {
    const p = page('category/recipes')
    expect(p).toContain('Category: Recipes')
    expect(p).toContain('setu-posts--grid')
    expect(p).toContain('>Kitchen Sink<')
    expect(p).toContain('>Featured Demo<')
    expect(p).not.toContain('>Astro on the Edge<') // pushed to page 2 by pageSize 2
  })
  it('paginates to /category/recipes/2 with the remaining post', () => {
    const p = page('category/recipes/2')
    expect(p).toContain('>Astro on the Edge<')
    expect(p).toMatch(/rel="prev"/)
  })
  it('does not generate a page for an unknown category', () => {
    expect(exists('category/nope')).toBe(false)
  })
  it('ships zero JS', () => {
    const p = page('category/recipes')
    expect(p).not.toContain('astro-island')
    expect(p).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: FAIL — build succeeds but `dist/category/recipes/index.html` does not exist (route not created yet).

- [ ] **Step 4: Create the shared `ArchiveList.astro`**

Create `packages/theme-default/ArchiveList.astro` (markup + styles copied from the posts archive so the look matches exactly):

```astro
---
import { entryUrlPath, type PostRow } from '@setu/core'
import type { Page } from 'astro'

interface Props {
  page: Page<PostRow>
  heading: string
  basePath: string
  mediaBase: string
}
const { page, heading, basePath, mediaBase } = Astro.props

const resolveImg = (s: string): string =>
  !s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${mediaBase}${s}` : s
const hrefOf = (p: PostRow) => `/${entryUrlPath({ collection: p.collection, locale: p.locale, slug: p.slug })}`
const pageHref = (n: number) => (n <= 1 ? basePath : `${basePath}/${n}`)
const pageNumbers = Array.from({ length: page.lastPage }, (_, i) => i + 1)
---

<h1>{heading}</h1>

<ul class="setu-posts setu-posts--grid setu-posts--cols-3">
  {page.data.map((p) => (
    <li class="setu-post-card">
      {p.featuredImage && (
        <a href={hrefOf(p)} class="setu-post-card__media">
          <img src={resolveImg(p.featuredImage)} alt={p.title} loading="lazy" />
        </a>
      )}
      <a href={hrefOf(p)} class="setu-post-card__title">{p.title}</a>
    </li>
  ))}
</ul>

{page.lastPage > 1 && (
  <nav class="setu-pager" aria-label="Pagination">
    <a class="setu-pager__step" href={page.url.prev ?? undefined} aria-disabled={page.url.prev ? undefined : 'true'} rel="prev">← Prev</a>
    <ol class="setu-pager__pages">
      {pageNumbers.map((n) => (
        <li>
          <a href={pageHref(n)} class="setu-pager__page" aria-current={n === page.currentPage ? 'page' : undefined}>{n}</a>
        </li>
      ))}
    </ol>
    <a class="setu-pager__step" href={page.url.next ?? undefined} aria-disabled={page.url.next ? undefined : 'true'} rel="next">Next →</a>
  </nav>
)}

<style>
  .setu-posts { list-style: none; padding: 0; margin: 1.5rem 0; display: grid; gap: 1.25rem; }
  .setu-posts--cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 900px) { .setu-posts--grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .setu-posts--grid { grid-template-columns: 1fr; } }
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
  .setu-pager { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin: 2.5rem 0 1rem; flex-wrap: wrap; }
  .setu-pager__pages { display: flex; gap: 0.35rem; list-style: none; margin: 0; padding: 0; }
  .setu-pager__page, .setu-pager__step {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 2rem; height: 2rem; padding: 0 0.6rem;
    border: 1px solid var(--border, #e5e7eb); border-radius: var(--r-md, 8px);
    color: var(--text, inherit); text-decoration: none; font-size: 0.95rem;
  }
  .setu-pager__page:hover, .setu-pager__step:hover { border-color: var(--accent, #4f46e5); }
  .setu-pager__page[aria-current='page'] { background: var(--accent, #4f46e5); border-color: var(--accent, #4f46e5); color: #fff; }
  .setu-pager__step[aria-disabled='true'] { opacity: 0.4; pointer-events: none; }
</style>
```

- [ ] **Step 5: Create the category route**

Create `apps/site/src/pages/category/[slug]/[...page].astro`:

```astro
---
import type { GetStaticPaths, Page } from 'astro'
import PageLayout from '@theme/PageLayout.astro'
import ArchiveList from '@theme/ArchiveList.astro'
import { getCollection } from 'astro:content'
import { selectPosts, distinctCategorySlugs, categoryNameMap, DEFAULT_LOCALE, type PostRow } from '@setu/core'
import { loadThemeOptions } from '../../../lib/site-config'
import { loadSiteSettings } from '../../../lib/site-settings'
import { loadCategories } from '../../../lib/categories'
import { resolveMediaBase } from '@setu/image-astro'

export const getStaticPaths = (async ({ paginate }) => {
  const perPage = Number(process.env.SETU_ARCHIVE_PER_PAGE) || loadSiteSettings().reading.postsPerPage
  // toPostRow mirrors the posts archive (Astro runs getStaticPaths in an isolated scope, so it
  // must be defined inline — module-level helpers aren't visible here).
  const toPostRow = (entry: { id: string; data: Record<string, unknown> }): PostRow => {
    const [col = '', loc = '', ...rest] = entry.id.split('/')
    const d = entry.data
    const dateRaw = d['date'] ?? d['pubDate'] ?? d['updatedAt']
    const parsed = typeof dateRaw === 'string' || typeof dateRaw === 'number' ? Date.parse(String(dateRaw)) : NaN
    const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      id: entry.id, collection: col, locale: loc, slug: rest.join('/'),
      title: typeof d['title'] === 'string' ? (d['title'] as string) : entry.id,
      date: Number.isNaN(parsed) ? null : parsed,
      tags: strArr(d['tags']), categories: strArr(d['categories']),
      featuredImage: typeof d['featuredImage'] === 'string' ? (d['featuredImage'] as string) : undefined,
    }
  }
  const rows = (await getCollection('entries')).map((e) => toPostRow({ id: e.id, data: e.data as Record<string, unknown> }))
  const published = selectPosts(rows, { collection: 'post', locale: DEFAULT_LOCALE, sort: 'newest', limit: rows.length, offset: 0 })
  return distinctCategorySlugs(published, DEFAULT_LOCALE).flatMap((slug) => {
    const posts = selectPosts(rows, { collection: 'post', locale: DEFAULT_LOCALE, category: slug, sort: 'newest', limit: rows.length, offset: 0 })
    return paginate(posts, { params: { slug }, pageSize: perPage })
  })
}) satisfies GetStaticPaths

const { page } = Astro.props as { page: Page<PostRow> }
const { slug } = Astro.params as { slug: string }
const themeOptions = loadThemeOptions()
const siteSettings = loadSiteSettings()
const mediaBase = resolveMediaBase(import.meta.env.PUBLIC_SETU_MEDIA, import.meta.env.DEV)
const name = categoryNameMap(loadCategories()).get(slug) ?? slug
const heading = `Category: ${name}`
const basePath = `/category/${slug}`
---

<PageLayout title={heading} lang="en" themeOptions={themeOptions} siteSettings={siteSettings}>
  <ArchiveList page={page} heading={heading} basePath={basePath} mediaBase={mediaBase} />
</PageLayout>
```

- [ ] **Step 6: Run the build test to verify it passes**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: PASS (4 `category archive` tests).

- [ ] **Step 7: Commit**

```bash
git add taxonomy/categories.yaml content/post/en/kitchen-sink.mdoc content/post/en/astro-on-the-edge.mdoc content/post/en/featured-demo.mdoc packages/theme-default/ArchiveList.astro apps/site/src/pages/category apps/site/test/taxonomy-archive.test.ts
git commit -m "feat(site): category archive pages + shared ArchiveList (#152)"
```

---

### Task 4: Tag route

**Files:**
- Create: `apps/site/src/pages/tag/[slug]/[...page].astro`
- Modify: `apps/site/test/taxonomy-archive.test.ts` (add a `tag archive` describe)

**Interfaces:**
- Consumes: same as Task 3 but `distinctTagSlugs` + `tag:` filter; reuses `ArchiveList.astro`. No `loadCategories` (tags are their own label).

- [ ] **Step 1: Add the failing tag assertions**

Append to `apps/site/test/taxonomy-archive.test.ts`:

```ts
describe('tag archive', () => {
  it('/tag/astro lists posts tagged astro with the tag heading', () => {
    const p = page('tag/astro')
    expect(p).toContain('Tag: astro')
    expect(p).toContain('>Kitchen Sink<')
    expect(p).toContain('>Astro on the Edge<')
  })
  it('does not generate a page for an unknown tag', () => {
    expect(exists('tag/nope')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: FAIL — `dist/tag/astro/index.html` missing.

- [ ] **Step 3: Create the tag route**

Create `apps/site/src/pages/tag/[slug]/[...page].astro` (identical to the category route except the import, the distinct fn, the filter key, the heading, and no category-name lookup):

```astro
---
import type { GetStaticPaths, Page } from 'astro'
import PageLayout from '@theme/PageLayout.astro'
import ArchiveList from '@theme/ArchiveList.astro'
import { getCollection } from 'astro:content'
import { selectPosts, distinctTagSlugs, DEFAULT_LOCALE, type PostRow } from '@setu/core'
import { loadThemeOptions } from '../../../lib/site-config'
import { loadSiteSettings } from '../../../lib/site-settings'
import { resolveMediaBase } from '@setu/image-astro'

export const getStaticPaths = (async ({ paginate }) => {
  const perPage = Number(process.env.SETU_ARCHIVE_PER_PAGE) || loadSiteSettings().reading.postsPerPage
  const toPostRow = (entry: { id: string; data: Record<string, unknown> }): PostRow => {
    const [col = '', loc = '', ...rest] = entry.id.split('/')
    const d = entry.data
    const dateRaw = d['date'] ?? d['pubDate'] ?? d['updatedAt']
    const parsed = typeof dateRaw === 'string' || typeof dateRaw === 'number' ? Date.parse(String(dateRaw)) : NaN
    const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      id: entry.id, collection: col, locale: loc, slug: rest.join('/'),
      title: typeof d['title'] === 'string' ? (d['title'] as string) : entry.id,
      date: Number.isNaN(parsed) ? null : parsed,
      tags: strArr(d['tags']), categories: strArr(d['categories']),
      featuredImage: typeof d['featuredImage'] === 'string' ? (d['featuredImage'] as string) : undefined,
    }
  }
  const rows = (await getCollection('entries')).map((e) => toPostRow({ id: e.id, data: e.data as Record<string, unknown> }))
  const published = selectPosts(rows, { collection: 'post', locale: DEFAULT_LOCALE, sort: 'newest', limit: rows.length, offset: 0 })
  return distinctTagSlugs(published, DEFAULT_LOCALE).flatMap((slug) => {
    const posts = selectPosts(rows, { collection: 'post', locale: DEFAULT_LOCALE, tag: slug, sort: 'newest', limit: rows.length, offset: 0 })
    return paginate(posts, { params: { slug }, pageSize: perPage })
  })
}) satisfies GetStaticPaths

const { page } = Astro.props as { page: Page<PostRow> }
const { slug } = Astro.params as { slug: string }
const themeOptions = loadThemeOptions()
const siteSettings = loadSiteSettings()
const mediaBase = resolveMediaBase(import.meta.env.PUBLIC_SETU_MEDIA, import.meta.env.DEV)
const heading = `Tag: ${slug}`
const basePath = `/tag/${slug}`
---

<PageLayout title={heading} lang="en" themeOptions={themeOptions} siteSettings={siteSettings}>
  <ArchiveList page={page} heading={heading} basePath={basePath} mediaBase={mediaBase} />
</PageLayout>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: PASS (category + tag describes).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/tag apps/site/test/taxonomy-archive.test.ts
git commit -m "feat(site): tag archive pages (#153)"
```

---

### Task 5: `TaxonomyChips` on the single post page

**Files:**
- Create: `packages/theme-default/TaxonomyChips.astro`
- Modify: `apps/site/src/pages/[...path].astro`
- Modify: `apps/site/test/taxonomy-archive.test.ts` (add a `post page chips` describe)

**Interfaces:**
- Consumes: `categoryNameMap`, `loadCategories`; `entry.data.categories` (slugs) + `entry.data.tags`.
- Produces: `TaxonomyChips.astro` props `{ categories: { slug: string; name: string }[]; tags: string[] }`.

- [ ] **Step 1: Add the failing chip assertions**

Append to `apps/site/test/taxonomy-archive.test.ts`:

```ts
describe('post page taxonomy chips', () => {
  it('links a post to its category (by name) and tag archives', () => {
    const p = page('post/kitchen-sink')
    expect(p).toMatch(/href="\/category\/recipes"[^>]*>\s*Recipes\s*</)
    expect(p).toContain('href="/tag/astro"')
    expect(p).toContain('href="/tag/cms"')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: FAIL — the post page has no `/category/recipes` link yet.

- [ ] **Step 3: Create `TaxonomyChips.astro`**

Create `packages/theme-default/TaxonomyChips.astro`:

```astro
---
interface Props {
  categories: { slug: string; name: string }[]
  tags: string[]
}
const { categories, tags } = Astro.props
const has = categories.length > 0 || tags.length > 0
---

{has && (
  <nav class="setu-taxonomy measure-post" aria-label="Categories and tags">
    {categories.map((c) => (
      <a class="setu-chip setu-chip--cat" href={`/category/${c.slug}`}>{c.name}</a>
    ))}
    {tags.map((t) => (
      <a class="setu-chip setu-chip--tag" href={`/tag/${t}`}>#{t}</a>
    ))}
  </nav>
)}

<style>
  .setu-taxonomy { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.75rem 0 0.5rem; }
  .setu-chip {
    display: inline-flex; align-items: center; height: 1.85rem; padding: 0 0.7rem;
    border: 1px solid var(--border, #e5e7eb); border-radius: 999px;
    font-size: 0.85rem; color: var(--text, inherit); text-decoration: none;
    background: var(--surface, transparent);
  }
  .setu-chip--cat { font-weight: 600; }
  .setu-chip:hover { border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5); }
</style>
```

- [ ] **Step 4: Render the chips on the post page**

In `apps/site/src/pages/[...path].astro`:

(a) Add to the imports block (after the `import { resolveMediaBase } ...` line):

```ts
import TaxonomyChips from '@theme/TaxonomyChips.astro'
import { categoryNameMap } from '@setu/core'
import { loadCategories } from '../lib/categories'
```

(b) Add to the frontmatter, after the `featuredImage` const (around line 44):

```ts
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const catNames = categoryNameMap(loadCategories())
const postCategories = strArr((entry.data as { categories?: unknown }).categories).map((slug) => ({
  slug,
  name: catNames.get(slug) ?? slug,
}))
const postTags = strArr((entry.data as { tags?: unknown }).tags)
```

(c) Inside the `<TemplateLayout>`, immediately after `<Content />`, add:

```astro
  {collection === 'post' && <TaxonomyChips categories={postCategories} tags={postTags} />}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/site && npx vitest run test/taxonomy-archive.test.ts`
Expected: PASS (category + tag + chips describes).

- [ ] **Step 6: Commit**

```bash
git add packages/theme-default/TaxonomyChips.astro apps/site/src/pages/\[...path\].astro apps/site/test/taxonomy-archive.test.ts
git commit -m "feat(site): taxonomy chips link posts to category/tag archives (#152, #153)"
```

---

### Task 6: Whole-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Core suite + typecheck**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 2: Site suite + typecheck**

Run: `cd apps/site && npx vitest run && npx tsc --noEmit`
Expected: all pass (incl. the existing posts archive test still green), no type errors.

- [ ] **Step 3: Confirm the existing posts archive is untouched + still passes**

Run: `cd apps/site && npx vitest run test/archive-route.test.ts`
Expected: PASS — proves the fixture/category additions didn't regress the posts archive.

- [ ] **Step 4: Commit (if any incidental fixups were needed)**

```bash
git add -A && git commit -m "test: whole-suite verification for taxonomy archives (#152, #153)" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:** routes (T3/T4) ✓ · pagination via shared ArchiveList (T3) ✓ · slug→name labels (T1 `categoryNameMap` + T2 loader) ✓ · default-locale-only (T3/T4 `DEFAULT_LOCALE`) ✓ · discoverability chips (T5) ✓ · unknown-slug 404 (T3/T4 `exists()` tests) ✓ · non-collision (no posts-archive/posts-block edits) ✓ · testing: unit (T1/T2) + build route tests (T3/T4/T5) + whole-suite (T6) ✓ · topology static-prerender ✓.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `distinctCategorySlugs`/`distinctTagSlugs(rows, locale)`, `categoryNameMap(categories): Map<string,string>`, `loadCategories(): Category[]`, `ArchiveList` props `{ page, heading, basePath, mediaBase }`, `TaxonomyChips` props `{ categories: {slug,name}[], tags: string[] }` — used identically across tasks.
