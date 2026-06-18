# Theme Options Engine (#3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a non-coder five knobs (accent color, font, content width, text size, corner style) that retune the active theme — declared by the theme, stored in `setu.config`, applied by the build as `:root` token overrides — and remove the runtime Google-Fonts dependency repo-wide by self-hosting fonts via `@fontsource`.

**Architecture:** The theme package declares its knobs in `options.ts` (the "options API") plus a pure `optionsToCss(values)` that maps chosen values → a `:root { … }` override string. `@setu/core` config gains an additive optional `themeOptions` map (pass-through, exactly like the 3b `theme` field — never read by the converter). At build, the theme's `Layout.astro` injects `optionsToCss(themeOptions)` as a `<style>` after `theme.css`, so the later `:root` wins and the site restyles. Fonts are self-hosted; the Layout declares all curated faces but the visitor downloads only the selected one.

**Tech Stack:** Astro 6.4.6 · `@setu/theme-default` (gains `options.ts` + vitest + self-hosted font CSS) · `@setu/core` config (additive `themeOptions`) · `@fontsource-variable/*` (self-hosted OFL/Apache-2.0 fonts) · Vitest 2 · pnpm workspaces.

## Global Constraints

- **Strict TS** (`tsconfig.base.json`): `verbatimModuleSyntax: true` → use `import type` for type-only imports; `noUncheckedIndexedAccess: true` → every array/record index and `.find()` result is `T | undefined` and MUST be guarded before use; `isolatedModules`, `strict`. `moduleResolution: bundler`.
- **100% OSS** — `@fontsource-variable/*` fonts are SIL OFL v1.1 / Apache-2.0 (verified). No paid/Pro deps.
- **Content round-trip UNTOUCHED** — `themeOptions` is config-only; the Markdoc converter never reads it. Do not touch `packages/core/src/markdoc/`.
- **The ONLY intentional visible/test change is font delivery** — Google `<link>` → self-hosted `@font-face`. Default `themeOptions` ⇒ identical look otherwise.
- **HARD RULE (verify before asserting):** any NEW dependency/API claim must be web/empirically verified, never asserted from memory. Specifically verify in-task: the exact `font-family` name each `@fontsource-variable` package's CSS declares (commonly `'<Name> Variable'`, NOT the plain name); the `@fontsource` side-effect-CSS import path; Astro `<style set:html>` / `is:inline` behavior; `color-mix(in oklch, …)` is emitted as authored. The 7 `@fontsource-variable` package names + versions below are ALREADY npm-verified — do NOT re-verify those:
  `@fontsource-variable/hanken-grotesk@5.2.8`, `inter@5.2.8`, `source-serif-4@5.2.9`, `newsreader@5.2.10`, `lora@5.2.8`, `space-grotesk@5.2.10`, `jetbrains-mono@5.2.8`.
