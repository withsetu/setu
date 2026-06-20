# Block Auto-Discovery + Registration Codegen (Slice A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a content block once as a self-contained folder (`blocks/<tag>/block.ts` + `<tag>.astro`); a discovery scan builds the registry that feeds the editor, the round-trip, and a build-time codegen for the site's `markdoc.config` — retiring the central `setu.config.blocks` array and the hand-mirrored `markdoc.config` entries. Callout migrates as the first folder block with zero behavior change.

**Architecture:** Core gains pure block-registry primitives (`defineBlock`, `buildRegistry`, `markdocAttributesFor`) plus a node-side `generateMarkdocTagsInclude`. The editor discovers `blocks/*/block.ts` via Vite `import.meta.glob`; a `scripts/gen-blocks.mjs` jiti-bootstrap does the same for the site and writes a generated Markdoc tags include. The round-trip's `read-service` accepts the discovered `knownBlockTags` instead of relying on a static default.

**Tech Stack:** TypeScript, Zod, `@markdoc/markdoc`, `@astrojs/markdoc` 1.0.6, Astro 6.4.6, Vite 6, jiti 2.7.0, Vitest, `@tiptap/react` 3.26.1.

## Global Constraints

- **Rule #1 — read source first:** verify any Astro/Tiptap/zod/jiti API against installed source/docs before coding.
- **Rule #2 — Cloudflare + cost-safe:** all new work is **build-time only** (scan + codegen in `predev`/`prebuild`); the published site stays 100% static, zero per-visitor function cost.
- **Callout behavior is frozen:** the callout editor node (`Callout.tsx`), the `@setu/blocks` React core, and the rendered HTML must be **bit-for-bit unchanged**. Only callout's *registration/source* moves.
- **Content-safety:** the round-trip stays byte-stable; unknown tags remain passthrough (never dropped).
- **Versions:** do not bump React 18, the Tiptap 3.26.1 suite, Astro 6.4.6, or `@astrojs/markdoc` 1.0.6.
- **`scope` is reserved:** parse and carry `block.ts`'s optional `scope?: string[]`, but do **not** filter or enforce it in this slice.
- **Branch:** `feat/block-autodiscovery-codegen` (already checked out).
- **Blocks live at the repo root** `blocks/<tag>/`; the `<tag>.astro`'s tag = folder name.

---

### Task 1: Core — `markdocAttributesFor` (zod props → Markdoc attributes)

**Files:**
- Create: `packages/core/src/blocks/markdoc-attributes.ts`
- Test: `packages/core/test/blocks/markdoc-attributes.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces:**
- Produces: `interface MarkdocAttr { type: 'String' | 'Number' | 'Boolean'; default?: unknown; matches?: string[] }` and `markdocAttributesFor(props: ZodTypeAny): Record<string, MarkdocAttr>`. Peels `ZodOptional`/`ZodDefault`; maps `ZodString→String`, `ZodNumber→Number`, `ZodBoolean→Boolean`, `ZodEnum→String`+`matches`; throws on any other zod type or a non-object `props`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/markdoc-attributes.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { markdocAttributesFor } from '../../src/blocks/markdoc-attributes'

describe('markdocAttributesFor', () => {
  it('maps string/number/boolean/enum, peeling optional + default', () => {
    const attrs = markdocAttributesFor(
      z.object({
        s: z.string().optional(),
        n: z.number(),
        b: z.boolean().default(true),
        e: z.enum(['a', 'b']),
      }),
    )
    expect(attrs).toEqual({
      s: { type: 'String' },
      n: { type: 'Number' },
      b: { type: 'Boolean', default: true },
      e: { type: 'String', matches: ['a', 'b'] },
    })
  })
  it('throws on an unsupported zod type', () => {
    expect(() => markdocAttributesFor(z.object({ x: z.array(z.string()) }))).toThrow(/unsupported/)
  })
  it('throws when props is not a z.object', () => {
    expect(() => markdocAttributesFor(z.string())).toThrow(/z\.object/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- markdoc-attributes`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/blocks/markdoc-attributes.ts
import type { ZodTypeAny } from 'zod'

export interface MarkdocAttr {
  type: 'String' | 'Number' | 'Boolean'
  default?: unknown
  matches?: string[]
}

const BASE: Record<string, MarkdocAttr['type']> = {
  ZodString: 'String',
  ZodNumber: 'Number',
  ZodBoolean: 'Boolean',
}

