# Block Library — Foundation B (Core-Shipped Standard Blocks) — Design Spec

**Status:** Approved design (slimmed scope), ready for implementation
**Date:** 2026-06-22
**Feature ID:** Block Library program, sub-project #1b

## Goal

Make a block ship **with the product** instead of being hand-made per site.
Today every block (callout, notice) is a **site-local** folder under `blocks/`.
For a real block *library*, the standard blocks must live in core so every site
gets them for free. This sub-project establishes that path and ships the first
core block, **`button`**.

Presentation is handled the **same way callout already does it — CSS tokens**
(`var(--accent, …)`), so a theme restyles the block by setting tokens. That
mechanism is already proven; we are not rebuilding it.

## Scope decision (and what we explicitly are NOT building)

An earlier draft of Foundation B proposed a **per-theme renderer-override
resolver** (core default → theme renderer → site-local, chosen independently per
tag). We are **deferring all of that.** Reason: callout already demonstrates
theme-controlled presentation via tokens, and a `button` is an `<a>` — token
theming covers it completely. A full renderer-override seam only earns its keep
for blocks whose **markup structure** differs per theme (hero, pricing,
testimonial — the later marketing wave). Building it now is YAGNI.

This slim scope is a **clean subset** of that future seam: the `@setu/blocks`
renderer we ship here simply becomes the "default" tier if/when overrides are
added later. No wasted work, no dead-end.

**In scope:**
- A standard block contract living in `@setu/core` (`STANDARD_BLOCKS`).
- The first core block, `button` (Shape A: structured props, body = label).
- A single token-themed `.astro` renderer for it in `@setu/blocks`.
- A small pure `mergeBlockSources()` that unions core standard blocks with
  site-local `blocks/` (site-local wins on a tag collision).
- Wiring the two discovery flows that need it: the admin editor registry and the
  site `gen-blocks` codegen.
- Adding `packages/core/src/blocks` to `tsconfig.edge.json` (CI-enforced
  edge-safe contracts).

