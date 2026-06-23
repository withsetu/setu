# Block Library Foundation B Implementation Plan (slim scope)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first **core-shipped** standard block, `button`, themed via CSS tokens the same way callout is — so the standard block library ships with the product instead of being hand-made per site.

**Architecture:** `button`'s contract lives in `@setu/core` (`STANDARD_BLOCKS`); its single renderer lives in `@setu/blocks` (token-themed `.astro`, like callout). A pure `mergeBlockSources()` unions core standard blocks with the site-local `blocks/` folder (site-local wins on a tag collision) into the existing `BlockEntry[]` shape, feeding the existing `buildRegistry` + `gen-blocks` pipeline. **No per-theme renderer override / precedence resolver** — deferred until a block needs structurally different markup per theme.

**Tech Stack:** TypeScript, zod, Tiptap (admin), Astro + `@astrojs/markdoc` (site), Vitest, jiti (codegen), pnpm workspaces.

## Global Constraints

- **Edge-safe core:** everything under `packages/core/src/blocks` must compile under `packages/core/tsconfig.edge.json` (`types: []`, no DOM/Node/React) — pure data, zod, pure functions only.
- **Backward compatible:** existing site-local `blocks/` (callout, notice) unchanged; on a tag collision, site-local wins.
- **No packaging changes:** repo-root `blocks/` does not move.
- **Cloudflare-Pages compatible:** all resolution is build-time or admin-build-time.
- **Out of scope (do not build):** per-theme renderer override / precedence resolver / theme-renderer detection; theme-shipped block `.astro`; block inspector; theme-accurate editor WYSIWYG; width/alignment props; any second core block.

## File map

- **Create:** `packages/core/src/blocks/standard/{types,button,index}.ts`; `packages/core/src/blocks/merge-sources.ts`; `packages/blocks/src/button/{Button.astro,button.css}`; tests `packages/core/test/blocks/{standard-blocks,merge-sources,generate-markdoc,button-roundtrip}.test.ts`; `apps/admin/src/blocks/registry.test.ts`.
- **Modify:** `packages/core/src/index.ts`; `packages/core/src/blocks/generate-markdoc.ts`; `packages/core/tsconfig.edge.json`; `packages/blocks/package.json`; `apps/admin/src/blocks/registry.ts`; `scripts/gen-blocks.mjs`; `content/post/en/kitchen-sink.mdoc`; `apps/site/test/render.test.ts`.

## Commands reference

- Core tests: `pnpm --filter @setu/core test` · single file: `pnpm --filter @setu/core exec vitest run test/blocks/<file>`
- Core typecheck (incl. edge): `pnpm --filter @setu/core typecheck`
- Admin tests: `pnpm --filter @setu/admin test` · single: `pnpm --filter @setu/admin exec vitest run src/blocks/registry.test.ts`
- Site tests (runs `pnpm build`): `pnpm --filter @setu/site test`
- Whole repo: `pnpm -r test` and `pnpm -r typecheck`

---

### Task 1: The `button` standard contract + `STANDARD_BLOCKS`

**Files:**
- Create: `packages/core/src/blocks/standard/types.ts`, `.../standard/button.ts`, `.../standard/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/blocks/standard-blocks.test.ts`

**Interfaces:**
- Consumes: `defineBlock`, `BlockContract` from `../define-block`; `markdocAttributesFor` from `@setu/core`.
- Produces: `interface StandardBlock { tag: string; contract: BlockContract; renderer: string }`; `export const STANDARD_BLOCKS: StandardBlock[]`. Consumed by Tasks 2, 7, 8.

- [ ] **Step 1: Write the failing test** — create `packages/core/test/blocks/standard-blocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS, markdocAttributesFor } from '../../src/index'

describe('STANDARD_BLOCKS', () => {
  const button = STANDARD_BLOCKS.find((b) => b.tag === 'button')

  it('includes the button standard block with its @setu/blocks renderer', () => {
    expect(button).toBeDefined()
    expect(button!.renderer).toBe('@setu/blocks/button.astro')
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

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/core exec vitest run test/blocks/standard-blocks.test.ts` → FAIL (`STANDARD_BLOCKS` not exported).

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/blocks/standard/types.ts`:

```ts
import type { BlockContract } from '../define-block'

/** A block whose contract ships in @setu/core, rendered by a token-themed component in
 *  @setu/blocks. `renderer` is a bare package specifier the site codegen emits as-is. */
