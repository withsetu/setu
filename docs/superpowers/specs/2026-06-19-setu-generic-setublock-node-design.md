# Generic `setuBlock` node — #4 Slice B

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** render/theme **#4**, Slice B. Builds on Slice A (block auto-discovery + codegen,
merged `ba286d4`). Closes the gap Slice A left: a *brand-new, non-callout* folder block did not yet
work in the editor/round-trip (the converter hardcoded every tag to `callout`).

## Goal

A new folder block — defined once as `blocks/<tag>/` (`block.ts` contract + `<tag>.astro`) — works
**end-to-end** with no per-block code: it inserts from the slash menu, edits in-canvas via an
auto-generated form, round-trips byte-stably, and renders on the site (Slice A already gave it the
render + codegen). The proof block is **`notice`**, authored as **plain HTML (zero npm dependencies)**
— which both demonstrates the purest "drop a folder, it just works" case and deliberately sidesteps
the repo-root dependency-resolution friction (deferred to its own roadmap item; see Out of scope).

**Success:** drop `blocks/notice/`, run `pnpm dev` → `Notice` is in the slash menu; inserting it
creates a generic block with a tone/title auto-form + editable body; it serializes to
`{% notice tone="warn" %}…{% /notice %}`; reopening round-trips it back to that block (not a
passthrough); the site renders it — all with **no** edit to `setu.config`, `markdoc.config`, the
converters' callout branch, or any hand-written editor node.

## Verified before designing (standing rules)

- **Rule #1 (read source):** confirmed on `main` — `to-tiptap.ts:137` still hardcodes the `tag` case
  to `type: 'callout'`; `to-markdoc.ts:87` has only a `callout` case; the admin `registry`
  (`apps/admin/src/blocks/registry.ts`) already exposes `blocks` with `props`/`editor` per tag;
  `markdocAttributesFor` (Slice A, browser-safe, in the `@setu/core` barrel) already maps zod
  `props` → `{name: {type, matches?, default?}}` — reused here to drive the auto-form.
- **Rule #2 (Cloudflare + cost):** no new runtime/edge surface. Editor node is client-side; the
  block still renders to static HTML via Slice A's build-time codegen. Zero per-visitor cost.

## Architecture — three small units

### 1. Round-trip (`@setu/core`) — the generic node

Generalize `blockToTiptap`'s single `case 'tag'`:
- `node.tag === 'callout'` → the existing `callout` node (**unchanged** — frozen).
- any other tag (it only reaches here when it's in the injected `knownBlockTags`; unknown tags are
  already preserved as `passthrough` upstream) → `{ type: 'setuBlock', attrs: { tag, mdAttrs:
  node.attributes }, content: [...] }`.

`to-markdoc.ts` gains a `setuBlock` case mirroring `callout`: rebuild `{% <tag> %}…{% /<tag> %}`
from `attrs.tag` + `attrs.mdAttrs`. Round-trip stays byte-stable — content is only ever a tag name +
attribute bag + block children (content-safety intact).

### 2. Editor (`apps/admin`) — the generic node + auto-form