**Out of scope (named so reviewers don't flag their absence):**
- **Per-theme renderer override / precedence resolver / theme-renderer
  detection** — deferred to the marketing wave, when structural per-theme markup
  is actually needed.
- Theme packages shipping their own block `.astro` files.
- The block inspector (side-panel prop editing); theme-accurate WYSIWYG in the
  editor (the editor uses the existing neutral generic node); width/breakout /
  alignment props; any second core block.

## Architecture decisions inherited (Foundation A ADR)

- **Two block shapes.** `button` is **Shape A** (structured props; its body is
  inline label text, not arbitrary nested blocks).
- **Contract in core.** Honored: the contract lives in `@setu/core`. The
  *renderer* lives in `@setu/blocks` (the existing block-presentation package),
  token-themed — the same place and pattern as callout/notice visuals.

## Global constraints

- **Edge-safe core:** everything under `packages/core/src/blocks` must compile
  under `tsconfig.edge.json` (`types: []`) — pure data, zod, pure functions only.
- **Backward compatible:** existing site-local `blocks/` (callout, notice) keep
  working unchanged; on a tag collision, site-local wins.
- **No packaging changes:** the repo-root `blocks/` directory does not move.
- **Cloudflare-Pages compatible:** all resolution is build-time
  (`gen-blocks`) or admin-build-time (Vite glob); no per-request work.

---

## How a core block differs from a site-local block

| | site-local (callout/notice) | core standard (button) |
|---|---|---|
| Contract (`block.ts`) | `blocks/<tag>/block.ts` | `@setu/core` `STANDARD_BLOCKS` |
| Renderer (`.astro`) | `blocks/<tag>/<tag>.astro` | `@setu/blocks` (token-themed) |
| Ships with product? | no (per site) | **yes** |
| Themed via | CSS tokens | CSS tokens (same) |

A core block and a site-local block are unioned into one registry; site-local
wins on a tag collision (so any site can still override a standard block by
dropping a `blocks/<tag>/` folder).

## The `button` block

- **Tag:** `button`  **Category:** `layout`  **Shape:** A (body = label).
- **Markdoc:** `{% button href="/signup" variant="primary" %}Get started{% /button %}`
  — body-bearing (reuses the proven callout/notice round-trip path; gives an
  inline-editable label in the editor).
- **Props (zod):** `href: string`, `variant: enum('primary','secondary')`
  default `'primary'`. (No alignment/size — deferred to width/breakout, #3.)
- **Editor meta:** `label: 'Button'`, `group: 'layout'`,
  `keywords: ['btn','cta','link']`, `icon: 'link'` (a confirmed admin
  `IconName`; `toIconName` falls back to `sparkle` for any unknown value).
- **Renderer (`@setu/blocks`):** a single `Button.astro` —
  `<a href class="setu-button setu-button--{variant}"><slot /></a>` — with a
  token-themed `button.css` (`var(--accent, …)`), exactly the callout.css
  pattern. When rendered on the site it picks up the active theme's tokens via
  the cascade (no theme-specific file needed).
- **Editor:** the existing generic `setuBlock` node renders it (auto-form from
  the contract + inline-editable body). No bespoke editor node — confirmed the
  generic node already supports body-bearing blocks.

## The merge (`@setu/core`)

`mergeBlockSources({ standard, local })` → `BlockEntry[]` (the existing
`{ tag, component, contract }` shape that `buildRegistry` already consumes). A
standard block's `component` is its `@setu/blocks` renderer specifier; a local
block's `component` is its folder path. Site-local wins on a tag collision. Pure,
unit-tested, called by both the admin registry and the site codegen so the
union rule is written once.

## The two flows it touches

- **Admin registry** (`apps/admin/src/blocks/registry.ts`): union
  `STANDARD_BLOCKS` with the existing `blocks/*/block.ts` glob via
  `mergeBlockSources`; local wins. Effect: `button` appears in the slash menu
  (under **Layout**, automatically — `slashBlocks()` maps every registry block)
  and in `knownBlockTags` (so the round-trip treats `{% button %}` as known).
- **Site codegen** (`scripts/gen-blocks.mjs`): include `STANDARD_BLOCKS` in the
  registry it builds (unioned with the local `blocks/` scan), then emit
  `markdoc.blocks.generated.mjs` as today. The `button` entry points at the
  `@setu/blocks` renderer (a bare package specifier).
- **Site runtime:** unchanged.

`generateMarkdocTagsInclude` needs one tweak: renderer paths that are **bare
package specifiers** (the `@setu/blocks` renderer) are emitted as-is, while
repo-root `blocks/…` paths keep their `../../` prefix.

## Files

**Create:**
- `packages/core/src/blocks/standard/types.ts` — `StandardBlock` interface.
- `packages/core/src/blocks/standard/button.ts` — the `button` standard block.
- `packages/core/src/blocks/standard/index.ts` — `STANDARD_BLOCKS`.
- `packages/core/src/blocks/merge-sources.ts` — `mergeBlockSources()`.
- `packages/blocks/src/button/Button.astro` + `button.css` — token-themed
  renderer.
- Tests: core standard-blocks, merge-sources, generate-markdoc, button
  round-trip; admin registry.

**Modify:**
- `packages/core/src/index.ts` — export `StandardBlock`, `STANDARD_BLOCKS`,
  `mergeBlockSources`.
- `packages/core/src/blocks/generate-markdoc.ts` — bare-specifier paths.
- `packages/core/tsconfig.edge.json` — add `src/blocks`.
- `packages/blocks/package.json` — export `./button.astro`, `./button.css`.
- `apps/admin/src/blocks/registry.ts` — union via `mergeBlockSources`.
- `scripts/gen-blocks.mjs` — include `STANDARD_BLOCKS` in the registry.
- `content/post/en/kitchen-sink.mdoc` + `apps/site/test/render.test.ts` — render
  proof.

## Testing

- **merge-sources:** union of standard + local; local wins on tag collision;
  standard block carries its `@setu/blocks` renderer as `component`.
- **button contract:** zod validates `href` + default `variant`; attributes
  derive correctly.
- **round-trip:** `{% button %}…{% /button %}` byte-stable.
- **generate-markdoc:** bare specifier emitted as-is; `blocks/…` prefixed
  `../../`.
- **admin registry:** `button` present under `layout`; callout/notice/image
  still present.
- **site render:** the kitchen-sink page renders the button `<a>` (token-themed);
  full repo green; callout/notice unchanged.

## Open questions

The one implementation-time check: does Astro `component()` accept a bare
package specifier (`@setu/blocks/button.astro`) for the renderer? The site render
test is the gate; documented fallback is to emit a resolved absolute path
(`fs.allow: ['../..']` already permits it).
