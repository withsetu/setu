# Editor Image Block #5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor author the `{% image %}` figure — uploading inserts a dedicated, in-place-editable `imageBlock` (alignment, caption, alt, Replace) that round-trips to/from the `{% image … /%}` tag #5a renders.

**Architecture:** A block-level **atom** Tiptap node `imageBlock` (no body; caption is a string attr) modeled on the existing Callout node. The Markdoc⇄Tiptap round-trip gains an `image`↔`imageBlock` special-case (beside `callout`); `image` is injected into the editor's `knownBlockTags`. The upload/insert flow creates `imageBlock` instead of the inline `image` node. The render is untouched (stays #5a's `ImageFigure.astro`).

**Tech Stack:** Tiptap (`@tiptap/core`, `@tiptap/react` `ReactNodeViewRenderer`), React, Vitest + `@testing-library/react`. Round-trip in `@setu/core` (`markdocToTiptap`/`tiptapToMarkdoc`).

## Global Constraints

- **`imageBlock` is a block-level ATOM** (`atom: true`, no content) — caption/alt/align/src live in an `mdAttrs` bag (JSON-only: `renderHTML/parseHTML: () => ({})`), exactly like Callout. Never give it `content` — that would force a body onto the bodyless `{% image %}` tag.
- **`to-markdoc` emits a self-closing tag**: `imageBlock` → `new N('tag', mdAttrs, [], 'image')` (empty children → `{% image … /%}`). Byte-exact with #5a content.
- **`image` special-case is reached only when `image ∈ knownBlockTags`** (else the node is already a verbatim `passthrough`). The default (empty `knownBlockTags`) keeps the #5a passthrough behavior — do not break it.
- **Empty `caption`/`alt` are deleted from `mdAttrs`** (Callout's `setAttrs` pattern) so they never serialize as empty attributes.
- **Inline `![]()` (`image` node) stays** for markdown-pasted / in-text images — do not remove or alter `apps/admin/src/editor/extensions/Image.tsx`.
- **Alignment set is exactly** `none | left | right | wide | full` (matches #5a), default `none`.
- **Render is out of scope** — do not touch `apps/site` / `ImageFigure.astro` / `markdoc.config.mjs`.
- **Commit trailer on every commit:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run all commands from the worktree root. Verify branch is `worktree-media-image-editor` in `.claude/worktrees/media-image-block` before any commit; never run `git checkout/switch/reset/merge`.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/core/src/markdoc/to-tiptap.ts` | Modify | `{% image %}` tag → `imageBlock` node (when known) |
| `packages/core/src/markdoc/to-markdoc.ts` | Modify | `imageBlock` node → self-closing `{% image … /%}` |
| `packages/core/test/image-block-roundtrip.test.ts` | Rewrite | passthrough (default) + node round-trip (known) |
| `apps/admin/src/editor/extensions/ImageBlock.tsx` | Create | the `imageBlock` node + React node-view |
| `apps/admin/src/editor/image-insert.ts` | Modify | shared pick/upload; `imageNodeFromUpload`→block; `replaceImage` |
| `apps/admin/test/image-insert.test.ts` | Modify | assert block spec + insert/replace |
| `apps/admin/src/editor/Canvas.tsx` | Modify | register `ImageBlock` + wire its storage |
| `apps/admin/src/styles/editor.css` | Modify | node-view styles (figure/caption/toolbar) |
| `apps/admin/test/image-block-node.test.tsx` | Create | node-view: align/caption/alt interactions |
| `apps/admin/src/blocks/registry.ts` | Modify | inject `image` into `knownBlockTags` |

---

### Task 1: Round-trip — `image` tag ↔ `imageBlock` node

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts` (the `case 'tag'` block, ~line 149)
- Modify: `packages/core/src/markdoc/to-markdoc.ts` (the `case 'callout'` area, ~line 93)
- Rewrite: `packages/core/test/image-block-roundtrip.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap(source, { knownBlockTags?: Set<string> })`, `tiptapToMarkdoc(doc)` from `@setu/core`.
- Produces: a tiptap node `{ type: 'imageBlock', attrs: { mdAttrs: Record<string,unknown> } }` (no `content`); serializes to `{% image … /%}`.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `packages/core/test/image-block-roundtrip.test.ts` with:
```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const KNOWN = { knownBlockTags: new Set(['image']) }
const rtKnown = (md: string) => tiptapToMarkdoc(markdocToTiptap(md, KNOWN))
const rtDefault = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

describe('{% image %} block — round-trip', () => {
  const full = `{% image src="/uploads/media/test/original.jpg" alt="A test cat" caption="A caption" align="wide" /%}\n`

  // Default (no editor block registered): stays a verbatim passthrough (the #5a behavior).
  it('default knownBlockTags → passthrough, byte-exact', () => {
    expect(rtDefault(full)).toBe(full)
    const doc = markdocToTiptap(full)
    expect(doc.content?.[0]?.type).toBe('passthrough')
  })

  // With the editor block registered: becomes an imageBlock atom node, no forced body.
  it('image ∈ knownBlockTags → a single imageBlock atom node carrying mdAttrs', () => {
    const doc = markdocToTiptap(full, KNOWN)
    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0]?.type).toBe('imageBlock')
    expect(doc.content?.[0]?.content).toBeUndefined()
    expect(doc.content?.[0]?.attrs?.mdAttrs).toEqual({
      src: '/uploads/media/test/original.jpg', alt: 'A test cat', caption: 'A caption', align: 'wide',
    })
  })

  it('imageBlock round-trips byte-exact (self-closing, no body)', () => {
    expect(rtKnown(full)).toBe(full)
  })

  it('an imageBlock with only src serializes a minimal self-closing tag', () => {
    const minimal = `{% image src="/uploads/media/test/original.jpg" /%}\n`
    expect(rtKnown(minimal)).toBe(minimal)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core test image-block-roundtrip`
Expected: FAIL — with `image` known, `markdocToTiptap` currently yields a `setuBlock` (not `imageBlock`), so the node-type and round-trip assertions fail.

- [ ] **Step 3: Map the tag to the node (to-tiptap)**

In `packages/core/src/markdoc/to-tiptap.ts`, in `case 'tag'`, add the `image` branch between the `callout` branch and the `setuBlock` fallback:
```ts
      if (tag === 'callout') {
        return { type: 'callout', attrs: { mdAttrs: node.attributes }, content: kids }
      }
      if (tag === 'image') {
        return { type: 'imageBlock', attrs: { mdAttrs: node.attributes } }
      }
      return { type: 'setuBlock', attrs: { tag, mdAttrs: node.attributes }, content: kids }
```

- [ ] **Step 4: Map the node back to the tag (to-markdoc)**

In `packages/core/src/markdoc/to-markdoc.ts`, add an `imageBlock` case beside `case 'callout':`:
```ts
    case 'imageBlock':
      return new N('tag', (attrs['mdAttrs'] ?? {}) as Record<string, unknown>, [], 'image')
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @setu/core test image-block-roundtrip`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck core**

Run: `pnpm --filter @setu/core typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/image-block-roundtrip.test.ts
git commit -m "feat(core): round-trip {% image %} tag <-> imageBlock node (#5b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `imageBlock` editor node + view + insert/replace plumbing

**Files:**
- Create: `apps/admin/src/editor/extensions/ImageBlock.tsx`
- Modify: `apps/admin/src/editor/image-insert.ts`
- Modify: `apps/admin/test/image-insert.test.ts`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Modify: `apps/admin/src/styles/editor.css`
- Create: `apps/admin/test/image-block-node.test.tsx`

**Interfaces:**
- Consumes: `ReactNodeViewRenderer`, `NodeViewWrapper` (`@tiptap/react`); `resolveMediaSrc` (`../media-src`); `useToolbarRoving` (`../useToolbarRoving`); `uploadFile`, `UploadResult` (`../media/upload-client`).
- Produces: `export const ImageBlock` (Tiptap Node, `name: 'imageBlock'`); `imageNodeFromUpload(result): { type: 'imageBlock'; attrs: { mdAttrs: { src: string; align: 'none' } } }`; `replaceImage(apiBase, handlers, onSrc, upload?)`; `pickAndUploadImage(apiBase, handlers, onResult, upload?)`.

- [ ] **Step 1: Write the failing insert test (update image-insert.test.ts)**

Replace the `imageNodeFromUpload` and `pickImageAndInsert` describe blocks in `apps/admin/test/image-insert.test.ts` with the versions below (keep the `srcFromUploadUrl` test and the imports, but change the `Image` import to `ImageBlock`):
```ts
import { ImageBlock } from '../src/editor/extensions/ImageBlock'
// ...keep srcFromUploadUrl describe as-is...

describe('imageNodeFromUpload', () => {
  it('builds an imageBlock spec with path-only src and align none', () => {
    expect(imageNodeFromUpload(result())).toEqual({
      type: 'imageBlock', attrs: { mdAttrs: { src: '/uploads/media/abc/original.png', align: 'none' } },
    })
  })
  it('throws when the upload result is not an image', () => {
    expect(() => imageNodeFromUpload(result({ contentType: 'application/pdf' }))).toThrow(/not an image/)
  })
})

describe('pickImageAndInsert', () => {
  function makeEditor() {
    return new Editor({ extensions: [StarterKit, ImageBlock], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  }
  it('uploads the picked file and inserts an imageBlock; reports busy true then false', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockResolvedValue(result())
    const onUploading = vi.fn(); const onError = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    pickImageAndInsert(editor, 'http://localhost:4444', { onUploading, onError }, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    const node = editor.getJSON().content?.find((n) => n.type === 'imageBlock')
    expect(node).toMatchObject({ type: 'imageBlock', attrs: { mdAttrs: { src: '/uploads/media/abc/original.png' } } })
    expect(onUploading.mock.calls).toEqual([[true], [false]])
    expect(onError).not.toHaveBeenCalled()
    editor.destroy()
  })
  it('reports the error and inserts nothing on a failed upload', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockRejectedValue(new Error('file too large'))
    const onError = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    pickImageAndInsert(editor, 'http://localhost:4444', { onError }, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'big.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    expect(onError).toHaveBeenCalledWith('file too large')
    expect(editor.getJSON().content?.find((n) => n.type === 'imageBlock')).toBeUndefined()
    editor.destroy()
  })
})

describe('replaceImage', () => {
  it('uploads the picked file and calls onSrc with the path-only src', async () => {
    const upload = vi.fn().mockResolvedValue(result({ url: 'http://localhost:4444/uploads/media/xyz/original.png' }))
    const onSrc = vi.fn(); const onUploading = vi.fn()
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})
    replaceImage('http://localhost:4444', { onUploading }, onSrc, upload)
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))
    expect(onSrc).toHaveBeenCalledWith('/uploads/media/xyz/original.png')
    expect(onUploading.mock.calls).toEqual([[true], [false]])
  })
})
```
Add `replaceImage` to the import line from `'../src/editor/image-insert'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test image-insert`
Expected: FAIL — `ImageBlock` and `replaceImage` don't exist; `imageNodeFromUpload` still returns a `type: 'image'` node.

- [ ] **Step 3: Refactor image-insert.ts (shared pick/upload, block spec, replace)**

Replace `apps/admin/src/editor/image-insert.ts` with:
```ts
import type { Editor } from '@tiptap/core'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function srcFromUploadUrl(url: string): string {
  return new URL(url).pathname
}

