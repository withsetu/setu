# Saytu Roadmap / Backlog

> Running list of **deliberately deferred** improvements — things we decided are worth
> doing but chose not to build in the increment where they came up, so we don't forget.
> Newest at the top. When one gets built, move it to the increment's spec and strike it
> here (or delete).

---

## Editor

### Editor feature wishlist — sequenced by content-model constraint (added 2026-06-16)

Owner dumped a feature wishlist during UAT of the enriched bubble. The gating factor is
**not** "add the Tiptap extension" — it's that **every new node/mark must round-trip through
Markdoc or it silently drops on publish** (the content-safety cardinal rule), plus a few need
the media backend or are render-time, plus a couple may be Tiptap **Pro** (Saytu is 100% OSS →
build-our-own if so). Grouped by that constraint:

**Bubble v2 — Turn-into regroup (owner's structure ask):** make the dropdown categories instead
of a flat list — **Heading** (→ levels), **List** (→ bullet / numbered / **checklist**), **Quote**
(separate), **Code** (separate), and **Subscript/Superscript** (together). The regroup itself is
UI over the existing `block-types.ts` registry, BUT it bundles two new round-trip types:
- **Checklist / task list** → GFM `- [ ]` / `- [x]`; needs a TaskList/TaskItem node + converter
  support (verify our Markdoc/markdown GFM task-list handling) + round-trip tests.
- **Subscript / Superscript** → no native Markdown; needs a Markdoc tag (`{% sub %}`/`{% sup %}`)
  or HTML passthrough + round-trip tests (same class as the deferred underline).

**New nodes/marks needing `@saytu/core` converter work first:**
- **Tables** → GFM tables (`| a | b |`); Tiptap table extensions are free MIT; needs converter
  both directions + round-trip tests + table UI/keyboard.
- **Text align** → no native Markdown; alignment is an attr on paragraph/heading → needs a Markdoc
  representation (`{% align %}` or class) + tests. Presentation-ish; confirm it belongs in content.
- **Text direction (RTL/LTR)** → `dir` attr; niche; same representation question.

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