- **Commit message footer** (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Run tests from the repo root** with pnpm filters, e.g. `pnpm --filter @setu/core test`.

---

### Task 1: `@setu/core` — additive `themeOptions` config field

Mirrors exactly how the `theme` field was added in 3b. Additive, optional, pass-through.

**Files:**
- Modify: `packages/core/src/config/types.ts` (`SaytuConfig`, `ResolvedConfig`)
- Modify: `packages/core/src/config/schema.ts` (`configSchema`)
- Modify: `packages/core/src/config/resolve.ts:32` (the returned object)
- Test: `packages/core/test/config/theme-options-field.test.ts` (new)

**Interfaces:**
- Produces: `SaytuConfig.themeOptions?: Record<string, string>`, `ResolvedConfig.themeOptions?: Record<string, string>`. `resolveConfig(raw).themeOptions` passes the authored value through (or `undefined`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/config/theme-options-field.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../../src/config/resolve'

describe('config themeOptions field', () => {
  it('passes themeOptions through to the resolved config', () => {
    const r = resolveConfig({ blocks: [], themeOptions: { accent: '#0ea5e9', width: 'wide' } })
    expect(r.themeOptions).toEqual({ accent: '#0ea5e9', width: 'wide' })
  })
  it('leaves themeOptions undefined when omitted (back-compat)', () => {
    const r = resolveConfig({ blocks: [] })
    expect(r.themeOptions).toBeUndefined()
  })
  it('rejects a non-string option value', () => {
    expect(() => resolveConfig({ blocks: [], themeOptions: { accent: 123 } })).toThrow(
      /Invalid setu.config/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- theme-options-field`
Expected: FAIL — `themeOptions` is not on the resolved type / not parsed (first two assertions fail; the throw assertion may pass or fail depending on current passthrough — both count as red).

- [ ] **Step 3: Add the type field**

In `packages/core/src/config/types.ts`, add to `SaytuConfig` (right after the `theme?: string` field):

```ts
  /** Chosen values for the active theme's declared options (key → value). Optional. */
  themeOptions?: Record<string, string>
```

And add to `ResolvedConfig` (right after its `theme?: string` field):

```ts
  /** Theme option values, passed through from the authored config. */
  themeOptions?: Record<string, string>
```

- [ ] **Step 4: Add the schema field**

In `packages/core/src/config/schema.ts`, extend `configSchema`:

```ts
export const configSchema = z.object({
  blocks: z.array(blockSchema),
  theme: z.string().optional(),
  themeOptions: z.record(z.string(), z.string()).optional(),
})
```

- [ ] **Step 5: Pass it through in resolve**

In `packages/core/src/config/resolve.ts`, change the return statement to include `themeOptions`:

```ts
  return {
    blocks,
    blocksByTag,
    knownBlockTags: new Set(blocksByTag.keys()),
    theme: parsed.data.theme,
    themeOptions: parsed.data.themeOptions,
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @setu/core test -- theme-options-field`
Expected: PASS (3/3).

- [ ] **Step 7: Typecheck + full core suite (no regressions)**

Run: `pnpm --filter @setu/core typecheck && pnpm --filter @setu/core test`
Expected: typecheck clean (incl. `tsconfig.edge.json`); all core tests green (existing + 3 new).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/config/schema.ts packages/core/src/config/resolve.ts packages/core/test/config/theme-options-field.test.ts
git commit -m "feat(core): additive themeOptions config field (#3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `@setu/theme-default` — options manifest + pure `optionsToCss`

Adds the theme's declared knobs and the pure value→CSS mapper, plus first-time vitest/tsconfig setup for this package (it has no tests today).

**Files:**
- Create: `packages/theme-default/options.ts`
- Create: `packages/theme-default/options.test.ts`
- Create: `packages/theme-default/tsconfig.json`
- Modify: `packages/theme-default/package.json` (scripts, devDeps, exports)
- Test: `packages/theme-default/options.test.ts`

**Interfaces:**
- Produces: `themeOptions: ThemeOption[]` and `optionsToCss(values: Record<string, string>): string`, exported from `@setu/theme-default/options`. Types: `ThemeOptionType = 'color' | 'select'`; `ThemeOptionChoice { value: string; label: string; tokenValue: string }`; `ThemeOption { key: string; label: string; type: ThemeOptionType; token: string | string[]; default: string; choices?: ThemeOptionChoice[] }`.
- Consumed by: Task 4 (`Layout.astro` imports `optionsToCss`).

- [ ] **Step 1: Set up vitest + tsconfig for the package**

Create `packages/theme-default/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["options.ts", "options.test.ts"]
}
```

Edit `packages/theme-default/package.json` — add `scripts`, `devDependencies`, and the `./options` export. Result:

```json
{
  "name": "@setu/theme-default",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    "./Layout.astro": "./Layout.astro",
    "./PostLayout.astro": "./PostLayout.astro",
    "./PageLayout.astro": "./PageLayout.astro",
    "./theme.css": "./theme.css",
    "./site.css": "./site.css",
    "./options": "./options.ts"
  },
  "peerDependencies": {
    "astro": "6.4.6"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Then run `pnpm install` from the repo root so the new devDeps link.

- [ ] **Step 2: Write the failing test**

Create `packages/theme-default/options.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { themeOptions, optionsToCss } from './options'

describe('theme-default options manifest', () => {
  it('declares the five knobs by key', () => {
    expect(themeOptions.map((o) => o.key)).toEqual(['accent', 'font', 'width', 'textSize', 'corners'])
  })
  it('every select knob has choices including its default', () => {
    for (const opt of themeOptions) {
      if (opt.type === 'select') {
        const values = (opt.choices ?? []).map((c) => c.value)
        expect(values).toContain(opt.default)
      }
    }
  })
  it('font knob drives both --font-body and --font-heading', () => {
    const font = themeOptions.find((o) => o.key === 'font')
    expect(font?.token).toEqual(['--font-body', '--font-heading'])
  })
})

describe('optionsToCss', () => {
  it('wraps declarations in a :root block', () => {
    expect(optionsToCss({})).toMatch(/^:root\s*\{[\s\S]*\}$/)
  })
  it('applies a chosen accent color', () => {
    expect(optionsToCss({ accent: '#0ea5e9' })).toContain('--accent: #0ea5e9;')
  })
  it('applies a chosen width to --measure-page', () => {
    expect(optionsToCss({ width: 'wide' })).toContain('--measure-page: 78rem;')
  })
  it('writes BOTH font tokens for a font choice', () => {
    const css = optionsToCss({ font: 'inter' })
    expect(css).toMatch(/--font-body:[^;]+;/)
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
  it('falls back to the default for an unknown select value', () => {
    expect(optionsToCss({ width: 'gigantic' })).toContain('--measure-page: 64rem;') // normal default
  })
  it('falls back to the default for an invalid color', () => {
    expect(optionsToCss({ accent: 'not-a-color' })).toContain('--accent: #4f46e5;')
  })
  it('all-default values reproduce the current token set', () => {
    const css = optionsToCss({})
    expect(css).toContain('--accent: #4f46e5;')
    expect(css).toContain('--measure-page: 64rem;')
    expect(css).toContain('--text-base: 1.0625rem;')
    expect(css).toContain('--radius-base: 10px;')
    expect(css).toMatch(/--font-body:[^;]+;/) // exact stack verified against @fontsource family in Task 3
    expect(css).toMatch(/--font-heading:[^;]+;/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/theme-default test`
Expected: FAIL — `./options` module not found.

- [ ] **Step 4: Implement `options.ts`**

Create `packages/theme-default/options.ts`. NOTE on font stacks: `@fontsource-variable/*` packages usually declare the family as `'<Name> Variable'` (e.g. `'Inter Variable'`). Author each stack with the Variable name FIRST, then the plain name, then generics — Task 3 verifies the exact name against the installed CSS and corrects if needed.

```ts
export type ThemeOptionType = 'color' | 'select'

export interface ThemeOptionChoice {
  value: string
  label: string
  /** What the driven token(s) become when this choice is selected. */
  tokenValue: string
}

export interface ThemeOption {
  key: string
  label: string
  type: ThemeOptionType
  /** The CSS custom property/properties this knob drives. */
  token: string | string[]
  /** Default *value*: a color for `color`; a choice `value` for `select`. */
  default: string
  choices?: ThemeOptionChoice[]
}

const sans = (name: string) => `'${name} Variable', '${name}', ui-sans-serif, system-ui, sans-serif`
const serif = (name: string) => `'${name} Variable', '${name}', ui-serif, Georgia, serif`

export const themeOptions: ThemeOption[] = [
  {
    key: 'accent',
    label: 'Accent color',
    type: 'color',
    token: '--accent',
    default: '#4f46e5',
  },
  {
    key: 'font',
    label: 'Font',
    type: 'select',
    token: ['--font-body', '--font-heading'],
    default: 'grotesk',
    choices: [
      { value: 'grotesk', label: 'Grotesk (default)', tokenValue: sans('Hanken Grotesk') },
      { value: 'inter', label: 'Inter', tokenValue: sans('Inter') },
      { value: 'source-serif', label: 'Serif (Source Serif)', tokenValue: serif('Source Serif 4') },
      { value: 'newsreader', label: 'Literary (Newsreader)', tokenValue: serif('Newsreader') },
      { value: 'lora', label: 'Warm serif (Lora)', tokenValue: serif('Lora') },
      { value: 'space', label: 'Space Grotesk', tokenValue: sans('Space Grotesk') },
    ],
  },
  {
    key: 'width',
    label: 'Content width',
    type: 'select',
    token: '--measure-page',
    default: 'normal',
    choices: [
      { value: 'narrow', label: 'Narrow', tokenValue: '52rem' },
      { value: 'normal', label: 'Normal', tokenValue: '64rem' },
      { value: 'wide', label: 'Wide', tokenValue: '78rem' },
    ],
  },
  {
    key: 'textSize',
    label: 'Text size',
    type: 'select',
    token: '--text-base',
    default: 'normal',
    choices: [
      { value: 'compact', label: 'Compact', tokenValue: '1rem' },
      { value: 'normal', label: 'Normal', tokenValue: '1.0625rem' },
      { value: 'comfy', label: 'Comfy', tokenValue: '1.1875rem' },
    ],
  },
  {
    key: 'corners',
    label: 'Corner style',
    type: 'select',
    token: '--radius-base',
    default: 'rounded',
    choices: [
      { value: 'sharp', label: 'Sharp', tokenValue: '2px' },
      { value: 'rounded', label: 'Rounded', tokenValue: '10px' },
    ],
  },
]

/** Accept a hex color (#rgb/#rgba/#rrggbb/#rrggbbaa). Anything else is treated as invalid. */
function isValidColor(value: string | undefined): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

function tokensOf(opt: ThemeOption): string[] {
  return Array.isArray(opt.token) ? opt.token : [opt.token]
}

/**
 * Pure: map chosen option values to a `:root { … }` override string.
 * Missing/invalid values fall back to the option's default — a malformed
 * config can never emit garbage or break the site.
 */
export function optionsToCss(values: Record<string, string>): string {
  const decls: string[] = []
  for (const opt of themeOptions) {
    const raw = values[opt.key]
    if (opt.type === 'color') {
      const value = isValidColor(raw) ? raw : opt.default
      for (const token of tokensOf(opt)) decls.push(`${token}: ${value};`)
    } else {
      const choices = opt.choices ?? []
      const choice =
        choices.find((c) => c.value === raw) ?? choices.find((c) => c.value === opt.default)
      if (!choice) continue
      for (const token of tokensOf(opt)) decls.push(`${token}: ${choice.tokenValue};`)
    }
  }
  return `:root { ${decls.join(' ')} }`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/theme-default test`
Expected: PASS (all assertions).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/theme-default typecheck`
Expected: clean (no `noUncheckedIndexedAccess` violations — `tokensOf`, the `?? default` chains, and `isValidColor` guard all index-safe).

- [ ] **Step 7: Commit**

```bash
git add packages/theme-default/options.ts packages/theme-default/options.test.ts packages/theme-default/tsconfig.json packages/theme-default/package.json
git commit -m "feat(theme-default): options manifest + pure optionsToCss (#3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Self-host fonts in the site theme + accent cascade fix

Install the curated `@fontsource` faces, import them in `Layout.astro`, drop the Google `<link>`, and make `--accent-strong` derive from `--accent`. **Verify the actual `font-family` name each package declares and reconcile the `options.ts` stacks to match.**

**Files:**
- Modify: `packages/theme-default/package.json` (dependencies)
- Modify: `packages/theme-default/Layout.astro` (font imports; remove Google `<link>`/preconnect)
- Modify: `packages/theme-default/theme.css:19` (`--accent-strong`)
- Modify: `packages/theme-default/options.ts` (reconcile font stacks to verified family names, if they differ)

**Interfaces:**
- Consumes: `themeOptions`/`optionsToCss` exist (Task 2). Font stacks in `options.ts` must reference the exact `font-family` the installed CSS declares.

- [ ] **Step 1: Install the curated fonts**

From repo root:

```bash
pnpm --filter @setu/theme-default add \
  @fontsource-variable/hanken-grotesk@5.2.8 \
  @fontsource-variable/inter@5.2.8 \
  @fontsource-variable/source-serif-4@5.2.9 \
  @fontsource-variable/newsreader@5.2.10 \
  @fontsource-variable/lora@5.2.8 \
  @fontsource-variable/space-grotesk@5.2.10 \
  @fontsource-variable/jetbrains-mono@5.2.8
```

Expected: installs cleanly (these versions are npm-verified).

- [ ] **Step 2: VERIFY the declared font-family names (HARD RULE)**

Inspect each package's main CSS for the exact `font-family` it registers:

```bash
grep -h "font-family" packages/theme-default/node_modules/@fontsource-variable/{hanken-grotesk,inter,source-serif-4,newsreader,lora,space-grotesk}/index.css
```

Expected: lines like `font-family: 'Inter Variable';`. Confirm the `*-variable/index.css` side-effect import path exists (it's the package's `"."`/`style` entry, e.g. `@fontsource-variable/inter` resolves to `index.css`). If any declared name differs from what `options.ts` authored (the `'<Name> Variable'` head), **correct the stack in `options.ts`** so the first family matches the registered name exactly. Re-run `pnpm --filter @setu/theme-default test` after any edit — the `options.test.ts` stack assertions are substring-based so they stay green, but the family head must be byte-correct for the font to actually apply.

- [ ] **Step 3: Import the fonts in `Layout.astro` and drop Google Fonts**

Edit `packages/theme-default/Layout.astro`. Frontmatter (top, after the existing CSS imports) — add the seven font imports:

```astro
---
import './theme.css'
import './site.css'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/lora'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

interface Props {
  title: string
  lang?: string
}
const { title, lang = 'en' } = Astro.props
---
```

In the `<head>`, REMOVE these three lines (the Google Fonts preconnects + stylesheet link):

```astro
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

(Leave the `<meta>` charset/viewport and `<title>`.)

- [ ] **Step 4: Make `--accent-strong` derive from `--accent`**

Edit `packages/theme-default/theme.css` line 19. Replace:

```css
  --accent-strong: #4338ca;
```

with:

```css
  --accent-strong: color-mix(in oklch, var(--accent) 82%, black);
```

(`--accent-soft` already derives from `--accent`; now a single accent knob recolors the whole accent family.)

- [ ] **Step 5: Build the site to verify fonts load + no Google reference**

Run: `pnpm --filter @setu/site build`
Then verify the built output self-hosts and has no Google reference:

```bash
grep -rl "fonts.googleapis.com" apps/site/dist || echo "NO GOOGLE FONTS — good"
grep -rho "font-family: '[^']*Variable'" apps/site/dist/_astro/*.css | sort -u
```

Expected: "NO GOOGLE FONTS — good"; the variable family names (incl. `Hanken Grotesk Variable`) appear in the bundled CSS. Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/theme-default/package.json packages/theme-default/Layout.astro packages/theme-default/theme.css packages/theme-default/options.ts pnpm-lock.yaml
git commit -m "feat(theme-default): self-host curated fonts via @fontsource; derive accent-strong (#3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Build wiring — apply `themeOptions` on the site

Thread `themeOptions` from `setu.config` → pages → templates → `Layout`, where `optionsToCss` injects a `:root` override that wins the cascade. **Verify the override actually wins in built HTML.**

**Files:**
- Create: `apps/site/src/lib/site-config.ts`
- Modify: `packages/theme-default/Layout.astro` (accept `themeOptions` prop; inject override `<style>`)
- Modify: `packages/theme-default/PostLayout.astro` + `PageLayout.astro` (forward `themeOptions`)
- Modify: `apps/site/src/pages/[...path].astro` + `index.astro` (read + pass `themeOptions`)
- Test: `apps/site/test/theme-options.test.ts` (new)

**Interfaces:**
- Consumes: `optionsToCss` from `@setu/theme-default/options` (Task 2); `SaytuConfig.themeOptions` (Task 1).
- Produces: `Layout`/`PostLayout`/`PageLayout` accept `themeOptions?: Record<string, string>`. `site-config.ts` exports `themeOptions: Record<string, string>` (defaults to `{}`).

- [ ] **Step 1: Create the site-config reader**

Create `apps/site/src/lib/site-config.ts`:

```ts
import config from '../../setu.config'

/** Theme option values from setu.config (the build's single source of truth).
 *  Empty object when unset → the theme renders its declared defaults. */
export const themeOptions: Record<string, string> = config.themeOptions ?? {}
```

- [ ] **Step 2: Accept + inject options in `Layout.astro`**

Edit `packages/theme-default/Layout.astro`. Add the import + prop, and inject the override style as the LAST element in `<head>` so it follows the theme CSS in source order.

Frontmatter — add to the imports and `Props`:

```astro
import { optionsToCss } from './options'
// ...existing font imports...

interface Props {
  title: string
  lang?: string
  themeOptions?: Record<string, string>
}
const { title, lang = 'en', themeOptions = {} } = Astro.props
const overrideCss = optionsToCss(themeOptions)
```

In `<head>`, as the final element before `</head>`:

```astro
    <style is:inline set:html={overrideCss}></style>
```

VERIFY-FIRST: after wiring (Step 6 build), confirm in `apps/site/dist/post/kitchen-sink/index.html` that this inline `:root` style appears AFTER the bundled theme CSS so it wins the cascade. If Astro's bundled stylesheet `<link>` ends up after the inline style (override loses), bump specificity by emitting the override as `:root:root { … }` — change the return in `optionsToCss` to `` `:root:root { ${decls.join(' ')} }` `` and update the `options.test.ts` `:root` regex accordingly (`/^:root:root\s*\{/`). Use the cascade-order approach if it works; fall back to `:root:root` only if needed. Document which was used in the commit.

- [ ] **Step 3: Forward `themeOptions` through the templates**

Edit `packages/theme-default/PostLayout.astro`:

```astro
---
import Layout from './Layout.astro'
interface Props { title: string; lang?: string; themeOptions?: Record<string, string> }
const { title, lang = 'en', themeOptions } = Astro.props
---
<Layout title={title} lang={lang} themeOptions={themeOptions}>
  <article class="prose measure-post"><slot /></article>
</Layout>
```

Edit `packages/theme-default/PageLayout.astro` identically, keeping its `measure-page` article class:

```astro
---
import Layout from './Layout.astro'
interface Props { title: string; lang?: string; themeOptions?: Record<string, string> }
const { title, lang = 'en', themeOptions } = Astro.props
---
<Layout title={title} lang={lang} themeOptions={themeOptions}>
  <article class="prose measure-page"><slot /></article>
</Layout>
```

- [ ] **Step 4: Pass `themeOptions` from the pages**

Edit `apps/site/src/pages/[...path].astro` — add the import and pass the prop:

```astro
import { themeOptions } from '../lib/site-config'
```

and change the render to:

```astro
<TemplateLayout title={title} lang={locale} themeOptions={themeOptions}>
  <h1>{title}</h1>
  <Content />
</TemplateLayout>
```

Edit `apps/site/src/pages/index.astro` — add the import and pass the prop:

```astro
import { themeOptions } from '../lib/site-config'
```

and:

```astro
<PageLayout title={title} lang="en" themeOptions={themeOptions}>
  <h1>{title}</h1>
  <Content />
</PageLayout>
```

- [ ] **Step 5: Write the wiring test**

Create `apps/site/test/theme-options.test.ts`. This builds once and asserts the injected override is present, sourced from `optionsToCss`, and reflects the config. (Default config ⇒ default tokens; this proves the config→page→cascade pipe end-to-end. Non-default value mapping is covered by Task 2's pure tests.)

```ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { optionsToCss } from '@setu/theme-default/options'
import { themeOptions } from '../src/lib/site-config'

const appDir = fileURLToPath(new URL('..', import.meta.url))
let html = ''

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = readFileSync(join(appDir, 'dist', 'post', 'kitchen-sink', 'index.html'), 'utf8')
})

describe('theme options — build wiring', () => {
  it('injects the optionsToCss override into the page head', () => {
    expect(html).toContain(optionsToCss(themeOptions))
  })
  it('the override carries the theme default tokens (default config)', () => {
    expect(html).toContain('--measure-page: 64rem;')
    expect(html).toContain('--accent: #4f46e5;')
  })
  it('the override appears after the bundled theme CSS (wins the cascade)', () => {
    // theme.css ships either inline or as a linked _astro asset; the override
    // must come after the last theme stylesheet reference in the document.
    const overrideIdx = html.indexOf(optionsToCss(themeOptions))
    const lastThemeCssIdx = Math.max(
      html.lastIndexOf('rel="stylesheet"'),
      html.lastIndexOf('measure-page'), // appears in inlined theme/site css if inlined
    )
    expect(overrideIdx).toBeGreaterThan(-1)
    expect(overrideIdx).toBeGreaterThan(lastThemeCssIdx)
  })
})
```

NOTE: if the cascade-order assertion can't be satisfied by source order (Astro places the bundled `<link>` last), switch to the `:root:root` specificity approach from Step 2 and replace the third test with an assertion that the override uses the higher-specificity selector (`expect(html).toContain(':root:root {')`). Pick whichever the build actually supports — do not leave a failing or hollow (always-true) test.

- [ ] **Step 6: Run the test (builds the site)**

Run: `pnpm --filter @setu/site test -- theme-options`
Expected: PASS — override injected, carries defaults, wins the cascade (via order or `:root:root`).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/lib/site-config.ts packages/theme-default/Layout.astro packages/theme-default/PostLayout.astro packages/theme-default/PageLayout.astro apps/site/src/pages/ apps/site/test/theme-options.test.ts
git commit -m "feat(site): apply themeOptions as :root token overrides at build (#3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Self-host fonts in the admin chrome

Switch the admin's three faces to `@fontsource` and remove its Google `<link>`. No product-surface change; the families resolve to self-hosted faces.

**Files:**
- Modify: `apps/admin/package.json` (dependencies)
- Modify: `apps/admin/src/main.tsx` (font CSS imports)
- Modify: `apps/admin/index.html` (remove Google `<link>` + preconnects)

**Interfaces:** none exported; this is app-internal.

- [ ] **Step 1: Install the admin's fonts**

```bash
pnpm --filter @setu/admin add \
  @fontsource-variable/hanken-grotesk@5.2.8 \
  @fontsource-variable/newsreader@5.2.10 \
  @fontsource-variable/jetbrains-mono@5.2.8
```

Expected: installs cleanly.

- [ ] **Step 2: Verify the admin's font-family names match the variable packages**

The admin's `apps/admin/src/styles/tokens.css` references font families (Hanken Grotesk / Newsreader / JetBrains Mono). Check the families it expects:

```bash
grep -n "font-family\|--font" apps/admin/src/styles/tokens.css
```

If the admin's stacks use the plain names (e.g. `'Hanken Grotesk'`) but the variable packages register `'Hanken Grotesk Variable'`, add the Variable name to the front of those stacks in `tokens.css` (keep the plain name as fallback) so the self-hosted faces actually apply. Make the minimal edit needed; do not restyle.

- [ ] **Step 3: Import the font CSS in the admin entry**

Edit `apps/admin/src/main.tsx`. Add the three imports next to the existing `import './index.css'` (place them BEFORE `./index.css` so token CSS can override if needed):

```ts
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
```

- [ ] **Step 4: Remove Google Fonts from `index.html`**

Edit `apps/admin/index.html` — delete the three font lines from `<head>`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

(Keep the `<meta>`s, `<title>`, the `data-theme` bootstrap script, `#root`, and the module script.)

- [ ] **Step 5: Build the admin + confirm no Google reference**

Run: `pnpm --filter @setu/admin build`
Then:

```bash
grep -rl "fonts.googleapis.com" apps/admin/dist apps/admin/index.html || echo "NO GOOGLE FONTS — good"
```

Expected: build succeeds; "NO GOOGLE FONTS — good".

- [ ] **Step 6: Run the admin test suite (no regressions)**

Run: `pnpm --filter @setu/admin test`
Expected: all existing admin tests green (font delivery doesn't touch tested behavior).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json apps/admin/src/main.tsx apps/admin/index.html apps/admin/src/styles/tokens.css pnpm-lock.yaml
git commit -m "feat(admin): self-host fonts via @fontsource; drop Google Fonts (#3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: No-regression gate + full verification

Flip the one intentional font-delivery test, then prove the whole repo is green and Google-free.

**Files:**
- Modify: `apps/site/test/render.test.ts` (the `loads the theme web fonts` test, ~line 155)

**Interfaces:** none.

- [ ] **Step 1: Flip the Google-Fonts assertion to self-hosted**

In `apps/site/test/render.test.ts`, find the test:

```ts
  it('loads the theme web fonts', () => {
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('Hanken+Grotesk')
  })
```

Replace it with (self-hosted: no Google, and the default font face is present in the bundled CSS). Use a helper that reads the built CSS (the existing `themeCss()` falls back to `dist/_astro/*.css`):

```ts
  it('self-hosts the theme web fonts (no Google Fonts)', () => {
    expect(html).not.toContain('fonts.googleapis.com')
    // The default body face (Hanken Grotesk) is declared via @font-face in bundled CSS.
    expect(themeCss()).toMatch(/font-family:\s*'Hanken Grotesk Variable'/)
  })
```

VERIFY: confirm the exact `font-family` string in the built CSS matches the regex (it must equal the name verified in Task 3 Step 2 — adjust the regex if the package registers a slightly different name).

- [ ] **Step 2: Run the full site suite (the no-regression gate)**

Run: `pnpm --filter @setu/site test`
Expected: all site tests green — the original 27 (with this one flipped) + the new `theme-options` build test. The themed-token test (`#4f46e5`) still passes (now sourced from the injected override and/or theme.css). Zero-JS test still passes.

- [ ] **Step 3: Full repo green**

Run from repo root: `pnpm -r test`
Expected: every package green — `@setu/core` (+ Task 1 tests), `@setu/blocks` (8), `@setu/theme-default` (new), `@setu/site`, `@setu/admin`, db/git packages. No failures.

- [ ] **Step 4: Both apps build + repo-wide Google-Fonts sweep**

```bash
pnpm --filter @setu/site build && pnpm --filter @setu/admin build
grep -rl "fonts.googleapis.com" apps/site/dist apps/admin/dist apps/admin/index.html packages/theme-default/Layout.astro || echo "REPO IS GOOGLE-FONTS-FREE"
```

Expected: both builds succeed; "REPO IS GOOGLE-FONTS-FREE" (the only remaining reference is the non-shipped `design/admin/tokens.css` reference file, intentionally left).

- [ ] **Step 5: Zero-JS holds (site)**

```bash
grep -rl "astro-island" apps/site/dist && echo "UNEXPECTED JS ISLAND" || echo "ZERO-JS HOLDS"
```

Expected: "ZERO-JS HOLDS".

- [ ] **Step 6: Typecheck the touched packages**

Run: `pnpm --filter @setu/core typecheck && pnpm --filter @setu/theme-default typecheck && pnpm --filter @setu/admin typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/site/test/render.test.ts
git commit -m "test(site): self-hosted-fonts assertion; #3c no-regression gate green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Worktree:** execute off `main` in an isolated worktree (subagent-driven-development + using-git-worktrees). Baseline-test before starting.
- **Finish flow (established default):** after all tasks + final review, merge `--no-ff` to local `main` → `pnpm install` on main → push via `gh`/HTTPS → remove the worktree. No PR.
- **Cascade decision (Task 4 Step 2) is the one genuine unknown** — resolve it empirically against built HTML; both levers (source-order vs `:root:root`) are spelled out. Everything else is mechanical or pure.
- **Font-family verification (Task 3 Step 2) gates the visual correctness** — the `'<Name> Variable'` assumption must be confirmed against the installed CSS; reconcile `options.ts` stacks, the admin `tokens.css`, and the render-test regex to the verified names.
- After merge: update `memory/saytu-project.md` + `docs/roadmap.md` (mark #3c shipped; next = the visual Customizer panel, gated on the editor→disk bridge).
