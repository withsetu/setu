# Saytu Roadmap / Backlog

> Running list of **deliberately deferred** improvements — things we decided are worth
> doing but chose not to build in the increment where they came up, so we don't forget.
> Newest at the top. When one gets built, move it to the increment's spec and strike it
> here (or delete).

---

## Render / Theme layer

Vision + decomposition: `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`
(5 sub-projects; lean frame — default theme + tokens, AI/MCP an accelerant not the identity;
"write once" React core + generated editor/site shells; theme = HTML/CSS/tokens, React sealed).

### ~~Render pipeline #1 — content → static HTML~~ ✅ SHIPPED 2026-06-18 (`7ec53f1`)

`apps/saytu-site` (Astro 6 + `@astrojs/markdoc` + `@astrojs/react`) renders committed `.mdoc`
to static HTML (zero JS): standard nodes + callout (one React core + wrapper) + text-align +
sub/sup + checklist + table-column align. **Resolves the deferred render-time mappings**
(text-align + table-column alignment now actually render on the page). Default locale unprefixed
in URLs. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-saytu-render-pipeline*`.

**Next render-layer sub-projects (deferred, sequenced):**
- **#2 block component package** — extract the callout React core to a shared package + make
  the editor's node view reuse it (close the "write once" loop; no drift).
- **#3 theme / site layer** — default theme: layouts, header/footer/nav, tokens, the
  Rung-0 tokens (visual tweaks panel) + Rung-1 plain-HTML `.astro` + child-theme cascade.
- **#4 custom-component pipeline + codegen** — the `component.ts` contract fanning out to all
  3 planes; **this is where "tag set sourced from saytu.config" lands** (blocked in #1:
  `@astrojs/markdoc`'s config loader can't import core's TS source; codegen runs where it can).
- **#5 in-editor preview** — draft preview through the same theme + components, iframed.
- **permalink + i18n URL scheme** — the full locale-prefixing policy (#1 only strips the
  default `en`; config-driven default + non-default front-prefixing is its own slice).
- **dynamic Markdoc** (`{% if %}`/`{% for %}`/`$vars`) in passthrough — Pro/SSR, long-deferred.

### "View Site" / "View Page" links in the admin — preview vs live aware (added 2026-06-18)

**What (owner ask):** from the admin, give the writer **"View Site"** (site root) and **"View
Page"** (this entry's rendered URL) links. The system should **detect the entry's state and
label/target accordingly** — e.g. a not-yet-deployed entry → a **Preview** link (draft preview),
a deployed entry → **"View Live"** to the published URL.

**Why it's its own item (not trivial):** (a) it needs a **shared permalink util** — the admin
must derive the same URL the site renders (`apps/saytu-site/src/lib/url.ts` logic: collection/
locale/slug → URL, default locale unprefixed), so this couples to the deferred **permalink/i18n
scheme**. (b) "preview vs live" keys off the **derived lifecycle** (`deriveLifecycle` →
draft/staged/live) already in the admin — Live → real published URL; Draft/Staged → the **#5
in-editor/SSR preview** route (which doesn't exist yet). So this lands cleanly *after* #3 (a real
site/theme to view) and ideally alongside **#5 preview**. Small UI, but it's the seam that ties
the admin's lifecycle pill to actual rendered URLs.

## Tooling / DX

### Single command to launch all dev servers locally (added 2026-06-18)

**What (owner ask):** one command that boots **both** the admin (`@saytu/admin`, Vite :5173) and
the site (`@saytu/site`, Astro :4321) together for local dev — today they're launched separately
(`pnpm --filter @saytu/admin dev` / `pnpm --filter @saytu/site dev`). Add a root `dev` script
(e.g. `pnpm -r --parallel dev`, or a tiny `concurrently`/`turbo`-style runner with labeled,
colored output and clean shutdown). **Watch-outs:** fixed, non-colliding ports; prefix/label each
server's logs; one Ctrl-C kills both; don't let one crashing server orphan the other (the recurring
stale-dev-server gotcha). Pure DX — no product surface.

## Editor

### Editor feature wishlist — sequenced by content-model constraint (added 2026-06-16)

Owner dumped a feature wishlist during UAT of the enriched bubble. The gating factor is
**not** "add the Tiptap extension" — it's that **every new node/mark must round-trip through
Markdoc or it silently drops on publish** (the content-safety cardinal rule), plus a few need
the media backend or are render-time, plus a couple may be Tiptap **Pro** (Saytu is 100% OSS →
build-our-own if so). Grouped by that constraint:

### ~~Bubble v2 — Turn-into regroup + subscript/superscript + checklist~~ ✅ SHIPPED 2026-06-17 (3 slices)

- slice 1 (`53019b7`): Turn-into dropdown regrouped into categories (Heading → levels, List →
  bullet/numbered/checklist, Quote, Code, sub/sup together).
- slice 2 (`96f1fd5`): **Subscript/Superscript** marks — inline `{% sub %}`/`{% sup %}` Markdoc
  tags (the `node.inline = true` round-trip finding); + surfaced block-type shortcuts.
- slice 3 (`87aa69b`): **Checklist** (TaskList/TaskItem, GFM `- [ ]`/`- [x]`) **+ list-wide
  nesting** (recursive converter both directions; bullet/numbered/checklist, mixed, unlimited
  depth). **Note: GFM task lists needed NO Markdoc tokenizer work** — Markdoc treats `- [ ]` as a
  bullet with literal text and round-trips all nesting byte-clean, so all logic lives in our
  converter. Underline remains deferred (same inline-tag pattern available to reuse).

**New nodes/marks needing `@saytu/core` converter work first:**
- ~~**Tables**~~ ✅ SHIPPED 2026-06-17 (`276762d`): GFM pipe tables with per-column alignment.
  Core writes tables itself (`tableToGfm`) since Markdoc.format drops alignment; Markdoc stays the
  reader. `@tiptap/extension-table` (pinned 3.26.1) + cell `align` attr, slash insert, icon action
  menu, Tab/Shift-Tab cell nav + Tab-at-last-cell adds a row. No merged cells / resize / block-in-cell
  (GFM can't represent). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-saytu-tables*`.
