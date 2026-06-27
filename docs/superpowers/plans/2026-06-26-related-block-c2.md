# Related Posts v2 — C.2 (`{% related %}` block) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A placeable, bodyless `{% related posts="a,b" /%}` Markdoc block that renders an author-curated, ordered list of posts as featured-image cards — for in-body manual placement.

**Architecture:** A repo-root auto-discovered block (`blocks/related/`), sibling to the shipped `{% posts %}` query block. Its `.astro` calls `getCollection` at build, resolves each named slug to `<collection>/<locale>/<slug>`, in order, and renders the same card markup/CSS as the query block, under a configurable heading. Self-closing. Reuses the `@setu/core` resolver clause already in `apps/site/astro.config.mjs`.

**Spec:** `docs/superpowers/specs/2026-06-26-related-posts-v2-design.md` (the `{% related %}` section).

## Global Constraints

- **Bodyless / self-closing:** authored `{% related posts="a,b" /%}`.
- **`posts` is a required comma-separated slug list**; resolved in order to `<collection>/<locale>/<slug>`; unresolvable slugs are dropped (order of the rest preserved).
- **Defaults:** `heading='Related'`, `showImage=true`, `collection='post'`, `locale` defaults to `DEFAULT_LOCALE`.
- **Card markup/CSS matches the query block** (`.setu-posts`/`.setu-post-card` classes) for a consistent look; media src resolved the same way as `blocks/posts/posts.astro` (`PUBLIC_SETU_MEDIA`-prefixed, `http(s)://` passthrough). *(Centralizing block media-resolution onto `@setu/core` `resolveMediaBase` — and fixing the query block's dev fallback — is a noted cross-block follow-up, out of scope here.)*
- **Zero JS.**

---

### Task 1: The `{% related %}` block

**Files:**
- Create: `blocks/related/block.ts`
- Create: `blocks/related/related.astro`
- Create: `content/page/en/related-demo.mdoc`
- Test: `apps/site/test/related-block.test.ts`

**Interfaces:**
- Consumes: `getCollection` (`astro:content`); `entryUrlPath`, `DEFAULT_LOCALE` (`@setu/core`); `defineBlock` + `z`.

- [ ] **Step 1: Write the failing render test**

Create `apps/site/test/related-block.test.ts`:

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
  html = page('page/related-demo')
})

describe('{% related %} block', () => {
  it('renders a Related section with the curated posts', () => {
    expect(html).toContain('class="setu-related"')
    expect(html).toContain('Related')
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toContain('href="/post/astro-on-the-edge"')
  })
  it('preserves the authored order (featured-demo before astro-on-the-edge)', () => {
    expect(html.indexOf('/post/featured-demo')).toBeLessThan(html.indexOf('/post/astro-on-the-edge'))
  })
  it('renders a thumbnail for a curated post that has a featured image', () => {
    expect(html).toMatch(/class="setu-post-card__media"[\s\S]*?\/media\/2026\/06\/test-cat\.jpg/)
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/site exec vitest run test/related-block.test.ts`
Expected: FAIL — `page/related-demo` does not exist / no `setu-related` markup.

- [ ] **Step 3: Create the block contract**

Create `blocks/related/block.ts`:

```ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    posts: z.string(),
    heading: z.string().default('Related'),
    showImage: z.boolean().default(true),
    collection: z.string().default('post'),
    locale: z.string().optional(),
  }),
  editor: { label: 'Related posts', icon: 'info', group: 'widget', keywords: ['related', 'curated', 'links'] },
})
```

- [ ] **Step 4: Create the block component**

Create `blocks/related/related.astro`:

```astro
---
import { getCollection } from 'astro:content'
import { entryUrlPath, DEFAULT_LOCALE } from '@setu/core'

const { posts = '', heading = 'Related', showImage = true, collection = 'post', locale } = Astro.props

const mediaBase = (import.meta.env.PUBLIC_SETU_MEDIA as string) ?? ''
const resolveImg = (s: string): string =>
  !s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${mediaBase}${s}` : s

const loc = locale ?? DEFAULT_LOCALE
const byId = new Map((await getCollection('entries')).map((e) => [e.id, e]))

interface Card {
  title: string
  href: string
  image?: string
}

const cards: Card[] = String(posts)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((slug) => byId.get(`${collection}/${loc}/${slug}`))
  .filter((e): e is NonNullable<typeof e> => Boolean(e))
  .map((e) => {
    const d = (e.data ?? {}) as Record<string, unknown>
    const [col = '', l = '', ...rest] = e.id.split('/')
    const fi = typeof d['featuredImage'] === 'string' ? (d['featuredImage'] as string) : undefined
    return {
      title: typeof d['title'] === 'string' ? (d['title'] as string) : e.id,
      href: `/${entryUrlPath({ collection: col, locale: l, slug: rest.join('/') })}`,
      ...(fi ? { image: resolveImg(fi) } : {}),
    }
  })
---

{
  cards.length > 0 && (
    <section class="setu-related" aria-label={heading}>
      <h2>{heading}</h2>
      <ul class="setu-posts setu-posts--grid">
        {cards.map((c) => (
          <li class="setu-post-card">
            {showImage && c.image && (
              <a href={c.href} class="setu-post-card__media">
                <img src={c.image} alt={c.title} loading="lazy" />
              </a>
            )}
            <a href={c.href} class="setu-post-card__title">{c.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

<style>
  .setu-related { margin: 2rem 0; }
  .setu-related h2 {
    font-family: var(--font-heading, inherit);
    font-size: 1.1rem;
    margin-block-end: 0.75rem;
  }
  .setu-posts { list-style: none; padding: 0; margin: 0; display: grid; gap: 1.25rem; }
  .setu-posts--grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
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

- [ ] **Step 5: Add the demo page fixture**

Create `content/page/en/related-demo.mdoc`:

```
---
title: Related Demo
---

A page demonstrating the curated related block.

{% related posts="featured-demo, astro-on-the-edge" /%}
```

- [ ] **Step 6: Run the render test to verify it passes**

Run: `pnpm --filter @setu/site exec vitest run test/related-block.test.ts`
Expected: PASS — Related section, both curated links in authored order, featured-demo thumbnail, zero JS.

- [ ] **Step 7: Run the full site suite + typecheck**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/site typecheck`
Expected: PASS — existing tests unaffected (the demo page adds a route only; `gen-blocks` now reports a `related` block).

- [ ] **Step 8: Commit**

```bash
git add blocks/related/block.ts blocks/related/related.astro content/page/en/related-demo.mdoc apps/site/test/related-block.test.ts
git commit -m "feat(site): {% related %} block — placeable curated post list"
```

---

## Self-Review

**Spec coverage:** the placeable `{% related posts=… %}` curated block with `heading`/`showImage`/`collection`/`locale`, ordered slug resolution dropping unresolvable, featured-image cards matching the query block, zero JS → Task 1. In-body auto-compute correctly absent (deferred). ✓

**Placeholder scan:** none. Every code step is complete; run steps have commands + expected results.

**Type consistency:** block `props` (Task 1 block.ts) match the `Astro.props` destructure in `related.astro`. The `<collection>/<locale>/<slug>` id form matches `entry.id` and the route convention; `entryUrlPath` href form (`/` + path) matches the site. The `.setu-related`/`.setu-post-card__media` classes asserted in the test match the component markup. The fixture's `posts="featured-demo, astro-on-the-edge"` references real en posts (featured-demo has a featuredImage).
