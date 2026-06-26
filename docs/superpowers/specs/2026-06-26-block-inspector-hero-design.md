# Block inspector + hero block — design

Status: approved approach, ready for plan
Date: 2026-06-26
First sub-project of the **block-library catalogue** phase (see [[setu-block-library]]). Foundation A+B
shipped (taxonomy, slash, core-standard-block path proven with `button`); width/breakout shipped in the
shadcn editor-chrome C1. This delivers the **block inspector** (the reusable prop-editing substrate) and
proves it against the first real prop-heavy marketing block, a **hero**. Builds on the now-complete
shadcn admin ([[setu-admin-shadcn-migration]]).

## Goal

Two coupled deliverables, one spec:
1. **Block inspector** — a contextual right-rail panel that edits the selected block's props with proper
   shadcn controls, auto-derived from the block's zod contract (+ optional per-prop control hints).
   Replaces the cramped inline `.block-props` auto-form in `SetuBlock.tsx`.
2. **Hero block** — a Shape-A (props-only, no nested body) marketing block that exercises the inspector's
   richer controls (media picker, multiline, url, enum), rendered token-themed + zero-JS on the site and
   live-WYSIWYG in the editor canvas.

Everything after this (pricing/testimonial/FAQ, etc.) is then additive: author a contract, get an
inspector for free.

## Current state (what exists)

- **Generic prop form already exists** but is crude: `apps/admin/src/editor/extensions/SetuBlock.tsx`
  derives a form from `markdocAttributesFor(block.props)` and renders raw `<select>`/`<input>` inline in
  a `.block-props` div above the block. Supports String/Number/Boolean/Enum only.
- `markdocAttributesFor` (`packages/core/src/blocks/markdoc-attributes.ts`) maps zod props →
  `{ type: 'String'|'Number'|'Boolean', default?, matches? }` (enum → `matches`). Throws on unsupported
  zod types.
- Standard-block path: `packages/core/src/blocks/standard/` (`button.ts`, `types.ts`, `index.ts` →
  `STANDARD_BLOCKS`), `defineBlock`, `BlockEditorMeta` already carries `label`/`icon`/`group`/`keywords`.
- `@setu/blocks` holds renderers/cores: `button` (Astro renderer `@setu/blocks/button.astro`), `callout`
  (single shared React core `Callout.tsx` + `callout.css`, used by editor node-view AND site).
- Editor mounts `Canvas` + `MetaPanel` side-by-side (`EditorScreen.tsx:312,315`). `MetaPanel` =
  permalink/categories/tags (`MetaPanel.tsx`).
- `setuBlock` node (`SetuBlock.tsx`) takes a `cores: Record<tag, ComponentType>` map; when a tag has a
  core it renders the real visual (callout pattern), else generic chrome.
- The media picker is now a shadcn `Dialog` (`MediaPickerModal`, `{ apiBase, open, onClose, onPick }`),
  wired in `Canvas.tsx` via `imageBlock.openPicker`.

## Architecture

### A. Inspector rail (admin)
The right rail becomes contextual with two modes:
- **Document mode** = the existing `MetaPanel` (permalink/categories/tags), shown when no block is
  selected.
- **Block mode** = a new `BlockInspector` showing the selected block's props, shown when a block is
  selected.

Selection wiring: the editor already tracks a selected node (NodeSelection / block menu). A small
`useSelectedBlock(editor)` hook surfaces `{ tag, mdAttrs, updateAttrs, pos } | null` from the current
selection (a `setuBlock` or other registered block node). The rail **auto-switches** to Block mode when
a block is selected and back to Document on deselect; a header toggle (shadcn `Tabs` or a segmented
control) lets the user flip manually while a block is selected. The inline `.block-props` form is
**removed** from `SetuBlock.tsx` (props live only in the rail now) — except the image-specific toolbar in
`ImageBlock.tsx`, which stays (it is image-node chrome, not a generic prop form, and is out of scope).

### B. Contract control-hints (core)
Extend `BlockEditorMeta` with an optional `controls?: Record<string, BlockControl>` where
`BlockControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'media' | 'url'`. A pure resolver
`resolveControls(block)` (in `@setu/core`) returns, per prop, the control to render: the explicit hint if
present, else derived from the zod type via the existing `markdocAttributesFor` (Enum→`select`,
Number→`number`, Boolean→`switch`, String→`text`). Backward-compatible: blocks without `controls` behave
exactly as today. Invalid hint (prop not in `props`, or control incompatible with the zod type, e.g.
`switch` on a String) throws at registration — never silently lossy, matching `markdocAttributesFor`.

### C. Field controls (admin)
`BlockInspector` renders one labeled shadcn control per prop from `resolveControls`:
- `text` → `Input`; `textarea` → `Textarea`; `number` → `Input[type=number]`; `switch` → `Switch`;
  `select` → `Select` (options from the enum `matches`); `url` → `Input[type=url]`;
