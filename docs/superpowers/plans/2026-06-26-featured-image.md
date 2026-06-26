# Featured Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single optional featured image per post — set from the editor's right-hand meta panel via the existing media picker, stored in frontmatter, rendered as a responsive post lead/hero.

**Architecture:** Reuse everything. The picker returns a `/media/<key>` src string; we store it verbatim in `metadata.featuredImage`. Publish serializes all metadata to frontmatter and `parseMdoc` reads it back (no core change); `extractMediaRefs` already captures `/media/...` in frontmatter (where-used free). The site renders the lead image with the app's existing `Image.astro` injected into a new `PostLayout` `hero` slot.

**Tech Stack:** React 19 + shadcn/ui (admin, vitest + Testing Library + jsdom), Astro 7 (site, vitest render tests), `@setu/core` (vitest).

**Spec:** `docs/superpowers/specs/2026-06-26-featured-image-design.md`

## Global Constraints

- **Stored value is the `/media/<key>` src string** verbatim from the picker — one representation that is picker output, `Image.astro` input, and `extractMediaRefs` input.
- **Field key is `featuredImage`** in `metadata`/frontmatter. Single, optional. Removing it **deletes the key** (no empty frontmatter value).
- **No `@setu/core` code changes** — round-trip + where-used are already transparent; lock them with tests only.
- **Theme renders no app code:** the responsive lead image is produced in the app (`[...path].astro` via `Image.astro`) and injected into `PostLayout`'s `hero` slot. The theme owns layout/CSS only.
- **Zero JS** added to the site render.
- **`apiBase` source:** `(import.meta.env.VITE_SETU_API as string) ?? ''` — the same source `Canvas` uses.

---

### Task 1: `FeaturedImageField` + meta panel wiring (admin)

**Files:**
- Create: `apps/admin/src/editor/FeaturedImageField.tsx`
- Modify: `apps/admin/src/editor/MetaPanel.tsx`
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (the `<MetaPanel .../>` usage, ~line 315)
- Create: `apps/admin/test/FeaturedImageField.test.tsx`
- Modify: `apps/admin/test/MetaPanel.test.tsx`

**Interfaces:**
- Consumes: `MediaPickerModal` (`{ apiBase, open, onClose, onPick: (src: string) => void }`), `resolveMediaSrc(src, base)` from `./media-src`.
- Produces: `FeaturedImageField` with props `{ value?: string; onChange: (next: string | undefined) => void; editable: boolean; apiBase: string }`; `MetaPanel` gains a required `apiBase: string` prop.

- [ ] **Step 1: Write the failing field test**

Create `apps/admin/test/FeaturedImageField.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeaturedImageField } from '../src/editor/FeaturedImageField'

// Stub the picker so the field's open→pick wiring is deterministic and network-free.
vi.mock('../src/editor/MediaPickerModal', () => ({
  MediaPickerModal: ({ open, onPick }: { open: boolean; onPick: (s: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick('/media/2026/06/hero.jpg')}>
        mock-pick
      </button>
    ) : null,
}))

const base = 'http://localhost:4444'

describe('FeaturedImageField', () => {
  it('shows a "Set featured image" button when empty', () => {
    render(<FeaturedImageField onChange={() => {}} editable apiBase={base} />)
    expect(screen.getByRole('button', { name: 'Set featured image' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('opening the picker and picking calls onChange with the /media src', () => {
    const onChange = vi.fn()
    render(<FeaturedImageField onChange={onChange} editable apiBase={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set featured image' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-pick' }))
    expect(onChange).toHaveBeenCalledWith('/media/2026/06/hero.jpg')
  })

  it('with a value shows a resolved preview and a Remove that clears it', () => {
    const onChange = vi.fn()
    render(
      <FeaturedImageField value="/media/2026/06/hero.jpg" onChange={onChange} editable apiBase={base} />,
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'http://localhost:4444/media/2026/06/hero.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('hides Change/Remove controls when not editable', () => {
    render(
      <FeaturedImageField value="/media/2026/06/hero.jpg" onChange={() => {}} editable={false} apiBase={base} />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the field test to verify it fails**

Run: `pnpm --filter @setu/admin exec vitest run test/FeaturedImageField.test.tsx`
Expected: FAIL — `Cannot find module '../src/editor/FeaturedImageField'`.

- [ ] **Step 3: Implement the field**

Create `apps/admin/src/editor/FeaturedImageField.tsx`:

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaPickerModal } from './MediaPickerModal'
import { resolveMediaSrc } from './media-src'

export function FeaturedImageField({
  value,
  onChange,
  editable,
  apiBase,
}: {
  value?: string
  onChange: (next: string | undefined) => void
  editable: boolean
  apiBase: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="space-y-2.5">
      {value ? (
        <div className="space-y-2">
          <img
            src={resolveMediaSrc(value, apiBase)}
            alt="Featured image preview"
            className="aspect-video w-full rounded-md border border-border/60 object-cover"
          />
          {editable && (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                Change
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => onChange(undefined)}
              >
                <X className="size-3" /> Remove
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!editable}
          onClick={() => setPickerOpen(true)}
        >
          Set featured image
        </Button>
      )}
      <MediaPickerModal
        apiBase={apiBase}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(src) => onChange(src)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the field test to verify it passes**

Run: `pnpm --filter @setu/admin exec vitest run test/FeaturedImageField.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 5: Wire the field into `MetaPanel`**

