# Saytu Default Theme (sub-project #3a) — Design

> Slice **3a** of the render/theme epic (#3 = the theme/site layer). Parent vision:
> `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`. #1 content render ✅,
> #2 block component package ✅. #3 is sliced: **3a default theme (this)** → 3b theme
> *system* (swappable `@setu/theme-*` packages + config override) → 3c admin "Theme
> options" panel. The *look* was designed with the owner via the visual companion.

**Goal:** give the Saytu site a real, designed look — one typographic identity, a header/
footer shell, and **Post + Page** templates — built entirely from **tokens with sensible
defaults**, so it's customization-ready (change a token → the whole site restyles).

**Architecture:** the default theme lives in `apps/saytu-site` for 3a (a `Layout.astro`
shell + per-collection content templates + a `theme.css` token layer + prose styling).
Blocks (the `@setu/blocks` callout etc.) already style via `var(--token, fallback)`, so the
moment the theme defines the tokens, every block looks themed and matches the editor. Pure
CSS + Astro layouts — no new spike-class risk. (Packaging the theme as a swappable
`@setu/theme-*` and the admin options panel are **later slices**, 3b/3c.)

**Tech stack:** Astro 6 (`apps/saytu-site`) · CSS custom properties (tokens) · `@setu/blocks`
(unchanged) · theme web fonts (Hanken Grotesk + JetBrains Mono, matching the admin brand) ·
Vitest build-and-assert.

---

## 1. The look (decided with the owner)

- **One typographic identity, applied consistently** — modern **bold sans** headings (Hanken
  Grotesk), **sans body** (the chosen default), indigo accent. Templates differ in *layout*,
  never in type. (Serif-vs-sans, accent, etc. are token defaults, not locks — see §4.)
- **Two templates, chosen by collection:**
  - **Post** (`post` collection) — a **narrow contained** single column, editorial reading
    rhythm (generous line-height, comfortable measure ~`--measure-post`).
  - **Page** (`page` collection) — a **wider contained** column (bigger max-width, centered,
    **never full-bleed** — owner: "contained body… wider than post, but not full width"),
    a landing/standalone rhythm.
- **Shell:** a header (site name/logo + simple nav) and a footer, shared by both templates.
- **Docs layout: cut** from the default theme (owner's call).

## 2. Scope

### In scope
- **`theme.css` token layer** (§4): typography + accent + the block tokens + radius + the two
  content measures, each a CSS variable with a **sensible default**. Light theme.
- **`Layout.astro` shell**: `<html>`/`<head>` (title from frontmatter, theme fonts, `theme.css`),
  a **header** (site name + nav) and **footer**, wrapping a `<slot/>`.
- **Post + Page templates**: selected by the entry's **collection** (the first segment of
  `entry.id`); Post = narrow-contained layout, Page = wider-contained layout. Both use the
  one identity + the shell.
- **Prose/typography styling** for rendered content (heading scale, body, links, lists, code,
  blockquote, tables) driven by the tokens.
- **Block theming verified**: the callout (and other blocks) render with the theme tokens —
  matching the editor, no more bare fallbacks.
- **A minimal home**: a `page` entry at the site root renders as the homepage (so the site has
  a front door and the nav has somewhere to point). Static nav links for now.
- Build-and-assert tests (§6).

### Out of scope (named, anti-creep)
- **The admin "Theme options" panel** (turning the token knobs from the admin) → **3c**.
- **Theme as a swappable `@setu/theme-*` package + config-based component/token override** →
  **3b** (PRD §8). 3a builds the theme *in `apps/saytu-site`*; 3b extracts + packages it.
- **Dark mode** — the tokens are structured to allow a dark set later, but 3a ships **light
  only** (keeps the site zero-JS; a dark toggle/option is 3c/3b).
- **Post listing / archive / pagination, tags, RSS, search** — own surfaces, later.
- **The editor→disk bridge** — content edited in the admin still won't appear on the site
  (separate roadmap item); 3a renders the committed `.mdoc` fixtures, like #1.
- No `@setu/core` / `@setu/blocks` changes (the theme only *defines tokens* the blocks read).

## 3. Templates & selection

`apps/saytu-site/src/pages/[...path].astro` (the existing catch-all) chooses the template by
the entry's collection (first segment of `entry.id`, e.g. `post/en/hello` → `post`):
- `post` → **PostLayout** (narrow contained)
- `page` → **PageLayout** (wider contained)
- unknown/other → PageLayout (safe default)

Both layouts compose the shared **`Layout.astro`** (html/head/header/footer) and differ only
in their content wrapper's max-width + rhythm. The home route (`/`) renders the root `page`
entry through PageLayout. (The collection→template map is hand-wired in 3a; making it
theme-declared/config-driven is 3b.)

## 4. The token layer — customization-ready (the knobs)

`theme.css` defines, on `:root`, a token for every taste choice, with the agreed defaults.
**Two groups:**

**(a) Block tokens — reuse the admin's names + values** so `@setu/blocks/callout.css`
(which reads `var(--accent-soft, …)` etc.) renders themed + identical to the editor:
`--accent`, `--accent-strong`, `--accent-soft`, the tone colors (`--green`/`--green-soft`,
`--amber`/`--amber-soft`, `--red`/`--red-soft`), `--surface-2`, `--text`, `--text-2`, `--bg`,
`--canvas`, `--r-md`, `--r-sm`, `--font-ui` — ported from `apps/saytu-admin/src/styles/tokens.css`.

**(b) Theme identity tokens — the customization knobs (defaults in parentheses):**
- `--font-heading` (Hanken Grotesk, 800 weight feel) · `--font-body` (Hanken Grotesk / sans —
  the chosen default) · `--font-mono` (JetBrains Mono)
- a heading **type scale** + body size/line-height tokens
- `--measure-post` (~`38rem`, narrow) · `--measure-page` (~`64rem`, wider-contained)
- `--accent` default indigo (`#4f46e5`); `--radius-base` (10px)

Every one is a `var()` with a default — changing it restyles the site. **This is the whole
point: 3a is fully restyleable via tokens; 3c just adds friendly dials.** The body-face being
"sans" is the *default of `--font-body`*, not a hardcode.

**Fonts:** `Layout.astro` `<head>` loads the theme's web fonts (Hanken Grotesk + JetBrains
Mono — matching the admin brand) the same way the admin does (font `<link>`/self-host; a CSS
`@import` does NOT survive the build, per the admin's tokens.css note).

## 5. Shell

`Layout.astro`:
- `<head>`: `<meta charset>`, `<title>{frontmatter.title}</title>`, theme font links, `theme.css`.
- **Header**: the site name/logo (a token/config value, hardcoded default for 3a) + a small
  static nav.
- `<main>`: the content (the per-template wrapper + `<slot/>`).
- **Footer**: a simple "built with Saytu"-style footer (text configurable later).
- Light theme; no client JS (stays zero-JS like #1/#2).

## 6. Testing (build-and-assert, per the #1/#2 pattern)

A Vitest test builds the site and asserts on the generated HTML:
- **Shell present**: header (site name + nav) and footer render on a post page and a page.
- **Template selection**: a `post` entry uses the narrow Post layout and a `page` entry uses
  the wider Page layout (assert the distinguishing wrapper class / max-width hook differs).
- **Tokens applied**: `theme.css` is present and the callout renders **themed** — e.g. the
  amber callout shows the themed background (a real token value, not the bare `#fff7ed`
  fallback) and the SVG icon (carried over from #2, still no 💡).
- **Typography**: a body paragraph + heading carry the theme prose styling hooks.
- **Zero-JS**: no hydration island / `<script>` on the page.
- The home route (`/`) renders the root `page` entry.
Existing suites stay green (core 175, blocks 8, admin 178, + the site's other tests).

## 7. Success criteria
1. The site looks like a *designed* site: one identity (bold-sans/indigo), header + footer,
   Post (narrow) vs Page (wider-contained) templates by collection, a home route.
2. Every taste choice is a **token with a default** — changing a token restyles the site
   (customization-ready); nothing about the look is hardcoded beyond the defaults.
3. Blocks (callout) render **themed** and match the editor.
4. Light-only, zero-JS; whole repo green.
5. Out-of-scope items (theme options panel, packaging/swap, dark mode, listings, editor→disk)
   are absent.

## 8. Risks & decisions
- **No spike-class risk** — 3a is CSS tokens + Astro layouts + font loading, all well-trodden
  (catch-all routing + per-collection selection already proven in #1; blocks read tokens, proven
  in #2). Font loading mirrors the admin's working approach.
- **Token names reuse the admin's** (group a) so blocks match and there's one vocabulary; the
  theme is the *site's* values (currently = the admin's, for brand consistency + parity).
- **Theme lives in `apps/saytu-site` for 3a**; extraction into a `@setu/theme-*` package +
  the swap/override mechanism is **3b** — deliberately not built now.
- **Home as a root `page` entry** keeps a front door without building a listing/archive.
- **Light-only** keeps zero-JS; dark is a deferred token-set + toggle (3b/3c).

---

See [[saytu-project]], the parent vision doc, and the #1/#2 specs.
