# @saytu/core Markdoc⇄Tiptap Round-trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Saytu monorepo and port the proven Markdoc⇄Tiptap round-trip spike into `@saytu/core` as typed, test-covered TypeScript.

**Architecture:** A pnpm-workspace monorepo on Node. `@saytu/core` exposes two pure functions — `markdocToTiptap` and `tiptapToMarkdoc` — with the spike's exact behavior: native blocks convert structurally; unknown/advanced/malformed content is preserved byte-for-byte by slicing the original source (never `Markdoc.format()`, which drops unparseable nodes). Round-trip is idempotent.

**Tech Stack:** TypeScript (strict), Node + pnpm workspaces, Vitest, `@markdoc/markdoc`, `fast-check`.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-core-roundtrip-design.md`
**Source to port:** `prototype/markdoc-roundtrip/roundtrip.mjs` (passing 6/6 idempotent).

---

## File structure

```
package.json              # root: workspaces, scripts (modify provisional)
pnpm-workspace.yaml       # packages/*, apps/* (already provisional)
tsconfig.base.json        # shared strict TS config (already provisional)
packages/core/
├── package.json          # @saytu/core (already provisional)
├── tsconfig.json         # CREATE: extends base, typecheck src+test
├── vitest.config.ts      # CREATE
├── src/
│   ├── index.ts          # CREATE: public exports
│   └── markdoc/
│       ├── types.ts      # CREATE: TiptapDoc/Node/Mark, RoundtripOptions, MdNode
│       ├── to-tiptap.ts  # CREATE: markdocToTiptap()
│       └── to-markdoc.ts # CREATE: tiptapToMarkdoc()
└── test/
    ├── roundtrip.examples.test.ts   # CREATE
    └── roundtrip.property.test.ts   # CREATE
```

---

## Task 1: Monorepo scaffold + toolchain smoke test

**Files:**
- Modify: `package.json` (root)
- Verify: `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/core/package.json`
- Create: `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`

- [ ] **Step 1: Set the root `package.json` to the final content**

```json
{
  "name": "saytu",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "Open-source, Git-backed, multi-topology CMS engine.",
  "license": "AGPL-3.0-only",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  },
  "packageManager": "pnpm@10.33.0"
}
```

- [ ] **Step 2: Confirm `pnpm-workspace.yaml` matches**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: Confirm `tsconfig.base.json` matches**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Confirm `packages/core/package.json` matches**

```json
{
  "name": "@saytu/core",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@markdoc/markdoc": "^0.5.7" },
  "devDependencies": {
    "fast-check": "^3.23.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 5: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": [] },
  "include": ["src", "test"]
}
```

- [ ] **Step 6: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 7: Create `packages/core/src/index.ts` (empty placeholder for now)**

```ts
export {}
```

- [ ] **Step 8: Create the smoke test `packages/core/test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: completes without error; creates `node_modules` and `pnpm-lock.yaml`.

- [ ] **Step 10: Run the test suite**

Run: `pnpm test`
Expected: PASS — 1 test passed (`toolchain > runs vitest`).

- [ ] **Step 11: Run typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors).

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/ pnpm-lock.yaml
git commit -m "chore: scaffold Saytu monorepo (Node + pnpm + Vitest) with @saytu/core"
```

---

## Task 2: Tiptap + Markdoc types

**Files:**
- Create: `packages/core/src/markdoc/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/markdoc/types.ts`**

```ts
/** A Tiptap (ProseMirror) inline mark. */
export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A Tiptap (ProseMirror) node. */
export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

/** A Tiptap document root. */
export interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

/** Options for Markdoc → Tiptap conversion. */
export interface RoundtripOptions {
  /** Markdoc tags that have a first-class editor block (default: {'callout'}). */
  knownBlockTags?: Set<string>
}

/**
 * Minimal structural view of a Markdoc AST node — enough for the round-trip
 * without depending on Markdoc's exported type surface.
 */