In `apps/admin/src/editor/MetaPanel.tsx`:

(a) Add the import at the top:

```tsx
import { FeaturedImageField } from './FeaturedImageField'
```

(b) Add `apiBase: string` to the destructured props and the props type:

```tsx
export function MetaPanel({
  metadata,
  locale,
  slug,
  editable,
  onChange,
  apiBase,
}: {
  metadata: Record<string, unknown>
  locale: string
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
  apiBase: string
}) {
```

(c) Insert a new `<Section>` immediately after the `Permalink` `</Section>` and before `Categories`:

```tsx
      <Section title="Featured image">
        <FeaturedImageField
          value={typeof metadata['featuredImage'] === 'string' ? (metadata['featuredImage'] as string) : undefined}
          onChange={(next) => {
            const m = { ...metadata }
            if (next) m['featuredImage'] = next
            else delete m['featuredImage']
            onChange(m)
          }}
          editable={editable}
          apiBase={apiBase}
        />
      </Section>
```

- [ ] **Step 6: Pass `apiBase` from `EditorScreen`**

In `apps/admin/src/editor/EditorScreen.tsx`, update the `<MetaPanel .../>` usage (~line 315) to add the `apiBase` prop:

```tsx
        <MetaPanel
          metadata={metadata}
          locale={locale}
          slug={slug}
          editable={phase === 'ready'}
          onChange={onMetaChange}
          apiBase={(import.meta.env.VITE_SETU_API as string) ?? ''}
        />
```

- [ ] **Step 7: Update the MetaPanel test for the new required prop + section**

In `apps/admin/test/MetaPanel.test.tsx`:

(a) Add `apiBase` to the `defaults` object in `setup()`:

```tsx
  const defaults = {
    metadata: { title: 'Hello', categories: [], tags: [] },
    locale: 'en',
    slug: 'my-post',
    editable: true,
    onChange,
    apiBase: 'http://localhost:4444',
  }
```

(b) Add a test asserting the new section renders between Permalink and Categories:

```tsx
  it('renders a Featured image section between Permalink and Categories', () => {
    setup()
    const texts = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const permalinkIdx = texts.indexOf('Permalink')
    const featuredIdx = texts.indexOf('Featured image')
    const categoriesIdx = texts.indexOf('Categories')
    expect(featuredIdx).not.toBe(-1)
    expect(permalinkIdx).toBeLessThan(featuredIdx)
    expect(featuredIdx).toBeLessThan(categoriesIdx)
  })
```

- [ ] **Step 8: Run the admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — new tests green, existing `MetaPanel.test.tsx` green with the added prop, `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/editor/FeaturedImageField.tsx apps/admin/src/editor/MetaPanel.tsx apps/admin/src/editor/EditorScreen.tsx apps/admin/test/FeaturedImageField.test.tsx apps/admin/test/MetaPanel.test.tsx
git commit -m "feat(admin): featured-image field in the editor meta panel"
```

---

### Task 2: Render the featured image as a post lead/hero (site + theme)

**Files:**
- Modify: `packages/theme-default/PostLayout.astro`
- Modify: `packages/theme-default/site.css`
- Modify: `apps/site/src/pages/[...path].astro`
- Create: `content/post/en/featured-demo.mdoc`
- Test: `apps/site/test/featured.test.ts`

