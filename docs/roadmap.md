# Saytu Roadmap / Backlog

> Running list of **deliberately deferred** improvements — things we decided are worth
> doing but chose not to build in the increment where they came up, so we don't forget.
> Newest at the top. When one gets built, move it to the increment's spec and strike it
> here (or delete).

---

## Editor

### Toolbar keyboard model — roving arrow nav + Esc-to-leave (deferred 2026-06-16 → enriched bubble)

**What:** a proper WAI-ARIA **toolbar keyboard pattern** for the editor's floating toolbars —
the **format bubble** and the **callout color/icon toolbar**: one roving `tabindex` so the
toolbar is a single tab stop, **Left/Right arrows** move between its buttons, and **Esc** leaves
the toolbar (returns focus/caret to the editor; for the callout toolbar, dismisses the
`:focus-within` chrome). Surfaced in UAT of the Esc-dismiss increment (owner: Shift+Tab reaches
the toolbar but arrows don't navigate within it; callout color/icon bubble doesn't Esc-away).

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
