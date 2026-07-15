---
name: new-block
description: Use when adding a new Setu content block ({% tag %}) or substantially changing an existing one — its contract, renderer, editor controls, or styling. Triggers include the default-block epic #176 children (gallery, video, columns, CTA, pricing, …), "add a block", a block not appearing in the slash menu, or a block crashing the editor preview.
---

# Building a Setu block

## Overview

A block spans **four planes that must agree**: the contract (core), the editor (admin), the
renderer (site/theme), and styling (token contract). Most block defects here have been one plane
forgotten: a renderer missing from the preview map (cryptic `@astrojs/react` toString crash), CSS
inventing ad-hoc variables (~22 drifted names before #369 locked the vocabulary), breakout CSS that
silently did nothing (`max-width` inside the theme's measure column), inspector enums as raw text
boxes. This skill is the pipeline that keeps the planes in sync.

**Read [docs/block-styling-contract.md](../../../docs/block-styling-contract.md) before writing any
block CSS. Non-negotiable.**

## When to use

- Any child of epic #176 (default block library) or a bespoke block request.
- Adding/removing block props, controls, or editor behavior on an existing block.
- Debugging: block absent from slash menu, inspector empty, preview iframe crash, block unstyled
  on one theme.
- NOT for: prose/mark formatting (that's the bubble/editor chrome), theme-only restyles of an
  existing block (that's the theme's CSS via the three override hatches).

## Decide the shape and home first

| Question | Answer |
|---|---|
| Structured data, props-driven, no children? | **Shape A** (hero/CTA/pricing pattern) — covers ~80%; the generic `setuBlock` editor node renders it, no bespoke Tiptap node needed |
| Container holding arbitrary blocks (columns/section)? | **Shape B** — nested-ProseMirror work; brainstorm first, it's the hard class |
| Part of Setu's standard vocabulary (#176)? | **Standard block**: contract in `packages/core/src/blocks/standard/`, renderer in `packages/blocks/src/` |
| Site-specific one-off? | **Site-local**: repo-root `blocks/<tag>/{block.ts, <tag>.astro}` — auto-discovered, wins over standard on tag collision |
| Category (required) | One of: `text · media · layout · embed · dynamic · marketing · widget` |

Also run the standing gates: security checklist if it fetches/embeds/parses anything
(oEmbed/map/gist → safe-fetch + sandbox rules; see #187/#258 precedents), and the topology check
(a block needing server compute at render time is SSG-hostile — think again).

## The pipeline (do these in order)

1. **Contract.** `defineBlock`: zod `props` + editor meta — `label`, `icon`, `category`, `group` +
   `keywords` (slash-menu findability), per-prop `controls` hints, `groups`
   (Content/Layout/Style sections, `showWhen`-aware), optional `style.themeable` axes. Enums get
   `select`/segmented controls — an enum rendered as a text box is a Definition-of-Done defect.
   Available control types live in `apps/admin/src/editor/controls/` (text, url, number, textarea,
   switch, select, color, media, slider, align, position9, category, tag) — reuse; a new control
   type goes into that registry, never inline.
2. **Editor node.** Body-bearing blocks ride the generic `setuBlock` node — nothing new needed.
   Childless props-only blocks (most of Shape A) get a dumb **atom node** copied from the hero
   precedent (`apps/admin/src/editor/extensions/HeroBlock.tsx`): atom/draggable/selectable,
   `mdAttrs`-only, rendering a shared React core from `@setu/blocks` (routing a childless block
   through `setuBlock` round-trips with a phantom paragraph). Wire the tag↔node mapping in core's
   `to-tiptap.ts` / `to-markdoc.ts` (childless emits self-closing `{% tag /%}`), and register the
   node in `Canvas.tsx`, `blocks.ts` (slash insert), and `useSelectedBlock.ts` (`INSPECTABLE` +
   `tagOf` — miss this and the inspector silently never opens; no existing test catches it). A
   node-view with custom in-canvas *editing* (callout-style inline title) is the only genuinely
   interactive case — then equality-guard any selection-driven `setState` and add a
   **browser-mode test** in `apps/admin/test-browser/` (jsdom will pass while the live editor
   loops).
3. **Renderer.** `.astro` component using **global CSS** (a plain `.css` import, NOT a scoped
   `<style>` — themes must see stable selectors). Class namespace: root `.setu-<block>` /
   `.blk-<block>`, parts `.blk-<block>-<part>`. Read only the 19 contract tokens
   (`var(--accent)`, `--bg`, `--text`, `--green-soft`, `--r-md`, `--font-ui`, …) or block-locals
   `--blk-<block>-*` (locals keep inline fallbacks). Hardcoded colors: `#fff`/`#000` neutrals only.
   Images render through `@setu/image-astro` (real srcset), never a bare `<img src>`.
4. **Width/breakout.** Blocks render inside the theme's measure column — a plain `max-width` does
   NOTHING. Wide/full uses the theme's `.align-wide`/`.align-full` bleed pattern
   (`width:100vw; margin-left:50%; transform:translateX(-50%)`), and that CSS lives in the
   **theme**, not the block.
5. **Registration/codegen.** Standard block → add to `STANDARD_BLOCKS`; site-local → the folder IS
   the registration. Then `node scripts/gen-blocks.mjs` regenerates the site's
   `markdoc.blocks.generated.mjs` (site `predev`/`prebuild` also run it). The admin registry
   glob-imports `blocks/*/block.ts` automatically. The **editor preview** enumerates renderers
   explicitly — `apps/site/test/preview-blocks.test.ts` derives the required set from
   `STANDARD_BLOCKS` + `blocks/`; run the site tests and let it catch a missed registration
   (the symptom otherwise: preview iframe crashes with `Cannot read properties of undefined
   (reading 'toString')` — real stack only in the preview window's browser console).
6. **Tests.** Props/contract unit test beside the contract; token guard already enforces CSS
   (`pnpm --filter @setu/blocks test`); render-smoke rides `pnpm --filter @setu/site test` (real
   `astro build`); round-trip: insert → publish → reopen must be byte-stable (`{% tag %}` survives
   `tiptapToMarkdoc`/`markdocToTiptap`); browser-mode test if step 2 went bespoke.
7. **UAT (invoke `/uat`).** Slash-insert it (search by keyword, not just scrolling); operate every
   inspector control and watch the canvas; check default/empty props render sensibly (no
   `undefined` on screen); publish; view on the site; reopen. Screenshot for the PR.

## Quick reference — where each plane lives

| Plane | Path |
|---|---|
| Contract type + helpers | `packages/core/src/blocks/` (`defineBlock`, `BlockEditorMeta`, categories) |
| Standard contracts | `packages/core/src/blocks/standard/` (`STANDARD_BLOCKS`) |
| Standard renderers + CSS | `packages/blocks/src/` (exports like `@setu/blocks/button.astro`) |
| Token vocabulary + defaults | `packages/blocks/src/tokens.ts` + `tokens.css` (single source) |
| Token guard (CI) | `packages/blocks/test/token-contract.test.ts` |
| Site-local blocks | repo-root `blocks/<tag>/{block.ts, <tag>.astro}` |
| Admin block registry | `apps/admin/src/blocks/registry.ts` (glob; standard+local merge) |
| Inspector + control registry | `apps/admin/src/editor/BlockInspector.tsx`, `apps/admin/src/editor/controls/` |
| Slash menu model | core `slashRenderModel` (grouped empty / keyword-ranked typing) |
| Site codegen | `scripts/gen-blocks.mjs` → `apps/site/markdoc.blocks.generated.mjs` |
| Preview coverage test | `apps/site/test/preview-blocks.test.ts` |
| Styling rules + override hatches | `docs/block-styling-contract.md` |

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Hardcoded `#4f46e5` / invented `--my-var` | Token guard fails the build; theme can't re-skin | Read contract tokens; locals as `--blk-<block>-*` with fallback |
| Renderer not in the preview's map | Editor preview crashes cryptically | Step 5; run site tests; read the iframe console |
| Enum prop as text control | Skeleton-ship defect; review blocks it | `controls` hint → select/segmented |
| No `group`/`keywords` in meta | Block unfindable in slash menu at 23+ blocks | Set both at contract time |
| Scoped `<style>` in the `.astro` | Theme override hatch (b) can't target it | Global `.css` with namespaced classes |
| Breakout via `max-width` in block CSS | Visually inert; Full looks like Wide | Theme bleed pattern (step 4) |
| Only jsdom tests for a bespoke node-view | Live editor loops/white-screens | Browser-mode test + `/uat` editor smoke |
| Childless block routed through `setuBlock` | Phantom paragraph; non-self-closing round-trip drift | Atom node per the hero precedent (step 2) |
| Node not in `useSelectedBlock` `INSPECTABLE`/`tagOf` | Inspector silently never opens — no crash, no failing test | Register it in the same commit as the extension; UAT step "click the block → rail opens" |
| Skipping the reopen after publish | Round-trip drops attrs silently | Step 7 includes reopen |

## Done means (checkable)

- [ ] Contract with category/group/keywords/controls; enums are pickers
- [ ] Token guard, whole-repo typecheck, site render-smoke, round-trip test all green
- [ ] Renders in canvas, preview iframe, and built site; default props look intentional
- [ ] Wide/full behave distinctly (if the block declares them)
- [ ] Driven via `/uat` with evidence; screenshot in the PR
