# Block Library — Foundation A (Taxonomy + Slash Menu) — Design Spec

**Status:** Approved design, ready for implementation plan
**Date:** 2026-06-22
**Feature ID:** Block Library program, sub-project #1a

## Goal

Lay the foundation for a large block library by (1) locking a **canonical
7-category taxonomy** for blocks, (2) adding `group` + `keywords` to the block
contract, and (3) rebuilding the slash menu so it **scales to dozens of blocks**:
grouped-by-category when no query is typed, and a flat keyword-ranked list when
the author starts typing. Migrate the two existing folder blocks (callout,
notice) onto the new fields.

This is pure editor + contract work. It carries **no packaging risk** and ships
immediate UX value, while locking the category vocabulary every later block
depends on.

## Scope decision

The full block library is a multi-subsystem **program**, decomposed into
sequenced sub-projects (see Roadmap). This spec is **Foundation A only**.

Explicitly **in scope:**
- The locked `BlockCategory` enum (7 values) in `@setu/core`.
- `group` + `keywords` fields on the block contract's editor metadata.
- A rebuilt slash menu: grouped-empty / ranked-typing / alias matching.
- Categorizing the built-in text/format blocks and migrating callout + notice.

Explicitly **out of scope** (later sub-projects, named so reviewers don't flag
their absence):
- **Foundation B:** the core→theme→site **block source merge + override** and
  the first canonical *core* block with a theme-provided renderer.
- Editor width / breakout for layout blocks; the block inspector (structured
  prop editing); the `page` content type; any new content or marketing blocks;
  nested layout (columns/sections). None of these are touched here.
- A full "browse all blocks" panel (a possible later discovery surface; the
  slash menu is the fast path and is sufficient at current block counts).

## Program roadmap (north star — not built here)

Recorded so each sub-project inherits the same architecture. Dependency-ordered:

1. **Foundation A (this spec)** — taxonomy + slash menu.
2. **Foundation B** — block source merge (core → theme → site, override order)
   + first canonical core block + theme-provided renderer.
3. **Editor width & breakout** — raise canvas bound, keep text at measure,
   extend `none/wide/full` breakout to all blocks.
4. **Block inspector** — side-panel prop editing for structured blocks.
5. **Content-block wave** — table-stakes Shape-A blocks.
6. **Pages content type** — `scope`-driven `page` type, wide-canvas default.
7. **Marketing-block wave** — hero, CTA, pricing, testimonial, features, stats.
8. **Nested layout** — `columns` / `section` containers (Shape B).

### Architecture decisions binding the whole program (ADR)

- **Two block shapes.** *Shape A* = structured-data blocks (props-driven,
  theme-rendered, no nesting). *Shape B* = layout containers that hold arbitrary
  other blocks (`columns`, `section`).
- **Contract in core, renderer in theme.** The block *contract* (tag + props
  schema + editor metadata + category) is canonical and lives in core, so
  Git-stored Markdoc content stays portable across themes. The *renderer*
  (`.astro` + CSS) belongs to the theme. Core ships a deliberately-plain
  default renderer; starter themes are the reference renderers.
- **Block source merge order:** core standard blocks → active theme
  (overrides renderer per tag; may add bespoke blocks) → site-local `blocks/`
  (overrides both). (Implemented in Foundation B.)
- **Width model:** body text stays at the readable measure; layout/marketing
  blocks break out via the existing `none/wide/full` alignment tiers. The
  editor canvas mirrors the front-end alignment CSS (true WYSIWYG).

## Global Constraints

- **Cloudflare-Pages / edge compatible.** `@setu/core` stays edge-safe — no
  Node/DOM. The `BlockCategory` enum and any category metadata added to core
  must compile under `tsconfig.edge.json` (no React, no DOM types).
- **Backward compatible.** `group` and `keywords` are **optional**. Existing
  blocks and any author's existing `blocks/` keep working with no change; a
  block with no `group` falls back to a default category.
