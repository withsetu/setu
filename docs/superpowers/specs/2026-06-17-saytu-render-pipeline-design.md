# Saytu Render Pipeline (sub-project #1) — Design

> Sub-project #1 of the render/theme layer. Parent vision + decomposition:
> `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`. Both render
> spikes (callout write-once; the four presentational blocks) PASSED and are recorded
> there; this spec turns those proven techniques into a buildable increment.

**Goal:** a runnable Astro app that reads committed `.mdoc` content and renders every
**shipped** editor block to correct, static HTML — the first time Saytu's authored content
becomes a visible website.

**Architecture:** a new `apps/saytu-site` Astro app using `@astrojs/markdoc` (+ `@astrojs/react`
for the one custom React component). Standard Markdoc nodes render natively; the editor's
custom constructs (callout, align, sub/sup, checklist, table-column align) are wired via
`markdoc.config` using the techniques the spikes proved. Read-only over content (the
content-safety cardinal rule is safe by construction). Lean: lean fully on Astro; **no
render abstraction, no codegen, no editor changes** in this increment.

**Tech stack:** Astro 6 · `@astrojs/markdoc` 1.x · `@astrojs/react` · React 18 · `@setu/core`
(for `resolveConfig`/`defaultConfig` + the content-path convention) · Vitest (build-and-assert).

---

## 1. Scope

### In scope
- A new `apps/saytu-site` Astro app that renders a **page per content entry** from a
  committed sample `content/` directory.
- Correct static-HTML rendering of every shipped block:
  - **Standard nodes** — headings, paragraphs, lists, blockquotes, code fences, horizontal
    rules, and marks (bold, italic, strike, inline code, links), plain GFM tables.
  - **Callout** — the one custom component, via a thin `.astro` wrapper around a single
    React core (the "write once" render path).
  - **Text align** — `{% align %}` node annotation on paragraph/heading → `text-align`.
  - **Sub/superscript** — `{% sub %}`/`{% sup %}` inline tags.
  - **Checklist** — GFM `- [ ]`/`- [x]` → read-only checkboxes.
  - **Table-column alignment** — per-column alignment from the GFM separator.
  - **Passthrough** — *static* preserved Markdoc renders normally.
- A deliberately **minimal, neutral** baseline stylesheet — enough to look intentional, not
  a designed theme.
- Build-and-assert HTML tests covering every block.

