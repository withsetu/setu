# saytu.config.ts Schema + Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `knownBlockTags = new Set(['callout'])` placeholder in `@saytu/core` with a real, validated, file-loaded `saytu.config.ts` (block definitions only).

**Architecture:** A new pure `src/config/` module inside `@saytu/core`: typed config shapes, a `defineConfig()` inference helper, a Zod meta-schema, `resolveConfig()` (validate + index + derive the tag set), `loadConfig()` (load a real TS config via jiti), and a shipped `defaultConfig` (the `callout` block). The round-trip's default recognised-tag set is then *derived from `defaultConfig`* instead of a magic constant — a one-way `markdoc/ → config/` import edge (no cycle, since `config/` never imports `markdoc/`).

**Tech Stack:** TypeScript (strict), Zod (meta-schema + block prop schemas), jiti (runtime TS config loading), Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-config-schema-design.md`

---

## File Structure

```
packages/core/src/config/
├── types.ts           # SaytuConfig, BlockDefinition, BlockEditorMeta, ResolvedConfig, ResolvedBlock
├── define-config.ts   # defineConfig() identity helper
├── schema.ts          # Zod meta-schema (configSchema) + isZodSchema guard
├── resolve.ts         # resolveConfig(raw): ResolvedConfig
├── default-config.ts  # defaultConfig + defaultKnownBlockTags (callout block)
└── load.ts            # loadConfig(path): Promise<ResolvedConfig>  (jiti)

packages/core/test/config/
├── define-config.test.ts
├── resolve.test.ts
├── default-config.test.ts
├── load.test.ts
├── config-roundtrip.test.ts
└── fixtures/saytu.config.ts

Modified:
- packages/core/package.json            # add zod + jiti deps
- packages/core/src/markdoc/to-tiptap.ts # default derives from defaultConfig
- packages/core/src/index.ts            # export the config public surface
- packages/core/test/to-tiptap.test.ts  # add config-derived default tests
```

All `config/` modules are pure except `load.ts`, which is the only one touching the filesystem.

---

### Task 1: Config types, `defineConfig`, and dependencies

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/config/types.ts`
- Create: `packages/core/src/config/define-config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config/define-config.test.ts`

- [ ] **Step 1: Add dependencies**

Edit `packages/core/package.json` `dependencies` to add `zod` and `jiti` (keep the existing `@markdoc/markdoc`):

```json
  "dependencies": {
    "@markdoc/markdoc": "^0.5.7",
    "jiti": "^2.4.2",
    "zod": "^3.23.8"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes clean; `zod` and `jiti` resolved in `packages/core`.

- [ ] **Step 3: Create the config types**

Create `packages/core/src/config/types.ts`:

```ts
import type { ZodTypeAny } from 'zod'

/** Editor-facing metadata for a block (consumed by the slash menu later). */
export interface BlockEditorMeta {
  label?: string
  icon?: string
  group?: string
}

/** A content block as authored in saytu.config.ts. */
export interface BlockDefinition {
  /** Markdoc tag name, e.g. 'callout'. Unique across the config. */
  tag: string
  /** Zod schema for the block's Markdoc attributes (props). */
  props: ZodTypeAny
  /** Framework-agnostic path to the render component (.astro or framework). */
  component: string
  /** Optional editor metadata (slash-menu label/icon/group). */
  editor?: BlockEditorMeta
}

/** The config object an author exports from saytu.config.ts. */
export interface SaytuConfig {
  blocks: BlockDefinition[]
}

/** A block after resolution (distinct type for future derived fields). */
export type ResolvedBlock = BlockDefinition

/** The validated, indexed config the rest of the system consumes. */
export interface ResolvedConfig {
  /** All blocks, in authored order. */
  blocks: ResolvedBlock[]
  /** Blocks indexed by tag for O(1) lookup. */
  blocksByTag: Map<string, ResolvedBlock>
  /** Tag set the round-trip treats as known/editable blocks. */
  knownBlockTags: Set<string>
}
```

- [ ] **Step 4: Write the failing test for `defineConfig`**

Create `packages/core/test/config/define-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineConfig } from '../../src/index'

