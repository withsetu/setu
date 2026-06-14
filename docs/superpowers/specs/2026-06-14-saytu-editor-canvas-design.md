# Design — Tiptap Editor Canvas (Increment #11)

_Date: 2026-06-14 · Status: approved_

## Purpose

Stand up Saytu's **content-editing surface** — the Tiptap block editor — on the
admin SPA, wired onto the complete backend engine (#1–#8) and the admin shell
(#9–#10). This is the product's centerpiece: a Notion/Linear-grade editor for
Markdoc content. The `/edit/:collection/:locale/:slug` route currently renders a
placeholder; this increment replaces it with a real editor that **opens a draft,
edits rich text + a config Callout block, preserves unknown Markdoc verbatim, and
autosaves so the work survives a reopen** — all running client-side on the
in-browser ports, with zero server.

## The architectural continuation

#9 proved the bet: the entire `@saytu/core` engine + in-memory adapters run in the
browser, and the SPA depends only on ports. #9 wired the **DataPort** (`db-memory`).
This increment needs the **GitPort** too (the read/fork service consumes it), so it
promotes an in-memory GitPort to a real, contract-tested adapter — exactly as #9
promoted `db-memory` — and composes the **read** (#7) and **authoring/lock** (#4)
services in the browser. After this slice the admin does the real
**load → edit → autosave → reopen** loop through the actual core services; #12 adds
the publish/open flow on top (and reuses `git-memory` verbatim).

## Scope

**In — the editor MVP vertical slice:**

- **`@saytu/git-memory`** — a new package: `createMemoryGitPort(seed?)`, the
  in-memory `GitPort` promoted from a fake to a real, browser-safe, contract-tested
  adapter (passes the existing `runGitPortContract`). Optionally seeded with files
  so the read service's fork-from-Git path is reachable in UAT.
- **Services context** in the admin app: build `data` (`db-memory`) + `git`
  (`git-memory`) once, construct `readService` (#7) + `authoringService` (#4), and
  expose them via a new `useServices()` hook returning `{ data, git, read,
  authoring }`. The existing `useData()` is **kept** (so `ContentList` is untouched)
  and re-implemented as a thin accessor over the same context.
- **The editor screen** on `/edit/:collection/:locale/:slug` (ported from
  `design/admin/editor.{jsx,css}`): a centered document canvas with an in-canvas
  title, a slim right-side metadata panel, and a top strip with a save-status
  indicator.
- **Load**: `readService.loadForEdit(ref)` → `draft` | `forked` | `absent`
  (absent → start a new blank draft in memory). Then `authoringService.open(ref,
  'local')` to acquire the pessimistic lock.
- **Tiptap canvas**: StarterKit + a custom **Callout** node + a custom
  **Passthrough** atom (the never-drop chip) + Placeholder + a **config-driven
  slash menu** (built-in blocks + the blocks from `resolveConfig(defaultConfig)`,
  i.e. Callout). The editor is seeded directly from `draft.content` (already
  Tiptap JSON).
- **Title** in the canvas, bound to `metadata.title`. **Metadata panel** (slim):
  Status (Draft/Staged/Deployed segmented), Slug (read-only display of the route
  slug for now — editing the slug/permalink is deferred), Locale (read-only).
- **Debounced autosave** through `authoringService.save({...ref, content:
  editor.getJSON(), metadata}, 'local')` (the save IS the lock refresh, per #4),
  with a "Saving… / Saved" indicator. Reopening the route shows the persisted
  draft.

**Out (the mockup includes these; each is its own later increment):**

- The **publish / open flow** (#12): the Draft→Staged→Deployed transition, a
  Publish button → `publishService` → in-browser Git, reopen-from-published.
- **Preview pane**, **focus mode**, **block-props panels** (Callout tone/icon
  pickers, the contextual toolbar above a selected block), a **bubble/format
  toolbar** (StarterKit keyboard shortcuts still work).
- **Command palette** (⌘K), **media / featured image**, **SEO**, **translations**,
  **categories/tags**, **Pro modals/chips beyond the passthrough**, **schedule**,
  **version history**, **raw-source viewer**, **drag-handle block reordering**.
- **Slug/permalink editing** + auto-redirects, **metadata field-schema validation**
  (metadata vs the collection's Zod fields), real auth (the editor id is the
  constant `'local'`).

## Why these choices

- **Promote `git-memory` (not inline, not skip-Git).** The read service requires a
  GitPort; the in-character move — proven by `db-memory` in #9 — is to promote the
  in-memory fake to a real package that passes `runGitPortContract`, so it provably
  behaves like `git-local`. It is reused verbatim by #12's publish flow. An inline
  throwaway would be untested and discarded; skipping Git would build a parallel
  DataPort-only load path we also discard. The contract suite is the whole point of
  the ports pattern.
- **The editor seeds from `draft.content` directly — no conversion at load.**
  `draft.content` is **already** `TiptapDoc` (ProseMirror JSON). `markdocToTiptap`
  runs only *inside* the read service when forking from Git. So the editor sets
  `content = draft.content` and never calls the converter itself.
- **Schema fidelity is the central risk, and it is pinned by the converter's
  source.** The editor's Tiptap schema must emit/consume exactly the node and mark
  shapes that `tiptapToMarkdoc`/`markdocToTiptap` expect — otherwise publish (#12)
  silently corrupts content (the CMS's cardinal sin). The converter was written
  against Tiptap StarterKit conventions, so the built-ins line up; the two custom
  nodes are specified byte-exactly below and guarded by a round-trip test.
- **Faithful CSS port, not re-Tailwinded** (the #9/#10 rule): port the editor
  canvas + slim metadata panel from `design/admin/editor.css` over the existing
  `tokens.css`. The prototype (`prototype/admin-editor/`) is a *pattern* reference
  for the Tiptap wiring (slash via `@tiptap/suggestion` + a React node view), not a
  copy source; its node attrs (`callout: inline*`, `passthrough: {label}`) are
  **wrong vs the engine** and must not be copied.
- **Autosave over an explicit Save button.** Notion-grade feel; the authoring
  service already treats every save as the lock refresh (#4), so debounced autosave
  is the natural fit. A subtle status indicator communicates state.
- **All editor dependencies are MIT / public-npm — no Tiptap account or SaaS.**
  Everything used here (`@tiptap/core`, `@tiptap/react`, `@tiptap/pm`,
  `@tiptap/starter-kit`, `@tiptap/suggestion`, `@tiptap/extension-placeholder`,
  `@tiptap/extension-link`) is open-source on public npm; the throwaway prototype
  already installs/runs them with no token. Tiptap's paid tier (`@tiptap-pro/*`
  extensions like drag-handle, Tiptap Cloud collaboration/AI) is **not** used — and
  drag-handle block reordering is deferred partly for this reason, keeping Saytu's
  100%-open-source promise intact.

## Architecture

```
packages/git-memory/                 # @saytu/git-memory (NEW — mirrors db-memory)
├── package.json                      # deps: @saytu/core; dev: @saytu/git-testing, vitest, ts
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── adapter.ts                    # createMemoryGitPort(seed?): GitPort
│   └── index.ts
└── test/contract.test.ts             # runGitPortContract(() => createMemoryGitPort()) + seed test

apps/saytu-admin/
├── package.json                      # + @tiptap/{core,react,pm,starter-kit,suggestion},
│                                     #   @tiptap/extension-placeholder, tippy.js; + @saytu/git-memory
└── src/
    ├── data/store.tsx                # GROWS: builds data+git adapters, constructs read+authoring
    │                                 #   services, exposes useServices() (+ existing useData())
    ├── editor/
    │   ├── EditorScreen.tsx          # route component: load → lock → canvas + title + meta panel + save
    │   ├── Canvas.tsx                # Tiptap useEditor + EditorContent; extension wiring
    │   ├── extensions/
    │   │   ├── Callout.tsx           # Node.create 'callout' + React node view
    │   │   ├── Passthrough.tsx       # Node.create 'passthrough' (atom, read-only) + node view
    │   │   └── SlashCommand.tsx      # Extension + Suggestion + config-driven CommandList (ARIA listbox)
    │   ├── MetaPanel.tsx             # slim: Status segmented + Slug/Locale (read-only)
    │   ├── useAutosave.ts            # debounce editor/metadata changes → authoringService.save
    │   └── blocks.ts                 # the slash-menu block list = built-ins + resolveConfig(defaultConfig)
    └── styles/editor.css             # ported canvas + meta-panel + callout + passthrough chip CSS
```

The route changes from `/edit/*` (placeholder) to
`/edit/:collection/:locale/:slug` rendering `EditorScreen`. `EditorScreen` owns the
load/lock/save orchestration and React state (the loaded `Draft`, `metadata`, save
status); `Canvas` owns the Tiptap instance; the extensions are independently
testable schema units.

## The editor Tiptap schema (the crux)

`editor.getJSON()` must be consumable by `tiptapToMarkdoc`, and `draft.content`
(from `markdocToTiptap`) must load as editor content. Ground truth is
`packages/core/src/markdoc/{to-tiptap,to-markdoc}.ts`.

**Built-ins (StarterKit — names already match the converter):**

| Node/mark | Converter shape it must match |
| --- | --- |
| `paragraph` | inline content |
| `heading` | `attrs.level` |
| `bulletList` / `orderedList` → `listItem` | each `listItem` = a single `paragraph` (the converter reads `item.content[0].content` only — no nested lists in V1) |
| `blockquote` | block content |
| `codeBlock` | `attrs.language: string \| null`; text child |
| `horizontalRule` | leaf |
| `hardBreak` | node (not a mark) |
| marks `bold`/`italic`/`strike`/`code` | no attrs |
| mark `link` | `attrs.href` — add `@tiptap/extension-link` if StarterKit v3 doesn't include it |

**Custom node `callout`:**
- `name: 'callout'`, `group: 'block'`, `content: 'block+'`, `defining: true`.
- `addAttributes` → `mdAttrs: { default: {} }` (a `Record<string, unknown>` bag;
  the converter round-trips it verbatim and always serializes the tag as
  `{% callout %}`).
- React node view: `NodeViewWrapper` (the design's `.blk-callout` shell, icon from
  `mdAttrs` if present) + `NodeViewContent` for the editable block children. Tone/
  icon **pickers are deferred** — the node *preserves* `mdAttrs`, it just doesn't
  yet offer UI to change them.

**Custom node `passthrough` (never-drop):**
- `name: 'passthrough'`, `group: 'block'`, `atom: true`, `selectable: true`.
- `addAttributes` → `raw: { default: '' }`, `flagged: { default: false }`.
- React node view: `NodeViewWrapper` with `contentEditable={false}` — renders the
  design's dynamic/Pro chip showing the raw source in a `<code>` and a flagged
  state when `flagged` is true. The node is selectable/deletable (movable) but its
  content is never editable, and `tiptapToMarkdoc` emits `attrs.raw` verbatim.

## Data flow

1. **Mount** `EditorScreen` for `{collection, locale, slug}` from the route params.
2. `readService.loadForEdit(ref)`:
   - `draft` → use it; `forked` → a new draft was persisted from Git HEAD;
   - `absent` → construct an in-memory blank `Draft` (`content: { type:'doc',
     content:[{ type:'paragraph' }] }`, `metadata: {}`, `baseSha: null`) so a brand-
     new entry (the "New post" route, slug not yet in DataPort or Git) opens to an
     empty canvas. (It is persisted on first autosave.)
3. `authoringService.open(ref, 'local')` → acquire the lock. Single-user, so
   `granted` is expected; if `blocked` (defensive), render the canvas **read-only**
   with a banner.
4. Seed Tiptap `content = draft.content`; seed `title`/`metadata` state from
   `draft.metadata`.
5. On editor change or metadata change → **debounced** (~800 ms) `useAutosave` →
   `authoringService.save({ ...ref, content: editor.getJSON(), metadata, baseSha:
   draft.baseSha }, 'local')`; flip the indicator Saving→Saved; also flush on blur/
   unmount.
6. Navigating away and back re-runs the load and shows the persisted draft (the
   headline UAT loop). `release` on unmount is best-effort (optional for MVP —
   single user; lock TTL covers it).

## Error handling / edge cases

- **`absent`** → blank in-memory draft, not a crash; persisted on first save.
- **Lock `blocked`** (won't happen single-user) → read-only canvas + a banner; no
  save attempts.
- **Unknown/advanced Markdoc** → already arrives as a `passthrough` node; the chip
  renders it read-only and it round-trips verbatim. The editor never constructs a
  `passthrough` from user input in this slice (the slash menu's "dynamic" item is
  deferred with the Pro flow).
- **Autosave race** → debounce + a single in-flight guard (don't overlap saves; the
  latest content wins). A save returning `blocked` stops further autosaves and
  surfaces the banner.
- **Empty title** → metadata.title may be absent; the canvas shows the title
  placeholder and the content list already falls back to the slug.
- **Never lose content** (cardinal rule) → the schema round-trip test is the
  guard; the passthrough atom guarantees unknown content is preserved.

## Testing (behavior; visual fidelity = UAT)

- **`@saytu/git-memory`**: `runGitPortContract(() => createMemoryGitPort())` (the
  shared GitPort battery) + a seed test (a seeded adapter returns the seeded file
  from `readFile` and a stable `headSha`).
- **Schema round-trip (the key risk)** — a unit test in the app (or core-adjacent):
  a `TiptapDoc` containing `callout` (with `mdAttrs`) + `passthrough` (`raw`,
  `flagged`) + headings/lists/marks → set as editor content → `editor.getJSON()`
  preserves every node type + `mdAttrs`/`raw`/`flagged`; and
  `tiptapToMarkdoc(editor.getJSON())` reproduces the original Markdoc source.
- **Callout / Passthrough extensions**: the callout renders its children editable
  and preserves `mdAttrs`; the passthrough renders `contentEditable=false`, shows
  `raw`, and reflects `flagged`.
- **SlashCommand**: the command list includes the built-in blocks + the config
  Callout (from `resolveConfig(defaultConfig)`); selecting Callout inserts a
  `callout` node; ARIA `role="listbox"`/`option` + keyboard nav.
- **EditorScreen** (services mocked/injected via context): loads a seeded draft and
  renders its blocks + title; an edit triggers a debounced `save` with the right
  args and flips the indicator; an `absent` ref opens a blank canvas; a `blocked`
  open renders read-only.
- **Reopen loop**: save → unmount → remount → the persisted content is shown.
- All existing admin tests (#9/#10, 14) + the core/db/git suites stay green;
  app typecheck (`verbatimModuleSyntax` → `import type`; `noUncheckedIndexedAccess`)
  + build clean; brand fonts preserved.

## Definition of done

- `pnpm --filter @saytu/git-memory test` green (contract + seed); the new package is
  contract-equivalent to `git-local`.
- `pnpm --filter @saytu/admin test` green (existing 14 + the editor/schema/slash/
  extension tests); `pnpm --filter @saytu/admin typecheck` clean; `pnpm --filter
  @saytu/admin build` succeeds with the brand fonts still in `dist/index.html`.
- `pnpm test` + `pnpm typecheck` repo-wide unaffected for #1–#10.
- `pnpm dev`: navigating to a content-list row opens the editor with the draft's
  content; typing autosaves; a Callout can be inserted via `/`; an unknown-Markdoc
  chip renders read-only; leaving and returning shows the saved work
  (product-owner UAT).
- Committed via the subagent-driven flow; `git-memory` follows the package pattern
  (#3/#5).

## Note on scope rhythm

This is a larger increment (a new package + the editor screen + three Tiptap
extensions), comparable to #9. It is decomposed into tight, independently-testable
tasks in the plan: (1) `git-memory` package, (2) services context, (3) the Tiptap
schema + custom nodes + the round-trip guard, (4) the slash menu, (5) the editor
screen + metadata panel + autosave, (6) the CSS port. The publish flow (#12) is
deliberately excluded so this slice stays reviewable and the editor sits on a
proven load/save loop before the Git write-path is wired to a button.