export interface MdNode {
  type: string
  tag?: string
  attributes: Record<string, any>
  children?: MdNode[]
  errors?: unknown[]
  location?: { start?: { line?: number } }
}
```

- [ ] **Step 2: Re-export types from `packages/core/src/index.ts`**

```ts
export type {
  TiptapMark,
  TiptapNode,
  TiptapDoc,
  RoundtripOptions,
} from './markdoc/types'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add Tiptap/Markdoc round-trip types"
```

---

## Task 3: `markdocToTiptap`

**Files:**
- Create: `packages/core/src/markdoc/to-tiptap.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/to-tiptap.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/to-tiptap.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../src/index'

describe('markdocToTiptap', () => {
  it('converts a heading', () => {
    const doc = markdocToTiptap('# Hello\n')
    expect(doc).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] },
      ],
    })
  })

  it('converts bold + italic + code marks', () => {
    const doc = markdocToTiptap('A **b** *i* `c`\n')
    const para = doc.content[0]!
    expect(para.type).toBe('paragraph')
    expect(para.content).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'code' }] },
    ])
  })

  it('maps a known block tag (callout) to a callout node', () => {
    const doc = markdocToTiptap('{% callout type="warning" %}\nHi\n{% /callout %}\n')
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('preserves an unknown/advanced tag ({% if %}) as a passthrough node', () => {
    const doc = markdocToTiptap('{% if $x %}\nHi\n{% /if %}\n')
    const node = doc.content[0]!
    expect(node.type).toBe('passthrough')
    expect((node.attrs as any).raw).toContain('{% if $x %}')
    expect((node.attrs as any).raw).toContain('{% /if %}')
  })

  it('preserves malformed Markdoc as a flagged passthrough (never dropped)', () => {
    const src = 'Intro.\n\n{% for $p in $ps %}\n- {% $p.name %}\n{% /for %}\n\nOutro.\n'
    const doc = markdocToTiptap(src)
    const flagged = doc.content.find((n) => n.type === 'passthrough')!
    expect(flagged).toBeDefined()
    expect((flagged.attrs as any).flagged).toBe(true)
    expect((flagged.attrs as any).raw).toContain('{% for $p in $ps %}')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @saytu/core test to-tiptap`
Expected: FAIL — `markdocToTiptap` is not exported.

- [ ] **Step 3: Implement `packages/core/src/markdoc/to-tiptap.ts`**

```ts
import Markdoc from '@markdoc/markdoc'
import type { MdNode, RoundtripOptions, TiptapDoc, TiptapMark, TiptapNode } from './types'

const DEFAULT_KNOWN_BLOCK_TAGS = new Set(['callout'])

const hasError = (node: MdNode): boolean =>
  node.type === 'error' || (Array.isArray(node.errors) && node.errors.length > 0)

function inlineToTiptap(node: MdNode, marks: TiptapMark[] = []): TiptapNode[] {
  const kids = node.children ?? []
  switch (node.type) {
    case 'inline':
      return kids.flatMap((c) => inlineToTiptap(c, marks))
    case 'text':
      return [{ type: 'text', text: String(node.attributes.content), ...(marks.length ? { marks } : {}) }]
    case 'strong':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'bold' }]))
    case 'em':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'italic' }]))
    case 's':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'strike' }]))
    case 'code':
      return [{ type: 'text', text: String(node.attributes.content), marks: [...marks, { type: 'code' }] }]
    case 'link':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'link', attrs: { href: node.attributes.href } }]))
    case 'hardbreak':
      return [{ type: 'hardBreak' }]
    case 'softbreak':
      return [{ type: 'text', text: ' ' }]
    default:
      return []
  }
}

const collectInline = (node: MdNode): TiptapNode[] =>
  (node.children ?? []).flatMap((c) => inlineToTiptap(c))

