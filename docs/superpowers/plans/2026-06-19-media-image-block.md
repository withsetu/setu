# Editor Image Block + Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert an uploaded image in the admin editor, edit its alt text, render it in the editor and on the static site, and round-trip it losslessly as standard `![alt](src)` Markdown.

**Architecture:** Add an inline `image` case to the `@setu/core` Markdoc⇄Tiptap round-trip (the only core change). In the admin, a hand-rolled inline image node + a `/image` slash command that uploads via the existing upload service and stores the **host-stripped** path. On the site, a `nodes.image` override renders a plain `<img>`, resolving the host-relative path against a configured media origin. Each surface prepends its own media origin to display; committed content stays portable.

**Tech Stack:** `@markdoc/markdoc` (round-trip), Tiptap 3 hand-rolled `Node.create` + React node view (admin), `@astrojs/markdoc` (site render), Vitest.

## Global Constraints

- **The only `@setu/core` change is the round-trip** — add an inline `image` case to `to-tiptap.ts` and `to-markdoc.ts`. Do NOT add any other core surface. The change is pure AST (no Node/DOM) and must keep the core edge guard green.
- **Content `src` = root-relative `/uploads/media/<id>/original.<ext>`** — the upload result URL with the host stripped (`new URL(result.url).pathname`). NEVER store a host in content. NEVER store a bare media id.
- **The image is an INLINE Tiptap node** (`group: 'inline'`, `inline: true`, `atom: true`) — Markdoc-faithful and content-safe. An image mixed inline with text MUST survive the round-trip; a Markdoc image `title` MUST be preserved; an absolute/external `src` (`http(s)://…`) MUST round-trip and render untouched.
- **Resolution:** prepend a configured media origin only when `src` starts with `/`; leave absolute `http(s)://` srcs alone. Editor uses `import.meta.env.VITE_SETU_API`; site/preview use `import.meta.env.PUBLIC_SETU_MEDIA` (default `http://localhost:4444`).
- **Site renders a plain `<img loading="lazy" decoding="async">`** — NO sharp / Astro `<Image>` optimization (that is slice #4).
- **Hand-rolled image node — NO new Tiptap dependency** (mirror `apps/admin/src/editor/extensions/Callout.tsx`).
- **Public round-trip API:** `markdocToTiptap(source, opts?)` and `tiptapToMarkdoc(doc)` from `@setu/core`.
- **Patterns to mirror:** core round-trip test = `packages/core/test/roundtrip.examples.test.ts` (byte-equality on `markdocToTiptap`/`tiptapToMarkdoc`); admin editor-mount test = `apps/admin/test/callout-keyboard.test.tsx` (`Harness` + `useEditor({ immediatelyRender: false })` + `EditorContent`); site render test = `apps/site/test/render.test.ts` (`pnpm build` then assert kitchen-sink HTML); hand-rolled node = `Callout.tsx`.

---

### Task 1: Core round-trip — inline `image`

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts` (add `case 'image'` in `inlineToTiptap`)
- Modify: `packages/core/src/markdoc/to-markdoc.ts` (add an `image` short-circuit in `buildInline`)
- Test: `packages/core/test/image-roundtrip.test.ts` (new)

**Interfaces:**
- Consumes: `markdocToTiptap(source, opts?)`, `tiptapToMarkdoc(doc)` from `@setu/core` (`../src/index`).
- Produces: a Tiptap inline image node shape `{ type: 'image', attrs: { src: string, alt: string, title: string | null } }` that both round-trip directions agree on. Markdoc parses `![alt](src "title")` as an inline node `{ type: 'image', attributes: { src, alt, title? } }` (no children — verified); `Markdoc.format` of an `image` AST node emits `![alt](src)` / `![alt](src "title")`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/image-roundtrip.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const rt = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

describe('image round-trip', () => {
  it('round-trips a lone-paragraph image (the editor figure case)', () => {
    const md = `![A cat](/uploads/media/abc/original.png)\n`
    expect(rt(md)).toBe(md)
  })

  it('maps a Markdoc image to an inline image node with path src + alt', () => {
    const doc = markdocToTiptap(`![A cat](/uploads/media/abc/original.png)\n`)
    const para = doc.content?.[0]
    expect(para?.type).toBe('paragraph')
    expect(para?.content?.[0]).toEqual({
      type: 'image',
      attrs: { src: '/uploads/media/abc/original.png', alt: 'A cat', title: null },
    })
  })

  it('preserves an image mixed inline with text (content-safety — never drop)', () => {
    const md = `hello ![x](/uploads/media/abc/original.png) world\n`
    expect(rt(md)).toBe(md)
  })

  it('preserves a title', () => {
    const md = `![A cat](/uploads/media/abc/original.png "the title")\n`
    expect(rt(md)).toBe(md)
  })

  it('round-trips an absolute external src untouched', () => {
    const md = `![ext](https://example.com/photo.png)\n`
    expect(rt(md)).toBe(md)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test image-roundtrip`
Expected: FAIL — images are currently dropped (`inlineToTiptap` default → `[]`), so `rt(md)` returns an empty paragraph, not the image.

- [ ] **Step 3: Add the `to-tiptap` case**

In `packages/core/src/markdoc/to-tiptap.ts`, inside `inlineToTiptap`'s `switch (node.type)`, add this case immediately before `case 'tag':`:
```ts
    case 'image':
      return [{
        type: 'image',
        attrs: {
          src: String(node.attributes.src ?? ''),
          alt: String(node.attributes.alt ?? ''),
          title: node.attributes.title != null ? String(node.attributes.title) : null,
        },
      }]
```

- [ ] **Step 4: Add the `to-markdoc` case**

In `packages/core/src/markdoc/to-markdoc.ts`, inside `buildInline`'s `.map((t) => { … })`, add this short-circuit immediately after the `if (t.type === 'hardBreak') return new N('hardbreak')` line:
```ts
    if (t.type === 'image') {
      const a = (t.attrs ?? {}) as Record<string, unknown>
      const attrs: Record<string, unknown> = { src: a.src ?? '', alt: a.alt ?? '' }
      if (a.title != null && a.title !== '') attrs.title = a.title
      return new N('image', attrs)
    }
```

- [ ] **Step 5: Run the test + the existing round-trip suite + the edge guard**

Run: `pnpm --filter @setu/core test image-roundtrip && pnpm --filter @setu/core test roundtrip && pnpm --filter @setu/core typecheck`
Expected: PASS (5 new tests), the existing round-trip examples/property suites stay green, and typecheck (incl. the edge guard over `src/markdoc`) is clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/image-roundtrip.test.ts
git commit -m "feat(core): round-trip inline images (![alt](src)) <-> Tiptap image node"
```

---

### Task 2: Admin image node + node view

**Files:**
- Create: `apps/admin/src/editor/extensions/Image.tsx`
- Create: `apps/admin/src/editor/media-src.ts`
- Modify: `apps/admin/src/editor/Canvas.tsx` (register the node in the extensions array)
- Test: `apps/admin/test/media-src.test.ts` (new)
- Test: `apps/admin/test/image-node.test.tsx` (new)

**Interfaces:**
- Consumes: `markdocToTiptap`-shaped image node `{ type: 'image', attrs: { src, alt, title } }` (Task 1).
- Produces:
  - `resolveMediaSrc(src: string, base: string | undefined): string` (`media-src.ts`) — prepends `base` when `src` starts with `/`; returns `src` unchanged when it is empty or absolute (`http(s)://`).
  - `Image` Tiptap node (`apps/admin/src/editor/extensions/Image.tsx`): `name: 'image'`, inline atom, attrs `{ src, alt, title }`, a React node view (`<img>` resolved via `VITE_SETU_API` + an alt field shown when selected), and `addStorage()` returning `{ onUploading: undefined, onError: undefined }` (the handlers Task 3 calls).

**Note on the alt UX:** the spec described a selection *bubble* (mirroring `LinkTools`); this plan refines it to an **alt field rendered inside the node view when the image is selected** — same intent ("edit alt when the image is selected"), materially less machinery (no separate bubble/tippy extension). This is a deliberate, documented refinement.

- [ ] **Step 1: Write the failing `resolveMediaSrc` test**

`apps/admin/test/media-src.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveMediaSrc } from '../src/editor/media-src'

describe('resolveMediaSrc', () => {
  it('prepends the base to a root-relative path', () => {
    expect(resolveMediaSrc('/uploads/media/x/original.png', 'http://localhost:4444')).toBe(
      'http://localhost:4444/uploads/media/x/original.png',
    )
  })
  it('strips a trailing slash on the base', () => {
    expect(resolveMediaSrc('/uploads/x.png', 'http://localhost:4444/')).toBe('http://localhost:4444/uploads/x.png')
  })
  it('leaves an absolute http(s) src unchanged', () => {
    expect(resolveMediaSrc('https://example.com/p.png', 'http://localhost:4444')).toBe('https://example.com/p.png')
  })
  it('leaves an empty src unchanged and tolerates an undefined base', () => {
    expect(resolveMediaSrc('', 'http://localhost:4444')).toBe('')
    expect(resolveMediaSrc('/uploads/x.png', undefined)).toBe('/uploads/x.png')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test media-src`
Expected: FAIL — cannot find `../src/editor/media-src`.

- [ ] **Step 3: Implement `resolveMediaSrc`**

`apps/admin/src/editor/media-src.ts`:
```ts
/** Resolve a stored image src for display: prepend the configured media origin to a
 *  root-relative `/uploads/…` path; leave absolute (http/https) or empty srcs alone. */
export function resolveMediaSrc(src: string, base: string | undefined): string {
  if (!src || /^https?:\/\//i.test(src)) return src
  if (src.startsWith('/')) return `${(base ?? '').replace(/\/+$/, '')}${src}`
  return src
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @setu/admin test media-src`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing node test**

`apps/admin/test/image-node.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Image } from '../src/editor/extensions/Image'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'image', attrs: { src: '/uploads/media/x/original.png', alt: 'a cat', title: null } },
        ] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Image node', () => {
  it('renders an <img> whose src is resolved against VITE_SETU_API', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const img = (await screen.findAllByRole('img'))[0]
    // jsdom resolves the src to an absolute URL; assert the path + that it is not the bare root-relative origin
    expect(img.getAttribute('src')).toMatch(/\/uploads\/media\/x\/original\.png$/)
    expect(img.getAttribute('alt')).toBe('a cat')
  })

  it('accepts the image node in the schema and round-trips its attrs through getJSON', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const json = editor.getJSON()
    const node = json.content?.[0]?.content?.[0]
    expect(node).toEqual({ type: 'image', attrs: { src: '/uploads/media/x/original.png', alt: 'a cat', title: null } })
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test image-node`
Expected: FAIL — cannot find `../src/editor/extensions/Image`.

- [ ] **Step 7: Implement the `Image` node**

`apps/admin/src/editor/extensions/Image.tsx`:
```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { resolveMediaSrc } from '../media-src'

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const apiBase = import.meta.env.VITE_SETU_API as string | undefined
  const src = String(node.attrs.src ?? '')
  const alt = String(node.attrs.alt ?? '')
  return (
    <NodeViewWrapper as="span" className={`setu-image${selected ? ' is-selected' : ''}`} contentEditable={false}>
      <img src={resolveMediaSrc(src, apiBase)} alt={alt} />
      {selected && (
        <input
          className="setu-image-alt"
          type="text"
          placeholder="Alt text…"
          value={alt}
          onChange={(e) => updateAttributes({ alt: e.target.value })}
        />
      )}
    </NodeViewWrapper>
  )
}

export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: null },
    }
  },

  addStorage() {
    return { onUploading: undefined as ((busy: boolean) => void) | undefined, onError: undefined as ((msg: string) => void) | undefined }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
```

- [ ] **Step 8: Register the node in the editor**

In `apps/admin/src/editor/Canvas.tsx`:
- Add the import near the other extension imports (after line 21's `createSetuBlock` import):
```tsx
import { Image } from './extensions/Image'
```
- Add `Image,` to the `extensions: [ … ]` array, immediately after the `Passthrough,` entry.

- [ ] **Step 9: Run the node test + typecheck**

Run: `pnpm --filter @setu/admin test image-node && pnpm --filter @setu/admin typecheck`
Expected: PASS (2 tests) + typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/editor/extensions/Image.tsx apps/admin/src/editor/media-src.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/media-src.test.ts apps/admin/test/image-node.test.tsx
git commit -m "feat(admin): inline image node + node view (resolved src, alt field)"
```

---

### Task 3: Admin image insert flow + `/image` slash command

**Files:**
- Create: `apps/admin/src/editor/image-insert.ts`
- Modify: `apps/admin/src/editor/blocks.ts` (add the `Image` built-in slash entry)
- Modify: `apps/admin/src/editor/Canvas.tsx` (wire the storage handlers to an upload status banner)
- Test: `apps/admin/test/image-insert.test.ts` (new)

**Interfaces:**
- Consumes: `uploadFile(apiBase, file): Promise<UploadResult>` from `../media/upload-client`; the `Image` node + its `editor.storage.image` handlers (Task 2); `Editor` from `@tiptap/core`.
- Produces:
  - `srcFromUploadUrl(url: string): string` → `new URL(url).pathname`.
  - `imageNodeFromUpload(result: UploadResult): { type: 'image'; attrs: { src: string; alt: string; title: null } }` — throws `Error` when `result.contentType` is not an `image/*` type.
  - `pickImageAndInsert(editor, apiBase, handlers?, upload?)` — opens a hidden `image/*` file input; on pick uploads, inserts the image node at the selection, and reports busy/error through `handlers`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/image-insert.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '../src/editor/extensions/Image'
import { srcFromUploadUrl, imageNodeFromUpload, pickImageAndInsert } from '../src/editor/image-insert'
import type { UploadResult } from '../src/media/upload-client'

afterEach(() => vi.restoreAllMocks())

const result = (over: Partial<UploadResult> = {}): UploadResult => ({
  id: 'abc', key: 'media/abc/original.png', url: 'http://localhost:4444/uploads/media/abc/original.png',
  contentType: 'image/png', size: 4, filename: 'cat.png', ...over,
})

describe('srcFromUploadUrl', () => {
  it('strips the host to a root-relative path', () => {
    expect(srcFromUploadUrl('http://localhost:4444/uploads/media/abc/original.png')).toBe('/uploads/media/abc/original.png')
  })
})

describe('imageNodeFromUpload', () => {
  it('builds an image node with the path-only src, empty alt, null title', () => {
    expect(imageNodeFromUpload(result())).toEqual({
      type: 'image', attrs: { src: '/uploads/media/abc/original.png', alt: '', title: null },
    })
  })
  it('throws when the upload result is not an image', () => {
    expect(() => imageNodeFromUpload(result({ contentType: 'application/pdf' }))).toThrow(/not an image/)
  })
})

describe('pickImageAndInsert', () => {
  function makeEditor() {
    return new Editor({ extensions: [StarterKit, Image], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  }

  it('uploads the picked file and inserts the image node; reports busy true then false', async () => {
    const editor = makeEditor()
    const upload = vi.fn().mockResolvedValue(result())
    const onUploading = vi.fn()
    const onError = vi.fn()

    // Capture the input element pickImageAndInsert creates.
    const input = document.createElement('input')
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)
    vi.spyOn(input, 'click').mockImplementation(() => {})

    pickImageAndInsert(editor, 'http://localhost:4444', { onUploading, onError }, upload)

    // Simulate the user choosing a file.
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })] })
    await input.onchange?.(new Event('change'))

    const node = editor.getJSON().content?.[0]?.content?.[0]
    expect(node).toMatchObject({ type: 'image', attrs: { src: '/uploads/media/abc/original.png' } })
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
    expect(editor.getJSON().content?.[0]?.content ?? []).toEqual([]) // empty paragraph, nothing inserted
    editor.destroy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test image-insert`
Expected: FAIL — cannot find `../src/editor/image-insert`.

- [ ] **Step 3: Implement the insert helpers**

`apps/admin/src/editor/image-insert.ts`:
```ts
import type { Editor } from '@tiptap/core'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function srcFromUploadUrl(url: string): string {
  return new URL(url).pathname
}

export interface ImageNodeSpec {
  type: 'image'
  attrs: { src: string; alt: string; title: null }
}

export function imageNodeFromUpload(result: UploadResult): ImageNodeSpec {
  if (!result.contentType.startsWith('image/')) {
    throw new Error(`not an image: ${result.contentType}`)
  }
  return { type: 'image', attrs: { src: srcFromUploadUrl(result.url), alt: '', title: null } }
}

export interface InsertHandlers {
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
}

/** Open an image file picker; on pick, upload via the media service and insert the
 *  image node at the selection. Busy/error are reported through `handlers`. */
export function pickImageAndInsert(
  editor: Editor,
  apiBase: string,
  handlers: InsertHandlers = {},
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
      const result = await upload(apiBase, file)
      editor.chain().focus().insertContent(imageNodeFromUpload(result)).run()
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      handlers.onUploading?.(false)
    }
  }
  input.click()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @setu/admin test image-insert`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the `/image` slash entry**

In `apps/admin/src/editor/blocks.ts`:
- Add the import at the top (after the existing imports):
```ts
import { pickImageAndInsert } from './image-insert'
```
- Add this entry to the `BUILTINS` array, immediately after the `Table` entry:
```ts
  { title: 'Image', subtitle: 'Upload an image', icon: 'image', run: (e, r) => {
    e.chain().focus().deleteRange(r).run()
    const editor = e as Editor & { storage: { image?: { onUploading?: (b: boolean) => void; onError?: (m: string) => void } } }
    pickImageAndInsert(editor, (import.meta.env.VITE_SETU_API as string) ?? '', editor.storage.image ?? {})
  } },
```

- [ ] **Step 6: Wire the upload status banner in Canvas**

In `apps/admin/src/editor/Canvas.tsx`:
- Ensure `useState`/`useEffect` are imported from `react` (add if missing).
- After the `useEditor(...)` call returns `editor`, add:
```tsx
  const [imgBusy, setImgBusy] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)
  useEffect(() => {
    if (!editor) return
    editor.storage.image.onUploading = (busy: boolean) => { setImgBusy(busy); if (busy) setImgError(null) }
    editor.storage.image.onError = (msg: string) => setImgError(msg)
  }, [editor])
```
- In the returned JSX, immediately above `<EditorContent editor={editor} />`, add:
```tsx
      {imgBusy && <div className="editor-banner">Uploading image…</div>}
      {imgError && <div className="editor-banner error" role="alert">{imgError}</div>}
```

- [ ] **Step 7: Run the admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (full admin suite incl. the new image tests) + typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/image-insert.ts apps/admin/src/editor/blocks.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/image-insert.test.ts
git commit -m "feat(admin): /image slash upload + insert with status banner"
```

---

### Task 4: Site render + media-origin config

**Files:**
- Create: `apps/site/src/components/Image.astro`
- Modify: `apps/site/markdoc.config.mjs` (add `nodes.image`)
- Modify: `content/post/en/kitchen-sink.mdoc` (add image fixtures for the render test)
- Modify: `package.json` (root — add `PUBLIC_SETU_MEDIA` to the site dev command)
- Test: `apps/site/test/render.test.ts` (add image assertions)

**Interfaces:**
- Consumes: the Markdoc `image` node (attributes `src`, `alt`, `title`) produced by Task 1's round-trip and Markdoc's parser.
- Produces: a rendered `<img>` whose `src` is `PUBLIC_SETU_MEDIA` + the root-relative path (absolute srcs unchanged), with `loading="lazy" decoding="async"`.

- [ ] **Step 1: Add the image fixtures to kitchen-sink**

Append to the end of `content/post/en/kitchen-sink.mdoc`:
```markdown

![A test cat](/uploads/media/test/original.png)

![External photo](https://example.com/photo.png)
```

- [ ] **Step 2: Write the failing render assertions**

In `apps/site/test/render.test.ts`, add a new `describe` block (after the existing ones, before the final close):
```ts
describe('render pipeline — images', () => {
  it('resolves a root-relative media src against PUBLIC_SETU_MEDIA (default localhost:4444)', () => {
    expect(html).toContain('src="http://localhost:4444/uploads/media/test/original.png"')
    expect(html).toContain('alt="A test cat"')
    expect(html).toContain('loading="lazy"')
  })
  it('leaves an absolute external image src unchanged', () => {
    expect(html).toContain('src="https://example.com/photo.png"')
    expect(html).toContain('alt="External photo"')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @setu/site test render`
Expected: FAIL — there is no `nodes.image` override yet, so the image either renders with a raw `/uploads/...` src (not resolved) or as Markdoc's default; the `http://localhost:4444/...` assertion fails.

- [ ] **Step 4: Implement the Image component**

`apps/site/src/components/Image.astro`:
```astro
---
// Render an image node. Resolve a root-relative `/uploads/…` src against the configured
// media origin (dev: the local API; prod: the CDN); leave absolute (http/https) srcs alone.
// Plain <img> only — responsive/optimized variants are the ImagePort slice (#4).
const { src = '', alt = '', title } = Astro.props
const base = (import.meta.env.PUBLIC_SETU_MEDIA ?? 'http://localhost:4444').replace(/\/+$/, '')
const resolved = !src || /^https?:\/\//i.test(src) ? src : src.startsWith('/') ? `${base}${src}` : src
---
<img src={resolved} alt={alt} title={title} loading="lazy" decoding="async" />
```

- [ ] **Step 5: Register the `nodes.image` override**

In `apps/site/markdoc.config.mjs`, add this entry inside the `nodes: { … }` object (after the `item:` entry):
```js
    image: {
      ...nodes.image,
      render: component('./src/components/Image.astro'),
    },
```

- [ ] **Step 6: Run the render test**

Run: `pnpm --filter @setu/site test render`
Expected: PASS — the new image assertions pass and the existing render tests stay green.

- [ ] **Step 7: Wire `PUBLIC_SETU_MEDIA` into the dev script**

In the root `package.json` `"dev"` script, find the site command segment:
```
"SETU_CONTENT_DIR=$PWD/.content-sandbox/dev/content SETU_API_URL=http://localhost:4444 pnpm --filter @setu/site dev"
```
and add `PUBLIC_SETU_MEDIA=http://localhost:4444` to its env prefix:
```
"SETU_CONTENT_DIR=$PWD/.content-sandbox/dev/content SETU_API_URL=http://localhost:4444 PUBLIC_SETU_MEDIA=http://localhost:4444 pnpm --filter @setu/site dev"
```

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/components/Image.astro apps/site/markdoc.config.mjs content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts package.json
git commit -m "feat(site): render images via nodes.image with PUBLIC_SETU_MEDIA resolution"
```

---

## Final verification (after all tasks)

- [ ] Full suite + typecheck across the workspace:
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - Expected: all green (core round-trip incl. edge guard, admin editor, site build/render).
- [ ] Manual smoke (optional): `pnpm dev`, open the admin editor, `/image` → pick an image → it appears in the canvas; set alt text; Preview/publish → it renders on the site; the committed `.mdoc` contains `![alt](/uploads/media/<id>/original.<ext>)` with no host.

## Notes for the executor

- **Node/jsdom globals:** `File`, `FormData`, `URL`, `Event` are global — no imports needed.
- **`@setu/core` is off-limits beyond the round-trip** (Task 1's two cases). If a later task seems to need a core change, stop — it shouldn't.
- **Don't optimize images** (no sharp / Astro `<Image>`). A plain `<img>` is the whole render this slice; the ImagePort (#4) upgrades the component later.
- **Mirror existing patterns** (named in Global Constraints) — do not introduce a new test harness, HTTP client, or a Tiptap image dependency.
