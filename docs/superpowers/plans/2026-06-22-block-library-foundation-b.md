# Block Library Foundation B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the program's core thesis — block *contract* in core, *renderer* in theme, with a single override order (core standard → theme → site-local) — by shipping the first canonical core block, `button`, end-to-end.

**Architecture:** A standard block declares its contract in `@setu/core` (`STANDARD_BLOCKS`) and points at a deliberately-plain default `.astro` renderer in `@setu/blocks`. A theme overrides the renderer per tag by convention (`<themePkg>/blocks/<tag>.astro`). A pure `resolveBlockSources()` in `@setu/core` merges the three sources into the existing `BlockEntry[]` shape — choosing contract (local > standard) and renderer (local > theme > default) independently per tag — which feeds the existing `buildRegistry` + `generateMarkdocTagsInclude` pipeline unchanged except for one path tweak. The admin uses the same resolver renderer-agnostically; the site `gen-blocks` codegen detects theme overrides and emits resolved renderer paths.

**Tech Stack:** TypeScript, zod, Tiptap (admin editor), Astro + `@astrojs/markdoc` (site), Vitest, jiti (build-time codegen), pnpm workspaces.

## Global Constraints

- **Edge-safe core:** everything added under `packages/core/src/blocks` must compile under `packages/core/tsconfig.edge.json` (`types: []`, no DOM/Node/React) — pure data, zod, and pure functions only.
- **Backward compatible:** existing site-local `blocks/` (callout, notice) keep working unchanged; they become the highest-precedence tier. A tag present only as site-local resolves exactly as today.
- **No packaging changes:** the repo-root `blocks/` directory does not move. Standard blocks and default renderers ship inside existing workspace packages (`@setu/core`, `@setu/blocks`, `@setu/theme-default`) resolvable by the existing resolver patch points.
- **Cloudflare-Pages / edge compatible:** no per-request transform work; all block resolution is build-time (`gen-blocks`) or admin-build-time (Vite glob).
- **Out of scope (do not build):** theme-adds-bespoke-blocks (a second discovery path); the block inspector / side-panel prop editing; theme-accurate WYSIWYG in the editor; width/breakout / alignment props; any second core block.

## File map

- **Create:**
  - `packages/core/src/blocks/standard/types.ts` — `StandardBlock` interface.
  - `packages/core/src/blocks/standard/button.ts` — the `button` standard block.
  - `packages/core/src/blocks/standard/index.ts` — `STANDARD_BLOCKS` array.
  - `packages/core/src/blocks/resolve-sources.ts` — the pure merge resolver.
  - `packages/core/test/blocks/standard-blocks.test.ts`
  - `packages/core/test/blocks/resolve-sources.test.ts`
  - `packages/core/test/blocks/generate-markdoc.test.ts`
  - `packages/core/test/blocks/button-roundtrip.test.ts`
  - `packages/blocks/src/button/Button.astro` + `packages/blocks/src/button/button.css` — plain default renderer.
  - `packages/theme-default/blocks/button.astro` — theme override renderer.
  - `apps/admin/src/blocks/registry.test.ts`
- **Modify:**
  - `packages/core/src/index.ts` — export `StandardBlock`, `STANDARD_BLOCKS`, `resolveBlockSources`.
  - `packages/core/src/blocks/generate-markdoc.ts` — bare-specifier renderer paths.
  - `packages/core/tsconfig.edge.json` — add `src/blocks` to `include`.
  - `packages/blocks/package.json` — export `./button.astro`, `./button.css`.
  - `packages/theme-default/package.json` — export `./blocks/button.astro`.
  - `apps/admin/src/blocks/registry.ts` — merge `STANDARD_BLOCKS` via the resolver.
  - `scripts/gen-blocks.mjs` — load `STANDARD_BLOCKS`, detect theme renderers, call the resolver.
  - `content/post/en/kitchen-sink.mdoc` — add a `button` block for the render test.
  - `apps/site/test/render.test.ts` — assert the button renders themed.