export interface StandardBlock {
  tag: string
  contract: BlockContract
  renderer: string
}
```

`packages/core/src/blocks/standard/button.ts`:

```ts
import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

export const buttonBlock: StandardBlock = {
  tag: 'button',
  renderer: '@setu/blocks/button.astro',
  contract: defineBlock({
    props: z.object({
      href: z.string(),
      variant: z.enum(['primary', 'secondary']).default('primary'),
    }),
    editor: { label: 'Button', icon: 'link', group: 'layout', keywords: ['btn', 'cta', 'link'] },
  }),
}
```

`packages/core/src/blocks/standard/index.ts`:

```ts
import type { StandardBlock } from './types'
import { buttonBlock } from './button'

/** The canonical core block library — contracts that ship with Setu, token-themed. */
export const STANDARD_BLOCKS: StandardBlock[] = [buttonBlock]
```

Modify `packages/core/src/index.ts` — add after the existing `categories` block export (around line 119):

```ts
export type { StandardBlock } from './blocks/standard/types'
export { STANDARD_BLOCKS } from './blocks/standard'
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @setu/core exec vitest run test/blocks/standard-blocks.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/standard packages/core/src/index.ts packages/core/test/blocks/standard-blocks.test.ts
git commit -m "feat(core): button standard block contract + STANDARD_BLOCKS"
```

---

### Task 2: `mergeBlockSources` — union core standard + site-local

**Files:**
- Create: `packages/core/src/blocks/merge-sources.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/blocks/merge-sources.test.ts`

**Interfaces:**
- Consumes: `BlockEntry` from `./registry`; `StandardBlock` from `./standard/types`.
- Produces: `mergeBlockSources(input: { standard: StandardBlock[]; local: BlockEntry[] }): BlockEntry[]` — `{ tag, component, contract }`, ready for `buildRegistry`. Site-local wins on a tag collision. Consumed by Tasks 7, 8.

- [ ] **Step 1: Write the failing test** — create `packages/core/test/blocks/merge-sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { mergeBlockSources } from '../../src/blocks/merge-sources'
import { defineBlock } from '../../src/blocks/define-block'
import type { StandardBlock } from '../../src/blocks/standard/types'

const std: StandardBlock[] = [
  { tag: 'button', renderer: '@setu/blocks/button.astro', contract: defineBlock({ props: z.object({ href: z.string() }) }) },
]

