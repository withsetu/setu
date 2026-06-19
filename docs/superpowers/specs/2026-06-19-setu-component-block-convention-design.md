# Component-block model — slice 1: blocks render their real visual in the editor

**Date:** 2026-06-19
**Status:** approved (owner — model settled across an extended brainstorm; trust-as-approval per working style)
**Sub-project:** render/theme **#4**, first slice of the *component-block* model. Supersedes the deferred
HTML/Liquid template-engine direction (see `setu-component-model` memory).

## The decision this rests on

After a long design conversation the owner settled the block model:

- **One kind of block: a component.** No static-HTML tier, no template engine. A block is a React
  visual + a contract of options. Built in code (devs/AI/theme authors), *used and configured* by
  everyone — the WordPress/Gutenberg reality.
- **A block's visual is a shared React core**, rendered by **both** the editor (a Tiptap node view)
  and the site (an Astro wrapper that SSRs it to static HTML). **Callout already works exactly this
  way** — it's the existence proof. The job is to make *every* block work like callout, and to make
  the editor render that real visual instead of generic chrome.

## Goal (this slice — deliberately minimal)

Re-author **`notice`** as a **React-core block, structurally identical to callout**, so it renders its
**real visual in the editor** (the fix for "notice shows chrome, not the real box") *and* on the site —
by reusing callout's proven pattern, with **no new machinery**. Generalize the editor's generic
`setuBlock` node so it renders a block's **real React core** when one exists (chrome remains only the
fallback for a core-less/unknown tag).

After this slice, `notice` and `callout` are the same shape — a React core in `@setu/blocks` rendered
by editor + site — and the editor mirrors a block's real look as you build.

**Explicitly NOT in this slice** (deferred — see Out of scope): moving blocks *into* the package as
self-contained folders, codegen-*generating* Astro wrappers, deleting repo-root `blocks/`, moving
callout's editor view into the package, islands/interactivity, external-dep blocks, `create-setu`.
Those are the "tidy the home" consolidation — worth doing once the model is proven, not needed to
prove it.

## Verified before designing (standing rules)

- **Rule #1 (read source):** confirmed — `@setu/blocks` holds callout's React core (`Callout.tsx`),
  `callout.css`, and `variants.ts`, exported from `src/index.ts`; both `apps/admin` and `apps/site`
  depend on `@setu/blocks`; `blocks/callout/callout.astro` renders the core via `@astrojs/react` (SSR,
  zero JS); the admin's generic `setuBlock` node view (`SetuBlock.tsx`, Slice B) currently renders
  *chrome*; `blocks/notice/notice.astro` is plain HTML + a scoped `<style>`.
- **Rule #2 (Cloudflare + cost):** unchanged — the core SSRs to **static HTML at build, zero
  per-visitor cost** (exactly as callout does today). No islands/runtime in this slice.

## Architecture — three small changes, all mirroring callout

### 1. `notice`'s visual → a React core in `@setu/blocks`
- Create `packages/blocks/src/notice/Notice.tsx` — a plain React component taking the options as props
  (`tone`, `title`) and rendering its `children` (the body): the markup currently in `notice.astro`.
- Move `notice.astro`'s scoped styles into `packages/blocks/src/notice/notice.css`.
- Export both from `@setu/blocks` (`src/index.ts`), mirroring the callout exports
  (`Callout` + `./callout.css`).

### 2. Both planes render the core (callout's pattern)
- **Site:** `blocks/notice/notice.astro` becomes a thin wrapper —
  `import { Notice } from '@setu/blocks'; import '@setu/blocks/notice.css'` →
  `<Notice {...Astro.props}><slot/></Notice>` (exactly `callout.astro`'s shape). `block.ts`, the
  Markdoc tag, and `gen-blocks` are **unchanged** (notice.astro is still the tag's render target).
- **Editor:** the generic `setuBlock` node view renders the block's **real core** when the registry
  has one for its tag — `<Core {...mdAttrs}><NodeViewContent/></Core>` — plus the existing
  auto-generated options form; it falls back to today's chrome only when no core is registered
  (unknown/core-less tag). This is the same React-core-with-`NodeViewContent`-child pattern callout's
  node view already uses.

### 3. A small tag→core registry the editor reads
- `@setu/blocks` exports a `blockCores: Record<string, ComponentType<any>>` map (`{ notice: Notice }`;
  callout is excluded — it keeps its own bespoke editor node). The admin's `setuBlock` node view looks
  up `blockCores[tag]`; if present, renders the core; else chrome.
- Per-core CSS is imported in the admin so the core looks right in-canvas (as `callout.css` is today).

Callout is **untouched** — it already has its core in `@setu/blocks` and its own bespoke editor node
view (the click-to-edit title). This slice makes `notice` match callout; it does not refactor callout.

## Data flow

```
packages/blocks/src/notice/{Notice.tsx, notice.css}  (the shared React core + styles)
        ├─ site:   blocks/notice/notice.astro → <Notice {...props}><slot/></Notice> → static HTML
        └─ editor: blockCores['notice'] → setuBlock node view renders <Notice {...mdAttrs}><NodeViewContent/></Notice> + options form
round-trip + gen-blocks + markdoc tag: UNCHANGED (notice is still a folder block; notice.astro is still its render target)
```

## Error handling

- A `setuBlock` whose tag has no registered core → node view degrades to the existing chrome (Slice B
  behaviour), never crashes.
- Content-safety unchanged: round-trip byte-stable; unknown tags stay `passthrough`; the tag-less
  `setuBlock` guard (Slice B) stays.

## Testing

- **`@setu/blocks`:** a render test that `<Notice tone="success" title="Hi">body</Notice>` produces
  the expected markup (`notice notice-success`, the title, the body) — the same kind of test callout
  has.
- **admin:** the `setuBlock` node view renders the **real `Notice` core** in-canvas for a `notice`
  block (assert `notice notice-success` appears, not chrome) and the options form still edits
  `mdAttrs`; a core-less tag still falls back to chrome (no crash); existing callout/slash/round-trip
  tests stay green.
- **site:** the kitchen-sink `{% notice %}` still renders (now via the React core) — `notice
  notice-success` + title + body present; the **existing render tests stay green** (callout
  byte-identical, and notice's rendered class output is unchanged from the HTML version).
- **full repo green + typecheck.**

## Out of scope (deferred — recorded in `docs/roadmap.md`)

- **The "home consolidation":** blocks as self-contained folders *inside* the package, codegen
  *generating* the Astro wrappers, deleting repo-root `blocks/`, and moving callout's editor view into
  the package. (This slice keeps the Slice-A structure: `block.ts` + a thin `notice.astro` in repo-root
  `blocks/`, with the *visual* shared from the package — exactly callout's current layout.)
- **Islands / interactivity** (`client:*`) — the carousel's tier.
- **External-dependency blocks** (`motion`, `three`) — the per-block dep escape hatch.
- **`create-setu` end-user packaging**; **per-request dynamic** (Pro/edge); **third-party block
  packages**.

## Success criteria

`notice` renders its **real visual in the editor** (not chrome) and on the site, sharing one React core
from `@setu/blocks` — structurally identical to callout — with **no new machinery** and callout
unchanged. All existing tests stay green.