/** Peel ZodOptional/ZodDefault, capturing a default value if one is present. */
function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; default?: unknown } {
  let s = schema as { _def?: { typeName?: string; innerType?: ZodTypeAny; defaultValue?: () => unknown } }
  let def: unknown
  while (s?._def?.typeName === 'ZodOptional' || s?._def?.typeName === 'ZodDefault') {
    if (s._def.typeName === 'ZodDefault' && s._def.defaultValue) def = s._def.defaultValue()
    s = s._def.innerType as typeof s
  }
  return { inner: s as ZodTypeAny, default: def }
}

/** Map a block's zod `props` object to Markdoc attribute descriptors — the same zod
 *  authored for validation, reused as the DRY single source. Throws on an unsupported
 *  type so a registration is never silently lossy. */
export function markdocAttributesFor(props: ZodTypeAny): Record<string, MarkdocAttr> {
  const def = (props as { _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> } })._def
  if (def?.typeName !== 'ZodObject' || !def.shape) {
    throw new Error('markdocAttributesFor: props must be a z.object schema')
  }
  const shape = def.shape()
  const out: Record<string, MarkdocAttr> = {}
  for (const [name, field] of Object.entries(shape)) {
    const { inner, default: dflt } = unwrap(field)
    const tn = (inner as { _def?: { typeName?: string; values?: string[] } })._def?.typeName ?? ''
    let attr: MarkdocAttr
    if (tn === 'ZodEnum') {
      attr = { type: 'String', matches: (inner as { _def: { values: string[] } })._def.values }
    } else if (BASE[tn]) {
      attr = { type: BASE[tn] }
    } else {
      throw new Error(`markdocAttributesFor: attr "${name}" has unsupported zod type "${tn}"`)
    }
    if (dflt !== undefined) attr.default = dflt
    out[name] = attr
  }
  return out
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/index.ts`, append:

```ts
export type { MarkdocAttr } from './blocks/markdoc-attributes'
export { markdocAttributesFor } from './blocks/markdoc-attributes'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- markdoc-attributes`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/blocks/markdoc-attributes.ts packages/core/test/blocks/markdoc-attributes.test.ts packages/core/src/index.ts
git commit -m "feat(core): derive Markdoc attributes from a block's zod props"
```

---

### Task 2: Core — `defineBlock`, registry types, `buildRegistry`

**Files:**
- Create: `packages/core/src/blocks/define-block.ts`
- Create: `packages/core/src/blocks/registry.ts`
- Modify: `packages/core/src/config/types.ts` (add `scope?` to `BlockDefinition`)
- Test: `packages/core/test/blocks/registry.test.ts`
- Modify: `packages/core/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `interface BlockContract { props: ZodTypeAny; editor?: BlockEditorMeta; scope?: string[] }`
  - `defineBlock(contract: BlockContract): BlockContract` (identity helper, mirrors `defineConfig`)
  - `interface BlockEntry { tag: string; component: string; contract: BlockContract }`
  - `interface BlockRegistry { blocks: ResolvedBlock[]; blocksByTag: Map<string, ResolvedBlock>; knownBlockTags: Set<string> }`
  - `buildRegistry(entries: BlockEntry[]): BlockRegistry` — throws on duplicate tag.
- Consumes: `ResolvedBlock`/`BlockEditorMeta` from `config/types.ts`, now with optional `scope`.

- [ ] **Step 1: Add `scope?` to `BlockDefinition`**

In `packages/core/src/config/types.ts`, inside `interface BlockDefinition`, after the `editor?` field:

```ts
  /** Optional editor metadata (slash-menu label/icon/group). */
  editor?: BlockEditorMeta
  /** Content types this block is meant for. Reserved — carried, not enforced (Slice A). */
  scope?: string[]
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/test/blocks/registry.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineBlock } from '../../src/blocks/define-block'
import { buildRegistry } from '../../src/blocks/registry'

