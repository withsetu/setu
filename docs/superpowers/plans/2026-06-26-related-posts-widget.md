# Related Posts Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pre-built related-posts graph computed at build time, served as a static O(1) lookup that bakes a zero-JS "Read Next" widget into each post's HTML.

**Architecture:** A pure scorer in `@setu/core` ranks entries by tag/category Jaccard over an inverted-tag candidate set (near-linear, not O(N²)). A `prebuild` script (`gen-relations.mjs`, twin of `gen-blocks.mjs`) feeds on-disk content into the scorer and writes `apps/site/.setu/cache/relations.json`. The site page imports that map, does the O(1) lookup, and passes resolved links to a theme component. No runtime cost; rides the full `astro build` Cloudflare Pages already runs per deploy.

**Tech Stack:** TypeScript, vitest (core + site), node:test (scripts), jiti (TS-from-Node), Astro 7, `@setu/core` (`parseMdoc`, `normalizeTags`, `entryUrlPath`).

**Spec:** `docs/superpowers/specs/2026-06-26-related-posts-widget-design.md`

## Global Constraints

- **Zero-JS render:** the widget ships no client JS; assert no `astro-island`/`<script>` is introduced.
- **Cloudflare-Pages-safe:** build-time only, no native deps; `gen-relations` runs in the standard Node build container as a `prebuild` step.
- **Pure scorer:** `selectRelatedPosts` does no I/O and reads no clock — recency comes only from each row's `updatedAt`. (This is the embedding-swap seam.)
- **Reuse, don't re-parse:** frontmatter via `@setu/core` `parseMdoc`; tag canonicalization via `normalizeTags`; URLs via `entryUrlPath`. No new YAML/parsing dependency.
- **Defaults (locked):** `k = 4` related per post; `categoryBoost = 0.25`; scope = same `collection` **and** same `locale`; graceful fallback so the widget is never empty when siblings exist.
- **Generated artifact:** `apps/site/.setu/cache/relations.json` is derived and gitignored (covered by `.setu/` in `.gitignore`) — never committed.
- **Test style:** core/site use `import { describe, expect, it } from 'vitest'`; script tests use `node:test` (`node --test 'scripts/*.test.mjs'`, the root `test:scripts` script).

---

### Task 1: Pure related-posts scorer in `@setu/core` (Slice A)

