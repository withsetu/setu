# Block Authoring Rail — design

Date: 2026-06-28
Status: Approved (brainstorm), ready for plan
Owner: Mayank

## Problem

The block inspector (right rail) and the standard blocks it edits feel half-baked — "Gutenberg
Media+Text" grade, not the top-notch authoring experience that is Setu's entire competitive wedge
(see [CLAUDE.md](../../../CLAUDE.md), [docs/quality-bar.md](../../quality-bar.md)). Concretely, when
editing the hero block the rail is:

- **A — crude controls:** plain HTML dropdowns, a bare "Choose" button, a raw `<input type=color>` —
  generic inputs, no purpose-built affordances (no 9-point grid, no segmented toggles, no first-class
  media affordance).
- **C — unpolished:** the rail itself lacks craft (spacing, typography, hierarchy).
- **D — flat & unstructured:** eight fields in one ungrouped column — a config dump, no
  Content/Layout/Style hierarchy.

(Live-sync — the canvas updating as you edit — is **already** acceptable and not a focus.)

This spec designs a **reusable authoring-rail substrate** so that *every* current and future block
inherits a polished, structured, purpose-built editing experience. It is the foundation the whole
block library will stand on.

## Scope

**In scope (the reusable substrate):**
1. A **control kit** — a registry of purpose-built control components keyed by control type, built on
   shadcn primitives.
2. A **grouping system** — the block contract can declare Content/Layout/Style sections so the rail
   has hierarchy.
3. A **redesigned rail shell** — shadcn-grade craft.
4. **Flagship proof:** apply the kit to the **hero** (rail) and do a hero **renderer** polish pass so
   the proof block is genuinely good, not a skeleton. (Renderer polish is hero-specific craft,
   included as the proof — not a reusable system.)

**Out of scope (YAGNI / separate efforts):**
- Inline-on-canvas text editing (headline typed on the block) — deferred to a fast-follow; purely
  additive later, contract/rail unchanged.
- The block-library **inserter/gallery** (browse → preview → drop) — its own brainstorm.
- Free X/Y hero positioning; per-theme renderer overrides.

## Decisions (from brainstorm)

- **Editing model = C (great side rail) + a deferred inline-text fast-follow.** The user first chose
  D (hybrid) then settled on "C is good enough." Text stays in the rail for v1 (made prominent); the
  node-view stays an `atom`, avoiding the editable-region complexity that previously caused a
  re-render/infinite-loop bug. Inline text revisited only if polished rail-text still grates.
- **shadcn-first** for every control (CLAUDE.md "Building UI" rule). Reuse the shadcn MCP
  (`mcp__shadcn__*`) to pull exact `toggle-group`, `dialog`, `popover`, `slider`, etc. Do not
  hand-roll lookalikes.
- **Media is never a bare file input.** The `media` control opens the full media library
  (`MediaPickerModal` → `MediaBrowser`, browse/search/upload) — already wired today — and shows a
  thumbnail with replace/remove. The fix is making it *look* first-class.

## Architecture

### 1. Control kit (control registry)

Replace the inline `if/else` chain in `BlockInspector.tsx` with a **registry**:
`controlType → ReactComponent`. Each control is a small, self-contained component with a uniform
interface:

```ts
type ControlProps = {
  value: unknown
  onChange: (next: unknown) => void
  meta: ControlDescriptor   // name, label, options, default, hints, apiBase, ...
}
```

`resolveControls(props, hints)` in `packages/core` already turns the zod contract + hints into control
descriptors; we keep it and extend the descriptor. `BlockInspector` becomes a thin shell that maps a
descriptor to `registry[descriptor.control]`.

**v1 control vocabulary:**