function blockToTiptap(node: MdNode): TiptapNode | null {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: node.attributes.level }, content: collectInline(node) }
    case 'paragraph':
      return { type: 'paragraph', content: collectInline(node) }
    case 'list':
      return {
        type: node.attributes.ordered ? 'orderedList' : 'bulletList',
        content: (node.children ?? []).map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: collectInline(item) }],
        })),
      }
    case 'blockquote':
      return {
        type: 'blockquote',
        content: (node.children ?? []).map(blockToTiptap).filter((n): n is TiptapNode => n !== null),
      }
    case 'fence':
      return {
        type: 'codeBlock',
        attrs: { language: node.attributes.language || null },
        content: [{ type: 'text', text: String(node.attributes.content).replace(/\n$/, '') }],
      }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'tag':
      return {
        type: 'callout',
        attrs: { mdAttrs: node.attributes },
        content: (node.children ?? []).map(blockToTiptap).filter((n): n is TiptapNode => n !== null),
      }
    default:
      return null
  }
}

export function markdocToTiptap(source: string, opts: RoundtripOptions = {}): TiptapDoc {
  const known = opts.knownBlockTags ?? DEFAULT_KNOWN_BLOCK_TAGS
  const isPreserve = (node: MdNode): boolean =>
    hasError(node) || (node.type === 'tag' && !known.has(node.tag ?? ''))

  const lines = source.split('\n')
  // `location` is supported at runtime (spike-proven) but not in Markdoc's published parse types.
  const ast = (Markdoc.parse as (s: string, a?: unknown) => MdNode)(source, { location: true })
  const kids = ast.children ?? []
  const out: TiptapNode[] = []

  const startOf = (i: number): number => kids[i]?.location?.start?.line ?? lines.length
  const slice = (from: number, to: number): string => lines.slice(from, to).join('\n').replace(/\n+$/, '')

  for (let i = 0; i < kids.length; ) {
    const node = kids[i]!
    if (isPreserve(node)) {
      const startLine = startOf(i)
      let j = i
      if (hasError(node)) {
        while (j + 1 < kids.length) {
          j++
          if (hasError(kids[j]!)) break
        }
      }
      const endLine = startOf(j + 1)
      out.push({ type: 'passthrough', attrs: { raw: slice(startLine, endLine), flagged: hasError(node) } })
      i = j + 1
      continue
    }
    const tt = blockToTiptap(node)
    if (tt) out.push(tt)
    i++
  }
  return { type: 'doc', content: out }
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

Add this line:

```ts
export { markdocToTiptap } from './markdoc/to-tiptap'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @saytu/core test to-tiptap`
Expected: PASS — 5 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test/to-tiptap.test.ts
git commit -m "feat(core): markdocToTiptap with source-slice passthrough preservation"
```

---

## Task 4: `tiptapToMarkdoc`

**Files:**
- Create: `packages/core/src/markdoc/to-markdoc.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/to-markdoc.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/to-markdoc.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc } from '../src/index'

describe('tiptapToMarkdoc', () => {
  it('serializes a heading', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(tiptapToMarkdoc(doc)).toBe('## Hello\n')
  })

  it('serializes bold and italic marks', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    }
    expect(tiptapToMarkdoc(doc)).toBe('**b** *i*\n')
  })

  it('emits passthrough raw verbatim', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'passthrough', attrs: { raw: '{% if $x %}\nHi\n{% /if %}', flagged: false } }],
    }
    expect(tiptapToMarkdoc(doc)).toBe('{% if $x %}\nHi\n{% /if %}\n')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @saytu/core test to-markdoc`
Expected: FAIL — `tiptapToMarkdoc` is not exported.

- [ ] **Step 3: Implement `packages/core/src/markdoc/to-markdoc.ts`**

```ts
import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapNode } from './types'

const N = Markdoc.Ast.Node

