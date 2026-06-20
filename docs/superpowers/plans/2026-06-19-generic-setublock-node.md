# Generic `setuBlock` Node (#4 Slice B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, non-callout folder block works end-to-end with no per-block code — a generic `setuBlock` round-trip node + a generic editor node (chrome + auto-form), proven with a dependency-free `notice` block.

**Architecture:** The round-trip converter maps any known non-callout tag to a generic `setuBlock` Tiptap node `{tag, mdAttrs}` (callout stays its own node, frozen). The editor gets one `createSetuBlock(blocks)` node whose view renders an auto-form derived from each block's zod `props` via `markdocAttributesFor` (reused from Slice A) plus an editable body. The slash menu routes non-callout folder blocks to `setuBlock`. Render + codegen already exist from Slice A.

**Tech Stack:** TypeScript, Zod, `@markdoc/markdoc`, `@tiptap/react` 3.26.1, Astro 6.4.6 + `@astrojs/markdoc` 1.0.6, Vitest.

## Global Constraints

- **Rule #1 — read source first** before using any Tiptap/zod/Markdoc API.
- **Rule #2 — Cloudflare + cost-safe:** no new runtime/edge surface; editor node is client-side; block renders to static HTML via Slice A's build-time codegen. Zero per-visitor cost.
- **Callout is frozen:** do not change the `callout` branch of either converter, `Callout.tsx`, `CalloutWrapper`→`blocks/callout/callout.astro`, or callout's behavior. This slice *adds* the generic lane beside it.
- **Content-safety:** round-trip byte-stable; unknown tags stay `passthrough` (never dropped).
- **The proof block `notice` is dependency-free** (plain HTML + `Astro.props` + `<slot>` + a scoped `<style>`) — no npm/workspace imports, so NO resolver patches are needed in any tool.
- **Versions:** do not bump React 18, the Tiptap 3.26.1 suite, Astro 6.4.6, `@astrojs/markdoc` 1.0.6.
- **Branch:** `feat/setu-block-generic-node` (already checked out).
- `scope` stays inert (carried since Slice A, not enforced).

---

### Task 1: Core — round-trip the generic `setuBlock`

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts` (the `case 'tag'` in `blockToTiptap`, ~lines 137-142)
- Modify: `packages/core/src/markdoc/to-markdoc.ts` (add a `setuBlock` case in `buildBlock`, after the `callout` case ~line 88)
- Test: `packages/core/test/blocks/setu-block-roundtrip.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap(source, { knownBlockTags })`, `tiptapToMarkdoc(doc)` (existing).
- Produces: a Tiptap node `{ type: 'setuBlock', attrs: { tag, mdAttrs }, content }` for any known non-callout tag; `tiptapToMarkdoc` rebuilds it as `{% <tag> %}…{% /<tag> %}`. Callout behavior unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/setu-block-roundtrip.test.ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['callout', 'notice'])

describe('setuBlock round-trip', () => {
  it('maps a known non-callout tag to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% notice tone="warn" %}\nHi there.\n{% /notice %}', { knownBlockTags: known })
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({ tag: 'notice', mdAttrs: { tone: 'warn' } })
    expect(block.content?.[0]?.type).toBe('paragraph')
  })
  it('serializes a setuBlock back to its own tag (byte-stable)', () => {
    const src = '{% notice tone="warn" %}\nHi there.\n{% /notice %}'
    expect(tiptapToMarkdoc(markdocToTiptap(src, { knownBlockTags: known })).trim()).toBe(src)
  })
  it('still maps callout to the callout node (frozen)', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi.\n{% /callout %}', { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('callout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- setu-block-roundtrip`
Expected: FAIL — the `notice` block comes back as `callout` (current hardcode), not `setuBlock`.

- [ ] **Step 3: Generalize `to-tiptap.ts`**

Replace the `case 'tag'` block in `blockToTiptap` (currently lines 137-142):

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

In `buildBlock`, immediately after the `case 'callout':` return (~line 88), add:

```ts
    case 'setuBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        (node.content ?? []).map(buildBlock),
        String(attrs['tag']),
      )
```

- [ ] **Step 5: Run the new test + full core suite**