export interface ImageBlockSpec {
  type: 'imageBlock'
  attrs: { mdAttrs: { src: string; align: 'none' } }
}

export function imageNodeFromUpload(result: UploadResult): ImageBlockSpec {
  if (!result.contentType.startsWith('image/')) {
    throw new Error(`not an image: ${result.contentType}`)
  }
  return { type: 'imageBlock', attrs: { mdAttrs: { src: srcFromUploadUrl(result.url), align: 'none' } } }
}

export interface InsertHandlers {
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
}

/** Open an image file picker; on pick, upload via the media service and hand the result
 *  to `onResult`. Busy/error are reported through `handlers`. The single upload primitive. */
export function pickAndUploadImage(
  apiBase: string,
  handlers: InsertHandlers,
  onResult: (result: UploadResult) => void,
  upload: typeof uploadFile = uploadFile,
): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    handlers.onUploading?.(true)
    try {
      onResult(await upload(apiBase, file))
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      handlers.onUploading?.(false)
    }
  }
  input.click()
}

/** Pick + upload, then insert a new imageBlock at the selection. */
export function pickImageAndInsert(
  editor: Editor,
  apiBase: string,
  handlers: InsertHandlers = {},
  upload: typeof uploadFile = uploadFile,
): void {
  pickAndUploadImage(apiBase, handlers, (result) => {
    editor.chain().focus().insertContent(imageNodeFromUpload(result)).run()
  }, upload)
}

