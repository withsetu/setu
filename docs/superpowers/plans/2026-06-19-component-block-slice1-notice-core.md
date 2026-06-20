# Component-block model — Slice 1 (notice renders its real visual in the editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-author `notice` as a React-core block (the callout pattern) so it renders its real visual in the editor and on the site from one shared core in `@setu/blocks` — with no new machinery, callout untouched.

**Architecture:** `notice`'s visual moves into `@setu/blocks` as `Notice.tsx` + `notice.css` (exported like callout's). The site wrapper `notice.astro` SSRs the core (like `callout.astro`). The editor's generic `setuBlock` node view renders the block's real React core when one is registered (a `blockCores` tag→component map from `@setu/blocks`), falling back to today's chrome otherwise.

**Tech Stack:** React 18, `@tiptap/react` 3.26.1, Astro 6 + `@astrojs/react`, `@setu/core`, Vitest + `@testing-library/react`.

## Global Constraints

- **Rule #1 — read source first** before any Tiptap/Astro/React API use.
- **Rule #2 — Cloudflare + cost-safe:** the core SSRs to **static HTML at build, zero per-visitor cost** (exactly as callout does). No `client:` islands in this slice.
- **Callout is frozen and UNtouched:** do not modify `Callout.tsx`, `callout.css`, `variants.ts`, the admin `Callout` editor node, `blocks/callout/`, or callout's tests. This slice makes `notice` *match* callout; it does not refactor callout.
- **No new machinery:** no codegen changes, no package restructure, no repo-root `blocks/` removal, no Tiptap added to `@setu/blocks`. (All deferred — see the spec's Out-of-scope.)
- **Content-safety / round-trip unchanged:** `block.ts`, the Markdoc tag, `gen-blocks`, and the round-trip are NOT touched — `notice.astro` stays the tag's render target.
- **Versions:** do not bump React 18, the Tiptap 3.26.1 suite, Astro 6.4.6.
- **Branch:** `feat/component-block-convention` (already checked out).

---

### Task 1: `@setu/blocks` — the `Notice` React core + styles + `blockCores`

**Files:**
- Create: `packages/blocks/src/notice/Notice.tsx`
- Create: `packages/blocks/src/notice/notice.css`
- Modify: `packages/blocks/src/index.ts` (exports + `blockCores`)
- Modify: `packages/blocks/package.json` (`exports` adds `./notice.css`)
- Test: `packages/blocks/test/notice.test.tsx`

**Interfaces:**
- Produces: `Notice` (React component, props `{ tone?: string; title?: ReactNode; children: ReactNode }`) and `blockCores: Record<string, ComponentType<any>>` (`{ notice: Notice }`) — both exported from `@setu/blocks`; `@setu/blocks/notice.css` importable.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/blocks/test/notice.test.tsx
import { render } from '@testing-library/react'
import { Notice } from '../src/notice/Notice'

test('renders the tone class, optional title, and body', () => {
  const { container } = render(
    <Notice tone="success" title="Good news">
      <p>Body text</p>
    </Notice>,
  )
  const aside = container.querySelector('aside.notice.notice-success')
  expect(aside).toBeTruthy()
  expect(container.querySelector('.notice-title')?.textContent).toBe('Good news')
  expect(container.querySelector('.notice-body')?.textContent).toBe('Body text')
})

test('omits the title when not provided and defaults the tone to info', () => {
  const { container } = render(<Notice><span /></Notice>)
  expect(container.querySelector('aside.notice.notice-info')).toBeTruthy()
  expect(container.querySelector('.notice-title')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/blocks test -- notice`
Expected: FAIL — cannot find `../src/notice/Notice`.

- [ ] **Step 3: Write the core + styles**

```tsx
// packages/blocks/src/notice/Notice.tsx
import type { ReactNode } from 'react'

export interface NoticeProps {
  /** CSS tone suffix: info | warn | success. */
  tone?: string
  /** Optional heading shown above the body. */
  title?: ReactNode
  /** The notice body. */
  children: ReactNode
}

/** The single notice visual core — rendered by BOTH the editor node view and the site
 *  wrapper (the callout pattern). Owns the structure + class contract. */
export function Notice({ tone = 'info', title, children }: NoticeProps) {
  return (
    <aside className={`notice notice-${tone}`}>
      {title ? <p className="notice-title">{title}</p> : null}
      <div className="notice-body">{children}</div>
    </aside>
  )
}
```

```css
/* packages/blocks/src/notice/notice.css — token-fallback styles (loaded by site + admin) */
.notice {
  border-left: 4px solid var(--accent, #6366f1);
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
}
.notice-warn { border-color: #d97706; background: color-mix(in srgb, #d97706 8%, transparent); }
.notice-success { border-color: #16a34a; background: color-mix(in srgb, #16a34a 8%, transparent); }
.notice-title { font-weight: 600; margin: 0 0 0.25rem; }
.notice-body > :last-child { margin-bottom: 0; }
```

- [ ] **Step 4: Export from the barrel + package**

In `packages/blocks/src/index.ts`, append:

```ts
import type { ComponentType } from 'react'
import { Notice } from './notice/Notice'
export { Notice }
export type { NoticeProps } from './notice/Notice'

/** Block tag -> its React visual core, for the editor's in-canvas rendering. Excludes
 *  callout (which keeps its own bespoke editor node view). */
export const blockCores: Record<string, ComponentType<any>> = { notice: Notice }
```

In `packages/blocks/package.json`, add the CSS subpath to `exports` (beside `./callout.css`):

```json
  "exports": {
    ".": "./src/index.ts",
    "./callout.css": "./src/callout/callout.css",
    "./notice.css": "./src/notice/notice.css"
  },
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @setu/blocks test && pnpm --filter @setu/blocks typecheck`
Expected: PASS (2 new tests + existing callout/icon/variants green).

- [ ] **Step 6: Commit**

```bash
git add packages/blocks/src/notice packages/blocks/src/index.ts packages/blocks/package.json packages/blocks/test/notice.test.tsx
git commit -m "feat(blocks): add the Notice React core + styles + blockCores map"
```

---

### Task 2: Editor — the `setuBlock` node view renders the real core

**Files:**
- Modify: `apps/admin/src/editor/extensions/SetuBlock.tsx`
- Modify: `apps/admin/src/editor/Canvas.tsx` (pass `blockCores`)
- Modify: `apps/admin/src/styles/editor.css` (import `notice.css`)
- Test: `apps/admin/test/setu-block-node.test.tsx` (add a core-rendering test)

**Interfaces:**
- Consumes: `blockCores`, `Notice` (`@setu/blocks`); `ResolvedBlock`, `markdocAttributesFor` (`@setu/core`).
- Produces: `createSetuBlock(blocks: ResolvedBlock[], cores?: Record<string, ComponentType<any>>): Node` — when `cores[tag]` exists, the node view renders `<Core {...mdAttrs}><NodeViewContent/></Core>` + the options form; otherwise it renders today's chrome. Backward compatible (cores defaults to `{}`).

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/test/setu-block-node.test.tsx`:

```tsx
import { Notice } from '@setu/blocks'

describe('setuBlock node view — real core rendering', () => {
  it('renders the block\'s real React core in-canvas when a core is registered', async () => {
    const noticeBlock: ResolvedBlock = {
      tag: 'notice',
      props: z.object({ tone: z.enum(['info', 'warn', 'success']).default('info'), title: z.string().optional() }),
      component: 'blocks/notice/notice.astro',
      editor: { label: 'Notice' },
    }
    function Harness() {
      const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit, createSetuBlock([noticeBlock], { notice: Notice })],
        content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag: 'notice', mdAttrs: { tone: 'success', title: 'Hi' } }, content: [{ type: 'paragraph' }] }] },
      })
      return <EditorContent editor={editor} />
    }
    const { container } = render(<Harness />)
    expect(await screen.findByText('Hi')).toBeInTheDocument()
    // the REAL core markup is in-canvas (not chrome):
    expect(container.querySelector('aside.notice.notice-success')).toBeTruthy()
    // the options form is still present:
    expect(screen.getByLabelText('tone')).toBeInTheDocument()
  })
})
```

(The file already imports `useEditor`, `EditorContent`, `StarterKit`, `z`, `render`, `screen`, `ResolvedBlock`, `createSetuBlock` for the existing tests — reuse those imports; add only the `Notice` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- setu-block-node`
Expected: FAIL — `createSetuBlock` ignores cores; no `aside.notice` rendered (chrome only).

- [ ] **Step 3: Render the core in the node view**

Replace `apps/admin/src/editor/extensions/SetuBlock.tsx` with:

```tsx
import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import { markdocAttributesFor } from '@setu/core'
import type { ResolvedBlock } from '@setu/core'

function viewFor(byTag: Record<string, ResolvedBlock>, cores: Record<string, ComponentType<any>>) {
  return function SetuBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const tag = String(node.attrs.tag)
    const block = byTag[tag]
    const Core = cores[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    // Derive the form from the same zod props the contract declares (DRY with the codegen).
    const attrs = block ? markdocAttributesFor(block.props) : {}
    const label = block?.editor?.label ?? tag

    const setAttr = (name: string, value: unknown) => {
      const next: Record<string, unknown> = { ...mdAttrs }
      if (value === '') delete next[name]
      else next[name] = value
      updateAttributes({ mdAttrs: next })
    }

    const form =
      Object.keys(attrs).length > 0 ? (
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
              ) : a.type === 'Number' ? (
                <input
                  type="number"
                  value={String(mdAttrs[name] ?? a.default ?? '')}
                  onChange={(e) => (e.target.value === '' ? setAttr(name, '') : setAttr(name, Number(e.target.value)))}
                />
              ) : a.type === 'Boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(mdAttrs[name] ?? a.default ?? false)}
                  onChange={(e) => setAttr(name, e.target.checked)}
                />
              ) : (
                <input type="text" value={String(mdAttrs[name] ?? '')} onChange={(e) => setAttr(name, e.target.value)} />
              )}
            </label>
          ))}
        </div>
      ) : null

    // When the block has a registered React core, render the REAL visual with the editable
    // body inside it (the callout pattern). Otherwise fall back to generic chrome.
    if (Core) {
      return (
        <NodeViewWrapper>
          <div className="setu-block" data-tag={tag}>
            {form}
            <Core {...mdAttrs}>
              <NodeViewContent />
            </Core>
          </div>
        </NodeViewWrapper>
      )
    }

    return (
      <NodeViewWrapper>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{label}</span>
          </div>
          {form}
          <NodeViewContent className="setu-block-body" />
        </div>
      </NodeViewWrapper>
    )
  }
}

/** The generic folder-block node. `tag` selects the registry entry + (optionally) a React
 *  core; `mdAttrs` is the round-tripped attribute bag (JSON-only, kept out of the DOM like
 *  callout). With a core, the view renders the real visual; otherwise generic chrome. */
export function createSetuBlock(blocks: ResolvedBlock[], cores: Record<string, ComponentType<any>> = {}): Node {
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
      return ReactNodeViewRenderer(viewFor(byTag, cores))
    },
  })
}
```

- [ ] **Step 4: Wire `blockCores` + the CSS into the editor**

In `apps/admin/src/editor/Canvas.tsx`: add `blockCores` to the `@setu/blocks` import and pass it:

```ts
import { blockCores } from '@setu/blocks'
```
and change the extension registration (line ~109):

```ts
      createSetuBlock(registry.blocks, blockCores),