**Files:**
- Create: `packages/core/src/index-port/related-posts.ts`
- Test: `packages/core/src/index-port/related-posts.test.ts`
- Modify: `packages/core/src/index.ts` (add barrel exports after line 105)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface RelatedRow { key: string; collection: string; locale: string; slug: string; title: string; tags: string[]; categories: string[]; updatedAt: number | null }`
  - `interface RelatedRef { collection: string; locale: string; slug: string; title: string }`
  - `interface RelatedOpts { k?: number; categoryBoost?: number }`
  - `function selectRelatedPosts(rows: RelatedRow[], opts?: RelatedOpts): Record<string, RelatedRef[]>` — map of each row's `key` → its top related refs.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/index-port/related-posts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectRelatedPosts, type RelatedRow } from './related-posts'

const row = (
  slug: string,
  tags: string[],
  extra: Partial<RelatedRow> = {},
): RelatedRow => ({
  key: `post/en/${slug}`,
  collection: 'post',
  locale: 'en',
  slug,
  title: slug.toUpperCase(),
  tags,
  categories: [],
  updatedAt: 0,
  ...extra,
})

describe('selectRelatedPosts', () => {
  it('ranks by shared-tag Jaccard, excludes self, returns resolved refs', () => {
    const rows = [
      row('a', ['astro', 'cms']),
      row('b', ['astro', 'cms']), // identical → Jaccard 1
      row('c', ['astro']), //        partial   → Jaccard 0.5
      row('d', ['cooking']), //      disjoint  → excluded
    ]
    const out = selectRelatedPosts(rows, { k: 4 })
    expect(out['post/en/a']).toEqual([
      { collection: 'post', locale: 'en', slug: 'b', title: 'B' },
      { collection: 'post', locale: 'en', slug: 'c', title: 'C' },
    ])
    expect(out['post/en/a'].some((r) => r.slug === 'a')).toBe(false)
  })

  it('scopes candidates to the same collection and locale', () => {
    const rows: RelatedRow[] = [
      row('a', ['astro']),
      row('b', ['astro'], { key: 'post/fr/b', locale: 'fr' }), // other locale
      { ...row('c', ['astro']), key: 'page/en/c', collection: 'page' }, // other collection
    ]
    expect(selectRelatedPosts(rows)['post/en/a']).toEqual([])
  })

  it('adds a category boost so a shared category outranks an equal-tag peer', () => {
    const rows = [
      row('a', ['astro'], { categories: ['guides'] }),
      row('b', ['astro'], { categories: ['guides'] }), // same tag + shared category
      row('c', ['astro'], { categories: ['news'] }), //   same tag, no shared category
    ]
    const out = selectRelatedPosts(rows, { k: 2, categoryBoost: 0.25 })
    expect(out['post/en/a'].map((r) => r.slug)).toEqual(['b', 'c'])
  })

  it('truncates to k', () => {
    const rows = ['b', 'c', 'd', 'e', 'f'].map((s) => row(s, ['astro'])).concat(row('a', ['astro']))
    expect(selectRelatedPosts(rows, { k: 3 })['post/en/a']).toHaveLength(3)
  })

  it('breaks score ties by recency (updatedAt desc) then key', () => {
    const rows = [
      row('a', ['astro']),
      row('b', ['astro'], { updatedAt: 100 }),
      row('c', ['astro'], { updatedAt: 200 }), // newer → first
    ]
    expect(selectRelatedPosts(rows, { k: 2 })['post/en/a'].map((r) => r.slug)).toEqual(['c', 'b'])
  })

  it('falls back to same-category, then recency, to fill empty slots', () => {
    const rows = [
      row('a', ['astro'], { categories: ['guides'], updatedAt: 0 }),
      row('cat', ['unrelated'], { categories: ['guides'], updatedAt: 5 }), // tier 1: shared category
      row('recentish', ['unrelated'], { categories: ['news'], updatedAt: 9 }), // tier 2: recency
      row('older', ['unrelated'], { categories: ['news'], updatedAt: 1 }), //     tier 2: recency
    ]
    // No tag match for 'a' → fill: category peer first, then most-recent others.
    expect(selectRelatedPosts(rows, { k: 3 })['post/en/a'].map((r) => r.slug)).toEqual([
      'cat',
      'recentish',
      'older',
    ])
  })

  it('returns [] for a source with no other in-scope rows', () => {
    expect(selectRelatedPosts([row('a', ['astro'])])['post/en/a']).toEqual([])
  })

  it('treats null updatedAt as oldest in tiebreaks', () => {
    const rows = [
      row('a', ['astro']),
      row('b', ['astro'], { updatedAt: null }),
      row('c', ['astro'], { updatedAt: 1 }),
    ]
    expect(selectRelatedPosts(rows, { k: 2 })['post/en/a'].map((r) => r.slug)).toEqual(['c', 'b'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/related-posts.test.ts`
Expected: FAIL — `Failed to resolve import "./related-posts"` / `selectRelatedPosts is not a function`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/index-port/related-posts.ts`:

```ts
/** Minimal row the related-posts scorer needs — a projection of EntryIndexRow or any
 *  build-time content row. `key` is an opaque caller-chosen identity (the admin uses
 *  indexKey; the site build uses the Astro entry id "<collection>/<locale>/<slug>"). */
export interface RelatedRow {
  key: string
  collection: string
  locale: string
  slug: string
  title: string
  tags: string[]
  categories: string[]
  updatedAt: number | null
}

/** A resolved related entry. `title` is included so consumers need no second lookup. */
export interface RelatedRef {
  collection: string
  locale: string
  slug: string
  title: string
}

export interface RelatedOpts {
  /** How many related entries per source. Default 4. */
  k?: number
  /** Weight on shared-category Jaccard, added to shared-tag Jaccard. Default 0.25. */
  categoryBoost?: number
}

