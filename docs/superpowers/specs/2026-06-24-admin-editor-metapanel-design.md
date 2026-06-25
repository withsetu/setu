# Editor chrome — PR B: meta panel

Status: approved design, ready for plan
Date: 2026-06-24
Second editor-chrome PR (A: strip ✅ → command palette ✅ → **B: meta panel** → C: canvas/breakout). Part of [[setu-admin-shadcn-migration]].

## Goal

Re-skin the editor's right meta panel (`MetaPanel` + `CategoryField` + `TagField`) onto shadcn
primitives with the loose/modern aesthetic, **remove the vestigial Status segmented control**, and
reorder the panel **Permalink → Categories → Tags**. No change to the TipTap canvas or the strip.

## Scope boundary

- **In:** `MetaPanel.tsx` (shell + section order + Status removal), `CategoryField.tsx`
  (Checkbox/Input/Select/Button), `TagField.tsx` (Badge chips), and the dead `.meta-*`/`.segmented`/
  `.category-*`/`.tag-chip*` CSS.
- **Out:** canvas, floating menus, breakout (PR C); the strip (PR A, done); `TagAutocomplete`
  (already restyled — reused as-is); adding NEW meta fields (excerpt/SEO/featured image/author) —
  later, noted below.

## Current state (what exists)

`apps/admin/src/editor/MetaPanel.tsx` — a `<aside className="meta-panel">` (300px sidebar) with four
sections in this order: **Status** (segmented Draft/Staged/Deployed buttons), **Categories**, **Tags**,
**Permalink** (read-only Slug/Locale). Props: `{ metadata, locale, slug, editable, onChange }`.
- **Status control** reads/writes `metadata['status']` — and grep confirms that field is read
  **nowhere else** (not the admin, not core lifecycle derivation, not the content index, not the
  site). The real publish status is the **derived `lifecycle`** shown by the strip Badge (PR A). So
  the control is a fake: clicking "Deployed" only writes a meaningless frontmatter field.
- `CategoryField.tsx` — checkbox tree (`buildTree`→`flatten`, indented rows), a "Filter categories"
  text input, and an inline-create row (name `<input>` + parent `<select>` + "Add" `<button>`), with
  an error line. Uses `useTaxonomy()` (`categories`, `create`).
- `TagField.tsx` — chips (`<span className="tag-chip">` + `×` button) + `<TagAutocomplete>`.
- Styles: `apps/admin/src/styles/editor.css` (`.meta-panel`, `.meta-section`, `.meta-title`,
  `.meta-row`, `.meta-label`, `.meta-value`, `.segmented`, `.segmented-opt`, `.category-field`,
  `.category-tree`, `.category-filter`, `.category-row`, `.category-new`, `.tag-field`, `.tag-chips`,
  `.tag-chip`, `.tag-chip-x`).

## Architecture

### MetaPanel shell + Status removal + reorder

- Rebuild `<aside>` with Tailwind utilities (loose/modern, hairline section dividers, muted
  sentence-case section labels). Keep it the editor's right sidebar (~300px, `flex-shrink-0`,
  `overflow-y-auto`) — the editor layout/structure around it is unchanged.
- **Remove the entire Status `<section>`** (the segmented control). Drop the `STATUSES` constant and
  the `current`/`metadata['status']` read. `MetaPanel` no longer writes `metadata['status']` at all.
  (Existing content that happens to carry a `status:` frontmatter key is simply ignored — nothing
  reads it; we do NOT strip it from existing files, just stop maintaining it.)
- **Section order: Permalink → Categories → Tags.**
- Props unchanged (`{ metadata, locale, slug, editable, onChange }`); `onChange` still drives
  `categories`/`tags` updates exactly as today. `lifecycle` is NOT threaded in (Status is gone).

### CategoryField → shadcn

Same behavior (tree select + filter + inline-create + error), swapped primitives:
- Filter → shadcn `Input` (with a search icon, matching the Tags-tab/list pattern).
- Tree rows → shadcn `Checkbox` + a `<label>` per node, indentation via `paddingLeft: depth*` (keep
  the depth-indent). Scrollable list (cap height, e.g. `max-h-64 overflow-y-auto`).
- Create row → `Input` (name, Enter submits) + `Select` (parent; "No parent" + indented options) +
  `Button` ("Add"). Error line → muted/`text-destructive` text (or a `notify.error` — keep the inline
  error to match current behavior).
- `useTaxonomy()` usage, the `toggle`/`submit` logic, and the `editable` disabling are preserved
  verbatim. (This is the editor's category *picker*; it is NOT the Taxonomies-hub management screen.)

### TagField → shadcn

- Chips → shadcn `Badge` (soft `secondary`/indigo tint) each with an inline remove `×` (an icon
  button, `aria-label={`Remove ${tag}`}`). Same `remove`/`onChange` logic.
- Keep `<TagAutocomplete>` exactly as-is (already restyled) for adding tags.

### Permalink

- Read-only Slug + Locale rows, cleaner: muted label left, mono value right (`/{slug}`, `{locale}`),
  at the TOP of the panel.

### Aesthetic

Loose/modern per [[setu-admin-visual-aesthetic]] + the approved mockup: ~13px muted section labels,
hairline dividers between sections, generous padding, indigo (`--primary`) for checked boxes / the
Add button / tag chips, tokens only (no hardcoded colors). Reuse shared shadcn primitives.

## Data flow / behavior (unchanged except Status)

`metadata.categories` / `metadata.tags` edits flow through `onChange` exactly as today (draft
metadata, committed on publish). Category inline-create still commits to `categories.yaml` via
`useTaxonomy().create`. The ONLY behavioral change: the panel no longer reads or writes
`metadata['status']`.

## Error handling

- Category create errors surface as today (inline error line or `notify.error`).
- `editable === false` (read-only/locked) disables all inputs/buttons exactly as now.

## Testing

- Existing editor/meta tests stay green; update only selectors that changed (e.g. `.segmented` /
  `.tag-chip` queries → role/label queries), never weakening assertions.
- New/updated component tests:
  - MetaPanel renders sections in order **Permalink, Categories, Tags**, and renders **no** Status
    control (assert the Draft/Staged/Deployed buttons are gone; assert `onChange` is never called
    with a `status` key from the panel).
  - CategoryField: checking a row calls `onChange` with the slug added/removed; the filter narrows
    rows; inline-create calls `useTaxonomy().create` and selects the new slug; `editable=false`
    disables controls.
  - TagField: a chip's remove calls `onChange` without that tag; the autocomplete add appends.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green (typecheck included — vitest does not
  typecheck).

## Out of scope (later)

- New meta fields (excerpt, SEO/meta description, featured image, author, scheduled date) — additive
  later; not in this re-skin.
- The Taxonomies-hub category management screen (separate, shipped).

## Decomposition (for the plan)

1. `CategoryField` → shadcn Checkbox/Input/Select/Button (TDD).
2. `TagField` → shadcn Badge chips (TDD).
3. `MetaPanel` → remove Status, reorder Permalink→Categories→Tags, shell re-skin (TDD).
4. Cleanup: delete dead `.meta-*`/`.segmented`/`.category-*`/`.tag-chip*` CSS; full gate.

Built subagent-driven per [[setu-execution-default]]; editor-visible spot-check at the end.
