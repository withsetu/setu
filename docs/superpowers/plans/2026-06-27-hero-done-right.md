# Hero done right Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hero` a real, responsive, configurable marketing block — extract the responsive-image render pipeline into a shared package, rebuild the hero renderer on it (4 layout archetypes + 9-point text position + overlay color + opt-in parallax), and extend the inspector with a `color` control and conditional fields.

**Architecture:** Lift `apps/site`'s image-render pipeline into `@setu/image-astro` so block renderers can emit `srcset`-driven images. The hero renderer stays a core-standard block in `@setu/blocks`, now importing the shared `<Image>`. The contract grows (`layout`/`textPosition`/`overlayColor`/`parallax`); the inspector substrate gains a `color` control + `showWhen` conditional fields. Per-theme renderer override and free X/Y stay deferred.

**Tech Stack:** TypeScript, zod, Astro, React 19, Tailwind v4 + shadcn/ui, Vitest + Testing Library, pnpm workspaces, Markdoc.

## Global Constraints

- **Single source of truth / portability:** hero round-trips as a self-closing `{% hero ... /%}` Markdoc tag; all props are plain string/number/boolean attrs. No new content model.
- **Responsive is mandatory:** hero image uses the shared `<Image>` (manifest `srcset` + per-layout `sizes`); fluid type via `clamp()`; positions map to CSS `align`/`justify` (no absolute coords). Free X/Y is OUT.
- **Parallax:** `background` layout only, opt-in; MUST respect `prefers-reduced-motion` (no motion) and disable on touch/coarse pointers (degrade to static). It is the hero's one client-JS island; everything else is static HTML.
- **`@setu/image-astro` extraction is visually inert** for `apps/site` (identical output).
- **`color` control** writes an `#RRGGBBAA` string (color + alpha); it's String-backed in the contract. Hand-picked colors are fixed values (don't track theme) — acceptable for a hero scrim.
- **Conditional fields:** `showWhen` on a block's editor meta hides a control unless its predicate matches the current `mdAttrs`.
- Pure shadcn tokens in admin CSS (Tailwind utilities; the `no-brand-accent-in-bespoke-css` guard forbids bare `var(--accent)` in hand-written admin CSS). `@setu/blocks` hero.css uses the shared block tokens (`--accent`/`--on-accent`/`--r-md`).
- Full gate `pnpm typecheck && pnpm test && build` green. Live UAT on a CLEAN dev server (per [[setu-editor-live-smoke-test]] — stale daemons/branch-switches caused phantom failures). Commit per task; do NOT git-add `.superpowers/`.

---

### Task 1: Extract `@setu/image-astro` (shared responsive-image render pipeline)