function buildInline(content: TiptapNode[] = []): InstanceType<typeof N>[] {
  return content.map((t) => {
    if (t.type === 'hardBreak') return new N('hardbreak')
    let n: InstanceType<typeof N> = new N('text', { content: t.text })
    for (const m of t.marks ?? []) {
      if (m.type === 'code') n = new N('code', { content: t.text })
      else if (m.type === 'bold') n = new N('strong', { marker: '**' }, [n])
      else if (m.type === 'italic') n = new N('em', { marker: '*' }, [n])
      else if (m.type === 'strike') n = new N('s', {}, [n])
      else if (m.type === 'link') n = new N('link', { href: (m.attrs as any)?.href }, [n])
    }
    return n
  })
}

function buildBlock(node: TiptapNode): InstanceType<typeof N> {
  const attrs = (node.attrs ?? {}) as any
  switch (node.type) {
    case 'heading':
      return new N('heading', { level: attrs.level }, [new N('inline', {}, buildInline(node.content))])
    case 'paragraph':
      return new N('paragraph', {}, [new N('inline', {}, buildInline(node.content))])
    case 'bulletList':
    case 'orderedList':
      return new N(
        'list',
        { ordered: node.type === 'orderedList', marker: node.type === 'orderedList' ? '1.' : '-' },
        (node.content ?? []).map(
          (item) => new N('item', {}, [new N('inline', {}, buildInline(item.content?.[0]?.content ?? []))]),
        ),
      )
    case 'blockquote':
      return new N('blockquote', {}, (node.content ?? []).map(buildBlock))
    case 'codeBlock':
      return new N('fence', { content: (node.content?.[0]?.text ?? '') + '\n', language: attrs.language || '' })
    case 'horizontalRule':
      return new N('hr')
    case 'callout':
      return new N('tag', attrs.mdAttrs ?? {}, (node.content ?? []).map(buildBlock), 'callout')
    default:
      return new N('paragraph', {}, [])
  }
}

const formatNative = (node: TiptapNode): string =>
  Markdoc.format(new N('document', {}, [buildBlock(node)])).replace(/\n+$/, '')