/** Jaccard set similarity |A∩B| / |A∪B|; 0 when both sets are empty. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

const refOf = (r: RelatedRow): RelatedRef => ({
  collection: r.collection,
  locale: r.locale,
  slug: r.slug,
  title: r.title,
})

/** Total order: recency desc (null treated as oldest), then key asc — deterministic. */
function byRecencyThenKey(a: RelatedRow, b: RelatedRow): number {
  const ua = a.updatedAt ?? -Infinity
  const ub = b.updatedAt ?? -Infinity
  if (ua !== ub) return ub - ua
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Build a related-posts map: each source `key` → its top-`k` related entries.
 *
 * - Candidates are scoped to the SAME collection and locale; the source is excluded.
 * - Primary ranking: jaccard(tags) + categoryBoost*jaccard(categories), descending.
 * - Ties broken by recency (updatedAt desc), then key (asc) — deterministic output.
 * - Candidate generation uses an inverted tag index (only rows sharing ≥1 tag are
 *   scored), so it is near-linear for sparse tag overlap — not O(N²) all-pairs.
 * - Graceful fallback fills unused slots: same-category peers (by recency), then the
 *   most-recent in the same collection+locale — so a source is never left short when
 *   other in-scope rows exist.
 *
 * Pure: no I/O, no clock (recency comes from each row's updatedAt). This is the swap
 * seam for a future embedding-based scorer (identical output shape).
 */
export function selectRelatedPosts(
  rows: RelatedRow[],
  opts: RelatedOpts = {},
): Record<string, RelatedRef[]> {
  const k = opts.k ?? 4
  const categoryBoost = opts.categoryBoost ?? 0.25

  const byTag = new Map<string, RelatedRow[]>()
  for (const r of rows) {
    for (const t of r.tags) {
      const list = byTag.get(t)
      if (list) list.push(r)
      else byTag.set(t, [r])
    }
  }

  const out: Record<string, RelatedRef[]> = {}

  for (const src of rows) {
    const inScope = (c: RelatedRow): boolean =>
      c.key !== src.key && c.collection === src.collection && c.locale === src.locale

    // Candidate set: in-scope rows sharing ≥1 tag with src, deduped by key.
    const candByKey = new Map<string, RelatedRow>()
    for (const t of src.tags) {
      for (const c of byTag.get(t) ?? []) if (inScope(c)) candByKey.set(c.key, c)
    }

    const scored = [...candByKey.values()]
      .map((c) => ({
        c,
        score: jaccard(src.tags, c.tags) + categoryBoost * jaccard(src.categories, c.categories),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || byRecencyThenKey(a.c, b.c))

    const picked: RelatedRow[] = scored.slice(0, k).map((x) => x.c)
    const pickedKeys = new Set(picked.map((r) => r.key))

    if (picked.length < k) {
      const srcCats = new Set(src.categories)
      const tier1 = rows
        .filter(
          (c) => inScope(c) && !pickedKeys.has(c.key) && c.categories.some((g) => srcCats.has(g)),
        )
        .sort(byRecencyThenKey)
      for (const c of tier1) {
        if (picked.length >= k) break
        picked.push(c)
        pickedKeys.add(c.key)
      }
    }

    if (picked.length < k) {
      const tier2 = rows.filter((c) => inScope(c) && !pickedKeys.has(c.key)).sort(byRecencyThenKey)
      for (const c of tier2) {
        if (picked.length >= k) break
        picked.push(c)
        pickedKeys.add(c.key)
      }
    }

    out[src.key] = picked.map(refOf)
  }

  return out
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/core/src/index.ts`, immediately after the line
`export { selectEntriesByTag } from './index-port/entries-by-tag'` (line 105), add:

```ts
export type { RelatedRow, RelatedRef, RelatedOpts } from './index-port/related-posts'
export { selectRelatedPosts } from './index-port/related-posts'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/related-posts.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Run the full core suite + typecheck (no regressions)**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — existing core tests unchanged, `tsc --noEmit` exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index-port/related-posts.ts packages/core/src/index-port/related-posts.test.ts packages/core/src/index.ts
git commit -m "feat(core): related-posts scorer (inverted-tag Jaccard + fallback)"
```

---

### Task 2: Build step `gen-relations.mjs` (Slice B)

**Files:**
- Create: `scripts/gen-relations.mjs`
- Test: `scripts/gen-relations.test.mjs`
- Modify: `apps/site/package.json` (scripts block)

**Interfaces:**
- Consumes: `@setu/core` `{ parseMdoc, normalizeTags, entryUrlPath, selectRelatedPosts }` (Task 1 added `selectRelatedPosts`).
- Produces:
  - Exported `function buildRelationsGraph(contentDir: string): Record<string, { title: string; href: string }[]>` — used by the test.
  - Side effect when run as a CLI: writes `apps/site/.setu/cache/relations.json`.
  - Output map is keyed by entry id `"<collection>/<locale>/<slug>"`; each value is `{ title, href }[]` where `href = "/" + entryUrlPath(ref)`.

- [ ] **Step 1: Write the failing test**

Create `scripts/gen-relations.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildRelationsGraph } from './gen-relations.mjs'

function fixtureDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-relations-'))
  const post = path.join(dir, 'post', 'en')
  mkdirSync(post, { recursive: true })
  const write = (slug, fm) =>
    writeFileSync(path.join(post, `${slug}.mdoc`), `---\n${fm}\n---\n\nbody\n`)
  write('astro-intro', 'title: Astro Intro\ntags: [astro, cms]')
  write('astro-tips', 'title: Astro Tips\ntags: [astro, edge]')
  write('cooking', 'title: Cooking\ntags: [food]')
  // other-locale sibling must never leak into an en post's relations
  const fr = path.join(dir, 'post', 'fr')
  mkdirSync(fr, { recursive: true })
  writeFileSync(path.join(fr, 'bonjour.mdoc'), `---\ntitle: Bonjour\ntags: [astro]\n---\n\nbody\n`)
  return dir
}

test('builds an entry-id-keyed graph with resolved title + href', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    // astro-intro relates to astro-tips (shared 'astro' tag), same locale only.
    assert.deepEqual(graph['post/en/astro-intro'][0], {
      title: 'Astro Tips',
      href: '/post/astro-tips',
    })
    // never links the French sibling despite the shared tag
    assert.ok(!graph['post/en/astro-intro'].some((r) => r.href.includes('/fr/')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('default-locale href omits the locale segment', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    for (const refs of Object.values(graph))
      for (const r of refs) assert.ok(r.href.startsWith('/post/') && !r.href.includes('/en/'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/gen-relations.test.mjs`
Expected: FAIL — `Cannot find module './gen-relations.mjs'`.

- [ ] **Step 3: Write the build script**

Create `scripts/gen-relations.mjs`:

```js
// scripts/gen-relations.mjs
// Build-time codegen: scan the content dir, compute the related-posts graph via
// @setu/core, and write a static O(1) lookup map for the site's <RelatedReading>
// widget. Pure build-time => zero per-visitor cost. Mirrors gen-blocks.mjs (jiti
// imports @setu/core as TS). Exports buildRelationsGraph(dir) for tests; writes the
// cache file when run directly as a CLI.
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONTENT_DIR = process.env.SETU_CONTENT_DIR ?? path.join(ROOT, 'content')
const OUT = path.join(ROOT, 'apps', 'site', '.setu', 'cache', 'relations.json')

// @setu/core (+ /node) and zod are not hoisted to the repo root under pnpm strict
// hoisting; resolve them from packages/core where they ARE installed. (Same trick as
// gen-blocks.mjs.)
const coreReq = createRequire(path.join(ROOT, 'packages', 'core', 'package.json'))
const jiti = createJiti(import.meta.url, {
  alias: {
    '@setu/core': coreReq.resolve('@setu/core'),
    '@setu/core/node': coreReq.resolve('@setu/core/node'),
    zod: coreReq.resolve('zod'),
  },
})
const { parseMdoc, normalizeTags, entryUrlPath, selectRelatedPosts } =
  await jiti.import('@setu/core')

/** Recursively collect every .mdoc file under dir (absolute paths). */
function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.mdoc')) out.push(full)
  }
  return out
}

const asStringArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

/** Turn one .mdoc file into a RelatedRow keyed by its Astro entry id. */
function toRow(file, contentDir) {
  const id = path.relative(contentDir, file).replace(/\\/g, '/').replace(/\.mdoc$/, '')
  const [collection = '', locale = '', ...rest] = id.split('/')
  const slug = rest.join('/')
  const { frontmatter } = parseMdoc(readFileSync(file, 'utf8'))
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : slug
  const tags = normalizeTags(asStringArray(frontmatter.tags))
  const categories = asStringArray(frontmatter.categories)
  const dateRaw = frontmatter.date ?? frontmatter.updatedAt ?? frontmatter.pubDate
  const parsed = dateRaw != null ? Date.parse(String(dateRaw)) : Number.NaN
  const updatedAt = Number.isNaN(parsed) ? statSync(file).mtimeMs : parsed
  return { key: id, collection, locale, slug, title, tags, categories, updatedAt }
}

/** Build the related-posts graph for a content dir: entry-id -> {title, href}[]. */
export function buildRelationsGraph(contentDir) {
  const rows = walk(contentDir).map((f) => toRow(f, contentDir))
  const graph = selectRelatedPosts(rows, { k: 4, categoryBoost: 0.25 })
  const out = {}
  for (const [id, refs] of Object.entries(graph)) {
    out[id] = refs.map((r) => ({
      title: r.title,
      href: '/' + entryUrlPath({ collection: r.collection, locale: r.locale, slug: r.slug }),
    }))
  }
  return out
}

// CLI: write the cache file for the default content dir.
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const out = buildRelationsGraph(DEFAULT_CONTENT_DIR)
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  const n = Object.keys(out).length
  console.log(`gen-relations: ${n} graph key${n === 1 ? '' : 's'} -> apps/site/.setu/cache/relations.json`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/gen-relations.test.mjs`
Expected: PASS — both tests green.

- [ ] **Step 5: Wire the script into the site lifecycle**

In `apps/site/package.json`, replace the `predev`, `prebuild`, and `dev` scripts so `gen-relations` runs alongside `gen-blocks`:

```json
    "predev": "node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs",
    "dev": "astro dev",
    "prebuild": "node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs",
    "build": "astro build",
    "genrelations": "node ../../scripts/gen-relations.mjs",
```

(Keep `test`, `typecheck` unchanged. `predev` previously only ran `gen-blocks`; this adds `gen-relations` to both pre-hooks.)

- [ ] **Step 6: Generate against real content and sanity-check output**

Run: `pnpm --filter @setu/site exec node ../../scripts/gen-relations.mjs && cat apps/site/.setu/cache/relations.json`
Expected: the command prints `gen-relations: N graph key(s) …` and `relations.json` is valid JSON keyed by entry ids (e.g. `post/kitchen-sink`'s siblings once Task 3 adds tagged fixtures; with today's untagged fixtures the values may be empty arrays — that is correct).

- [ ] **Step 7: Confirm the artifact is gitignored**

Run: `git check-ignore apps/site/.setu/cache/relations.json`
Expected: prints the path (it is ignored via `.setu/`). It must NOT appear in `git status`.

- [ ] **Step 8: Commit**

```bash
git add scripts/gen-relations.mjs scripts/gen-relations.test.mjs apps/site/package.json
git commit -m "feat(site): gen-relations build step writes related-posts graph"
```

---

### Task 3: `<RelatedReading>` widget + mount + demo content (Slice C)

**Files:**
- Create: `packages/theme-default/RelatedReading.astro`
- Modify: `packages/theme-default/PostLayout.astro`
- Modify: `apps/site/src/pages/[...path].astro`
- Create: `content/post/en/astro-on-the-edge.mdoc` (demo sibling with shared tags)
- Modify: `content/post/en/kitchen-sink.mdoc` (add `tags` so it has a related sibling)
- Test: `apps/site/test/related.test.ts`

**Interfaces:**
- Consumes: `apps/site/.setu/cache/relations.json` (Task 2 output) — `Record<string, { title: string; href: string }[]>`.
- Produces: `<RelatedReading related={RelatedItem[]} />` where `RelatedItem = { title: string; href: string }`; `PostLayout` forwards a new optional `related` prop.

- [ ] **Step 1: Write the failing test**

Create `apps/site/test/related.test.ts`:

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
  // prebuild (gen-blocks + gen-relations) runs via the build script.
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('post/kitchen-sink')
})

describe('related posts widget', () => {
  it('renders a Read Next aside on a post that has tagged siblings', () => {
    expect(html).toContain('class="related-reading"')
    expect(html).toContain('Read Next')
  })
  it('links to the same-locale tagged sibling with a clean default-locale href', () => {
    expect(html).toContain('href="/post/astro-on-the-edge"')
    expect(html).toContain('Astro on the Edge')
  })
  it('ships zero JS for the widget (no island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/site exec vitest run test/related.test.ts`
Expected: FAIL — the built HTML has no `related-reading` aside yet (and `kitchen-sink` has no tagged sibling).

- [ ] **Step 3: Create the widget component**

Create `packages/theme-default/RelatedReading.astro`:

```astro
---
interface RelatedItem {
  title: string
  href: string
}
interface Props {
  related?: RelatedItem[]
}
const { related = [] } = Astro.props
---

{
  related.length > 0 && (
    <aside class="related-reading" aria-label="Related posts">
      <h2>Read Next</h2>
      <ul>
        {related.map((r) => (
          <li>
            <a href={r.href}>{r.title}</a>
          </li>
        ))}
      </ul>
    </aside>
  )
}

<style>
  .related-reading {
    margin-block-start: 3rem;
    padding-block-start: 1.5rem;
    border-block-start: 1px solid var(--border, #e5e7eb);
  }
  .related-reading h2 {
    font-family: var(--font-heading, inherit);
    font-size: 1.1rem;
    margin-block-end: 0.75rem;
  }
  .related-reading ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  .related-reading a {
    color: var(--accent, #4f46e5);
    text-decoration: none;
  }
  .related-reading a:hover {
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 4: Forward the `related` prop through `PostLayout`**

Replace the contents of `packages/theme-default/PostLayout.astro` with:

```astro
---
import Layout from './Layout.astro'
import RelatedReading from './RelatedReading.astro'

interface RelatedItem {
  title: string
  href: string
}
interface Props {
  title: string
  lang?: string
  themeOptions?: Record<string, string>
  related?: RelatedItem[]
}
const { title, lang = 'en', themeOptions = {}, related = [] } = Astro.props
---

<Layout title={title} lang={lang} themeOptions={themeOptions}>
  <article class="prose measure-post"><slot /></article>
  <RelatedReading related={related} />
</Layout>
```

- [ ] **Step 5: Look up relations in the page route and pass them down**

In `apps/site/src/pages/[...path].astro`, add the cache import after the existing imports:

```ts
import relations from '../../.setu/cache/relations.json'
```

Then, in the frontmatter after `const TemplateLayout = ...`, add:

```ts
const related = (relations as Record<string, { title: string; href: string }[]>)[entry.id] ?? []
```

And add the `related` prop to the layout element (PageLayout ignores it):

```astro
<TemplateLayout title={title} lang={locale} themeOptions={themeOptions} siteSettings={siteSettings} related={related}>
```

- [ ] **Step 6: Add a tagged demo sibling + tag the kitchen-sink post**

Create `content/post/en/astro-on-the-edge.mdoc`:

```
---
title: Astro on the Edge
tags: [astro, cms]
---

A short companion post about running Astro content at the edge.
```

In `content/post/en/kitchen-sink.mdoc`, extend the frontmatter to add tags (keep the existing `title` and `status`):

```
---
title: Kitchen Sink
status: draft
tags: [astro, cms]
---
```

(Both share `astro`+`cms` and are the only `post/en` entries with those tags, so each becomes the other's top related entry.)

- [ ] **Step 7: Run the new test to verify it passes**

Run: `pnpm --filter @setu/site exec vitest run test/related.test.ts`
Expected: PASS — the `related-reading` aside renders on `post/kitchen-sink` linking to `/post/astro-on-the-edge`, zero JS.

- [ ] **Step 8: Run the full site + theme suites (no regressions)**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/theme-default test && pnpm --filter @setu/site typecheck`
Expected: PASS — existing render tests unaffected (the new sibling does not change any asserted route), `tsc --noEmit` exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/theme-default/RelatedReading.astro packages/theme-default/PostLayout.astro "apps/site/src/pages/[...path].astro" content/post/en/astro-on-the-edge.mdoc content/post/en/kitchen-sink.mdoc apps/site/test/related.test.ts
git commit -m "feat(site): Read Next related-posts widget + demo content"
```

---

## Self-Review

**Spec coverage:**
- Pure scorer (inverted-tag candidate gen, Jaccard + category boost, recency tiebreak, top-K, fallback tiers, embedding seam) → Task 1. ✓
- Build step mirroring `gen-blocks` (jiti core import, frontmatter via `parseMdoc`, `normalizeTags`, `entryUrlPath`, `.setu/cache/relations.json`, `prebuild`/`predev` wiring) → Task 2. ✓
- Prop-decoupled component, app-owns-cache-import, `PostLayout` mount, `[...path].astro` O(1) lookup → Task 3. ✓
- Decisions: k=4, categoryBoost=0.25, same collection+locale, graceful fallback → Tasks 1 & 2 defaults + Task 1 tests. ✓
- Cloudflare/zero-JS constraints → Task 3 zero-JS assertions; no runtime/native deps anywhere. ✓
- Slicing into 3 independently-testable/committable tasks → as structured. ✓
- Out-of-scope (incremental deploys, embeddings, cross-locale, manual overrides) → intentionally not implemented. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code; every run step shows the exact command and expected result.

**Type consistency:** `RelatedRow`/`RelatedRef`/`RelatedOpts`/`selectRelatedPosts` defined in Task 1, consumed verbatim in Task 2. The build output shape `{ title, href }[]` (Task 2) matches the component's `RelatedItem` and `PostLayout`'s `related` prop (Task 3). The cache path `apps/site/.setu/cache/relations.json` is identical in the script (`OUT`), the gitignore check, and the page import (`../../.setu/cache/relations.json` from `src/pages/`). Entry-id key format `"<collection>/<locale>/<slug>"` matches `entry.id` used in the lookup.