/** Pick + upload, then hand the new path-only src to `onSrc` (the node-view Replace action). */
export function replaceImage(
  apiBase: string,
  handlers: InsertHandlers,
  onSrc: (src: string) => void,
  upload: typeof uploadFile = uploadFile,
): void {
  pickAndUploadImage(apiBase, handlers, (result) => {
    if (!result.contentType.startsWith('image/')) {
      handlers.onError?.(`not an image: ${result.contentType}`)
      return
    }
    onSrc(srcFromUploadUrl(result.url))
  }, upload)
}
```

- [ ] **Step 4: Create the ImageBlock node + view**

Create `apps/admin/src/editor/extensions/ImageBlock.tsx`:
```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { resolveMediaSrc } from '../media-src'
import { useToolbarRoving } from '../useToolbarRoving'
import { replaceImage } from '../image-insert'

const ALIGNMENTS = ['none', 'left', 'right', 'wide', 'full'] as const

interface ImageBlockStorage {
  apiBase: string
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
}

function ImageBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const storage = editor.storage.imageBlock as ImageBlockStorage
  const apiBase = storage?.apiBase ?? ''
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const src = String(mdAttrs['src'] ?? '')
  const alt = String(mdAttrs['alt'] ?? '')
  const caption = String(mdAttrs['caption'] ?? '')
  const align = String(mdAttrs['align'] ?? 'none')

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['caption'] === '') delete next['caption']
    if (next['alt'] === '') delete next['alt']
    updateAttributes({ mdAttrs: next })
  }

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()
  const onReplace = () =>
    replaceImage(apiBase, { onUploading: storage?.onUploading, onError: storage?.onError }, (newSrc) => setAttrs({ src: newSrc }))

  return (
    <NodeViewWrapper>
      <figure className={`setu-image-block align-${align}`} contentEditable={false}>
        <div className="block-props" role="toolbar" aria-label="Image" ref={toolbarRef} onKeyDown={onToolbarKeyDown}>
          <span className="bp-label">Align</span>
          {ALIGNMENTS.map((a) => (
            <button
              key={a}
              type="button"
              className={`bp-align${align === a ? ' on' : ''}`}
              aria-label={`Align ${a}`}
              aria-pressed={align === a}
              data-toolbar-item
              onMouseDown={keepFocus}
              onClick={() => setAttrs({ align: a })}
            >
              {a}
            </button>
          ))}
          <span className="bp-sep" />
          <input
            className="sib-alt"
            placeholder="Alt text…"
            value={alt}
            onChange={(e) => setAttrs({ alt: e.target.value })}
          />
          <button type="button" className="bp-replace" data-toolbar-item onMouseDown={keepFocus} onClick={onReplace}>
            Replace
          </button>
        </div>
        <img className="sib-img" src={resolveMediaSrc(src, apiBase || undefined)} alt={alt} />
        <input
          className="sib-caption"
          placeholder="Add a caption…"
          value={caption}
          onChange={(e) => setAttrs({ caption: e.target.value })}
        />
      </figure>
    </NodeViewWrapper>
  )
}

