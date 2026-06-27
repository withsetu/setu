# Hero done right — theme-grade renderer + shared responsive image + layout/position model

Status: approved approach, ready for plan
Date: 2026-06-27
Second piece of the block-library catalogue phase (after the inspector wave, [[setu-block-library]]).
Supersedes the **minimal hero renderer** from the inspector branch (`block-inspector-hero`,
c36cf02) — that hero was a validation stub that exposed two real gaps: its image never rendered on
the site, and its layout was a plain centered box. This makes hero a real, responsive, configurable
marketing block and establishes the **media-bearing block renderer** pattern every future block
reuses. Wedge framing per [[setu-js-stance]]: the hard filter is portability/round-trip-to-Git, not
JS volume; JS islands are fine; this block is static + responsive.

## Goal

1. Extract the site's **responsive-image render pipeline** into a shared package so any block
   renderer (not just `apps/site`) can emit `srcset`-driven responsive images.
2. Rebuild the **hero renderer** (`@setu/blocks`) on that shared pipeline with a curated set of
   **layout archetypes** + a **9-point text-position** model — fully responsive (smaller screens get
   smaller image variants and a sensible reflow).
3. Extend the **hero contract** with the new props; the existing block **inspector** renders them
   automatically.

## Current state / why this is needed

- **Two renderer tiers only** (`packages/core/src/blocks/merge-sources.ts`): core-standard
  (`@setu/blocks/<tag>.astro`) and site-local (`blocks/<tag>/`, wins on collision). No theme tier
  (Foundation B deferral). The theme tier is **not** what blocks hero.
- **The responsive-image pipeline is app-internal**: `apps/site/src/components/{Image,ImageFigure}.astro`
  + `apps/site/src/lib/{image-markup,media-base,media-manifest,image-align}.ts`. Neither `@setu/blocks`
  nor a theme can import app-internal code, so the current `Hero.astro` emits a dumb `<img src={image}>`
  with no media-base resolution and no `srcset` → **picked images don't load on the site** (the reported
  bug), and there's no responsive variant selection. Importers of the pipeline today: `Image.astro`
  itself, `apps/site/src/pages/[...path].astro`, `apps/site/src/preview/preview.astro`.
- Existing image packages are build-time generation only (`@setu/image-sharp`, `@setu/image-testing`);
  the *render-time* component is the missing shared piece.

## Architecture

### A. Shared responsive-image package (`@setu/image-astro`)
Lift the render-time pipeline out of `apps/site` into a new package that ships `.astro` components
(like `@setu/blocks` already does):
- Move `Image.astro`, `ImageFigure.astro`, and `image-markup.ts` / `media-base.ts` /
  `media-manifest.ts` / `image-align.ts` into `@setu/image-astro`.
- `apps/site` consumes them from the package (repoint the 3 importers) — **visually inert** for the
  site (identical output).
- The manifest lookup stays **env-driven** (`SETU_MEDIA_DIR` / `PUBLIC_SETU_MEDIA` via
  `resolveMediaBase`) so the component works in both the site build and any block-render context.
- `@setu/blocks` adds `@setu/image-astro` as a dependency so block renderers can use `<Image>`.

This package is the reusable foundation for **every** future media-bearing block (gallery, video
poster, card images), not just hero.

### B. Hero renderer (`@setu/blocks/hero.astro`) — rebuilt
Stays a core-standard renderer (consistent with `button`). Uses `@setu/image-astro`'s `<Image>` for
the hero image → real `srcset` + per-layout `sizes`. Implements the 4 archetypes + 9-point position
(see Layout model). The **per-theme override resolver remains deferred** — no theme tier added now
(YAGNI until a second theme needs different hero markup).

### C. Hero contract (`@setu/core` `STANDARD_BLOCKS`, `blocks/standard/hero.ts`)
```ts
props: z.object({
  headline: z.string(),
  subhead: z.string().optional(),
  image: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  layout: z.enum(['centered', 'split-left', 'split-right', 'background']).default('centered'),
  textPosition: z.enum([
    'top-left','top-center','top-right',
    'middle-left','center','middle-right',
    'bottom-left','bottom-center','bottom-right',
  ]).default('center'),
}),
editor: { label: 'Hero', icon: 'hero', group: 'marketing',
  keywords: ['hero','banner','cta','header'],
  controls: { headline:'text', subhead:'textarea', image:'media', ctaLabel:'text', ctaHref:'url', layout:'select', textPosition:'select' } },
```
(Replaces the current `variant: ['left','center']`.) Markdoc round-trip unchanged in shape (self-
closing `{% hero ... /%}`); only the attribute set grows.

