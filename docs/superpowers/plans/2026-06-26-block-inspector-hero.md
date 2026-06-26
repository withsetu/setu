# Block inspector + hero block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a contextual right-rail **block inspector** that edits a selected block's props with shadcn controls auto-derived from its zod contract (+ optional control hints), and prove it with a real props-only **hero** marketing block (token-themed zero-JS on the site, live WYSIWYG in the canvas).

**Architecture:** Core gains an optional per-prop `controls` hint + a pure `resolveControls` resolver. The hero is an atom block mirroring the existing `contactBlock`/`imageBlock` pattern (contract in `@setu/core/blocks/standard`, converter branches, a token-themed `Hero.astro` site renderer + a `Hero.tsx` canvas core sharing one `hero.css`). The admin gets a generic `BlockInspector` (renders one shadcn control per prop) and a `useSelectedBlock` hook feeding a Document/Block contextual rail in `EditorScreen`; the cramped inline `.block-props` form in `SetuBlock.tsx` is removed.

**Tech Stack:** TypeScript, zod, React 19, TipTap/ProseMirror, Astro, Tailwind v4 + shadcn/ui, Vitest + Testing Library, pnpm workspaces, Markdoc.

## Global Constraints

- **Contract in core, renderer in theme/blocks.** The block *contract* (props + editor meta + control hints) ships in `@setu/core`; the renderer lives in `@setu/blocks`. Never put presentation in core.
- **Zero-JS default** for the site renderer (`Hero.astro` emits static HTML + token CSS, no client JS).
- **Backward compatible:** blocks without a `controls` hint behave exactly as today (zod-derived controls). No existing block contract changes behavior.
- **Pure shadcn token vocabulary** in admin/blocks CSS — `--popover`/`--card`/`--muted-foreground`/`--border`/`--accent`/`--ring`/`--primary`/`--radius` (+ existing `@setu/blocks` shared tokens `--accent`/`--on-accent`/`--r-md`). A repo guard test `no-brand-accent-in-bespoke-css` FORBIDS bare `var(--accent)` in hand-written admin CSS — use Tailwind utilities or the `--surface-hover` alias there; `@setu/blocks` block CSS may use the shared block tokens it already uses.
- **Markdoc portability:** hero serializes to a self-closing `{% hero ... /%}` tag (props-only, no nested body), round-tripping verbatim.
- Import admin primitives from `@/components/ui/*`, `cn` from `@/lib/utils`.
- Full gate `pnpm typecheck && pnpm test && pnpm build` green. Visual UAT (owner, light+dark) is the done bar.
- Branch per the migration norm; commit per task; do NOT `git add` anything under `.superpowers/`.

---

### Task 1: Core — `controls` hint + `resolveControls` resolver

**Files:**
- Modify: `packages/core/src/config/types.ts` (add `controls?` to `BlockEditorMeta`)
- Create: `packages/core/src/blocks/resolve-controls.ts`
- Modify: `packages/core/src/index.ts` (export `resolveControls`, `BlockControl`)
- Test: `packages/core/test/resolve-controls.test.ts` (or the core test dir convention — mirror an existing `packages/core/test/*.test.ts`)

**Interfaces:**
- Consumes: `markdocAttributesFor(props)` from `packages/core/src/blocks/markdoc-attributes.ts` → `Record<string, { type: 'String'|'Number'|'Boolean'; default?; matches?: string[] }>`.
- Produces: `type BlockControl = 'text'|'textarea'|'number'|'switch'|'select'|'media'|'url'`; `interface ResolvedControl { name: string; control: BlockControl; default?: unknown; options?: string[] }`; `function resolveControls(props: ZodTypeAny, hints?: Record<string,BlockControl>): ResolvedControl[]`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../src/blocks/resolve-controls'