`createSetuBlock(blocks: ResolvedBlock[]): Node` — one Tiptap node `setuBlock`:
- attrs `{ tag, mdAttrs }` (JSON-only, kept out of the DOM, exactly like `callout`'s `mdAttrs`).
- node view = **generic chrome**: the block's label (`editor.label ?? tag`); an **auto-form** built
  from `markdocAttributesFor(contract.props)` — a text input per string attr, a `<select>` per enum
  attr (options from `matches`, seeded to the attr's `default`); editing a field writes `mdAttrs`
  (same pattern as `CalloutView.setAttrs`). Below it, an editable `<NodeViewContent>` body.
- **Missing-manifest degrade:** if a `setuBlock`'s `tag` has no registry entry (e.g. a saved draft
  whose block folder was later removed), the view renders the tag label + editable body with **no
  form** — never crashes, never drops the body.
- Registered in `Canvas.tsx` beside `Callout`.

The slash menu (Slice A `slashBlocks`) must insert the **right node type**: `callout` → a `callout`
node (its dedicated editor node); every other folder block → a `setuBlock` with `attrs.tag` set.
(Today `slashBlocks` inserts `type: b.tag` for all folder blocks — correct only for callout; this
slice routes non-callout tags to `setuBlock`.)

*In-canvas shows chrome, not the live `.astro`* — faithful render stays on the site + the Preview
tab (decided in the deferred HTML/Liquid analysis; rendering arbitrary template HTML with an
editable slot in-place is out of scope).

### 3. The proof block — `notice` (dependency-free)

`blocks/notice/`:
```yaml
# block.ts (defineBlock)
props: z.object({
  tone: z.enum(['info', 'warn', 'success']).default('info'),
  title: z.string().optional(),
})
editor: { label: 'Notice', icon: 'info' }
```
```astro
<!-- notice.astro — plain HTML, NO imports -->
const { tone = 'info', title } = Astro.props
<aside class={`notice notice-${tone}`}>
  {title && <p class="notice-title">{title}</p>}
  <div class="notice-body"><slot /></div>
</aside>
```
Zero bare imports → no resolver patches needed in any of the three tools. It exercises every Slice B
path: an enum attr (tone → `<select>` with a default) and an optional string (title → text input).

## Data flow

```
blocks/notice/{block.ts, notice.astro}
   ├─ registry (admin Vite glob, Slice A) ─▶ slash menu (insert setuBlock{tag:'notice'})
   │                                         setuBlock node view: markdocAttributesFor(props) → auto-form + body
   ├─ knownBlockTags (registry, injected into read-service, Slice A) ─▶ to-tiptap: 'notice' → setuBlock
   │                                                                     to-markdoc: setuBlock → {% notice %}
   └─ gen-blocks codegen (Slice A) ─▶ markdoc.config tag ─▶ notice.astro ─▶ static HTML
```

## Error handling

- **Unknown tag in content** (no folder): unchanged — preserved as `passthrough` (never dropped).
- **`setuBlock` with a tag absent from the registry** (folder removed after a draft was saved):
  node view degrades to label + editable body, no form; `to-markdoc` still serializes it from
  `attrs.tag` (content preserved).
- **A block whose `props` aren't a zod object:** `markdocAttributesFor` already throws (Slice A); the
  registry build would surface it. Not re-handled here.

## Testing

- **core:** `setuBlock` round-trip — `{% notice tone="warn" %}…{% /notice %}` → tiptap (`setuBlock`,
  `attrs.tag==='notice'`) → markdoc is byte-identical; callout still maps to the `callout` node
  (regression guard).
- **admin:** with the `notice` manifest in the registry — it appears in the slash menu and inserts a
  `setuBlock`; the node view renders a `tone` `<select>` (defaulted to `info`) + a `title` text input;
  editing them writes `mdAttrs`; serialization emits `{% notice %}`; a `setuBlock` with an
  unknown tag renders body-only without crashing. Existing callout tests stay green (frozen).
- **site:** add `{% notice tone="success" title="…" %}` to the `post/en/kitchen-sink` fixture; assert
  the rendered `<aside class="notice notice-success">` + title + body; the **30 existing render tests
  stay green** (callout etc. unchanged). `pnpm build` runs Slice A's `prebuild`→`gen-blocks` so the
  `notice` tag + `notice.astro` are wired automatically.

## Out of scope (deferred — see `docs/roadmap.md`)

- **`blocks/` location / packaging refactor** — only forced by a block with npm deps; `notice` is
  dep-free so this slice needs none.
- **Interactive / dependency blocks (Rung 3) + their edge endpoints** (the Stripe-style three-layer
  case) — its own sub-project with the edge topology.
- **Live in-canvas `.astro` render** and richer form controls (color/boolean/icon pickers, grouping).
- **`scope` enforcement** (the field stays inert, carried since Slice A).

## Success criteria (restated)

`blocks/notice/` is the *sole* definition of a working, editable, rendering block — added with no
framework/converter/config edits — proving the generic path. Callout remains bit-for-bit unchanged.
All existing tests green.
