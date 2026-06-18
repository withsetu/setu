# Design — Rich Callout (titled, config-driven variants) — Increment #12

_Date: 2026-06-14 · Status: approved (converged in UAT discussion)_

## Purpose

Increment #11 shipped a minimal callout (icon + one editable text block, fixed
tone, no title). UAT feedback: callouts should be **titled admonitions with
multiple variants** (the reference: blue/green/amber/red/slate callouts, each with
an icon, a bold title, and body text). This increment makes the callout a rich,
**config-driven** block: one `{% callout %}` block, many variants selected by a
`type` attribute, plus an optional title and icon override — authored via an
inline toolbar — all round-tripping to Markdoc losslessly.

## The model (agreed with the product owner)

- **One block, many variants — not many blocks.** Every callout is the same
  `{% callout %}` block; the variant is the `type` attribute
  (`info`/`note`/`success`/`warning`/`danger`/`neutral`). Saved form:
  `{% callout type="success" title="Shipped" icon="check" %}\n…body…\n{% /callout %}`.
- **The allowed variants live in config.** The callout block's schema in
  `saytu.config.ts` (here, `defaultConfig`) defines the `type` enum. The editor
  reads the allowed types from the resolved config — adding/removing a variant is a
  config change, no editor code. (Saytu's config-driven-block bet.)
- **A variant's look (tone color + default icon) is the theme's job**, ultimately
  rendered by `Callout.astro` on the published site. The editor mirrors the
  **default theme** via a built-in `type → {tone, defaultIcon, label}` map; a
  future Theme-API hook will let custom themes supply editor preview hints. (This
  increment is the **authoring** side; published-site multi-tone rendering is
  later theme/render work.)
- **Per-callout knobs:** an optional **`title`** (a Markdoc attribute, edited
  inline as a bold header) and an optional **`icon`** override (keep the tone, swap
  the glyph). Both are attributes on the one block.

## Scope

**In:**
- **Callout node, rebuilt** (`apps/admin/src/editor/extensions/Callout.tsx`):
  a titled layout — a header row (`icon` badge + an inline-editable **title**) and
  the **body** (`NodeViewContent`, block content). Reads `mdAttrs.type` (→ tone +
  default icon), `mdAttrs.title`, `mdAttrs.icon` (override); writes them via
  `updateAttributes({ mdAttrs })`. Icon top-aligned with the title row.
- **Inline variant toolbar:** when the callout node is selected
  (`ReactNodeViewProps.selected`), show a small toolbar inside the node view:
  **tone swatches** (one per allowed `type`) + a small **icon picker** (a curated
  set). Selecting a tone sets `type`; selecting an icon sets the `icon` override.
- **Config-driven variants:** the toolbar's tone options come from a new
  `editor.variants: string[]` field on the callout block config (read via
  `resolveConfig`); the editor maps each variant to a default-theme
  `{tone, defaultIcon, label}`. Unknown/extra types fall back to a neutral tone.
  (Explicit `editor.variants` over zod-enum introspection — robust, no fragile
  `ZodDefault`/`ZodEnum` unwrapping.)
- **Default config + core type expanded:** add `variants?: string[]` to
  `BlockEditorMeta` (`packages/core/src/config/types.ts`); `defaultConfig`'s callout
  gets `props: z.object({ type: z.string().optional(), title: z.string().optional(),
  icon: z.string().optional() })` (permissive — attr-value validation is deferred)
  and `editor.variants: ['info','note','success','warning','danger','neutral']`
  (the default theme's variant set).
- **Slash insert** creates a default callout (`type:'info'`, empty title, an empty
  body paragraph the cursor lands in).
- **CSS** (`apps/admin/src/styles/editor.css`): the titled callout layout +
  the six tones + the toolbar, ported/extended from `design/admin/editor.css`
  (`.blk-callout`, `.callout-head`, `.callout-title`, `.callout-body`,
  `.block-props`/swatches), using existing tokens.
- **Round-trip guard extended:** a `type` + `title` + `icon` callout (incl. a
  title with spaces/special chars) → set as editor content → `getJSON()` preserves
  the attrs AND `tiptapToMarkdoc(getJSON()) === source` byte-for-byte. (Cardinal
  rule: a titled callout must never lose content/attributes.)

**Out (deferred):**
- Published-site rendering of the tones (theme/render work; `Callout.astro` variant
  styling).
- The Theme-API editor preview hooks for custom themes.
- Per-site config UI for variants (variants are edited in `saytu.config.ts`).
- Attribute-schema validation at edit time (metadata/attr validation is its own
  later piece; the editor offers the config's enum, but doesn't yet block invalid
  hand-edited values beyond the neutral fallback).
- Tone/icon for blocks OTHER than callout.

## Why these choices

- **`type` attribute over separate tags.** One block keeps the content model clean
  and the slash menu uncluttered; the variant is semantic data, not structure; and
  the variant set is config-driven/extensible. Separate `{% note %}`/`{% warning %}`
  tags would multiply the schema for no gain.
- **Variants read from config, look from an editor default-theme map.** Honors the
  config-driven-block thesis (config = source of allowed variants) while keeping
  render concerns (color/icon) out of the framework-agnostic config — the editor
  approximates the default theme, the Theme API extends this later.
- **Title as an attribute, edited inline.** Matches the existing `title?` in the
  callout zod and the docs-admonition pattern; round-trips as `{% callout
  title="…" %}`. The body stays the block content.
- **`mdAttrs` already round-trips, so no converter change.** The callout node's
  `mdAttrs` bag is serialized verbatim by `tiptapToMarkdoc`
  (`new N('tag', mdAttrs, children, 'callout')`), so `type`/`title`/`icon` survive
  with zero changes to `packages/core/src/markdoc/*`. The guard test proves it.

## Architecture / data flow

```
apps/admin/src/editor/
├── extensions/Callout.tsx     # REBUILT: titled node view + inline variant toolbar
├── callout-variants.ts        # NEW: default-theme type→{label,tone,icon} map +
│                              #   a helper reading allowed types from resolveConfig
└── blocks.ts                  # slash insert -> default titled callout
packages/core/src/config/default-config.ts   # callout type enum expanded + icon?
apps/admin/src/styles/editor.css        # titled callout + tones + toolbar
apps/admin/test/editor-schema.test.tsx  # guard extended (typed+titled callout)
apps/admin/test/callout-variants.test.tsx  # NEW: variants from config + insert
```

- The node view derives `variant = variantFor(mdAttrs.type)` from the default-theme
  map; renders `.blk-callout tone-<variant.tone>` with the badge icon
  (`mdAttrs.icon ?? variant.defaultIcon`) and the inline title input (value
  `mdAttrs.title`). Editing title/tone/icon calls `updateAttributes({ mdAttrs:
  {...mdAttrs, …} })` so it persists + autosaves + round-trips.
- The toolbar's tone list = the allowed `type` values from the resolved config,
  each shown with its default-theme tone/label.

## Error handling / edge cases

- **Unknown `type`** (hand-edited or from a future config) → neutral tone +
  fallback icon; never crashes; the value is preserved (round-trips).
- **No title** → the header shows just the icon + a faint "Add a title…"
  placeholder; an empty `title` attribute is omitted from the saved tag (no
  `title=""`), so a plain callout stays `{% callout type="info" %}`.
- **Title with quotes/`&`/`:`** → serialized via Markdoc's attribute escaping;
  covered by the guard test.
- **Empty-attr hygiene:** `mdAttrs` should not accumulate empty `title:''` /
  `icon:''` keys — set to the value or delete the key when cleared, so the
  round-trip output stays clean.
- **Selection/toolbar:** the toolbar only shows when selected and is
  `contentEditable={false}` (a widget, not content) so it never enters the doc.

## Testing (behavior; visual fidelity = UAT)

- **Round-trip guard (extended):** `{% callout type="success" title="Success &
  Prosperity" icon="check" %}\nBody.\n{% /callout %}` → editor → `getJSON()`
  preserves `mdAttrs` `{type,title,icon}` AND `tiptapToMarkdoc(json) === source`.
  Plus a plain `{% callout %}` (no attrs) still round-trips, and a title-less
  typed callout doesn't emit `title=""`.
- **callout-variants:** `calloutVariants()` returns one entry per config `type`
  with a `label`/`tone`/`icon`; an unknown type maps to neutral; the slash "Callout"
  insert creates a `type:'info'` callout node.
- **Node view behavior:** editing the title input updates `mdAttrs.title`; picking
  a tone updates `mdAttrs.type`; picking an icon updates `mdAttrs.icon` (via a
  rendered `Editor`/`Canvas` test asserting `getJSON()` reflects the change).
- All existing admin tests (29 after the polish commit) + core/db/git suites stay
  green; `verbatimModuleSyntax`/`noUncheckedIndexedAccess` clean; build keeps fonts.

## Definition of done

- `pnpm --filter @setu/admin test` green (extended guard + variants tests + the
  existing suite); `pnpm --filter @setu/admin typecheck` + `build` clean (fonts
  preserved). `pnpm test` + `pnpm typecheck` repo-wide green (core config test
  updated for the expanded enum).
- `pnpm dev`: a callout shows an icon + bold title + body; selecting it reveals a
  tone/icon toolbar; switching tone recolors it; the title is editable; leaving and
  returning preserves type/title/icon/body (UAT).
- Committed via the subagent-driven flow.