describe('mergeBlockSources', () => {
  it('carries a standard block in with its @setu/blocks renderer as component', () => {
    const out = mergeBlockSources({ standard: std, local: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ tag: 'button', component: '@setu/blocks/button.astro' })
    expect(out[0].contract).toBe(std[0].contract)
  })

  it('lets a site-local folder block override a standard block by tag', () => {
    const localContract = defineBlock({ props: z.object({ href: z.string(), extra: z.string().optional() }) })
    const out = mergeBlockSources({
      standard: std,
      local: [{ tag: 'button', component: 'blocks/button/button.astro', contract: localContract }],
    })
    expect(out).toHaveLength(1)
    expect(out[0].component).toBe('blocks/button/button.astro')
    expect(out[0].contract).toBe(localContract)
  })

  it('unions standard and local blocks', () => {
    const out = mergeBlockSources({
      standard: std,
      local: [{ tag: 'callout', component: 'blocks/callout/callout.astro', contract: defineBlock({ props: z.object({}) }) }],
    })
    expect(out.map((e) => e.tag).sort()).toEqual(['button', 'callout'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/core exec vitest run test/blocks/merge-sources.test.ts` → FAIL (`mergeBlockSources` not found).

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/blocks/merge-sources.ts`:

```ts
import type { BlockEntry } from './registry'
import type { StandardBlock } from './standard/types'

/** Union core standard blocks with site-local folder blocks into BlockEntry[] for
 *  buildRegistry. Site-local wins on a tag collision, so any site can override a standard
 *  block by dropping a blocks/<tag>/ folder. A standard block's renderer specifier becomes
 *  its `component`. */
export function mergeBlockSources(input: { standard: StandardBlock[]; local: BlockEntry[] }): BlockEntry[] {
  const { standard, local } = input
  const localTags = new Set(local.map((e) => e.tag))
  const fromStandard: BlockEntry[] = standard
    .filter((s) => !localTags.has(s.tag))
    .map((s) => ({ tag: s.tag, component: s.renderer, contract: s.contract }))
  return [...fromStandard, ...local]
}
```

Modify `packages/core/src/index.ts` — add after the `STANDARD_BLOCKS` export from Task 1:

```ts
export { mergeBlockSources } from './blocks/merge-sources'
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @setu/core exec vitest run test/blocks/merge-sources.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/merge-sources.ts packages/core/src/index.ts packages/core/test/blocks/merge-sources.test.ts
git commit -m "feat(core): mergeBlockSources — union core standard + site-local blocks"
```

---

### Task 3: Enforce edge-safety on the block layer

**Files:** Modify: `packages/core/tsconfig.edge.json`

- [ ] **Step 1: Add `src/blocks` to the edge include** — set the `include` array to:

```json
"include": ["src/blocks", "src/markdoc", "src/data", "src/storage", "src/image", "src/authoring", "src/git", "src/publish", "src/read", "src/authz", "src/lifecycle", "src/content-index", "src/url"]
```

- [ ] **Step 2: Run the edge typecheck** — `pnpm --filter @setu/core typecheck` → PASS (both `tsc --noEmit` and `tsc -p tsconfig.edge.json --noEmit`). The `src/blocks` tree is pure data + zod + string ops.

> If it fails with a DOM/Node-global error, a file under `src/blocks` uses a non-edge API — fix that file; do not remove the include.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tsconfig.edge.json
git commit -m "build(core): CI-enforce edge-safety of src/blocks"
```

---

### Task 4: Emit bare-specifier renderer paths from the codegen

**Files:**
- Modify: `packages/core/src/blocks/generate-markdoc.ts`
- Test: `packages/core/test/blocks/generate-markdoc.test.ts`

**Interfaces:**
- Produces: `generateMarkdocTagsInclude(registry)` emits `component('<as-is>')` for renderer refs that do NOT start with `blocks/`, and keeps the `../../` prefix for repo-root `blocks/…` paths. Consumed by Task 8.

- [ ] **Step 1: Write the failing test** — create `packages/core/test/blocks/generate-markdoc.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/core exec vitest run test/blocks/generate-markdoc.test.ts` → FAIL (bare specifier currently gets `../../`).

- [ ] **Step 3: Write minimal implementation** — in `packages/core/src/blocks/generate-markdoc.ts`, change the `generateMarkdocTagsInclude` map body:

```ts
export function generateMarkdocTagsInclude(registry: BlockRegistry): string {
  const entries = registry.blocks.map((b) => {
    const attrs = serializeAttrs(markdocAttributesFor(b.props))
    // Repo-root block folders import relative to apps/site (../../). Package renderers
    // (the @setu/blocks standard renderer) are bare specifiers resolved by Vite/node —
    // emit them unchanged.
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

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @setu/core exec vitest run test/blocks/generate-markdoc.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/generate-markdoc.ts packages/core/test/blocks/generate-markdoc.test.ts
git commit -m "feat(core): codegen emits bare-specifier renderer paths as-is"
```

---

### Task 5: `button` Markdoc round-trip (byte-stable)

**Files:** Test: `packages/core/test/blocks/button-roundtrip.test.ts`

**Interfaces:** Consumes `markdocToTiptap` (`../../src/markdoc/to-tiptap`), `tiptapToMarkdoc` (`../../src/markdoc/to-markdoc`). No production change — the generic converter already maps any `knownBlockTags` member to a `setuBlock` node and back. This is the guard proving `button` round-trips.

- [ ] **Step 1: Write the test** — create `packages/core/test/blocks/button-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['button'])

describe('button round-trip', () => {
  it('maps {% button %} to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}', { knownBlockTags: known })
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

- [ ] **Step 2: Run test to verify it passes** — `pnpm --filter @setu/core exec vitest run test/blocks/button-roundtrip.test.ts` → PASS (2 tests). If it FAILS, investigate the converter (a regression there would also break `notice`); do not patch the test.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/blocks/button-roundtrip.test.ts
git commit -m "test(core): button block round-trips byte-stably"
```

---

### Task 6: The token-themed `button` renderer in `@setu/blocks`

**Files:**
- Create: `packages/blocks/src/button/Button.astro`, `packages/blocks/src/button/button.css`
- Modify: `packages/blocks/package.json`

**Interfaces:** Produces resolvable exports `@setu/blocks/button.astro`, `@setu/blocks/button.css`. Consumed by Tasks 8–9.

- [ ] **Step 1: Create the renderer + token-themed CSS**

`packages/blocks/src/button/Button.astro`:

```astro
---
import './button.css'
const { href, variant = 'primary' } = Astro.props
---

<a href={href} class={`setu-button setu-button--${variant}`}><slot /></a>
```

`packages/blocks/src/button/button.css` (token-themed, the callout.css pattern — picks up the active theme's tokens via the cascade, with safe fallbacks):

```css
.setu-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.25rem;
  border-radius: var(--radius, 8px);
  font-weight: 600;
  text-decoration: none;
  transition: opacity 0.15s ease;
}
.setu-button--primary {
  background: var(--accent, #4f46e5);
  color: var(--accent-contrast, #ffffff);
}
.setu-button--secondary {
  background: transparent;
  color: var(--accent, #4f46e5);
  border: 1px solid var(--accent, #4f46e5);
}
.setu-button:hover {
  opacity: 0.9;
}
```

- [ ] **Step 2: Add the package exports** — modify `packages/blocks/package.json` `exports`:

```json
"exports": {
  ".": "./src/index.ts",
  "./callout.css": "./src/callout/callout.css",
  "./notice.css": "./src/notice/notice.css",
  "./button.astro": "./src/button/Button.astro",
  "./button.css": "./src/button/button.css"
},
```

- [ ] **Step 3: Verify the export resolves from the site app**

```bash
node -e "const {createRequire}=require('node:module'); const r=createRequire('/Users/mayank/Documents/projects/setu/.claude/worktrees/block-library-foundation-b/apps/site/package.json'); console.log(r.resolve('@setu/blocks/button.astro')); console.log('ok')"
```

Expected: a resolved file path, then `ok` (the same resolution `gen-blocks`/the site build performs).

- [ ] **Step 4: Commit**

```bash
git add packages/blocks/src/button packages/blocks/package.json
git commit -m "feat(blocks): token-themed button renderer"
```

---

### Task 7: Union `STANDARD_BLOCKS` into the admin registry

**Files:**
- Modify: `apps/admin/src/blocks/registry.ts`
- Test: `apps/admin/src/blocks/registry.test.ts`

**Interfaces:** Consumes `buildRegistry`, `mergeBlockSources`, `STANDARD_BLOCKS` from `@setu/core`. Produces an admin `registry` whose `blocks`/`blocksByTag`/`knownBlockTags` include `button`. `slashBlocks()` and the round-trip pick it up unchanged.

- [ ] **Step 1: Write the failing test** — create `apps/admin/src/blocks/registry.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/admin exec vitest run src/blocks/registry.test.ts` → FAIL (`button` not in registry).

- [ ] **Step 3: Write minimal implementation** — modify `apps/admin/src/blocks/registry.ts`:

```ts
// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (each block.ts default-exports a BlockContract) into the bundle; we pair it with the
// folder name to build the registry. Path is relative to THIS file: blocks -> src ->
// admin -> apps -> repo root. blocks/ is outside the admin root, so the dev server must
// allow it (see vite.config.ts server.fs.allow).
import { buildRegistry, mergeBlockSources, STANDARD_BLOCKS } from '@setu/core'
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

// Union core standard blocks with site-local folder blocks; local wins on a tag collision.
export const registry: BlockRegistry = buildRegistry(mergeBlockSources({ standard: STANDARD_BLOCKS, local }))

// `image` has a dedicated editor node (ImageBlock) but is NOT a folder block — its render
// needs apps/site's build-time manifest read (#5a). Register it as a known editor tag so the
// round-trip maps {% image %} to the imageBlock node instead of a passthrough.
registry.knownBlockTags.add('image')
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @setu/admin exec vitest run src/blocks/registry.test.ts` → PASS (3 tests).

- [ ] **Step 5: Run the full admin suite** — `pnpm --filter @setu/admin test` → PASS (existing tests green; the slash menu now also lists `button` under Layout).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/blocks/registry.ts apps/admin/src/blocks/registry.test.ts
git commit -m "feat(admin): surface STANDARD_BLOCKS (button) in the editor registry"
```

---

### Task 8: Include `STANDARD_BLOCKS` in the site codegen

**Files:** Modify: `scripts/gen-blocks.mjs`

**Interfaces:** Consumes `buildRegistry`, `mergeBlockSources`, `STANDARD_BLOCKS` from `@setu/core`; `generateMarkdocTagsInclude` from `@setu/core/node`. Produces a regenerated `apps/site/markdoc.blocks.generated.mjs` containing `button` → its `@setu/blocks` renderer.

- [ ] **Step 1: Update the codegen entrypoint** — modify `scripts/gen-blocks.mjs`, replacing the `main()` function (keep imports, `ROOT`/`BLOCKS_DIR`/`OUT`, the jiti alias block, and `loadEntries()` unchanged):

```js
export async function main() {
  const { buildRegistry, mergeBlockSources, STANDARD_BLOCKS } = await jiti.import('@setu/core')
  const { generateMarkdocTagsInclude } = await jiti.import('@setu/core/node')

  const local = await loadEntries()
  const entries = mergeBlockSources({ standard: STANDARD_BLOCKS, local })
  const registry = buildRegistry(entries)
  writeFileSync(OUT, generateMarkdocTagsInclude(registry))
  console.log(`gen-blocks: ${registry.blocks.length} block(s): ${registry.blocks.map((b) => b.tag).join(', ') || '(none)'}`)
}
```

- [ ] **Step 2: Run the codegen and verify the output** — `node scripts/gen-blocks.mjs && cat apps/site/markdoc.blocks.generated.mjs`

Expected: console prints `gen-blocks: 3 block(s): button, callout, notice`, and the file contains:

```js
  button: {
    render: component('@setu/blocks/button.astro'),
    attributes: { href: { type: String }, variant: { type: String, matches: ["primary","secondary"], default: "primary" } },
  },
```

(plus unchanged `callout`/`notice` with their `../../blocks/...` paths).

- [ ] **Step 3: Commit (including the regenerated file)**

```bash
git add scripts/gen-blocks.mjs apps/site/markdoc.blocks.generated.mjs
git commit -m "feat(site): gen-blocks includes core standard blocks (button)"
```

---

### Task 9: End-to-end render proof + full green

**Files:**
- Modify: `content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:** Consumes the full pipeline (the site build runs `gen-blocks` as `prebuild`). Produces a rendered `button` in the built site.

- [ ] **Step 1: Add a button to the kitchen-sink fixture** — in `content/post/en/kitchen-sink.mdoc`, add immediately after the existing `{% /notice %}` block (around line 21):

```
{% button href="/signup" variant="primary" %}Get started{% /button %}
```

- [ ] **Step 2: Write the failing render assertion** — in `apps/site/test/render.test.ts`, add inside `describe('render pipeline — standard nodes', ...)` (after the link test):

```ts
  it('renders a button block (token-themed)', () => {
    expect(html).toContain('class="setu-button setu-button--primary"')
    expect(html).toContain('href="/signup"')
    expect(html).toContain('Get started')
  })
```

- [ ] **Step 3: Run the site suite** — `pnpm --filter @setu/site test` → PASS. The suite runs `pnpm build` (→ `gen-blocks` → `button` resolves to the `@setu/blocks` renderer → renders `<a class="setu-button setu-button--primary" href="/signup">Get started</a>`, token-styled via the theme's `--accent`).

> **Contingency (only if the build fails to resolve `@setu/blocks/button.astro`):** Astro's `component()` could not resolve the bare specifier. Fix in `scripts/gen-blocks.mjs` Step 1 by resolving the renderer to an absolute path before passing it through — wrap with `createRequire(path.join(ROOT,'apps','site','package.json')).resolve(...)` for each `STANDARD_BLOCKS` renderer, and in `generate-markdoc.ts` treat an absolute path (`startsWith('/')`) like a bare specifier (emit as-is). Re-run. Absolute paths import via the already-present `server.fs.allow: ['../..']`.

- [ ] **Step 4: Run the whole repo green** — `pnpm -r test && pnpm -r typecheck` → PASS across core, blocks, admin, site, and all typechecks (incl. core edge typecheck).

- [ ] **Step 5: Commit**

```bash
git add content/post/en/kitchen-sink.mdoc apps/site/test/render.test.ts
git commit -m "test(site): button renders end-to-end (token-themed)"
```

---

## Verification summary (what "done" proves)

- **Ships from core:** `button`'s contract lives in `@setu/core` (`STANDARD_BLOCKS`), edge-safe (Tasks 1, 3).
- **Themed like callout:** one token-themed renderer in `@setu/blocks` (Task 6); renders branded on the site via theme tokens (Task 9).
- **Both flows wired:** admin registry (Task 7) and site codegen (Task 8) union core + site-local; site-local still wins (Task 2).
- **Backward compatible:** callout/notice unchanged and green (Tasks 7, 9); `button` round-trips byte-stably (Task 5).