### D. Inspector (admin) — auto
`layout` + `textPosition` are enums → the existing `BlockInspector` renders them as `Select`s with no
new code (the substrate from the inspector wave). No admin change required beyond the contract.
(Optional later polish: hide `textPosition` for layouts where it's irrelevant — deferred; for now it
always shows and the renderer interprets it.)

### E. Editor canvas (`@setu/blocks/Hero.tsx`) — updated
The canvas preview core mirrors the archetype/position layout so the editor stays WYSIWYG-ish. It
resolves the image via the editor's `resolveMediaSrc` (single image — the build manifest/`srcset`
isn't available in the live editor; true responsive output is verified via the Preview pane / site,
which is the accurate preview). Shares the hero CSS with `Hero.astro`.

## Layout model (settled in brainstorm)

Four archetypes; `textPosition` (9-point) interpreted per layout; all reflow responsively.

| layout | desktop | `textPosition` means | mobile reflow |
|---|---|---|---|
| `centered` | centered text, optional image above | vertical placement of text vs image (top/middle/bottom) | unchanged (already narrow) |
| `split-left` | text column left, image right | vertical align of the text column (top/middle/bottom) | stack: text then image |
| `split-right` | image left, text column right | vertical align of the text column | stack: text then image |
| `background` | image fills hero, text overlaid | **overlay position** (all 9 points) | text drops *below* the image (overlaying text on a tall phone image is unreadable) |

- **Responsive `sizes`** per layout so the browser picks the right variant: `background` → `100vw`;
  `split-*` → `(min-width: 768px) 50vw, 100vw`; `centered` image → `100vw` (tune in UAT).
- **Fluid type** via `clamp()`. Positions map to CSS `align-items`/`justify-items` (grid) — no
  absolute coordinates. Free X/Y is **out of scope** (parked; would require per-breakpoint coords).

## Data flow / round-trip

Inspector edit → `mdAttrs` → autosave → `{% hero layout="..." textPosition="..." ... /%}` in Git →
site build parses → `@setu/blocks/hero.astro` renders via `@setu/image-astro <Image>` → responsive
`<picture>`/`<img srcset sizes>`. No new transport; `mdAttrs` is the same JSON bag.

## Testing & verification

- **`@setu/image-astro` extraction:** site image output is byte-identical before/after (the move is
  inert) — existing site image tests pass from the new location; `apps/site` build renders images +
  `srcset` as before.
- **Hero contract:** `STANDARD_BLOCKS` has the new props + control hints; `{% hero %}` round-trips
  with `layout`/`textPosition` (core round-trip test, extends the inspector-wave hero test).
- **Hero renderer:** snapshot/markup test per archetype (correct classes + `<Image>` with the right
  `sizes`); image with a `/media/...` src resolves through `resolveMediaBase` (no raw unresolved src).
- **Live UAT (the done bar):** in the editor, insert hero, switch layout + textPosition in the
  inspector, pick an image → canvas updates; **Preview pane + site (`:4321`)** show the image
  rendering with `srcset` (DevTools: smaller variant on a narrow viewport), each archetype laid out
  correctly, light + dark, mobile reflow correct. Run on a CLEAN dev server (per
  [[setu-editor-live-smoke-test]] — stale daemons/branch-switches caused phantom failures last round).
- Full gate `pnpm typecheck && pnpm test && build` green.

## Decomposition (for the plan)

1. **Extract `@setu/image-astro`** (move render pipeline; repoint `apps/site`; inert) — foundation.
2. **Hero contract** update in `@setu/core` (layout + textPosition + control hints) + round-trip test.
3. **Hero renderer** `@setu/blocks/hero.astro` rebuilt (4 archetypes + 9-point + shared `<Image>` +
   per-layout `sizes` + responsive CSS).
4. **Hero canvas core** `Hero.tsx` updated to the archetype/position layout (shared CSS).
5. **Gate + clean-server live UAT** (editor + Preview + site, responsive).

## Out of scope

Free X/Y positioning (parked); per-theme renderer-override resolver (still deferred); other marketing
blocks (additive later); `theme-default`'s own `RelatedReading` image (uses a plain `<img>` — separate);
making `textPosition` conditional in the inspector.

## Builds on / supersedes

Builds on the inspector wave (`block-inspector-hero`): the contract pipeline, `resolveControls` +
control-hints, and the `BlockInspector`. That branch should land first (the inspector is the validated
win); this work then replaces its stub hero renderer. The editor render-loop fix (c36cf02) is part of
that branch.
