# Default Theme (sub-project #3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Saytu site a real, designed look — one typographic identity, a header/footer shell, and Post (narrow) + Page (wider) templates — built from tokens-with-defaults so it's fully customization-ready.

**Architecture:** The default theme lives in `apps/saytu-site`: a `theme.css` token layer (the knobs, with defaults), a `Layout.astro` shell (head/fonts/header/footer), per-collection `PostLayout`/`PageLayout`, and token-driven prose. Blocks (`@saytu/blocks`) already style via `var(--token, fallback)`, so defining the tokens makes every block render themed and match the editor. Pure CSS + Astro layouts.

**Tech Stack:** Astro 6 · CSS custom properties · Google Fonts via `<link>` (Hanken Grotesk + JetBrains Mono) · `@saytu/blocks` (unchanged) · Vitest build-and-assert (extends `apps/saytu-site/test/render.test.ts`).

## Global Constraints

- **No new dependencies.** Fonts load via a Google Fonts `<link>` in the layout `<head>` (no fontsource). No `@saytu/core` / `@saytu/blocks` changes — the theme only *defines* tokens those blocks read.
- **Light-only, zero-JS.** No `client:*`, no theme-toggle script — every page must stay free of hydration islands / `<script>`.
- **Tokens are the knobs.** Every taste choice (fonts, accent, radius, measures, type scale) is a CSS variable on `:root` with a sensible default. Changing a token restyles the site. "Sans body / indigo / those widths" are *defaults*, not hardcodes.
- **Block tokens reuse the admin's names + values** (so `@saytu/blocks/callout.css` renders themed and matches the editor): `--accent #4f46e5`, `--accent-strong #4338ca`, `--accent-soft`, `--bg #f7f7f8`, `--surface-2 #fbfbfc`, `--canvas #fff`, `--text #1a1a1f`, `--text-2 #54545d`, `--green #15935a`/`--green-soft`, `--amber #b7791f`/`--amber-soft`, `--red #d1453b`/`--red-soft`, `--r-md`/`--r-sm`, `--font-ui`.
- **Only `apps/saytu-site/**` changes** (+ `pnpm-lock.yaml` only if deps shifted — they shouldn't). No `packages/*`, no `apps/saytu-admin/**`, no content write/round-trip path.
- **Out of scope:** the admin "Theme options" panel (3c); theme-as-swappable-`@saytu/theme-*` + config override (3b); dark mode; post listing/archive/pagination/RSS/search; the editor→disk bridge.
- Final state: `pnpm -r test` green (core 175, blocks 8, admin 178, the site suite extended), both apps build.

---

## File Structure

```
apps/saytu-site/
  src/
    styles/
      theme.css            NEW — the token layer (:root knobs + block tokens). Task 1.
      site.css             MODIFIED — body/header/footer (T1), measures (T2), token-driven prose (T3)
    layouts/
      Layout.astro         NEW — html/head(fonts+css)/header/footer/<slot>. Task 1.
      PostLayout.astro      NEW — wraps Layout; narrow container (--measure-post). Task 2.
      PageLayout.astro      NEW — wraps Layout; wider container (--measure-page). Task 2.
    pages/
      [...path].astro      MODIFIED — render through Layout (T1) → pick Post/Page by collection (T2)
      index.astro          NEW — home route → root page entry. Task 2.
  content/
    page/en/home.mdoc      NEW fixture (home). Task 2.
    page/en/about.mdoc     NEW fixture (a page). Task 2.
  test/
    render.test.ts         MODIFIED — theme/shell/template/prose assertions (all tasks)
```

`render.test.ts` builds the site once in `beforeAll` and reads `dist/<route>/index.html` via a `page(route)` helper (already exists from #1). Routes: a post is at `post/kitchen-sink`, a page at `page/about`, the home at `` (root `dist/index.html`).

---

### Task 1: Token layer + Layout shell

**Files:**
- Create: `apps/saytu-site/src/styles/theme.css`, `apps/saytu-site/src/layouts/Layout.astro`
- Modify: `apps/saytu-site/src/styles/site.css`, `apps/saytu-site/src/pages/[...path].astro`, `apps/saytu-site/test/render.test.ts`

**Interfaces:**
- Produces: `Layout.astro` — an Astro component with `Props { title: string }` and a default `<slot/>`; imports `theme.css` + `site.css`, renders the html/head (fonts + title) + a `.site-header` (brand + nav) + `<main>` + `.site-footer`. Tokens on `:root` (see theme.css).

- [ ] **Step 1: Create `apps/saytu-site/src/styles/theme.css`**

```css
/* Saytu default theme — token layer. Every taste choice is a knob with a default;
   change a token and the site restyles. Block tokens (names + values) are shared with
   the editor (apps/saytu-admin tokens.css) so @saytu/blocks render themed + matching. */
:root {
  /* ---- Identity knobs (defaults — the customization surface) ---- */
  --font-heading: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-body: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --text-base: 1.0625rem;
  --h1: 2.5rem;
  --h2: 1.6rem;
  --h3: 1.25rem;
  --measure-post: 38rem;
  --measure-page: 64rem;
  --radius-base: 10px;

  /* ---- Accent ---- */
  --accent: #4f46e5;
  --accent-strong: #4338ca;
  --accent-soft: color-mix(in oklch, var(--accent) 12%, transparent);
  --on-accent: #ffffff;

  /* ---- Block tokens (shared names+values with the editor so blocks match) ---- */
  --bg: #f7f7f8;
  --surface-2: #fbfbfc;
  --canvas: #ffffff;
  --border: #e8e8ec;
  --text: #1a1a1f;
  --text-2: #54545d;
  --green: #15935a;
  --green-soft: color-mix(in oklch, #15935a 12%, transparent);
  --amber: #b7791f;
  --amber-soft: color-mix(in oklch, #b7791f 14%, transparent);
  --red: #d1453b;
  --red-soft: color-mix(in oklch, #d1453b 11%, transparent);

  /* ---- Radius (consumed by blocks) ---- */
  --r-md: var(--radius-base);
  --r-sm: calc(var(--radius-base) * 0.6);

  /* ---- Alias the block font token to the theme body so callouts use the theme face ---- */
  --font-ui: var(--font-body);
}
```

- [ ] **Step 2: Add body/header/footer rules to `apps/saytu-site/src/styles/site.css`** (prepend these; leave the existing `.prose` rules for now — Task 3 rewrites them)

```css
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.site-header { display: flex; align-items: center; gap: 1.5rem; max-width: var(--measure-page); margin: 0 auto; padding: 1.25rem; }
.site-header .brand { font-family: var(--font-heading); font-weight: 800; letter-spacing: -.02em; font-size: 1.15rem; color: var(--text); text-decoration: none; }
.site-header nav { display: flex; gap: 1.1rem; margin-left: auto; font-size: .95rem; }
.site-header nav a { color: var(--text-2); text-decoration: none; }
.site-header nav a:hover { color: var(--text); }
.site-footer { max-width: var(--measure-page); margin: 4rem auto 0; padding: 1.5rem 1.25rem; border-top: 1px solid var(--border); color: var(--text-2); font-size: .9rem; }
```

- [ ] **Step 3: Create `apps/saytu-site/src/layouts/Layout.astro`**

```astro
---
import '../styles/theme.css'
import '../styles/site.css'

interface Props {
  title: string
}
const { title } = Astro.props
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">Saytu</a>
      <nav>
        <a href="/">Home</a>
        <a href="/page/about">About</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer class="site-footer">Built with Saytu</footer>
  </body>
</html>
```

- [ ] **Step 4: Refactor `apps/saytu-site/src/pages/[...path].astro` to render through `Layout`**

```astro
---
import Layout from '../layouts/Layout.astro'
import { getCollection, render } from 'astro:content'
import { toUrlPath } from '../lib/url'

export async function getStaticPaths() {
  const all = await getCollection('entries')
  return all.map((entry) => ({ params: { path: toUrlPath(entry.id) }, props: { entry } }))
}

const { entry } = Astro.props
const { Content } = await render(entry)
const title = (entry.data as { title?: string }).title ?? entry.id
---

<Layout title={title}>
  <article class="prose">
    <h1>{title}</h1>
    <Content />
  </article>
</Layout>
```
(This drops the inline `import '../styles/site.css'` + the hand-written `<html>` — `Layout` owns them now.)

- [ ] **Step 5: Write the failing assertions in `apps/saytu-site/test/render.test.ts`** (append a new `describe` at the end)

```ts
describe('default theme — shell + tokens', () => {
  it('renders the header (brand + nav) and footer', () => {
    expect(html).toContain('class="site-header"')
    expect(html).toContain('class="brand"')
    expect(html).toContain('Saytu')
    expect(html).toContain('class="site-footer"')
    expect(html).toContain('Built with Saytu')
  })
  it('loads the theme web fonts', () => {
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('Hanken+Grotesk')
  })
  it('applies the theme tokens (callout is themed, not bare fallback)', () => {
    // theme.css defines --accent etc.; with Astro inlining small CSS the token def
    // lands in the page. (If the build LINKS theme.css instead, assert the stylesheet
    // <link> is present and read the css file — see note below.)
    expect(html).toContain('#4f46e5') // --accent value from theme.css
    expect(html).toContain('class="blk-callout tone-amber"') // callout still rendered
    expect(html).toContain('<svg') // real icon, not 💡
  })
  it('ships zero JS (no hydration island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 6: Run, expect FAIL, then implement (Steps 1–4), then PASS**

Run: `pnpm --filter @saytu/site test`
Expected: PASS once Steps 1–4 are in place.
**Build-output note (verify, like the #1 CSS-inline finding):** after the first build, open `apps/saytu-site/dist/post/kitchen-sink/index.html`. (a) If `theme.css` is **inlined** (`<style>… --accent:#4f46e5 …`), the `#4f46e5` assertion holds as written. (b) If Astro **links** it (`<link rel="stylesheet" href="/_astro/…css">`), change that one assertion to assert the `<link rel="stylesheet">` is present AND read the emitted CSS file to confirm `--accent`. (c) Confirm the Google Fonts `<link>` actually lands in the built `<head>` — if Astro hoists/transforms it, adjust the `fonts.googleapis.com` assertion to the real emitted form. Report which branch you took.

- [ ] **Step 7: Commit**

```bash
git add apps/saytu-site
git commit -m "feat(site): default theme token layer + Layout shell (header/footer/fonts)"
```

---

### Task 2: Post + Page templates by collection + home route

**Files:**
- Create: `apps/saytu-site/src/layouts/PostLayout.astro`, `apps/saytu-site/src/layouts/PageLayout.astro`, `apps/saytu-site/src/pages/index.astro`, `apps/saytu-site/content/page/en/home.mdoc`, `apps/saytu-site/content/page/en/about.mdoc`
- Modify: `apps/saytu-site/src/styles/site.css`, `apps/saytu-site/src/pages/[...path].astro`, `apps/saytu-site/test/render.test.ts`

**Interfaces:**
- Consumes: `Layout` (Task 1).
- Produces: `PostLayout.astro` / `PageLayout.astro` — each `Props { title: string }`, wrap `Layout`, render `<article class="prose measure-post|measure-page"><slot/></article>`.

- [ ] **Step 1: Add the measure classes to `apps/saytu-site/src/styles/site.css`**

```css
.measure-post { max-width: var(--measure-post); margin: 0 auto; }
.measure-page { max-width: var(--measure-page); margin: 0 auto; }
```

- [ ] **Step 2: Create the two template layouts**

`apps/saytu-site/src/layouts/PostLayout.astro`:
```astro
---
import Layout from './Layout.astro'
interface Props { title: string }
const { title } = Astro.props
---
<Layout title={title}>
  <article class="prose measure-post"><slot /></article>
</Layout>
```

`apps/saytu-site/src/layouts/PageLayout.astro`:
```astro
---
import Layout from './Layout.astro'
interface Props { title: string }
const { title } = Astro.props
---
<article class="prose measure-page" slot=""><slot /></article>
```
Wait — keep it parallel to PostLayout (wrap Layout):
```astro
---
import Layout from './Layout.astro'
interface Props { title: string }
const { title } = Astro.props
---
<Layout title={title}>
  <article class="prose measure-page"><slot /></article>
</Layout>
```

- [ ] **Step 3: Switch `[...path].astro` to pick the template by collection + exclude the home entry**

```astro
---
import PostLayout from '../layouts/PostLayout.astro'
import PageLayout from '../layouts/PageLayout.astro'
import { getCollection, render } from 'astro:content'
import { toUrlPath } from '../lib/url'

export async function getStaticPaths() {
  const all = await getCollection('entries')
  return all
    .filter((entry) => entry.id !== 'page/en/home') // home renders at '/' via index.astro
    .map((entry) => ({ params: { path: toUrlPath(entry.id) }, props: { entry } }))
}

const { entry } = Astro.props
const { Content } = await render(entry)
const title = (entry.data as { title?: string }).title ?? entry.id
const collection = entry.id.split('/')[0]
const TemplateLayout = collection === 'post' ? PostLayout : PageLayout
---

<TemplateLayout title={title}>
  <h1>{title}</h1>
  <Content />
</TemplateLayout>
```
(A capitalized component held in a variable is renderable in Astro. The `prose`/`measure-*` wrapper now lives in the layout, so it's removed from here.)

- [ ] **Step 4: Create the home route `apps/saytu-site/src/pages/index.astro`**

```astro
---
import PageLayout from '../layouts/PageLayout.astro'
import { getEntry, render } from 'astro:content'

const entry = await getEntry('entries', 'page/en/home')
const { Content } = await render(entry!)
const title = (entry!.data as { title?: string }).title ?? 'Home'
---

<PageLayout title={title}>
  <h1>{title}</h1>
  <Content />
</PageLayout>
```

- [ ] **Step 5: Add the page fixtures**

`apps/saytu-site/content/page/en/home.mdoc`:
```markdown
---
title: Welcome to Saytu
---

A Git-backed CMS where content people run the site.

## What you can do

- Write in a rich editor
- Publish to Git
- Render with this theme
```

`apps/saytu-site/content/page/en/about.mdoc`:
```markdown
---
title: About
---

This is a standalone page, rendered with the wider Page template.
```

- [ ] **Step 6: Add failing assertions to `apps/saytu-site/test/render.test.ts`** (append)

```ts
describe('default theme — templates by collection', () => {
  it('renders a post with the narrow Post template', () => {
    const post = page('post/kitchen-sink')
    expect(post).toContain('class="prose measure-post"')
  })
  it('renders a page with the wider Page template', () => {
    const about = page('page/about')
    expect(about).toContain('class="prose measure-page"')
    expect(about).toContain('<h1>About</h1>')
  })
  it('renders the home page entry at the site root', () => {
    const home = page('') // dist/index.html
    expect(home).toContain('<h1>Welcome to Saytu</h1>')
    expect(home).toContain('class="prose measure-page"')
  })
})
```
(If `page('')` doesn't resolve `dist/index.html`, adjust the helper call to read `dist/index.html` directly — the home route is `/`.)

- [ ] **Step 7: Run, expect FAIL then PASS**

Run: `pnpm --filter @saytu/site test`
Expected: PASS — post uses `measure-post`, page + home use `measure-page`, home renders at root. (Confirm the dynamic-component-by-variable renders; if Astro errors on `<TemplateLayout>`, assign to a capitalized const as shown — that's the supported form.)

- [ ] **Step 8: Commit**

```bash
git add apps/saytu-site
git commit -m "feat(site): Post/Page templates by collection + home route"
```

---

### Task 3: Token-driven prose / typography

**Files:**
- Modify: `apps/saytu-site/src/styles/site.css`, `apps/saytu-site/test/render.test.ts`

- [ ] **Step 1: Replace the `.prose` block in `apps/saytu-site/src/styles/site.css`** (remove the old hardcoded `.prose*` rules from #1; keep the body/header/footer/measure rules added in Tasks 1–2) with token-driven prose:

```css
.prose { padding: 3rem 1.25rem 2rem; font-family: var(--font-body); font-size: var(--text-base); line-height: 1.7; color: var(--text); }
.prose > h1 { font-family: var(--font-heading); font-weight: 800; letter-spacing: -.03em; line-height: 1.1; font-size: var(--h1); margin: 0 0 .5rem; }
.prose h2 { font-family: var(--font-heading); font-weight: 800; letter-spacing: -.02em; line-height: 1.2; font-size: var(--h2); margin: 2.25rem 0 .75rem; }
.prose h3 { font-family: var(--font-heading); font-weight: 700; font-size: var(--h3); margin: 1.75rem 0 .5rem; }
.prose p { margin: 0 0 1.1rem; }
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.prose strong { font-weight: 700; }
.prose code { font-family: var(--font-mono); background: var(--surface-2); padding: .12em .35em; border-radius: var(--r-sm); font-size: .9em; }
.prose pre { background: var(--surface-2); padding: 1rem 1.1rem; border-radius: var(--r-md); overflow-x: auto; }
.prose pre code { background: none; padding: 0; }
.prose blockquote { border-left: 3px solid var(--accent); margin: 1.25rem 0; padding-left: 1rem; color: var(--text-2); }
.prose ul, .prose ol { padding-left: 1.3rem; }
.prose li { margin: .3rem 0; }
.prose li.task { list-style: none; margin-left: -1.2rem; }
.prose li.task input { margin-right: .5rem; }
.prose table { border-collapse: collapse; margin: 1.25rem 0; }
.prose th, .prose td { border: 1px solid var(--border); padding: .5rem .75rem; }
.prose th { font-family: var(--font-heading); font-weight: 700; }
```

- [ ] **Step 2: Add failing assertions to `apps/saytu-site/test/render.test.ts`** (append)

```ts
describe('default theme — prose typography', () => {
  it('drives prose typography from the theme tokens', () => {
    // emitted CSS (inlined or linked) references the theme fonts/accent for prose
    const css = themeCss() // helper: returns inlined <style> text OR the linked css file contents
    expect(css).toMatch(/\.prose[^{]*\{[^}]*var\(--font-body\)/)
    expect(css).toMatch(/\.prose h2[^{]*\{[^}]*var\(--font-heading\)/)
    expect(css).toMatch(/\.prose a[^{]*\{[^}]*var\(--accent\)/)
  })
})
```
Add the `themeCss()` helper near the top of the test file (after `page`): it returns the CSS the page actually uses. If the build inlines styles, return the concatenated `<style>` contents from `html`; if it links a stylesheet, read the referenced file under `dist/_astro/`. Concretely:
```ts
import { readdirSync } from 'node:fs'
function themeCss(): string {
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  if (styleBlocks.includes('.prose')) return styleBlocks
  // else linked: read all built css
  const astroDir = join(appDir, 'dist', '_astro')
  return readdirSync(astroDir).filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(astroDir, f), 'utf8')).join('\n')
}
```
(`readFileSync`/`join`/`appDir` already imported/defined in the file from #1.)

- [ ] **Step 3: Run, expect FAIL then PASS; confirm existing block tests still green**

Run: `pnpm --filter @saytu/site test`
Expected: PASS — prose references the tokens, and the existing callout/align/sub-sup/checklist/table assertions from #1/#2 stay green (the content still renders; only its typography is now token-driven). If a prior assertion breaks because the markup moved under `.prose measure-*`, adjust the selector in that assertion (do not weaken what it verifies).

- [ ] **Step 4: Commit**

```bash
git add apps/saytu-site
git commit -m "feat(site): token-driven prose typography"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo test suite**

Run: `pnpm -r test`
Expected: green — `@saytu/core` 175, `@saytu/blocks` 8, `apps/saytu-admin` 178 (untouched), `apps/saytu-site` (extended with the theme tests), all db/git suites.

- [ ] **Step 2: Both apps build**

Run: `pnpm --filter @saytu/site build && pnpm --filter @saytu/admin build`
Expected: both succeed. The site build emits the home (`dist/index.html`), post, and page routes; admin is untouched (sanity).

- [ ] **Step 3: Zero-JS holds across templates**

Run: `grep -rl 'astro-island\|<script' apps/saytu-site/dist --include=*.html || echo "zero-JS ✓"`
Expected: `zero-JS ✓` (no hydration islands / scripts in any built page).

- [ ] **Step 4: Scope guard**

Run: `git diff --name-only <branch-base>..HEAD | grep -vE '^(apps/saytu-site/|pnpm-lock.yaml)' && echo "SCOPE VIOLATION" || echo "scope clean"`
(`<branch-base>` = the commit the worktree branched from.)
Expected: `scope clean` — no `packages/**`, no `apps/saytu-admin/**`, no content write/round-trip path touched.

- [ ] **Step 5: Commit (only if verification fixups were needed)**

```bash
git add -A && git commit -m "chore(site): default theme final verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-saytu-default-theme-design.md`):
- §1 one identity (bold-sans/sans-body/indigo): theme.css tokens (T1) + prose (T3). ✓
- §1 Post (narrow) + Page (wider contained) by collection; docs cut: T2. ✓
- §2 token layer with defaults (customization-ready): T1 theme.css. ✓
- §2 Layout shell (head/fonts/header/footer): T1. ✓
- §2 prose/typography via tokens: T3. ✓
- §2 block theming verified (callout themed, matches editor): T1 assertion. ✓
- §2 minimal home (root page entry): T2 index.astro + home.mdoc. ✓
- §3 template selection by collection: T2 [...path].astro. ✓
- §6 build-and-assert (shell, selection, tokens, typography, zero-JS, home): T1–T4. ✓
- §7 success criteria + §2 out-of-scope (panel/packaging/dark/listings absent): scope guard T4. ✓

**2. Placeholder scan:** every code step has real CSS/Astro/TS; commands have expected output. The two intentional verify-then-branch points (T1 Step 6 inline-vs-linked CSS + fonts-in-head; T3 `themeCss()` inline-vs-linked) are concrete instructions with both branches written, not TBDs.

**3. Type consistency:** `Layout`/`PostLayout`/`PageLayout` all take `Props { title: string }` and a `<slot/>`, consistent T1/T2. Class names (`site-header`/`brand`/`site-footer`/`prose`/`measure-post`/`measure-page`) consistent across theme.css, site.css, the layouts, and the test assertions. `toUrlPath` (from `../lib/url`, #1) reused unchanged. The home entry id `page/en/home` is filtered in `[...path]` (T2) and fetched in `index.astro` (T2) — same string. Token names in theme.css (T1) match those the prose (T3) and `@saytu/blocks` consume. ✓
