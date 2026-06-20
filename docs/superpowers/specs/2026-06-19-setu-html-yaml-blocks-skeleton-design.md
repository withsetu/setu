# HTML+YAML component blocks — Slice 1: the walking skeleton

**Date:** 2026-06-19
**Status:** **DEFERRED (2026-06-19)** — superseded by the decision to author blocks/themes as plain **Astro components + strong authoring docs**, not a sandboxed template system. The driver: the elaborate authoring system only earns its keep once block authors are *untrusted/unreviewed* (AI in-product, non-coders, a marketplace). Until that's real, plain Astro components (full power, handles the rich 10% natively) + docs that teach an AI to author them safely are the leaner path. Revisit (LiquidJS, the safe/sandboxed engine — **not** Nunjucks, which its own docs call unsafe for user templates) when untrusted/marketplace authoring actually arrives. The security analysis below stands as the reference for that future decision.
**Sub-project:** render/theme **#4** — the auto-discovered, no-code-first component model.
First slice of several (see "Deferred" for the rest).

## Goal

Prove the **#4** vision end-to-end on the thinnest possible ground: a content block authored as
**one folder of two files** — a YAML contract and an HTML template, **no config edit, no React** —
works across all three planes:

1. **Editor** — it appears in the slash menu, inserts, renders in-canvas, and its attrs are editable
   via an auto-generated form.
2. **Round-trip** — it survives Markdoc ⇄ Tiptap byte-stably (content stays a clean `{% tag %}`).
3. **Site** — it renders through the real Astro + Markdoc pipeline into static HTML.

The proof block is `card`. Dropping `blocks/card/` makes `{% card %}` work everywhere with zero
wiring. That single demonstration is the deliverable.