describe('defineBlock + buildRegistry', () => {
  it('builds a registry from folder entries, carrying scope', () => {
    const contract = defineBlock({
      props: z.object({ title: z.string().optional() }),
      editor: { label: 'Card', icon: 'card' },
      scope: ['post'],
    })
    const reg = buildRegistry([{ tag: 'card', component: 'blocks/card/card.astro', contract }])
    expect([...reg.knownBlockTags]).toEqual(['card'])
    const card = reg.blocksByTag.get('card')!
    expect(card.tag).toBe('card')
    expect(card.component).toBe('blocks/card/card.astro')
    expect(card.editor).toEqual({ label: 'Card', icon: 'card' })
    expect(card.scope).toEqual(['post'])
  })
  it('throws on a duplicate tag across folders', () => {
    const c = defineBlock({ props: z.object({}) })
    expect(() =>
      buildRegistry([
        { tag: 'card', component: 'a', contract: c },
        { tag: 'card', component: 'b', contract: c },
      ]),
    ).toThrow(/Duplicate block tag/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- blocks/registry`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `define-block.ts` and `registry.ts`**

```ts
// packages/core/src/blocks/define-block.ts
import type { ZodTypeAny } from 'zod'
import type { BlockEditorMeta } from '../config/types'

/** The contract an author exports from `blocks/<tag>/block.ts`. `tag` and the render
 *  `component` are injected by the discovery scan from the folder, not authored here. */
export interface BlockContract {
  /** Zod schema for the block's Markdoc attributes. */
  props: ZodTypeAny
  editor?: BlockEditorMeta
  /** Content types the block is meant for. Reserved — carried, not enforced (Slice A). */
  scope?: string[]
}

/** Identity helper: exists purely for type inference + a stable import (mirrors defineConfig). */
export const defineBlock = (contract: BlockContract): BlockContract => contract
```

```ts
// packages/core/src/blocks/registry.ts
import type { ResolvedBlock } from '../config/types'
import type { BlockContract } from './define-block'

/** A discovered block folder: its tag (folder name), its render component path, and the
 *  authored contract. */
export interface BlockEntry {
  tag: string
  component: string
  contract: BlockContract
}

/** The block registry — the single source the editor, round-trip, and codegen consume,
 *  replacing the hand-maintained `setu.config.blocks` array. */
export interface BlockRegistry {
  blocks: ResolvedBlock[]
  blocksByTag: Map<string, ResolvedBlock>
  knownBlockTags: Set<string>
}

/** Assemble a registry from discovered folder entries. Throws on a duplicate tag
 *  (mirrors resolveConfig's existing guard). */
export function buildRegistry(entries: BlockEntry[]): BlockRegistry {
  const blocksByTag = new Map<string, ResolvedBlock>()
  const blocks: ResolvedBlock[] = []
  for (const { tag, component, contract } of entries) {
    if (blocksByTag.has(tag)) throw new Error(`Duplicate block tag "${tag}" across block folders`)
    const block: ResolvedBlock = {
      tag,
      props: contract.props,
      component,
      ...(contract.editor ? { editor: contract.editor } : {}),
      ...(contract.scope ? { scope: contract.scope } : {}),
    }
    blocksByTag.set(tag, block)
    blocks.push(block)
  }
  return { blocks, blocksByTag, knownBlockTags: new Set(blocksByTag.keys()) }
}
```

- [ ] **Step 5: Add the exports**

In `packages/core/src/index.ts`, append:

```ts
export type { BlockContract } from './blocks/define-block'
export { defineBlock } from './blocks/define-block'
export type { BlockEntry, BlockRegistry } from './blocks/registry'
export { buildRegistry } from './blocks/registry'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- blocks/registry`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/blocks/define-block.ts packages/core/src/blocks/registry.ts packages/core/src/config/types.ts packages/core/test/blocks/registry.test.ts packages/core/src/index.ts
git commit -m "feat(core): defineBlock + buildRegistry block registry primitives"
```

---

### Task 3: Core (node) — `generateMarkdocTagsInclude`

**Files:**
- Create: `packages/core/src/blocks/generate-markdoc.ts`
- Test: `packages/core/test/blocks/generate-markdoc.test.ts`
- Modify: `packages/core/src/node.ts` (export)

**Interfaces:**
- Consumes: `BlockRegistry` (Task 2), `markdocAttributesFor` (Task 1).
- Produces: `generateMarkdocTagsInclude(registry: BlockRegistry): string` — the source text of `apps/site/markdoc.blocks.generated.mjs`. Component paths are rewritten from repo-root-relative (`blocks/x/x.astro`) to apps/site-relative (`../../blocks/x/x.astro`). Attribute `type` is emitted as a bare identifier (`String`), `matches`/`default` as JSON.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/blocks/generate-markdoc.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildRegistry } from '../../src/blocks/registry'
import { defineBlock } from '../../src/blocks/define-block'
import { generateMarkdocTagsInclude } from '../../src/blocks/generate-markdoc'

describe('generateMarkdocTagsInclude', () => {
  it('emits a tags map with component() + derived attributes', () => {
    const reg = buildRegistry([
      {
        tag: 'callout',
        component: 'blocks/callout/callout.astro',
        contract: defineBlock({ props: z.object({ type: z.string().optional(), title: z.string().optional() }) }),
      },
    ])
    const out = generateMarkdocTagsInclude(reg)
    expect(out).toContain("import { component } from '@astrojs/markdoc/config'")
    expect(out).toContain('export const tags = {')
    expect(out).toContain("callout: {")
    expect(out).toContain("render: component('../../blocks/callout/callout.astro'),")
    expect(out).toContain('type: { type: String }')
    expect(out).toContain('title: { type: String }')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- generate-markdoc`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/blocks/generate-markdoc.ts
import type { BlockRegistry } from './registry'
import { markdocAttributesFor } from './markdoc-attributes'
import type { MarkdocAttr } from './markdoc-attributes'

function serializeAttrs(attrs: Record<string, MarkdocAttr>): string {
  const parts = Object.entries(attrs).map(([name, a]) => {
    const bits = [`type: ${a.type}`] // bare identifier (String/Number/Boolean) — not a string literal
    if (a.matches) bits.push(`matches: ${JSON.stringify(a.matches)}`)
    if (a.default !== undefined) bits.push(`default: ${JSON.stringify(a.default)}`)
    return `${name}: { ${bits.join(', ')} }`
  })
  return `{ ${parts.join(', ')} }`
}

/** Emit the source of `apps/site/markdoc.blocks.generated.mjs`. Each block's repo-root
 *  component path is rewritten relative to apps/site (`../../<path>`). Build-time only. */
export function generateMarkdocTagsInclude(registry: BlockRegistry): string {
  const entries = registry.blocks.map((b) => {
    const attrs = serializeAttrs(markdocAttributesFor(b.props))
    return `  ${b.tag}: {\n    render: component('../../${b.component}'),\n    attributes: ${attrs},\n  },`
  })
  return (
    `// AUTO-GENERATED by scripts/gen-blocks.mjs — do not edit.\n` +
    `import { component } from '@astrojs/markdoc/config'\n\n` +
    `export const tags = {\n${entries.join('\n')}\n}\n`
  )
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/node.ts`, append:

```ts
export { generateMarkdocTagsInclude } from './blocks/generate-markdoc'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- generate-markdoc`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/blocks/generate-markdoc.ts packages/core/test/blocks/generate-markdoc.test.ts packages/core/src/node.ts
git commit -m "feat(core): generate the site markdoc tags include from a block registry"
```

---

### Task 4: Core — `read-service` accepts injected `knownBlockTags`

**Files:**
- Modify: `packages/core/src/read/types.ts` (`ReadDeps`)
- Modify: `packages/core/src/read/read-service.ts`
- Test: `packages/core/test/read/known-tags.test.ts`

**Interfaces:**
- Produces: `createReadService` honors an optional `deps.knownBlockTags: Set<string>`, passing it to `markdocToTiptap(body, { knownBlockTags })`. When omitted, behavior is unchanged (falls back to the converter default).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/read/known-tags.test.ts
import { describe, it, expect } from 'vitest'
import { createReadService } from '../../src/read/read-service'
import type { DataPort } from '../../src/data/data-port'
import type { GitPort } from '../../src/git/git-port'

const ref = { collection: 'post', locale: 'en', slug: 'x' }
const mdoc = `---\ntitle: X\n---\n{% callout type="info" %}\nHi.\n{% /callout %}\n`

// Minimal stub ports: no draft, one published file, head sha, echo saveDraft.
function ports(): { data: DataPort; git: GitPort } {
  const data = {
    getDraft: async () => null,
    saveDraft: async (d: unknown) => ({ ...(d as object), id: '1' }),
  } as unknown as DataPort
  const git = {
    readFile: async () => mdoc,
    headSha: async () => 'sha',
  } as unknown as GitPort
  return { data, git }
}

describe('read-service knownBlockTags injection', () => {
  it('treats callout as a block node when its tag is injected', async () => {
    const { data, git } = ports()
    const svc = createReadService({ data, git, knownBlockTags: new Set(['callout']) })
    const res = await svc.loadForEdit(ref)
    const content = (res as { draft: { content: { content: Array<{ type: string }> } } }).draft.content
    expect(content.content.some((n) => n.type === 'callout')).toBe(true)
  })
  it('falls back to passthrough when no tags are injected (default empty after Task 7)', async () => {
    const { data, git } = ports()
    const svc = createReadService({ data, git, knownBlockTags: new Set() })
    const res = await svc.loadForEdit(ref)
    const content = (res as { draft: { content: { content: Array<{ type: string }> } } }).draft.content
    expect(content.content.some((n) => n.type === 'passthrough')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- known-tags`
Expected: FAIL — `knownBlockTags` not accepted / not threaded (callout not found as a node, or type error).

- [ ] **Step 3: Add `knownBlockTags` to `ReadDeps`**

In `packages/core/src/read/types.ts`, extend `ReadDeps`:

```ts
export interface ReadDeps {
  data: DataPort
  git: GitPort
  /** Block tags the round-trip should treat as first-class nodes (from the block
   *  registry). Omitted → the converter's default. */
  knownBlockTags?: Set<string>
}
```

- [ ] **Step 4: Thread it through `read-service.ts`**

In `packages/core/src/read/read-service.ts`, change the destructure and the convert call:

```ts
  const { data, git, knownBlockTags } = deps
```

and:

```ts
      const { frontmatter, body } = parseMdoc(published)
      const content = markdocToTiptap(body, knownBlockTags ? { knownBlockTags } : {})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- known-tags`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/read/types.ts packages/core/src/read/read-service.ts packages/core/test/read/known-tags.test.ts
git commit -m "feat(core): read-service accepts injected knownBlockTags for the round-trip"
```

---

### Task 5: The `callout` folder + editor discovery

**Files:**
- Create: `blocks/callout/block.ts`
- Create: `blocks/callout/callout.astro` (content copied from `apps/site/src/components/CalloutWrapper.astro`)
- Create: `apps/admin/src/blocks/registry.ts`
- Modify: `apps/admin/src/editor/blocks.ts` (slash sources from the registry)
- Modify: `apps/admin/src/data/store.tsx` (inject `knownBlockTags` into the read-service)
- Modify: `apps/admin/vite.config.ts` (allow globbing the repo-root `blocks/`)
- Test: `apps/admin/test/registry.test.ts`

**Interfaces:**
- Consumes: `defineBlock`/`buildRegistry`/`BlockRegistry` (Task 2), `createReadService` w/ `knownBlockTags` (Task 4).
- Produces: `registry: BlockRegistry` (the admin's discovered blocks); `slashBlocks()` now returns built-ins + the registry's blocks; the read-service is constructed with `registry.knownBlockTags`.

> Leaves `apps/site/src/components/CalloutWrapper.astro` in place (still wired into `markdoc.config.mjs` until Task 6) — so the site keeps building. This task only flips the **editor** to the folder.

- [ ] **Step 1: Create the callout folder — contract + component**

```ts
// blocks/callout/block.ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  // Permissive props — value validation is a later increment; the editor offers the
  // variants, the renderer/theme interprets them.
  props: z.object({
    type: z.string().optional(),
    title: z.string().optional(),
    icon: z.string().optional(),
  }),
  editor: {
    label: 'Callout',
    icon: 'info',
    group: 'Blocks',
    variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
  },
})
```

Copy the current render component verbatim (same imports, same markup) to `blocks/callout/callout.astro`:

```astro
---
import { createElement } from 'react'
import { Callout, variantFor } from '@setu/blocks'
import '@setu/blocks/callout.css'

const { type = 'info', title } = Astro.props
const variant = variantFor(String(type))
const titleNode = title ? createElement('span', { className: 'callout-title' }, title) : undefined
---

<Callout tone={variant.tone} icon={variant.icon} title={titleNode}>
  <div class="callout-body"><slot /></div>
</Callout>
```

- [ ] **Step 2: Write the failing test (admin registry + slash)**

```ts
// apps/admin/test/registry.test.ts
import { describe, it, expect } from 'vitest'
import { registry } from '../src/blocks/registry'
import { slashBlocks } from '../src/editor/blocks'

describe('block registry (folder discovery)', () => {
  it('discovers the callout folder block', () => {
    expect(registry.knownBlockTags.has('callout')).toBe(true)
    expect(registry.blocksByTag.get('callout')?.editor?.label).toBe('Callout')
  })
  it('offers folder blocks in the slash menu', () => {
    expect(slashBlocks().some((b) => /callout/i.test(b.title))).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- registry`
Expected: FAIL — `../src/blocks/registry` not found.

- [ ] **Step 4: Create the admin registry (Vite glob)**

```ts
// apps/admin/src/blocks/registry.ts
// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (each block.ts default-exports a BlockContract) into the bundle; we pair it with the
// folder name to build the registry. Path is relative to THIS file: blocks -> src ->
// admin -> apps -> repo root. blocks/ is outside the admin root, so the dev server must
// allow it (see vite.config.ts server.fs.allow).
import { buildRegistry } from '@setu/core'
import type { BlockContract, BlockRegistry } from '@setu/core'

const mods = import.meta.glob('../../../../blocks/*/block.ts', { eager: true, import: 'default' }) as Record<
  string,
  BlockContract
>

const folderOf = (p: string): string => p.split('/').slice(-2, -1)[0]!

export const registry: BlockRegistry = buildRegistry(
  Object.entries(mods).map(([path, contract]) => {
    const tag = folderOf(path)
    return { tag, component: `blocks/${tag}/${tag}.astro`, contract }
  }),
)
```

- [ ] **Step 5: Point `slashBlocks` at the registry**

In `apps/admin/src/editor/blocks.ts`, replace the `@setu/core` import and the `slashBlocks` body. Remove `import { defaultConfig, resolveConfig } from '@setu/core'` and add:

```ts
import { registry } from '../blocks/registry'
```

Replace `slashBlocks`:

```ts
/** Insertable blocks = built-ins + every auto-discovered folder block. Each folder block
 *  inserts a node of its tag (today only `callout` has an editor node). */
export function slashBlocks(): SlashBlock[] {
  const fromBlocks: SlashBlock[] = registry.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    run: (e: Editor, r: Range) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: b.tag, attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
        .run(),
  }))
  return [...BUILTINS, ...fromBlocks]
}
```

- [ ] **Step 6: Inject `knownBlockTags` into the read-service**

In `apps/admin/src/data/store.tsx`, add the import:

```ts
import { registry } from '../blocks/registry'
```

and in `servicesFor`, change the read-service construction:

```ts
    read: createReadService({ data, git, knownBlockTags: registry.knownBlockTags }),
```

- [ ] **Step 7: Allow globbing the repo root in Vite**

In `apps/admin/vite.config.ts`, add a `server` block:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['../..'] } },
  test: {
```

(Leave the rest unchanged.)

- [ ] **Step 8: Run the registry test + full admin suite**

Run: `pnpm --filter @setu/admin test`
Expected: PASS — the new registry test plus all existing callout/slash/editor tests (proves the editor still behaves identically, now folder-sourced).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add blocks/callout apps/admin/src/blocks/registry.ts apps/admin/src/editor/blocks.ts apps/admin/src/data/store.tsx apps/admin/vite.config.ts apps/admin/test/registry.test.ts
git commit -m "feat(admin): discover the callout folder block and source the editor from it"
```

---

### Task 6: Site — codegen `markdoc.config` from the block folders

**Files:**
- Create: `scripts/gen-blocks.mjs`
- Modify: root `package.json` (add `jiti` devDep)
- Modify: `apps/site/package.json` (`predev`/`prebuild` hooks)
- Modify: `apps/site/markdoc.config.mjs` (import generated tags; drop the hand callout entry)
- Modify: `apps/site/src/preview/preview.astro` (import callout from the folder)
- Delete: `apps/site/src/components/CalloutWrapper.astro`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `buildRegistry` (`@setu/core`), `generateMarkdocTagsInclude` (`@setu/core/node`) via jiti; the `blocks/callout/` folder (Task 5).
- Produces: `apps/site/markdoc.blocks.generated.mjs` (gitignored) consumed by `markdoc.config.mjs`.

- [ ] **Step 1: Add `jiti` to the repo-root devDependencies**

Run:

```bash
pnpm add -w -D jiti
```

Expected: root `package.json` gains `"jiti"` under `devDependencies`.

- [ ] **Step 2: Write the codegen script**

```js
// scripts/gen-blocks.mjs
// Build-time codegen: scan repo-root blocks/, build the registry, and write the site's
// Markdoc tags include. Run as apps/site's predev/prebuild. Pure build-time => zero
// per-visitor cost. Uses jiti (like @setu/core) to import the TS block contracts + core.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BLOCKS_DIR = path.join(ROOT, 'blocks')
const OUT = path.join(ROOT, 'apps', 'site', 'markdoc.blocks.generated.mjs')

const jiti = createJiti(import.meta.url)

async function loadEntries() {
  if (!existsSync(BLOCKS_DIR)) return []
  const entries = []
  for (const tag of readdirSync(BLOCKS_DIR)) {
    const folder = path.join(BLOCKS_DIR, tag)
    if (!statSync(folder).isDirectory()) continue
    const blockTs = path.join(folder, 'block.ts')
    if (!existsSync(blockTs)) continue
    const astro = path.join(folder, `${tag}.astro`)
    if (!existsSync(astro)) throw new Error(`block "${tag}": missing ${tag}.astro`)
    const contract = await jiti.import(blockTs, { default: true })
    entries.push({ tag, component: `blocks/${tag}/${tag}.astro`, contract })
  }
  return entries
}

export async function main() {
  const { buildRegistry } = await jiti.import('@setu/core')
  const { generateMarkdocTagsInclude } = await jiti.import('@setu/core/node')
  const registry = buildRegistry(await loadEntries())
  writeFileSync(OUT, generateMarkdocTagsInclude(registry))
  console.log(`gen-blocks: ${registry.blocks.length} block(s): ${registry.blocks.map((b) => b.tag).join(', ') || '(none)'}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
```

- [ ] **Step 3: Smoke-run the generator**

Run: `node scripts/gen-blocks.mjs`
Expected: prints `gen-blocks: 1 block(s): callout`; writes `apps/site/markdoc.blocks.generated.mjs` containing `callout: {` and `render: component('../../blocks/callout/callout.astro')`.

- [ ] **Step 4: Add the build/dev prestep hooks**

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

- [ ] **Step 5: Wire the generated tags into the Markdoc config**

In `apps/site/markdoc.config.mjs`, add the import after the existing `@astrojs/markdoc/config` import:

```js
import { tags as generatedTags } from './markdoc.blocks.generated.mjs'
```

and replace the `tags` object so generated blocks join the inline tags and the hand callout entry is **removed** (callout now comes from `generatedTags`):

```js
  tags: {
    ...generatedTags,
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
  },
```

- [ ] **Step 6: Update the dev preview to import callout from the folder**

In `apps/site/src/preview/preview.astro`, change the callout import (line ~15) from `../components/CalloutWrapper.astro` to the folder component:

```ts
import CalloutWrapper from '../../../../blocks/callout/callout.astro'
```

(The `tagComponentMap = { callout: CalloutWrapper, sub: Sub, sup: Sup }` line is unchanged — it still maps `callout` to the imported component.)

- [ ] **Step 7: Delete the now-unused wrapper + gitignore the generated file**

Run:

```bash
git rm apps/site/src/components/CalloutWrapper.astro
```

Append to `.gitignore`:

```
# Generated by scripts/gen-blocks.mjs (build-time, derived from blocks/)
apps/site/markdoc.blocks.generated.mjs
```

- [ ] **Step 8: Build the site and run its tests (cross-root import + render verification)**

Run: `pnpm --filter @setu/site test`
Expected: PASS — `pnpm build` runs `prebuild` → `gen-blocks` → the generated include exists; the **30 render tests stay green** (callout renders identically via the generated registration). 

> If the build fails resolving `../../blocks/callout/callout.astro` from `markdoc.config` (component path escaping the project root), fall back: add `vite: { server: { fs: { allow: ['../..'] } } }` to `apps/site/astro.config.mjs` and re-run. If it still fails, the minimal fix is to keep blocks under `apps/site/blocks/` and regenerate paths — but verify the repo-root layout first.

- [ ] **Step 9: Commit**

```bash
git add scripts/gen-blocks.mjs package.json pnpm-lock.yaml apps/site/package.json apps/site/markdoc.config.mjs apps/site/src/preview/preview.astro .gitignore
git rm apps/site/src/components/CalloutWrapper.astro
git commit -m "feat(site): codegen markdoc tags from block folders; callout is folder-sourced"
```

---

### Task 7: Core — retire the central `setu.config.blocks` array

**Files:**
- Modify: `packages/core/src/config/default-config.ts` (empty blocks)
- Modify: `packages/core/src/config/schema.ts` (blocks optional)
- Modify: `packages/core/src/config/types.ts` (`SetuConfig.blocks` optional)
- Modify: `apps/site/setu.config.ts` (drop the blocks line)
- Modify: `packages/core/test/config/default-config.test.ts` (rewrite for empty default)

**Interfaces:**
- Produces: `defaultConfig.blocks === []`; `defaultKnownBlockTags` is empty; `configSchema` accepts a config with no `blocks` (defaults to `[]`). The folder registry is now the sole block source.

- [ ] **Step 1: Update the failing test to the new contract**

Replace `packages/core/test/config/default-config.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { defaultConfig, defaultKnownBlockTags, resolveConfig } from '../../src/index'

describe('defaultConfig', () => {
  it('ships no blocks — blocks come from auto-discovered folders, not the central config', () => {
    expect(defaultConfig.blocks ?? []).toEqual([])
    expect([...defaultKnownBlockTags]).toEqual([])
  })
  it('resolves a config with no blocks (blocks is optional)', () => {
    const resolved = resolveConfig({ theme: '@setu/theme-default' })
    expect(resolved.blocks).toEqual([])
    expect(resolved.theme).toBe('@setu/theme-default')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/core test -- config/default-config`
Expected: FAIL — `defaultConfig.blocks` still has callout; `resolveConfig({ theme })` throws (blocks required).

- [ ] **Step 3: Empty the default config**

Replace `packages/core/src/config/default-config.ts` with:

```ts
import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Setu ships with when the developer provides none. Blocks are no longer
 *  listed here — they are auto-discovered from `blocks/<tag>/` folders (sub-project #4).
 *  This keeps only site-wide choices (theme, theme-options). */
export const defaultConfig = defineConfig({})

/** Known-block tag set from the default config — now empty (blocks come from the folder
 *  registry, injected at the call site). Kept as the converter's inert fallback. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags
```

- [ ] **Step 4: Make `blocks` optional in the schema**

In `packages/core/src/config/schema.ts`, change the `configSchema` blocks field:

```ts
export const configSchema = z.object({
  blocks: z.array(blockSchema).optional().default([]),
  theme: z.string().optional(),
  themeOptions: z.record(z.string(), z.string()).optional(),
})
```

- [ ] **Step 5: Make `SetuConfig.blocks` optional in types**

In `packages/core/src/config/types.ts`, change `SetuConfig`:

```ts
export interface SetuConfig {
  /** Authored blocks. Optional — blocks are normally auto-discovered from folders. */
  blocks?: BlockDefinition[]
  /** The active theme's package name (e.g. '@setu/theme-default'). Optional. */
  theme?: string
  /** Chosen values for the active theme's declared options (key → value). Optional. */
  themeOptions?: Record<string, string>
}
```

- [ ] **Step 6: Drop the blocks line from the site config**

Replace `apps/site/setu.config.ts` with:

```ts
import { defineConfig } from '@setu/core'

export default defineConfig({
  theme: '@setu/theme-default',
})
```

- [ ] **Step 7: Run the full core suite + site config load**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — `default-config` rewritten test passes; `resolve.test.ts`/`theme-field`/`theme-options-field` (which pass explicit `{ blocks: [] }` or now-optional configs) stay green.

- [ ] **Step 8: Verify the site still loads its config (theme read path)**

Run: `pnpm --filter @setu/site test`
Expected: PASS — `astro.config.mjs`'s `loadConfig(setu.config.ts)` resolves (theme intact) with no `blocks`; render tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/config/default-config.ts packages/core/src/config/schema.ts packages/core/src/config/types.ts apps/site/setu.config.ts packages/core/test/config/default-config.test.ts
git commit -m "refactor(core): retire the central setu.config.blocks array (folders are the source)"
```

---

### Task 8: Full-repo green + manual walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run every suite + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green — core (incl. new blocks/* + read known-tags), admin (incl. registry; callout/slash unchanged), site (render 30 green), blocks (callout-variants fall back to VARIANT_MAP keys), theme-default, api, db/git adapters.

- [ ] **Step 2: Manual walkthrough (the proof)**

Run: `pnpm dev`
Verify by hand:
1. The editor's `/` menu shows **Callout**; insert one — it behaves exactly as before (tone/title/icon toolbar, inline title).
2. Open an entry containing `{% callout %}` → it round-trips into a callout node (not passthrough), proving the injected `knownBlockTags`.
3. The site renders callout identically (the warning callout on `post/kitchen-sink`).
4. Edit `blocks/callout/block.ts` (e.g. add an attr) → after restart, the change flows to the editor + the generated `markdoc.config` with **no** edit to `setu.config.ts` or `markdoc.config.mjs`.

Expected: all four hold. `blocks/callout/` is the sole definition of the block.

- [ ] **Step 3: Final commit (only if walkthrough fixes were needed)**

```bash
git add -A && git commit -m "chore: block auto-discovery + codegen (Slice A) — full green"
```

---

## Self-Review

**Spec coverage:**
- Folder convention `block.ts` + `<tag>.astro` → Tasks 5 (callout folder). ✓
- `defineBlock` + registry + `buildRegistry` → Task 2. ✓
- `markdocAttributesFor` (zod → attrs, the DRY payoff) → Task 1. ✓
- `generateMarkdocTagsInclude` (node codegen) → Task 3. ✓
- Two-context discovery: editor Vite glob (Task 5) + codegen jiti scan (Task 6). ✓
- Round-trip `knownBlockTags` injection (read-service) → Task 4 + wired in Task 5. ✓
- Codegen wiring: `gen-blocks.mjs` + jiti dep + prebuild + markdoc import + gitignore → Task 6. ✓
- Callout migration with zero behavior change (move component, drop hand entry, update preview) → Tasks 5–6. ✓
- Retire `defaultConfig.blocks`; `configSchema.blocks` optional → Task 7. ✓
- Reserved-but-inert `scope` (carried, not enforced) → Task 2 (`BlockContract.scope`, `BlockDefinition.scope`, carried in `buildRegistry`). ✓
- 30 render tests stay green; callout bit-for-bit → Tasks 6, 8. ✓
- Build-time only / CF + cost-safe → Task 6 framing + Global Constraints. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one runtime risk (cross-root `component()` path) has an explicit verification step + concrete fallback in Task 6 Step 8 — not a placeholder. ✓

**Type consistency:** `BlockContract { props, editor?, scope? }`, `BlockEntry { tag, component, contract }`, and `BlockRegistry { blocks, blocksByTag, knownBlockTags }` are used identically across Tasks 2/3/5/6; `markdocAttributesFor`'s `MarkdocAttr` shape matches its consumer in Task 3; `ReadDeps.knownBlockTags` (Task 4) matches the `registry.knownBlockTags` passed in Task 5; the editor still inserts `type: b.tag` (callout's existing node), consistent with the frozen-callout constraint. ✓
