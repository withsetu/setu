# Render Pipeline (sub-project #1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/site`, an Astro app that renders every shipped editor block to correct static HTML from committed sample `.mdoc` content — the first time Saytu's authored content becomes a visible website.

**Architecture:** A new Astro app using `@astrojs/markdoc` (standard nodes render natively) plus `@astrojs/react` for the one custom React component (the callout). The editor's custom constructs are wired in `markdoc.config.mjs` via the exact techniques proven in `prototype/astro-preview`: a thin `.astro` wrapper around a single React core (callout), node overrides emitting `text-align` (align, table columns), inline tag components (sub/sup), and a custom `item` transform (checklist). Read-only over content; no editor changes; no render abstraction, codegen, or theme.

**Tech Stack:** Astro 6.4.6 · `@astrojs/markdoc` 1.0.6 · `@astrojs/react` 5.0.7 · React 18.3.1 · `@setu/core` (`resolveConfig`/`defaultConfig`) · Vitest ^2.1.8 (build-and-assert).

## Global Constraints

- **Pin dependencies EXACT** (no `^`): `astro` `6.4.6`, `@astrojs/markdoc` `1.0.6`, `@astrojs/react` `5.0.7`, `react` `18.3.1`, `react-dom` `18.3.1`, `@types/react` `18.3.12`, `@types/react-dom` `18.3.1`. `vitest` matches the workspace value `^2.1.8`. (Matches the repo's pin-exact discipline for framework deps.)
- **No changes to `apps/admin`, `packages/core`, or any content write / round-trip path.** This increment is read-only over content; the content-safety cardinal rule holds by construction. The ONLY allowed edit outside `apps/site/` is adding build deps to the root `package.json` `pnpm.onlyBuiltDependencies` (Astro needs `sharp`).
- **Lean — do NOT build:** theme / layout / nav / index-listing pages, a shared-core editor refactor, codegen or zod→Markdoc attribute derivation, the editor→disk bridge, dynamic Markdoc (`{% if %}`/`{% for %}`/`$vars`) / SSR, syntax highlighting.
- **Content model:** the body uses `H2+`; `H1` is reserved for the title, which comes from frontmatter. The editor's canonical `{% align %}` form has **no space** before `{%`. Published checklists render **read-only** (`disabled`) checkboxes.
- **`@setu/core` is importable from the Astro app** (both `markdoc.config.mjs` and `.astro`/`.tsx` files) — verified: `@astrojs/markdoc` loads its config through a TS-capable loader, and Astro/Vite transpiles the workspace TS dep. Use the main barrel: `import { resolveConfig, defaultConfig } from '@setu/core'`.
- **Tests are build-and-assert:** a Vitest test runs `astro build` once in `beforeAll` and asserts substrings in the generated `dist/**/index.html`. Existing suites stay green.

---

## File Structure

```
apps/site/
  package.json                 @setu/site; deps pinned exact; scripts dev/build/test
  tsconfig.json                extends astro/tsconfigs/strict
  astro.config.mjs             integrations: markdoc(), react()
  markdoc.config.mjs           THE render mapping — grows across Tasks 2-6
  vitest.config.ts             node env; includes test/**/*.test.ts
  content/                     committed SAMPLE content (publish-service path convention)
    post/en/kitchen-sink.mdoc  one fixture exercising every block (grows across tasks)
  src/
    content.config.ts          collection `entries` via glob loader over content/**/*.mdoc
    pages/[...path].astro       page-per-entry harness + title <h1> from frontmatter
    components/
      Callout.tsx              single React visual core (shaped for #2 extraction)
      CalloutWrapper.astro     site shell: tag attrs -> React props, <slot/> -> children
      Sub.astro                <sub><slot/></sub>
      Sup.astro                <sup><slot/></sup>
      Paragraph.astro          node override: {% align %} -> style="text-align"
      Heading.astro            node override: level + id preserved, {% align %} -> style
      Th.astro                 node override: GFM column align -> style="text-align"
      Td.astro                 node override: GFM column align -> style="text-align"
    styles/site.css            minimal neutral baseline
  test/
    render.test.ts             build-and-assert per block (grows across tasks)
```

`markdoc.config.mjs`, `content/post/en/kitchen-sink.mdoc`, and `test/render.test.ts` are **shared, growing files** — each task appends to them. Every task shows the exact addition.

---

### Task 1: Scaffold the app + standard nodes + frontmatter title

**Files:**
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/astro.config.mjs`, `apps/site/markdoc.config.mjs`, `apps/site/vitest.config.ts`, `apps/site/src/content.config.ts`, `apps/site/src/pages/[...path].astro`, `apps/site/src/styles/site.css`, `apps/site/content/post/en/kitchen-sink.mdoc`
- Test: `apps/site/test/render.test.ts`
- Modify: root `package.json` (`pnpm.onlyBuiltDependencies`: add `"sharp"`)

**Interfaces:**
- Produces: the built page for the entry id `post/en/kitchen-sink` at `dist/post/en/kitchen-sink/index.html`; a `page(route)` test helper; an `html` module variable holding the kitchen-sink HTML for later tasks' assertions.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@setu/site",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "test": "vitest run"
  },
  "dependencies": {
    "@astrojs/markdoc": "1.0.6",
    "@astrojs/react": "5.0.7",
    "@setu/core": "workspace:*",
    "astro": "6.4.6",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create configs**

`apps/site/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

`apps/site/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config'
import markdoc from '@astrojs/markdoc'
import react from '@astrojs/react'

export default defineConfig({
  integrations: [markdoc(), react()],
})
```

`apps/site/markdoc.config.mjs` (minimal; grows in Tasks 2-6):
```js
import { defineMarkdocConfig } from '@astrojs/markdoc/config'

export default defineMarkdocConfig({})
```

`apps/site/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
```

`apps/site/src/content.config.ts`:
```ts
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

// One collection over all content; entry.id is the path minus extension, e.g.
// "post/en/kitchen-sink" (collection/locale/slug — the publish-service convention).
const entries = defineCollection({
  loader: glob({ pattern: '**/*.mdoc', base: './content' }),
})

export const collections = { entries }
```

`apps/site/src/pages/[...path].astro`:
```astro
---
import { getCollection, render } from 'astro:content'

export async function getStaticPaths() {
  const all = await getCollection('entries')
  return all.map((entry) => ({ params: { path: entry.id }, props: { entry } }))
}

const { entry } = Astro.props
const { Content } = await render(entry)
const title = (entry.data as { title?: string }).title ?? entry.id
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <link rel="stylesheet" href="/src/styles/site.css" />
  </head>
  <body>
    <main class="prose">
      <h1>{title}</h1>
      <Content />
    </main>
  </body>
</html>
```

`apps/site/src/styles/site.css` (minimal placeholder; fleshed out in Task 7):
```css
.prose { max-width: 42rem; margin: 2rem auto; font-family: system-ui, sans-serif; line-height: 1.6; }
```

- [ ] **Step 3: Create the fixture `apps/site/content/post/en/kitchen-sink.mdoc`** (standard nodes only; later tasks append)

```markdown
---
title: Kitchen Sink
status: draft
---

A paragraph with **bold**, *italic*, `code`, and a [link](https://example.com).

## A subheading

- one
- two

> a quote
```

- [ ] **Step 4: Add `sharp` to the root build allow-list**

In the repo root `package.json`, ensure `pnpm.onlyBuiltDependencies` contains `"sharp"` alongside the existing entries (`esbuild`, `better-sqlite3`). Then from the repo root run `pnpm install` so the new workspace app + Astro's native deps are linked and built.

Run: `pnpm install`
Expected: completes; `apps/site/node_modules` (or the workspace link) present.

- [ ] **Step 5: Write the failing smoke test `apps/site/test/render.test.ts`**

```ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
export let html = ''

function page(route: string): string {
  return readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
}

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('post/en/kitchen-sink')
})

describe('render pipeline — standard nodes', () => {
  it('renders the frontmatter title as the page h1', () => {
    expect(html).toContain('<h1>Kitchen Sink</h1>')
  })
  it('renders marks and a link', () => {
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })
  it('renders a body subheading (H2, not the title H1)', () => {
    expect(html).toContain('<h2 id="a-subheading">A subheading</h2>')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL (the app does not build / files missing) before Steps 1–5 are complete; once 1–5 exist, this is the green target.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS — 3 assertions green; `astro build` emits `dist/post/en/kitchen-sink/index.html`.

- [ ] **Step 8: Commit**

```bash
git add apps/site package.json pnpm-lock.yaml
git commit -m "feat(site): scaffold apps/site render app + standard nodes"
```

---

### Task 2: Callout — single React core via wrapper, tag sourced from setu.config

**Files:**
- Create: `apps/site/src/components/Callout.tsx`, `apps/site/src/components/CalloutWrapper.astro`
- Modify: `apps/site/markdoc.config.mjs`, `apps/site/content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: `resolveConfig`, `defaultConfig` from `@setu/core` — `resolveConfig(defaultConfig).blocks` is `ResolvedBlock[]`, each `{ tag: string, props, component, editor }`. `defaultConfig` ships one block with `tag: 'callout'`.
- Produces: a `{% callout type title %}` tag rendering `<aside class="callout callout--{type}" data-component="Callout.tsx">` with **zero shipped JS**.

- [ ] **Step 1: Write the React core `apps/site/src/components/Callout.tsx`**

```tsx
import type { ReactNode } from 'react'

interface Props {
  type?: string
  title?: string
  children?: ReactNode
}

// The single React visual core — authored here for now; sub-project #2 extracts it to
// a shared package and makes the editor's node view reuse it. Editable regions (title,
// body) are injectable so the editor shell can later pass an <input> + <NodeViewContent>.
// No client directive on the site => static HTML, zero JS.
export default function Callout({ type = 'info', title, children }: Props) {
  return (
    <aside className={`callout callout--${type}`} data-component="Callout.tsx">
      <span className="callout__icon" aria-hidden>💡</span>
      <div className="callout__body">
        {title ? <p className="callout__title">{title}</p> : null}
        {children}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Write the site shell `apps/site/src/components/CalloutWrapper.astro`**

```astro
---
// Thin site shell (codegen will emit this in #4). Maps tag attrs -> React props and
// forwards the rendered body via <slot/> as children. No client:* => static HTML.
import Callout from './Callout.tsx'
const { type = 'info', title } = Astro.props
---

<Callout type={type} title={title}>
  <slot />
</Callout>
```

- [ ] **Step 3: Wire the tag from config in `apps/site/markdoc.config.mjs`** (replace the whole file)

```js
import { defineMarkdocConfig, component } from '@astrojs/markdoc/config'
import { resolveConfig, defaultConfig } from '@setu/core'

// Render wrappers for custom blocks, keyed by tag. Codegen (#4) will generate these +
// derive attributes from each block's zod schema; for now they are authored by hand.
const BLOCK_WRAPPERS = {
  callout: {
    render: component('./src/components/CalloutWrapper.astro'),
    attributes: {
      type: { type: String, default: 'info' },
      title: { type: String },
    },
  },
}

// Source the custom-tag SET from setu.config (not a hardcoded string). Fail loudly if a
// configured block has no wrapper yet — that's a real, surfaced gap, not a silent drop.
const customTags = {}
for (const block of resolveConfig(defaultConfig).blocks) {
  const wrapper = BLOCK_WRAPPERS[block.tag]
  if (!wrapper) throw new Error(`site: no render wrapper for config block "${block.tag}"`)
  customTags[block.tag] = wrapper
}

export default defineMarkdocConfig({
  tags: { ...customTags },
})
```

- [ ] **Step 4: Append a callout to the fixture `apps/site/content/post/en/kitchen-sink.mdoc`**

```markdown

{% callout type="warning" title="Heads up" %}
Callout body with **bold** inside.
{% /callout %}
```

- [ ] **Step 5: Add the failing assertions to `apps/site/test/render.test.ts`** (new `describe` block, appended)

```ts
describe('render pipeline — callout', () => {
  it('renders the callout via the React core with attrs + body', () => {
    expect(html).toContain('class="callout callout--warning"')
    expect(html).toContain('data-component="Callout.tsx"')
    expect(html).toContain('<p class="callout__title">Heads up</p>')
    expect(html).toContain('<strong>bold</strong>')
  })
  it('ships zero JS for static content (no hydration island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Steps 1–4 (build errors on the unregistered `callout` tag, or the callout assertions miss).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS — callout renders through the React core; zero-JS assertion holds.

- [ ] **Step 8: Commit**

```bash
git add apps/site
git commit -m "feat(site): callout via single React core + config-sourced tag"
```

---

### Task 3: Text alignment — paragraph + heading node overrides

**Files:**
- Create: `apps/site/src/components/Paragraph.astro`, `apps/site/src/components/Heading.astro`
- Modify: `apps/site/markdoc.config.mjs`, `apps/site/content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: the `{% align %}` node annotation on paragraph/heading (Markdoc rejects it unless the node declares an `align` attribute).
- Produces: `<p style="text-align:center">` / `<h2 ... style="text-align:right">` for non-default alignment; left/absent stays clean.

- [ ] **Step 1: Write `apps/site/src/components/Paragraph.astro`**

```astro
---
// Node override so the editor's {% align %} annotation renders. Emit a style only for
// non-default alignment (mirrors the converter: left/absent stays clean).
const { align } = Astro.props
const style = align && align !== 'left' ? `text-align:${align}` : undefined
---
<p style={style}><slot /></p>
```

- [ ] **Step 2: Write `apps/site/src/components/Heading.astro`**

```astro
---
// Node override for headings: preserve the level + auto-generated id, add {% align %}.
const { level = 1, id, align } = Astro.props
const Tag = `h${level}`
const style = align && align !== 'left' ? `text-align:${align}` : undefined
---
<Tag id={id} style={style}><slot /></Tag>
```

- [ ] **Step 3: Add node overrides to `apps/site/markdoc.config.mjs`**

Add `nodes` to the imports and the exported config. Change the import line to:
```js
import { defineMarkdocConfig, component, nodes } from '@astrojs/markdoc/config'
```
and change the `export default` to include a `nodes` block:
```js
export default defineMarkdocConfig({
  tags: { ...customTags },
  nodes: {
    paragraph: {
      ...nodes.paragraph,
      render: component('./src/components/Paragraph.astro'),
      attributes: { ...nodes.paragraph.attributes, align: { type: String } },
    },
    heading: {
      ...nodes.heading,
      render: component('./src/components/Heading.astro'),
      attributes: { ...nodes.heading.attributes, align: { type: String } },
    },
  },
})
```

- [ ] **Step 4: Append aligned content to the fixture** (`apps/site/content/post/en/kitchen-sink.mdoc`)

Use the editor's canonical **no-space** annotation form:
```markdown

This paragraph is centered.{% align="center" %}

This paragraph is right-aligned.{% align="right" %}
```

- [ ] **Step 5: Add failing assertions to `apps/site/test/render.test.ts`**

```ts
describe('render pipeline — text align', () => {
  it('emits text-align for non-default alignment', () => {
    expect(html).toContain('<p style="text-align:center">This paragraph is centered.</p>')
    expect(html).toContain('<p style="text-align:right">This paragraph is right-aligned.</p>')
  })
  it('leaves default-aligned paragraphs clean', () => {
    expect(html).toContain('<p>A paragraph with <strong>bold</strong>')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Steps 1–3 (Markdoc errors `Invalid attribute: 'align'`, or no `text-align` in output).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/site
git commit -m "feat(site): text-align via paragraph/heading node overrides"
```

---

### Task 4: Sub/superscript — inline tag components

**Files:**
- Create: `apps/site/src/components/Sub.astro`, `apps/site/src/components/Sup.astro`
- Modify: `apps/site/markdoc.config.mjs`, `apps/site/content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: the editor's `{% sub %}` / `{% sup %}` inline round-trip tags.
- Produces: `<sub>…</sub>` / `<sup>…</sup>`.

- [ ] **Step 1: Write the two components**

`apps/site/src/components/Sub.astro`:
```astro
<sub><slot /></sub>
```
`apps/site/src/components/Sup.astro`:
```astro
<sup><slot /></sup>
```

- [ ] **Step 2: Register the tags in `apps/site/markdoc.config.mjs`**

Add to the `tags` object in the exported config so it reads:
```js
  tags: {
    ...customTags,
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
  },
```

- [ ] **Step 3: Append to the fixture**

```markdown

Water is H{% sub %}2{% /sub %}O; Einstein wrote E = mc{% sup %}2{% /sup %}.
```

- [ ] **Step 4: Add failing assertions**

```ts
describe('render pipeline — sub/superscript', () => {
  it('renders sub and sup', () => {
    expect(html).toContain('H<sub>2</sub>O')
    expect(html).toContain('mc<sup>2</sup>')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Steps 1–2 (build errors on unregistered `sub`/`sup` tags).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/site
git commit -m "feat(site): sub/superscript inline tag rendering"
```

---

### Task 5: Checklist — custom `item` node transform

**Files:**
- Modify: `apps/site/markdoc.config.mjs`, `apps/site/content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: GFM task markers `- [ ]` / `- [x]` (stored literally; markdown-it renders them as literal `[ ] text` by default).
- Produces: `<li class="task" data-checked="true|false"><input type="checkbox" [checked] disabled/> …</li>`.

- [ ] **Step 1: Add the transform to `apps/site/markdoc.config.mjs`**

Add `Markdoc` to the config import:
```js
import { defineMarkdocConfig, component, nodes, Markdoc } from '@astrojs/markdoc/config'
```
Add this helper above the `export default` (after `customTags` is built):
```js
// Detect GFM task markers and render a read-only checkbox. Mirrors the editor's TASK_RE.
// Tight items expose the marker as a bare string child; loose (multi-paragraph) items
// wrap it in a paragraph Tag whose first child is then inspected.
const TASK_RE = /^\[( |x|X)\](?: |$)/
function itemTransform(node, config) {
  const children = node.transformChildren(config)
  let first = children[0]
  let target = children
  let isParagraph = false
  if (first instanceof Markdoc.Tag && Array.isArray(first.children)) {
    target = first.children
    first = target[0]
    isParagraph = true
  }
  if (typeof first === 'string') {
    const m = TASK_RE.exec(first)
    if (m) {
      const checked = m[1].toLowerCase() === 'x'
      const stripped = first.replace(TASK_RE, '')
      const rest = [stripped, ...target.slice(1)]
      const box = new Markdoc.Tag('input', { type: 'checkbox', checked, disabled: true })
      const body = isParagraph
        ? [box, ' ', new Markdoc.Tag('span', {}, rest), ...children.slice(1)]
        : [box, ' ', ...rest]
      return new Markdoc.Tag('li', { class: 'task', 'data-checked': String(checked) }, body)
    }
  }
  return new Markdoc.Tag('li', node.transformAttributes(config), children)
}
```
Add `item` to the `nodes` block in the exported config:
```js
    item: {
      ...nodes.item,
      transform: itemTransform,
    },
```

- [ ] **Step 2: Append a checklist to the fixture**

```markdown

- [ ] An unchecked task
- [x] A checked task
- [ ] Another todo
```

- [ ] **Step 3: Add failing assertions**

```ts
describe('render pipeline — checklist', () => {
  it('renders read-only checkboxes from GFM task markers', () => {
    expect(html).toContain('<li class="task" data-checked="false"><input type="checkbox" disabled')
    expect(html).toContain('<li class="task" data-checked="true"><input type="checkbox" checked disabled')
    expect(html).toContain('A checked task')
  })
  it('does not leak the literal marker text', () => {
    expect(html).not.toContain('[ ] An unchecked task')
    expect(html).not.toContain('[x] A checked task')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Step 1 (list items render literal `[ ] …`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS. (Note: the precise attribute order/spacing of the emitted `<input>` is Astro/Markdoc-controlled; if an assertion mismatches on whitespace, adjust the expected substring to the actual built output — do NOT change the transform to chase formatting.)

- [ ] **Step 6: Commit**

```bash
git add apps/site
git commit -m "feat(site): GFM checklist rendering via item transform"
```

---

### Task 6: Table-column alignment — th/td node overrides

**Files:**
- Create: `apps/site/src/components/Th.astro`, `apps/site/src/components/Td.astro`
- Modify: `apps/site/markdoc.config.mjs`, `apps/site/content/post/en/kitchen-sink.mdoc`, `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: the `align` attribute Markdoc emits natively on `th`/`td` from the GFM separator (`:--`/`:-:`/`--:`).
- Produces: `<th style="text-align:center">` / `<td style="text-align:right">` (clean CSS instead of the deprecated `align` HTML attribute).

- [ ] **Step 1: Write `apps/site/src/components/Th.astro` and `Td.astro`**

`Th.astro`:
```astro
---
const { align } = Astro.props
const style = align && align !== 'left' ? `text-align:${align}` : undefined
---
<th style={style}><slot /></th>
```
`Td.astro`:
```astro
---
const { align } = Astro.props
const style = align && align !== 'left' ? `text-align:${align}` : undefined
---
<td style={style}><slot /></td>
```

- [ ] **Step 2: Add th/td overrides to `apps/site/markdoc.config.mjs`**

Add to the `nodes` block:
```js
    th: {
      ...nodes.th,
      render: component('./src/components/Th.astro'),
      attributes: { ...nodes.th.attributes, align: { type: String } },
    },
    td: {
      ...nodes.td,
      render: component('./src/components/Td.astro'),
      attributes: { ...nodes.td.attributes, align: { type: String } },
    },
```

- [ ] **Step 3: Append an aligned table to the fixture**

```markdown

| Left | Center | Right |
| :--- | :----: | ----: |
| a1 | b1 | c1 |
| a2 | b2 | c2 |
```

- [ ] **Step 4: Add failing assertions**

```ts
describe('render pipeline — table column alignment', () => {
  it('emits text-align on aligned columns (clean CSS, not deprecated align attr)', () => {
    expect(html).toContain('<th style="text-align:center">Center</th>')
    expect(html).toContain('<th style="text-align:right">Right</th>')
    expect(html).toContain('<td style="text-align:right">c1</td>')
    expect(html).not.toContain('<td align=')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Steps 1–2 (cells render native `align=` attr, not `style`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS. (If overriding th/td proves fiddly, the safe fallback named in the spec is to keep Markdoc's native `align` attribute and drop this task's `style` assertion — but attempt the override first.)

- [ ] **Step 7: Commit**

```bash
git add apps/site
git commit -m "feat(site): table column alignment via th/td overrides"
```

---

### Task 7: Neutral baseline CSS + final verification

**Files:**
- Modify: `apps/site/src/styles/site.css`
- Create: `apps/site/README.md`
- Modify: `apps/site/content/post/en/kitchen-sink.mdoc` (add a static passthrough-style snippet), `apps/site/test/render.test.ts`

**Interfaces:**
- Consumes: every component/class emitted by Tasks 1–6.
- Produces: a deliberately neutral stylesheet + a README documenting scope; a final all-green build.

- [ ] **Step 1: Flesh out `apps/site/src/styles/site.css`** (neutral baseline — NOT a theme)

```css
.prose { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; line-height: 1.6; color: #1a1a1a; }
.prose h1 { font-size: 2rem; }
.prose h2 { font-size: 1.4rem; margin-top: 2rem; }
.prose code { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
.prose pre { background: #f6f6f6; padding: 1rem; overflow-x: auto; }
.prose blockquote { border-left: 3px solid #ddd; margin: 1rem 0; padding-left: 1rem; color: #555; }
.prose table { border-collapse: collapse; }
.prose th, .prose td { border: 1px solid #ddd; padding: 0.4rem 0.7rem; }
.prose li.task { list-style: none; margin-left: -1.2rem; }
.prose li.task input { margin-right: 0.4rem; }
.callout { display: flex; gap: 0.6rem; padding: 0.9rem 1rem; border-radius: 6px; margin: 1rem 0; background: #eef2ff; border: 1px solid #c7d2fe; }
.callout--warning { background: #fff7ed; border-color: #fed7aa; }
.callout--danger { background: #fef2f2; border-color: #fecaca; }
.callout--success { background: #f0fdf4; border-color: #bbf7d0; }
.callout__title { font-weight: 600; margin: 0 0 0.2rem; }
.callout__body { margin: 0; }
.callout__body :last-child { margin-bottom: 0; }
```

- [ ] **Step 2: Append a static passthrough-style snippet to the fixture**

Static preserved Markdoc (the kind the editor's passthrough keeps) renders natively. Confirm a representative snippet survives:
```markdown

A line with a hard break here.\
And the next line.
```

- [ ] **Step 3: Add the failing assertion + a guard that the title is the only H1**

```ts
describe('render pipeline — baseline + passthrough', () => {
  it('renders a hard break (static passthrough content)', () => {
    expect(html).toContain('<br')
  })
  it('emits exactly one h1 (the title); body uses h2+', () => {
    const h1s = html.match(/<h1[\s>]/g) ?? []
    expect(h1s.length).toBe(1)
  })
  it('links the baseline stylesheet', () => {
    expect(html).toContain('site.css')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @setu/site test`
Expected: FAIL before Steps 1–2 (no `<br`, or stylesheet link assertion depends on Task 1's `<link>` — adjust if the dev `/src/styles/site.css` href is rewritten by the build; assert on the emitted href substring `site.css`).

- [ ] **Step 5: Write `apps/site/README.md`**

```markdown
# @setu/site — render pipeline (sub-project #1)

Renders committed `.mdoc` content to static HTML, mapping every shipped editor block.
Read-only over content. NOT a theme: neutral baseline styling, page-per-entry only.

- Run: `pnpm --filter @setu/site dev` (preview) / `build` / `test`
- Render mapping: `markdoc.config.mjs` (callout via React core + wrapper; align/sub-sup/
  checklist/table-align via node overrides + tag components + the item transform).
- Out of scope (later sub-projects): theme/layout/nav (#3), shared-core editor refactor
  (#2), codegen (#4), editor->disk bridge, dynamic Markdoc/SSR, syntax highlighting.

See `docs/superpowers/specs/2026-06-17-saytu-render-pipeline-design.md`.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @setu/site test`
Expected: PASS — full suite green.

- [ ] **Step 7: Final verification — whole repo green, nothing out of scope**

Run: `pnpm -r test`
Expected: every package's suite passes, including the existing `@setu/core` + `apps/admin` suites (unchanged).

Run: `git diff --name-only main -- apps/admin packages/core | grep . && echo "SCOPE VIOLATION" || echo "scope clean"`
Expected: `scope clean` (no edits to the admin or core source — the only non-`apps/site` change is root `package.json` `onlyBuiltDependencies` + the lockfile).

- [ ] **Step 8: Commit**

```bash
git add apps/site
git commit -m "feat(site): neutral baseline CSS, passthrough check, README + final verify"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-17-saytu-render-pipeline-design.md`):
- §1 in-scope blocks: standard nodes (T1), callout (T2), align (T3), sub/sup (T4), checklist (T5), table-align (T6), passthrough-static (T7). ✓
- §2 app structure + content convention + `[...path].astro` routing + title H1 from frontmatter: T1. ✓
- §3 render techniques: each ported verbatim from the proven spike into T2–T6. ✓
- §3b tag sourced from `resolveConfig(defaultConfig)`, attrs hand-declared: T2. ✓
- §4 neutral baseline CSS: T1 (placeholder) + T7 (fleshed). ✓
- §5 build-and-assert per block incl. zero-JS: T1 harness + per-task `describe` blocks; zero-JS in T2. ✓
- §6 success criteria: builds (T1), every block (T2–T6), zero-JS (T2), config-sourced tag (T2), no admin/core edits (T7 scope check), no out-of-scope creep (Global Constraints + T7). ✓
- §7 risks: zod→Markdoc deferral noted in T2 comment; two-callout window is #2's job (noted T2 comment); `@setu/core` import surface verified (Global Constraints); loose-item handling in T5 transform. ✓

**2. Placeholder scan:** no TBD/“handle edge cases”/uncoded steps — every code step shows real code; every run step shows the command + expected result. ✓

**3. Type consistency:** `entries` collection name used in `content.config.ts` + `[...path].astro`; `block.tag` matches the `ResolvedBlock` shape read from source; `TASK_RE`, `itemTransform`, `BLOCK_WRAPPERS`, `customTags` names consistent T2/T5; class names (`callout--{type}`, `callout__title`, `li.task`, `data-checked`) consistent between emitting components (T2/T5) and the asserting tests + CSS (T7). ✓
