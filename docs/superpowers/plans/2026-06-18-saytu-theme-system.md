# Theme System (sub-project #3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default theme an installable, config-activated package — extract its look into `@setu/theme-default`, add a `theme` field to `saytu.config`, and wire the site build to render through whichever theme the config names; the site looks **identical** to today.

**Architecture:** A new `packages/theme-default` holds the theme's `.astro` layouts + CSS (moved from `apps/saytu-site`). `@setu/core`'s config gains an additive `theme` field. `apps/saytu-site/astro.config.mjs` reads `saytu.config`'s `theme` (via core's Node `loadConfig`, jiti) and sets a Vite alias `@theme` → the active theme package; the pages import layouts from `@theme/…`. Render engine (routing/Markdoc/block components) stays in the app.

**Tech Stack:** Astro 6 · a new `@setu/theme-default` package (`.astro` + CSS, `astro` peerDep) · `@setu/core` config (`theme` field; `loadConfig` jiti) · Vite alias · Vitest. The mechanism is **spiked & proven** (theme-package `.astro` import; config-value-selects-theme via Vite alias).

## Global Constraints

- **No-regression is the headline gate:** the site's existing **27 render tests stay green UNCHANGED** — same HTML (shell, Post/Page templates, themed callout, prose, `lang`, zero-JS), now sourced from `@setu/theme-default`. Success = "looks identical, now swappable."
- **`@setu/core` change is additive config only** — an optional `theme?: string`. It must NOT touch the Markdoc converter / round-trip / content path; the existing **175 core tests + the edge guard stay green**.
- **Render engine stays in `apps/saytu-site`:** `content.config.ts`, `lib/url.ts`, `markdoc.config.mjs`, and the block components (`CalloutWrapper`/`Heading`/`Paragraph`/`Sub`/`Sup`/`Th`/`Td`) do NOT move. Only the theme's *look* (layouts + tokens + styles) moves.
- **No new external deps.** Theme = look only. `verbatimModuleSyntax` (`import type`) + strict TS clean.
- **Out of scope (do NOT build):** per-component/token override ("child themes"); the Customizer / theme-options panel (3c); a second shipped theme; dark mode; marketplace/registry; theme CLI.
- **Light-only, zero-JS** preserved (no `client:*`/script in any built page).

---

## File Structure

```
packages/core/src/config/
  types.ts             MODIFIED — `theme?: string` on SaytuConfig + ResolvedConfig
  schema.ts            MODIFIED — configSchema accepts optional `theme`
  resolve.ts           MODIFIED — pass `theme` through to ResolvedConfig
packages/core/test/config/
  theme-field.test.ts  NEW — theme present / omitted

packages/theme-default/        NEW @setu/theme-default
  package.json                 exports each layout + css; astro peerDep
  Layout.astro                 moved from apps/saytu-site/src/layouts/Layout.astro
  PostLayout.astro             moved from src/layouts/PostLayout.astro
  PageLayout.astro             moved from src/layouts/PageLayout.astro
  theme.css                    moved from src/styles/theme.css
  site.css                     moved from src/styles/site.css

apps/saytu-site/
  saytu.config.ts              NEW — { blocks: defaultConfig.blocks, theme: '@setu/theme-default' }
  astro.config.mjs             MODIFIED — read theme + alias '@theme'
  package.json                 MODIFIED — + @setu/theme-default + @setu/core deps
  src/pages/[...path].astro    MODIFIED — import layouts from '@theme/…'
  src/pages/index.astro        MODIFIED — import PageLayout from '@theme/…'
  src/layouts/*.astro          DELETED (now in the package)
  src/styles/{theme,site}.css  DELETED (now in the package)
```

---

### Task 1: `@setu/core` — add the `theme` config field

**Files:**
- Modify: `packages/core/src/config/types.ts`, `packages/core/src/config/schema.ts`, `packages/core/src/config/resolve.ts`
- Test: `packages/core/test/config/theme-field.test.ts`

**Interfaces:**
- Produces: `SaytuConfig.theme?: string`, `ResolvedConfig.theme?: string`; `resolveConfig(raw)` returns `theme` from the validated input; `loadConfig(path)` (unchanged code) therefore returns `theme` too.