```

In `apps/admin/src/styles/editor.css`, add beside the existing callout import (line ~7):

```css
@import '@setu/blocks/notice.css';
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @setu/admin test -- setu-block-node && pnpm --filter @setu/admin typecheck`
Expected: PASS — the new core-rendering test plus the existing setu-block-node tests (the existing ones call `createSetuBlock([...])` with no cores → chrome fallback, unchanged).

- [ ] **Step 6: Run the full admin suite (regression guard)**

Run: `pnpm --filter @setu/admin test`
Expected: PASS — callout/slash/registry/round-trip tests all green.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/extensions/SetuBlock.tsx apps/admin/src/editor/Canvas.tsx apps/admin/src/styles/editor.css apps/admin/test/setu-block-node.test.tsx
git commit -m "feat(admin): render a block's real React core in-canvas (notice), chrome as fallback"
```

---

### Task 3: Site — `notice.astro` SSRs the React core

**Files:**
- Modify: `blocks/notice/notice.astro`

**Interfaces:**
- Consumes: `Notice` + `@setu/blocks/notice.css` (Task 1). The Markdoc tag, `block.ts`, and `gen-blocks` are unchanged — `notice.astro` remains the tag's render target.

- [ ] **Step 1: Replace the plain-HTML notice with the core wrapper**

