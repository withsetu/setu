# Editor image block + round-trip — media slice #3

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#3** (see `docs/roadmap.md` → Media). Builds on the shipped upload
service (#2) and `StoragePort` (#1). The first block that actually *uses* the upload pipe: drop an
image in the editor → it renders there and on the site → round-trips as standard `![alt](src)`.

## Goal

Insert an image in the admin editor (via the upload service), edit its alt text, see it render in the
editor **and** on the published site, and have it round-trip losslessly as **standard `![alt](src)`
Markdown** — with **no content ever dropped** and **no host baked into committed content**.

## The content-model decisions (the spine — settled in brainstorm)

- **`src` = root-relative `/uploads/media/<id>/original.<ext>`** — the upload result URL with the host
  stripped (`new URL(result.url).pathname`). Portable, carries the media id, host-agnostic. Each
  surface prepends its **configured media origin** to render (editor → `VITE_SETU_API`; site/preview →
  a new `PUBLIC_SETU_MEDIA`). The `/uploads/` prefix is **env-mapped, never stored as a host** — dev
  points it at the API, prod points it at the CDN/R2; the same committed file works in both with **no
  content migration**. External/absolute srcs (hand-authored `![x](https://…)`) pass through untouched.
- **Why id-in-path (not a bare media id in content):** a bare id (`![cat](a7f3…)`) is a dead reference
  outside Setu — it breaks the portable-human-readable-files wedge (GitHub preview, plain Markdown
  viewers, migrations all see garbage). Embedding the id *in a working relative path* keeps the stable
  reference **and** stays portable; the future media registry (#4–#5) keys off that same id.
- **Images are an INLINE node, Markdoc-faithful.** Markdoc parses `![alt](src)` as an *inline* `image`
  node. We round-trip it as a Tiptap **inline image node**, NOT a block node. This is the
  **content-safe** choice: an image mixed into a text line (`text ![x](y) text`) must survive (the
  cardinal rule — never drop content), which a block-only node cannot represent. `/image` inserts into
  an (typically empty) paragraph, so it still *reads* as a figure.

## Verified before designing (standing rules)

- **Rule #1 (read source):** confirmed against the repo —
  - Round-trip lives in `packages/core/src/markdoc/`: `to-tiptap.ts` (`inlineToTiptap` switch +
    `blockToTiptap` switch) and `to-markdoc.ts` (`buildInline` + `buildBlock` switches, via
    `Markdoc.Ast.Node` + `Markdoc.format`). **No image case exists today** — a Markdoc `image` inline
    node currently falls through `inlineToTiptap`'s `default → []` and is **dropped**; `to-markdoc` has
    no image case. So adding both cases is the whole core change.
  - The content-safety **passthrough** mechanism is **block-level** (`isPreserve` raw-captures unknown
    *blocks*); it does **not** catch an inline image inside a known paragraph — which is exactly why the
    inline `image` case must be handled directly (a block-only image node would silently drop
    inline-mixed images).
  - Admin editor extensions are registered in `apps/admin/src/editor/Canvas.tsx`; custom nodes
    (`Callout`, `createSetuBlock`) are **hand-rolled** `Node.create` + `ReactNodeViewRenderer` — no
    `@tiptap/extension-image` is installed. A selection **bubble** pattern already exists
    (`LinkTools`). Slash entries are defined in `apps/admin/src/editor/blocks.ts` (`slashBlocks()`).
  - `apps/admin/src/media/upload-client.ts` exports `uploadFile(apiBase, file): Promise<UploadResult>`
    (`{ id, key, url, contentType, size, filename }`); admin reads the API base from
    `import.meta.env.VITE_SETU_API`.
  - Site Markdoc config is `apps/site/markdoc.config.mjs` (`nodes:` overrides like `paragraph`,
    `heading`; **no `nodes.image`** today). The dev **preview route** reuses this same config, so it
    inherits any `nodes.image` render for free.
- **Rule #2 (Cloudflare + cost):** the image renders as a **plain `<img>` at build (static, zero
  per-visitor cost)** — NO sharp / Astro `<Image>` optimization this slice (that's #4, and sharp can't
  run on Workers anyway). The upload service (#2) already enforces the size cap + content-type
  allowlist, so no new abuse surface. The `/uploads/` prefix resolving to a CDN on edge is the
  cost-safe prod story (static assets, no per-render transform).
- **No new dependency:** the image node is **hand-rolled** (mirrors `Callout`/`setuBlock`), so there's
  no `@tiptap/extension-image` version/compat/runtime check to clear.

## Architecture — four units

### 1. Core round-trip (`@setu/core/src/markdoc/`) — the only core change
- **`to-tiptap.ts` `inlineToTiptap`:** add `case 'image'` →
  `{ type: 'image', attrs: { src, alt, title } }` (an inline node). `alt` from `node.attributes.alt ??
  ''`; `title` from `node.attributes.title` carried only when present (don't synthesize).
- **`to-markdoc.ts` `buildInline`:** add `case 'image'` (Tiptap inline `image`) →
  `new Markdoc.Ast.Node('image', { src, alt, ...(title ? { title } : {}) })`, which `Markdoc.format`
  renders as `![alt](src)` (or `![alt](src "title")` when a title is present).
- **Byte-stable** both directions; `title` preserved (content-safety); an absolute/external `src`
  round-trips untouched. Edge-safe (pure AST/types — no Node/DOM; the core edge guard still passes).
- Core only maps the node type ⇄ Markdoc; it does **not** know the editor schema or the media origin
  (the admin registers the matching node; resolution to a display URL is a surface concern).

### 2. Admin image node + insert (`apps/admin/src/editor/`)
- **`extensions/Image.tsx`** — hand-rolled `Node.create({ name: 'image', inline: true, group:
  'inline', atom: true, draggable: true })` with attrs `{ src, alt, title }` (all JSON state; `src`
  parsed/rendered via `parseHTML: img[src]` / `renderHTML: ['img', …]` so copy-paste survives). A
  React node view (`ReactNodeViewRenderer`) renders `<img src={resolveForEditor(src)} alt={alt}>` where
  `resolveForEditor` prepends `import.meta.env.VITE_SETU_API` to a root-relative `/uploads/…` src
  (absolute srcs unchanged).
- **`/image` slash entry** (in `blocks.ts`) → opens a hidden `<input type="file" accept="image/*">` →
  on pick, `uploadFile(apiBase, file)` → if the result `contentType` starts with `image/`, insert
  `{ type: 'image', attrs: { src: new URL(result.url).pathname, alt: '', title: null } }`; else show an
  error. An uploading indicator shows during the request; a failed upload shows the error message and
  inserts nothing.
- **Alt editing** via an **image selection bubble** (mirrors `LinkTools`): when an image node is
  selected, a small popover shows an `alt` text field that writes the node's `alt` attr.
- Registered in `Canvas.tsx`'s extensions array.

### 3. Site render (`apps/site`)
- **`markdoc.config.mjs`:** add `nodes.image: { render: component('./src/components/Image.astro'),
  attributes: { src: { type: String }, alt: { type: String }, title: { type: String } } }`.
- **`src/components/Image.astro`:** resolve the src — prepend `import.meta.env.PUBLIC_SETU_MEDIA` when
  the src is a root-relative `/uploads/…` path; leave absolute/external (`http(s)://…`) srcs as-is —
  then emit `<img src={resolved} alt={alt} loading="lazy" decoding="async" />`. Plain `<img>`, no
  optimization. The dev preview route inherits this automatically (same config).

### 4. Config
- Site gets **`PUBLIC_SETU_MEDIA`** (default `http://localhost:4444`), wired into the root `pnpm dev`
  script alongside the other dev env vars. Admin already has `VITE_SETU_API`. (Both default to the
  local API origin; in prod each points at the CDN/media origin.)

## Data flow

```
/image → file picker → uploadFile(apiBase,file) → src = new URL(result.url).pathname
                                                       = /uploads/media/<id>/original.<ext>
  editor:  inline image node → <img src={VITE_SETU_API + src} alt>          (display)
  save:    inline image node → buildInline → ![alt](/uploads/media/<id>/original.<ext>)   (committed)
  load:    ![alt](…) → Markdoc image → inlineToTiptap → inline image node
  site:    nodes.image → Image.astro → <img src={PUBLIC_SETU_MEDIA + src} alt loading=lazy>
  external ![x](https://…) → stored + rendered verbatim (no prepend)
```

## Error handling

- Upload failure → the editor shows the error message (reusing the upload-client's thrown message);
  **nothing is inserted**. A non-`image/*` upload result → rejected with a message.
- Round-trip **never drops** an image — lone-paragraph or inline-mixed-with-text; a `title` attribute
  is preserved.
- An absolute/external src is rendered and round-tripped **as-is** (no media-origin prepend), so
  hand-authored external images keep working.

## Testing

- **Core (`packages/core`):** byte-stable round-trip tests (mirroring the existing markdoc round-trip
  suite) — (a) a lone-image paragraph `![alt](/uploads/media/x/original.png)` ⇄ inline image node;
  (b) an inline image **mixed with text** (`hello ![x](…) world`) survives both ways (content-safety);
  (c) `title` (`![a](src "t")`) is preserved; (d) an absolute external src
  (`![a](https://example.com/p.png)`) round-trips untouched.
- **Site (`apps/site`):** a render test that `nodes.image` resolves a root-relative `/uploads/…` src
  against `PUBLIC_SETU_MEDIA` and emits `<img … loading="lazy">`; an absolute src is emitted unchanged.
- **Admin (`apps/admin`):** the `/image` insert flow with `uploadFile` mocked — inserts an image node
  whose `src` is the **path-only** form (host stripped); a mocked upload error inserts nothing and
  shows the message; the alt bubble writes the `alt` attr; a doc containing an image round-trips
  (`tiptapToMarkdoc(toTiptap(md)) === md`).
- **Full repo green + typecheck**, including the `@setu/core` edge guard (the round-trip change is pure
  AST, no Node/DOM).

## Out of scope (later slices — recorded in `docs/roadmap.md`)

- **`ImagePort` / optimization (#4):** variants, srcset, responsive `<Image>`/`<Picture>`, focal point,
  quality/format. This slice emits a plain `<img>`; the render component is the seam #4 upgrades.
- **The media registry (#4–#5):** id → variants / locations / metadata. The id lives in the path, so
  the registry keys off it; content does not enumerate versions.
- **Media library picker / reuse (#5):** this slice **always uploads a fresh file**; browsing/reusing
  existing media comes later.
- **NORTH-STAR — a Gutenberg / Tiptap-Pro-grade figure block (owner ambition, 2026-06-19):** caption,
  alignment (left/center/wide/full), resize/width, link-on-click, focal point, lightbox. Plain
  `![alt](src)` **cannot** carry these — the rich block will be a **`{% figure %}` Setu tag** (still
  human-readable + lossless through core, but not vanilla Markdown for those images). It **coexists**
  with this slice's inline node as the heavier tier; this slice is its foundation, not a dead end.
- Drag-and-drop & paste-to-upload; insert-by-URL UI (the data model already supports external srcs);
  asset sync into the published static output (the draft→published bytes story).

## Success criteria

In the admin editor, `/image` uploads an image and inserts it; it renders in the editor (via
`VITE_SETU_API`) and, after publish, on the static site (via `PUBLIC_SETU_MEDIA`); alt text is editable
and round-trips; the committed Markdown is portable, host-free `![alt](/uploads/media/<id>/original.
<ext>)`; an image mixed inline with text and an external absolute image both round-trip without loss;
and nothing is dropped. All tests green.