- [ ] **Step 1: Write the failing test `packages/core/test/config/theme-field.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../../src/config/resolve'

describe('config theme field', () => {
  it('passes the theme field through to the resolved config', () => {
    const r = resolveConfig({ blocks: [], theme: '@setu/theme-default' })
    expect(r.theme).toBe('@setu/theme-default')
  })
  it('leaves theme undefined when omitted (back-compat with blocks-only configs)', () => {
    const r = resolveConfig({ blocks: [] })
    expect(r.theme).toBeUndefined()
  })
})
```
(If the existing config tests in `test/config/` rely on Vitest globals instead of explicit imports, match that style — drop the `import { describe, it, expect }` line.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/core test theme-field`
Expected: FAIL — `r.theme` is `undefined` in the first case (schema strips the unknown key, resolve doesn't return it).

- [ ] **Step 3: Add `theme` to the types — `packages/core/src/config/types.ts`**

In `interface SaytuConfig`, add the field:
```ts
export interface SaytuConfig {
  blocks: BlockDefinition[]
  /** The active theme's package name (e.g. '@setu/theme-default'). Optional. */
  theme?: string
}
```
In `interface ResolvedConfig`, add:
```ts
export interface ResolvedConfig {
  blocks: ResolvedBlock[]
  blocksByTag: Map<string, ResolvedBlock>
  knownBlockTags: Set<string>
  /** The active theme's package name, passed through from the authored config. */
  theme?: string
}
```

- [ ] **Step 4: Accept `theme` in the schema — `packages/core/src/config/schema.ts`**

Change `configSchema` to:
```ts
export const configSchema = z.object({
  blocks: z.array(blockSchema),
  theme: z.string().optional(),
})
```

- [ ] **Step 5: Pass `theme` through in `packages/core/src/config/resolve.ts`**

In the `return` of `resolveConfig`, add `theme`:
```ts
  return { blocks, blocksByTag, knownBlockTags: new Set(blocksByTag.keys()), theme: parsed.data.theme }
```

- [ ] **Step 6: Run the test + the full core suite + edge guard**

Run: `pnpm --filter @setu/core test`
Expected: PASS — the 2 new tests + all existing (175 → 177) green.
Run: `pnpm --filter @setu/core typecheck`
Expected: clean (incl. the edge guard `tsconfig.edge.json` — `theme` is a plain string, no Node/DOM types).

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add optional theme field to saytu.config"
```

---

### Task 2: Create `@setu/theme-default` (copy the theme files; site still uses its own)

**Files:**
- Create: `packages/theme-default/package.json`, `packages/theme-default/{Layout,PostLayout,PageLayout}.astro`, `packages/theme-default/{theme,site}.css`
- Modify: `apps/saytu-site/package.json`
- Run: `pnpm install`

**Interfaces:**
- Produces: package `@setu/theme-default` exporting `./Layout.astro`, `./PostLayout.astro`, `./PageLayout.astro`, `./theme.css`, `./site.css`.

- [ ] **Step 1: Copy the five theme files into `packages/theme-default/`**

Copy **verbatim** (content unchanged) into the package root:
- `apps/saytu-site/src/layouts/Layout.astro` → `packages/theme-default/Layout.astro`
- `apps/saytu-site/src/layouts/PostLayout.astro` → `packages/theme-default/PostLayout.astro`
- `apps/saytu-site/src/layouts/PageLayout.astro` → `packages/theme-default/PageLayout.astro`
- `apps/saytu-site/src/styles/theme.css` → `packages/theme-default/theme.css`
- `apps/saytu-site/src/styles/site.css` → `packages/theme-default/site.css`

```bash
mkdir -p packages/theme-default
cp apps/saytu-site/src/layouts/Layout.astro packages/theme-default/Layout.astro
cp apps/saytu-site/src/layouts/PostLayout.astro packages/theme-default/PostLayout.astro
cp apps/saytu-site/src/layouts/PageLayout.astro packages/theme-default/PageLayout.astro
cp apps/saytu-site/src/styles/theme.css packages/theme-default/theme.css
cp apps/saytu-site/src/styles/site.css packages/theme-default/site.css
```

- [ ] **Step 2: Fix the relative imports for the flat package layout**

In `packages/theme-default/Layout.astro`, the CSS imports move from the `../styles/` subdir to siblings — change:
```astro
import '../styles/theme.css'
import '../styles/site.css'
```
to:
```astro
import './theme.css'
import './site.css'
```
`PostLayout.astro` and `PageLayout.astro` import `./Layout.astro` — that was already a sibling import, so it stays unchanged. (Do not change anything else in the files.)

- [ ] **Step 3: Create `packages/theme-default/package.json`**

```json
{
  "name": "@setu/theme-default",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./Layout.astro": "./Layout.astro",
    "./PostLayout.astro": "./PostLayout.astro",
    "./PageLayout.astro": "./PageLayout.astro",
    "./theme.css": "./theme.css",
    "./site.css": "./site.css"
  },
  "peerDependencies": {
    "astro": "6.4.6"
  }
}
```

- [ ] **Step 4: Add the deps to `apps/saytu-site/package.json`**

In `dependencies`, add:
```json
    "@setu/core": "workspace:*",
    "@setu/theme-default": "workspace:*",
```
Then from the repo ROOT: `pnpm install`.

- [ ] **Step 5: Verify the site is unchanged + green (it still uses its own `src/layouts`)**

Run: `pnpm --filter @setu/site build`
Expected: succeeds (the site hasn't changed — it still imports `../layouts/…`; the package merely exists now and is linked).
Run: `pnpm --filter @setu/site test`
Expected: PASS — 27/27 (unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/theme-default apps/saytu-site/package.json pnpm-lock.yaml
git commit -m "feat(theme-default): @setu/theme-default package (copied from the site theme)"
```

---

### Task 3: Activate the theme via config (the integration)

**Files:**
- Create: `apps/saytu-site/saytu.config.ts`
- Modify: `apps/saytu-site/astro.config.mjs`, `apps/saytu-site/src/pages/[...path].astro`, `apps/saytu-site/src/pages/index.astro`
- Delete: `apps/saytu-site/src/layouts/{Layout,PostLayout,PageLayout}.astro`, `apps/saytu-site/src/styles/{theme,site}.css`

**Interfaces:**
- Consumes: `defineConfig`, `defaultConfig` from `@setu/core`; `loadConfig` from `@setu/core/node` (returns `ResolvedConfig` with `.theme` from Task 1); `@setu/theme-default`'s exports (Task 2).

- [ ] **Step 1: Create `apps/saytu-site/saytu.config.ts`**

```ts
import { defineConfig, defaultConfig } from '@setu/core'

export default defineConfig({
  blocks: defaultConfig.blocks,
  theme: '@setu/theme-default',
})
```

- [ ] **Step 2: Wire `apps/saytu-site/astro.config.mjs` to read the theme + alias `@theme`**

Replace the whole file with:
```js
import { defineConfig } from 'astro/config'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'
import { loadConfig } from '@setu/core/node'

// Read the active theme from saytu.config (single source of truth) and alias '@theme'
// to it, so the pages render through whichever theme is configured.
const config = await loadConfig(new URL('./saytu.config.ts', import.meta.url).pathname)
const activeTheme = config.theme ?? '@setu/theme-default'

export default defineConfig({
  integrations: [markdoc(), react()],
  vite: { resolve: { alias: { '@theme': activeTheme } } },
})
```

- [ ] **Step 3: Rewire the pages to import layouts from `@theme/…`**

`apps/saytu-site/src/pages/[...path].astro` — change the two layout imports:
```astro
import PostLayout from '@theme/PostLayout.astro'
import PageLayout from '@theme/PageLayout.astro'
```
(everything else in the file unchanged.)

`apps/saytu-site/src/pages/index.astro` — change the import:
```astro
import PageLayout from '@theme/PageLayout.astro'
```
(everything else unchanged.)

- [ ] **Step 4: Delete the now-duplicated theme files from the site**

```bash
git rm apps/saytu-site/src/layouts/Layout.astro apps/saytu-site/src/layouts/PostLayout.astro apps/saytu-site/src/layouts/PageLayout.astro apps/saytu-site/src/styles/theme.css apps/saytu-site/src/styles/site.css
```

- [ ] **Step 5: VERIFY the wiring (the one risky bit), then run the no-regression gate**

Run: `pnpm --filter @setu/site test`
Expected: PASS — **27/27 unchanged** (same HTML, now sourced from `@setu/theme-default`).

This step exercises the two things to confirm:
- **(a) `loadConfig` runs inside `astro.config.mjs`** during the build (Node + jiti — proven in #2). If the build errors loading the config (e.g. jiti can't resolve in this context), apply **fallback (b):** drop the `loadConfig` call and set `const activeTheme = '@setu/theme-default'` directly in `astro.config.mjs` (still config-driven via the alias; wiring it to read `saytu.config` becomes a follow-on). Report if used.
- **(b) `@theme/PostLayout.astro` resolves** to the package export. If the build can't resolve the package-name alias, apply **fallback (a):** alias to the resolved path instead —
  ```js
  import { fileURLToPath } from 'node:url'
  const themeDir = fileURLToPath(new URL('../../packages/theme-default', import.meta.url))
  // alias: { '@theme': themeDir }
  ```
  Report if used.

If a test fails because the markup shifted (it should NOT — the files moved verbatim), inspect the built `dist/post/kitchen-sink/index.html` and the diff; do not weaken assertions — the goal is byte-identical output.

- [ ] **Step 6: Confirm the build + zero-JS**

Run: `pnpm --filter @setu/site build`
Expected: succeeds; `dist/` has the same routes (home, post, page). Confirm no `<script>`/`astro-island` in built pages:
Run: `grep -rlE 'astro-island|<script' $(find apps/saytu-site/dist -name '*.html') 2>/dev/null | wc -l` → expect `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/saytu-site
git commit -m "feat(site): activate theme via saytu.config; render through @setu/theme-default"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo test suite**

Run: `pnpm -r test`
Expected: green — `@setu/core` 177 (175 + 2 new), `@setu/theme-default` (no test runner — skipped/no tests), `@setu/blocks` 8, `apps/saytu-site` 27, `apps/saytu-admin` 178, + db/git suites.

- [ ] **Step 2: Both apps build**

Run: `pnpm --filter @setu/site build && pnpm --filter @setu/admin build`
Expected: both succeed (admin untouched — sanity).

- [ ] **Step 3: Zero-JS holds**

Run: `grep -rlE 'astro-island|<script' $(find apps/saytu-site/dist -name '*.html') 2>/dev/null | wc -l`
Expected: `0`.

- [ ] **Step 4: Scope guard**

Run: `git diff --name-only <branch-base>..HEAD | grep -vE '^(packages/core/src/config/|packages/core/test/|packages/theme-default/|apps/saytu-site/|pnpm-lock.yaml)' && echo "SCOPE VIOLATION" || echo "scope clean"`
(`<branch-base>` = the commit the worktree branched from.)
Expected: `scope clean` — NO markdoc/round-trip path, NO `apps/saytu-admin`, NO `@setu/blocks` touched.

- [ ] **Step 5: Confirm the activation is real**

Run: `cat apps/saytu-site/saytu.config.ts` (shows `theme: '@setu/theme-default'`) and confirm `apps/saytu-site/src/layouts/` no longer exists (`test -d apps/saytu-site/src/layouts && echo "STILL THERE" || echo "theme extracted ✓"`).
Expected: `theme extracted ✓` — the site renders through the config-named theme package; the layouts live only in `@setu/theme-default`.

- [ ] **Step 6: Commit (only if verification fixups were needed)**

```bash
git add -A && git commit -m "chore(theme): theme-system final verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-saytu-theme-system-design.md`):
- §1 `@setu/theme-default` package (layouts + tokens + styles): T2. ✓
- §1 `theme` field in `@setu/core` config (additive): T1. ✓
- §1 `saytu.config.ts` with `theme`: T3. ✓
- §1 build reads theme + alias `@theme`: T3. ✓
- §1 rewire pages to `@theme/…`: T3. ✓
- §6 no-regression gate (27 site tests green unchanged): T3/T4. ✓
- §6 core test for the theme field: T1. ✓
- §2 package exports map + astro peerDep: T2. ✓
- §4 build wiring + the verify-first + both fallbacks: T3 Step 5. ✓
- §7/§8 render engine stays; override + Customizer absent; scope guard: T4. ✓

**2. Placeholder scan:** every code step has real code; commands have expected output. The two fallbacks in T3 Step 5 are concrete (full code shown), gated on a named failure — not TBDs.

**3. Type consistency:** `theme?: string` is added to both `SaytuConfig` and `ResolvedConfig` (T1) and consumed as `config.theme` in `astro.config` (T3). `loadConfig(path): Promise<ResolvedConfig>` (unchanged) returns `.theme` after T1. The package exports (`./PostLayout.astro` etc., T2) match the imports (`@theme/PostLayout.astro`, T3) once `@theme` aliases to the package. `defineConfig`/`defaultConfig` (T3 `saytu.config.ts`) are existing `@setu/core` exports. Relative-import fixes (T2 Step 2) match the flat package layout. ✓
