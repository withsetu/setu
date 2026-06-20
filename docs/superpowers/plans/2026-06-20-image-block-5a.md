# Rich Image Block #5a (the figure render) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `{% image %}` as a responsive `<figure>` with `<figcaption>` and alignment, computing a per-alignment `sizes` so the right variant is pulled from the #4b manifest ladder.

**Architecture:** Render-only slice. A pure `sizesForAlign(align)` maps the alignment to a browser `sizes` hint; a thin `ImageFigure.astro` wraps the existing `Image.astro` (#4c — all manifest/srcset logic) in `<figure>`/`<figcaption>` + an `align-*` class; `markdoc.config.mjs` registers `image` as an explicit render tag; the theme stylesheet styles the alignments. The editor is untouched — `{% image %}` stays a verbatim passthrough (proven by a core test), because making it a folder block now would force a spurious body onto a bodyless tag (that, plus the dedicated editor node, is #5b).

**Tech Stack:** Astro 6 (`.astro` components + Markdoc integration), TypeScript, Vitest. Markdoc⇄Tiptap round-trip in `@setu/core`. Theme CSS in `packages/theme-default`.

## Global Constraints

- **Cloudflare-Pages-compatible + cost-safe:** all work is build-time; output is static `<figure><img srcset></figure>`. Zero per-visitor cost, no runtime image service. (Standing engineering rule.)
- **Content safety:** `{% image %}` MUST round-trip through the editor byte-exact (passthrough), with **no body forced** onto the bodyless tag.
- **#5a is render-only:** do NOT create a `blocks/image/` folder, a Zod contract, an editor node, or add `image` to `knownBlockTags`. Those are #5b.
- **Reuse, don't duplicate:** the figure wraps the existing `apps/site/src/components/Image.astro`; do not re-implement manifest loading or srcset.
- **Alignment set is exactly** `none | left | right | wide | full`, default `none`.
- **Exact `sizes` values** (anchored to theme tokens `--measure-post: 38rem`≈608px, `--measure-page: 64rem`≈1024px):
  - `none` → `min(100vw, 608px)`
  - `wide` → `min(100vw, 1024px)`
  - `full` → `100vw`
  - `left` / `right` → `(max-width: 608px) 100vw, 304px`
- **Commit trailer on every commit:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run all commands from the worktree root `/Users/mayank/Documents/projects/setu/.claude/worktrees/media-image-block`. Verify you are on branch `worktree-media-image-block` in that worktree before any commit; never run `git checkout/switch/reset/merge`.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `apps/site/src/lib/image-align.ts` | Create | Pure `sizesForAlign(align)` + `ImageAlign` type |
| `apps/site/test/image-align.test.ts` | Create | Unit test for `sizesForAlign` |
| `packages/core/test/image-block-roundtrip.test.ts` | Create | Guard: `{% image %}` passes through byte-exact, no forced body |
| `apps/site/src/components/ImageFigure.astro` | Create | `<figure>`/`<figcaption>`/`align-*` wrapper over `Image.astro` |
| `apps/site/markdoc.config.mjs` | Modify | Register `tags.image → ImageFigure.astro` |
| `packages/theme-default/site.css` | Modify (additive) | Figure + alignment CSS |
| `content/post/en/kitchen-sink.mdoc` | Modify | Add one `{% image %}` block to the render fixture |
| `apps/site/test/render.test.ts` | Modify | Assert the figure renders responsively with caption + alignment |

---

### Task 1: Pure per-alignment `sizes`

**Files:**
- Create: `apps/site/src/lib/image-align.ts`
- Test: `apps/site/test/image-align.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ImageAlign = 'none' | 'left' | 'right' | 'wide' | 'full'` and `function sizesForAlign(align: ImageAlign | string | undefined): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/test/image-align.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sizesForAlign } from '../src/lib/image-align'

describe('sizesForAlign', () => {
  it('returns the content-column hint for none', () => {
    expect(sizesForAlign('none')).toBe('min(100vw, 608px)')
  })
  it('returns the page-width hint for wide', () => {
    expect(sizesForAlign('wide')).toBe('min(100vw, 1024px)')
  })
  it('returns full-viewport for full', () => {
    expect(sizesForAlign('full')).toBe('100vw')
  })
  it('returns the half-column float hint for left and right', () => {
    expect(sizesForAlign('left')).toBe('(max-width: 608px) 100vw, 304px')
    expect(sizesForAlign('right')).toBe('(max-width: 608px) 100vw, 304px')
  })
  it('falls back to the none hint for undefined and unknown values', () => {
    expect(sizesForAlign(undefined)).toBe('min(100vw, 608px)')
    expect(sizesForAlign('sideways')).toBe('min(100vw, 608px)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/site test image-align`
Expected: FAIL — `Failed to resolve import "../src/lib/image-align"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/site/src/lib/image-align.ts`:
```ts
// Per-alignment browser `sizes` hint for a {% image %} figure, so the srcset (#4b) picks the
// right variant. Pure + build-time only. Anchored to the default theme's content/page widths
// (packages/theme-default/theme.css: --measure-post 38rem ≈ 608px, --measure-page 64rem ≈ 1024px);
// theme-reactive sizes is a later refinement.
export type ImageAlign = 'none' | 'left' | 'right' | 'wide' | 'full'

const CONTENT_PX = 608 // 38rem — the prose content column (--measure-post)
const PAGE_PX = 1024 // 64rem — the page width (--measure-page)

/** `sizes` hint for the given alignment. Unknown/empty align is treated as 'none'; never throws. */
export function sizesForAlign(align: ImageAlign | string | undefined): string {
  switch (align) {
    case 'full':
      return '100vw'
    case 'wide':
      return `min(100vw, ${PAGE_PX}px)`
    case 'left':
    case 'right':
      return `(max-width: ${CONTENT_PX}px) 100vw, ${Math.round(CONTENT_PX / 2)}px`
    case 'none':
    default:
      return `min(100vw, ${CONTENT_PX}px)`
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/site test image-align`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @setu/site typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/image-align.ts apps/site/test/image-align.test.ts
git commit -m "feat(site): sizesForAlign — per-alignment sizes for the {% image %} figure (#5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Round-trip passthrough guard

**Files:**
- Create: `packages/core/test/image-block-roundtrip.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap`, `tiptapToMarkdoc` from `@setu/core` (`../src/index`).
- Produces: nothing (a characterization/guard test — no production change).

This is a guard test that locks in the existing passthrough behavior the #5a boundary depends on: with no block registration for `image` (the #5a state), a bodyless `{% image %}` tag survives the editor round-trip byte-exact and never gains a body. `markdocToTiptap` with no options uses the empty `defaultKnownBlockTags`, so `image` is unknown → a single `passthrough` node (see `to-tiptap.ts:180-205`). Because the behavior already exists, the test passes immediately — that is expected; its value is preventing a future regression (e.g. someone auto-registering the tag and silently breaking content shape).

- [ ] **Step 1: Write the test**

Create `packages/core/test/image-block-roundtrip.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const rt = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

// #5a registers {% image %} for RENDER only; the editor has no block for it, so it must pass
// through verbatim. Guards against a regression that would force a body onto the bodyless tag.
describe('{% image %} block — #5a passthrough safety', () => {
  const md = `{% image src="/uploads/media/test/original.png" alt="A test cat" caption="A caption" align="wide" /%}\n`

  it('round-trips a bodyless {% image %} tag byte-exact', () => {
    expect(rt(md)).toBe(md)
  })

  it('represents an unknown {% image %} tag as a single passthrough node (no forced body)', () => {
    const doc = markdocToTiptap(md)
    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0]?.type).toBe('passthrough')
    expect(doc.content?.[0]?.content).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes (guard — already-green behavior)**

Run: `pnpm --filter @setu/core test image-block-roundtrip`
Expected: PASS (2 tests). If it FAILS, the passthrough mechanism changed — stop and report; do not "fix" by registering the tag.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/image-block-roundtrip.test.ts
git commit -m "test(core): guard {% image %} passthrough byte-fidelity (#5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The figure component, tag registration, theme CSS, and end-to-end render

**Files:**
- Create: `apps/site/src/components/ImageFigure.astro`
- Modify: `apps/site/markdoc.config.mjs` (add `image` to the `tags` map)
- Modify: `packages/theme-default/site.css` (append the figure/alignment block)
- Modify: `content/post/en/kitchen-sink.mdoc` (add one `{% image %}` block)
- Modify: `apps/site/test/render.test.ts` (add a figure-render describe block)

**Interfaces:**
- Consumes: `sizesForAlign` from `../lib/image-align` (Task 1); the existing `Image.astro` (props `src`, `alt`, `sizes`).
- Produces: the rendered figure markup the success criteria assert.

These change together: the figure is only observable once the tag is registered, the alignment is only styled once the CSS lands, and the render test exercises all of them against the built site. The render test runs a full `astro build`, so it is the single integration cycle for the task.

- [ ] **Step 1: Add the failing render assertions**

In `apps/site/test/render.test.ts`, add this describe block at the end of the file (after the existing `render pipeline — images` block):
```ts
describe('render pipeline — {% image %} figure block', () => {
  it('renders {% image %} as a responsive figure with caption and alignment', () => {
    expect(html).toContain('<figure class="setu-image align-wide">')
    expect(html).toContain('http://localhost:4444/uploads/media/test/w400.webp 400w')
    expect(html).toContain('http://localhost:4444/uploads/media/test/w1000.webp 1000w')
    expect(html).toContain('sizes="min(100vw, 1024px)"')
    expect(html).toContain('width="1000"')
    expect(html).toContain('height="600"')
    expect(html).toContain('alt="A wide test cat"')
    expect(html).toContain('<figcaption>A caption with detail</figcaption>')
  })
  it('styles the alignment classes from the theme stylesheet', () => {
    expect(themeCss()).toContain('figure.setu-image')
    expect(themeCss()).toContain('.align-full')
  })
})
```

- [ ] **Step 2: Add the figure to the content fixture**

In `content/post/en/kitchen-sink.mdoc`, append after the last line (`![External photo](https://example.com/photo.png)`):
```
{% image src="/uploads/media/test/original.png" alt="A wide test cat" caption="A caption with detail" align="wide" /%}
```

- [ ] **Step 3: Run the render test to verify it fails**

Run: `pnpm --filter @setu/site test render`
Expected: FAIL — the `{% image %}` tag is not registered, so the figure markup (`<figure class="setu-image align-wide">`, `<figcaption>…`) is absent (Markdoc renders the unknown tag as nothing / passes it through, not as a figure).

- [ ] **Step 4: Create the figure component**

Create `apps/site/src/components/ImageFigure.astro`:
```astro
---
// {% image %} block (#5a): a responsive <figure> with optional caption + alignment.
// Reuses Image.astro (#4c) for all manifest/srcset/intrinsic-dims logic; adds only the
// figure/caption wrapper and a per-alignment `sizes`. Build-time + static (zero runtime cost).
import Image from './Image.astro'
import { sizesForAlign } from '../lib/image-align'

const { src = '', alt = '', caption, align = 'none' } = Astro.props
const sizes = sizesForAlign(align)
---
<figure class:list={['setu-image', `align-${align}`]}>
  <Image src={src} alt={alt} sizes={sizes} />
  {caption && <figcaption>{caption}</figcaption>}
</figure>
```

- [ ] **Step 5: Register the `image` tag**

In `apps/site/markdoc.config.mjs`, add an `image` entry to the `tags` object (alongside `sub`/`sup`, after the `...generatedTags` spread):
```js
  tags: {
    ...generatedTags,
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
    image: {
      render: component('./src/components/ImageFigure.astro'),
      attributes: {
        src: { type: String },
        alt: { type: String },
        caption: { type: String },
        align: { type: String, matches: ['none', 'left', 'right', 'wide', 'full'], default: 'none' },
      },
    },
  },
```
(Leave the `nodes.image → Image.astro` mapping for inline `![]()` untouched.)

- [ ] **Step 6: Add the alignment CSS**

Append to `packages/theme-default/site.css` (after the existing `.measure-page` rule):
```css

/* {% image %} figure block (media #5a) */
.prose figure.setu-image { margin: 1.75rem 0; }
.prose figure.setu-image img { display: block; max-width: 100%; height: auto; border-radius: var(--r-md); }
.prose figure.setu-image figcaption { margin-top: .5rem; font-size: .9rem; color: var(--text-2); text-align: center; }
.prose figure.setu-image.align-wide { max-width: var(--measure-page); margin-left: 50%; transform: translateX(-50%); }
.prose figure.setu-image.align-full { width: 100vw; margin-left: 50%; transform: translateX(-50%); }
.prose figure.setu-image.align-full img { border-radius: 0; }
.prose figure.setu-image.align-left { float: left; max-width: 50%; margin: .3rem 1.25rem 1rem 0; }
.prose figure.setu-image.align-right { float: right; max-width: 50%; margin: .3rem 0 1rem 1.25rem; }
@media (max-width: 38rem) {
  .prose figure.setu-image.align-left,
  .prose figure.setu-image.align-right { float: none; max-width: 100%; margin: 1.75rem 0; }
}
```

- [ ] **Step 7: Run the render test to verify it passes**

Run: `pnpm --filter @setu/site test render`
Expected: PASS — the new figure-block describe passes and all pre-existing render assertions (inline image, callout, notice, etc.) stay green.

- [ ] **Step 8: Typecheck the touched packages**

Run: `pnpm --filter @setu/site typecheck && pnpm --filter @setu/theme-default typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/components/ImageFigure.astro apps/site/markdoc.config.mjs packages/theme-default/site.css content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts
git commit -m "feat(site): {% image %} responsive figure block — caption + alignment (#5a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Whole-slice verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm -r test`
Expected: all packages green (includes the new `image-align`, `image-block-roundtrip`, and figure-render tests).

- [ ] **Step 2: Full typecheck**

Run: `pnpm -r typecheck`
Expected: no errors across the workspace.

- [ ] **Step 3: Confirm no stray edits**

Run: `git status --short`
Expected: clean working tree (all changes committed; `.mcp.json` may remain untracked — leave it).

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- `sizesForAlign` (spec unit 1) → Task 1. ✅
- `ImageFigure.astro` (spec unit 2) → Task 3 Step 4. ✅
- `markdoc.config.mjs` tag registration (spec unit 3) → Task 3 Step 5. ✅
- Alignment CSS in theme (spec unit 4) → Task 3 Step 6. ✅
- Round-trip passthrough safety test (spec Testing) → Task 2. ✅
- `image-align` unit test (spec Testing) → Task 1. ✅
- End-to-end build render test (spec Testing) → Task 3 Steps 1–7. ✅
- "No folder block / no editor node / no knownBlockTags change" (spec boundary) → enforced by Global Constraints; no task creates them. ✅

**2. Placeholder scan:** none — every code/CSS/command step is concrete.

**3. Type consistency:** `sizesForAlign(align: ImageAlign | string | undefined): string` is defined in Task 1 and consumed in Task 3 Step 4 with a string prop; the exact `sizes` strings in Task 1's test match the render assertion `sizes="min(100vw, 1024px)"` in Task 3 (wide). The figure class `setu-image align-wide` in Task 3 Step 4 matches the render assertion and the CSS selectors in Step 6.