## Commands reference

- Core unit tests: `pnpm --filter @setu/core test`
- Core single file: `pnpm --filter @setu/core exec vitest run test/blocks/<file>`
- Core typecheck (incl. edge): `pnpm --filter @setu/core typecheck`
- Admin tests: `pnpm --filter @setu/admin test`
- Site tests (runs `pnpm build`): `pnpm --filter @setu/site test`
- Whole repo: `pnpm -r test` and `pnpm -r typecheck`

---

### Task 1: The `button` standard contract + `STANDARD_BLOCKS`

**Files:**
- Create: `packages/core/src/blocks/standard/types.ts`
- Create: `packages/core/src/blocks/standard/button.ts`
- Create: `packages/core/src/blocks/standard/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/blocks/standard-blocks.test.ts`

**Interfaces:**
- Consumes: `defineBlock`, `BlockContract` from `../define-block`; `markdocAttributesFor` from `@setu/core`.
- Produces: `interface StandardBlock { tag: string; contract: BlockContract; defaultRenderer: string }`; `export const STANDARD_BLOCKS: StandardBlock[]` (contains `button`). These are consumed by Tasks 2, 7, 8.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/blocks/standard-blocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS, markdocAttributesFor } from '../../src/index'

describe('STANDARD_BLOCKS', () => {
  const button = STANDARD_BLOCKS.find((b) => b.tag === 'button')

  it('includes the button standard block with a default renderer ref', () => {
    expect(button).toBeDefined()
    expect(button!.defaultRenderer).toBe('@setu/blocks/button.astro')
  })

  it('validates href and defaults variant to primary', () => {
    expect(button!.contract.props.parse({ href: '/x' })).toEqual({ href: '/x', variant: 'primary' })
    expect(() => button!.contract.props.parse({})).toThrow()
  })

  it('derives markdoc attributes from the props', () => {
    expect(markdocAttributesFor(button!.contract.props)).toEqual({
      href: { type: 'String' },
      variant: { type: 'String', matches: ['primary', 'secondary'], default: 'primary' },
    })
  })

  it('groups the button under layout with a valid icon', () => {
    expect(button!.contract.editor).toMatchObject({ label: 'Button', group: 'layout', icon: 'link' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/standard-blocks.test.ts`
Expected: FAIL — `STANDARD_BLOCKS` is not exported.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/blocks/standard/types.ts`:

```ts
import type { BlockContract } from '../define-block'

/** A block whose contract ships in @setu/core, with a default renderer in @setu/blocks.
 *  `defaultRenderer` is a bare package specifier the site codegen emits as-is. */
export interface StandardBlock {
  tag: string
  contract: BlockContract
  defaultRenderer: string
}
```

Create `packages/core/src/blocks/standard/button.ts`:

```ts
import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

export const buttonBlock: StandardBlock = {
  tag: 'button',
  defaultRenderer: '@setu/blocks/button.astro',
  contract: defineBlock({
    props: z.object({
      href: z.string(),
      variant: z.enum(['primary', 'secondary']).default('primary'),
    }),
    editor: {
      label: 'Button',
      icon: 'link',
      group: 'layout',
      keywords: ['btn', 'cta', 'link'],
    },
  }),
}
```

Create `packages/core/src/blocks/standard/index.ts`:

```ts
import type { StandardBlock } from './types'
import { buttonBlock } from './button'

/** The canonical core block library — contracts that ship with Setu, theme-rendered. */
export const STANDARD_BLOCKS: StandardBlock[] = [buttonBlock]
```

Modify `packages/core/src/index.ts` — add after the existing block exports (after the `categories` export block, around line 119):

```ts
export type { StandardBlock } from './blocks/standard/types'
export { STANDARD_BLOCKS } from './blocks/standard'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/standard-blocks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/standard packages/core/src/index.ts packages/core/test/blocks/standard-blocks.test.ts
git commit -m "feat(core): button standard block contract + STANDARD_BLOCKS"
```

---

### Task 2: The `resolveBlockSources` precedence resolver

**Files:**
- Create: `packages/core/src/blocks/resolve-sources.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/blocks/resolve-sources.test.ts`

**Interfaces:**
- Consumes: `BlockEntry` from `./registry`; `StandardBlock` from `./standard/types`.
- Produces: `resolveBlockSources(input: { standard: StandardBlock[]; local: BlockEntry[]; themeRenderers?: Record<string, string> }): BlockEntry[]`. Output is the existing `BlockEntry` shape (`{ tag, component, contract }`), ready for `buildRegistry`. Consumed by Tasks 7, 8.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/blocks/resolve-sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveBlockSources } from '../../src/blocks/resolve-sources'
import { defineBlock } from '../../src/blocks/define-block'
import type { StandardBlock } from '../../src/blocks/standard/types'

const std: StandardBlock[] = [
  { tag: 'button', defaultRenderer: '@setu/blocks/button.astro', contract: defineBlock({ props: z.object({ href: z.string() }) }) },
]

describe('resolveBlockSources', () => {
  it('uses the default renderer when no theme override exists', () => {
    const out = resolveBlockSources({ standard: std, local: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ tag: 'button', component: '@setu/blocks/button.astro' })
    expect(out[0].contract).toBe(std[0].contract)
  })

  it('uses the theme renderer when provided, keeping the standard contract', () => {
    const out = resolveBlockSources({
      standard: std,
      local: [],
      themeRenderers: { button: '@setu/theme-default/blocks/button.astro' },
    })
    expect(out[0].component).toBe('@setu/theme-default/blocks/button.astro')
    expect(out[0].contract).toBe(std[0].contract)
  })

  it('lets a site-local block override BOTH the standard contract and renderer', () => {
    const localContract = defineBlock({ props: z.object({ href: z.string(), extra: z.string().optional() }) })
    const out = resolveBlockSources({
      standard: std,
      local: [{ tag: 'button', component: 'blocks/button/button.astro', contract: localContract }],
      themeRenderers: { button: '@setu/theme-default/blocks/button.astro' },
    })
    expect(out).toHaveLength(1)
    expect(out[0].component).toBe('blocks/button/button.astro')
    expect(out[0].contract).toBe(localContract)
  })

  it('unions standard and local blocks', () => {
    const out = resolveBlockSources({
      standard: std,
      local: [{ tag: 'callout', component: 'blocks/callout/callout.astro', contract: defineBlock({ props: z.object({}) }) }],
    })
    expect(out.map((e) => e.tag).sort()).toEqual(['button', 'callout'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/resolve-sources.test.ts`
Expected: FAIL — `resolveBlockSources` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/blocks/resolve-sources.ts`:

```ts
import type { BlockEntry } from './registry'
import type { StandardBlock } from './standard/types'

/** Merge the three block sources into BlockEntry[] for buildRegistry. Per tag, the
 *  contract and renderer are chosen INDEPENDENTLY:
 *    contract = site-local > standard
 *    renderer = site-local > theme > standard default
 *  A theme override (themeRenderers[tag]) replaces only the renderer; the contract stays
 *  the standard one — that is the portability guarantee. */
export function resolveBlockSources(input: {
  standard: StandardBlock[]
  local: BlockEntry[]
  themeRenderers?: Record<string, string>
}): BlockEntry[] {
  const { standard, local, themeRenderers = {} } = input
  const localTags = new Set(local.map((e) => e.tag))
  const fromStandard: BlockEntry[] = standard
    .filter((s) => !localTags.has(s.tag))
    .map((s) => ({
      tag: s.tag,
      component: themeRenderers[s.tag] ?? s.defaultRenderer,
      contract: s.contract,
    }))
  return [...fromStandard, ...local]
}
```

Modify `packages/core/src/index.ts` — add after the `STANDARD_BLOCKS` export from Task 1:

```ts
export { resolveBlockSources } from './blocks/resolve-sources'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/resolve-sources.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/resolve-sources.ts packages/core/src/index.ts packages/core/test/blocks/resolve-sources.test.ts
git commit -m "feat(core): resolveBlockSources — core/theme/site block precedence resolver"
```

---

### Task 3: Enforce edge-safety on the block contract + resolver layer

**Files:**
- Modify: `packages/core/tsconfig.edge.json`

**Interfaces:**
- Consumes: the files added in Tasks 1–2 (all pure + zod).
- Produces: nothing new; CI-enforced edge-safety for `src/blocks`.

- [ ] **Step 1: Add `src/blocks` to the edge include**

Modify `packages/core/tsconfig.edge.json` — add `"src/blocks"` to the `include` array (place it first):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": []
  },
  "include": ["src/blocks", "src/markdoc", "src/data", "src/storage", "src/image", "src/authoring", "src/git", "src/publish", "src/read", "src/authz", "src/lifecycle", "src/content-index", "src/url"]
}
```

- [ ] **Step 2: Run the edge typecheck to verify it passes**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS — both `tsc --noEmit` and `tsc -p tsconfig.edge.json --noEmit` succeed. The `src/blocks` tree (categories, define-block, registry, markdoc-attributes, generate-markdoc, standard/*, resolve-sources) is pure data + zod + string ops, so it compiles with `types: []`.

> If this fails with a DOM/Node-global error, a file under `src/blocks` is using a non-edge API — that is a real edge-safety violation to fix in that file, not a reason to remove the include.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tsconfig.edge.json
git commit -m "build(core): CI-enforce edge-safety of src/blocks (contracts + resolver)"
```

---

### Task 4: Emit bare-specifier renderer paths from the codegen

**Files:**
- Modify: `packages/core/src/blocks/generate-markdoc.ts`
- Test: `packages/core/test/blocks/generate-markdoc.test.ts`

**Interfaces:**
- Consumes: `BlockRegistry` from `./registry`; `markdocAttributesFor`.
- Produces: `generateMarkdocTagsInclude(registry)` now emits `component('<as-is>')` for renderer refs that are NOT repo-root-relative (i.e. don't start with `blocks/`), and keeps the `../../` prefix for repo-root paths. Consumed by Tasks 8, 9.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/blocks/generate-markdoc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { generateMarkdocTagsInclude } from '../../src/blocks/generate-markdoc'
import { buildRegistry } from '../../src/blocks/registry'

const reg = buildRegistry([
  { tag: 'callout', component: 'blocks/callout/callout.astro', contract: { props: z.object({}) } },
  { tag: 'button', component: '@setu/blocks/button.astro', contract: { props: z.object({ href: z.string() }) } },
])

describe('generateMarkdocTagsInclude', () => {
  const out = generateMarkdocTagsInclude(reg)

  it('prefixes a repo-root block path with ../../', () => {
    expect(out).toContain("render: component('../../blocks/callout/callout.astro')")
  })

  it('emits a bare package-specifier renderer as-is', () => {
    expect(out).toContain("render: component('@setu/blocks/button.astro')")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/generate-markdoc.test.ts`
Expected: FAIL — the bare specifier is currently prefixed with `../../`.

- [ ] **Step 3: Write minimal implementation**

Modify `packages/core/src/blocks/generate-markdoc.ts` — change the `generateMarkdocTagsInclude` map body to branch on the component path:

```ts
export function generateMarkdocTagsInclude(registry: BlockRegistry): string {
  const entries = registry.blocks.map((b) => {
    const attrs = serializeAttrs(markdocAttributesFor(b.props))
    // Repo-root block folders are imported relative to apps/site (../../). Renderers
    // shipped by packages (default in @setu/blocks, overrides in the theme) are bare
    // specifiers resolved by Vite/node — emit them unchanged.
    const ref = b.component.startsWith('blocks/') ? `../../${b.component}` : b.component
    return `  ${b.tag}: {\n    render: component('${ref}'),\n    attributes: ${attrs},\n  },`
  })
  return (
    `// AUTO-GENERATED by scripts/gen-blocks.mjs — do not edit.\n` +
    `import { component } from '@astrojs/markdoc/config'\n\n` +
    `export const tags = {\n${entries.join('\n')}\n}\n`
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/generate-markdoc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/generate-markdoc.ts packages/core/test/blocks/generate-markdoc.test.ts
git commit -m "feat(core): codegen emits bare-specifier renderer paths as-is"
```

---

### Task 5: `button` Markdoc round-trip (byte-stable)

**Files:**
- Test: `packages/core/test/blocks/button-roundtrip.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap` from `../../src/markdoc/to-tiptap`; `tiptapToMarkdoc` from `../../src/markdoc/to-markdoc`. No production change — the generic converter already maps any `knownBlockTags` member to a `setuBlock` node and back. This task is the guard proving `button` (with its real `href`/`variant` attrs) round-trips.

- [ ] **Step 1: Write the test**

Create `packages/core/test/blocks/button-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['button'])

describe('button round-trip', () => {
  it('maps {% button %} to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}', {
      knownBlockTags: known,
    })
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({ tag: 'button', mdAttrs: { href: '/signup', variant: 'primary' } })
  })

  it('round-trips {% button %} byte-stably', () => {
    const src = '{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}'
    expect(tiptapToMarkdoc(markdocToTiptap(src, { knownBlockTags: known })).trim()).toBe(src)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run test/blocks/button-roundtrip.test.ts`
Expected: PASS (2 tests) — the converter already handles generic known tags (same path as the existing `notice` round-trip). If it FAILS, do not patch the test: investigate the converter, because a regression there would also break `notice`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/blocks/button-roundtrip.test.ts
git commit -m "test(core): button block round-trips byte-stably"
```

---

### Task 6: Default renderer (`@setu/blocks`) + theme override (`@setu/theme-default`)

**Files:**
- Create: `packages/blocks/src/button/Button.astro`
- Create: `packages/blocks/src/button/button.css`
- Create: `packages/theme-default/blocks/button.astro`
- Modify: `packages/blocks/package.json`
- Modify: `packages/theme-default/package.json`

**Interfaces:**
- Produces: resolvable exports `@setu/blocks/button.astro`, `@setu/blocks/button.css`, `@setu/theme-default/blocks/button.astro`. Consumed by Tasks 8 (theme detection) and 9 (render).

- [ ] **Step 1: Create the default renderer + its CSS**

Create `packages/blocks/src/button/Button.astro`:

```astro
---
import './button.css'
const { href, variant = 'primary' } = Astro.props
---

<a href={href} class={`setu-button setu-button--${variant}`}><slot /></a>
```

Create `packages/blocks/src/button/button.css`:

```css
/* Deliberately plain, unbranded default. Themes override this renderer entirely. */
.setu-button {
  display: inline-block;
  padding: 0.5rem 1rem;
  border: 1px solid currentColor;
  border-radius: 4px;
  text-decoration: none;
}
.setu-button--secondary {
  opacity: 0.8;
}
```

- [ ] **Step 2: Create the theme override renderer**

Create `packages/theme-default/blocks/button.astro`:

```astro
---
const { href, variant = 'primary' } = Astro.props
---

<a href={href} class={`btn btn--${variant}`}><slot /></a>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.25rem;
    border-radius: var(--radius, 8px);
    font-weight: 600;
    text-decoration: none;
    transition: opacity 0.15s ease;
  }
  .btn--primary {
    background: var(--accent, #4f46e5);
    color: var(--accent-contrast, #ffffff);
  }
  .btn--secondary {
    background: transparent;
    color: var(--accent, #4f46e5);
    border: 1px solid var(--accent, #4f46e5);
  }
  .btn:hover {
    opacity: 0.9;
  }
</style>
```

- [ ] **Step 3: Add the package exports**

Modify `packages/blocks/package.json` — add to the `exports` object:

```json
"exports": {
  ".": "./src/index.ts",
  "./callout.css": "./src/callout/callout.css",
  "./notice.css": "./src/notice/notice.css",
  "./button.astro": "./src/button/Button.astro",
  "./button.css": "./src/button/button.css"
},
```

Modify `packages/theme-default/package.json` — add to the `exports` object:

```json
"exports": {
  "./Layout.astro": "./Layout.astro",
  "./PostLayout.astro": "./PostLayout.astro",
  "./PageLayout.astro": "./PageLayout.astro",
  "./theme.css": "./theme.css",
  "./site.css": "./site.css",
  "./options": "./options.ts",
  "./blocks/button.astro": "./blocks/button.astro"
},
```

- [ ] **Step 4: Verify both renderer exports resolve from the site app**

Run:

```bash
node -e "const {createRequire}=require('node:module'); const r=createRequire('/Users/mayank/Documents/projects/setu/.claude/worktrees/block-library-foundation-b/apps/site/package.json'); console.log(r.resolve('@setu/blocks/button.astro')); console.log(r.resolve('@setu/theme-default/blocks/button.astro')); console.log('ok')"
```

Expected: two resolved file paths printed, then `ok`. (This is exactly the resolution `gen-blocks` will perform in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add packages/blocks/src/button packages/blocks/package.json packages/theme-default/blocks packages/theme-default/package.json
git commit -m "feat(blocks,theme): plain default button renderer + theme override"
```

---

### Task 7: Merge `STANDARD_BLOCKS` into the admin registry

**Files:**
- Modify: `apps/admin/src/blocks/registry.ts`
- Test: `apps/admin/src/blocks/registry.test.ts`

**Interfaces:**
- Consumes: `buildRegistry`, `resolveBlockSources`, `STANDARD_BLOCKS` from `@setu/core`.
- Produces: an admin `registry` whose `blocks`/`blocksByTag`/`knownBlockTags` include `button` (renderer-agnostic). `slashBlocks()` and the round-trip pick this up with no further change.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/blocks/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { registry } from './registry'

describe('admin block registry', () => {
  it('includes the button standard block under the layout group', () => {
    expect(registry.knownBlockTags.has('button')).toBe(true)
    expect(registry.blocksByTag.get('button')?.editor?.group).toBe('layout')
  })

  it('keeps site-local folder blocks (callout, notice)', () => {
    expect(registry.knownBlockTags.has('callout')).toBe(true)
    expect(registry.knownBlockTags.has('notice')).toBe(true)
  })

  it('keeps the manually-registered image tag', () => {
    expect(registry.knownBlockTags.has('image')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin exec vitest run src/blocks/registry.test.ts`
Expected: FAIL — `button` is not yet in the registry.

- [ ] **Step 3: Write minimal implementation**

Modify `apps/admin/src/blocks/registry.ts` — merge standard blocks via the resolver (keep the existing glob + the `image` add):

```ts
// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (each block.ts default-exports a BlockContract) into the bundle; we pair it with the
// folder name to build the registry. Path is relative to THIS file: blocks -> src ->
// admin -> apps -> repo root. blocks/ is outside the admin root, so the dev server must
// allow it (see vite.config.ts server.fs.allow).
import { buildRegistry, resolveBlockSources, STANDARD_BLOCKS } from '@setu/core'
import type { BlockContract, BlockRegistry } from '@setu/core'

const mods = import.meta.glob('../../../../blocks/*/block.ts', { eager: true, import: 'default' }) as Record<
  string,
  BlockContract
>

const folderOf = (p: string): string => p.split('/').slice(-2, -1)[0]!

const local = Object.entries(mods).map(([path, contract]) => {
  const tag = folderOf(path)
  return { tag, component: `blocks/${tag}/${tag}.astro`, contract }
})

// Merge standard (core) blocks with site-local folder blocks; local overrides standard
// by tag. The admin is renderer-agnostic, so no theme renderers are passed here.
export const registry: BlockRegistry = buildRegistry(resolveBlockSources({ standard: STANDARD_BLOCKS, local }))

// `image` has a dedicated editor node (ImageBlock) but is NOT a folder block — its render
// needs apps/site's build-time manifest read (#5a). Register it as a known editor tag so the
// round-trip maps {% image %} to the imageBlock node instead of a passthrough.
registry.knownBlockTags.add('image')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin exec vitest run src/blocks/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full admin suite to confirm no regression**

Run: `pnpm --filter @setu/admin test`
Expected: PASS — all existing admin tests still green (the slash menu now also lists `button` under Layout; nothing else changes).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/blocks/registry.ts apps/admin/src/blocks/registry.test.ts
git commit -m "feat(admin): surface STANDARD_BLOCKS (button) in the editor registry"
```

---

### Task 8: Wire `gen-blocks` to standard blocks + theme renderer detection

**Files:**
- Modify: `scripts/gen-blocks.mjs`

**Interfaces:**
- Consumes: `buildRegistry`, `resolveBlockSources`, `STANDARD_BLOCKS` from `@setu/core`; `generateMarkdocTagsInclude`, `loadConfig` from `@setu/core/node`.
- Produces: a regenerated `apps/site/markdoc.blocks.generated.mjs` containing `button` mapped to the active theme's renderer (when present) or the `@setu/blocks` default.

- [ ] **Step 1: Update the codegen entrypoint**

Modify `scripts/gen-blocks.mjs` — replace the `main()` function (keep the file's existing imports, `ROOT`/`BLOCKS_DIR`/`OUT`, the jiti alias block, and `loadEntries()` unchanged):

```js
export async function main() {
  const { buildRegistry, resolveBlockSources, STANDARD_BLOCKS } = await jiti.import('@setu/core')
  const { generateMarkdocTagsInclude, loadConfig } = await jiti.import('@setu/core/node')

  // Resolve the active theme and detect which standard blocks it overrides a renderer for.
  // Convention: a theme that ships `<themePkg>/blocks/<tag>.astro` (exported) overrides it.
  const config = await loadConfig(path.join(ROOT, 'apps', 'site', 'setu.config.ts'))
  const themePkg = config.theme ?? '@setu/theme-default'
  const siteReq = createRequire(path.join(ROOT, 'apps', 'site', 'package.json'))
  const themeRenderers = {}
  for (const sb of STANDARD_BLOCKS) {
    const ref = `${themePkg}/blocks/${sb.tag}.astro`
    try {
      siteReq.resolve(ref)
      themeRenderers[sb.tag] = ref
    } catch {
      // theme provides no override for this tag → falls back to the @setu/blocks default
    }
  }

  const local = await loadEntries()
  const entries = resolveBlockSources({ standard: STANDARD_BLOCKS, local, themeRenderers })
  const registry = buildRegistry(entries)
  writeFileSync(OUT, generateMarkdocTagsInclude(registry))
  console.log(`gen-blocks: ${registry.blocks.length} block(s): ${registry.blocks.map((b) => b.tag).join(', ') || '(none)'}`)
}
```

> `createRequire` is already imported at the top of the file (`import { createRequire } from 'node:module'`). `loadConfig` is exported from `@setu/core/node` (the same module `astro.config.mjs` imports it from).

- [ ] **Step 2: Run the codegen and verify the generated output**

Run:

```bash
node scripts/gen-blocks.mjs && cat apps/site/markdoc.blocks.generated.mjs
```

Expected: console prints `gen-blocks: 3 block(s): button, callout, notice` (order: standard first, then local), and the generated file contains:

```js
  button: {
    render: component('@setu/theme-default/blocks/button.astro'),
    attributes: { href: { type: String }, variant: { type: String, matches: ["primary","secondary"], default: "primary" } },
  },
```

(plus the unchanged `callout` and `notice` entries with their `../../blocks/...` paths). The `button` renderer points at the **theme** override — proving theme detection worked.

- [ ] **Step 3: Commit (including the regenerated file)**

```bash
git add scripts/gen-blocks.mjs apps/site/markdoc.blocks.generated.mjs
git commit -m "feat(site): gen-blocks merges standard blocks + detects theme renderers"
```

---

### Task 9: End-to-end render proof + full green

**Files:**
- Modify: `content/post/en/kitchen-sink.mdoc`
- Modify: `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: the full pipeline from Tasks 1–8 (the site build runs `gen-blocks` as `prebuild`).
- Produces: a rendered `button` in the built site, asserted in the render suite.

- [ ] **Step 1: Add a button block to the kitchen-sink fixture**

Modify `content/post/en/kitchen-sink.mdoc` — add the following block immediately after the existing `{% /notice %}` block (around line 21):

```
{% button href="/signup" variant="primary" %}Get started{% /button %}
```

- [ ] **Step 2: Write the failing render assertion**

Modify `apps/site/test/render.test.ts` — add this test inside the existing `describe('render pipeline — standard nodes', ...)` block (after the link-rendering test):

```ts
  it('renders a button block through the theme renderer', () => {
    expect(html).toContain('class="btn btn--primary"')
    expect(html).toContain('href="/signup"')
    expect(html).toContain('Get started')
  })
```

- [ ] **Step 3: Run the site suite to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS — the suite runs `pnpm build` (which runs `gen-blocks` → resolves `button` to the theme renderer → renders the themed `<a class="btn btn--primary" href="/signup">Get started</a>`), then all `render.test.ts` assertions including the new one pass.

> **Contingency (only if the build fails to resolve `@setu/theme-default/blocks/button.astro` or `@setu/blocks/button.astro`):** Astro's `component()` could not resolve the bare specifier. Fix in `scripts/gen-blocks.mjs` Step 1 by resolving each renderer ref to an absolute path before passing it through — change `themeRenderers[sb.tag] = ref` to `themeRenderers[sb.tag] = siteReq.resolve(ref)`, and in `STANDARD_BLOCKS`/the default branch resolve `defaultRenderer` the same way — then in `generate-markdoc.ts` treat an absolute path (`startsWith('/')`) like a bare specifier (emit as-is). Re-run this step. Absolute paths are imported by Astro via the already-present `server.fs.allow: ['../..']`.

- [ ] **Step 4: Run the whole repo green**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: PASS across all packages (core, blocks, theme-default, admin, site) and all typechecks including the core edge typecheck.

- [ ] **Step 5: Commit**

```bash
git add content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts
git commit -m "test(site): button renders end-to-end via the theme renderer"
```

---

## Verification summary (what "done" proves)

- **Contract in core:** `button` validates + derives Markdoc attributes from `@setu/core` (Task 1), edge-safe (Task 3).
- **Independent precedence:** theme overrides the renderer while the contract stays standard; site-local overrides both (Task 2).
- **Default renderer in `@setu/blocks`, override in the theme:** both resolve (Task 6); the default theme's override is the one that renders (Tasks 8–9), and removing it would fall back to the default (proven by Task 2's resolver unit test).
- **All three flows wired:** admin registry (Task 7), site codegen (Task 8), site runtime render (Task 9).
- **Backward compatible:** callout/notice unchanged and still green (Tasks 7, 9); round-trip byte-stable for `button` (Task 5).