/** The `{% image %}` block. Atom (no body) — schema matches the converter
 *  (packages/core/src/markdoc/to-tiptap.ts maps the tag to this node only when
 *  `image ∈ knownBlockTags`). `mdAttrs` (src/alt/caption/align) is JSON-only and
 *  round-tripped verbatim; to-markdoc serializes it self-closing. */
export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) } }
  },
  addStorage(): ImageBlockStorage {
    return { apiBase: '', onUploading: undefined, onError: undefined }
  },
  parseHTML() {
    return [{ tag: 'figure[data-setu-image-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-setu-image-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView)
  },
})
```

- [ ] **Step 5: Register the node + wire storage (Canvas.tsx)**

In `apps/admin/src/editor/Canvas.tsx`:
1. Add the import near the other extension imports: `import { ImageBlock } from './extensions/ImageBlock'`
2. Add `ImageBlock,` to the `extensions: [...]` array, right after `Image,`.
3. Extend the existing image-storage `useEffect` (the one at ~line 132 that sets `imgStorage.image.*`) to ALSO wire the imageBlock storage:
```ts
  useEffect(() => {
    if (!editor) return
    const s = editor.storage as unknown as {
      image: { onUploading?: (b: boolean) => void; onError?: (m: string) => void }
      imageBlock: { apiBase: string; onUploading?: (b: boolean) => void; onError?: (m: string) => void }
    }
    const onUploading = (busy: boolean) => { setImgBusy(busy); if (busy) setImgError(null) }
    const onError = (msg: string) => setImgError(msg)
    s.image.onUploading = onUploading
    s.image.onError = onError
    s.imageBlock.apiBase = (import.meta.env.VITE_SETU_API as string) ?? ''
    s.imageBlock.onUploading = onUploading
    s.imageBlock.onError = onError
  }, [editor])