Replace `blocks/notice/notice.astro` with (mirrors `blocks/callout/callout.astro`):

```astro
---
import { Notice } from '@setu/blocks'
import '@setu/blocks/notice.css'

const { tone = 'info', title } = Astro.props
---

<Notice tone={tone} title={title}><slot /></Notice>
```

- [ ] **Step 2: Run the site tests**

Run: `pnpm --filter @setu/site test`
Expected: PASS — the kitchen-sink `{% notice tone="success" title="Good news" %}` still renders (now via the React core): the existing assertions (`notice notice-success`, the title, the body `<strong>`) stay green, and the **30 existing render tests stay green** (callout byte-identical; notice SSRs to static HTML with zero `astro-island`). `@setu/blocks`'s `@setu/blocks/*` imports resolve via the site's existing `resolveMarkdocFromApp` plugin (same path callout uses).

> If the `@setu/blocks/notice.css` import fails to resolve in the build, the existing site plugin already resolves `@setu/blocks/*` (it does so for `@setu/blocks/callout.css`) — verify the plugin covers the subpath; no new plugin entry should be needed.

- [ ] **Step 3: Commit**

```bash
git add blocks/notice/notice.astro
git commit -m "feat(site): render notice via the shared React core (matches callout)"
```

---

### Task 4: Full-repo green + manual walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run every suite + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green — `@setu/blocks` (Notice + existing), admin (setu-block core render + existing), site (notice via core + 30 render), core, theme-default, api, db/git adapters.

