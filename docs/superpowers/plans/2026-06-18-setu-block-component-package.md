# Block Component Package (sub-project #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "write once" loop for the callout — a new `@setu/blocks` package holds the callout's single React visual core, rendered by *both* the editor node view and the site `.astro` wrapper, killing today's duplicate.

**Architecture:** `packages/blocks` exports a `Callout` core (structure + classes + slots), a block icon set (`BlockIcon`), the variant mapping (moved from the admin), and a token-fallback `callout.css`. The editor's Tiptap node view wraps the core (injecting the editable title input, `NodeViewContent` body, and its tone/icon toolbar) — the node *definition* and round-trip stay byte-identical. The site wrapper renders the same core.

**Tech Stack:** React 18 · TypeScript (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`) · `@setu/core` (variants) · Vitest + jsdom + Testing Library. Consumed by `@setu/admin` (Vite/Tiptap) and `@setu/site` (Astro/Vite).

## Global Constraints

- **`@setu/blocks` exports TS source** (`main`/`types` → `./src/index.ts`, like `@setu/core`) + a CSS export `./callout.css`. `react` is a **peerDependency** (`^18.3.1`); consumers provide React (no duplicate React).
- **Pin to the suite:** `react`/`react-dom` `^18.3.1`, `@types/react` `^18.3.31`, `@testing-library/react` `^16.1.0`, `jsdom` `^25.0.1`, `vitest` `^2.1.8`, `typescript` `^5.6.3` (`@types/react-dom` ^18.3.1, align with admin if it pins differently).
- **Class-name contract = the editor's EXISTING names** (`blk-callout`, `tone-{tone}`, `callout-head`, `callout-ic`, `callout-title`, `callout-body`). Do NOT invent new names.
- **The editor's `Callout` Node.create definition stays BYTE-UNCHANGED** (name/group/content/`defining`/`mdAttrs` attr with `renderHTML:()=>({})`+`parseHTML`/`renderHTML` `div[data-callout]`/`addKeyboardShortcuts` ArrowUp/the title-input ArrowDown+Enter nav/`setAttrs` empty-key hygiene). Only `CalloutView`'s JSX is re-sourced. **The round-trip guard test is the hard gate** — it must stay green.
- **No changes to `packages/core`** or any content write / Markdoc round-trip path. This is read-only-equivalent on content.
- **Tokens/theme = #3.** `callout.css` styles via `var(--token, FALLBACK)`; build no token system. **Only the callout** is touched (no other blocks, no codegen).
- **Already verified (don't re-verify):** an Astro component can import `@setu/core` and build to static HTML, so `@setu/blocks` → `@setu/core` works in the site.
- Final state must be `pnpm -r test` green (core 175, admin 178 incl. the round-trip guard, site updated, + new `@setu/blocks` tests) and both apps build.

---

## File Structure

```
packages/blocks/                      NEW @setu/blocks
  package.json                        TS-source export + ./callout.css export; react peer
  tsconfig.json                       extends ../../tsconfig.base.json; DOM lib; react-jsx
  vitest.config.ts                    jsdom + globals + setup
  test/setup.ts                       @testing-library/jest-dom/vitest
  src/
    index.ts                          barrel
    icons/
      svgs.ts                         BLOCK_ICON_SVGS (8 paths) + BlockIconName + isBlockIconName
      BlockIcon.tsx                   <BlockIcon name size stroke className>
    callout/
      variants.ts                     variantFor / calloutVariants / CALLOUT_ICONS / CalloutVariant
      Callout.tsx                     the visual core (aside + head + slots)
      callout.css                     structural + tone CSS via var(--token, fallback)
  test/
    block-icon.test.tsx               Task 1
    variants.test.ts                  Task 2
    callout.test.tsx                  Task 3

apps/admin/                     editor adoption (Task 4)
  src/editor/extensions/Callout.tsx   CalloutView re-sourced to render <Callout>; Node def unchanged
  src/editor/callout-variants.ts      DELETED (moved to @setu/blocks); importers repointed
  src/styles/editor.css               structural callout rules removed; chrome (.block-props/.bp-*) kept
  package.json                        + @setu/blocks dep

apps/site/                      site adoption (Task 5)
  src/components/CalloutWrapper.astro renders <Callout> from @setu/blocks
  src/components/Callout.tsx          DELETED
  src/styles/site.css                 old .callout/.callout--*/.callout__* removed
  test/render.test.ts                 callout assertions updated to unified markup
  package.json                        + @setu/blocks dep
```

---

### Task 1: Scaffold `@setu/blocks` + the block icon set

**Files:**
- Create: `packages/blocks/package.json`, `tsconfig.json`, `vitest.config.ts`, `test/setup.ts`, `src/icons/svgs.ts`, `src/icons/BlockIcon.tsx`, `src/index.ts`
- Test: `packages/blocks/test/block-icon.test.tsx`
- Run: `pnpm install` (root) after creating the package

**Interfaces:**
- Produces: `BlockIcon` (React component `{name: BlockIconName, size?: number, stroke?: number, className?: string}`), `BlockIconName` (union of the 8 names), `isBlockIconName(s: string): s is BlockIconName`, `BLOCK_ICON_SVGS` (record).

- [ ] **Step 1: `packages/blocks/package.json`**

```json
{
  "name": "@setu/blocks",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./callout.css": "./src/callout/callout.css"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^18.3.1" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.31",
    "@types/react-dom": "^18.3.1",
    "jsdom": "^25.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```
(If `@testing-library/jest-dom` is already pinned elsewhere in the workspace, match that exact version.)

- [ ] **Step 2: configs**

`packages/blocks/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test"]
}
```

`packages/blocks/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
```

`packages/blocks/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: `packages/blocks/src/icons/svgs.ts`** — the 8 block-icon SVGs, copied verbatim from `apps/admin/src/ui/Icon.tsx`

```ts
/** Block icons — inner SVG markup for the icons blocks use (curated subset of the
 *  admin's icon set). Source of truth for BLOCK icons; the admin's full Icon serves
 *  app chrome. Static, trusted, in-repo design assets. */
export const BLOCK_ICON_SVGS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/>',
  sparkle:
    '<path d="M12 3l1.7 4.8L18.5 9.5 13.7 11.2 12 16l-1.7-4.8L5.5 9.5l4.8-1.7z"/><path d="M19 14l.6 1.7L21.3 16.3 19.6 17l-.6 1.7L18.4 17l-1.7-.7 1.7-.6z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert:
    '<path d="M10.3 3.8 1.8 18a1.5 1.5 0 0 0 1.3 2.2h17.8a1.5 1.5 0 0 0 1.3-2.2L13.7 3.8a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9v4M12 17h.01"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 8.4 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/>',
} as const

export type BlockIconName = keyof typeof BLOCK_ICON_SVGS

export function isBlockIconName(name: string): name is BlockIconName {
  return Object.prototype.hasOwnProperty.call(BLOCK_ICON_SVGS, name)
}
```

- [ ] **Step 4: `packages/blocks/src/icons/BlockIcon.tsx`** (mirrors the admin `Icon` SVG wrapper)

```tsx
import { BLOCK_ICON_SVGS } from './svgs'
import type { BlockIconName } from './svgs'

export function BlockIcon({
  name,
  size = 18,
  stroke = 1.75,
  className = '',
}: {
  name: BlockIconName
  size?: number
  stroke?: number
  className?: string
}) {
  const d = BLOCK_ICON_SVGS[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      // Static, trusted, in-repo design asset (never user input) — safe to inject.
      dangerouslySetInnerHTML={{ __html: d }}
      aria-hidden="true"
    />
  )
}
```

- [ ] **Step 5: `packages/blocks/src/index.ts`** (partial barrel; later tasks extend)

```ts
export { BlockIcon } from './icons/BlockIcon'
export { isBlockIconName, BLOCK_ICON_SVGS } from './icons/svgs'
export type { BlockIconName } from './icons/svgs'
```

- [ ] **Step 6: Write the failing test `packages/blocks/test/block-icon.test.tsx`**

```tsx
import { render } from '@testing-library/react'
import { BlockIcon } from '../src/icons/BlockIcon'
import { isBlockIconName } from '../src/icons/svgs'

test('renders an svg with the named icon inner markup', () => {
  const { container } = render(<BlockIcon name="check" />)
  const svg = container.querySelector('svg')
  expect(svg).toBeTruthy()
  expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
  expect(svg?.innerHTML).toContain('M20 6 9 17l-5-5')
})

test('isBlockIconName narrows known/unknown names', () => {
  expect(isBlockIconName('alert')).toBe(true)
  expect(isBlockIconName('definitely-not-an-icon')).toBe(false)
})
```

- [ ] **Step 7: Run `pnpm install` then the test to verify it fails, then passes**

Run: `pnpm install` (root), then `pnpm --filter @setu/blocks test`
Expected: after Steps 1–6, PASS (2 tests). (Before the source files exist it errors/fails.)

- [ ] **Step 8: Commit**

```bash
git add packages/blocks pnpm-lock.yaml
git commit -m "feat(blocks): scaffold @setu/blocks + block icon set"
```

---

### Task 2: Variant mapping (moved from the admin)

**Files:**
- Create: `packages/blocks/src/callout/variants.ts`
- Modify: `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/variants.test.ts`

**Interfaces:**
- Consumes: `BlockIconName` (Task 1); `resolveConfig`, `defaultConfig` from `@setu/core`.
- Produces: `CalloutVariant` (`{type: string; label: string; tone: string; icon: BlockIconName}`), `variantFor(type: string): CalloutVariant`, `calloutVariants(): CalloutVariant[]`, `CALLOUT_ICONS: BlockIconName[]`.

- [ ] **Step 1: Write the failing test `packages/blocks/test/variants.test.ts`**

```ts
import { variantFor, calloutVariants, CALLOUT_ICONS } from '../src/callout/variants'

test('variantFor maps a known type to tone + icon', () => {
  expect(variantFor('warning')).toEqual({ type: 'warning', label: 'Warning', tone: 'amber', icon: 'alert' })
})

test('variantFor neutral-fallbacks an unknown type (keeps the raw type)', () => {
  const v = variantFor('mystery')
  expect(v.type).toBe('mystery')
  expect(v.tone).toBe('neutral')
  expect(v.icon).toBe('sparkle')
})

test('calloutVariants reflects the default config variant list', () => {
  expect(calloutVariants().map((v) => v.type)).toEqual(['info', 'note', 'success', 'warning', 'danger', 'neutral'])
})

test('CALLOUT_ICONS is the curated picker set', () => {
  expect(CALLOUT_ICONS).toEqual(['info', 'check', 'alert', 'sparkle', 'zap', 'pin', 'lock', 'settings'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/blocks test variants`
Expected: FAIL (`variants` module not found).

- [ ] **Step 3: Implement `packages/blocks/src/callout/variants.ts`**

```ts
import type { BlockIconName } from '../icons/svgs'
import { defaultConfig, resolveConfig } from '@setu/core'

export interface CalloutVariant {
  type: string
  label: string
  /** CSS tone suffix: accent | green | amber | red | slate | neutral. */
  tone: string
  /** Default icon for the type (the default-theme mapping). */
  icon: BlockIconName
}

const VARIANT_MAP: Record<string, { label: string; tone: string; icon: BlockIconName }> = {
  info: { label: 'Info', tone: 'accent', icon: 'info' },
  note: { label: 'Note', tone: 'neutral', icon: 'sparkle' },
  success: { label: 'Success', tone: 'green', icon: 'check' },
  warning: { label: 'Warning', tone: 'amber', icon: 'alert' },
  danger: { label: 'Danger', tone: 'red', icon: 'alert' },
  neutral: { label: 'Neutral', tone: 'neutral', icon: 'sparkle' },
}

const NEUTRAL = { label: 'Neutral', tone: 'neutral', icon: 'sparkle' as BlockIconName }

/** Icons offered in the callout icon-override picker (curated). */
export const CALLOUT_ICONS: BlockIconName[] = ['info', 'check', 'alert', 'sparkle', 'zap', 'pin', 'lock', 'settings']

function configVariantTypes(): string[] {
  const callout = resolveConfig(defaultConfig).blocksByTag.get('callout')
  const variants = callout?.editor?.variants
  return Array.isArray(variants) && variants.length ? variants : Object.keys(VARIANT_MAP)
}

export function variantFor(type: string): CalloutVariant {
  const v = VARIANT_MAP[type] ?? NEUTRAL
  return { type, label: v.label, tone: v.tone, icon: v.icon }
}

export function calloutVariants(): CalloutVariant[] {
  return configVariantTypes().map(variantFor)
}
```

- [ ] **Step 4: Extend the barrel `packages/blocks/src/index.ts`** (add)

```ts
export { variantFor, calloutVariants, CALLOUT_ICONS } from './callout/variants'
export type { CalloutVariant } from './callout/variants'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @setu/blocks test`
Expected: PASS (Task 1 + Task 2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/blocks
git commit -m "feat(blocks): callout variant mapping (config-driven, BlockIconName)"
```

---

### Task 3: The `Callout` visual core + `callout.css`

**Files:**
- Create: `packages/blocks/src/callout/Callout.tsx`, `packages/blocks/src/callout/callout.css`
- Modify: `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/callout.test.tsx`

**Interfaces:**
- Consumes: `BlockIcon`, `BlockIconName` (Task 1).
- Produces: `Callout` (React component, props `{ tone: string; icon: BlockIconName; title?: ReactNode; toolbar?: ReactNode; children: ReactNode }`) rendering `<aside class="blk-callout tone-{tone}">{toolbar}<div class="callout-head"><span class="callout-ic"><BlockIcon/></span>{title}</div>{children}</aside>`. CSS export `@setu/blocks/callout.css`.

- [ ] **Step 1: Write the failing test `packages/blocks/test/callout.test.tsx`**

```tsx
import { render } from '@testing-library/react'
import { Callout } from '../src/callout/Callout'

test('renders the structure, tone class, icon badge, and slots in order', () => {
  const { container } = render(
    <Callout
      tone="amber"
      icon="alert"
      toolbar={<div data-testid="toolbar" />}
      title={<input className="callout-title" defaultValue="Heads up" />}
    >
      <div className="callout-body">Body</div>
    </Callout>,
  )
  const aside = container.querySelector('aside.blk-callout.tone-amber')
  expect(aside).toBeTruthy()
  // toolbar slot is first child, before the head
  expect(aside?.firstElementChild).toBe(container.querySelector('[data-testid="toolbar"]'))
  // icon badge renders an svg inside .callout-ic
  expect(container.querySelector('.callout-head .callout-ic svg')).toBeTruthy()
  // title slot lands in the head
  expect(container.querySelector('.callout-head input.callout-title')).toBeTruthy()
  // body children land after the head
  expect(container.querySelector('aside.blk-callout > .callout-body')?.textContent).toBe('Body')
})

test('omits toolbar/title when not provided', () => {
  const { container } = render(
    <Callout tone="accent" icon="info"><div className="callout-body" /></Callout>,
  )
  expect(container.querySelector('.callout-head input')).toBeNull()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/blocks test callout`
Expected: FAIL (`Callout` not found).

- [ ] **Step 3: Implement `packages/blocks/src/callout/Callout.tsx`**

```tsx
import type { ReactNode } from 'react'
import { BlockIcon } from '../icons/BlockIcon'
import type { BlockIconName } from '../icons/svgs'

interface CalloutProps {
  /** CSS tone suffix (accent | green | amber | red | slate | neutral). */
  tone: string
  /** Icon rendered into the .callout-ic badge by the core. */
  icon: BlockIconName
  /** Title slot: editor passes an <input class="callout-title">, site passes a static node. */
  title?: ReactNode
  /** Toolbar slot: editor passes its .block-props chrome, site passes nothing. */
  toolbar?: ReactNode
  /** The body element: editor passes <NodeViewContent class="callout-body">, site a <div>. */
  children: ReactNode
}

/** The single callout visual core — rendered by BOTH the editor node view and the site
 *  wrapper. Owns structure + class contract; consumers inject the editable/dynamic slots. */
export function Callout({ tone, icon, title, toolbar, children }: CalloutProps) {
  return (
    <aside className={`blk-callout tone-${tone}`} aria-label="Callout block">
      {toolbar}
      <div className="callout-head">
        <span className="callout-ic">
          <BlockIcon name={icon} size={18} />
        </span>
        {title}
      </div>
      {children}
    </aside>
  )
}
```

- [ ] **Step 4: Implement `packages/blocks/src/callout/callout.css`** (structural + tone, token-fallback)

```css
/* Callout structural + tone styles. Themeless-safe via var(--token, fallback): the admin
   provides the tokens (themed/dark-mode), the site uses the fallbacks until #3 tokenizes it.
   Editor-only chrome (.block-props/.bp-*) lives in the admin's editor.css, not here. */
.blk-callout { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 15px 16px; border-radius: var(--r-md, 10px); margin: 12px 0; font-family: var(--font-ui, system-ui, sans-serif); }
.blk-callout.tone-accent  { background: var(--accent-soft, #eef2ff); }
.blk-callout.tone-green   { background: var(--green-soft, #f0fdf4); }
.blk-callout.tone-amber   { background: var(--amber-soft, #fff7ed); }
.blk-callout.tone-red     { background: var(--red-soft, #fef2f2); }
.blk-callout.tone-neutral { background: var(--surface-2, #f3f4f6); }
.blk-callout.tone-slate   { background: color-mix(in oklch, var(--text, #111827) 88%, var(--bg, #fff)); color: #fff; }

.callout-head { display: flex; align-items: center; gap: 10px; }
.callout-ic { flex-shrink: 0; width: 30px; height: 30px; border-radius: var(--r-sm, 7px); display: grid; place-items: center; border: none; background: color-mix(in oklch, var(--canvas, #fff) 55%, transparent); }
.tone-accent  .callout-ic { color: var(--accent-strong, #4f46e5); }
.tone-green   .callout-ic { color: var(--green, #16a34a); }
.tone-amber   .callout-ic { color: var(--amber, #d97706); }
.tone-red     .callout-ic { color: var(--red, #dc2626); }
.tone-neutral .callout-ic { color: var(--text-2, #4b5563); }
.tone-slate   .callout-ic { color: #fff; background: color-mix(in oklch, #fff 16%, transparent); }

.callout-title { flex: 1; min-width: 0; border: none; background: transparent; outline: none; font-family: var(--font-ui, system-ui, sans-serif); font-size: 18px; font-weight: 700; letter-spacing: -.01em; color: inherit; padding: 0; }

.callout-body { font-size: 16px; line-height: 1.6; color: inherit; outline: none; }
.callout-body p { font-size: 16px; line-height: 1.6; margin: 0; padding: 2px 0; color: inherit; }
.callout-body > [data-node-view-content-react] { min-width: 0; }
```

- [ ] **Step 5: Extend the barrel `packages/blocks/src/index.ts`** (add)

```ts
export { Callout } from './callout/Callout'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @setu/blocks test`
Expected: PASS (all `@setu/blocks` tests). Also run `pnpm --filter @setu/blocks typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/blocks
git commit -m "feat(blocks): Callout visual core + token-fallback callout.css"
```

---

### Task 4: Editor adoption — render the shared core, node definition unchanged

**Files:**
- Modify: `apps/admin/src/editor/extensions/Callout.tsx`, `apps/admin/src/styles/editor.css`, `apps/admin/package.json`
- Delete: `apps/admin/src/editor/callout-variants.ts` (repoint importers)

**Interfaces:**
- Consumes: `Callout`, `BlockIcon`, `variantFor`, `calloutVariants`, `CALLOUT_ICONS`, `isBlockIconName`, `BlockIconName` from `@setu/blocks`.

- [ ] **Step 1: Add the dependency**

In `apps/admin/package.json` `dependencies`, add `"@setu/blocks": "workspace:*"`. Run `pnpm install` (root).

- [ ] **Step 2: Find importers of the old variants module**

Run: `grep -rn "callout-variants" apps/admin/src`
Expected importers: `src/editor/extensions/Callout.tsx` (known). Repoint every hit to `@setu/blocks` in the following steps, then the file is deleted.

- [ ] **Step 3: Re-source `CalloutView` in `apps/admin/src/editor/extensions/Callout.tsx`**

Change the imports at the top — replace the `calloutVariants`/`variantFor`/`CALLOUT_ICONS` import from `'../callout-variants'` and the `Icon`/`IconName`/`isIconName` imports used for the callout with `@setu/blocks`:
```tsx
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Callout as CalloutCore, BlockIcon, variantFor, calloutVariants, CALLOUT_ICONS, isBlockIconName } from '@setu/blocks'
import type { BlockIconName } from '@setu/blocks'
import { useToolbarRoving } from '../useToolbarRoving'
```
Replace the **body** of `CalloutView` (the `return (...)`) with the shared core, keeping the same data flow (`mdAttrs`, `setAttrs`, `variant`, `icon`, the title input, the toolbar, `NodeViewContent`). Keep `focusTitleAtBodyStart` and everything above the `return` unchanged except the icon type:
```tsx
function CalloutView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const type = String(mdAttrs['type'] ?? 'info')
  const title = String(mdAttrs['title'] ?? '')
  const variant = variantFor(type)
  const overrideIcon = mdAttrs['icon']
  const icon: BlockIconName =
    typeof overrideIcon === 'string' && isBlockIconName(overrideIcon) ? overrideIcon : variant.icon

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['title'] === '') delete next['title']
    if (next['icon'] === '') delete next['icon']
    updateAttributes({ mdAttrs: next })
  }

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()

  const toolbar = (
    <div
      className="block-props"
      contentEditable={false}
      role="toolbar"
      aria-label="Callout style"
      ref={toolbarRef}
      onKeyDown={(e) => {
        onToolbarKeyDown(e)
        if (e.key === 'Escape') {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos === 'number') {
            editor.chain().setTextSelection(pos + 2).run()
            editor.view.focus()
          }
        }
      }}
    >
      <span className="bp-label">Tone</span>
      {calloutVariants().map((v) => (
        <button
          key={v.type}
          type="button"
          className={`bp-swatch tone-${v.tone}${type === v.type ? ' on' : ''}`}
          title={v.label}
          aria-label={v.label}
          data-toolbar-item
          onMouseDown={keepFocus}
          onClick={() => setAttrs({ type: v.type })}
        />
      ))}
      <span className="bp-sep" />
      {CALLOUT_ICONS.map((ic) => (
        <button
          key={ic}
          type="button"
          className={`bp-icon${icon === ic ? ' on' : ''}`}
          title={ic}
          aria-label={`Icon ${ic}`}
          data-toolbar-item
          onMouseDown={keepFocus}
          onClick={() => setAttrs({ icon: ic })}
        >
          <BlockIcon name={ic} size={15} />
        </button>
      ))}
    </div>
  )

  const titleInput = (
    <input
      className="callout-title"
      placeholder="Add a title…"
      value={title}
      onChange={(e) => setAttrs({ title: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos === 'number') {
            editor.chain().setTextSelection(pos + 2).run()
            editor.view.focus()
          }
          return
        }
        e.stopPropagation()
      }}
    />
  )

  return (
    <NodeViewWrapper>
      <CalloutCore tone={variant.tone} icon={icon} toolbar={toolbar} title={titleInput}>
        <NodeViewContent className="callout-body" />
      </CalloutCore>
    </NodeViewWrapper>
  )
}
```
Notes:
- The `.callout-head` is no longer hand-written here — the core renders it (icon badge + the `title` slot). The previous `contentEditable={false}` on the head is now the core's responsibility for the head wrapper; if the editor needs the head non-editable, add `contentEditable={false}` to the head inside the core is NOT allowed (core is shared) — instead the title input + icon are inert by nature and the body is the only editable region (`NodeViewContent`). Verify caret behavior in Step 6; if ProseMirror tries to place a caret in the head, wrap the head pieces appropriately in the editor by passing a wrapper around `titleInput` — but first confirm whether it's actually a problem (the input captures focus; the icon is an svg).
- **The `Node.create({...})` definition below `CalloutView` is UNCHANGED. Do not touch it.**

- [ ] **Step 4: Verify the Tiptap integration (the one real API risk)**

Run the admin's existing callout + round-trip tests:
Run: `pnpm --filter @setu/admin test`
Expected: PASS — the existing callout node tests and the **round-trip guard** (`tiptapToMarkdoc(getJSON()) === source`) stay green, proving `NodeViewContent` still functions as the editable body when nested as `children` of the shared core inside `NodeViewWrapper`.
**Fallback if NodeViewContent must NOT be nested via children:** keep `NodeViewWrapper` as the root and render `<CalloutCore … />` with the body, but if Tiptap rejects the deep nesting, pass the body to the core differently — render the core for the head only and place `<NodeViewContent className="callout-body" />` as a sibling immediately after the head inside an `<aside className={`blk-callout tone-${tone}`}>` you construct in the editor (i.e. the core exposes a head-only sub-render). Only do this if Step 4 fails; default is the nested-children form above.

- [ ] **Step 5: Move callout structural CSS; delete the variants module**

In `apps/admin/src/styles/editor.css`, **remove** the structural callout rules now owned by the package: `.blk-callout` (and its `.tone-*` background variants), `.callout-head`, `.callout-ic` (+ its `.tone-* .callout-ic` color rules), `.callout-title` (the base rule), `.callout-body` (+ `.callout-body p` + the `[data-node-view-content-react]` rule). **Keep** the editor-only chrome: `.block-props`, `.bp-label`, `.bp-swatch` (+ tones), `.bp-sep`, `.bp-icon`, the `.blk-callout:focus-within .block-props` rule, and the `.callout-title::placeholder` rules (input-only). Then import the package CSS once where the editor styles are loaded (e.g. at the top of `editor.css`):
```css
@import '@setu/blocks/callout.css';
```
(If a CSS `@import` of a package subpath does not resolve under the admin's Vite/Tailwind v4 setup, instead `import '@setu/blocks/callout.css'` from the editor's entry module — match however the admin already loads `editor.css`. Verify the callout renders styled in Step 6.)

Delete `apps/admin/src/editor/callout-variants.ts`. Re-confirm no importers remain:
Run: `grep -rn "callout-variants" apps/admin/src` → expected: no matches.

- [ ] **Step 6: Run tests + typecheck + a build**

Run: `pnpm --filter @setu/admin test` → PASS (178, unchanged count; round-trip guard green).
Run: `pnpm --filter @setu/admin build` → succeeds (confirms `@setu/blocks` + its CSS resolve through Vite, and verbatimModuleSyntax/noUncheckedIndexedAccess are clean).
Manual UAT note for the controller: load the editor, confirm the callout looks the same (icon badge, title, tones, the focus toolbar) and round-trips.

- [ ] **Step 7: Commit**

```bash
git add apps/admin
git commit -m "refactor(admin): callout view renders the shared @setu/blocks core (node def unchanged)"
```

---

### Task 5: Site adoption — render the shared core, delete the duplicate

**Files:**
- Modify: `apps/site/src/components/CalloutWrapper.astro`, `apps/site/src/styles/site.css`, `apps/site/package.json`, `apps/site/test/render.test.ts`
- Delete: `apps/site/src/components/Callout.tsx`

**Interfaces:**
- Consumes: `Callout`, `variantFor` from `@setu/blocks`.

- [ ] **Step 1: Add the dependency**

In `apps/site/package.json` `dependencies`, add `"@setu/blocks": "workspace:*"`. Run `pnpm install` (root).

- [ ] **Step 2: Rewrite `apps/site/src/components/CalloutWrapper.astro`**

```astro
---
import { Callout, variantFor } from '@setu/blocks'
import '@setu/blocks/callout.css'

const { type = 'info', title } = Astro.props
const variant = variantFor(String(type))
---

<Callout tone={variant.tone} icon={variant.icon} title={title ? <span class="callout-title">{title}</span> : undefined}>
  <div class="callout-body"><slot /></div>
</Callout>
```
(`Callout` is a React component rendered statically by Astro — no `client:*` directive, so the page stays zero-JS, exactly as in #1.)

- [ ] **Step 3: Delete the site's own callout core + its CSS**

Delete `apps/site/src/components/Callout.tsx`. In `apps/site/src/styles/site.css`, **remove** the `.callout`, `.callout--warning`, `.callout--danger`, `.callout--success`, `.callout__title`, `.callout__body`, `.callout__body :last-child` rules (the package CSS now owns callout styling; it's imported by the wrapper in Step 2).

- [ ] **Step 4: Update the callout assertions in `apps/site/test/render.test.ts`**

Replace the `describe('render pipeline — callout', …)` assertions that referenced the old markup with the unified markup:
```ts
describe('render pipeline — callout', () => {
  it('renders the callout via the shared core with tone + title + body', () => {
    expect(html).toContain('class="blk-callout tone-amber"') // type="warning" -> amber tone
    expect(html).toContain('<span class="callout-ic">')
    expect(html).toContain('<svg') // a real icon, not the old 💡
    expect(html).toContain('Heads up') // the title
    expect(html).toContain('<strong>bold</strong>') // body markdown intact
  })
  it('ships zero JS for static content (no hydration island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```
If the exact emitted markup differs (e.g. attribute order, the icon badge nesting), inspect `apps/site/dist/post/kitchen-sink/index.html` and adjust the expected substrings to the real output — but keep asserting: the `blk-callout tone-amber` class, an `<svg>` icon (NOT `💡`), the title text, the body markdown, and zero-JS.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS (17 tests; callout now via the shared core, no `💡`, zero-JS holds).

- [ ] **Step 6: Commit**

```bash
git add apps/site
git commit -m "refactor(site): callout renders the shared @setu/blocks core; drop the duplicate"
```

---

### Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo test suite**

Run: `pnpm -r test`
Expected: every package green — `@setu/core` 175, `@setu/admin` 178 (incl. the round-trip guard), `@setu/site` 17, the new `@setu/blocks` tests, and all db/git suites.

- [ ] **Step 2: Both apps build**

Run: `pnpm --filter @setu/admin build && pnpm --filter @setu/site build`
Expected: both succeed (confirms `@setu/blocks` + its CSS resolve in Vite and Astro, no duplicate-React error).

- [ ] **Step 3: Scope guard**

Run: `git diff --name-only <branch-base>..HEAD | grep -vE '^(packages/blocks/|apps/admin/|apps/site/|pnpm-lock.yaml|package.json)' && echo "SCOPE VIOLATION" || echo "scope clean"`
(`<branch-base>` = the commit the worktree branched from.)
Expected: `scope clean` — no `packages/core/**` changes, no content write/round-trip path touched.

- [ ] **Step 4: Confirm the duplicate is gone**

Run: `test -f apps/site/src/components/Callout.tsx && echo "STILL EXISTS" || echo "site Callout.tsx removed ✓"` and `test -f apps/admin/src/editor/callout-variants.ts && echo "STILL EXISTS" || echo "admin callout-variants.ts removed ✓"`
Expected: both removed. The callout now has ONE visual core (`@setu/blocks`), rendered by both apps.

- [ ] **Step 5: Commit (if any verification fixups were needed; otherwise nothing to commit)**

```bash
git add -A && git commit -m "chore(blocks): final verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-setu-block-component-package-design.md`):
- §1 new `@setu/blocks` (Callout core T3, block icons T1, variant mapping T2, callout.css T3). ✓
- §2 package layout + TS-source export + `./callout.css` export + react peer: T1. ✓
- §3 core structure & slots (tone/icon/title/toolbar/children): T3. ✓
- §4 editor adoption (renders core, imports from blocks, deletes callout-variants.ts, CSS move, **node def unchanged**, round-trip guard): T4. ✓
- §4 site adoption (CalloutWrapper renders core, delete Callout.tsx, site.css, test update): T5. ✓
- §5 token-fallback CSS: T3 callout.css. ✓
- §6 testing (package units T1–T3; admin round-trip guard gate T4/T6; site build-and-assert T5; anti-drift structural). ✓
- §7 success criteria: T6 (whole-repo green, both build, scope clean, duplicate gone). ✓
- §8 risks: NodeViewContent-as-children verified in T4 Step 4 + fallback; class-name reuse; react peer; icon duplication accepted; site appearance shift (UAT). ✓

**2. Placeholder scan:** every code step has real code; commands have expected output. The two intentional *conditional* branches (T4 Step 4 NodeViewContent fallback; T4/T5 CSS-import resolution) are real verify-then-branch instructions with concrete fallbacks, not TBDs.

**3. Type consistency:** `BlockIconName` (T1) used by `variants.ts` (T2), `Callout` (T3), and the editor view (T4). `variantFor`/`calloutVariants`/`CALLOUT_ICONS` signatures identical across T2/T4/T5. `Callout` props `{tone, icon, title, toolbar, children}` identical T3/T4/T5. Class names (`blk-callout`/`tone-*`/`callout-head`/`callout-ic`/`callout-title`/`callout-body`) consistent across the core (T3), the CSS (T3), the editor (T4), the site (T5), and the test assertions. `isBlockIconName` (T1) used in T4. ✓