> **Why this matters (owner's framing):** one folder, one contract = a human *or* an AI can author a
> block and physically cannot desync the three planes, because it never touches them. See the
> `setu-component-model` memory.

## Verified before designing (per the standing rules)

- **Rule #1 (check the docs/source first):** the three integration points were read directly, not
  recalled — `to-tiptap.ts` (every tag hardcoded to `callout`), `to-markdoc.ts` (the reverse),
  `markdoc.config.mjs` (hand-authored; its own comment names this the "#4 codegen" wall because
  `@astrojs/markdoc` loads the config through esbuild and cannot import `@setu/core`'s TS), the
  editor's runtime `defaultConfig` read in `blocks.ts`, and the React `Callout` node. The codegen
  wall is real and is why the site plane needs a build step the other two don't.
- **Rule #2 (Cloudflare Pages + cost-safe):** all new work is **build-time only**. The codegen runs
  in `predev`/`prebuild`; the published site stays **100% static HTML** with **zero per-visitor
  function cost**. There is no new runtime/edge surface in this slice. No bill risk.

## Scope — one block, `card`

A new top-level `blocks/` directory (the same place an end-user's scaffold will keep blocks). The
proof folder:

```
blocks/card/
  block.yaml      # the contract
  card.html       # the visual
```

```yaml
# blocks/card/block.yaml
tag: card
editor:
  label: Card
  icon: card
attrs:
  title: { type: string }
  href:  { type: string, optional: true }
```

```html
<!-- blocks/card/card.html -->
<article class="card">
  <h3 class="card-title">{{title}}</h3>
  <div class="card-body"><slot></slot></div>
</article>
```

**The callout is not touched.** It stays hand-built and React (`Callout.tsx`, `CalloutWrapper.astro`,
the `callout` branch in both converters, the hardcoded `markdoc.config.mjs` entry). This slice *adds
a generic HTML-folder lane beside it*; migrating callout into the folder convention is a later slice.
Keeping callout frozen keeps the working rich-block path off the risk surface.

## The engine — `@setu/core`

A new `src/blocks/` module, three small, independently testable pieces:

### `BlockManifest`
```ts
interface BlockAttr { type: 'string'; enum?: string[]; default?: string; optional?: boolean }
interface BlockManifest {
  tag: string                    // = folder name; unique
  template: string               // raw contents of <tag>.html
  attrs: Record<string, BlockAttr>
  editor?: { label?: string; icon?: string }
  kind: 'html'                   // skeleton only emits 'html'; 'react' reserved for callout-class later
}
```
`type` is `'string'` only for the skeleton (the two `card` attrs are strings); the parser rejects
other types with a clear error rather than silently accepting them, so the surface is honest.

### `loadBlockManifests(dir): BlockManifest[]` — node-side
Scans `dir/*/block.yaml`, parses YAML (the `yaml` package), reads the sibling `<tag>.html`, and
returns one manifest per folder. Pure given a directory; no globals. Fails loudly on a malformed
folder (missing html, bad yaml, tag ≠ folder name) — a broken block must not silently vanish.

### `attrsToZod(attrs): ZodTypeAny`
Converts the YAML `attrs` map to the zod `props` schema the existing `BlockDefinition` already
carries (`config/types.ts`). String → `z.string()`, `enum` → `z.enum`, `optional` → `.optional()`,
`default` → `.default()`. The author never sees zod.

### `renderTemplate(html, attrs, slotHtml): string` — **browser-safe**
The shared renderer both the editor node view and (indirectly) the codegen lean on. Semantics for
the skeleton, deliberately minimal:
- `{{name}}` → the HTML-escaped value of `attrs.name` (empty string if absent).
- exactly one `<slot></slot>` → replaced by `slotHtml` verbatim (caller supplies already-safe HTML).
- nothing else (no conditionals, loops, or filters yet — see Deferred).

Pure string→string, no DOM, no FS → runs in the browser bundle and in node.

## Plane 1 — Round-trip (`@setu/core`)

Generalize the converter's single `case 'tag'`:

- `node.tag === 'callout'` → the existing `callout` node (unchanged).
- `node.tag` ∈ `knownBlockTags` (and not callout) → a **generic `setuBlock` node**:
  `{ type: 'setuBlock', attrs: { tag, mdAttrs: node.attributes }, content: [...] }`.
- otherwise → passthrough (unchanged).

`markdocToTiptap` already takes `knownBlockTags`; the editor will pass the folder-derived set
(below), so core needs no FS access. `to-markdoc.ts` gains a `setuBlock` case that rebuilds the tag
from `attrs.tag` + `attrs.mdAttrs` (mirroring the `callout` case). Round-trip is byte-stable because
the content is only ever a tag name + attribute bag + block children.

## Plane 2 — Editor (`apps/admin`)

**Decision A — manifest delivery: Vite `import.meta.glob` (native, no codegen file).**
The browser can't scan the FS, so at admin build time we glob the block folders into the bundle:
```ts
const yamls = import.meta.glob('/../../blocks/*/block.yaml', { query: '?raw', import: 'default', eager: true })
const htmls = import.meta.glob('/../../blocks/*/*.html',   { query: '?raw', import: 'default', eager: true })
```
parse the YAML in-browser (`yaml` pkg) and assemble `BlockManifest[]` — the editor's source of
truth, replacing the hardcoded config block list for folder blocks. (The exact glob base path is an
implementation detail to pin during the plan; the contract is "the editor's blocks come from the
`blocks/` folder, not a hand list.") *Alternative considered: codegen a TS manifest the editor
imports — rejected as redundant when Vite globs natively.*

A generic **`setuBlock`** Tiptap node:
- attrs `{ tag, mdAttrs }` (JSON-only, kept out of the DOM, mirroring `callout`'s `mdAttrs`).
- a React node view that renders `renderTemplate(manifest.template, mdAttrs, ...)` with an editable
  `<NodeViewContent>` standing in for `<slot>`, and a **minimal auto-form** in the block toolbar:
  one text input per attr, a `<select>` for an `enum`. Editing a field writes `mdAttrs` — the same
  pattern `CalloutView`'s `setAttrs` uses.
- the slash menu (`blocks.ts`) lists every folder block automatically (label/icon from `editor`).

The callout node and its bespoke inline-title editing remain a separate, untouched extension.

## Plane 3 — Site render (`apps/site`)

**Decision B — codegen the HTML template into a generated `.astro` component per block.**
The translation is near-direct and rides Astro's real pipeline (escaping, slots, scoped CSS), exactly
like the existing `src/components/*.astro`:
- `{{name}}` → `{name}`; `<slot></slot>` → `<slot />`; a frontmatter `const { title, href } =
  Astro.props` destructure derived from `attrs`.
*Alternative considered: one generic runtime `<SetuBlock>` that `set:html`s the raw template — fewer
generated files, but it bypasses Astro slots/scoping and hand-rolls escaping. Rejected: lower-fidelity
render for no real gain.*

**Decision C — codegen runs as a build-time prestep, `scripts/gen-blocks.mjs`** (mirroring
`scripts/content-sandbox.mjs` — portable, dependency-light, node-only). It:
1. `loadBlockManifests('blocks')`,
2. writes `apps/site/src/blocks/<tag>.astro` per block (the translated template),
3. writes a generated include (e.g. `apps/site/markdoc.blocks.generated.mjs`) exporting the
   `{ tags }` map (each `tag` → `component('./src/blocks/<tag>.astro')` + attributes from `attrs`),
4. is wired as `predev` and `prebuild` in `apps/site`'s `package.json`, so it always runs before
   `astro dev`/`astro build`.

`markdoc.config.mjs` imports the generated include and spreads its `tags` alongside the existing
hand-authored ones (callout/sub/sup stay; `card` arrives generated). The generated dir + file are
**gitignored** (derived); the prestep guarantees they exist before Astro reads its config.
*Alternative considered: an Astro integration doing the codegen on `astro:config:setup` — rejected
because it races the markdoc config loader; the prestep is the established pattern in this repo.*

## Data flow (end to end)

```
blocks/card/{block.yaml, card.html}
        │
        ├─ gen-blocks.mjs (predev/prebuild) ──▶ apps/site/src/blocks/card.astro
        │                                       apps/site/markdoc.blocks.generated.mjs ──▶ markdoc.config.mjs ──▶ static HTML
        │
        ├─ import.meta.glob (admin build) ────▶ BlockManifest[] ──▶ slash menu + setuBlock node view + auto-form
        │
        └─ knownBlockTags (from manifests) ───▶ to-tiptap setuBlock ⇄ to-markdoc  (round-trip)
```

## Error handling

- **Malformed block folder** (missing `<tag>.html`, unparseable YAML, `tag` ≠ folder, unsupported
  attr `type`): `loadBlockManifests` throws with the folder name and reason. Codegen fails the build
  loudly; the editor glob assembly surfaces it in dev. A block never silently disappears.
- **Unknown tag in content** (no matching folder): unchanged behavior — round-trip preserves it as a
  passthrough block, so content is never dropped.
- **Missing attr in template** (`{{title}}` with no `title`): renders empty string, not a crash.

## Testing

- **core:** `loadBlockManifests` (happy + each malformed case throws), `attrsToZod` (string/enum/
  optional/default), `renderTemplate` (interpolation escapes, slot replacement, missing attr →
  empty), and the **`setuBlock` round-trip** — `{% card title="x" %}…{% /card %}` →
  tiptap → markdoc is byte-identical, with callout still round-tripping unchanged.
- **admin:** with the `card` manifest available, `card` appears in the slash menu, inserts a
  `setuBlock`, the node view renders the template + editable slot, the auto-form edits `title`/`href`
  into `mdAttrs`, and serialization emits the expected `{% card %}`.
- **site:** a render test that a doc containing `{% card %}` produces the expected `card.astro`
  output, **and the 30 existing render tests stay green and unchanged** (codegen left the build
  untouched). `gen-blocks.mjs` gets a script test (mirrors `content-sandbox.test.mjs`): given a
  fixture `blocks/` dir, it writes the expected `.astro` + include.

## Deferred (explicitly out of this slice)

- **Callout migration** into the folder convention (it becomes the `kind: 'react'` example).
- **Auto-form richness** beyond text/enum (color, boolean, icon pickers, grouping).
- **Theme/plugin-package block discovery** (blocks shipped by an installed package, not just repo
  `blocks/`).
- **JS islands / Rung 3** (`client:*`, Three.js/WebGL components).
- **Template engine growth** (conditionals, loops, filters, `variants:` logic maps).
- **Attr-value validation** at author/publish time (props schema exists; enforcement is later).
- **Removing the `setu.config` block array** as source of truth — the scan supersedes it across
  *all* blocks only once callout is migrated; this slice leaves both in place.

## Success criteria

Drop `blocks/card/`, run `pnpm dev`: `card` is in the slash menu, inserts and edits in the editor,
round-trips byte-stably, and renders on the site — with no edit to `setu.config.ts`,
`markdoc.config.mjs`, the converters' callout branches, or any hand-authored component. All existing
tests stay green.