- **No packaging changes.** Block discovery stays site-local
  (`import.meta.glob('../../../../blocks/*/block.ts')`) exactly as today. The
  core/theme source merge is Foundation B.

---

## The taxonomy (locked)

Seven categories, defined once in `@setu/core`. Ordering is the display order in
the grouped menu (content-editing categories first):

| id          | label       | admin icon | purpose                                              |
|-------------|-------------|------------|------------------------------------------------------|
| `text`      | Text        | `type`     | paragraphs, headings, lists, quote, code, callout    |
| `media`     | Media       | `image`    | image, gallery, video, audio, file, embed-as-media   |
| `layout`    | Layout      | `columns`  | columns, section, spacer, card, tabs, accordion      |
| `embed`     | Embeds      | `globe`    | oEmbed, map, gist, math, diagram                     |
| `dynamic`   | Dynamic     | `refresh`  | build-time content-index blocks (latest/related…)    |
| `marketing` | Marketing   | `rocket`   | hero, CTA, pricing, testimonial, features, stats     |
| `widget`    | Widgets     | `forms`    | forms, share, search (JS islands)                    |

`text` is also the **default** category for a block that declares no `group`.

### Core additions

**File: `packages/core/src/blocks/categories.ts` (new)**

```ts
/** The canonical block taxonomy. Ordering is the grouped-menu display order. */
export const BLOCK_CATEGORIES = [
  'text',
  'media',
  'layout',
  'embed',
  'dynamic',
  'marketing',
  'widget',
] as const

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]

/** Human label per category (presentation-agnostic; admin maps the icon). */
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: 'Text',
  media: 'Media',
  layout: 'Layout',
  embed: 'Embeds',
  dynamic: 'Dynamic',
  marketing: 'Marketing',
  widget: 'Widgets',
}

export const DEFAULT_BLOCK_CATEGORY: BlockCategory = 'text'

export function isBlockCategory(v: string): v is BlockCategory {
  return (BLOCK_CATEGORIES as readonly string[]).includes(v)
}
```

Re-export all four from `packages/core/src/index.ts`.

**File: `packages/core/src/config/types.ts` — `BlockEditorMeta`**

Tighten `group` from `string` to `BlockCategory` and add `keywords`:

```ts
export interface BlockEditorMeta {
  label?: string
  icon?: string
  /** Block category — drives slash-menu grouping. Defaults to 'text'. */
  group?: BlockCategory
  /** Extra search terms / aliases for the slash menu (e.g. ['img','photo']). */
  keywords?: string[]
  variants?: string[]
}
```

`define-block.ts` carries these through unchanged (it already spreads
`contract.editor`). `buildRegistry` already forwards `editor` verbatim — no
change needed there.

---

## Slash menu rebuild

### Data model

`SlashBlock` (in `apps/admin/src/editor/blocks.ts`) gains a category and search
terms so the menu can group and rank:

```ts
export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  group: BlockCategory
  keywords: string[]          // normalized lowercase; [] when none
  run: (editor: Editor, range: Range) => void
}
```

- **Built-in text/format blocks** get explicit groups: paragraph, headings,
  lists, quote, code, divider → `text`; Image → `media`; Table → `layout`.
  Keywords added for aliases (e.g. Image → `['img','photo','picture']`,
  Divider → `['hr','rule','separator']`, Table → `['grid']`).
- **Folder blocks** map `b.editor?.group ?? DEFAULT_BLOCK_CATEGORY` and
  `b.editor?.keywords ?? []`.

### Two render modes (one component)

The menu has exactly two states, switched on whether the query is empty:

**Empty query → grouped.** Walk `BLOCK_CATEGORIES` in order; for each category
with ≥1 block, render a `.slash-head` header (label) then its blocks in declared
order. Categories with no blocks are omitted.

**Non-empty query → flat ranked.** No headers. All blocks scored against the
query (see ranking), filtered to score > 0, sorted by score descending then by
original order. This is what makes the menu survive 50+ blocks — the author
types and gets the few relevant blocks ranked, regardless of category.