**Files:**
- Create: `packages/image-astro/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Move: `apps/site/src/lib/{media-base,image-markup,media-manifest,image-align}.ts` → `packages/image-astro/src/lib/`
- Move: `apps/site/src/components/{Image,ImageFigure}.astro` → `packages/image-astro/src/`
- Move: `apps/site/test/{media-base,image-markup,media-manifest,image-align}.test.ts` → `packages/image-astro/test/`
- Modify: `apps/site/src/pages/[...path].astro`, `apps/site/src/preview/preview.astro` (repoint imports)
- Modify: `apps/site/package.json`, `packages/blocks/package.json` (add dep)

**Interfaces:**
- Produces: `@setu/image-astro/Image.astro` (props `{ src, alt, title?, sizes? }`), `@setu/image-astro/ImageFigure.astro`, and from `@setu/image-astro` (index): `resolveMediaBase(configured, isDev)`, `imageMarkup(input)`, `manifestKeyFromSrc(src)`, `loadManifest(mediaKey)`, `sizesForAlign(align)` + their types.

- [ ] **Step 1: Scaffold the package.** Create `packages/image-astro/package.json`:
```json
{
  "name": "@setu/image-astro",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./Image.astro": "./src/Image.astro",
    "./ImageFigure.astro": "./src/ImageFigure.astro"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```
Create `packages/image-astro/tsconfig.json` (mirror `packages/blocks/tsconfig.json`) and `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 2: Move the lib + tests + components** (git mv preserves history):
```bash
mkdir -p packages/image-astro/src/lib packages/image-astro/test
git mv apps/site/src/lib/media-base.ts packages/image-astro/src/lib/media-base.ts
git mv apps/site/src/lib/image-markup.ts packages/image-astro/src/lib/image-markup.ts
git mv apps/site/src/lib/media-manifest.ts packages/image-astro/src/lib/media-manifest.ts
git mv apps/site/src/lib/image-align.ts packages/image-astro/src/lib/image-align.ts
git mv apps/site/src/components/Image.astro packages/image-astro/src/Image.astro
git mv apps/site/src/components/ImageFigure.astro packages/image-astro/src/ImageFigure.astro
git mv apps/site/test/media-base.test.ts packages/image-astro/test/media-base.test.ts
git mv apps/site/test/image-markup.test.ts packages/image-astro/test/image-markup.test.ts
git mv apps/site/test/media-manifest.test.ts packages/image-astro/test/media-manifest.test.ts
git mv apps/site/test/image-align.test.ts packages/image-astro/test/image-align.test.ts
```

- [ ] **Step 3: Fix the moved files' internal imports.**
  - `packages/image-astro/src/Image.astro`: change `../lib/media-manifest` → `./lib/media-manifest`, `../lib/image-markup` → `./lib/image-markup`, `../lib/media-base` → `./lib/media-base`.
  - `packages/image-astro/src/ImageFigure.astro`: change `./Image.astro` (unchanged, same dir) and `../lib/image-align` → `./lib/image-align`.
  - The moved tests import `../src/lib/<name>` (was `../src/lib`); confirm each test's import path resolves to `../src/lib/<name>` and fix if it pointed at `../../packages/...`.

- [ ] **Step 4: Write the index barrel.** `packages/image-astro/src/index.ts`:
```ts
export { resolveMediaBase } from './lib/media-base'
export { imageMarkup } from './lib/image-markup'
export type { ImageAttrs, ImageMarkupInput } from './lib/image-markup'
export { manifestKeyFromSrc, loadManifest } from './lib/media-manifest'
export { sizesForAlign } from './lib/image-align'
```

- [ ] **Step 5: Repoint `apps/site` importers.**
  - `apps/site/src/pages/[...path].astro`: `import Image from '@setu/image-astro/Image.astro'` and `import { resolveMediaBase } from '@setu/image-astro'`.
  - `apps/site/src/preview/preview.astro`: `import ImageFigure from '@setu/image-astro/ImageFigure.astro'` and `import Image from '@setu/image-astro/Image.astro'`.
  - Add `"@setu/image-astro": "workspace:*"` to `apps/site/package.json` dependencies AND `packages/blocks/package.json` dependencies. Run `pnpm install` from repo root to link.

- [ ] **Step 6: Run the moved tests + the site build (inert check).**
```bash
pnpm install
cd packages/image-astro && pnpm test
cd /Users/mayank/Documents/projects/setu && pnpm --filter @setu/site build
```
Expected: image-astro tests PASS (the 4 moved suites); site build succeeds and a page with an image still renders `<img srcset sizes width height>` (open `apps/site/dist/.../index.html` for an image page — markup identical to before the move).

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "refactor(image): extract @setu/image-astro responsive-image render pipeline"
```

---

### Task 2: Inspector substrate — `color` control + `showWhen` conditional fields

**Files:**
- Modify: `packages/core/src/config/types.ts` (add `'color'` to `BlockControl`; add `showWhen` to `BlockEditorMeta`)
- Modify: `packages/core/src/blocks/resolve-controls.ts` (allow `color`)
- Test: `packages/core/test/resolve-controls.test.ts` (extend)
- Modify: `apps/admin/src/editor/BlockInspector.tsx` (render `color` control + filter by `showWhen`)
- Test: `apps/admin/test/BlockInspector.test.tsx` (extend)

**Interfaces:**
- Produces: `BlockControl` includes `'color'`; `BlockEditorMeta.showWhen?: Record<string, Record<string, string | string[]>>`; `BlockInspector` renders a color (swatch + alpha) control and hides any control whose `showWhen` predicate fails against the current `mdAttrs`.

- [ ] **Step 1: Failing core test** — `color` is a valid String-backed hint. Add to `resolve-controls.test.ts`:
```ts
it('accepts a color hint on a string prop', () => {
  const p = z.object({ scrim: z.string().optional() })
  expect(resolveControls(p, { scrim: 'color' })).toEqual([{ name: 'scrim', control: 'color' }])
})
```

- [ ] **Step 2: Run it — FAIL** (`color` not in the union / not compatible).
Run: `cd packages/core && pnpm vitest run test/resolve-controls.test.ts`
Expected: FAIL (type error or incompatible-hint throw).

- [ ] **Step 3: Add `color` to the type + resolver.**
  - `packages/core/src/config/types.ts`: change the union to
    `export type BlockControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'media' | 'url' | 'color'`
    and add to `BlockEditorMeta`:
    ```ts
    /** Hide a control unless every (otherProp → value|values) pair matches the current attrs. */
    showWhen?: Record<string, Record<string, string | string[]>>
    ```
  - `packages/core/src/blocks/resolve-controls.ts`: add `'color'` to `STRING_CONTROLS`:
    ```ts
    const STRING_CONTROLS: ReadonlySet<BlockControl> = new Set(['text', 'textarea', 'media', 'url', 'color'])
    ```

- [ ] **Step 4: Run core test — PASS.**
Run: `cd packages/core && pnpm vitest run test/resolve-controls.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Failing admin test** — color renders + `showWhen` hides. Add to `BlockInspector.test.tsx` (use the real `hero` registry block after Task 3 lands — but this task precedes it, so test against a small inline expectation using `overlayColor`/`parallax` will come via hero; for now assert the `showWhen` filter + color control with a stub). Add:
```tsx
it('renders a color control and hides showWhen-gated controls', async () => {
  // hero (Task 3) declares overlayColor:'color' + parallax gated to layout==='background'
  const { rerender } = render(<BlockInspector tag="hero" mdAttrs={{ layout: 'centered' }} onChange={() => {}} apiBase="" />)
  expect(screen.queryByLabelText('overlayColor')).toBeNull()       // hidden on centered
  rerender(<BlockInspector tag="hero" mdAttrs={{ layout: 'background' }} onChange={() => {}} apiBase="" />)
  expect(screen.getByLabelText('overlayColor')).toBeInTheDocument() // shown on background
})
```
(NOTE: this test depends on the hero contract from Task 3. If executing strictly in order, write the `showWhen` filter + color control here, and add this assertion when Task 3's contract exists — or land Tasks 2+3 together. The controller may merge Task 2's color-control code with Task 3's contract for a single reviewable unit.)

- [ ] **Step 6: Implement in `BlockInspector.tsx`.** After computing `controls`, filter by `showWhen`; add a `color` branch. Insert the filter:
```tsx
  const controls = resolveControls(block.props, block.editor?.controls)
  const showWhen = block.editor?.showWhen ?? {}
  const visible = controls.filter((c) => {
    const rule = showWhen[c.name]
    if (!rule) return true
    return Object.entries(rule).every(([k, v]) => {
      const cur = mdAttrs[k]
      return Array.isArray(v) ? v.includes(cur as string) : cur === v
    })
  })
```
Map over `visible` instead of `controls`. Add the `color` control branch (before the final text fallback):
```tsx
          ) : c.control === 'color' ? (
            <div className="flex items-center gap-2">
              <input type="color" aria-label={c.name}
                value={(String(mdAttrs[c.name] ?? '#000000ff')).slice(0, 7)}
                onChange={(e) => onChange(c.name, e.target.value + (String(mdAttrs[c.name] ?? '').slice(7) || 'ff'))}
                className="h-8 w-10 rounded border border-border bg-transparent p-0.5" />
              <input type="range" min={0} max={100} aria-label={`${c.name} opacity`}
                value={Math.round((parseInt((String(mdAttrs[c.name] ?? '#000000ff')).slice(7) || 'ff', 16) / 255) * 100)}
                onChange={(e) => {
                  const a = Math.round((Number(e.target.value) / 100) * 255).toString(16).padStart(2, '0')
                  onChange(c.name, (String(mdAttrs[c.name] ?? '#000000ff')).slice(0, 7) + a)
                }}
                className="flex-1" />
            </div>
          ) : (
```

- [ ] **Step 7: Run admin tests — PASS** (after Task 3 contract exists; otherwise run the non-hero BlockInspector cases now and the gated one with Task 3).
Run: `cd apps/admin && pnpm vitest run test/BlockInspector.test.tsx`

- [ ] **Step 8: Commit.**
```bash
git add packages/core/src/config/types.ts packages/core/src/blocks/resolve-controls.ts packages/core/test/resolve-controls.test.ts apps/admin/src/editor/BlockInspector.tsx apps/admin/test/BlockInspector.test.tsx
git commit -m "feat(blocks): color inspector control + showWhen conditional fields"
```

---

### Task 3: Hero contract — layout / textPosition / overlayColor / parallax

**Files:**
- Modify: `packages/core/src/blocks/standard/hero.ts`
- Test: `packages/core/test/hero-block.test.ts` (extend)

**Interfaces:**
- Consumes: `BlockControl` incl. `color` + `showWhen` (Task 2).
- Produces: hero contract props `headline, subhead?, image?, ctaLabel?, ctaHref?, layout, textPosition, overlayColor?, parallax`; renderer specifier unchanged (`@setu/blocks/hero.astro`).

- [ ] **Step 1: Failing test.** Update `hero-block.test.ts` to assert the new shape:
```ts
it('hero contract has layout, textPosition, overlay + parallax with conditional fields', () => {
  const hero = STANDARD_BLOCKS.find((b) => b.tag === 'hero')!
  const ed = hero.contract.editor!
  expect(ed.controls!.layout).toBe('select')
  expect(ed.controls!.overlayColor).toBe('color')
  expect(ed.controls!.parallax).toBe('switch')
  expect(ed.showWhen!.overlayColor).toEqual({ layout: 'background' })
  expect(ed.showWhen!.parallax).toEqual({ layout: 'background' })
})
```
(Keep the existing round-trip test; update any assertion that referenced the old `variant`.)

- [ ] **Step 2: Run it — FAIL.**
Run: `cd packages/core && pnpm vitest run test/hero-block.test.ts`

- [ ] **Step 3: Rewrite the contract.** `packages/core/src/blocks/standard/hero.ts`:
```ts
import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

const POSITIONS = [
  'top-left','top-center','top-right',
  'middle-left','center','middle-right',
  'bottom-left','bottom-center','bottom-right',
] as const

export const heroBlock: StandardBlock = {
  tag: 'hero',
  renderer: '@setu/blocks/hero.astro',
  contract: defineBlock({
    props: z.object({
      headline: z.string(),
      subhead: z.string().optional(),
      image: z.string().optional(),
      ctaLabel: z.string().optional(),
      ctaHref: z.string().optional(),
      layout: z.enum(['centered', 'split-left', 'split-right', 'background']).default('centered'),
      textPosition: z.enum(POSITIONS).default('center'),
      overlayColor: z.string().optional(),
      parallax: z.boolean().default(false),
    }),
    editor: {
      label: 'Hero', icon: 'hero', group: 'marketing',
      keywords: ['hero', 'banner', 'cta', 'header'],
      controls: {
        headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url',
        layout: 'select', textPosition: 'select', overlayColor: 'color', parallax: 'switch',
      },
      showWhen: { overlayColor: { layout: 'background' }, parallax: { layout: 'background' } },
    },
  }),
}
```

- [ ] **Step 4: Run — PASS.**
Run: `cd packages/core && pnpm vitest run test/hero-block.test.ts`

- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/blocks/standard/hero.ts packages/core/test/hero-block.test.ts
git commit -m "feat(core): hero contract — layout, textPosition, overlayColor, parallax"
```

---

### Task 4: Hero site renderer — archetypes + 9-point + overlay + responsive `<Image>`

**Files:**
- Rewrite: `packages/blocks/src/hero/Hero.astro`
- Rewrite: `packages/blocks/src/hero/hero.css`
- Test: `packages/blocks/test/hero-render.test.ts` (new — assert markup per layout)

**Interfaces:**
- Consumes: `@setu/image-astro/Image.astro` (Task 1); hero props (Task 3).
- Produces: `<section class="blk-hero layout-{layout} pos-{textPosition}">` with a responsive `<Image>` for the hero image; overlay scrim styled from `overlayColor`.

- [ ] **Step 1: Failing render test.** `packages/blocks/test/hero-render.test.ts` — render the Astro component via Astro's container API OR assert on a small pure helper. Since Astro-component unit rendering is heavy, extract a pure `heroClasses(layout, textPosition)` helper in `hero.astro`'s frontmatter into `packages/blocks/src/hero/hero-classes.ts` and test THAT:
```ts
import { heroClasses, sizesForLayout } from '../src/hero/hero-classes'
it('maps layout + position to classes', () => {
  expect(heroClasses('background', 'bottom-left')).toBe('blk-hero layout-background pos-bottom-left')
})
it('picks responsive sizes per layout', () => {
  expect(sizesForLayout('background')).toBe('100vw')
  expect(sizesForLayout('split-left')).toBe('(min-width: 768px) 50vw, 100vw')
})
```

- [ ] **Step 2: Run — FAIL** (module missing).
Run: `cd packages/blocks && pnpm vitest run test/hero-render.test.ts`

- [ ] **Step 3: Create the pure helper.** `packages/blocks/src/hero/hero-classes.ts`:
```ts
export type HeroLayout = 'centered' | 'split-left' | 'split-right' | 'background'
export function heroClasses(layout: HeroLayout, textPosition: string): string {
  return `blk-hero layout-${layout} pos-${textPosition}`
}
export function sizesForLayout(layout: HeroLayout): string {
  if (layout === 'split-left' || layout === 'split-right') return '(min-width: 768px) 50vw, 100vw'
  return '100vw'
}
```

- [ ] **Step 4: Run — PASS.**
Run: `cd packages/blocks && pnpm vitest run test/hero-render.test.ts`

- [ ] **Step 5: Rewrite `Hero.astro`** to use the helper + shared `<Image>` + overlay. Parallax markup is added in Task 5.
```astro
---
import './hero.css'
import Image from '@setu/image-astro/Image.astro'
import { heroClasses, sizesForLayout } from './hero-classes'
const { headline, subhead, image, ctaLabel, ctaHref, layout = 'centered', textPosition = 'center', overlayColor } = Astro.props
const cls = heroClasses(layout, textPosition)
const sizes = sizesForLayout(layout)
const scrimStyle = layout === 'background' ? `--blk-hero-scrim: ${overlayColor ?? 'rgba(15,17,26,0.55)'}` : undefined
---
<section class={cls} style={scrimStyle}>
  {image && (
    <div class="blk-hero-media">
      <Image src={image} alt="" sizes={sizes} />
    </div>
  )}
  <div class="blk-hero-text">
    <h2 class="blk-hero-headline">{headline}</h2>
    {subhead && <p class="blk-hero-subhead">{subhead}</p>}
    {ctaLabel && ctaHref && <a class="blk-hero-cta" href={ctaHref}>{ctaLabel}</a>}
  </div>
</section>
```

- [ ] **Step 6: Rewrite `hero.css`** with the 4 archetypes (grid/flex), 9-point mapping, overlay scrim, fluid type, and mobile reflow. Key rules:
```css
.blk-hero { display: grid; gap: clamp(1rem, 3vw, 2rem); padding: clamp(2rem, 6vw, 4rem); border-radius: var(--r-md, 8px); }
.blk-hero-headline { margin: 0; font-size: clamp(1.75rem, 4vw, 2.75rem); line-height: 1.1; font-weight: 700; }
.blk-hero-subhead { margin: .5rem 0 0; font-size: 1.125rem; opacity: .85; max-width: 42rem; }
.blk-hero-cta { display: inline-block; margin-top: 1rem; padding: .6rem 1.2rem; border-radius: var(--r-md, 8px); background: var(--accent, #4f46e5); color: var(--on-accent, #fff); font-weight: 600; }
.blk-hero-media :global(img) { width: 100%; height: 100%; object-fit: cover; border-radius: var(--r-md, 8px); display: block; }

.blk-hero.layout-centered { justify-items: center; text-align: center; }
.blk-hero.layout-split-left, .blk-hero.layout-split-right { grid-template-columns: 1fr 1fr; align-items: center; }
.blk-hero.layout-split-right .blk-hero-media { order: -1; }

.blk-hero.layout-background { position: relative; align-content: center; min-height: clamp(320px, 50vh, 560px); }
.blk-hero.layout-background .blk-hero-media { position: absolute; inset: 0; }
.blk-hero.layout-background .blk-hero-media :global(img) { border-radius: var(--r-md, 8px); }
.blk-hero.layout-background .blk-hero-text { position: relative; background: var(--blk-hero-scrim); color: #fff; padding: 1.25rem 1.5rem; border-radius: var(--r-md, 8px); max-width: 36rem; width: max-content; }
.blk-hero.layout-background.pos-top-left { justify-items: start; align-content: start; }
/* …emit the 9 pos-* combinations (justify-items: start|center|end × align-content: start|center|end) … */

@media (max-width: 767px) {
  .blk-hero.layout-split-left, .blk-hero.layout-split-right { grid-template-columns: 1fr; }
  .blk-hero.layout-split-right .blk-hero-media { order: 0; }
  .blk-hero.layout-background { min-height: 0; }
  .blk-hero.layout-background .blk-hero-media { position: static; }
  .blk-hero.layout-background .blk-hero-text { background: transparent; color: inherit; padding: 1rem 0 0; }
}
```
(Emit all nine `pos-*` rules — `top/middle/bottom` → `align-content: start|center|end`, `left/center/right` → `justify-items: start|center|end`.)

- [ ] **Step 7: Gate the package + site build with a hero.**
```bash
cd packages/blocks && pnpm vitest run test/hero-render.test.ts && pnpm typecheck
```
Expected: PASS. (Full live render verified in Task 7 UAT.)

- [ ] **Step 8: Commit.**
```bash
git add packages/blocks/src/hero
git commit -m "feat(blocks): hero renderer — archetypes, 9-point, overlay, responsive Image"
```

---

### Task 5: Parallax island (background layout, opt-in, a11y-safe)

**Files:**
- Modify: `packages/blocks/src/hero/Hero.astro` (conditional script island)
- Modify: `packages/blocks/src/hero/hero.css` (parallax transform hook)

**Interfaces:**
- Consumes: hero `parallax` prop (Task 3); the `background` layout markup (Task 4).

- [ ] **Step 1: Add the opt-in island to `Hero.astro`.** Only when `parallax && layout === 'background'`, add a `data-parallax` marker + an inline module script (Astro bundles it as an island):
```astro
---
const parallaxOn = Boolean(Astro.props.parallax) && layout === 'background'
---
<section class={cls} style={scrimStyle} data-parallax={parallaxOn ? '' : undefined}>
  ...
</section>
{parallaxOn && (
  <script>
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = matchMedia('(pointer: coarse)').matches
    if (!reduce && !coarse) {
      for (const el of document.querySelectorAll('[data-parallax] .blk-hero-media img')) {
        const host = el.closest('[data-parallax]')
        const onScroll = () => {
          const r = host.getBoundingClientRect()
          const offset = Math.max(-40, Math.min(40, (r.top / innerHeight) * -40))
          el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0) scale(1.12)`
        }
        addEventListener('scroll', onScroll, { passive: true })
        onScroll()
      }
    }
  </script>
)}
```

- [ ] **Step 2: CSS hook** — ensure the parallax image can move without clipping. In `hero.css`:
```css
.blk-hero.layout-background[data-parallax] { overflow: hidden; }
.blk-hero.layout-background[data-parallax] .blk-hero-media img { will-change: transform; transition: transform .05s linear; }
@media (prefers-reduced-motion: reduce) { .blk-hero.layout-background[data-parallax] .blk-hero-media img { transform: none !important; } }
```

- [ ] **Step 3: Typecheck + site build with a parallax hero.**
```bash
cd packages/blocks && pnpm typecheck
cd /Users/mayank/Documents/projects/setu && pnpm --filter @setu/site build
```
Expected: build succeeds; a `background`+`parallax` hero emits the island script; non-parallax heroes emit no script (verify in built HTML).

- [ ] **Step 4: Commit.**
```bash
git add packages/blocks/src/hero
git commit -m "feat(blocks): opt-in hero parallax island (reduced-motion + touch safe)"
```

---

### Task 6: Hero canvas core (`Hero.tsx`) — match archetypes/position/overlay

**Files:**
- Rewrite: `packages/blocks/src/hero/Hero.tsx`
- Modify: `apps/admin/src/editor/extensions/HeroBlock.tsx` (pass the new props)
- Test: `apps/admin/test/hero-block-node.test.tsx` (update assertions for layout classes)

**Interfaces:**
- Consumes: `heroClasses`/`sizesForLayout` (Task 4); hero props (Task 3); `resolveMediaSrc` (admin).
- Produces: `Hero` core renders the same `blk-hero layout-* pos-*` structure read-only; uses a single resolved `<img>` (no build manifest in the editor — true responsive output verified via Preview/site).

- [ ] **Step 1: Update the node test** to assert the layout class:
```tsx
it('renders the hero with its layout + headline', () => {
  // mount a heroBlock with attrs { headline:'Hi', layout:'background', textPosition:'bottom-left' }
  expect(document.querySelector('.blk-hero.layout-background.pos-bottom-left')).toBeTruthy()
  expect(document.body.textContent).toContain('Hi')
})
```
(Adapt to the file's existing mount harness; keep `.blk-hero` assertion.)

- [ ] **Step 2: Run — FAIL** (current Hero.tsx uses `variant-*`).
Run: `cd apps/admin && pnpm vitest run test/hero-block-node.test.tsx`

- [ ] **Step 3: Rewrite `Hero.tsx`** to mirror `Hero.astro`'s structure (sans Astro `<Image>` — the editor passes an already-resolved src):
```tsx
import './hero.css'
import { heroClasses, type HeroLayout } from './hero-classes'

export interface HeroProps {
  headline: string; subhead?: string; image?: string
  ctaLabel?: string; ctaHref?: string
  layout?: HeroLayout; textPosition?: string; overlayColor?: string
}

export function Hero({ headline, subhead, image, ctaLabel, ctaHref, layout = 'centered', textPosition = 'center', overlayColor }: HeroProps) {
  const style = layout === 'background' ? ({ ['--blk-hero-scrim' as string]: overlayColor ?? 'rgba(15,17,26,0.55)' }) : undefined
  return (
    <section className={heroClasses(layout, textPosition)} style={style}>
      {image ? <div className="blk-hero-media"><img src={image} alt="" /></div> : null}
      <div className="blk-hero-text">
        <h2 className="blk-hero-headline">{headline}</h2>
        {subhead ? <p className="blk-hero-subhead">{subhead}</p> : null}
        {ctaLabel && ctaHref ? <span className="blk-hero-cta">{ctaLabel}</span> : null}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Update `HeroBlock.tsx`** to pass the new props from `mdAttrs` (layout/textPosition/overlayColor in addition to the existing ones); keep the `resolveMediaSrc(image, apiBase)` resolution.

- [ ] **Step 5: Run admin hero + inspector tests — PASS.**
Run: `cd apps/admin && pnpm vitest run test/hero-block-node.test.tsx test/BlockInspector.test.tsx`

- [ ] **Step 6: Commit.**
```bash
git add packages/blocks/src/hero/Hero.tsx apps/admin/src/editor/extensions/HeroBlock.tsx apps/admin/test/hero-block-node.test.tsx
git commit -m "feat(blocks): hero canvas core matches archetypes/position/overlay"
```

---

### Task 7: Gate + clean-server live UAT

- [ ] **Step 1: Regenerate the block manifest + full gate.**
```bash
node scripts/gen-blocks.mjs   # confirms hero present
pnpm typecheck && pnpm test && pnpm --filter @setu/admin build && pnpm --filter @setu/site build
```
Expected: all green; `@setu/image-astro` tests pass; hero contract/render/canvas tests pass.

- [ ] **Step 2: Clean-server live UAT** (the done bar). Kill any stale `astro dev` daemon (`cd apps/site && pnpm exec astro dev stop`) and stray `vite`/`pnpm dev` first, then `pnpm dev` from the main checkout. Verify:
  - Editor: insert hero; the inspector shows headline/subhead/image/CTA label/CTA **url**/layout/textPosition; switching layout to `background` reveals **overlayColor** (color + alpha) and **parallax**; they hide on `centered`/`split-*`. Canvas reflects layout + position live.
  - Pick an image → it shows in the canvas; Preview pane + site (`:4321`) render it via `<Image>` with `srcset` (DevTools: a smaller variant on a narrow viewport).
  - Each archetype lays out correctly; `background` overlay sits at the chosen 9-point; overlay color + alpha visible; mobile reflow correct (split → stacked; background → text-below).
  - Parallax: on `background`+parallax, image parallaxes on scroll desktop; with `prefers-reduced-motion` on (or touch) → no motion.
  - Light + dark.

## Self-Review

- **Spec coverage:** shared image pkg (T1) ✓; `color` control + `showWhen` (T2) ✓; contract layout/textPosition/overlayColor/parallax (T3) ✓; renderer archetypes/9-point/overlay/responsive `<Image>`/per-layout sizes (T4) ✓; parallax island reduced-motion+touch (T5) ✓; canvas core (T6) ✓; CTA url present (T3 controls) ✓; conditional fields (T2+T3) ✓; gate + clean UAT (T7) ✓.
- **Placeholder scan:** the only "…" is the explicit instruction to emit all nine `pos-*` CSS rules (the pattern is fully specified) — not a TODO.
- **Type consistency:** `heroClasses`/`sizesForLayout`/`HeroLayout` identical across T4/T6; `BlockControl` incl. `color` + `showWhen` consistent T2↔T3↔inspector; `@setu/image-astro` exports (`Image.astro`, `resolveMediaBase`, `imageMarkup`, `manifestKeyFromSrc`, `loadManifest`, `sizesForAlign`) consistent T1↔consumers; hero prop set identical across contract (T3), renderer (T4), canvas (T6).

## Note on Task 2/3 ordering
The `showWhen`/color admin test asserts against the hero contract (T3). If executing strictly task-by-task, either (a) land T2's code and defer its hero-dependent assertion to run after T3, or (b) the controller bundles T2+T3 into one reviewable unit. The implementer should be told which.
