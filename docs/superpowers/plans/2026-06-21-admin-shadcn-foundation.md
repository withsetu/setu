# Admin shadcn Foundation (PR 0a + 0b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shadcn/ui foundation in `@setu/admin` — React 19, shadcn install, and a pure standard-vocabulary token system seeded with Setu's palette — with zero visual change to the running app.

**Architecture:** Two independently-shippable PRs. **0a** upgrades only the admin to React 19 (widening the shared `@setu/blocks` peer rather than force-upgrading `apps/site`). **0b** installs shadcn for Vite+Tailwind v4, rewrites the admin token layer to shadcn's standard names (set to Setu's existing values), keeps temporary aliases so all bespoke CSS still renders identically, and adds the core primitive set. No screen is migrated here — that's PRs 1–7.

**Tech Stack:** Vite 6, React 19, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (new-york, neutral, lucide), `motion`, `tw-animate-css`, `sonner`, `cmdk`, `vaul`, Vitest + Testing Library.

## Global Constraints

- Target platform: Cloudflare Pages compatible; cost-safe. No server-only/Node-only runtime deps in the admin bundle.
- Token vocabulary: **pure shadcn standard set only** (`background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, chart-1..5, sidebar-*, radius`), plus the single intentional extension trio `success/warning/info` (+ `-foreground`). No other custom token names introduced.
- `--accent` is shadcn's hover/selected token, NOT the brand color. Brand indigo → `--primary`.
- Dark mode stays on `[data-theme="dark"]` (do NOT adopt shadcn's `.dark` class).
- shadcn CLI must be run from `apps/admin/` (its own `package.json`), never the workspace root (pnpm blocks root installs).
- Foundation PRs are visually inert: the app must look pixel-identical before and after. Temporary aliases guarantee this until the cleanup PR (separate, post-migration).
- Verification gates per task (run from repo root unless noted): `pnpm --filter @setu/admin typecheck`, `pnpm --filter @setu/admin test`, `pnpm --filter @setu/admin build`.
- Style: `new-york`. Base color: `neutral`. Icons: `lucide`.

---

## PR 0a — React 19 upgrade (admin only)

### Task 1: Upgrade `@setu/admin` to React 19; widen `@setu/blocks` peer

**Files:**
- Modify: `apps/admin/package.json` (deps `react`, `react-dom`; devDeps `@types/react`, `@types/react-dom`)
- Modify: `packages/blocks/package.json` (peerDependencies `react`; devDeps react/types optional)
- Test: existing admin suite (`apps/admin/test/**`, 89 files) is the safety net; no new test code in this task

**Interfaces:**
- Consumes: nothing prior.
- Produces: a React 19 admin app. Later tasks assume `react@^19` and `react-dom@^19` are installed in `apps/admin`.

- [ ] **Step 1: Record the baseline (proves the suite is green before touching anything)**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test`
Expected: typecheck clean; all 89 test files pass. If anything fails here, STOP — fix or report before upgrading (you need a known-good baseline).

- [ ] **Step 2: Bump admin React to 19**

Edit `apps/admin/package.json`:
```jsonc
// dependencies
"react": "^19.0.0",
"react-dom": "^19.0.0",
// devDependencies
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0",
```

- [ ] **Step 3: Widen the shared blocks peer so it accepts both React versions**

`@setu/blocks` is consumed by the admin (now 19) AND `apps/site` (Astro, staying 18). Edit `packages/blocks/package.json`:
```jsonc
// peerDependencies
"react": "^18.3.1 || ^19.0.0",
// devDependencies — bump so blocks' own tests run against 19 (testing-library 16 supports both)
"react": "^19.0.0",
"react-dom": "^19.0.0",
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0",
```
Leave `apps/site/package.json` on `react@18.3.1` — it is out of scope and stays on 18.

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: resolves without peer-dependency errors. pnpm will keep React 18 for `apps/site` and React 19 for `apps/admin`; `@setu/blocks` satisfies both via the widened peer. If you see an unmet-peer warning for `@setu/blocks` against `apps/site`, confirm it's only a warning (the `|| ^18.3.1` clause covers it).

- [ ] **Step 5: Typecheck the admin under React 19**

Run: `pnpm --filter @setu/admin typecheck`
Expected: clean. Likely friction point — React 19 removed implicit `children` from `React.FC` and tightened a few DOM types. If errors appear, they will be concrete type errors in specific files; fix each (commonly: add explicit `children: React.ReactNode` to component props, or adjust a ref type). Do not suppress with `any`.

- [ ] **Step 6: Typecheck blocks under React 19**

Run: `pnpm --filter @setu/blocks typecheck`
Expected: clean. Fix any React 19 type errors the same way.

- [ ] **Step 7: Run the full admin + blocks test suites**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/blocks test`
Expected: all green. React 19 + Testing Library 16 + jsdom is a supported combo; failures here are real regressions — investigate (a common one is `act()` warnings becoming errors; wrap state updates in tests appropriately).

- [ ] **Step 8: Build the admin (production-path sanity)**

Run: `pnpm --filter @setu/admin build`
Expected: succeeds, emits `dist/`.

- [ ] **Step 9: Manual smoke — run the app**

Run: `pnpm dev` (from repo root), open the admin (Vite prints the URL, e.g. http://localhost:5173).
Expected: app boots, no console errors, dashboard renders, you can open a post in the editor and type. This catches runtime-only React 19 issues (e.g., StrictMode double-invoke, ref callbacks).

- [ ] **Step 10: Commit**

```bash
git add apps/admin/package.json packages/blocks/package.json pnpm-lock.yaml
git commit -m "chore(admin): upgrade to React 19; widen @setu/blocks peer to 18||19"
```

---

## PR 0b — shadcn install + token system

### Task 2: Install shadcn scaffolding (config, `cn`, `@/` alias, deps)

**Files:**
- Create: `apps/admin/components.json`
- Create: `apps/admin/src/lib/utils.ts`
- Modify: `apps/admin/vite.config.ts` (add `@` alias)
- Modify: `apps/admin/tsconfig.json` (add `baseUrl` + `paths`)
- Modify: `apps/admin/package.json` (deps via CLI/manual)
- Test: `apps/admin/test/cn.test.ts` (new)

**Interfaces:**
- Consumes: React 19 admin from Task 1.
- Produces: `cn(...inputs)` from `@/lib/utils` (signature `(...inputs: ClassValue[]) => string`); the `@/*` import alias resolving to `apps/admin/src/*`; `components.json` enabling `npx shadcn@latest add <name>`.

- [ ] **Step 1: Add the foundation dependencies (from `apps/admin/`)**

Run:
```bash
cd apps/admin
pnpm add clsx tailwind-merge class-variance-authority lucide-react motion
pnpm add tw-animate-css
cd ../..
```
Expected: added to `apps/admin/package.json` dependencies (NOT root — you're in the package dir).

- [ ] **Step 2: Write `components.json`**

Create `apps/admin/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: Create the `cn` helper**

Create `apps/admin/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: Add the `@` alias to Vite**

In `apps/admin/vite.config.ts`, add to `resolve.alias` (keep the existing `@setu/core` and `zod` entries) and import `node:path`:
```ts
import { fileURLToPath } from 'node:url'
// ...
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setu/core': require.resolve('@setu/core'),
      'zod': require.resolve('zod'),
    },
  },
```

- [ ] **Step 5: Add `@/*` paths to tsconfig**

In `apps/admin/tsconfig.json`, add to `compilerOptions`:
```jsonc
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 6: Write the failing test for `cn`**

Create `apps/admin/test/cn.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conditional classes', () => {
    expect(cn('p-2', false && 'hidden', 'text-sm')).toBe('p-2 text-sm')
  })
  it('de-dupes conflicting tailwind utilities (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
```

- [ ] **Step 7: Run it — verify it passes (proves alias + util wired)**

Run: `pnpm --filter @setu/admin test cn`
Expected: PASS. If the import `@/lib/utils` fails to resolve, the Vite/tsconfig alias from Steps 4–5 is wrong — fix before continuing.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: clean (confirms tsconfig `paths` resolves).

- [ ] **Step 9: Commit**

```bash
git add apps/admin/components.json apps/admin/src/lib/utils.ts apps/admin/vite.config.ts apps/admin/tsconfig.json apps/admin/package.json pnpm-lock.yaml apps/admin/test/cn.test.ts
git commit -m "feat(admin): add shadcn scaffolding (components.json, cn, @/ alias, deps)"
```

### Task 3: Rewrite the token layer to shadcn standard names (visually inert)

**Files:**
- Modify: `apps/admin/src/index.css` (add `tw-animate-css` import + dark custom-variant + `@theme inline` mapping)
- Rewrite: `apps/admin/src/styles/tokens.css` (standard token set with Setu values + state trio + temporary aliases)
- Test: `apps/admin/test/tokens.test.ts` (new — asserts the alias bridge + key tokens exist)

**Interfaces:**
- Consumes: Task 2 scaffolding.
- Produces: standard shadcn CSS variables on `:root`/`[data-theme="dark"]` (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--success`, `--warning`, `--info`, `--radius`, …) AND temporary back-compat aliases (`--bg`, `--surface`, `--text`, `--text-2/3/4`, `--accent-strong`, `--green/amber/blue`, `--radius-base`, etc.) so all existing CSS in `components.css`/`shell.css`/`editor.css`/`dashboard.css`/`customize.css` renders unchanged.

Note on color format: values are copied **verbatim** (hex) from the current `tokens.css` — shadcn's `cssVariables` works with any color format, so no hex→oklch conversion is needed and the look is bit-identical. Future tweakcn/registry themes (which emit oklch) simply override the same names.

- [ ] **Step 1: Write the failing token test**

Create `apps/admin/test/tokens.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8')

describe('tokens.css — shadcn standard vocabulary', () => {
  it('defines the core standard tokens', () => {
    for (const t of ['--background', '--foreground', '--card', '--popover', '--primary',
      '--secondary', '--muted', '--muted-foreground', '--accent', '--destructive',
      '--border', '--input', '--ring', '--radius']) {
      expect(css, `missing ${t}`).toContain(`${t}:`)
    }
  })
  it('defines the success/warning/info state trio', () => {
    for (const t of ['--success', '--warning', '--info',
      '--success-foreground', '--warning-foreground', '--info-foreground']) {
      expect(css, `missing ${t}`).toContain(`${t}:`)
    }
  })
  it('keeps temporary back-compat aliases so bespoke CSS still renders', () => {
    for (const a of ['--bg:', '--surface:', '--text:', '--radius-base:']) {
      expect(css, `missing alias ${a}`).toContain(a)
    }
  })
  it('maps brand indigo to --primary (NOT --accent)', () => {
    // brand color #4f46e5 should appear on --primary; --accent is the neutral hover token
    expect(css).toMatch(/--primary:\s*#4f46e5/)
  })
})
```

- [ ] **Step 2: Run it — verify it FAILS**

Run: `pnpm --filter @setu/admin test tokens`
Expected: FAIL (current `tokens.css` has none of the standard names).

- [ ] **Step 3: Rewrite `tokens.css` — light theme block**

Replace the `:root, [data-theme="light"]` block so it defines BOTH the standard tokens (Setu values) and the temporary aliases. Keep the existing `:root` type/radius/density section above it. Standard set (light):
```css
:root, [data-theme="light"] {
  color-scheme: light;

  /* ---- shadcn standard tokens (values = Setu palette, copied verbatim) ---- */
  --background: #f7f7f8;
  --foreground: #1a1a1f;
  --card: #ffffff;
  --card-foreground: #1a1a1f;
  --popover: #ffffff;
  --popover-foreground: #1a1a1f;
  --primary: #4f46e5;              /* brand indigo (was --accent) */
  --primary-foreground: #ffffff;
  --secondary: #f1f1f3;
  --secondary-foreground: #1a1a1f;
  --muted: #f1f1f3;
  --muted-foreground: #54545d;     /* was --text-2 */
  --accent: #f4f4f6;               /* shadcn hover/selected surface (was --surface-hover) */
  --accent-foreground: #1a1a1f;
  --destructive: #d1453b;
  --destructive-foreground: #ffffff;
  --border: #e8e8ec;
  --input: #e8e8ec;
  --ring: color-mix(in oklch, #4f46e5 38%, transparent);
  --radius: 10px;

  /* charts (reuse semantic hues) */
  --chart-1: #4f46e5; --chart-2: #15935a; --chart-3: #b7791f;
  --chart-4: #2563eb; --chart-5: #d1453b;

  /* sidebar (admin chrome uses app bg/surfaces) */
  --sidebar: #f1f1f3;
  --sidebar-foreground: #1a1a1f;
  --sidebar-primary: #4f46e5;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f4f4f6;
  --sidebar-accent-foreground: #1a1a1f;
  --sidebar-border: #e8e8ec;
  --sidebar-ring: color-mix(in oklch, #4f46e5 38%, transparent);

  /* ---- Setu's one intentional extension: semantic states ---- */
  --success: #15935a;  --success-foreground: #ffffff;
  --warning: #b7791f;  --warning-foreground: #ffffff;
  --info:    #2563eb;  --info-foreground:    #ffffff;

  /* ============================================================
     TEMPORARY back-compat aliases — removed in the cleanup PR.
     They point the OLD names at the new standard tokens so every
     existing bespoke stylesheet renders identically during migration.
     ============================================================ */
  --bg: var(--background);
  --bg-sunken: #f1f1f3;
  --surface: var(--card);
  --surface-2: #fbfbfc;
  --surface-hover: var(--accent);
  --surface-active: #eeeef1;
  --canvas: #ffffff;
  --border-strong: #dcdce2;
  --border-faint: #f0f0f3;
  --text: var(--foreground);
  --text-2: var(--muted-foreground);
  --text-3: #8a8a94;
  --text-4: #b4b4bd;
  --accent-strong: #4338ca;
  --accent-soft: color-mix(in oklch, var(--primary) 12%, transparent);
  --accent-softer: color-mix(in oklch, var(--primary) 7%, transparent);
  --accent-ring: var(--ring);
  --on-accent: var(--primary-foreground);
  --radius-base: var(--radius);
  --green: var(--success); --green-soft: color-mix(in oklch, var(--success) 12%, transparent);
  --amber: var(--warning); --amber-soft: color-mix(in oklch, var(--warning) 14%, transparent);
  --red: var(--destructive); --red-soft: color-mix(in oklch, var(--destructive) 11%, transparent);
  --blue: var(--info); --blue-soft: color-mix(in oklch, var(--info) 11%, transparent);
  --pro: #9a6b00; --pro-bg: linear-gradient(180deg, #fff9ec, #fdf3dd); --pro-border: #ecd9a8;

  /* shadow + radius-scale vars (unchanged from original) stay as-is below */
  --shadow-color: 230 12% 20%;
  --shadow-sm: 0 1px 2px hsl(var(--shadow-color) / 0.06), 0 1px 1px hsl(var(--shadow-color) / 0.04);
  --shadow-md: 0 4px 12px -2px hsl(var(--shadow-color) / 0.10), 0 2px 6px -2px hsl(var(--shadow-color) / 0.06);
  --shadow-lg: 0 18px 40px -12px hsl(var(--shadow-color) / 0.20), 0 6px 14px -6px hsl(var(--shadow-color) / 0.10);
  --shadow-pop: 0 24px 50px -12px hsl(var(--shadow-color) / 0.28), 0 8px 18px -8px hsl(var(--shadow-color) / 0.14);
}
```
(Keep the existing `:root { --font-*, --r-xs..--r-pill, --density, --row-h, --pad-y }` block — those are unchanged. `--r-*` still derive from `--radius-base`, which now aliases `--radius`.)

- [ ] **Step 4: Rewrite `tokens.css` — dark theme block**

Replace `[data-theme="dark"]` with the standard tokens (Setu dark values) + the same aliases:
```css
[data-theme="dark"] {
  color-scheme: dark;

  --background: #0c0c0f;
  --foreground: #f2f2f4;
  --card: #16161a; --card-foreground: #f2f2f4;
  --popover: #16161a; --popover-foreground: #f2f2f4;
  --primary: #6e6bf0; --primary-foreground: #ffffff;
  --secondary: #1b1b20; --secondary-foreground: #f2f2f4;
  --muted: #1b1b20; --muted-foreground: #a8a8b3;
  --accent: #1f1f25; --accent-foreground: #f2f2f4;
  --destructive: #f06a5e; --destructive-foreground: #0c0c0f;
  --border: #26262d; --input: #26262d;
  --ring: color-mix(in oklch, #6e6bf0 45%, transparent);

  --chart-1: #6e6bf0; --chart-2: #3ecf8e; --chart-3: #e2b04a;
  --chart-4: #5b9bff; --chart-5: #f06a5e;

  --sidebar: #08080a; --sidebar-foreground: #f2f2f4;
  --sidebar-primary: #6e6bf0; --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #1f1f25; --sidebar-accent-foreground: #f2f2f4;
  --sidebar-border: #26262d; --sidebar-ring: color-mix(in oklch, #6e6bf0 45%, transparent);

  --success: #3ecf8e; --success-foreground: #08080a;
  --warning: #e2b04a; --warning-foreground: #08080a;
  --info: #5b9bff; --info-foreground: #08080a;

  /* TEMP aliases */
  --bg: var(--background); --bg-sunken: #08080a;
  --surface: var(--card); --surface-2: #1b1b20;
  --surface-hover: var(--accent); --surface-active: #26262d;
  --canvas: #131316;
  --border-strong: #34343d; --border-faint: #1d1d22;
  --text: var(--foreground); --text-2: var(--muted-foreground);
  --text-3: #6e6e79; --text-4: #4c4c55;
  --accent-strong: #8482f6; --accent-ring: var(--ring); --on-accent: var(--primary-foreground);
  --accent-soft: color-mix(in oklch, var(--primary) 14%, transparent);
  --accent-softer: color-mix(in oklch, var(--primary) 9%, transparent);
  --radius-base: var(--radius);
  --green: var(--success); --green-soft: color-mix(in oklch, var(--success) 16%, transparent);
  --amber: var(--warning); --amber-soft: color-mix(in oklch, var(--warning) 16%, transparent);
  --red: var(--destructive); --red-soft: color-mix(in oklch, var(--destructive) 15%, transparent);
  --blue: var(--info); --blue-soft: color-mix(in oklch, var(--info) 15%, transparent);
  --pro: #e6c463; --pro-bg: linear-gradient(180deg, #211c10, #1b1709); --pro-border: #443a1f;

  --shadow-color: 240 40% 2%;
  --shadow-sm: 0 1px 2px hsl(var(--shadow-color) / 0.5), 0 1px 1px hsl(var(--shadow-color) / 0.4);
  --shadow-md: 0 6px 16px -4px hsl(var(--shadow-color) / 0.6), 0 2px 6px -2px hsl(var(--shadow-color) / 0.5);
  --shadow-lg: 0 20px 44px -12px hsl(var(--shadow-color) / 0.72), 0 8px 16px -8px hsl(var(--shadow-color) / 0.5);
  --shadow-pop: 0 28px 60px -14px hsl(var(--shadow-color) / 0.8), 0 10px 22px -10px hsl(var(--shadow-color) / 0.6);
}
```

- [ ] **Step 5: Wire `index.css` — animate import, dark variant, `@theme inline`**

In `apps/admin/src/index.css`, directly after `@import 'tailwindcss';` and the existing token/style imports, add:
```css
@import 'tw-animate-css';

@custom-variant dark (&:is([data-theme="dark"] *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3); --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
```

- [ ] **Step 6: Run the token test — verify it PASSES**

Run: `pnpm --filter @setu/admin test tokens`
Expected: PASS (all four describe blocks).

- [ ] **Step 7: Run the FULL admin suite (catch any visual-logic regression)**

Run: `pnpm --filter @setu/admin test`
Expected: all 89 files still green — especially `appearance.test.tsx`, `sidebar.test.tsx`, `recent-edits.test.tsx`, which touch token-styled components.

- [ ] **Step 8: Build**

Run: `pnpm --filter @setu/admin build`
Expected: Tailwind v4 compiles the `@theme inline` block with no "unknown utility" errors.

- [ ] **Step 9: Manual visual diff — the critical inert check**

Run `pnpm dev`. Walk: dashboard, posts list, editor (open a post), media, and the Appearance screen. Toggle dark mode if a toggle exists, else set `document.documentElement.dataset.theme = 'dark'` in console.
Expected: **pixel-identical to before this task.** Pay special attention to the Appearance preview card (it uses the site-theme `--accent`/`--font-*` inline — confirm it's unaffected). Any visual change means an alias is wrong — fix the specific token.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/styles/tokens.css apps/admin/src/index.css apps/admin/test/tokens.test.ts
git commit -m "feat(admin): remap tokens to shadcn standard vocabulary (visually inert, temp aliases)"
```

### Task 4: Add the core shadcn primitives + mount Sonner Toaster

**Files:**
- Create: `apps/admin/src/components/ui/*` (via CLI)
- Modify: `apps/admin/src/main.tsx` (mount `<Toaster />`)
- Test: `apps/admin/test/ui-button.test.tsx` (new — smoke test a primitive renders with tokens)

**Interfaces:**
- Consumes: Tasks 2–3 (components.json, tokens).
- Produces: importable primitives from `@/components/ui/<name>` (Button, Card, Input, Dialog, DropdownMenu, Popover, Tooltip, Tabs, Table, Badge, Checkbox, Switch, Label, Select, Separator, ScrollArea, Skeleton, Sonner/Toaster, Command, Drawer, Breadcrumb, Avatar, Sidebar). These are consumed by every surface PR (1–7).

- [ ] **Step 1: Add the primitives via the shadcn CLI (from `apps/admin/`)**

Run:
```bash
cd apps/admin
pnpm dlx shadcn@latest add button card input textarea label select dropdown-menu dialog popover tooltip tabs table badge checkbox switch separator scroll-area skeleton sonner command drawer breadcrumb avatar sidebar --yes
cd ../..
```
Expected: files created under `src/components/ui/`; `sonner`, `cmdk`, `vaul`, and Radix deps added to `apps/admin/package.json`. If the CLI prompts about the base color or overwriting `index.css`, decline overwriting `index.css` (your token work must survive) — accept component writes only.

- [ ] **Step 2: Verify the CLI did NOT clobber your tokens**

Run: `git diff apps/admin/src/index.css apps/admin/src/styles/tokens.css`
Expected: NO changes (or only additive). If the CLI rewrote `index.css` with stock neutral oklch tokens, `git checkout -- apps/admin/src/index.css apps/admin/src/styles/tokens.css` and re-apply only the component additions.

- [ ] **Step 3: Add the `--success/warning/info` Badge variants**

Edit `apps/admin/src/components/ui/badge.tsx` — extend the `cva` variants with:
```ts
success: "border-transparent bg-success text-success-foreground",
warning: "border-transparent bg-warning text-warning-foreground",
info: "border-transparent bg-info text-info-foreground",
```
(added alongside the generated `default`/`secondary`/`destructive`/`outline` variants.)

- [ ] **Step 4: Mount the Sonner Toaster (additive — keep existing NotificationProvider for now)**

In `apps/admin/src/main.tsx`, import and render `<Toaster />` inside `NotificationProvider` (next to `<DevReset />`):
```tsx
import { Toaster } from '@/components/ui/sonner'
// ...
          <DevReset />
          <Toaster position="bottom-right" />
```
(The legacy `notify`/`NotificationProvider` is replaced in the Forms PR — not here.)

- [ ] **Step 5: Write the failing primitive smoke test**

Create `apps/admin/test/ui-button.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

describe('shadcn primitives', () => {
  it('renders a Button with text', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
  it('renders the custom success Badge variant', () => {
    render(<Badge variant="success">Published</Badge>)
    const el = screen.getByText('Published')
    expect(el.className).toContain('bg-success')
  })
})
```

- [ ] **Step 6: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test ui-button`
Expected: PASS. Failure to import `@/components/ui/button` means the CLI wrote to a different path — check `components.json` aliases.

- [ ] **Step 7: Typecheck + full suite + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/components apps/admin/src/main.tsx apps/admin/package.json pnpm-lock.yaml apps/admin/test/ui-button.test.tsx
git commit -m "feat(admin): add core shadcn primitives + success/warning/info badges + Sonner Toaster"
```

### Task 5: Governance doc ("fix it from now")

**Files:**
- Create: `docs/admin-ui-conventions.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the written convention every future surface PR follows.

- [ ] **Step 1: Write the conventions doc**

Create `docs/admin-ui-conventions.md`:
```markdown
# Admin UI Conventions

The admin (`@setu/admin`) is built on shadcn/ui. New UI MUST follow these rules.

## Components
- Use primitives from `@/components/ui/*`. Do not hand-roll buttons, inputs, dialogs, menus, popovers, tooltips, tables, badges.
- Icons: `lucide-react` only.
- Compose with `cn()` from `@/lib/utils`; never concatenate class strings by hand.

## Tokens
- Use ONLY the standard shadcn token set + the `success`/`warning`/`info` trio.
- Never introduce new custom CSS variable names or new `.bespoke` CSS classes.
- Style with Tailwind utility classes bound to tokens (`bg-card`, `text-muted-foreground`, `border-input`, `bg-success`).
- `--accent` is the hover/selected surface, NOT the brand. Brand = `--primary`.
- Dark mode: `[data-theme="dark"]`.

## Motion (restraint)
- One engine: `motion` (`motion/react`). Use sparingly — route/state transitions, list enter, optimistic UI.
- Loaders: shadcn `Skeleton`, not spinners. Toasts: `sonner`. Command palette: `cmdk` via `Command`.
- Honor `prefers-reduced-motion`.
- NEVER add landing-page effect libraries (Aceternity/Magic UI/React Bits/Three.js backgrounds) to the admin.

## The TipTap editor canvas
- The canvas keeps its custom rendering. Build its chrome (menus, dialogs, inputs) from shadcn primitives + tokens.
```

- [ ] **Step 2: Commit**

```bash
git add docs/admin-ui-conventions.md
git commit -m "docs(admin): add shadcn UI conventions (the fix-it-from-now guardrail)"
```

---

## Self-Review

**Spec coverage:**
- §2 React 19 → Task 1. ✓
- §3 pure token vocabulary + palette values + success/warning/info trip + `[data-theme]` dark + `@theme inline` + brand→primary trap + Appearance care-point → Task 3 (+ Step 9 manual Appearance check). ✓
- §4 PR 0a/0b foundation (deps, components.json, cn, @/ alias, tw-animate-css, motion, primitives, temp aliases) → Tasks 1, 2, 4. ✓
- §5 component mapping → deferred to surface PRs (primitives made available in Task 4). ✓ (out of foundation scope by design)
- §6 motion stack present (motion, tw-animate-css, Sonner, Skeleton, cmdk) → Tasks 2, 4. ✓
- §8 governance doc → Task 5. ✓
- §9 verification gates (typecheck/test/build/visual) → present in every task. ✓
- §10 shadcn MCP → already added to `.mcp.json`; no task needed.

**Placeholder scan:** none — every step has concrete commands/code.

**Type consistency:** `cn(...inputs: ClassValue[]) => string` (Task 2) consumed by Badge edit (Task 4); `@/components/ui/*` import paths consistent with `components.json` aliases (Task 2); Badge `variant="success"` (Task 4 Step 3) matches the smoke test (Task 4 Step 5).

**Note:** Surface PRs 1–7 (shell, dashboard, lists, forms, editor chrome, media, cleanup) each get their own plan, authored after this foundation lands.