describe('resolveControls', () => {
  const props = z.object({
    headline: z.string(),
    subhead: z.string().optional(),
    count: z.number().default(3),
    featured: z.boolean().default(false),
    variant: z.enum(['left', 'center']).default('center'),
  })

  it('derives controls from zod when no hints given', () => {
    const out = resolveControls(props)
    expect(out).toEqual([
      { name: 'headline', control: 'text' },
      { name: 'subhead', control: 'text' },
      { name: 'count', control: 'number', default: 3 },
      { name: 'featured', control: 'switch', default: false },
      { name: 'variant', control: 'select', default: 'center', options: ['left', 'center'] },
    ])
  })

  it('lets a hint override the zod-derived control (string→textarea/media/url)', () => {
    const out = resolveControls(props, { subhead: 'textarea', headline: 'text' })
    expect(out.find((c) => c.name === 'subhead')!.control).toBe('textarea')
  })

  it('throws when a hint names a prop not in the schema', () => {
    expect(() => resolveControls(props, { nope: 'text' })).toThrow(/unknown prop/i)
  })

  it('throws when a hint is incompatible with the zod type (switch on a string)', () => {
    expect(() => resolveControls(props, { headline: 'switch' })).toThrow(/incompatible/i)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `cd packages/core && pnpm vitest run test/resolve-controls.test.ts`
Expected: FAIL "Cannot find module '../src/blocks/resolve-controls'".

- [ ] **Step 3: Add the `controls` field to `BlockEditorMeta`.** In `packages/core/src/config/types.ts`, inside `interface BlockEditorMeta`, add after `variants?`:

```ts
  /** Optional per-prop editor control override. When absent for a prop, the control is
   *  derived from its zod type (Enum→select, Number→number, Boolean→switch, String→text).
   *  String-backed props may upgrade to 'textarea' | 'media' | 'url'. */
  controls?: Record<string, BlockControl>
```
And add the exported type at the top of the same file (after the imports):
```ts
export type BlockControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'media' | 'url'
```

- [ ] **Step 4: Implement the resolver.** Create `packages/core/src/blocks/resolve-controls.ts`:

```ts
import type { ZodTypeAny } from 'zod'
import type { BlockControl } from '../config/types'
import { markdocAttributesFor } from './markdoc-attributes'

export interface ResolvedControl {
  name: string
  control: BlockControl
  default?: unknown
  options?: string[]
}

/** String-backed controls a hint may upgrade a String prop to. */
const STRING_CONTROLS: ReadonlySet<BlockControl> = new Set(['text', 'textarea', 'media', 'url'])

/** Map a block's zod props (+ optional per-prop control hints) to an ordered list of
 *  controls for the inspector. Hints override the zod-derived control but must be
 *  type-compatible; an unknown prop or an incompatible hint throws (never silently lossy,
 *  mirroring markdocAttributesFor). */
export function resolveControls(
  props: ZodTypeAny,
  hints: Record<string, BlockControl> = {},
): ResolvedControl[] {
  const attrs = markdocAttributesFor(props)
  for (const prop of Object.keys(hints)) {
    if (!(prop in attrs)) throw new Error(`resolveControls: hint for unknown prop "${prop}"`)
  }
  return Object.entries(attrs).map(([name, a]) => {
    // zod-derived default control
    const derived: BlockControl = a.matches ? 'select' : a.type === 'Number' ? 'number' : a.type === 'Boolean' ? 'switch' : 'text'
    const hint = hints[name]
    if (hint === undefined) {
      return { name, control: derived, ...(a.default !== undefined ? { default: a.default } : {}), ...(a.matches ? { options: a.matches } : {}) }
    }
    // a hint is only valid if compatible with the zod type
    const ok =
      (a.matches && hint === 'select') ||
      (a.type === 'Number' && hint === 'number') ||
      (a.type === 'Boolean' && hint === 'switch') ||
      (a.type === 'String' && !a.matches && STRING_CONTROLS.has(hint))
    if (!ok) throw new Error(`resolveControls: hint "${hint}" incompatible with prop "${name}" (zod ${a.type}${a.matches ? ' enum' : ''})`)
    return { name, control: hint, ...(a.default !== undefined ? { default: a.default } : {}), ...(a.matches ? { options: a.matches } : {}) }
  })
}
```

- [ ] **Step 5: Export from core.** In `packages/core/src/index.ts`, add:
```ts
export { resolveControls } from './blocks/resolve-controls'
export type { ResolvedControl } from './blocks/resolve-controls'
export type { BlockControl } from './config/types'
```

- [ ] **Step 6: Run the test — expect PASS.**

Run: `cd packages/core && pnpm vitest run test/resolve-controls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/config/types.ts packages/core/src/blocks/resolve-controls.ts packages/core/src/index.ts packages/core/test/resolve-controls.test.ts
git commit -m "feat(core): block control-hints + resolveControls resolver"
```

---

### Task 2: Core — hero contract + Markdoc round-trip

**Files:**
- Create: `packages/core/src/blocks/standard/hero.ts`
- Modify: `packages/core/src/blocks/standard/index.ts` (add `heroBlock` to `STANDARD_BLOCKS`)
- Modify: `packages/core/src/markdoc/to-tiptap.ts` (map `{% hero %}` → `heroBlock` node)
- Modify: `packages/core/src/markdoc/to-markdoc.ts` (serialize `heroBlock` → self-closing `{% hero /%}`)
- Test: `packages/core/test/hero-block.test.ts`

**Interfaces:**
- Consumes: `defineBlock`, `StandardBlock`, `BlockControl` (Task 1).
- Produces: `heroBlock: StandardBlock` (tag `'hero'`, renderer `'@setu/blocks/hero.astro'`); TipTap node type name **`heroBlock`** carrying `{ mdAttrs }`; Markdoc tag `hero`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { markdocToTiptap } from '../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../src/markdoc/to-markdoc'
import { parseMarkdoc } from '../src/markdoc/parse' // existing helper used by other round-trip tests

describe('hero block', () => {
  it('is registered as a standard block with control hints', () => {
    const hero = STANDARD_BLOCKS.find((b) => b.tag === 'hero')
    expect(hero).toBeDefined()
    expect(hero!.renderer).toBe('@setu/blocks/hero.astro')
    expect(hero!.contract.editor?.group).toBe('marketing')
    expect(hero!.contract.editor?.controls?.image).toBe('media')
  })

  it('round-trips {% hero /%} through tiptap and back', () => {
    const src = '{% hero headline="Welcome" subhead="Build fast" image="/media/2026/06/x.webp" ctaLabel="Start" ctaHref="/start" variant="center" /%}'
    const doc = markdocToTiptap(parseMarkdoc(src), { knownBlockTags: new Set(['hero']) })
    const hero = doc.content!.find((n) => n.type === 'heroBlock')
    expect(hero).toBeDefined()
    expect(hero!.attrs!.mdAttrs).toMatchObject({ headline: 'Welcome', variant: 'center', image: '/media/2026/06/x.webp' })
    const out = tiptapToMarkdoc(doc)
    expect(out).toContain('{% hero')
    expect(out).toContain('headline="Welcome"')
    expect(out).toContain('/%}')
  })
})
```
NOTE for the implementer: confirm the actual helper names used by sibling round-trip tests (e.g. `packages/core/test/*image*`/`*callout*`). If the parse helper or function names differ (`markdocToTiptap` vs `toTiptap`), match the real exports — do not invent. The assertions (registration + self-closing round-trip) are what matters.

- [ ] **Step 2: Run it — expect FAIL** (no hero block; converter has no `hero` branch).

Run: `cd packages/core && pnpm vitest run test/hero-block.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the hero contract.** `packages/core/src/blocks/standard/hero.ts`:

```ts
import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

export const heroBlock: StandardBlock = {
  tag: 'hero',
  renderer: '@setu/blocks/hero.astro',
  contract: defineBlock({
    props: z.object({
      headline: z.string(),
      subhead: z.string().optional(),
      image: z.string().optional(),
      ctaLabel: z.string().optional(),
      ctaHref: z.string().optional(),
      variant: z.enum(['left', 'center']).default('center'),
    }),
    editor: {
      label: 'Hero',
      icon: 'layout',
      group: 'marketing',
      keywords: ['hero', 'banner', 'cta', 'header'],
      controls: { headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url', variant: 'select' },
    },
  }),
}
```

- [ ] **Step 4: Register it.** In `packages/core/src/blocks/standard/index.ts`:
```ts
import { buttonBlock } from './button'
import { heroBlock } from './hero'
export const STANDARD_BLOCKS: StandardBlock[] = [buttonBlock, heroBlock]
```

- [ ] **Step 5: Map the tag in `to-tiptap.ts`.** In the block-tag switch (near the `image`/`contact` branches around line 152), add a `hero` branch BEFORE the `setuBlock` fallback:
```ts
      if (tag === 'hero') {
        return { type: 'heroBlock', attrs: { mdAttrs: node.attributes } }
      }
```

- [ ] **Step 6: Serialize in `to-markdoc.ts`.** In `buildBlock`'s switch, add a `heroBlock` case mirroring the `contactBlock`/`contact` case (simple self-closing tag, no body):
```ts
    case 'heroBlock':
      return new N('tag', (attrs['mdAttrs'] ?? {}) as Record<string, unknown>, [], 'hero')
```
(Place it beside the existing `contactBlock` case. The `N`/`Markdoc.format` plumbing already emits `{% hero ... /%}` self-closing for an empty-children tag.)

- [ ] **Step 7: Run the test — expect PASS.**

Run: `cd packages/core && pnpm vitest run test/hero-block.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/blocks/standard/hero.ts packages/core/src/blocks/standard/index.ts packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/hero-block.test.ts
git commit -m "feat(core): hero standard block + {% hero %} round-trip"
```

---

### Task 3: `@setu/blocks` — Hero renderer (site) + canvas core + shared CSS

**Files:**
- Create: `packages/blocks/src/hero/Hero.astro` (site renderer, zero-JS)
- Create: `packages/blocks/src/hero/Hero.tsx` (canvas preview core)
- Create: `packages/blocks/src/hero/hero.css` (shared token CSS)
- Modify: `packages/blocks/src/index.ts` (add `hero` to `blockCores`)
- Test: `packages/blocks/test/hero-core.test.tsx`

**Interfaces:**
- Consumes: hero props (Task 2): `headline`, `subhead?`, `image?`, `ctaLabel?`, `ctaHref?`, `variant`.
- Produces: `blockCores.hero` (a `ComponentType` rendering `<section class="blk-hero variant-…">`); `@setu/blocks/hero.astro` resolvable as a bare specifier (matches `button.astro`).

- [ ] **Step 1: Write the failing test** (canvas core renders props into the shared class contract).

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '../src/hero/Hero'

describe('Hero canvas core', () => {
  it('renders headline, subhead, CTA and variant class from props', () => {
    const { container } = render(
      <Hero headline="Welcome" subhead="Build fast" ctaLabel="Start" ctaHref="/start" variant="left" />,
    )
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Build fast')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(container.querySelector('.blk-hero.variant-left')).toBeTruthy()
  })

  it('omits CTA + image when those props are absent', () => {
    const { container } = render(<Hero headline="Only headline" variant="center" />)
    expect(container.querySelector('.blk-hero-cta')).toBeNull()
    expect(container.querySelector('.blk-hero-img')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (no Hero core).

Run: `cd packages/blocks && pnpm vitest run test/hero-core.test.tsx`
Expected: FAIL "Cannot find module '../src/hero/Hero'".

- [ ] **Step 3: Implement the canvas core.** `packages/blocks/src/hero/Hero.tsx`:

```tsx
import './hero.css'

export interface HeroProps {
  headline: string
  subhead?: string
  image?: string
  ctaLabel?: string
  ctaHref?: string
  variant?: 'left' | 'center'
}

/** The hero visual core. Rendered read-only in the editor canvas (props from the node's
 *  mdAttrs); the site mirrors this exact class structure in Hero.astro, sharing hero.css. */
export function Hero({ headline, subhead, image, ctaLabel, ctaHref, variant = 'center' }: HeroProps) {
  return (
    <section className={`blk-hero variant-${variant}`}>
      {image ? <img className="blk-hero-img" src={image} alt="" /> : null}
      <div className="blk-hero-body">
        <h2 className="blk-hero-headline">{headline}</h2>
        {subhead ? <p className="blk-hero-subhead">{subhead}</p> : null}
        {ctaLabel && ctaHref ? <span className="blk-hero-cta">{ctaLabel}</span> : null}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Shared CSS.** `packages/blocks/src/hero/hero.css` (token-themed; uses the shared block tokens already used by `Button.astro` — `--accent`/`--on-accent`/`--r-md`):

```css
.blk-hero { display: flex; flex-direction: column; gap: 1rem; padding: clamp(2rem, 6vw, 4rem); border-radius: var(--r-md, 8px); background: color-mix(in oklch, var(--accent, #4f46e5) 6%, transparent); }
.blk-hero.variant-center { align-items: center; text-align: center; }
.blk-hero-img { width: 100%; max-height: 320px; object-fit: cover; border-radius: var(--r-md, 8px); }
.blk-hero-headline { margin: 0; font-size: clamp(1.75rem, 4vw, 2.75rem); line-height: 1.1; font-weight: 700; }
.blk-hero-subhead { margin: 0; font-size: 1.125rem; opacity: 0.8; max-width: 42rem; }
.blk-hero-cta { display: inline-block; margin-top: 0.5rem; padding: 0.6rem 1.2rem; border-radius: var(--r-md, 8px); background: var(--accent, #4f46e5); color: var(--on-accent, #fff); font-weight: 600; }
```

- [ ] **Step 5: Site renderer.** `packages/blocks/src/hero/Hero.astro` (zero-JS; same class contract; imports the shared CSS):

```astro
---
import './hero.css'
const { headline, subhead, image, ctaLabel, ctaHref, variant = 'center' } = Astro.props
---
<section class={`blk-hero variant-${variant}`}>
  {image && <img class="blk-hero-img" src={image} alt="" />}
  <div class="blk-hero-body">
    <h2 class="blk-hero-headline">{headline}</h2>
    {subhead && <p class="blk-hero-subhead">{subhead}</p>}
    {ctaLabel && ctaHref && <a class="blk-hero-cta" href={ctaHref}>{ctaLabel}</a>}
  </div>
</section>
```

- [ ] **Step 6: Export the core.** In `packages/blocks/src/index.ts`, import `Hero` and add it to `blockCores`:
```ts
import { Hero } from './hero/Hero'
// ...
export const blockCores: Record<string, ComponentType<any>> = { notice: Notice, hero: Hero }
```
Also `export { Hero } from './hero/Hero'` and `export type { HeroProps } from './hero/Hero'` for parity with the other cores.

- [ ] **Step 7: Run the test — expect PASS.**

Run: `cd packages/blocks && pnpm vitest run test/hero-core.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit.**

```bash
git add packages/blocks/src/hero packages/blocks/src/index.ts packages/blocks/test/hero-core.test.tsx
git commit -m "feat(blocks): hero renderer (Hero.astro) + canvas core + shared hero.css"
```

---

### Task 4: Admin — `heroBlock` atom node + slash entry

**Files:**
- Create: `apps/admin/src/editor/extensions/HeroBlock.tsx` (atom node, mirrors `ContactBlock`/`ImageBlock`)
- Modify: `apps/admin/src/editor/Canvas.tsx` (register `HeroBlock` in the extensions list)
- Modify: `apps/admin/src/editor/blocks.ts` (add a Hero slash-menu entry)
- Test: `apps/admin/test/hero-block-node.test.tsx`

**Interfaces:**
- Consumes: `Hero` core via `blockCores.hero` (Task 3); node type name **`heroBlock`** carrying `{ mdAttrs }` (Task 2 converter).
- Produces: a TipTap atom node `HeroBlock` rendering the `Hero` core read-only; selecting it yields a `NodeSelection` the inspector (Task 6) reads.

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'

function makeEditor() {
  return new Editor({
    extensions: [StarterKit, HeroBlock],
    content: { type: 'doc', content: [{ type: 'heroBlock', attrs: { mdAttrs: { headline: 'Welcome', variant: 'center' } } }] },
  })
}

describe('HeroBlock node', () => {
  it('renders the hero headline read-only in the canvas', () => {
    const editor = makeEditor()
    expect(editor.getHTML()).toContain('Welcome')
    expect(document.querySelector('.blk-hero')).toBeTruthy() // node view mounted
    editor.destroy()
  })
})
```
(If the repo's editor tests mount via `@testing-library` + a helper rather than raw `new Editor`, follow that local convention — see `apps/admin/test/image-block-node.test.tsx`. The behavioral assertion — heroBlock renders the Hero core — is the point.)

- [ ] **Step 2: Run it — expect FAIL** (no HeroBlock).

Run: `cd apps/admin && pnpm vitest run test/hero-block-node.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the atom node** (mirror `ContactBlock.tsx`/`ImageBlock.tsx`). `apps/admin/src/editor/extensions/HeroBlock.tsx`:

```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Hero } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'

function HeroBlockView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const apiBase = (editor.storage as unknown as { imageBlock?: { apiBase?: string } }).imageBlock?.apiBase ?? ''
  const image = md['image'] ? resolveMediaSrc(String(md['image']), apiBase || undefined) : undefined
  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="hero" contentEditable={false}>
        <Hero
          headline={String(md['headline'] ?? 'Hero headline')}
          subhead={md['subhead'] ? String(md['subhead']) : undefined}
          image={image}
          ctaLabel={md['ctaLabel'] ? String(md['ctaLabel']) : undefined}
          ctaHref={md['ctaHref'] ? String(md['ctaHref']) : undefined}
          variant={(md['variant'] as 'left' | 'center') ?? 'center'}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% hero %}` block — atom (props-only, no body); props edited in the inspector rail.
 *  Mirrors ImageBlock/ContactBlock: mdAttrs JSON-only, kept out of the DOM, round-tripped
 *  by the core converter (to-tiptap maps hero→heroBlock, to-markdoc emits self-closing). */
export const HeroBlock = Node.create({
  name: 'heroBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-hero-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-setu-hero-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeroBlockView)
  },
})
```

- [ ] **Step 4: Register it in `Canvas.tsx`.** Add the import near the other extension imports:
```ts
import { HeroBlock } from './extensions/HeroBlock'
```
and add `HeroBlock,` to the `extensions` array (beside `ContactBlock,`).

- [ ] **Step 5: Add the slash entry in `blocks.ts`.** In the `BUILTINS` array (beside the Image/Table entries), add:
```ts
  { title: 'Hero', subtitle: 'Headline, subhead, image, CTA', icon: 'layout', group: 'marketing', keywords: ['hero', 'banner', 'cta', 'header'], run: (e, r) =>
    e.chain().focus().deleteRange(r).insertContent({ type: 'heroBlock', attrs: { mdAttrs: { headline: 'Hero headline', variant: 'center' } } }).run() },
```
(Use a valid `icon` — confirm `'layout'` is an admin `IconName` via `apps/admin/src/ui/Icon`; if not, pick an existing one like `'image'` or add the icon. The slash entry must insert a valid empty hero so the user can fill props in the inspector.)

- [ ] **Step 6: Run the test — expect PASS.**

Run: `cd apps/admin && pnpm vitest run test/hero-block-node.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/admin/src/editor/extensions/HeroBlock.tsx apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/blocks.ts apps/admin/test/hero-block-node.test.tsx
git commit -m "feat(admin): heroBlock atom node + slash entry"
```

---

### Task 5: Admin — generic `BlockInspector`

**Files:**
- Create: `apps/admin/src/editor/BlockInspector.tsx`
- Test: `apps/admin/test/BlockInspector.test.tsx`

**Interfaces:**
- Consumes: `resolveControls(props, hints)` → `ResolvedControl[]` (Task 1); `registry.blocks` (each `ResolvedBlock` has `tag`, `props`, `editor`); `MediaPickerModal` (`{ apiBase, open, onClose, onPick }`); `resolveMediaSrc`.
- Produces: `function BlockInspector({ tag, mdAttrs, onChange, apiBase }: { tag: string; mdAttrs: Record<string, unknown>; onChange: (name: string, value: unknown) => void; apiBase: string })`.

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockInspector } from '../src/editor/BlockInspector'

describe('BlockInspector', () => {
  it('renders a control per hero prop and writes edits via onChange', () => {
    const onChange = vi.fn()
    render(<BlockInspector tag="hero" mdAttrs={{ headline: 'Hi', variant: 'center' }} onChange={onChange} apiBase="" />)
    const headline = screen.getByLabelText('headline') as HTMLInputElement
    expect(headline.value).toBe('Hi')
    fireEvent.change(headline, { target: { value: 'Welcome' } })
    expect(onChange).toHaveBeenCalledWith('headline', 'Welcome')
    // textarea for subhead, select for variant present
    expect(screen.getByLabelText('subhead').tagName.toLowerCase()).toBe('textarea')
    expect(screen.getByLabelText('variant')).toBeInTheDocument()
  })

  it('renders an unknown tag as an empty inspector (no crash)', () => {
    render(<BlockInspector tag="does-not-exist" mdAttrs={{}} onChange={() => {}} apiBase="" />)
    expect(screen.getByText(/no editable properties|select a block/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `cd apps/admin && pnpm vitest run test/BlockInspector.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `BlockInspector.tsx`.**

```tsx
import { useState } from 'react'
import { resolveControls } from '@setu/core'
import { registry } from '../blocks/registry'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { MediaPickerModal } from './MediaPickerModal'
import { resolveMediaSrc } from './media-src'

export function BlockInspector({
  tag, mdAttrs, onChange, apiBase,
}: { tag: string; mdAttrs: Record<string, unknown>; onChange: (name: string, value: unknown) => void; apiBase: string }) {
  const block = registry.blocks.find((b) => b.tag === tag)
  const [pickFor, setPickFor] = useState<string | null>(null)
  if (!block) return <p className="px-1 py-2 text-sm text-muted-foreground">No editable properties.</p>

  const controls = resolveControls(block.props, block.editor?.controls)
  const val = (name: string, dflt?: unknown) => mdAttrs[name] ?? dflt ?? ''

  return (
    <div className="flex flex-col gap-3">
      {controls.map((c) => (
        <div key={c.name} className="flex flex-col gap-1.5">
          <Label htmlFor={`bi-${c.name}`} className="capitalize">{c.name}</Label>
          {c.control === 'textarea' ? (
            <Textarea id={`bi-${c.name}`} aria-label={c.name} value={String(val(c.name, c.default))} onChange={(e) => onChange(c.name, e.target.value)} />
          ) : c.control === 'number' ? (
            <Input id={`bi-${c.name}`} aria-label={c.name} type="number" value={String(val(c.name, c.default))} onChange={(e) => onChange(c.name, e.target.value === '' ? '' : Number(e.target.value))} />
          ) : c.control === 'switch' ? (
            <Switch id={`bi-${c.name}`} aria-label={c.name} checked={Boolean(mdAttrs[c.name] ?? c.default ?? false)} onCheckedChange={(v) => onChange(c.name, v)} />
          ) : c.control === 'select' ? (
            <Select value={String(val(c.name, c.default))} onValueChange={(v) => onChange(c.name, v)}>
              <SelectTrigger id={`bi-${c.name}`} aria-label={c.name}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(c.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : c.control === 'media' ? (
            <div className="flex items-center gap-2">
              {mdAttrs[c.name] ? <img src={resolveMediaSrc(String(mdAttrs[c.name]), apiBase || undefined)} alt="" className="size-12 rounded object-cover" /> : null}
              <Button type="button" variant="outline" size="sm" aria-label={c.name} onClick={() => setPickFor(c.name)}>
                {mdAttrs[c.name] ? 'Replace' : 'Choose'}
              </Button>
            </div>
          ) : (
            <Input id={`bi-${c.name}`} aria-label={c.name} type={c.control === 'url' ? 'url' : 'text'} value={String(val(c.name))} onChange={(e) => onChange(c.name, e.target.value)} />
          )}
        </div>
      ))}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
}
```
NOTE: confirm `@/components/ui/textarea` exists (it does — in the primitives list). The `media` control's accessible name is on the Button (`aria-label={c.name}`); the test for hero asserts headline/subhead/variant which are not media, so it stays robust.

- [ ] **Step 4: Run the test — expect PASS.**

Run: `cd apps/admin && pnpm vitest run test/BlockInspector.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/admin/src/editor/BlockInspector.tsx apps/admin/test/BlockInspector.test.tsx
git commit -m "feat(admin): generic BlockInspector (contract-driven controls)"
```

---

### Task 6: Admin — `useSelectedBlock` + contextual Document/Block rail; remove inline form

**Files:**
- Create: `apps/admin/src/editor/useSelectedBlock.ts`
- Modify: `apps/admin/src/editor/Canvas.tsx` (expose the editor instance via `onEditor`)
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (hold the editor; render the contextual rail)
- Modify: `apps/admin/src/editor/MetaPanel.tsx` (optional: wrap Document content so the rail can swap; or do the swap in EditorScreen)
- Modify: `apps/admin/src/editor/extensions/SetuBlock.tsx` (REMOVE the inline `.block-props` form; keep the body/core rendering)
- Test: `apps/admin/test/selected-block-rail.test.tsx`

**Interfaces:**
- Consumes: `BlockInspector` (Task 5); `Editor` from `@tiptap/core`; TipTap `NodeSelection` from `@tiptap/pm/state`.
- Produces: `useSelectedBlock(editor): { tag, mdAttrs, update } | null` where `update(name, value)` writes the node's `mdAttrs`; `Canvas` gains an `onEditor?: (e: Editor | null) => void` prop.

- [ ] **Step 1: Write the failing test** (selecting a heroBlock surfaces it; editing writes mdAttrs).

```tsx
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'

function makeEditor() {
  return new Editor({ extensions: [StarterKit, HeroBlock],
    content: { type: 'doc', content: [{ type: 'heroBlock', attrs: { mdAttrs: { headline: 'Hi', variant: 'center' } } }] } })
}

describe('selectedBlockOf', () => {
  it('returns null when no block is selected', () => {
    const e = makeEditor()
    expect(selectedBlockOf(e.state)).toBeNull()
    e.destroy()
  })
  it('returns the hero tag + mdAttrs when the heroBlock node is selected', () => {
    const e = makeEditor()
    const tr = e.state.tr.setSelection(NodeSelection.create(e.state.doc, 0))
    e.view.dispatch(tr)
    const sel = selectedBlockOf(e.state)
    expect(sel).toMatchObject({ tag: 'hero', mdAttrs: { headline: 'Hi' }, pos: 0 })
    e.destroy()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `cd apps/admin && pnpm vitest run test/selected-block-rail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `useSelectedBlock.ts`** (a pure `selectedBlockOf(state)` + a React hook subscribing to selection updates).

```ts
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

/** Block node types whose props are edited in the inspector rail. (callout/image/contact
 *  keep their own bespoke UI and are intentionally NOT inspector-driven.) */
const INSPECTABLE = new Set(['setuBlock', 'heroBlock'])

export interface SelectedBlock { tag: string; mdAttrs: Record<string, unknown>; pos: number }

function tagOf(name: string, attrs: Record<string, unknown>): string {
  return name === 'setuBlock' ? String(attrs.tag ?? '') : name === 'heroBlock' ? 'hero' : ''
}

/** Pure: the inspectable block at the current selection, or null. Atom blocks surface via
 *  NodeSelection; body-bearing blocks (setuBlock) via the nearest ancestor of the cursor. */
export function selectedBlockOf(state: EditorState): SelectedBlock | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && INSPECTABLE.has(sel.node.type.name)) {
    return { tag: tagOf(sel.node.type.name, sel.node.attrs), mdAttrs: (sel.node.attrs.mdAttrs ?? {}) as Record<string, unknown>, pos: sel.from }
  }
  const { $from } = sel
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d)
    if (INSPECTABLE.has(node.type.name)) {
      return { tag: tagOf(node.type.name, node.attrs), mdAttrs: (node.attrs.mdAttrs ?? {}) as Record<string, unknown>, pos: $from.before(d) }
    }
  }
  return null
}

/** React hook: the selected inspectable block + an `update(name,value)` writer. */
export function useSelectedBlock(editor: Editor | null): (SelectedBlock & { update: (name: string, value: unknown) => void }) | null {
  const [sel, setSel] = useState<SelectedBlock | null>(null)
  useEffect(() => {
    if (!editor) { setSel(null); return }
    const sync = () => setSel(selectedBlockOf(editor.state))
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => { editor.off('selectionUpdate', sync); editor.off('transaction', sync) }
  }, [editor])

  if (!sel || !editor) return null
  const update = (name: string, value: unknown) => {
    const node = editor.state.doc.nodeAt(sel.pos)
    if (!node) return
    const next = { ...(node.attrs.mdAttrs ?? {}) as Record<string, unknown> }
    if (value === '') delete next[name]
    else next[name] = value
    editor.chain().command(({ tr }) => { tr.setNodeAttribute(sel.pos, 'mdAttrs', next); return true }).run()
  }
  return { ...sel, update }
}
```

- [ ] **Step 4: Run the pure-function test — expect PASS.**

Run: `cd apps/admin && pnpm vitest run test/selected-block-rail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Expose the editor from `Canvas.tsx`.** Add an `onEditor?: (e: Editor | null) => void` prop to Canvas; after `const editor = useEditor(...)`, add:
```ts
  useEffect(() => { onEditor?.(editor); return () => onEditor?.(null) }, [editor, onEditor])
```
(import `useEffect`/`Editor` type as needed; do not change existing Canvas behavior).

- [ ] **Step 6: Contextual rail in `EditorScreen.tsx`.** Hold the editor + selection; render Block vs Document:
```tsx
import { useSelectedBlock } from './useSelectedBlock'
import { BlockInspector } from './BlockInspector'
// inside the component:
const [editor, setEditor] = useState<Editor | null>(null)
const selectedBlock = useSelectedBlock(editor)
const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''
// pass onEditor to Canvas:
<Canvas /* ...existing props... */ onEditor={setEditor} />
// replace the bare <MetaPanel .../> with a contextual rail:
<aside className="ed-rail">
  {selectedBlock ? (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Block · {selectedBlock.tag}</div>
      <BlockInspector tag={selectedBlock.tag} mdAttrs={selectedBlock.mdAttrs} onChange={selectedBlock.update} apiBase={apiBase} />
    </div>
  ) : (
    <MetaPanel metadata={metadata} locale={locale} slug={slug} editable={phase === 'ready'} onChange={onMetaChange} />
  )}
</aside>
```
(Reuse `MetaPanel`'s existing rail container styling; if `MetaPanel` supplied the `<aside>`/width itself, keep that — wrap so the Document and Block modes share one rail column. Match the existing rail width/gutter; do not restyle the rail.)

- [ ] **Step 7: Remove the inline form from `SetuBlock.tsx`.** Delete the `form` JSX block (the `.block-props` `<div>` built from `attrs`) and the now-unused `attrs`/`markdocAttributesFor`/`setAttr` derivation; keep the `Core ? real-visual : generic-chrome` rendering and `NodeViewContent`. (Props are edited in the rail now.) Verify no other code imports the removed bits.

- [ ] **Step 8: Run the full editor admin suite — expect GREEN.**

Run: `cd apps/admin && pnpm vitest run test/selected-block-rail.test.tsx test/hero-block-node.test.tsx test/BlockInspector.test.tsx test/image-block-node.test.tsx`
Expected: PASS (existing block round-trips unaffected; `SetuBlock` still renders its block body/core).

- [ ] **Step 9: Commit.**

```bash
git add apps/admin/src/editor/useSelectedBlock.ts apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/EditorScreen.tsx apps/admin/src/editor/MetaPanel.tsx apps/admin/src/editor/extensions/SetuBlock.tsx apps/admin/test/selected-block-rail.test.tsx
git commit -m "feat(admin): contextual block inspector rail + remove inline block-props form"
```

---

### Task 7: Gate + editor-visible UAT

- [ ] **Step 1: Regenerate block codegen if needed.** Hero is a core standard block; if the admin/site read a generated block manifest (`gen-blocks`/`generate-markdoc`), run the repo's block-gen script so `hero` is included. Check `package.json` scripts for `gen-blocks` / `gen:blocks` and run it; if generated files change, commit them:
```bash
git add -A && git commit -m "chore: regenerate block manifest for hero" || echo "no generated changes"
```

- [ ] **Step 2: Full gate.**

Run: `cd /Users/mayank/Documents/projects/setu && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. (If `pnpm build` is per-package, build `@setu/core`, `@setu/blocks`, `@setu/admin`, and `@setu/site`.)

- [ ] **Step 3: Editor-visible UAT (owner, the done bar).** `pnpm dev` from the main checkout. In the editor: `/hero` inserts a hero; the right rail switches to **Block** mode showing headline/subhead/image/CTA/variant controls; editing headline/subhead/variant updates the canvas hero live; the **image** control opens the media `Dialog` picker and sets the hero image; clicking out (deselect) returns the rail to **Document** (permalink/categories/tags). Confirm the site renders the hero token-themed + zero-JS (view source: static `<section class="blk-hero">`, no island script). Light + dark.

## Self-Review

- **Spec coverage:** inspector rail (T6) ✓; contextual Document/Block (T6) ✓; control-hints + resolver (T1) ✓; field controls incl. media→picker (T5) ✓; hero contract Shape-A (T2) ✓; Hero.astro zero-JS site + Hero.tsx canvas core + shared hero.css (T3) ✓; hero atom node + slash (T4) ✓; remove inline `.block-props` form (T6) ✓; Markdoc self-closing round-trip (T2) ✓; gate + UAT (T7) ✓.
- **Placeholder scan:** every code/test step shows real code; the few "confirm the local helper name / icon name" notes point to exact sibling files to match (image-block-node test, Icon module, gen-blocks script) — not vague TODOs.
- **Type consistency:** `BlockControl`/`ResolvedControl`/`resolveControls` identical across T1/T5; node type name `heroBlock` + Markdoc tag `hero` consistent across T2/T4/T6; `selectedBlockOf`/`useSelectedBlock` signatures match T6 test + EditorScreen use; `Hero`/`HeroProps` + `blockCores.hero` consistent across T3/T4; `BlockInspector` prop shape identical in T5 impl + T6 call.
