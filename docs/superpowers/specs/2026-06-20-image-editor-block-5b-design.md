# Editor image block — media slice #5b

**Date:** 2026-06-20
**Status:** approved (owner approved the design + scope; trust-as-approval per working style)
**Sub-project:** Media/Images **#5b** — the editor half of the rich `{% image %}` block. Makes the admin
editor author the figure #5a renders: uploading an image inserts a dedicated, in-place-editable block
(alignment, caption, alt), round-tripped to/from the `{% image %}` Markdoc tag. Follows the proven
**Callout** model (dedicated React node-view + toolbar + `mdAttrs` bag + a round-trip special-case).

## Goal

Uploading or inserting an image creates a block-level `{% image %}` figure the user edits inline —
choose alignment (`none|left|right|wide|full`), type a caption, set alt, and Replace the image — instead
of the bare inline `![]()` image shipped in #3. The block round-trips to the exact `{% image … /%}` tag
#5a already renders responsively. The inline `![]()` node stays for markdown-pasted / in-text images.

## The decisions this rests on (settled in brainstorm)

- **`imageBlock` is a block-level ATOM node** — no ProseMirror body. Caption is a **string attribute**
  (matching #5a's data model), edited via a React `<input>` in the node-view (the same technique
  Callout uses for its title). An atom avoids the forced-empty-body bug a `block+` node would create on a
  bodyless tag.
- **`image` becomes a known editor tag, but NOT a folder block.** Unlike callout (whose render lives in
  the `@setu/blocks` package), the `{% image %}` render needs apps/site's **build-time manifest read**
  (`SETU_MEDIA_DIR` via `ImageFigure.astro`/`Image.astro`), which cannot live in a repo-root `blocks/`
  folder. So the render stays exactly as #5a (the explicit `markdoc.config.mjs` `image` tag). #5b only
  adds the editor side: the node, the round-trip, and a small `image → knownBlockTags` injection.