**Interfaces:**
- Consumes: `metadata.featuredImage` (a `/media/<key>` string) surfaced as `entry.data.featuredImage`; the app's `apps/site/src/components/Image.astro` (`{ src, alt, sizes }`).
- Produces: a `PostLayout` named slot `hero`; the app injects a `<figure class="post-hero measure-post">` lead image into it.

- [ ] **Step 1: Write the failing render test**

Create `apps/site/test/featured.test.ts`:

```ts
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'featured-media-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  writeFileSync(
    join(md, 'test-cat.manifest.json'),
    JSON.stringify({
      id: '2026/06/test-cat',
      format: 'webp',
      original: { key: '2026/06/test-cat.jpg', width: 1000, height: 600, format: 'jpeg' },
      variants: [
        { width: 400, height: 240, key: '2026/06/test-cat-400w.webp', contentType: 'image/webp' },
        { width: 1000, height: 600, key: '2026/06/test-cat-1000w.webp', contentType: 'image/webp' },
      ],
    }),
  )
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_MEDIA_DIR: mediaDir, PUBLIC_SETU_MEDIA: 'https://cdn.example.test' },
  })
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

describe('featured image — post lead/hero', () => {
  it('renders a responsive lead image inside .post-hero for a post that has one', () => {
    const html = page('post/featured-demo')
    const hero = html.match(/<figure class="post-hero[^"]*"[^>]*>[\s\S]*?<\/figure>/)?.[0] ?? ''
    expect(hero).not.toBe('')
    expect(hero).toContain('https://cdn.example.test/media/2026/06/test-cat.jpg')
    expect(hero).toContain('https://cdn.example.test/media/2026/06/test-cat-400w.webp 400w')
  })
  it('renders no .post-hero for a post without a featured image', () => {
    expect(page('post/kitchen-sink')).not.toContain('class="post-hero')
  })
  it('ships zero JS', () => {
    const html = page('post/featured-demo')
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 2: Run the render test to verify it fails**

Run: `pnpm --filter @setu/site exec vitest run test/featured.test.ts`
Expected: FAIL — `post/featured-demo` does not exist / no `.post-hero` markup.

- [ ] **Step 3: Add the `hero` slot to `PostLayout`**

In `packages/theme-default/PostLayout.astro`, add a `<slot name="hero" />` above the `<article>` (the props interface is unchanged — the app fills the slot):

```astro
<Layout title={title} lang={lang} themeOptions={themeOptions} siteSettings={siteSettings}>
  <slot name="hero" />
  <article class="prose measure-post"><slot /></article>
  <div class="measure-post"><RelatedReading related={related} /></div>
</Layout>
```

- [ ] **Step 4: Style `.post-hero` in the theme**

Append to `packages/theme-default/site.css`:

```css
.post-hero { margin: 2.5rem auto 0; padding: 0 1.25rem; }
.post-hero img { width: 100%; height: auto; border-radius: var(--r-md); display: block; }
```

- [ ] **Step 5: Inject the lead image from the page route**

In `apps/site/src/pages/[...path].astro`, import the site Image component (add to the existing imports):

```ts
import Image from '../components/Image.astro'
```

Add, in the frontmatter after the existing `const related = ...` line:

```ts
const featuredImage = typeof (entry.data as { featuredImage?: unknown }).featuredImage === 'string'
  ? (entry.data as { featuredImage: string }).featuredImage
  : undefined
```

Then render the hero into the `hero` slot inside the `<TemplateLayout>` element (alongside the existing `<h1>` / `<Content />`):

```astro
<TemplateLayout title={title} lang={locale} themeOptions={themeOptions} siteSettings={siteSettings} related={related}>
  {featuredImage && (
    <figure class="post-hero measure-post" slot="hero">
      <Image src={featuredImage} alt={title} sizes="(min-width: 40rem) 38rem, 100vw" />
    </figure>
  )}
  <h1>{title}</h1>
  <Content />
</TemplateLayout>
```

- [ ] **Step 6: Add a featured-demo fixture post**

Create `content/post/en/featured-demo.mdoc`:

```
---
title: Featured Demo
featuredImage: /media/2026/06/test-cat.jpg
---

