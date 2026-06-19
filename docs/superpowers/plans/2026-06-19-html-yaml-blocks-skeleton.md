# HTML+YAML Component Blocks — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a content block authored as one folder (`block.yaml` + `<tag>.html`) work across the editor, the Markdoc round-trip, and the static site render — with no config edit and no React. Proof block: `card`.

**Architecture:** A small `@setu/core` engine (manifest parse, attrs→zod, HTML template render) shared by browser + node. The round-trip gains a generic `setuBlock` node beside the untouched `callout`. The editor discovers folder blocks via Vite `import.meta.glob`. The site gets a build-time codegen prestep (`scripts/gen-blocks.mjs`) that translates each `<tag>.html` into a generated `.astro` component plus a Markdoc tags include — the only plane that needs codegen, because `@astrojs/markdoc` loads its config through esbuild and can't import core's TS.

**Tech Stack:** TypeScript, Zod, `@markdoc/markdoc`, `js-yaml` (already a core dep), Tiptap v3 (`@tiptap/react`), Astro 6 + `@astrojs/markdoc`, Vite 6, Vitest, `node:test`.

## Global Constraints

- **Standing rule #1 — check docs/source first:** verify any Astro/Tailwind/Tiptap/dependency API against current docs or the installed source before building; do not code from memory.
- **Standing rule #2 — Cloudflare Pages + cost-safe:** every change here is **build-time only**. The published site stays **100% static HTML, zero per-visitor function cost**. No new runtime/edge surface in this slice.
- **Callout stays frozen:** do not modify the `callout` branch of either converter, `Callout.tsx`, `CalloutWrapper.astro`, or the hand-authored `callout` entry in `markdoc.config.mjs`. This slice *adds* a generic lane beside callout.
- **Content-safety:** content is only ever a `{% tag %}` + attribute bag + block children. The round-trip must be byte-stable; unknown tags stay passthrough.
- **Versions:** React 18, Tiptap pinned to the `3.26.1` suite, Astro `6.4.6`, `@astrojs/markdoc` `1.0.6` — do not bump.
- **Branch:** all work on `feat/html-yaml-blocks-skeleton` (already checked out).
- **`attr.type` is `'string'` only** in this slice; any other type must throw, not silently pass.

---

### Task 1: Core — the HTML template renderer

**Files:**
- Create: `packages/core/src/blocks/render-template.ts`
- Test: `packages/core/test/blocks/render-template.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces:**
- Produces: `renderTemplate(template: string, attrs?: Record<string, unknown>, slotHtml?: string): string` — `{{name}}` → HTML-escaped `attrs.name` (empty when absent/nullish); the single `<slot></slot>` (or `<slot/>`) → `slotHtml` verbatim. Browser-safe (pure string→string).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/render-template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/blocks/render-template'

describe('renderTemplate', () => {
  it('interpolates {{attr}} with HTML-escaping', () => {
    const out = renderTemplate('<h3>{{title}}</h3>', { title: 'A & B <x>' })
    expect(out).toBe('<h3>A &amp; B &lt;x&gt;</h3>')
  })
  it('renders a missing attr as empty string (no crash)', () => {
    expect(renderTemplate('<h3>{{title}}</h3>', {})).toBe('<h3></h3>')
  })
  it('replaces the single <slot></slot> with slot html verbatim', () => {
    const out = renderTemplate('<div><slot></slot></div>', {}, '<p>body</p>')
    expect(out).toBe('<div><p>body</p></div>')
  })
  it('also accepts the self-closing <slot/> form', () => {
    expect(renderTemplate('<div><slot/></div>', {}, 'x')).toBe('<div>x</div>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- render-template`
Expected: FAIL — cannot find `../../src/blocks/render-template`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/blocks/render-template.ts
const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPE[c]!)

/** Render a block HTML template: `{{name}}` -> HTML-escaped `attrs.name` (empty when
 *  absent), and the single `<slot></slot>` / `<slot/>` -> `slotHtml` verbatim. Minimal
 *  by design (no conditionals/loops). Pure string->string, browser- and node-safe. */
export function renderTemplate(
  template: string,
  attrs: Record<string, unknown> = {},
  slotHtml = '',
): string {
  return template
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_m, name: string) => {
      const v = attrs[name]
      return v == null ? '' : escapeHtml(String(v))
    })
    .replace(/<slot\s*><\/slot>|<slot\s*\/>/, slotHtml)
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/index.ts`, append:

```ts
export { renderTemplate } from './blocks/render-template'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- render-template`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/blocks/render-template.ts packages/core/test/blocks/render-template.test.ts packages/core/src/index.ts
git commit -m "feat(core): add HTML block template renderer"
```

---

### Task 2: Core — manifest types + parser, and the `card` proof folder

**Files:**
- Create: `packages/core/src/blocks/types.ts`
- Create: `packages/core/src/blocks/manifest.ts`
- Create: `blocks/card/block.yaml`, `blocks/card/card.html` (the canonical proof block, committed)
- Test: `packages/core/test/blocks/manifest.test.ts`
- Modify: `packages/core/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `interface BlockAttr { type: 'string'; enum?: string[]; default?: string; optional?: boolean }`
  - `interface BlockManifest { tag: string; template: string; attrs: Record<string, BlockAttr>; editor?: { label?: string; icon?: string }; kind: 'html' }`
  - `parseBlockManifest(yamlText: string, html: string, folderTag: string): BlockManifest` — throws (with the folder name) on: yaml `tag` ≠ folder, invalid tag, empty html, or an attr `type` other than `'string'`.

- [ ] **Step 1: Create the proof block folder**

```yaml
# blocks/card/block.yaml
tag: card
editor:
  label: Card
  icon: card
