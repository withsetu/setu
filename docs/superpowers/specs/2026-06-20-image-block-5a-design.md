# Rich image block — media slice #5a (the figure render)

**Date:** 2026-06-20
**Status:** approved (owner approved the #5 design + 5a/5b split; trust-as-approval per working style)
**Sub-project:** Media/Images **#5a** — introduces the `{% image %}` **block tag** that renders a
responsive `<figure>` with `<figcaption>` and **alignment**, computing a per-alignment `sizes` so the
right variant is pulled from the srcset ladder generated in #4b. This is the headless, render-only half
of #5; the editor UX (a dedicated `imageBlock` node, block-as-default-on-upload) is **#5b**.

## Why a block (not an enrichment of today's inline image)

Today an image is an **inline** Tiptap node serialized as `![alt](src)` — fine for an image inside a
sentence, but it cannot carry a caption or a float. A Gutenberg-class image is **block-level**: it owns a
`<figure>`, an optional `<figcaption>`, and an **alignment** (`left/right/wide/full`). So #5 adds a
distinct `{% image %}` block tag; the inline `![]()` stays for images-in-text. This mirrors the existing
`{% callout %}` pattern.

## The decision that shapes this slice (verified against the code)

The editor round-trip preserves any tag **not** in `knownBlockTags` as a verbatim `passthrough` node
([`to-tiptap.ts:180-205`](../../../packages/core/src/markdoc/to-tiptap.ts)); `knownBlockTags` is injected
from the **auto-discovered `blocks/` registry**. Therefore, creating a `blocks/image/` folder in #5a
would make `image` "known" → the editor would treat it as a generic `setuBlock`, whose schema is
`content: 'block+'`, **forcing an empty paragraph body onto a bodyless `{% image /%}` tag** and
serializing a spurious body. That is a real content-shape bug for an attributes-only tag, and the
dedicated bodyless editor node that fixes it is #5b's job.

**So #5a is render-only and does NOT create a folder block.** It registers `image` as an **explicit
render tag** in `markdoc.config.mjs` (the render path is independent of `knownBlockTags`), and leaves the
editor's handling as **passthrough** — `{% image %}` is preserved byte-exact, just not yet editable. A
round-trip test proves the safety. The `blocks/image/` folder, the Zod contract, and the dedicated editor
node all land in **#5b**.

This is a deliberate refinement of the originally-described "5a = the folder block": checking the live
code showed the folder route is actively buggy for a bodyless tag before the dedicated node exists. The
product decisions are unchanged (string caption; `none|left|right|wide|full`; block-as-default in #5b).

## Decisions (settled in brainstorm)

- **Caption = a plain `string` attribute** (`caption="…"`). Structurally Gutenberg-equivalent
  (`figure` + `figcaption`). Rich inline captions (bold/links inside the caption) are a noted follow-up,
  not #5a.
- **Alignment = `align ∈ { none, left, right, wide, full }`, default `none`.** Matches Gutenberg 1:1.
  `none` = normal in-flow (centered in the content column); `left`/`right` = float at ~half column width
  (un-floated on narrow screens); `wide` = breaks out to the page width; `full` = full-bleed `100vw`.
- **Per-alignment `sizes`** is computed by a pure `sizesForAlign(align)`, anchored to the theme tokens
  `--measure-post: 38rem` (≈608px content column) and `--measure-page: 64rem` (≈1024px page):
  - `none`  → `min(100vw, 608px)`
  - `wide`  → `min(100vw, 1024px)`
  - `full`  → `100vw`
  - `left` / `right` → `(max-width: 608px) 100vw, 304px` (≈ half the column; full width on narrow)
  These track the current theme; truly theme-reactive `sizes` is a later refinement (noted out-of-scope).
- **Maximal reuse of #4c.** The figure component wraps the existing `Image.astro` (which already does
  manifest load → `srcset` → intrinsic `width`/`height`, and already accepts a `sizes` prop). #5a adds
  only the `<figure>`/`<figcaption>`/`align` wrapper + the computed `sizes`. No duplication of manifest
  loading.
- **`nodes.image` (markdown `![]()`) and `tags.image` (`{% image %}`) coexist** — Markdoc keeps node and
  tag namespaces separate, so adding `tags.image` does not collide with the existing inline image node.

## Verified before designing (standing rules)

- **Rule #1 (read the source):**
  - `Image.astro` (#3/#4c) resolves `/uploads/…` against `PUBLIC_SETU_MEDIA`, loads a manifest from
    `SETU_MEDIA_DIR`, emits `<img src srcset sizes width height loading decoding>`, and **already takes a
    `sizes` prop** (default `'100vw'`). The figure reuses it verbatim.
  - The round-trip preserves unknown tags as `passthrough` and `knownBlockTags` is registry-driven
    (`to-tiptap.ts:177-213`). The render path (`markdoc.config.mjs` `tags`/`nodes`) is separate from the
    editor's `knownBlockTags`.
  - `markdoc.config.mjs` already registers explicit render tags (`sub`, `sup`) alongside the auto-generated
    block tags — the explicit-tag route for `image` is an established pattern.
  - Theme content widths come from `packages/theme-default/theme.css` (`--measure-post: 38rem`,
    `--measure-page: 64rem`); prose styles + the `.measure-post` wrapper live in
    `packages/theme-default/site.css`. Alignment CSS belongs there.
- **Rule #2 (Cloudflare + cost):** the figure reads the manifest at **build** (via the reused `Image.astro`)
  and emits **static** `<figure><img srcset></figure>` — **zero per-visitor cost**, no runtime image
  service. `sizesForAlign` is a pure string function. Nothing new touches the edge runtime.

## Architecture — four units

### 1. `apps/site/src/lib/image-align.ts` — pure per-alignment `sizes` (new)
```ts
export type ImageAlign = 'none' | 'left' | 'right' | 'wide' | 'full'

/** The content column (--measure-post) and page width (--measure-page) in px, mirroring
 *  packages/theme-default/theme.css. Kept here so `sizes` tracks the default theme. */
const CONTENT_PX = 608  // 38rem
const PAGE_PX = 1024    // 64rem

/** Browser-`sizes` hint for an image at the given alignment, so the srcset picks the right variant.
 *  Unknown/empty align is treated as 'none'. */
export function sizesForAlign(align: ImageAlign | string | undefined): string {
  switch (align) {
    case 'full': return '100vw'
    case 'wide': return `min(100vw, ${PAGE_PX}px)`
    case 'left':
    case 'right': return `(max-width: ${CONTENT_PX}px) 100vw, ${Math.round(CONTENT_PX / 2)}px`
    case 'none':
    default: return `min(100vw, ${CONTENT_PX}px)`
  }
}
```

### 2. `apps/site/src/components/ImageFigure.astro` — the figure wrapper (new)
```astro
---
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
- Reuses `Image.astro` for all responsive/manifest logic; adds only the figure/caption/align wrapper and
  the computed `sizes`. `title` is intentionally not surfaced on the block (caption supersedes it).
- A missing/empty `src` still renders a `<figure>` with `Image.astro`'s own graceful fallback (#4c) — never
  a build failure.

### 3. `apps/site/markdoc.config.mjs` — register the `image` tag (modify)
Add to the `tags` map (alongside `sub`/`sup`, after the spread of generated block tags):
```js
image: {
  render: component('./src/components/ImageFigure.astro'),
  attributes: {
    src: { type: String },
    alt: { type: String },
    caption: { type: String },
    align: { type: String, matches: ['none', 'left', 'right', 'wide', 'full'], default: 'none' },
  },
},
```
The existing `nodes.image → Image.astro` mapping (inline `![]()`) is left untouched.

### 4. `packages/theme-default/site.css` — alignment + figure styling (modify, additive)
Append a media block (uses existing tokens `--measure-page`, `--r-md`, `--text-2`, `--border`):
```css
/* {% image %} figure block (media #5a) */
.prose figure.setu-image { margin: 1.75rem 0; }
.prose figure.setu-image img { display: block; max-width: 100%; height: auto; border-radius: var(--r-md); }
.prose figure.setu-image figcaption { margin-top: .5rem; font-size: .9rem; color: var(--text-2); text-align: center; }

/* wide: break out of the 38rem column toward the 64rem page width, stay centered */
.prose figure.setu-image.align-wide { max-width: var(--measure-page); margin-left: 50%; transform: translateX(-50%); }
/* full: full-bleed edge to edge */
.prose figure.setu-image.align-full { width: 100vw; margin-left: 50%; transform: translateX(-50%); }
.prose figure.setu-image.align-full img { border-radius: 0; }
/* left / right: float at ~half column width */
.prose figure.setu-image.align-left  { float: left;  max-width: 50%; margin: .3rem 1.25rem 1rem 0; }
.prose figure.setu-image.align-right { float: right; max-width: 50%; margin: .3rem 0 1rem 1.25rem; }
@media (max-width: 38rem) {
  .prose figure.setu-image.align-left,
  .prose figure.setu-image.align-right { float: none; max-width: 100%; margin: 1.75rem 0; }
}
```

## Data flow
```
content {% image src="/uploads/media/<id>/original.png" alt="…" caption="…" align="wide" /%}
  → markdoc.config tags.image → ImageFigure.astro(props: src, alt, caption, align)
  → sizes = sizesForAlign(align)            (e.g. wide → "min(100vw, 1024px)")
  → <figure class="setu-image align-wide">
       <Image src alt sizes/>  →  (#4c) manifest? <img srcset="…w400 400w,…" sizes width height> : plain <img>
       <figcaption>…</figcaption>
     </figure>

editor: {% image … /%} is NOT in knownBlockTags → passthrough node → serialized back byte-exact (#5b makes it editable)
```

## Error handling / content safety
- `sizesForAlign` total over `string` — any unknown/empty `align` falls to the `none` hint; never throws.
- Missing `src`/`alt`/`caption` → `ImageFigure` renders what it has; `Image.astro`'s #4c fallback covers a
  missing manifest or external src (plain `<img>`, never broken).
- `{% image %}` survives a full editor round-trip unchanged (passthrough) — proven by a core test.
- `caption` is interpolated as text in `figcaption` → Astro auto-escapes (no injection).

## Testing
- **`image-align` (pure unit, `apps/site`):** `sizesForAlign` returns the exact hint for each of
  `none`/`left`/`right`/`wide`/`full`, and falls back to the `none` hint for `undefined` and an unknown
  string.
- **Round-trip preservation (core, `packages/core/test`):** with an **empty** `knownBlockTags`,
  `markdocToTiptap('{% image src="/uploads/media/x/original.png" alt="a" caption="c" align="wide" /%}')`
  yields a single `passthrough` node, and `tiptapToMarkdoc` of that doc returns the **identical** source.
  (Locks in that #5a does not change content shape and that a bodyless image tag never gains a body.)
- **End-to-end build (`apps/site/test/render.test.ts`):** add an `{% image %}` referencing the existing
  `test`-id manifest fixture (3 webp variants, original 1000×600) with `align="wide"` + a caption to the
  kitchen-sink content; assert the built HTML contains
  `<figure class="setu-image align-wide">`, an `<img …srcset="…/uploads/media/test/w400.webp 400w…"
  sizes="min(100vw, 1024px)" width="1000" height="600">`, and `<figcaption>…</figcaption>`. The inline
  `![]()`/external-image assertions from #4c stay green.
- Full repo green + typecheck.

## Out of scope (later slices — roadmap)
- **#5b:** the `blocks/image/` folder block (Zod contract) + a dedicated bodyless `imageBlock` Tiptap node
  (preview, alt, inline caption, alignment toolbar), adding `image` to `knownBlockTags`, and switching the
  upload/insert flow so dropping an image creates the `{% image %}` block by default.
- Rich inline captions (formatting inside the caption); explicit display-width / drag-resize; focal point
  (#4d); per-image quality/format (#4e); theme-reactive `sizes` (reading the active theme's measures);
  `<picture>`/multi-format (we chose single-format in #4b).

## Success criteria
A built page renders `{% image src=… alt=… caption=… align="wide" /%}` as
`<figure class="setu-image align-wide"><img srcset="…" sizes="min(100vw, 1024px)" width=… height=…
…><figcaption>…</figcaption></figure>`, with the variant ladder and intrinsic dims coming from the #4b
manifest and the plain-`<img>` fallback intact for manifest-less images; and `{% image %}` round-trips
through the editor byte-exact (passthrough) with no body forced onto it. All tests green + typecheck.