Run: `pnpm --filter @setu/core test`
Expected: PASS — the 3 new round-trip tests plus all existing (callout round-trip, config-roundtrip, to-tiptap, editor-schema-equivalents in core) stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/blocks/setu-block-roundtrip.test.ts
git commit -m "feat(core): round-trip known non-callout tags as a generic setuBlock"
```

---

### Task 2: Editor — the generic `setuBlock` node + auto-form

**Files:**
- Create: `apps/admin/src/editor/extensions/SetuBlock.tsx`
- Test: `apps/admin/test/setu-block-node.test.tsx`

**Interfaces:**
- Consumes: `markdocAttributesFor`, type `ResolvedBlock` (`@setu/core`); Tiptap `Node`, `ReactNodeViewRenderer`, `NodeViewContent`, `NodeViewWrapper`.
- Produces: `createSetuBlock(blocks: ResolvedBlock[]): Node` — a Tiptap node `setuBlock` (attrs `{tag, mdAttrs}`, JSON-only) whose view renders the block label, an auto-form (text input per string attr, `<select>` per enum attr, seeded to its default), and an editable `<NodeViewContent>` body. Degrades to body-only when the tag has no registry entry.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/setu-block-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { z } from 'zod'
import type { ResolvedBlock } from '@setu/core'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'

afterEach(cleanup)

const notice: ResolvedBlock = {
  tag: 'notice',
  props: z.object({ tone: z.enum(['info', 'warn', 'success']).default('info'), title: z.string().optional() }),
  component: 'blocks/notice/notice.astro',
  editor: { label: 'Notice', icon: 'info' },
}

function Harness({ tag, onReady }: { tag: string; onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock([notice])],
    content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('setuBlock node view', () => {
  it('auto-generates an enum <select> (seeded to default) + a text field, writing edits into mdAttrs', () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness tag="notice" onReady={(g) => (getJSON = g)} />)
    const tone = screen.getByLabelText('tone') as HTMLSelectElement
    expect(tone.value).toBe('info') // seeded to the enum default
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Good news' } })
    const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block = json.content.find((n) => n.type === 'setuBlock')
    expect(block?.attrs?.mdAttrs?.title).toBe('Good news')
  })
  it('degrades to body-only (no form, no crash) when the tag has no registry entry', () => {
    render(<Harness tag="ghost" onReady={() => {}} />)
    expect(screen.queryByLabelText('tone')).toBeNull()
    expect(screen.getByText('ghost')).toBeInTheDocument() // label falls back to the tag
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
import { markdocAttributesFor } from '@setu/core'
import type { ResolvedBlock } from '@setu/core'

function viewFor(byTag: Record<string, ResolvedBlock>) {
  return function SetuBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const tag = String(node.attrs.tag)
    const block = byTag[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    // Derive the form from the same zod props the contract declares (DRY with the codegen).
    const attrs = block ? markdocAttributesFor(block.props) : {}
    const label = block?.editor?.label ?? tag

    const setAttr = (name: string, value: string) => {
      const next: Record<string, unknown> = { ...mdAttrs }
      if (value === '') delete next[name]
      else next[name] = value
      updateAttributes({ mdAttrs: next })
    }

    return (
      <NodeViewWrapper>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{label}</span>
          </div>
          {Object.keys(attrs).length > 0 && (
            <div className="block-props" contentEditable={false} role="group" aria-label={`${label} properties`}>
              {Object.entries(attrs).map(([name, a]) => (
                <label key={name} className="bp-field">
                  <span className="bp-label">{name}</span>
                  {a.matches ? (
                    <select value={String(mdAttrs[name] ?? a.default ?? '')} onChange={(e) => setAttr(name, e.target.value)}>
                      {a.matches.map((o) => (
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

/** The generic folder-block node. One Tiptap node serves every HTML+contract block: `tag`
 *  selects the registry entry, `mdAttrs` is the round-tripped attribute bag (JSON-only, kept
 *  out of the DOM like callout). The view auto-generates the attr form from the block's zod props. */
export function createSetuBlock(blocks: ResolvedBlock[]): Node {
  const byTag = Object.fromEntries(blocks.map((b) => [b.tag, b]))
  return Node.create({
    name: 'setuBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
      return {
        tag: { default: '', renderHTML: () => ({}), parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? '' },
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
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/extensions/SetuBlock.tsx apps/admin/test/setu-block-node.test.tsx
git commit -m "feat(admin): generic setuBlock Tiptap node with an auto-generated attr form"
```

---

### Task 3: Editor — the `notice` folder + slash routing + Canvas registration