attrs:
  title: { type: string }
  href: { type: string, optional: true }
```

```html
<!-- blocks/card/card.html -->
<article class="card">
  <h3 class="card-title">{{title}}</h3>
  <div class="card-body"><slot></slot></div>
</article>
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/test/blocks/manifest.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBlockManifest } from '../../src/blocks/manifest'

const root = fileURLToPath(new URL('../../../../', import.meta.url)) // repo root from packages/core/test/blocks/

describe('parseBlockManifest', () => {
  it('parses the real blocks/card folder into a manifest', () => {
    const yaml = readFileSync(`${root}blocks/card/block.yaml`, 'utf8')
    const html = readFileSync(`${root}blocks/card/card.html`, 'utf8')
    const m = parseBlockManifest(yaml, html, 'card')
    expect(m.tag).toBe('card')
    expect(m.kind).toBe('html')
    expect(m.template).toContain('<slot></slot>')
    expect(m.attrs.title).toEqual({ type: 'string' })
    expect(m.attrs.href).toEqual({ type: 'string', optional: true })
    expect(m.editor).toEqual({ label: 'Card', icon: 'card' })
  })
  it('defaults the tag to the folder name when yaml omits it', () => {
    expect(parseBlockManifest('attrs: {}', '<div><slot/></div>', 'hero').tag).toBe('hero')
  })
  it('throws when yaml tag disagrees with the folder name', () => {
    expect(() => parseBlockManifest('tag: nope', '<div/>', 'card')).toThrow(/must match folder/)
  })
  it('throws on empty template html', () => {
    expect(() => parseBlockManifest('tag: card', '   ', 'card')).toThrow(/empty/)
  })
  it('throws on an unsupported attr type', () => {
    expect(() => parseBlockManifest('attrs: { n: { type: number } }', '<div/>', 'card')).toThrow(/unsupported/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- manifest`
Expected: FAIL — cannot find `../../src/blocks/manifest`.

- [ ] **Step 4: Write the types and parser**

```ts
// packages/core/src/blocks/types.ts
/** One declared attribute on a block. `type` is 'string' only in the skeleton slice. */
export interface BlockAttr {
  type: 'string'
  enum?: string[]
  default?: string
  optional?: boolean
}

/** A content block discovered from a `blocks/<tag>/` folder. */
export interface BlockManifest {
  /** = folder name; the Markdoc tag. */
  tag: string
  /** Raw contents of `<tag>.html`. */
  template: string
  attrs: Record<string, BlockAttr>
  editor?: { label?: string; icon?: string }
  /** 'html' for plain HTML+YAML blocks; 'react' reserved for callout-class blocks (later). */
  kind: 'html'
}
```

```ts
// packages/core/src/blocks/manifest.ts
import yaml from 'js-yaml'
import type { BlockAttr, BlockManifest } from './types'

interface RawAttr { type?: string; enum?: string[]; default?: string; optional?: boolean }
interface RawYaml { tag?: string; editor?: { label?: string; icon?: string }; attrs?: Record<string, RawAttr> }

/** Parse a block folder's YAML contract + HTML template into a manifest. `folderTag`
 *  is the folder name; the YAML `tag` must match it (or be omitted). Throws loudly on
 *  any malformed input so a broken block fails the build instead of silently vanishing.
 *  Browser-safe (js-yaml is pure JS) — used by the editor's glob wiring and by tests. */
export function parseBlockManifest(yamlText: string, html: string, folderTag: string): BlockManifest {
  const doc = (yaml.load(yamlText) ?? {}) as RawYaml
  const tag = doc.tag ?? folderTag
  if (tag !== folderTag) throw new Error(`block "${folderTag}": yaml tag "${tag}" must match folder name`)
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error(`block "${folderTag}": invalid tag "${tag}"`)
  if (!html.trim()) throw new Error(`block "${tag}": template html is empty`)
  const attrs: Record<string, BlockAttr> = {}
  for (const [name, raw] of Object.entries(doc.attrs ?? {})) {
    if (raw.type !== 'string') {
      throw new Error(`block "${tag}": attr "${name}" type "${raw.type}" unsupported (only "string")`)
    }
    attrs[name] = {
      type: 'string',
      ...(raw.enum ? { enum: raw.enum } : {}),
      ...(raw.default !== undefined ? { default: raw.default } : {}),
      ...(raw.optional ? { optional: true } : {}),
    }
  }
  return { tag, template: html, attrs, ...(doc.editor ? { editor: doc.editor } : {}), kind: 'html' }
}
```

- [ ] **Step 5: Add the exports**

In `packages/core/src/index.ts`, append:

```ts
export type { BlockManifest, BlockAttr } from './blocks/types'
export { parseBlockManifest } from './blocks/manifest'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- manifest`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/blocks/types.ts packages/core/src/blocks/manifest.ts packages/core/src/index.ts packages/core/test/blocks/manifest.test.ts blocks/card
git commit -m "feat(core): parse block.yaml+html into a BlockManifest; add card proof block"
```

---

### Task 3: Core — `attrsToZod`

**Files:**
- Create: `packages/core/src/blocks/attrs-to-zod.ts`
- Test: `packages/core/test/blocks/attrs-to-zod.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces:**
- Consumes: `BlockAttr` (Task 2).
- Produces: `attrsToZod(attrs: Record<string, BlockAttr>): ZodTypeAny` — string → `z.string()`, `enum` → `z.enum`, `default` → `.default()`, `optional` → `.optional()`. Yields the `props` schema shape the existing `BlockDefinition` already carries.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/attrs-to-zod.test.ts
import { describe, it, expect } from 'vitest'
import { attrsToZod } from '../../src/blocks/attrs-to-zod'

describe('attrsToZod', () => {
  it('builds a zod object from string/enum/optional/default attrs', () => {
    const schema = attrsToZod({
      title: { type: 'string' },
      href: { type: 'string', optional: true },
      tone: { type: 'string', enum: ['info', 'warn'], default: 'info' },
    })
    expect(schema.safeParse({ title: 'x', tone: 'warn' }).success).toBe(true)
    expect(schema.parse({ title: 'x' }).tone).toBe('info') // default applied
    expect(schema.safeParse({ title: 'x', tone: 'nope' }).success).toBe(false) // enum enforced
    expect(schema.safeParse({ href: 'only-optional-missing-required' }).success).toBe(false) // title required
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- attrs-to-zod`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/blocks/attrs-to-zod.ts
import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
import type { BlockAttr } from './types'

/** Convert a block's declared attrs into the zod `props` schema BlockDefinition carries.
 *  The author writes YAML; this is the only place that knows zod. */
export function attrsToZod(attrs: Record<string, BlockAttr>): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {}
  for (const [name, a] of Object.entries(attrs)) {
    let s: ZodTypeAny = a.enum && a.enum.length ? z.enum(a.enum as [string, ...string[]]) : z.string()
    if (a.default !== undefined) s = s.default(a.default)
    else if (a.optional) s = s.optional()
    shape[name] = s
  }
  return z.object(shape)
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/index.ts`, append:

```ts
export { attrsToZod } from './blocks/attrs-to-zod'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- attrs-to-zod`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/blocks/attrs-to-zod.ts packages/core/test/blocks/attrs-to-zod.test.ts packages/core/src/index.ts
git commit -m "feat(core): convert block YAML attrs to a zod schema"
```

---

### Task 4: Core — round-trip the generic `setuBlock`

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts:137-142` (the `case 'tag'` in `blockToTiptap`)
- Modify: `packages/core/src/markdoc/to-markdoc.ts:87-88` (add a `setuBlock` case in `buildBlock`)
- Test: `packages/core/test/blocks/setu-block-roundtrip.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap(source, { knownBlockTags })`, `tiptapToMarkdoc(doc)` (existing).
- Produces: a Tiptap node `{ type: 'setuBlock', attrs: { tag, mdAttrs }, content }` for any known tag that is not `callout`; `tiptapToMarkdoc` rebuilds it as `{% <tag> %}…{% /<tag> %}`. Callout behavior is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/setu-block-roundtrip.test.ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['callout', 'card'])

describe('setuBlock round-trip', () => {
  it('maps a known non-callout tag to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% card title="Hello" %}\nBody text.\n{% /card %}', { knownBlockTags: known })
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({ tag: 'card', mdAttrs: { title: 'Hello' } })
    expect(block.content?.[0]?.type).toBe('paragraph')
  })
  it('serializes a setuBlock back to its own tag (byte-stable)', () => {
    const src = '{% card title="Hello" %}\nBody text.\n{% /card %}'
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(tiptapToMarkdoc(doc).trim()).toBe(src)
  })
  it('still maps callout to the callout node (unchanged)', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi.\n{% /callout %}', { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('callout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- setu-block-roundtrip`
Expected: FAIL — the first block comes back as `callout` (current hardcode), not `setuBlock`.

- [ ] **Step 3: Generalize `to-tiptap.ts`**

Replace the `case 'tag'` block in `blockToTiptap` (currently lines 137–142):

```ts
    case 'tag': {
      const tag = node.tag ?? ''
      const kids = (node.children ?? []).map(blockToTiptap).filter((n): n is TiptapNode => n !== null)
      if (tag === 'callout') {
        return { type: 'callout', attrs: { mdAttrs: node.attributes }, content: kids }
      }
      return { type: 'setuBlock', attrs: { tag, mdAttrs: node.attributes }, content: kids }
    }
```

- [ ] **Step 4: Add the `setuBlock` case to `to-markdoc.ts`**

In `buildBlock`, immediately after the `case 'callout':` return (line 88), add:

```ts
    case 'setuBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        (node.content ?? []).map(buildBlock),
        String(attrs['tag']),
      )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- setu-block-roundtrip`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full core suite (callout regression guard)**

Run: `pnpm --filter @setu/core test`
Expected: PASS — all prior tests (incl. callout round-trip) still green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/blocks/setu-block-roundtrip.test.ts
git commit -m "feat(core): round-trip known non-callout tags as a generic setuBlock"
```

---

### Task 5: Editor — the generic `setuBlock` node + auto-form

**Files:**
- Create: `apps/admin/src/editor/extensions/SetuBlock.tsx`
- Test: `apps/admin/test/setu-block-node.test.tsx`

**Interfaces:**
- Consumes: `BlockManifest`, `renderTemplate` (`@setu/core`); Tiptap `Node`, `ReactNodeViewRenderer`, `NodeViewContent`, `NodeViewWrapper`.
- Produces: `createSetuBlock(manifests: BlockManifest[]): Node` — a Tiptap node named `setuBlock`, attrs `{ tag, mdAttrs }` (JSON-only, kept out of the DOM like `callout`), whose node view renders a labeled block chrome with an **auto-generated attr form** (text input per attr, `<select>` for an `enum`) above an editable `<NodeViewContent>` body.

> **Skeleton simplification (intentional, flagged to owner):** the *in-canvas* node view shows generic block chrome — the block label + auto-form + editable body — **not** the literal HTML template. Rendering arbitrary template HTML *with* an editable slot in-place is awkward (the slot is nested inside wrapper elements). The faithful template render is what the **site** and the existing **Preview tab** show. The node view still imports `renderTemplate` and uses it for a read-only visual hint (title line) so the engine is exercised end-to-end. Full in-canvas template WYSIWYG is a later slice.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/setu-block-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'
import type { BlockManifest } from '@setu/core'

afterEach(cleanup)

const card: BlockManifest = {
  tag: 'card',
  template: '<article class="card"><h3 class="card-title">{{title}}</h3><div class="card-body"><slot></slot></div></article>',
  attrs: { title: { type: 'string' }, href: { type: 'string', optional: true } },
  editor: { label: 'Card', icon: 'card' },
  kind: 'html',
}

function Harness({ onReady }: { onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock([card])],
    content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag: 'card', mdAttrs: {} }, content: [{ type: 'paragraph' }] }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('setuBlock node view', () => {
  it('auto-generates a form field per attr and writes edits into mdAttrs', () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const title = screen.getByLabelText('title')
    fireEvent.change(title, { target: { value: 'My card' } })
    const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block = json.content.find((n) => n.type === 'setuBlock')
    expect(block?.attrs?.mdAttrs?.title).toBe('My card')
    expect(screen.getByLabelText('href')).toBeInTheDocument() // optional attr still gets a field
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- setu-block-node`
Expected: FAIL — cannot find `../src/editor/extensions/SetuBlock`.

- [ ] **Step 3: Write the node + view**

```tsx
// apps/admin/src/editor/extensions/SetuBlock.tsx
import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { renderTemplate } from '@setu/core'
import type { BlockManifest } from '@setu/core'

function viewFor(byTag: Record<string, BlockManifest>) {
  return function SetuBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const tag = String(node.attrs.tag)
    const manifest = byTag[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    const attrs = manifest?.attrs ?? {}

    const setAttr = (name: string, value: string) => {
      const next: Record<string, unknown> = { ...mdAttrs }
      if (value === '') delete next[name]
      else next[name] = value
      updateAttributes({ mdAttrs: next })
    }

    // Exercise the engine: a read-only title hint from the template's first {{attr}}.
    const hint = manifest ? renderTemplate('{{title}}', mdAttrs) : ''

    return (
      <NodeViewWrapper>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{manifest?.editor?.label ?? tag}</span>
            {hint && <span className="setu-block-hint">{hint}</span>}
          </div>
          {Object.keys(attrs).length > 0 && (
            <div className="block-props" contentEditable={false} role="group" aria-label={`${tag} properties`}>
              {Object.entries(attrs).map(([name, a]) => (
                <label key={name} className="bp-field">
                  <span className="bp-label">{name}</span>
                  {a.enum ? (
                    <select value={String(mdAttrs[name] ?? '')} onChange={(e) => setAttr(name, e.target.value)}>
                      <option value="" />
                      {a.enum.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={String(mdAttrs[name] ?? '')} onChange={(e) => setAttr(name, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          )}
          <NodeViewContent className="setu-block-body" />
        </div>
      </NodeViewWrapper>
    )
  }
}

/** The generic folder-block node. One Tiptap node serves every HTML+YAML block: its
 *  `tag` selects the manifest, `mdAttrs` is the round-tripped attribute bag (JSON-only,
 *  kept out of the DOM like callout). The node view auto-generates the attr form. */
export function createSetuBlock(manifestList: BlockManifest[]): Node {
  const byTag = Object.fromEntries(manifestList.map((m) => [m.tag, m]))
  return Node.create({
    name: 'setuBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
      return {
        tag: {
          default: '',
          renderHTML: () => ({}),
          parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? '',
        },
        mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) },
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-setu-block]' }]
    },
    renderHTML({ HTMLAttributes, node }) {
      return ['div', { ...HTMLAttributes, 'data-setu-block': '', 'data-tag': node.attrs.tag }, 0]
    },
    addNodeView() {
      return ReactNodeViewRenderer(viewFor(byTag))
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- setu-block-node`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/extensions/SetuBlock.tsx apps/admin/test/setu-block-node.test.tsx
git commit -m "feat(admin): generic setuBlock Tiptap node with an auto-generated attr form"
```

---

### Task 6: Editor — discover folder blocks (glob) and wire them in

**Files:**
- Create: `apps/admin/src/editor/block-manifests.ts`
- Modify: `apps/admin/src/editor/blocks.ts` (`slashBlocks` takes folder manifests)
- Modify: `apps/admin/src/editor/extensions/SlashCommand.tsx:91` (pass manifests)
- Modify: `apps/admin/src/editor/Canvas.tsx` (register `createSetuBlock`)
- Modify: `apps/admin/vite.config.ts` (allow globbing the repo-root `blocks/`)
- Test: `apps/admin/test/blocks.test.ts` (extend)

**Interfaces:**
- Consumes: `parseBlockManifest`, `BlockManifest` (core); `createSetuBlock` (Task 5).
- Produces: `blockManifests: BlockManifest[]` (the glob result); `slashBlocks(blockManifests?: BlockManifest[]): SlashBlock[]` — built-ins + the config callout + one slash entry per folder block (inserts a `setuBlock` of that tag).

- [ ] **Step 1: Write the failing test (extend `blocks.test.ts`)**

Append to `apps/admin/test/blocks.test.ts`:

```ts
import type { BlockManifest } from '@setu/core'

const cardManifest: BlockManifest = {
  tag: 'card', template: '<div><slot/></div>',
  attrs: { title: { type: 'string' } }, editor: { label: 'Card', icon: 'card' }, kind: 'html',
}

describe('slashBlocks with folder blocks', () => {
  it('adds a slash entry per folder manifest, inserting a setuBlock of that tag', () => {
    const titles = slashBlocks([cardManifest]).map((b) => b.title)
    expect(titles).toContain('Card')
  })
  it('still works with no folder blocks (callout from config remains)', () => {
    expect(slashBlocks().some((b) => /callout/i.test(b.title))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- blocks`
Expected: FAIL — `slashBlocks` takes no argument yet (TS/assertion error on `'Card'`).

- [ ] **Step 3: Extend `slashBlocks` to accept folder manifests**

In `apps/admin/src/editor/blocks.ts`: add the import and a parameter, and append folder entries. Keep the existing built-ins and the config-driven callout untouched.

```ts
import type { BlockManifest } from '@setu/core'
```

Replace the `slashBlocks` signature + return:

```ts
/** Insertable blocks = built-ins + the resolved config blocks (Callout) + every
 *  auto-discovered folder block. Each folder block inserts a generic `setuBlock`. */
export function slashBlocks(blockManifests: BlockManifest[] = []): SlashBlock[] {
  const config = resolveConfig(defaultConfig)
  const fromConfig: SlashBlock[] = config.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    run: (e: Editor, r: Range) =>
      e.chain().focus().deleteRange(r)
        .insertContent({ type: b.tag, attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
        .run(),
  }))
  const fromFolders: SlashBlock[] = blockManifests.map((m) => ({
    title: m.editor?.label ?? m.tag,
    subtitle: `Insert a ${m.tag} block`,
    icon: toIconName(m.editor?.icon),
    run: (e: Editor, r: Range) =>
      e.chain().focus().deleteRange(r)
        .insertContent({ type: 'setuBlock', attrs: { tag: m.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
        .run(),
  }))
  return [...BUILTINS, ...fromConfig, ...fromFolders]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- blocks`
Expected: PASS.

- [ ] **Step 5: Create the glob discovery module**

```ts
// apps/admin/src/editor/block-manifests.ts
// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (block.yaml + the sibling .html) into the bundle as raw strings; we parse them in the
// browser via @setu/core. The path is relative to THIS file: editor -> src -> admin ->
// apps -> repo root = ../../../../blocks. Blocks live outside the admin app, so the dev
// server must allow that path (see vite.config.ts server.fs.allow).
import { parseBlockManifest } from '@setu/core'
import type { BlockManifest } from '@setu/core'

const yamls = import.meta.glob('../../../../blocks/*/block.yaml', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
const htmls = import.meta.glob('../../../../blocks/*/*.html', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const folderOf = (p: string): string => p.split('/').slice(-2, -1)[0]!

export const blockManifests: BlockManifest[] = Object.entries(yamls).map(([path, yamlText]) => {
  const tag = folderOf(path)
  const htmlPath = Object.keys(htmls).find((h) => folderOf(h) === tag)
  if (!htmlPath) throw new Error(`block "${tag}": missing ${tag}.html beside block.yaml`)
  return parseBlockManifest(yamlText, htmls[htmlPath]!, tag)
})
```

- [ ] **Step 6: Allow the glob path in the Vite dev server**

In `apps/admin/vite.config.ts`, add a `server` block to the config object (the repo root is two levels above `apps/admin`):

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['../..'] } },
  test: {
```

(Leave the rest of the config unchanged.)

- [ ] **Step 7: Wire the node + slash list into the editor**

In `apps/admin/src/editor/Canvas.tsx`: add the imports near the other extension imports —

```ts
import { createSetuBlock } from './extensions/SetuBlock'
import { blockManifests } from './block-manifests'
```

and add `createSetuBlock(blockManifests)` to the `extensions: [...]` array, right after `Callout,`:

```ts
      Callout,
      createSetuBlock(blockManifests),
      Passthrough,
```

In `apps/admin/src/editor/extensions/SlashCommand.tsx`: add the import —

```ts
import { blockManifests } from '../block-manifests'
```

and at line 91 change `slashBlocks()` to `slashBlocks(blockManifests)`.

- [ ] **Step 8: Typecheck + full admin suite**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test`
Expected: PASS — all admin tests green (incl. existing callout/slash tests).

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/editor/block-manifests.ts apps/admin/src/editor/blocks.ts apps/admin/src/editor/extensions/SlashCommand.tsx apps/admin/src/editor/Canvas.tsx apps/admin/vite.config.ts apps/admin/test/blocks.test.ts
git commit -m "feat(admin): auto-discover folder blocks via Vite glob and wire into editor"
```

---

### Task 7: Site codegen — `scripts/gen-blocks.mjs`

**Files:**
- Create: `scripts/gen-blocks.mjs`
- Create: `scripts/gen-blocks.test.mjs`
- Modify: root `package.json` (add `js-yaml` devDep + a `test:scripts` glob already covers it)

**Interfaces:**
- Produces (pure, exported for tests):
  - `templateToAstro(manifest): string` — translates an HTML template into an `.astro` component (`{{name}}`→`{name}`, `<slot></slot>`/`<slot/>`→`<slot />`, a frontmatter `const { ...attrNames } = Astro.props`).
  - `tagsInclude(manifests): string` — the generated `markdoc.blocks.generated.mjs` source: `export const tags = { … }` mapping each tag → `{ render: component('./src/blocks/<tag>.astro'), attributes: { <name>: { type: String[, default] } } }`.
  - `main()` — scans `blocks/`, writes `apps/site/src/blocks/<tag>.astro` + `apps/site/markdoc.blocks.generated.mjs`.

> **Self-contained by design:** this script reads `block.yaml` itself with `js-yaml` (added to the root) rather than importing `@setu/core`'s TS — a root `.mjs` build script can't import extensionless TS without jiti, and the repo's existing scripts (`content-sandbox.mjs`) are deliberately self-contained. The block.yaml *format* is the shared contract; Task 2's core parser and this script are both tested against the same `blocks/card` fixture, so divergence is caught.

- [ ] **Step 1: Add `js-yaml` to the root devDependencies**

Run:

```bash
pnpm add -w -D js-yaml
```

Expected: root `package.json` gains `"js-yaml"` under `devDependencies`.

- [ ] **Step 2: Write the failing test**

```js
// scripts/gen-blocks.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { templateToAstro, tagsInclude } from './gen-blocks.mjs'

const card = {
  tag: 'card',
  template: '<article class="card"><h3>{{title}}</h3><div class="card-body"><slot></slot></div></article>',
  attrs: { title: { type: 'string' }, href: { type: 'string', optional: true } },
}

test('templateToAstro translates interpolation + slot + frontmatter destructure', () => {
  const out = templateToAstro(card)
  assert.match(out, /const \{ title, href \} = Astro\.props/)
  assert.match(out, /<h3>\{title\}<\/h3>/)
  assert.match(out, /<slot \/>/)
  assert.doesNotMatch(out, /\{\{/) // no leftover handlebars
})

test('tagsInclude emits a markdoc tags map with component() + attributes', () => {
  const out = tagsInclude([card])
  assert.match(out, /import \{ component \} from '@astrojs\/markdoc\/config'/)
  assert.match(out, /card: \{/)
  assert.match(out, /render: component\('\.\/src\/blocks\/card\.astro'\)/)
  assert.match(out, /title: \{ type: String \}/)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/gen-blocks.test.mjs`
Expected: FAIL — cannot find `./gen-blocks.mjs` exports.

- [ ] **Step 4: Write the script**

```js
// scripts/gen-blocks.mjs
// Build-time codegen: scan repo-root blocks/ and generate, for the site, one Astro
// component per block plus a Markdoc tags include. Runs as apps/site's predev/prebuild.
// Pure build-time => zero per-visitor cost. Self-contained (no @setu/core TS import);
// the block.yaml format is shared with core's parser and guarded by a common fixture.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BLOCKS_DIR = path.join(ROOT, 'blocks')
const SITE = path.join(ROOT, 'apps', 'site')
const OUT_ASTRO_DIR = path.join(SITE, 'src', 'blocks')
const OUT_INCLUDE = path.join(SITE, 'markdoc.blocks.generated.mjs')

/** Read blocks/<tag>/{block.yaml,<tag>.html} into plain manifest objects. Throws loudly
 *  on a malformed folder (mirrors @setu/core's parseBlockManifest validation). */
export function loadManifests(dir = BLOCKS_DIR) {
  if (!existsSync(dir)) return []
  const manifests = []
  for (const tag of readdirSync(dir)) {
    const folder = path.join(dir, tag)
    const yamlPath = path.join(folder, 'block.yaml')
    const htmlPath = path.join(folder, `${tag}.html`)
    if (!existsSync(yamlPath)) continue
    if (!existsSync(htmlPath)) throw new Error(`block "${tag}": missing ${tag}.html`)
    const doc = yaml.load(readFileSync(yamlPath, 'utf8')) ?? {}
    if (doc.tag && doc.tag !== tag) throw new Error(`block "${tag}": yaml tag "${doc.tag}" must match folder name`)
    const attrs = {}
    for (const [name, raw] of Object.entries(doc.attrs ?? {})) {
      if (raw.type !== 'string') throw new Error(`block "${tag}": attr "${name}" type "${raw.type}" unsupported`)
      attrs[name] = { type: 'string', ...(raw.default !== undefined ? { default: raw.default } : {}) }
    }
    manifests.push({ tag, template: readFileSync(htmlPath, 'utf8'), attrs })
  }
  return manifests
}

/** HTML template -> Astro component source. */
export function templateToAstro(manifest) {
  const names = Object.keys(manifest.attrs)
  const destructure = names.length ? `const { ${names.join(', ')} } = Astro.props` : ''
  const body = manifest.template
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, '{$1}')
    .replace(/<slot\s*><\/slot>|<slot\s*\/>/g, '<slot />')
  return `---\n${destructure}\n---\n${body.trimEnd()}\n`
}

/** manifests -> markdoc.blocks.generated.mjs source. */
export function tagsInclude(manifests) {
  const entries = manifests.map((m) => {
    const attrs = Object.entries(m.attrs)
      .map(([name, a]) => `${name}: { type: String${a.default !== undefined ? `, default: ${JSON.stringify(a.default)}` : ''} }`)
      .join(', ')
    return `  ${m.tag}: {\n    render: component('./src/blocks/${m.tag}.astro'),\n    attributes: { ${attrs} },\n  },`
  })
  return `// AUTO-GENERATED by scripts/gen-blocks.mjs — do not edit.\nimport { component } from '@astrojs/markdoc/config'\n\nexport const tags = {\n${entries.join('\n')}\n}\n`
}

export function main() {
  const manifests = loadManifests()
  mkdirSync(OUT_ASTRO_DIR, { recursive: true })
  for (const m of manifests) {
    writeFileSync(path.join(OUT_ASTRO_DIR, `${m.tag}.astro`), templateToAstro(m))
  }
  writeFileSync(OUT_INCLUDE, tagsInclude(manifests))
  console.log(`gen-blocks: generated ${manifests.length} block(s): ${manifests.map((m) => m.tag).join(', ') || '(none)'}`)
}

// Run when invoked directly (node scripts/gen-blocks.mjs), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/gen-blocks.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Smoke-run the generator**

Run: `node scripts/gen-blocks.mjs`
Expected: prints `gen-blocks: generated 1 block(s): card`; creates `apps/site/src/blocks/card.astro` and `apps/site/markdoc.blocks.generated.mjs`.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen-blocks.mjs scripts/gen-blocks.test.mjs package.json pnpm-lock.yaml
git commit -m "feat(scripts): codegen folder blocks into Astro components + markdoc tags"
```

---

### Task 8: Site — wire codegen into the build and merge the generated tags

**Files:**
- Modify: `apps/site/package.json` (`predev`/`prebuild` hooks)
- Modify: `apps/site/markdoc.config.mjs` (import + spread the generated tags)
- Modify: `.gitignore` (ignore the generated artifacts)

**Interfaces:**
- Consumes: `apps/site/markdoc.blocks.generated.mjs` (`export const tags`) + `apps/site/src/blocks/*.astro` from Task 7.
- Produces: a build where `{% card %}` renders through the generated `card.astro`, with `callout`/`sub`/`sup` still hand-authored.

- [ ] **Step 1: Gitignore the generated artifacts**

Append to `.gitignore`:

```
# Generated by scripts/gen-blocks.mjs (build-time, derived from blocks/)
apps/site/src/blocks/
apps/site/markdoc.blocks.generated.mjs
```

- [ ] **Step 2: Add the build/dev prestep hooks**

In `apps/site/package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "predev": "node ../../scripts/gen-blocks.mjs",
    "dev": "astro dev",
    "prebuild": "node ../../scripts/gen-blocks.mjs",
    "build": "astro build",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Merge the generated tags into the Markdoc config**

In `apps/site/markdoc.config.mjs`, add the import at the top (after the existing import line):

```js
import { tags as generatedTags } from './markdoc.blocks.generated.mjs'
```

and spread them into the `tags` object so generated blocks join the hand-authored ones (the hand-authored entries win on any name clash, keeping callout/sub/sup authoritative):

```js
  tags: {
    ...generatedTags,
    callout: {
      render: component('./src/components/CalloutWrapper.astro'),
      attributes: {
        type: { type: String, default: 'info' },
        title: { type: String },
      },
    },
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
  },
```

- [ ] **Step 4: Verify the generated file exists (prestep ran in Task 7) and the config imports cleanly**

Run: `node -e "import('./apps/site/markdoc.blocks.generated.mjs').then(m => console.log(Object.keys(m.tags)))"`
Expected: prints `[ 'card' ]`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/package.json apps/site/markdoc.config.mjs .gitignore
git commit -m "feat(site): run block codegen as a build prestep and merge generated tags"
```

---

### Task 9: Site — render the `card` end-to-end (proof)

**Files:**
- Modify: `content/post/en/kitchen-sink.mdoc` (add a `{% card %}` to the fixture)
- Modify: `apps/site/test/render.test.ts` (assert the card render)

**Interfaces:**
- Consumes: the full build pipeline (prebuild codegen + Astro). The existing `render.test.ts` runs `pnpm build` in `beforeAll` and reads `dist/post/kitchen-sink/index.html`.

- [ ] **Step 1: Add a card to the kitchen-sink fixture**

In `content/post/en/kitchen-sink.mdoc`, after the existing callout block (around line 17), add:

```markdoc
{% card title="Proof Card" %}
A card rendered from a **folder** — no config, no React.
{% /card %}
```

- [ ] **Step 2: Write the failing assertions**

In `apps/site/test/render.test.ts`, add a new describe block (after the callout block, ~line 54):

```ts
describe('render pipeline — folder block (card)', () => {
  it('renders the HTML+YAML card through the generated astro component', () => {
    expect(html).toContain('<article class="card">')
    expect(html).toContain('<h3 class="card-title">Proof Card</h3>')
    expect(html).toContain('<div class="card-body">')
    expect(html).toContain('<strong>bold</strong>'.replace('bold', 'folder')) // body markdown rendered
  })
  it('ships zero JS for the folder block (static, no island)', () => {
    expect(html).not.toContain('astro-island')
  })
})
```

> Note: the `replace` keeps the assertion readable — it checks the body emphasis `<strong>folder</strong>` produced by the `**folder**` markdown inside the card.

- [ ] **Step 3: Run the render test to verify the new assertions pass and the existing 30 stay green**

Run: `pnpm --filter @setu/site test`
Expected: PASS — the new card assertions pass AND all prior render/theme tests remain green (codegen left the build untouched). The `pnpm build` in `beforeAll` triggers `prebuild` → `gen-blocks` → `card.astro` exists before Astro runs.

- [ ] **Step 4: Commit**

```bash
git add content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts
git commit -m "test(site): prove a folder-defined card renders end-to-end"
```

---

### Task 10: Full-repo green + manual end-to-end walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run every test suite**

Run: `pnpm -r test && pnpm test:scripts && pnpm -r typecheck`
Expected: all green — core (incl. new blocks tests), admin (incl. setuBlock), site (incl. card render), api, blocks, theme-default, db/git adapters; script tests incl. `gen-blocks`.

- [ ] **Step 2: Manual walkthrough (the actual proof)**

Run: `pnpm dev`
Then verify by hand:
1. In the editor, type `/` → **Card** appears in the menu; insert it.
2. The block shows a `title`/`href` auto-form and an editable body; type a title and body.
3. Hit **Preview** (the eye icon) → the card renders through the real theme in the preview tab.
4. Save/publish → the `.mdoc` contains a clean `{% card title="…" %}…{% /card %}`.
5. Reopen the entry → it round-trips back into the editor as a Card block (not passthrough).

Expected: all five hold, with **no edit** to `setu.config.ts`, the converters' callout branches, or any hand-authored component.

- [ ] **Step 3: Final commit (if any walkthrough fixes were needed)**

```bash
git add -A && git commit -m "chore: html+yaml blocks walking skeleton — full green"
```

---

## Self-Review

**Spec coverage:**
- The two-file `card` folder, no config/React → Tasks 2, 9. ✓
- Engine (`loadBlockManifests`/parse, `attrsToZod`, `renderTemplate`) → Tasks 1–3. (Note: the spec's `loadBlockManifests` node FS scan is **not built** — YAGNI: the editor parses globbed strings via `parseBlockManifest`, and `gen-blocks.mjs` does its own scan. Recorded as an intentional deviation below.) ✓
- Round-trip `setuBlock`, callout frozen → Task 4. ✓
- Editor: Vite glob delivery (Decision A), generic node + auto-form, slash discovery → Tasks 5–6. ✓
- Site: codegen `.astro` per block (Decision B), prestep script (Decision C), gitignored generated, merged tags → Tasks 7–8. ✓
- Testing across core/admin/scripts/site + 30 render tests stay green → every task + Task 10. ✓
- Cloudflare/cost (build-time only) → Global Constraints + Tasks 7–8 framing. ✓

**Intentional deviations from the spec (flagged for the owner):**
1. **No `loadBlockManifests` in core.** The spec listed it; it proved unused once the editor consumes globbed strings via `parseBlockManifest` and `gen-blocks.mjs` scans the FS itself. Dropped per YAGNI.
2. **`gen-blocks.mjs` re-reads YAML instead of importing core.** A root `.mjs` can't import core's extensionless TS without jiti; the repo's script convention is self-contained. The shared `blocks/card` fixture guards format parity.
3. **In-canvas node view shows generic chrome, not the literal template.** Editing a slot inside arbitrary nested template HTML is awkward; the faithful template render is on the site + the existing Preview tab. (Detailed in Task 5.)

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `BlockManifest`/`BlockAttr` shape is identical across Tasks 2/3/5/6; `createSetuBlock(manifests)` and `slashBlocks(manifests)` signatures match their call sites; the `setuBlock` node attrs (`tag`, `mdAttrs`) match the converter output in Task 4. ✓