export function tiptapToMarkdoc(doc: TiptapDoc): string {
  const blocks = doc.content.map((node) =>
    node.type === 'passthrough' ? String((node.attrs as any)?.raw ?? '') : formatNative(node),
  )
  return blocks.join('\n\n') + '\n'
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

Add this line:

```ts
export { tiptapToMarkdoc } from './markdoc/to-markdoc'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @saytu/core test to-markdoc`
Expected: PASS — 3 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test/to-markdoc.test.ts
git commit -m "feat(core): tiptapToMarkdoc (AST+format for native, verbatim passthrough)"
```

---

## Task 5: Round-trip idempotency (example-based)

**Files:**
- Test: `packages/core/test/roundtrip.examples.test.ts`

- [ ] **Step 1: Write the test `packages/core/test/roundtrip.examples.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const SAMPLES: Record<string, string> = {
  basic: `# Summer Launch

Our **biggest** release *yet*, with \`code\` and a [link](https://saytu.dev).

- one
- two

> A blockquote.
`,
  callout: `# Notes

{% callout type="warning" %}
Pre-orders open Friday.
{% /callout %}
`,
  ifBlock: `# Promo

{% if $flags.blackFriday %}
50% off.
{% /if %}

After.
`,
  malformed: `Intro.

{% for $p in $ps %}
- {% $p.name %}
{% /for %}

Outro.
`,
  partial: `Intro.

{% partial file="promo.md" /%}

Outro.
`,
}

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

describe('round-trip idempotency', () => {
  for (const [name, s0] of Object.entries(SAMPLES)) {
    it(`is idempotent: ${name}`, () => {
      const s1 = roundtrip(s0)
      const s2 = roundtrip(s1)
      expect(s2).toBe(s1)
    })
  }

  it('preserves advanced/unknown syntax verbatim in the first pass', () => {
    for (const s0 of [SAMPLES.ifBlock!, SAMPLES.malformed!, SAMPLES.partial!]) {
      const s1 = roundtrip(s0)
      const controls = s0.match(/\{%[^%]*%\}/g) ?? []
      for (const c of controls) expect(s1).toContain(c)
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @saytu/core test roundtrip.examples`
Expected: PASS — 6 tests (5 idempotency + 1 preservation). The converters are already implemented, so this integration test should pass directly. If any fail, STOP and use superpowers:systematic-debugging before continuing.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/roundtrip.examples.test.ts
git commit -m "test(core): example-based round-trip idempotency + passthrough preservation"
```

---

## Task 6: Round-trip idempotency (property-based, fast-check)

**Files:**
- Test: `packages/core/test/roundtrip.property.test.ts`

- [ ] **Step 1: Write the test `packages/core/test/roundtrip.property.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '.split('')
const safeText = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 40 })
  .map((a) => a.join('').trim() || 'x')

const heading = safeText.map((t) => `# ${t}`)
const paragraph = safeText
const bullets = fc
  .array(safeText, { minLength: 1, maxLength: 3 })
  .map((items) => items.map((i) => `- ${i}`).join('\n'))
const callout = safeText.map((t) => `{% callout %}\n${t}\n{% /callout %}`)
const ifBlock = fc
  .tuple(safeText, safeText)
  .map(([v, t]) => `{% if $${v.replace(/ /g, '')} %}\n${t}\n{% /if %}`)

const block = fc.oneof(heading, paragraph, bullets, callout, ifBlock)
const document = fc.array(block, { minLength: 1, maxLength: 6 }).map((bs) => bs.join('\n\n') + '\n')

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

describe('round-trip idempotency (property-based)', () => {
  it('reaches a stable fixed point for random documents', () => {
    fc.assert(
      fc.property(document, (s0) => {
        const s1 = roundtrip(s0)
        const s2 = roundtrip(s1)
        expect(s2).toBe(s1)
      }),
      { numRuns: 200 },
    )
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @saytu/core test roundtrip.property`
Expected: PASS — idempotency holds across 200 random documents. If fast-check finds a counterexample, STOP and use superpowers:systematic-debugging — the shrunk counterexample is a real fidelity bug to fix (do not weaken the property to make it pass).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/roundtrip.property.test.ts
git commit -m "test(core): property-based round-trip idempotency (fast-check)"
```

---

## Task 7: Final verification + cleanup

**Files:**
- Delete: `packages/core/test/smoke.test.ts`

- [ ] **Step 1: Remove the smoke test**

Run: `git rm packages/core/test/smoke.test.ts`

- [ ] **Step 2: Full typecheck from the repo root**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Full test suite from the repo root**

Run: `pnpm test`
Expected: PASS — all `@saytu/core` tests green (to-tiptap, to-markdoc, roundtrip.examples, roundtrip.property), no smoke test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(core): drop smoke test; increment #1 round-trip complete + green"
```

---

## Self-review notes

- **Spec coverage:** monorepo scaffold (Task 1) ✓; round-trip port `markdocToTiptap`/`tiptapToMarkdoc` (Tasks 3–4) ✓; source-slice preservation + error coalescing + flagging (Task 3) ✓; example idempotency + byte-preservation (Task 5) ✓; property-based idempotency / §26 non-negotiable (Task 6) ✓; types + `RoundtripOptions.knownBlockTags` default `{'callout'}` (Task 2/3) ✓; definition of done = install/typecheck/test green (Task 7) ✓.
- **Out of scope confirmed absent:** no config schema, no Ports, no inline-variable handling, no editor/Astro wiring.
- **Type consistency:** `TiptapDoc`/`TiptapNode`/`TiptapMark`/`RoundtripOptions`/`MdNode` defined in Task 2, used consistently in Tasks 3–6; `markdocToTiptap(source, opts?)` and `tiptapToMarkdoc(doc)` signatures match across tasks and tests.
- **Known runtime cast:** `Markdoc.parse(source, { location: true })` is cast because the published parse type omits the `location` option, but it works at runtime (spike-proven). If a future `@markdoc/markdoc` types the option, drop the cast.
