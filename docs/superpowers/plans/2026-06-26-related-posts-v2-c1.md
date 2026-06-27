# Related Posts v2 — C.1 (Configurable "Read Next") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the auto-appended related-posts ("Read Next") configurable — a site setting (on/off, heading, count, show-image), per-post frontmatter override (hide or pin a curated list), and featured-image thumbnail cards.

**Architecture:** A new `reading.relatedPosts` settings group; `gen-relations` enriches each cached related item with the target post's featured image and honors a frontmatter `related` override; `RelatedReading` renders configurable image cards; the page route threads the settings through.

**Tech Stack:** `@setu/core` (vitest), `gen-relations.mjs` (node:test), Astro 7 theme + site (vitest render tests).

**Spec:** `docs/superpowers/specs/2026-06-26-related-posts-v2-design.md`

## Global Constraints

- **Setting defaults:** `relatedPosts = { enabled: true, heading: 'Read Next', count: 3, showImage: true }`.
- **Frontmatter override:** `related: false` → no related section; `related: [slug, …]` → those posts (ordered, resolved within the post's collection+locale) instead of the computed graph; absent → computed graph (v1).
- **Cached ref shape becomes `{ title, href, featuredImage? }`** (`featuredImage` = the target post's `/media/<key>` value or absent).
- **`gen-relations` computes up to `k = 6`** so the render layer can slice to any `count ≤ 6`.
- **Zero JS** in the rendered related section.
- **Backward compatible:** with defaults (enabled, heading 'Read Next', showImage), existing `related.test.ts` assertions (the `related-reading` aside, 'Read Next', the title links, zero-JS) must still pass.

---

### Task 1: `relatedPosts` settings group (`@setu/core`)

**Files:**
- Modify: `packages/core/src/settings/types.ts`
- Modify: `packages/core/src/settings/defaults.ts`
- Modify: `packages/core/src/settings/schema.ts`
- Test: `packages/core/src/settings/related-posts-settings.test.ts`

**Interfaces:**
- Produces: `ReadingSettings.relatedPosts: { enabled: boolean; heading: string; count: number; showImage: boolean }` on `SiteSettings`, with defaults + lenient parse/merge.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/settings/related-posts-settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSettings } from './schema'

describe('settings — relatedPosts', () => {
  it('fills relatedPosts defaults when absent', () => {
    const s = parseSettings({})
    expect(s.reading.relatedPosts).toEqual({
      enabled: true,
      heading: 'Read Next',
      count: 3,
      showImage: true,
    })
  })

  it('merges a partial relatedPosts override over defaults', () => {
    const s = parseSettings({ reading: { relatedPosts: { showImage: false, count: 5 } } })
    expect(s.reading.relatedPosts).toEqual({
      enabled: true,
      heading: 'Read Next',
      count: 5,
      showImage: false,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/settings/related-posts-settings.test.ts`
Expected: FAIL — `relatedPosts` is `undefined`.

- [ ] **Step 3: Add the type**

In `packages/core/src/settings/types.ts`, add to the `ReadingSettings` interface (after `markdown`):

```ts
  /** Auto-appended related-posts widget configuration. */
  relatedPosts: { enabled: boolean; heading: string; count: number; showImage: boolean }
```

- [ ] **Step 4: Add the defaults**

In `packages/core/src/settings/defaults.ts`, add to `reading` (after `markdown`):

```ts
    relatedPosts: { enabled: true, heading: 'Read Next', count: 3, showImage: true },
```

- [ ] **Step 5: Add the schema + merge**

In `packages/core/src/settings/schema.ts`, add to `readingSchema`'s object (after `markdown`):

```ts
    relatedPosts: z
      .object({
        enabled: z.boolean(),
        heading: z.string(),
        count: z.number(),
        showImage: z.boolean(),
      })
      .partial(),
```

And in `parseSettings`, add the merge inside the returned `reading` object (after the `markdown` line):

```ts
      relatedPosts: { ...rd.relatedPosts, ...(reading.relatedPosts ?? {}) },
```

- [ ] **Step 6: Run the test + full core suite + typecheck**

Run: `pnpm --filter @setu/core exec vitest run src/settings/related-posts-settings.test.ts && pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — new tests green, existing settings tests green, `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/settings/types.ts packages/core/src/settings/defaults.ts packages/core/src/settings/schema.ts packages/core/src/settings/related-posts-settings.test.ts
git commit -m "feat(core): relatedPosts settings group (enabled/heading/count/showImage)"
```

---

### Task 2: `gen-relations` — featured-image enrichment + frontmatter override

**Files:**
- Modify: `scripts/gen-relations.mjs`
- Modify: `scripts/gen-relations.test.mjs`

**Interfaces:**
- Consumes: `selectRelatedPosts` (unchanged), `parseMdoc`, `normalizeTags`, `entryUrlPath`.
- Produces: cached graph values become `{ title, href, featuredImage? }[]`; `buildRelationsGraph` honors the `related` frontmatter override.

- [ ] **Step 1: Write the failing test**

Replace the body of `scripts/gen-relations.test.mjs` with (keeps the existing two tests, adds three):

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
  write('astro-intro', 'title: Astro Intro\ntags: [astro, cms]\nfeaturedImage: /media/2026/06/a.jpg')
  write('astro-tips', 'title: Astro Tips\ntags: [astro, edge]')
  write('cooking', 'title: Cooking\ntags: [food]')
  return dir
}

test('related items carry the target post featuredImage when it has one', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    // astro-tips relates to astro-intro (shared 'astro'); astro-intro has a featuredImage.
    const refs = graph['post/en/astro-tips']
    const intro = refs.find((r) => r.href === '/post/astro-intro')
    assert.equal(intro.featuredImage, '/media/2026/06/a.jpg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('frontmatter related: false yields no related items', () => {
  const dir = fixtureDir()
  try {
    writeFileSync(
      path.join(dir, 'post', 'en', 'astro-tips.mdoc'),
      `---\ntitle: Astro Tips\ntags: [astro]\nrelated: false\n---\n\nbody\n`,
    )
    assert.deepEqual(buildRelationsGraph(dir)['post/en/astro-tips'], [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('frontmatter related: [slug] pins that post (ordered), with its featuredImage', () => {
  const dir = fixtureDir()
  try {
    writeFileSync(
      path.join(dir, 'post', 'en', 'cooking.mdoc'),
      `---\ntitle: Cooking\ntags: [food]\nrelated: [astro-intro]\n---\n\nbody\n`,
    )
    const refs = buildRelationsGraph(dir)['post/en/cooking']
    assert.equal(refs.length, 1)
    assert.equal(refs[0].href, '/post/astro-intro')
    assert.equal(refs[0].title, 'Astro Intro')
    assert.equal(refs[0].featuredImage, '/media/2026/06/a.jpg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/gen-relations.test.mjs`
Expected: FAIL — `featuredImage` undefined on refs; `related: false`/pin not honored.

- [ ] **Step 3: Update `toRow` to capture featuredImage + the override**

In `scripts/gen-relations.mjs`, in `toRow`, add before the `return`:

```js
  const featuredImage =
    typeof frontmatter.featuredImage === 'string' ? frontmatter.featuredImage : undefined
  const relatedOverride =
    frontmatter.related === false
      ? false
      : Array.isArray(frontmatter.related)
        ? frontmatter.related.filter((x) => typeof x === 'string')
        : undefined
```

and change the `return` to include them:

```js
  return { key: id, collection, locale, slug, title, tags, categories, updatedAt, featuredImage, relatedOverride }
```

- [ ] **Step 4: Update `buildRelationsGraph` for enrichment + override**

In `scripts/gen-relations.mjs`, replace the `buildRelationsGraph` function with:

```js
/** Build the related-posts graph for a content dir: entry-id -> {title, href, featuredImage?}[]. */
export function buildRelationsGraph(contentDir) {
  const rows = walk(contentDir).map((f) => toRow(f, contentDir))
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const graph = selectRelatedPosts(rows, { k: 6, categoryBoost: 0.25 })

  const refOf = (r) => ({
    title: r.title,
    href: '/' + entryUrlPath({ collection: r.collection, locale: r.locale, slug: r.slug }),
    ...(r.featuredImage ? { featuredImage: r.featuredImage } : {}),
  })

  const out = {}
  for (const row of rows) {
    if (row.relatedOverride === false) {
      out[row.key] = []
    } else if (Array.isArray(row.relatedOverride)) {
      out[row.key] = row.relatedOverride
        .map((slug) => byKey.get(`${row.collection}/${row.locale}/${slug}`))
        .filter(Boolean)
        .map(refOf)
    } else {
      out[row.key] = (graph[row.key] ?? []).map((ref) => {
        const full = byKey.get(`${ref.collection}/${ref.locale}/${ref.slug}`)
        return refOf(full ?? ref)
      })
    }
  }
  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/gen-relations.test.mjs`
Expected: PASS — all five tests (the two original + three new) green.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-relations.mjs scripts/gen-relations.test.mjs
git commit -m "feat(site): related items carry featuredImage + honor frontmatter related override"
```

---

### Task 3: `RelatedReading` image cards + route wiring

**Files:**
- Modify: `packages/theme-default/RelatedReading.astro`
- Modify: `packages/theme-default/PostLayout.astro`
- Modify: `apps/site/src/pages/[...path].astro`
- Test: `apps/site/test/related-cards.test.ts`

**Interfaces:**
- Consumes: the cached `{ title, href, featuredImage? }[]` (Task 2) + `siteSettings.reading.relatedPosts` (Task 1).
- Produces: `RelatedReading` props `{ heading?: string; showImage?: boolean; related?: { title: string; href: string; image?: string }[] }`; `PostLayout` forwards `heading`/`showImage`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/test/related-cards.test.ts`:

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
  html = page('post/kitchen-sink')
})

describe('related posts v2 — image cards', () => {
  it('renders the configurable heading (default Read Next)', () => {
    expect(html).toContain('class="related-reading"')
    expect(html).toContain('Read Next')
  })
  it('renders a featured-image thumbnail for a related post that has one', () => {
    // featured-demo is related to kitchen-sink and has featuredImage /media/2026/06/test-cat.jpg
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toMatch(/class="related-card__media"[\s\S]*?\/media\/2026\/06\/test-cat\.jpg/)
  })
  it('still links related posts by title', () => {
    expect(html).toContain('href="/post/astro-on-the-edge"')
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/site exec vitest run test/related-cards.test.ts`
Expected: FAIL — no `related-card__media` markup yet.

- [ ] **Step 3: Rewrite `RelatedReading` for configurable heading + image cards**

Replace `packages/theme-default/RelatedReading.astro` with:

```astro
---
interface RelatedItem {
  title: string
  href: string
  image?: string
}
interface Props {
  heading?: string
  showImage?: boolean
  related?: RelatedItem[]
}
const { heading = 'Read Next', showImage = true, related = [] } = Astro.props
---

{
  related.length > 0 && (
    <aside class="related-reading" aria-label="Related posts">
      <h2>{heading}</h2>
      <ul>
        {related.map((r) => (
          <li class="related-card">
            {showImage && r.image && (
              <a href={r.href} class="related-card__media">
                <img src={r.image} alt={r.title} loading="lazy" />
              </a>
            )}
            <a href={r.href} class="related-card__title">
              {r.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}

<style>
  .related-reading {
    padding-inline: 1.25rem;
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
    gap: 1rem;
  }
  .related-card__media img {
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--r-md, 8px);
    display: block;
    margin-block-end: 0.4rem;
  }
  .related-card__title {
    font-family: var(--font-heading, inherit);
    font-weight: 600;
    color: var(--accent, #4f46e5);
    text-decoration: none;
  }
  .related-card__title:hover {
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 4: Forward the new props through `PostLayout`**

In `packages/theme-default/PostLayout.astro`, update the `RelatedItem`/`Props` and destructure + the `<RelatedReading>` usage:

Change the `RelatedItem` interface to add `image?: string`, add `heading?: string` and `showImage?: boolean` to `Props`, destructure them (with defaults `heading = 'Read Next'`, `showImage = true`), and pass them:

```astro
  <div class="measure-post"><RelatedReading related={related} heading={heading} showImage={showImage} /></div>
```

- [ ] **Step 5: Thread settings through the page route**

In `apps/site/src/pages/[...path].astro`:

Add a media-base resolver near the other consts (after `siteSettings`):

```ts
const mediaBase = (import.meta.env.PUBLIC_SETU_MEDIA as string) ?? ''
const resolveImg = (s: string): string =>
  !s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${mediaBase}${s}` : s
const rp = siteSettings.reading.relatedPosts
```

Replace the existing `const related = ...` line with a settings-aware version:

```ts
const relatedRaw = (relations as Record<string, { title: string; href: string; featuredImage?: string }[]>)[entry.id] ?? []
const related = rp.enabled
  ? relatedRaw.slice(0, rp.count).map((r) => ({
      title: r.title,
      href: r.href,
      ...(r.featuredImage ? { image: resolveImg(r.featuredImage) } : {}),
    }))
  : []
```

Add `heading`/`showImage` to the `<TemplateLayout>` props:

```astro
<TemplateLayout title={title} lang={locale} themeOptions={themeOptions} siteSettings={siteSettings} related={related} heading={rp.heading} showImage={rp.showImage}>
```

- [ ] **Step 6: Run the new test + the existing related test**

Run: `pnpm --filter @setu/site exec vitest run test/related-cards.test.ts test/related.test.ts`
Expected: PASS — image cards + heading render; the v1 `related.test.ts` still green (heading 'Read Next', title links, zero-JS preserved).

- [ ] **Step 7: Run the full site + theme suites + typecheck**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/theme-default test && pnpm --filter @setu/site typecheck`
Expected: PASS — all suites green, `tsc` clean.

- [ ] **Step 8: Commit**

```bash
git add packages/theme-default/RelatedReading.astro packages/theme-default/PostLayout.astro "apps/site/src/pages/[...path].astro" apps/site/test/related-cards.test.ts
git commit -m "feat(site): configurable Read Next — image cards + heading + count from settings"
```

---

## Self-Review

**Spec coverage:** settings group (Task 1); featured-image enrichment + frontmatter override `false`/pin (Task 2); image cards + configurable heading + count + enabled gate (Task 3). In-body auto-compute + the `{% related %}` block are C.2 (separate), correctly absent here. ✓

**Placeholder scan:** No TBD/TODO; every code step complete; every run step has command + expected result.

**Type consistency:** `relatedPosts` shape identical in types/defaults/schema/test (Task 1) and consumed as `siteSettings.reading.relatedPosts` in Task 3. The cached ref shape `{ title, href, featuredImage? }` (Task 2) maps to `RelatedReading`'s `{ title, href, image? }` via the route's `featuredImage`→`image` resolve (Task 3 step 5). `heading`/`showImage` props match across `RelatedReading` (Task 3 step 3), `PostLayout` (step 4), and the route (step 5). The `related-card__media` class asserted in the test (Task 3 step 1) matches the component markup (step 3).