- ~~**Text align**~~ ✅ SHIPPED 2026-06-17 (`8b42924`): L/C/R for paragraphs + headings via a Markdoc
  **node annotation** `{% align="center" %}` (read from `attributes.align`, written via the built
  node's `.annotations`; left emits nothing). `@tiptap/extension-text-align` + an L/C/R bubble group.
  Distinct from table-column alignment. Published-site rendering deferred to the render pipeline.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-saytu-text-align*`.
- **Text direction (RTL/LTR)** → `dir` attr; niche; same representation question — can reuse the
  node-annotation pattern established by text-align.

**Needs the media / render backend:**
- **Images** → Markdown `![alt](src)` round-trips, BUT image **upload** (where bytes go) needs the
  deferred **`ImagePort`/media pipeline** (PRD). Insert-by-URL is easy; upload is the real work.
  NOTE: the Tiptap **"image-node-pro"** UI component name suggests Pro — verify before use.
- **Code syntax highlighting** → code blocks already round-trip; highlighting is editor-DISPLAY via
  `@tiptap/extension-code-block-lowlight` (free MIT) + lowlight; main round-trip need is persisting
  the **language** (fence info string). Mostly additive/low-risk.

**Render-time / navigation (+ licensing to verify):**
- **Table of contents** → generated from headings, typically a render/theme concern, not stored
  content. The Tiptap ToC sits near **Pro** — VERIFY licensing; if Pro, build our own (it's a
  heading walk) or make it a theme/render feature.

**Licensing (HARD RULE, partially verified):** free MIT — Table, TextAlign, Subscript, Superscript,
TaskList, CodeBlockLowlight, Image. **To confirm not Pro-gated before committing:** Table-of-Contents,
the "image-node-pro" component.

### ~~Toolbar keyboard model — roving arrow nav + Esc-to-leave~~ ✅ SHIPPED 2026-06-16 (enriched bubble)

Done in the enriched-bubble increment (`974f1b5`): `useToolbarRoving` roving-tabindex (←/→ +
Home/End) on the format bubble + the callout style toolbar; Esc leaves (bubble collapses the
selection; callout returns the caret to its body).

**Why deferred (decided with owner):** build the bubble's full keyboard model **once, together
with the enriched format bubble** — that increment adds many more controls (headings/lists/
quote/color/…), which is exactly when arrow-navigation earns its keep and the focus order needs
designing as a whole. Doing it piecemeal now would be redone when the button set changes.

**Touches:** `FormatBubble.tsx` (roving tabindex + arrow handler on the `role="toolbar"`),
the callout node-view toolbar (`Callout.tsx`), Esc-to-leave wiring (reuse `dismiss.ts`).

### Per-link attributes — "open in new window" + `nofollow` (deferred 2026-06-16)

**What:** let a writer set, per link: **open in a new window** (`target="_blank"` + `rel="noopener"`) and **`nofollow`** (and likely its cousins `sponsored` / `ugc` later). Surfaced while designing the format bubble / link card increment.

**Why deferred (not just UI):** standard Markdown links `[text](url)` **cannot carry `target` or `rel`**, so supporting these means **extending the Markdoc link representation in the core round-trip** (`packages/core/src/markdoc/`) — e.g. attributed links serialize as a `{% link href=… target=… rel=… %}` tag while plain links stay clean `[text](url)` — plus round-trip tests (content-safety / cardinal rule), and eventually the renderer applying them. That's content-model work in `@saytu/core`, deliberately kept out of the editing-*feel* increment. Do it as its own tight slice.

**Note:** **"noindex" is NOT per-link** — it's a **page-level** directive (robots meta / `X-Robots-Tag`) that belongs in the SEO feature set (PRD §5), not on individual links. Per-link we only model `target` + `rel`.

**Touches:** `@saytu/core` markdoc converter (both directions) + round-trip tests; the link card / bubble UI (attribute toggles); later, the SSG/SSR renderer.

### Underline round-trip support (deferred 2026-06-16)

**What:** StarterKit v3 bundles an **Underline** mark, but the Markdoc round-trip
(`packages/core/src/markdoc/`) doesn't serialize underline (Markdown has no underline) — so it
would silently drop on publish. We **disabled underline** in the format-bubble increment
(`underline: false`) to avoid content loss. To offer underline later: extend the converter
(e.g. an `{% u %}` tag or HTML passthrough) + round-trip tests, then re-enable the mark and add
a bubble button.

**Touches:** `@saytu/core` markdoc converter + round-trip tests; StarterKit config; the format
bubble.

---