A post used to verify the featured-image lead renders responsively.
```

- [ ] **Step 7: Run the render test to verify it passes**

Run: `pnpm --filter @setu/site exec vitest run test/featured.test.ts`
Expected: PASS — `.post-hero` lead image with srcset on `featured-demo`, none on `kitchen-sink`, zero JS.

- [ ] **Step 8: Run the full site + theme suites + typecheck**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/theme-default test && pnpm --filter @setu/site typecheck`
Expected: PASS — existing render/related tests unaffected (new fixture adds a route only), `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add packages/theme-default/PostLayout.astro packages/theme-default/site.css "apps/site/src/pages/[...path].astro" content/post/en/featured-demo.mdoc apps/site/test/featured.test.ts
git commit -m "feat(site): render featured image as a responsive post lead/hero"
```

---

### Task 3: Core guard tests for the transparent round-trip + where-used

**Files:**
- Create: `packages/core/src/markdoc/frontmatter-featured.test.ts`
- Create: `packages/core/src/content-index/extract-media-refs-featured.test.ts`

**Interfaces:**
- Consumes: `parseMdoc`, `serializeMdoc` from `../markdoc/frontmatter`; `extractMediaRefs` from `./extract-media-refs`. No production code changes.

- [ ] **Step 1: Write the round-trip guard test**

Create `packages/core/src/markdoc/frontmatter-featured.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMdoc, serializeMdoc } from './frontmatter'

describe('frontmatter — featuredImage round-trip', () => {
  it('serializes and parses metadata.featuredImage unchanged', () => {
    const file = {
      frontmatter: { title: 'X', featuredImage: '/media/2026/06/hero.jpg' },
      body: 'A body paragraph.\n',
    }
    const round = parseMdoc(serializeMdoc(file))
    expect(round.frontmatter['featuredImage']).toBe('/media/2026/06/hero.jpg')
    expect(round.body).toBe('A body paragraph.\n')
  })
})
```

- [ ] **Step 2: Write the where-used guard test**

Create `packages/core/src/content-index/extract-media-refs-featured.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extractMediaRefs } from './extract-media-refs'

describe('extractMediaRefs — frontmatter featuredImage', () => {
  it('captures a frontmatter featuredImage as a normalized media key', () => {
    const doc = '---\ntitle: X\nfeaturedImage: /media/2026/06/hero.jpg\n---\n\nBody.\n'
    expect(extractMediaRefs(doc)).toContain('2026/06/hero')
  })
  it('also normalizes an extensionless featuredImage path', () => {
    const doc = '---\nfeaturedImage: /media/2026/06/hero\n---\n\nBody.\n'
    expect(extractMediaRefs(doc)).toContain('2026/06/hero')
  })
})
```

- [ ] **Step 3: Run both tests to verify they pass (no production change needed)**

Run: `pnpm --filter @setu/core exec vitest run src/markdoc/frontmatter-featured.test.ts src/content-index/extract-media-refs-featured.test.ts`
Expected: PASS — proving round-trip + where-used work for `featuredImage` with no code change.

- [ ] **Step 4: Run the full core suite**

Run: `pnpm --filter @setu/core test`
Expected: PASS — all core tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/markdoc/frontmatter-featured.test.ts packages/core/src/content-index/extract-media-refs-featured.test.ts
git commit -m "test(core): guard featuredImage round-trip + where-used capture"
```

---

## Self-Review

**Spec coverage:**
- Admin field (pick/preview/remove, opens existing picker, stores `/media` src) + meta-panel section + apiBase threading → Task 1. ✓
- Transparent round-trip + where-used (no core change) → guarded by Task 3. ✓
- Responsive lead/hero render via the app's `Image.astro` into a theme `hero` slot (theme renders no app code) → Task 2. ✓
- Decisions: single optional, store `/media` src, delete-key on remove, hero render, og:image deferred → Tasks 1–2. ✓
- Zero-JS → Task 2 assertion. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows complete code; every run step shows the command + expected result.

**Type consistency:** `FeaturedImageField` props (`value?`, `onChange: (next: string | undefined) => void`, `editable`, `apiBase`) are defined in Task 1 and matched by the `MetaPanel` wiring. `MetaPanel`'s new `apiBase: string` is supplied by `EditorScreen` (Task 1) and the test `setup()` defaults (Task 1 step 7). The stored value format `/media/<key>` is consistent across the field (Task 1), the `[...path].astro` consumer + fixture (Task 2), and the core guard tests (Task 3). The `hero` slot name matches between `PostLayout` (Task 2 step 3) and the `slot="hero"` injection (Task 2 step 5).