### Ranking

Normalize query and candidate fields to lowercase. Score each block by the best
match found (higher = better):

| match                                   | score |
|-----------------------------------------|-------|
| title equals query                      | 100   |
| title starts with query                 | 80    |
| a keyword equals query                  | 70    |
| title contains query                    | 50    |
| a keyword contains query                | 40    |
| subtitle contains query                 | 20    |
| no match                                | 0 (filtered out) |

Ties broken by the block's position in the unfiltered list (stable). This makes
`/img` surface Image (keyword-equals, 70) above an incidental substring hit, and
`/he` surface Heading-2 (title starts-with) first.

### Keyboard + ARIA

- Keep the existing cyclic `ArrowUp`/`ArrowDown`/`Enter`/`Escape` behavior, but
  index navigation runs over the **flattened list of selectable items**
  (headers are not selectable and are skipped). Build a render model that is an
  ordered array of rows where each row is either `{kind:'header', label}` or
  `{kind:'item', block, itemIndex}`; keyboard state indexes only `item` rows.
- `role="listbox"` on the container (unchanged); each item `role="option"` with
  `aria-selected`. Headers get `role="presentation"`.
- Selected item still `scrollIntoView({block:'nearest'})`.

### Migration of existing folder blocks

- `blocks/callout/block.ts`: add `group: 'text'`,
  `keywords: ['note','aside','admonition']` to its `editor` block.
- `blocks/notice/block.ts`: add `group: 'text'`, `keywords: ['banner','alert']`.

(Renderers and props unchanged.)

---

## Files

- **Create:** `packages/core/src/blocks/categories.ts` — enum, labels, default,
  guard.
- **Modify:** `packages/core/src/index.ts` — re-export the category API.
- **Modify:** `packages/core/src/config/types.ts` — `BlockEditorMeta.group`
  typed to `BlockCategory`; add `keywords`.
- **Modify:** `apps/admin/src/editor/blocks.ts` — `SlashBlock` gains
  `group`/`keywords`; assign groups+aliases to built-ins; map folder-block
  group/keywords; export a `slashRenderModel(query)` helper that returns the
  grouped-or-ranked row list.
- **Modify:** `apps/admin/src/editor/extensions/SlashCommand.tsx` — consume the
  render model: render headers + items, flatten for keyboard nav, filter via the
  ranking helper instead of `title.includes`.
- **Modify:** `apps/admin/src/styles/editor.css` — `.slash-head` already exists;
  add a `.slash-head` variant rule for *inline* group headers (the current one
  is the single top "Blocks" label — repurpose to per-group, with a small top
  border between groups).
- **Modify:** `blocks/callout/block.ts`, `blocks/notice/block.ts` — add
  `group` + `keywords`.
- **Test:** `packages/core/src/blocks/categories.test.ts`,
  `apps/admin/src/editor/slash-model.test.ts` (the pure ranking + grouping
  helper).

## Testing

The grouping + ranking logic must be a **pure function** (`slashRenderModel`)
extracted from the React component so it can be unit-tested without a DOM:

- Empty query → rows are category headers in `BLOCK_CATEGORIES` order, each
  followed by its blocks; empty categories omitted.
- `/img` → Image ranks above a block that merely contains "im" in its subtitle.
- `/he` → Heading blocks rank by title-starts-with before any keyword hit.
- A query matching nothing → empty item list (menu shows "No blocks").
- Keyword-equals outranks title-contains (score table honored).
- `categories.test.ts`: `isBlockCategory` guard, label completeness (every
  `BlockCategory` has a label), default is `'text'`.

Existing slash behavior (insert each built-in, insert callout/notice) must still
pass — the run() handlers are unchanged.

## Open questions

None blocking. Category icons are an admin-side concern (mapping
`BlockCategory → IconName`) and are fixed in the table above.