| control     | component                                              | notes |
|-------------|--------------------------------------------------------|-------|
| `text`      | shadcn Input, restyled                                 | prominent variant for headline |
| `textarea`  | shadcn Textarea                                        | |
| `url`       | Input `type=url`                                       | |
| `number`    | Input `type=number`                                    | |
| `switch`    | shadcn Switch                                          | already good |
| `select`    | **segmented `ToggleGroup`** for small enums; auto-fallback to `Select` dropdown for long lists | segmented-vs-dropdown is an admin render choice based on option count, not a core type |
| `position9` | **3×3 grid picker** (NEW core control type)            | replaces the textPosition dropdown |
| `color`     | swatch + alpha (`#RRGGBBAA`), restyled                 | reuse current logic, polish |
| `media`     | thumbnail + replace/remove, opens `MediaPickerModal`   | first-class affordance |
| `align`     | width/alignment `ToggleGroup` (NEW core control type)  | `none/wide/full` (+ align); **shared with the image block** |

Adding a future control = drop one component in the registry + (if a new type) add it to the core
control-type union. Blocks just name the control type in their contract.

### 2. Grouping system

Add an optional **`groups`** to the block editor meta (`packages/core` types):

```ts
groups?: Array<{ id: string; label: string; controls: string[] }>
```

Hero example:
- **Content** → headline, subhead, image, ctaLabel, ctaHref
- **Layout** → layout, textPosition, align
- **Style** → overlayColor, parallax

**Defaults:** if a block omits `groups`, all controls render under one implicit "Content" section in
declaration order — simple blocks (button, callout) need zero boilerplate.

**Rendering:** each group is an **always-open labeled section** — small uppercase header + separator
(Linear/Sanity feel), not a collapsible accordion. Full overview at a glance, less clicking.

**`showWhen` interplay:** the existing conditional-field logic runs *inside* groups (e.g.
overlayColor/parallax appear in Style only when layout = background). A group whose controls are all
hidden renders nothing — no empty headers.

This is purely additive: existing blocks render unchanged until they opt into `groups`.

### 3. Rail shell

Redesign `BlockInspector`'s shell for craft: header (`BLOCK · <LABEL>`), grouped sections with
consistent spacing/typography, shadcn tokens only (respect the `no-brand-accent-in-bespoke-css`
guard). The shell renders groups → controls via the registry.

### 4. Flagship proof — redo the hero

- **Rail:** hero adopts `groups` + `position9` + first-class `media` + `align` + `color`.
- **Renderer:** a polish pass on `packages/blocks/src/hero/Hero.astro` + `hero.css` so the default
  output is genuinely good (typography, spacing, the background/overlay treatment, the `align`/width
  options matching the image block) — not a generic Media+Text.

## Components & boundaries

- `packages/core`: extend editor-meta types (`groups`, control-type union additions `position9`,
  `align`); `resolve-controls` emits descriptors (mostly unchanged). No React here.
- `apps/admin/src/editor/controls/`: new dir — one component per control type + `registry.ts`. Each
  control is independently testable (value/onChange/meta in, DOM out).
- `apps/admin/src/editor/BlockInspector.tsx`: thin shell — groups + registry lookup. Loses the
  if/else chain.
- Reuse: `MediaPickerModal` (media), and the image block's align UX (build `align` once, share).

## Testing

- **Unit (vitest + RTL):** `resolve-controls` grouping/descriptor output; each control component
  (render, change emits correct value — e.g. `position9` emits the right 9 enum values, `color`
  round-trips `#RRGGBBAA`, `align` emits `none/wide/full`).
- **Regression guard:** keep the `useSelectedBlock` render-stability test green (the prior
  infinite-loop class).
- **Gate (CLAUDE.md DoD):** drive the hero edit flow live in the running app — switch layout, set
  position via the grid, pick media from the library, set overlay color/alpha, toggle parallax — and
  confirm the canvas + site render. Matches design, reuses components, no skeletons.

## Risks

- **Editable-region/re-render bugs** if inline text creeps in — explicitly deferred to keep the
  node-view an `atom`.
- **Segmented vs dropdown** heuristic (option count) — keep it a simple threshold; don't over-engineer.
- **align sharing** — verify the image block's current align affordance before building, to reuse not
  duplicate (DoD rule 3).
```