```

- [ ] **Step 6: Add the node-view styles (editor.css)**

Append to `apps/admin/src/styles/editor.css`:
```css

/* {% image %} editor block (#5b) */
.setu-image-block { margin: 1.25rem 0; display: flex; flex-direction: column; gap: .5rem; }
.setu-image-block .sib-img { display: block; max-width: 100%; height: auto; border-radius: var(--r-md, 8px); }
.setu-image-block.align-left .sib-img,
.setu-image-block.align-right .sib-img { max-width: 50%; }
.setu-image-block.align-left { align-items: flex-start; }
.setu-image-block.align-right { align-items: flex-end; }
.setu-image-block .sib-caption {
  border: none; background: transparent; text-align: center; font-size: .9rem;
  color: var(--text-2, #666); width: 100%; padding: .15rem 0;
}
.setu-image-block .sib-caption:focus { outline: none; box-shadow: 0 1px 0 var(--accent, #4f46e5); }
.setu-image-block .bp-align {
  border: 1px solid var(--border, #ddd); background: var(--surface, #fff); color: var(--text-2, #555);
  font-size: .72rem; padding: .15rem .45rem; border-radius: var(--r-sm, 5px); cursor: pointer; text-transform: capitalize;
}
.setu-image-block .bp-align.on { background: var(--accent, #4f46e5); color: #fff; border-color: var(--accent, #4f46e5); }
.setu-image-block .sib-alt {
  border: 1px solid var(--border, #ddd); border-radius: var(--r-sm, 5px); padding: .15rem .4rem;
  font-size: .8rem; min-width: 8rem;
}
.setu-image-block .bp-replace {
  border: 1px solid var(--border, #ddd); background: var(--surface, #fff); border-radius: var(--r-sm, 5px);
  font-size: .75rem; padding: .15rem .5rem; cursor: pointer;
}
```

- [ ] **Step 7: Write the node-view test**

Create `apps/admin/test/image-block-node.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, ImageBlock],
    content: { type: 'doc', content: [{ type: 'imageBlock', attrs: { mdAttrs: { src: '/uploads/media/abc/original.png', align: 'none' } } }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

function mdAttrsOf(getJSON: () => unknown): Record<string, unknown> {
  const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
  return json.content.find((n) => n.type === 'imageBlock')?.attrs?.mdAttrs ?? {}
}

describe('ImageBlock node view', () => {
  it('renders the preview image with the resolved src', () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const img = document.querySelector('.sib-img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/uploads/media/abc/original.png')
  })

  it('the alignment buttons set mdAttrs.align', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    fireEvent.click(await screen.findByLabelText('Align wide'))
    expect(mdAttrsOf(getJSON).align).toBe('wide')
  })

  it('the caption input updates mdAttrs.caption, and clearing it removes the key', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const cap = await screen.findByPlaceholderText(/add a caption/i)
    fireEvent.change(cap, { target: { value: 'A caption' } })
    expect(mdAttrsOf(getJSON).caption).toBe('A caption')
    fireEvent.change(cap, { target: { value: '' } })
    expect(mdAttrsOf(getJSON).caption).toBeUndefined()
  })

  it('the alt input updates mdAttrs.alt', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    fireEvent.change(await screen.findByPlaceholderText(/alt text/i), { target: { value: 'A cat' } })
    expect(mdAttrsOf(getJSON).alt).toBe('A cat')
  })
})
```

- [ ] **Step 8: Run the admin tests to verify they pass**

Run: `pnpm --filter @setu/admin test image-insert image-block-node`
Expected: PASS (image-insert: 6 tests; image-block-node: 4 tests).

- [ ] **Step 9: Typecheck admin**

Run: `pnpm --filter @setu/admin typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/editor/extensions/ImageBlock.tsx apps/admin/src/editor/image-insert.ts apps/admin/test/image-insert.test.ts apps/admin/src/editor/Canvas.tsx apps/admin/src/styles/editor.css apps/admin/test/image-block-node.test.tsx
git commit -m "feat(admin): imageBlock editor node + upload-to-block + replace (#5b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Make the editor own `{% image %}` (knownBlockTags)

**Files:**
- Modify: `apps/admin/src/blocks/registry.ts`
- Test: `apps/admin/test/image-known-tag.test.ts` (create)

**Interfaces:**
- Consumes: `registry.knownBlockTags` (a `Set<string>` from `@setu/core`'s `buildRegistry`); `markdocToTiptap` from `@setu/core`.
- Produces: `registry.knownBlockTags` now contains `'image'`, so loading `.mdoc` with `{% image %}` yields an `imageBlock` (not a passthrough).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/image-known-tag.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '@setu/core'
import { registry } from '../src/blocks/registry'

describe('image is a known editor tag', () => {
  it('registry.knownBlockTags includes "image"', () => {
    expect(registry.knownBlockTags.has('image')).toBe(true)
  })

  it('loading {% image %} via the registry tags yields an imageBlock node', () => {
    const doc = markdocToTiptap(`{% image src="/uploads/media/x/original.jpg" align="wide" /%}\n`, {
      knownBlockTags: registry.knownBlockTags,
    })
    expect(doc.content?.[0]?.type).toBe('imageBlock')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test image-known-tag`
Expected: FAIL — `registry.knownBlockTags` does not contain `'image'`.

- [ ] **Step 3: Inject `image` into knownBlockTags**

In `apps/admin/src/blocks/registry.ts`, after the `export const registry = buildRegistry(...)` statement, add:
```ts
// `image` has a dedicated editor node (ImageBlock) but is NOT a folder block — its render
// needs apps/site's build-time manifest read (#5a). Register it as a known editor tag so the
// round-trip maps {% image %} to the imageBlock node instead of a passthrough.
registry.knownBlockTags.add('image')
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @setu/admin test image-known-tag`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/blocks/registry.ts apps/admin/test/image-known-tag.test.ts
git commit -m "feat(admin): register image as a known editor tag (#5b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Whole-slice verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm -r test`
Expected: all packages green (includes the rewritten `image-block-roundtrip`, the new `image-block-node`, `image-known-tag`, and updated `image-insert`).

- [ ] **Step 2: Full typecheck**

Run: `pnpm -r typecheck`
Expected: no errors across the workspace.

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: clean (all committed; dev-server scratch is gitignored).

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- `imageBlock` atom node + `mdAttrs` (spec unit 4) → Task 2 Step 4. ✅
- `to-tiptap` tag→node (spec unit 1) → Task 1 Step 3. ✅
- `to-markdoc` node→self-closing tag (spec unit 2) → Task 1 Step 4. ✅
- `image → knownBlockTags` (spec unit 3) → Task 3 Step 3. ✅
- upload creates block (spec unit 5) → Task 2 Step 3 (`imageNodeFromUpload`). ✅
- Canvas registration + storage (spec unit 6) → Task 2 Step 5. ✅
- node-view CSS (spec unit 7) → Task 2 Step 6. ✅
- guard test rewrite (spec Testing) → Task 1 Step 1. ✅
- node-view + insert tests (spec Testing) → Task 2 Steps 1, 7. ✅
- inline `![]()` untouched (Global Constraint) → no task modifies `Image.tsx`. ✅

**2. Placeholder scan:** none — every code/CSS/command step is concrete.

**3. Type consistency:** `imageBlock` node name, `mdAttrs` keys (`src/alt/caption/align`), and the upload spec `{ type: 'imageBlock', attrs: { mdAttrs: { src, align: 'none' } } }` match across Task 1 (round-trip assertions), Task 2 (node + insert), and Task 3 (known-tag load). `replaceImage(apiBase, handlers, onSrc, upload?)` and `pickAndUploadImage(apiBase, handlers, onResult, upload?)` signatures match between image-insert.ts (Task 2 Step 3) and ImageBlock.tsx / the test (Task 2 Steps 1, 4).