### Out of scope (named, anti-creep)
- **Page layout, header/footer/nav, index/listing pages, real visual design** → the theme
  (sub-project #3). #1 renders content bodies + a minimal title; it is not a navigable site.
- **Unifying editor + site onto one shared callout core** → sub-project #2. #1 authors the
  site's callout core standalone (shaped for later extraction), and does **not** modify
  `apps/saytu-admin`.
- **Codegen / auto-generated wrappers / zod→Markdoc attribute derivation** → sub-project #4.
- **The editor→disk content bridge** (Hono API + `git-local`). #1 reads a committed sample
  `content/` dir; wiring the live editor's output to on-disk Git is a separate increment.
- **Dynamic Markdoc** (`{% if %}`/`{% for %}`/`$variables`) inside passthrough → Pro/SSR,
  long-deferred. #1 renders *static* content only.
- **Code syntax highlighting** (roadmap), **in-editor preview** (#5), **SSR / multi-topology
  render** (topology note).

---

## 2. App structure & content source

```
apps/saytu-site/
  astro.config.mjs            integrations: markdoc(), react()
  markdoc.config.mjs          the render mapping (tags + node overrides) — the heart of #1
  package.json
  tsconfig.json
  content/                    committed SAMPLE content (the publish-service convention)
    post/en/hello-world.mdoc
    post/en/kitchen-sink.mdoc   exercises every block (the render fixture)
  src/
    content.config.ts         Astro collection(s) via a glob loader over content/**/*.mdoc
    pages/[...path].astro      minimal harness: one page per entry (NOT nav/index)
    components/
      Callout.tsx              the single React visual core (shaped for #2 extraction)
      CalloutWrapper.astro     thin site shell: maps tag attrs -> React props, <slot/> body
      Sub.astro / Sup.astro    <sub>/<sup>
      Paragraph.astro          node override: emits text-align from {% align %}
      Heading.astro            node override: preserves level + id, emits text-align
      Th.astro / Td.astro      node override: GFM column align -> style="text-align"
    styles/site.css            minimal neutral baseline
  test/
    render.test.ts             build-and-assert per block
```

**Content source & convention.** Entries live at `content/<collection>/<locale>/<slug>.mdoc`
— the exact path convention `@setu/core`'s publish service already writes
(`contentPath(ref)`). Each `.mdoc` is YAML frontmatter (metadata) + a Markdoc body, parsed
by the same `parseMdoc` shape the engine uses. The sample set is committed fixtures; there
is **no** live editor connection in #1.

**Routing harness.** A catch-all `src/pages/[...path].astro` does `getStaticPaths()` over the
collection and renders each entry to its own URL (`/post/en/hello-world`). This is the
minimal "page per entry" viewer — **not** navigation, listing, or layout (those are #3).

**Title handling.** The content model reserves `H1` for the rendered title (body uses H2+),
and the title lives in frontmatter. So the harness renders `frontmatter.title` into both
`<title>` and a single `<h1>`, then the Markdoc `<Content/>`. This is the minimum needed for
a faithful page; the theme (#3) refines its placement/markup.

---

## 3. The render mapping (`markdoc.config.mjs`) — proven techniques

All of the following are demonstrated working in `prototype/astro-preview` (pages `/preview`,
`/pres`). #1 ports them into `apps/saytu-site`.

### 3a. Standard nodes
Native `@astrojs/markdoc`. No config beyond the overrides below. Styled by the baseline CSS.

### 3b. Callout — the write-once React core
- `Callout.tsx`: a React component taking `type`, `title`, and **`children`** (the body).
  Renders `<aside class="callout callout--{type}">` with an icon, optional title, and the
  body. **No `client:*` directive → static HTML, zero JS** (interactivity would be an opt-in
  flag later). **Shaped for #2 extraction:** the editable regions (title, body) are passed in
  as props/children so the same core can later be wrapped by the editor's node view (which
  injects an `<input>` + `<NodeViewContent>`) and the site shell (which injects text +
  rendered children).
- `CalloutWrapper.astro`: the thin **site shell** — `import Callout from './Callout.tsx'`,
  maps tag attrs → props, forwards `<slot/>` as `children`.
- **Tag registration is config-aware, not hardcoded.** The site enumerates custom block tags
  from `resolveConfig(defaultConfig).blocks` (so "which custom tags exist" comes from
  `saytu.config`, not a magic string) and maps each to its wrapper component by convention.
  For #1's single block (callout), the attribute schema (`type`, `title`) is declared in the
  wiring; full **zod→Markdoc-attribute derivation is deferred to #4 (codegen)**.

### 3c. Text align — node overrides
`paragraph` and `heading` are overridden to **declare an `align` attribute** (the built-in
nodes reject the `{% align %}` annotation without it) and emit `style="text-align:…"` for
non-default alignment only (left/absent stays clean — mirrors the converter):

```js
nodes: {
  paragraph: { ...nodes.paragraph, render: component('./src/components/Paragraph.astro'),
               attributes: { ...nodes.paragraph.attributes, align: { type: String } } },
  heading:   { ...nodes.heading,   render: component('./src/components/Heading.astro'),
               attributes: { ...nodes.heading.attributes,   align: { type: String } } },
}
```
`Heading.astro` preserves the auto-generated `level` + `id`. Content uses the editor's
canonical **no-space** annotation form.

### 3d. Sub/superscript — inline tags
```js
tags: { sub: { render: component('./src/components/Sub.astro') },
        sup: { render: component('./src/components/Sup.astro') } }
```
Each component is one line (`<sub><slot/></sub>`).

### 3e. Checklist — custom `item` transform
markdown-it does not render GFM task lists (it emits literal `[ ] text`). A custom `item`
node `transform` (honored by `@astrojs/markdoc`) detects the marker on the item's first text
child, strips it, and prepends a **read-only** checkbox:

```js
const TASK_RE = /^\[( |x|X)\](?: |$)/        // mirrors the editor's marker regex
nodes: { item: { ...nodes.item, transform: itemTransform } }
// itemTransform: if children[0] is a string matching TASK_RE -> Markdoc.Tag('li',
//   { class:'task', 'data-checked': checked }, [<input type=checkbox checked? disabled>, ' ', rest])
//   else -> default <li>.
```
Renders `<li class="task" data-checked="true"><input type="checkbox" checked disabled/> …`.
**Loose (multi-paragraph) items** wrap text in a paragraph Tag → the transform inspects the
first paragraph's text instead of a bare string (the editor only supports first-paragraph
items today, so tight items are the live case; loose handling is included for safety).

### 3f. Table-column alignment
Markdoc emits `align` on `<th>`/`<td>` from the GFM separator **natively** (the built-in
`th`/`td` schemas already carry an `align` attribute — proven in the spike). Because the
`align` HTML attribute is valid-but-deprecated, #1 overrides the `th`/`td` render
(`Th.astro`/`Td.astro`) to read `align` and emit `style="text-align:…"` instead (clean CSS,
consistent with 3c). No round-trip risk; falling back to the native attr is a safe option if
the override proves fiddly.

### 3g. Passthrough
The editor's passthrough preserves content Markdoc can parse but the editor doesn't model.
*Static* such content renders through Markdoc normally. **Dynamic** Markdoc
(`{% if %}`/`{% for %}`/`$vars`) requires a runtime and is **out of scope** (Pro/SSR). If a
passthrough fixture contains an unregistered tag, that is treated as dynamic/Pro content and
excluded from #1's sample set (a documented limitation, not a silent drop).

---

## 4. Baseline styling

A single neutral `site.css`: readable prose typography, callout tones (the 6 default-theme
variants), task-list checkbox layout, `text-align` is inline so CSS only handles list/table
spacing, code-block mono, sub/sup defaults. Deliberately plain — **all real design is #3.**
No design tokens / theme system here.

---

## 5. Testing

**Build-and-assert** (the spike's proven, non-flaky approach): a Vitest test builds the site
(or a fixture subset) and asserts per-block substrings in the generated HTML for
`kitchen-sink.mdoc` — one assertion group per block:
- callout: `class="callout callout--warning"`, the React `data-component`, body markdown intact
- align: `style="text-align:center"` on a paragraph + a heading
- sub/sup: `<sub>2</sub>`, `<sup>2</sup>`
- checklist: `data-checked="true"` + `<input type="checkbox" checked disabled`
- table align: `style="text-align:right"` (or the chosen class) on the right column
- a "zero-JS" assertion: no hydration island / no `<script>` referenced by the page
- standard nodes: a representative bold/link/list/code assertion

Existing `@setu/core` + `apps/saytu-admin` test suites are untouched and stay green.

---

## 6. Success criteria

1. `apps/saytu-site` builds and renders a page per sample entry.
2. Every shipped block renders to correct static HTML per §3 (proven by §5 tests).
3. Zero JS shipped for static content (no hydration island).
4. The callout renders through a single React core via a wrapper, with its tag known from
   `saytu.config` rather than hardcoded.
5. No changes to `apps/saytu-admin` or any content write/round-trip path.
6. Out-of-scope items (§1) are absent — no theme, codegen, SSR, or editor bridge crept in.

---

## 7. Risks & decisions

- **zod→Markdoc attribute derivation deferred (#4).** #1 hand-declares the callout's
  attributes in the wiring while sourcing the *tag set* from `saytu.config`. Accepted: one
  block, low duplication, clean seam for #4.
- **Brief two-callout window.** The site's callout core duplicates the editor's node view
  until #2 extracts a shared core. Mitigated by authoring the core in the
  injectable-regions shape so #2's extraction is mechanical; recorded as #2's explicit job.
- **`@setu/core` import surface.** The site (Node build) may use the Node-capable barrel;
  unlike the browser admin it has no jiti/bundle constraint. Use `resolveConfig`/
  `defaultConfig` (pure) — avoid pulling `loadConfig` unless a real `saytu.config.ts` load is
  wanted (it is not, for #1; `defaultConfig` suffices).
- **Loose list items / passthrough-dynamic** — bounded limitations documented in §3e/§3g.

---

See [[saytu-project]] and the topology/publishing note
(`docs/superpowers/specs/2026-06-14-saytu-topology-publishing-note.md`) — keep render a
topology concern; do not leak a stored per-entry `deployed` flag into core.