- [ ] **Step 2: Manual walkthrough (the proof)**

Run: `pnpm dev` (restart if already running, so the editor re-globs and the site `prebuild` reruns). Verify by hand:
1. Insert a **Notice** from `/` → it now shows the **real notice box** (tone-colored `aside`, the title, the editable body) in-canvas — not bare chrome — with the tone/title options form above it.
2. Change tone to `warn`/`success` and type a title → the in-canvas notice restyles/updates live.
3. Type body content; **Preview** / publish → the site renders the same notice; reopen → it round-trips back to a Notice block.
4. Callout is unchanged — still inserts/edits/renders exactly as before.

Expected: notice renders its real visual in the editor (the fix), identical to how it renders on the site, with callout untouched.

- [ ] **Step 3: Final commit (only if walkthrough fixes were needed)**

```bash
git add -A && git commit -m "chore: component-block slice 1 (notice core) — full green"
```

---

## Self-Review

**Spec coverage:**
- `notice` visual → a React core in `@setu/blocks` (+ css + exports + `blockCores`) → Task 1. ✓
- Editor generic node renders the real core, chrome fallback → Task 2. ✓
- Site `notice.astro` SSRs the core (callout's pattern) → Task 3. ✓
- Callout untouched; no new machinery; round-trip/codegen/`block.ts` unchanged → Global Constraints + Tasks scoped to the named files only. ✓
- Tests: blocks render, admin core-render + chrome-fallback, site render stays green, full repo → Tasks 1–4. ✓
- Cost/CF: static SSR, zero JS → Task 3 framing. ✓

**Placeholder scan:** none — complete code in every code step. The Task 3 Step 2 note (CSS subpath resolution) is a verification with the existing-plugin fact, not a gap.

**Type consistency:** `createSetuBlock(blocks, cores?)` (Task 2) is called as `createSetuBlock(registry.blocks, blockCores)` (Canvas) and `createSetuBlock([noticeBlock], { notice: Notice })` (test); `blockCores: Record<string, ComponentType<any>>` (Task 1) matches the `cores` param type (Task 2); `Notice` props `{ tone, title, children }` match `<Notice tone title><slot/></Notice>` (Task 3) and `<Core {...mdAttrs}>` where `mdAttrs = { tone, title }` (Task 2). The `setuBlock` node attrs `{ tag, mdAttrs }` are unchanged from Slice B. ✓