- `media` → a thumbnail + "Choose / Replace" `Button` that opens the existing `Dialog` media picker and
  writes the chosen `/media/...` src into the prop (reuses `MediaPickerModal`).

Each control reads `mdAttrs[name]` (falling back to the contract default) and writes via `updateAttrs`
(empty string clears the attr, mirroring today's `setAttr`). The form is generic — it drives `button`,
`hero`, and every future block with no per-block code.

### D. Hero block — Shape A, props-only
- **Contract** `packages/core/src/blocks/standard/hero.ts`, added to `STANDARD_BLOCKS`:
  ```ts
  props: z.object({
    headline: z.string(),
    subhead: z.string().optional(),
    image: z.string().optional(),
    ctaLabel: z.string().optional(),
    ctaHref: z.string().optional(),
    variant: z.enum(['left', 'center']).default('center'),
  }),
  editor: { label: 'Hero', icon: 'layout', group: 'marketing',
    controls: { headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url', variant: 'select' } },
  ```
  No body (Shape A): the node is rendered from props, not nested content.
- **Site renderer** `packages/blocks/src/hero/Hero.astro` (`renderer: '@setu/blocks/hero.astro'`):
  token-themed, **zero-JS**, semantic markup (`<section class="blk-hero variant-…">` with headline /
  subhead / optional image / optional CTA link). Follows the `button` renderer pattern.
- **Canvas preview** `packages/blocks/src/hero/Hero.tsx`: a stateless preview core wired via `setuBlock`'s
  `cores` map, rendering the **same class structure** as `Hero.astro` and sharing **one `hero.css`**
  (token classes) so the canvas mirrors the site (write markup twice, CSS once — the callout precedent).
  Read-only in the canvas; all editing happens in the inspector rail.
- `hero` added to the editor's block registry / `cores` wiring and `STANDARD_BLOCKS`; the existing
  generic `setuBlock` node hosts it (props-only path → renders the core, no `NodeViewContent`).

## Data flow

Inspector edit → `updateAttrs(name, value)` → `updateAttributes({ mdAttrs })` on the node → TipTap doc
changes → autosave (existing) → Markdoc round-trip via existing codegen → `Hero.astro` renders on the
site. Canvas `Hero.tsx` re-renders from the new `mdAttrs` immediately (live WYSIWYG). No new persistence
or transport — `mdAttrs` is the same JSON-only attribute bag callout/button already use.

## Testing & verification

- **Core (unit):** `resolveControls` — explicit hint wins; zod fallback for each type; throws on
  unknown prop / incompatible hint. Hero contract present in `STANDARD_BLOCKS` with expected props +
  controls. Hero Markdoc round-trip (passthrough/guard pattern like other blocks).
- **Admin (unit/RTL):** `BlockInspector` renders the correct shadcn control per control-type and writes
  `mdAttrs` (text/textarea/number/switch/select/url); the `media` control opens the picker `Dialog` and
  writes the picked src; the rail switches Document↔Block on block selection/deselection; removing the
  inline `.block-props` form doesn't break existing block round-trips.
- **Full gate** `pnpm typecheck && pnpm test && pnpm build` green.
- **Visual UAT (done bar, owner):** insert a hero via the slash menu; edit headline/subhead/variant/CTA
  in the rail and watch the canvas update; pick a hero image via the media picker; confirm the site
  renders the hero token-themed + zero-JS; light + dark; the rail toggles Document↔Block correctly.

## Decomposition (for the plan)

1. **Core:** `BlockControl` type + `controls?` on `BlockEditorMeta` + `resolveControls` resolver + tests.
2. **Hero contract:** `hero.ts` + add to `STANDARD_BLOCKS` + round-trip test.
3. **`@setu/blocks` hero renderers:** `Hero.astro` (site) + `Hero.tsx` (canvas core) + shared `hero.css`.
4. **Admin `BlockInspector`:** generic control renderer (incl. media→picker) from `resolveControls`.
5. **Admin rail wiring:** `useSelectedBlock` + contextual Document/Block rail in `EditorScreen`/
   `MetaPanel`; remove the inline `.block-props` form from `SetuBlock.tsx`; wire `hero` into the editor
   registry/`cores`.
6. **Gate + editor-visible UAT.**

## Out of scope

Rest of the marketing wave (pricing/testimonial/FAQ — additive contracts after this); per-theme renderer
overrides (deferred to marketing wave #7); nested layout / Shape B (`columns`/`section`); pages-as-
content-type (#6); the token-alias cleanup tail; inline-in-canvas rich editing of hero text (rail-only
for this pass). The `ImageBlock` toolbar stays as-is (image-node chrome, not a generic prop form).