**Files:**
- Create: `blocks/notice/block.ts`, `blocks/notice/notice.astro`
- Modify: `apps/admin/src/editor/blocks.ts` (route non-callout folder blocks to `setuBlock`)
- Modify: `apps/admin/src/editor/Canvas.tsx` (register `createSetuBlock(registry.blocks)`)
- Test: `apps/admin/test/blocks.test.ts` (extend — `Notice` in the slash menu)

**Interfaces:**
- Consumes: `createSetuBlock` (Task 2), the `registry` (`apps/admin/src/blocks/registry.ts`, Slice A).
- Produces: `slashBlocks()` returns built-ins + folder blocks, where `callout` inserts a `callout` node and every other folder block inserts a `setuBlock` of its tag. `notice` is a discoverable dependency-free block.

- [ ] **Step 1: Create the dependency-free `notice` folder**

```ts
// blocks/notice/block.ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    tone: z.enum(['info', 'warn', 'success']).default('info'),
    title: z.string().optional(),
  }),
  editor: { label: 'Notice', icon: 'info' },
})
```

```astro
---
// blocks/notice/notice.astro — plain HTML, ZERO imports (no resolver patches needed).
const { tone = 'info', title } = Astro.props
---
<aside class={`notice notice-${tone}`}>
  {title && <p class="notice-title">{title}</p>}
  <div class="notice-body"><slot /></div>
</aside>
<style>
  .notice { border-left: 4px solid var(--accent, #6366f1); padding: 0.75rem 1rem; border-radius: 6px; background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent); }
  .notice-warn { border-color: #d97706; background: color-mix(in srgb, #d97706 8%, transparent); }
  .notice-success { border-color: #16a34a; background: color-mix(in srgb, #16a34a 8%, transparent); }
  .notice-title { font-weight: 600; margin: 0 0 0.25rem; }
  .notice-body :global(> :last-child) { margin-bottom: 0; }
</style>
```

- [ ] **Step 2: Write the failing test (extend `blocks.test.ts`)**

Append to `apps/admin/test/blocks.test.ts`:

```ts
describe('slashBlocks — folder blocks route to the right node', () => {
  it('offers the dependency-free Notice folder block', () => {
    expect(slashBlocks().map((b) => b.title)).toContain('Notice')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @setu/admin test -- blocks`