- **Block-as-default on upload** (agreed in #5a): `imageNodeFromUpload` and the slash "Image" create
  `imageBlock`. Inline `![]()` (markdown paste / typed) stays the inline `image` node — both coexist.
- **No auto-conversion** of existing inline images to blocks, and no "turn into image block" action yet
  (YAGNI). Existing `![]()` content renders unchanged.
- **Node-view scope:** preview + 5-way alignment toolbar + caption input + alt input + Replace. Deferred
  (the #5a "later" list): drag-resize / display-width, link-on-click, lightbox, focal point.

## Verified before designing (against the current code)

- **Inline image node** (`apps/admin/src/editor/extensions/Image.tsx`): `name: 'image'`, inline atom,
  attrs `{ src, alt, title }`, React `ImageView` (img via `resolveMediaSrc`, alt input on select),
  `addStorage()` carries `onUploading`/`onError`. Stays as-is.
- **Insert flow** (`apps/admin/src/editor/image-insert.ts`): `imageNodeFromUpload(result)` returns a
  `{ type: 'image', attrs: { src, alt:'', title:null } }`; `pickImageAndInsert` opens a file picker →
  `uploadFile` → `editor.chain().insertContent(...)`. `srcFromUploadUrl` strips to the pathname.
- **Slash menu** (`apps/admin/src/editor/blocks.ts`): the BUILTIN "Image" entry calls
  `pickImageAndInsert(editor, VITE_SETU_API, editor.storage.image)`. Folder blocks map to `setuBlock`
  except `callout` (dedicated node).
- **Round-trip** (`packages/core/src/markdoc/to-tiptap.ts` / `to-markdoc.ts`): `case 'tag'` special-cases
  `callout` → `callout` node, else `setuBlock`; tags **not** in `knownBlockTags` become verbatim
  `passthrough` (`markdocToTiptap` gate at `to-tiptap.ts:180`). `to-markdoc` maps `callout` →
  `new N('tag', mdAttrs, children, 'callout')`.
- **`knownBlockTags`** is injected from `registry.knownBlockTags` into `createReadService`
  (`apps/admin/src/data/store.tsx:50`); the registry builds it from auto-discovered folder blocks
  (`apps/admin/src/blocks/registry.ts`). It is consumed **only** by `markdocToTiptap` (editor load) —
  the site render never uses it.
- **Callout node** (`apps/admin/src/editor/extensions/Callout.tsx`) is the node-view + toolbar template:
  `mdAttrs` bag (JSON-only, `renderHTML/parseHTML: () => ({})`), `useToolbarRoving` for toolbar a11y,
  a `setAttrs` merge helper that deletes emptied keys, inline `<input>` fields, `ReactNodeViewRenderer`.

## Architecture — units

### 1. `packages/core/src/markdoc/to-tiptap.ts` — map the tag to the node (modify)
In `blockToTiptap`'s `case 'tag'`, add an `image` special-case beside `callout` (reached only when
`image ∈ knownBlockTags`; otherwise the node is already a `passthrough`):
```ts
if (tag === 'callout') { return { type: 'callout', attrs: { mdAttrs: node.attributes }, content: kids } }
if (tag === 'image')   { return { type: 'imageBlock', attrs: { mdAttrs: node.attributes } } }   // atom: no content
return { type: 'setuBlock', attrs: { tag, mdAttrs: node.attributes }, content: kids }
```

### 2. `packages/core/src/markdoc/to-markdoc.ts` — map the node back to the tag (modify)
Add an `imageBlock` case beside `callout`, emitting a **childless** (self-closing) tag:
```ts
case 'imageBlock':
  return new N('tag', (attrs['mdAttrs'] ?? {}) as Record<string, unknown>, [], 'image')
```
(Empty children → Markdoc formats `{% image … /%}`, byte-exact with #5a content.)

### 3. `apps/admin/src/blocks/registry.ts` — register `image` as a known editor tag (modify)
After building the registry, ensure `image` is in `knownBlockTags` (it is not a folder block):
```ts
registry.knownBlockTags.add('image')   // dedicated imageBlock node; render stays site-side (#5a)
```
(Isolated to the editor load path; the site render is unaffected.)

### 4. `apps/admin/src/editor/extensions/ImageBlock.tsx` — the dedicated node + view (create)
```ts
export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() { return { mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) } } },
  addStorage() { return { apiBase: '' as string, onUploading: undefined, onError: undefined } },
  parseHTML() { return [{ tag: 'figure[data-setu-image-block]' }] },
  renderHTML({ HTMLAttributes }) { return ['figure', mergeAttributes(HTMLAttributes, { 'data-setu-image-block': '' })] },
  addNodeView() { return ReactNodeViewRenderer(ImageBlockView) },
})
```
**`ImageBlockView`** reads `mdAttrs = { src, alt, caption, align }` and renders (layout from the brainstorm):
- a `<figure class="setu-image-block align-${align}{ is-selected }">` wrapper (`contentEditable={false}`);
- the preview `<img src={resolveMediaSrc(src, apiBase)} alt={alt}>`;
- a **caption** `<input class="sib-caption" placeholder="Add a caption…">` (shown when selected or when
  caption non-empty) → `setAttrs({ caption })`;
- on select, a **toolbar** (`useToolbarRoving`, like Callout): five alignment buttons
  (`none|left|right|wide|full`, the active one marked) → `setAttrs({ align })`; an **alt** `<input>` →
  `setAttrs({ alt })`; a **Replace** button → opens the file picker, uploads via the stored `apiBase`,
  and `setAttrs({ src: srcFromUploadUrl(result.url) })` on the existing node.
- `setAttrs(patch)` merges into `mdAttrs` and deletes emptied `caption`/`alt` keys (Callout's pattern), so
  an empty caption/alt never serializes an attribute.

### 5. `apps/admin/src/editor/image-insert.ts` — upload creates the block (modify)
`imageNodeFromUpload` returns an `imageBlock`:
```ts
export interface ImageBlockSpec { type: 'imageBlock'; attrs: { mdAttrs: { src: string; align: 'none' } } }
export function imageNodeFromUpload(result: UploadResult): ImageBlockSpec {
  if (!result.contentType.startsWith('image/')) throw new Error(`not an image: ${result.contentType}`)
  return { type: 'imageBlock', attrs: { mdAttrs: { src: srcFromUploadUrl(result.url), align: 'none' } } }
}
```
(`pickImageAndInsert` is unchanged — it inserts whatever `imageNodeFromUpload` returns. `srcFromUploadUrl`
and the upload/error handlers are reused.)

### 6. `apps/admin/src/editor/Canvas.tsx` — register + wire the node (modify)
Add `ImageBlock` to the extensions list (beside `Image`), and wire its storage
(`apiBase`, `onUploading`, `onError`) the way the inline image's storage is wired today
(`Canvas.tsx:134-136`) so upload progress/errors surface and Replace has the API base. The slash "Image"
in `blocks.ts` keeps calling `pickImageAndInsert` (now via the imageBlock storage handlers).

### 7. Editor styling — the node-view CSS (modify the admin editor stylesheet)
`.setu-image-block` (figure margins, selected ring), `.setu-image-block img` (max-width:100%,
border-radius), `.sib-caption` (figcaption-styled input, centered), the alignment toolbar buttons
(reusing the existing `.block-props` toolbar styles Callout uses), and `align-left/right/wide/full`
editor-preview hints (a lightweight visual cue; the true break-out lives in the site theme). Exact file
located during planning (the admin editor CSS that already styles `.setu-image` / `.block-props`).

## Data flow
```
upload → imageNodeFromUpload → insert { imageBlock, mdAttrs:{src, align:'none'} }
  → user edits in node-view: align / caption / alt / Replace  (setAttrs → mdAttrs)
  → save: tiptapToMarkdoc(imageBlock) → {% image src=… alt=… caption=… align=… /%}
  → reload: markdocToTiptap (image ∈ knownBlockTags) → imageBlock   (round-trip closed)
  → site build: #5a ImageFigure.astro → responsive <figure><img srcset><figcaption>
```

## Error handling / content safety
- `imageBlock` is an atom → `to-markdoc` always emits a **self-closing** tag; no body is ever produced.
- Empty `caption`/`alt` are deleted from `mdAttrs` → never serialized as empty attributes.
- A non-image upload throws in `imageNodeFromUpload` (surfaced via `onError`) — unchanged from #3.
- With `image ∉ knownBlockTags` (any non-editor caller / default), `{% image %}` still round-trips as a
  verbatim **passthrough** — backward-compatible; existing tests for that path keep passing.
- Replace failures surface via `onError`; the node keeps its previous `src`.

## Testing
- **Core round-trip (`packages/core/test/image-block-roundtrip.test.ts`, rewrite):**
  - *default known (empty):* `{% image … /%}` → a single `passthrough`, byte-exact round-trip (the #5a
    guard, preserved).
  - *`knownBlockTags = {image}`:* `markdocToTiptap('{% image src="/uploads/media/x/original.jpg" alt="a"
    caption="c" align="wide" /%}\n')` → one `imageBlock` node with `mdAttrs = {src,alt,caption,align}` and
    **no `content`**; `tiptapToMarkdoc` returns the identical source (self-closing, no forced body).
  - an `imageBlock` with only `src` (no alt/caption) → `{% image src="…" /%}` (emptied keys absent).
- **Insert (`apps/admin`):** `imageNodeFromUpload` returns `{ type: 'imageBlock', attrs: { mdAttrs: {
  src: '/uploads/…', align: 'none' } } }` for an image upload, and throws for a non-image content-type.
- **Node view (`apps/admin`, testing-library, mirroring `Callout.test`):** renders the preview `img` with
  resolved src + alt; the alignment toolbar sets `mdAttrs.align`; the caption input updates
  `mdAttrs.caption` (and clearing it removes the key); the alt input updates `mdAttrs.alt`.
- Full repo `pnpm -r test` + `pnpm -r typecheck` green.

## Out of scope (later — roadmap)
Drag-resize / explicit display width, link-on-click, lightbox, focal point (#4d); a "turn into image
block" conversion for existing inline images; **#5½ human-readable media keys** (the `src` value the block
stores is whatever the upload returns — its *format* changes under #5½ but the block is agnostic to it).

## Success criteria
In the editor, uploading an image inserts an in-place-editable figure: pick alignment, type a caption, set
alt, Replace the image. Saving writes `{% image src=… alt=… caption=… align=… /%}`; reloading restores the
same block (round-trip closed, no forced body); the built site renders it as the #5a responsive
`<figure><img srcset><figcaption>`. Inline `![]()` images are unaffected. All tests green + typecheck.