describe('defineConfig', () => {
  it('returns the config object unchanged (runtime identity)', () => {
    const config = {
      blocks: [
        { tag: 'callout', props: z.object({ type: z.string().optional() }), component: './Callout.astro' },
      ],
    }
    expect(defineConfig(config)).toBe(config)
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- define-config`
Expected: FAIL — `defineConfig` is not exported from `../../src/index`.

- [ ] **Step 6: Implement `defineConfig`**

Create `packages/core/src/config/define-config.ts`:

```ts
import type { SaytuConfig } from './types'

/** Identity helper: exists purely so authors get type inference and a stable import. */
export const defineConfig = (config: SaytuConfig): SaytuConfig => config
```

- [ ] **Step 7: Export the config surface from the package index**

Edit `packages/core/src/index.ts` to add the config exports (keep the existing round-trip exports):

```ts
export type {
  TiptapMark,
  TiptapNode,
  TiptapDoc,
  RoundtripOptions,
} from './markdoc/types'
export { markdocToTiptap } from './markdoc/to-tiptap'
export { tiptapToMarkdoc } from './markdoc/to-markdoc'

export type {
  SaytuConfig,
  BlockDefinition,
  BlockEditorMeta,
  ResolvedConfig,
  ResolvedBlock,
} from './config/types'
export { defineConfig } from './config/define-config'
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @saytu/core test -- define-config`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/core/package.json packages/core/src/config/types.ts packages/core/src/config/define-config.ts packages/core/src/index.ts packages/core/test/config/define-config.test.ts pnpm-lock.yaml
git commit -m "feat(core): config types + defineConfig helper (zod, jiti deps)"
```

---

### Task 2: Zod meta-schema + `resolveConfig`

**Files:**
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config/resolve.test.ts`

- [ ] **Step 1: Write the failing tests for `resolveConfig`**

Create `packages/core/test/config/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveConfig } from '../../src/index'

const block = (tag: string) => ({
  tag,
  props: z.object({ type: z.string().optional() }),
  component: `./${tag}.astro`,
})

describe('resolveConfig', () => {
  it('indexes blocks and derives knownBlockTags from a valid config', () => {
    const resolved = resolveConfig({ blocks: [block('callout'), block('hero')] })
    expect(resolved.blocks.map((b) => b.tag)).toEqual(['callout', 'hero'])
    expect(resolved.blocksByTag.get('hero')?.component).toBe('./hero.astro')
    expect([...resolved.knownBlockTags]).toEqual(['callout', 'hero'])
  })

  it('resolves an empty blocks array to an empty config', () => {
    const resolved = resolveConfig({ blocks: [] })
    expect(resolved.blocks).toEqual([])
    expect(resolved.knownBlockTags.size).toBe(0)
  })

  it('throws when a block is missing its tag', () => {
    const bad = { blocks: [{ props: z.object({}), component: './x.astro' }] }
    expect(() => resolveConfig(bad)).toThrow(/tag/i)
  })

  it('throws when a block is missing its component', () => {
    const bad = { blocks: [{ tag: 'callout', props: z.object({}) }] }
    expect(() => resolveConfig(bad)).toThrow(/component/i)
  })

  it('throws when props is not a Zod schema', () => {
    const bad = { blocks: [{ tag: 'callout', props: { type: 'string' }, component: './x.astro' }] }
    expect(() => resolveConfig(bad)).toThrow(/zod schema/i)
  })

  it('throws on a duplicate block tag, naming the tag', () => {
    expect(() => resolveConfig({ blocks: [block('callout'), block('callout')] })).toThrow(
      /Duplicate block tag "callout"/,
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @saytu/core test -- config/resolve`
Expected: FAIL — `resolveConfig` is not exported.

- [ ] **Step 3: Implement the meta-schema**

Create `packages/core/src/config/schema.ts`:

```ts
import { z, type ZodTypeAny } from 'zod'

/** Duck-typed Zod-schema check (avoids dual-instance instanceof pitfalls). */
const isZodSchema = (val: unknown): val is ZodTypeAny =>
  typeof (val as { safeParse?: unknown })?.safeParse === 'function' &&
  typeof (val as { parse?: unknown })?.parse === 'function'

const blockEditorSchema = z
  .object({
    label: z.string().optional(),
    icon: z.string().optional(),
    group: z.string().optional(),
  })
  .strict()

const blockSchema = z.object({
  tag: z.string().min(1, 'block.tag must be a non-empty string'),
  props: z.custom<ZodTypeAny>(isZodSchema, { message: 'block.props must be a Zod schema' }),
  component: z.string().min(1, 'block.component must be a non-empty string'),
  editor: blockEditorSchema.optional(),
})

export const configSchema = z.object({
  blocks: z.array(blockSchema),
})
```

- [ ] **Step 4: Implement `resolveConfig`**

Create `packages/core/src/config/resolve.ts`:

```ts
import { configSchema } from './schema'
import type { ResolvedBlock, ResolvedConfig } from './types'

/** Validate an authored config, index its blocks, and derive the known-tag set.
 *  Throws a clear Error on invalid input (config errors must fail loudly). */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid saytu.config: ${parsed.error.message}`)
  }

  const blocks = parsed.data.blocks as ResolvedBlock[]
  const blocksByTag = new Map<string, ResolvedBlock>()
  for (const block of blocks) {
    if (blocksByTag.has(block.tag)) {
      throw new Error(`Duplicate block tag "${block.tag}" in saytu.config.ts`)
    }
    blocksByTag.set(block.tag, block)
  }

  return { blocks, blocksByTag, knownBlockTags: new Set(blocksByTag.keys()) }
}
```

- [ ] **Step 5: Export `resolveConfig`**

Edit `packages/core/src/index.ts` — add below the `defineConfig` export:

```ts
export { resolveConfig } from './config/resolve'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @saytu/core test -- config/resolve`
Expected: PASS (6 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/resolve.ts packages/core/src/index.ts packages/core/test/config/resolve.test.ts
git commit -m "feat(core): zod meta-schema + resolveConfig"
```

---

### Task 3: `defaultConfig` + `defaultKnownBlockTags`

**Files:**
- Create: `packages/core/src/config/default-config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config/default-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/config/default-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultConfig, defaultKnownBlockTags, resolveConfig } from '../../src/index'

describe('defaultConfig', () => {
  it('defines exactly the callout block', () => {
    expect(defaultConfig.blocks.map((b) => b.tag)).toEqual(['callout'])
  })

  it('resolves and exposes callout in defaultKnownBlockTags', () => {
    const resolved = resolveConfig(defaultConfig)
    expect([...resolved.knownBlockTags]).toEqual(['callout'])
    expect([...defaultKnownBlockTags]).toEqual(['callout'])
  })

  it('validates the callout props schema (type enum with info default)', () => {
    const callout = defaultConfig.blocks.find((b) => b.tag === 'callout')!
    expect(callout.props.parse({})).toEqual({ type: 'info' })
    expect(() => callout.props.parse({ type: 'nope' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- default-config`
Expected: FAIL — `defaultConfig` / `defaultKnownBlockTags` not exported.

- [ ] **Step 3: Implement the default config**

Create `packages/core/src/config/default-config.ts`:

```ts
import { z } from 'zod'
import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Saytu ships with when the developer provides none. */
export const defaultConfig = defineConfig({
  blocks: [
    {
      tag: 'callout',
      props: z.object({
        type: z.enum(['info', 'warning', 'danger']).default('info'),
        title: z.string().optional(),
      }),
      component: './src/components/Callout.astro',
      editor: { label: 'Callout', icon: 'info', group: 'Blocks' },
    },
  ],
})

/** Known-block tag set derived from the default config (used by the round-trip
 *  when no explicit config is supplied). Computed once at module load. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags
```

- [ ] **Step 4: Export the default config surface**

Edit `packages/core/src/index.ts` — add below the `resolveConfig` export:

```ts
export { defaultConfig, defaultKnownBlockTags } from './config/default-config'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @saytu/core test -- default-config`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config/default-config.ts packages/core/src/index.ts packages/core/test/config/default-config.test.ts
git commit -m "feat(core): default config (callout) + derived defaultKnownBlockTags"
```

---

### Task 4: Rewire the round-trip default to the config

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts:1-4,76-77`
- Test: `packages/core/test/to-tiptap.test.ts`

- [ ] **Step 1: Write the failing tests for config-derived recognition**

Edit `packages/core/test/to-tiptap.test.ts` — add these two tests inside the existing `describe('markdocToTiptap', ...)` block (after the existing `it('maps a known block tag ...')`):

```ts
  it('recognizes callout by default, sourced from the config (not a hardcoded constant)', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n')
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('treats callout as passthrough when an empty knownBlockTags set is supplied', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', {
      knownBlockTags: new Set<string>(),
    })
    expect(doc.content[0]!.type).toBe('passthrough')
  })
```

- [ ] **Step 2: Run tests to verify the new behavior gap**

Run: `pnpm --filter @saytu/core test -- to-tiptap.test`
Expected: the "recognizes callout by default" test PASSES already (old constant), the "empty set" test PASSES already too — these lock current behavior. Confirm both green before refactor so the refactor is proven non-regressing. (If both already pass, proceed; they are the regression guard for Step 3.)

- [ ] **Step 3: Replace the hardcoded constant with the config-derived default**

Edit `packages/core/src/markdoc/to-tiptap.ts`.

Change the imports (lines 1-2) and delete the constant (line 4). Replace:

```ts
import Markdoc from '@markdoc/markdoc'
import type { MdNode, RoundtripOptions, TiptapDoc, TiptapMark, TiptapNode } from './types'

const DEFAULT_KNOWN_BLOCK_TAGS = new Set(['callout'])
```

with:

```ts
import Markdoc from '@markdoc/markdoc'
import type { MdNode, RoundtripOptions, TiptapDoc, TiptapMark, TiptapNode } from './types'
import { defaultKnownBlockTags } from '../config/default-config'
```

Then change the default fallback inside `markdocToTiptap` (was line 77):

```ts
  const known = opts.knownBlockTags ?? defaultKnownBlockTags
```

- [ ] **Step 4: Run the full core suite (regression guard)**

Run: `pnpm --filter @saytu/core test`
Expected: PASS — all existing 21 tests plus the new config tests; the two Step-1 tests still pass, proving the rewire preserved behavior.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean (no `markdoc/ → config/` cycle, since `config/` never imports `markdoc/`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/test/to-tiptap.test.ts
git commit -m "refactor(core): derive round-trip default known-tags from config"
```

---

### Task 5: `loadConfig` via jiti

**Files:**
- Create: `packages/core/src/config/load.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/config/fixtures/saytu.config.ts`
- Test: `packages/core/test/config/load.test.ts`

- [ ] **Step 1: Create the fixture config file**

Create `packages/core/test/config/fixtures/saytu.config.ts`:

```ts
import { z } from 'zod'
import { defineConfig } from '../../../src/config/define-config'

export default defineConfig({
  blocks: [
    {
      tag: 'callout',
      props: z.object({ type: z.string().optional() }),
      component: './Callout.astro',
      editor: { label: 'Callout' },
    },
  ],
})
```

- [ ] **Step 2: Write the failing tests for `loadConfig`**

Create `packages/core/test/config/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../src/index'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('loadConfig', () => {
  it('loads and resolves a real saytu.config.ts via jiti', async () => {
    const resolved = await loadConfig(fixture('saytu.config.ts'))
    expect([...resolved.knownBlockTags]).toEqual(['callout'])
    expect(resolved.blocksByTag.get('callout')?.component).toBe('./Callout.astro')
  })

  it('throws when the config module has no default export', async () => {
    await expect(loadConfig(fixture('no-default.ts'))).rejects.toThrow(/no default export/i)
  })
})
```

- [ ] **Step 3: Create the no-default fixture**

Create `packages/core/test/config/fixtures/no-default.ts`:

```ts
export const notTheDefault = 42
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @saytu/core test -- config/load`
Expected: FAIL — `loadConfig` is not exported.

- [ ] **Step 5: Implement `loadConfig`**

Create `packages/core/src/config/load.ts`:

```ts
import { createJiti } from 'jiti'
import { resolveConfig } from './resolve'
import type { ResolvedConfig } from './types'

/** Load a saytu.config.ts/js module from disk (TS at runtime via jiti),
 *  take its default export, and resolve it. */
export async function loadConfig(path: string): Promise<ResolvedConfig> {
  const jiti = createJiti(import.meta.url)
  const mod = (await jiti.import(path)) as { default?: unknown }
  if (mod.default === undefined) {
    throw new Error(`saytu config at "${path}" has no default export`)
  }
  return resolveConfig(mod.default)
}
```

- [ ] **Step 6: Export `loadConfig`**

Edit `packages/core/src/index.ts` — add below the `defaultConfig` export:

```ts
export { loadConfig } from './config/load'
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @saytu/core test -- config/load`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/config/load.ts packages/core/src/index.ts packages/core/test/config/load.test.ts packages/core/test/config/fixtures/saytu.config.ts packages/core/test/config/fixtures/no-default.ts
git commit -m "feat(core): loadConfig — load saytu.config.ts via jiti"
```

---

### Task 6: Integration — config drives the round-trip end-to-end

**Files:**
- Test: `packages/core/test/config/config-roundtrip.test.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/core/test/config/config-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { markdocToTiptap, resolveConfig, defaultConfig } from '../../src/index'

describe('config drives the round-trip', () => {
  it('recognizes a block defined in the config as known', () => {
    const { knownBlockTags } = resolveConfig(defaultConfig)
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', { knownBlockTags })
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('treats a tag absent from the config as passthrough', () => {
    const { knownBlockTags } = resolveConfig({
      blocks: [{ tag: 'hero', props: z.object({}), component: './Hero.astro' }],
    })
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', { knownBlockTags })
    expect(doc.content[0]!.type).toBe('passthrough')
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm --filter @saytu/core test -- config-roundtrip`
Expected: PASS (2 tests).

- [ ] **Step 3: Run the full repo suite + typecheck (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: all suites green (existing 21 round-trip tests + the new config suite), typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/config/config-roundtrip.test.ts
git commit -m "test(core): config-driven round-trip integration"
```

---

## Self-Review

**Spec coverage:**
- `src/config/` module, all six files → Tasks 1, 2, 3, 5 (+ rewire in 4). ✓
- `defineConfig` → Task 1. ✓
- Zod meta-schema (tag/component non-empty, props is Zod, optional editor) → Task 2 Step 3. ✓
- `resolveConfig` (validate, index, derive set, duplicate-tag error) → Task 2. ✓
- `loadConfig` via jiti + no-default-export error → Task 5. ✓
- `defaultConfig` (callout) + `defaultKnownBlockTags` → Task 3. ✓
- Kill `new Set(['callout'])` magic constant; default config-derived → Task 4. ✓
- Public exports (`SaytuConfig`, `BlockDefinition`, `BlockEditorMeta`, `ResolvedConfig`, `ResolvedBlock`, `defineConfig`, `resolveConfig`, `loadConfig`, `defaultConfig`, `defaultKnownBlockTags`) → incrementally across Tasks 1-5. ✓
- Tests: resolve / define-config / load / default-config / integration → Tasks 2,1,5,3,6. ✓
- DoD: `pnpm install` clean, `pnpm typecheck` clean, full suite green incl. existing 21, magic constant gone → Task 6 Step 3 + Task 4. ✓
- Deferred (collections, permalinks, theme overrides, attribute-validation) → not in any task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `ResolvedBlock = BlockDefinition`; `resolveConfig` returns `{ blocks, blocksByTag, knownBlockTags }` matching `ResolvedConfig`; `defaultKnownBlockTags` is a `Set<string>` consumed by `to-tiptap`'s `opts.knownBlockTags ?? defaultKnownBlockTags` (also `Set<string>`); `loadConfig` returns `Promise<ResolvedConfig>`; `props` typed `ZodTypeAny` throughout. ✓