Expected: FAIL — `Notice` not yet discovered/offered (the `notice` folder exists, but confirm the assertion drives any needed change; if it already passes because the glob picks up the folder, proceed — the routing change in Step 4 is still required for correctness and is covered by Step 6's full suite).

- [ ] **Step 4: Route non-callout folder blocks to `setuBlock` in `blocks.ts`**

Replace the `fromBlocks` mapping inside `slashBlocks` so the inserted node type depends on the tag:

```ts
  const fromBlocks: SlashBlock[] = registry.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    run: (e: Editor, r: Range) => {
      const chain = e.chain().focus().deleteRange(r)
      if (b.tag === 'callout') {
        // Callout has its own dedicated React editor node.
        chain.insertContent({ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
      } else {
        // Every other folder block uses the generic node, keyed by tag.
        chain.insertContent({ type: 'setuBlock', attrs: { tag: b.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
      }
      chain.run()
    },
  }))
```

- [ ] **Step 5: Register the node in `Canvas.tsx`**

Add the imports near the other extension imports:

```ts
import { createSetuBlock } from './extensions/SetuBlock'
import { registry } from '../blocks/registry'
```

and add `createSetuBlock(registry.blocks)` to the `extensions: [...]` array, immediately after `Callout,`:

```ts
      Callout,
      createSetuBlock(registry.blocks),
      Passthrough,
```

- [ ] **Step 6: Run the admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — `Notice` in the slash menu; all existing callout/slash/editor/registry tests green (callout still routes to its own node).

- [ ] **Step 7: Commit**

```bash
git add blocks/notice apps/admin/src/editor/blocks.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/blocks.test.ts
git commit -m "feat(admin): add dependency-free notice folder block; route folder blocks to setuBlock"
```

---

### Task 4: Site — render `notice` end-to-end (proof) + full-repo green

**Files:**
- Modify: `content/post/en/kitchen-sink.mdoc` (add a `{% notice %}` to the fixture)
- Modify: `apps/site/test/render.test.ts` (assert the notice render)

**Interfaces:**
- Consumes: the full build pipeline — Slice A's `prebuild`→`gen-blocks` auto-discovers `blocks/notice/` and generates its `markdoc.config` tag pointing at `notice.astro`; `render.test.ts`'s `beforeAll` runs `pnpm build` and reads `dist/post/kitchen-sink/index.html`.

- [ ] **Step 1: Add a notice to the kitchen-sink fixture**

In `content/post/en/kitchen-sink.mdoc`, after the existing callout block (~line 17), add:

```markdoc
{% notice tone="success" title="Good news" %}
A notice rendered from a **dependency-free** folder block.
{% /notice %}
```

- [ ] **Step 2: Write the failing assertions**

In `apps/site/test/render.test.ts`, add a new describe block after the callout block (~line 54):

```ts
describe('render pipeline — generic folder block (notice)', () => {
  it('renders the dependency-free notice block through the generated registration', () => {
    expect(html).toContain('notice notice-success') // tone class (Astro may append a scope class)
    expect(html).toContain('Good news') // title
    expect(html).toContain('<strong>dependency-free</strong>') // body markdown rendered
  })
  it('ships zero JS for the folder block (static, no island)', () => {
    expect(html).not.toContain('astro-island')
  })
})
```

- [ ] **Step 3: Run the site tests**

Run: `pnpm --filter @setu/site test`
Expected: PASS — the new notice assertions pass AND the 30 existing render/theme tests stay green. `pnpm build` runs `prebuild`→`gen-blocks` so `notice`'s tag + `notice.astro` are wired with no config edit. (No resolver work: `notice.astro` has no bare imports, and the `../../blocks/...` `component()` path already resolves — proven by callout in Slice A.)

- [ ] **Step 4: Commit**

```bash
git add content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts
git commit -m "test(site): prove a dependency-free notice folder block renders end-to-end"
```

---

### Task 5: Full-repo green + manual walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run every suite + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green — core (incl. `setu-block-roundtrip`), admin (incl. `setu-block-node`, `blocks`), site (incl. notice render), blocks, theme-default, api, db/git adapters.

- [ ] **Step 2: Manual walkthrough (the proof)**

Run: `pnpm dev`. Verify by hand:
1. `/` → **Notice** appears; insert it → a generic block with a `tone` dropdown (defaulted to `info`) + a `title` field + an editable body.
2. Set tone=success, type a title and body; **Preview** → the notice renders through the theme.
3. Publish → the `.mdoc` contains `{% notice tone="success" title="…" %}…{% /notice %}`.
4. Reopen the entry → it round-trips back to a Notice block (a `setuBlock`, not a passthrough).
5. The site renders the notice.

Expected: all five hold, with **no** edit to `setu.config`, `markdoc.config`, the converters' callout branch, or any hand-written editor node — and callout still behaves exactly as before.

- [ ] **Step 3: Final commit (only if walkthrough fixes were needed)**

```bash
git add -A && git commit -m "chore: generic setuBlock node (Slice B) — full green"
```

---

## Self-Review

**Spec coverage:**
- Generic `setuBlock` round-trip (callout frozen) → Task 1. ✓
- Generic editor node + auto-form from `markdocAttributesFor(props)` + missing-manifest degrade → Task 2. ✓
- Slash routing (callout→callout node, others→setuBlock) → Task 3. ✓
- Dependency-free `notice` proof block (enum `tone` + optional `title`) → Tasks 3 (folder) + 4 (render). ✓
- Site render via Slice A codegen, 30 render tests green → Task 4. ✓
- Content-safety (unknown→passthrough; byte-stable) → Task 1 tests + frozen passthrough path. ✓
- Build-time only / CF-safe → no astro.config/runtime change; Global Constraints. ✓

**Placeholder scan:** none — complete code in every step. Task 3 Step 3's note about the assertion possibly already passing is a real TDD caveat (the glob may discover the folder created in Step 1), not a placeholder; the routing change is still required and is gated by Step 6.

**Type consistency:** `createSetuBlock(blocks: ResolvedBlock[])` (Task 2) is fed `registry.blocks` (Task 3) — `registry.blocks` is `ResolvedBlock[]` (Slice A). The node attrs `{tag, mdAttrs}` (Task 2) match the converter output `{ type: 'setuBlock', attrs: { tag, mdAttrs } }` (Task 1). `markdocAttributesFor` returns `{type, matches?, default?}` — the view reads `a.matches`/`a.default` exactly as Slice A defined them. Slash insert uses `type: 'setuBlock'` matching the node `name: 'setuBlock'`.
