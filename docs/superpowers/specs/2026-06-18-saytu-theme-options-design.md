# Saytu Theme Options Engine (sub-project #3c) — Design

> Slice **3c** of the render/theme epic. Parent vision:
> `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`. 3a (default theme) ✅,
> 3b (themes as config-activated packages) ✅.
> **In WordPress terms:** this is the **Customizer engine** — let a site owner retune the active
> theme's look (color, font, width, size, corners) without touching code. The full WordPress
> Customizer is a *live admin panel that saves to the live site*; that save path is the deferred
> **editor→disk bridge**. So 3c builds the **engine** (theme declares its knobs → the build applies
> chosen values as token overrides), with values held in committed config. The **visual admin
> panel** is a deliberate follow-on, unblocked once the bridge can persist the values.

**Goal:** give a non-coder five knobs that retune the active theme — **accent color, font, content
width, text size, corner style** — declared by the theme, stored in `saytu.config`, and applied by
the build as `:root` token overrides. Plus: remove the runtime **Google Fonts** dependency from the
whole repo by self-hosting fonts via `@fontsource` (site theme **and** admin chrome).

**Architecture:** the theme package declares its options in an `options.ts` (the "options API" —
each knob: key, label, type, default, the token(s) it drives, and for fonts the curated
`@fontsource` choices). `@setu/core` config gains an additive optional `themeOptions` map (chosen
values), passed through exactly like the `theme` field (3b) — round-trip/content untouched. At
build, a **pure** `optionsToCss(values)` in the theme turns the chosen values into a `:root { … }`
override block the Layout injects after `theme.css`; because every theme token is
`var(--token, default)`, the later `:root` wins and the site restyles. Missing/invalid values fall
back to the theme's defaults (a non-coder cannot break the site). Fonts are self-hosted via
`@fontsource`; the Layout declares all curated faces but the visitor downloads only the **selected**
one (browsers fetch a font file only when its family actually renders).

**Tech stack:** Astro 6 · `@setu/theme-default` (gains `options.ts` + font CSS) · `@setu/core`
config (new additive `themeOptions` field; read at build via the existing `loadConfig`/jiti from 3b)
· `@fontsource-variable/*` (self-hosted OFL/Apache-2.0 fonts — verified on npm) · Vitest.

---

## 1. Scope

### In scope
- **Theme options manifest** — `packages/theme-default/options.ts` declaring the five knobs (the
  options API) + a pure `optionsToCss(values)` that maps chosen values → a `:root { … }` override
  string (falling back to per-knob defaults for missing/invalid values).
- **`themeOptions` config field** (`@setu/core`) — additive, optional
  `themeOptions?: Record<string, string>` on `SaytuConfig` + `ResolvedConfig` + schema
  (pass-through, mirrors the `theme` field). Never read by the Markdoc converter.
- **Build application** — the Layout reads the resolved `themeOptions`, runs the theme's
  `optionsToCss`, and injects the result as a `<style>` in `<head>` **after** `theme.css`.
- **Self-hosted fonts (site theme)** — bundle the curated shortlist via `@fontsource-variable/*`;
  the Layout imports their CSS and drops the Google Fonts `<link>` + `preconnect`s.
- **Self-hosted fonts (admin chrome)** — `apps/saytu-admin` switches its three faces
  (Hanken Grotesk / Newsreader / JetBrains Mono) to `@fontsource` imports; drops the Google
  `<link>` from `index.html`. Repo then has **zero runtime Google-Fonts dependency**.
- **Tests** — core field test; pure `optionsToCss` unit tests; a site build test proving a
  non-default `themeOptions` changes the rendered `:root`; the existing 27 site tests stay green
  with **one intentional change** (the Google-Fonts-link assertion flips to the self-hosted font).

### Out of scope (named, anti-creep)
- **The visual admin Customizer panel** (color pickers / dropdowns / live preview that *saves* to
  the live site) → next increment, after the **editor→disk bridge** can persist `themeOptions`.
  The manifest is shaped so that panel renders itself generically from it — no per-theme UI code.
- **Shipping a non-default example** — `saytu.config.ts` keeps the theme defaults (the success
  criterion is "looks identical, now tunable"; the engine is proven by tests, not a visual change).
  Decided with the owner.
- **A font library beyond the curated shortlist** — fontsource exposes ~1,500 families; the default
  theme curates ~5–6. Expanding is themer-controlled (install the package + add a choice); the API
  supports any number.
- **Dark mode, per-theme colour schemes, child-theme component overrides** → later.
- **The render engine** (routing, `content.config`, `lib/url`, `markdoc.config`, block components)
  stays put. Blocks keep theming via the tokens, which the overrides feed.

---

## 2. The options manifest (the "API") — `packages/theme-default/options.ts`

Each knob is a small declarative record. Two option **types** cover all five knobs: `color` and
`select`. The manifest is plain TS (importable by the Astro build now, and by the future admin
panel) — it has **no** runtime framework dependency.

```ts
// Shape (illustrative — exact field names finalised in the plan):
export type ThemeOptionType = 'color' | 'select'

export interface ThemeOptionChoice {
  value: string            // stored value, e.g. 'serif'
  label: string            // friendly, e.g. 'Serif (Source Serif)'
  tokenValue: string       // what the token becomes, e.g. a font-family stack or '64rem'
}

export interface ThemeOption {
  key: string              // config key, e.g. 'accent'
  label: string            // friendly label for the (future) panel
  type: ThemeOptionType
  token: string | string[] // the CSS custom property/properties this knob drives
  default: string          // default *value* (a colour for `color`; a choice value for `select`)
  choices?: ThemeOptionChoice[] // required for `select`
}

export const themeOptions: ThemeOption[] = [ /* the five knobs below */ ]
```

The five knobs:

| key        | type   | drives token(s)              | default   | choices |
|------------|--------|------------------------------|-----------|---------|
| `accent`   | color  | `--accent`                   | `#4f46e5` | — (free colour) |
| `font`     | select | `--font-body`, `--font-heading` | `grotesk` | the curated font shortlist (§3) |
| `width`    | select | `--measure-page`             | `normal`  | narrow `52rem` / normal `64rem` / wide `78rem` |
| `textSize` | select | `--text-base`                | `normal`  | compact `1rem` / normal `1.0625rem` / comfy `1.1875rem` |
| `corners`  | select | `--radius-base`              | `rounded` | sharp `2px` / rounded `10px` |

(Default *values* equal the current `theme.css` values, so empty/default `themeOptions` reproduces
today's look.)

**`optionsToCss(values: Record<string, string>): string`** — pure, in the same module:
- For each option, resolve the effective value: `values[key]` if valid, else the option's default.
- `color` → emit `--accent: <value>;`.
- `select` → look up the matching choice and emit `<token>: <choice.tokenValue>;` for each token
  in `token` (the `font` knob writes both `--font-body` and `--font-heading`).
- Invalid value (unknown choice / not a parseable colour) → use the default (never emit garbage).
- Return a single `:root { … }` string (empty `:root {}` is fine when all values are default).

This function is the engine's heart and the primary unit-test target. It lives in the theme (the
theme owns its tokens); `@setu/core` only carries the values through.

**Accent cascade fix:** `theme.css` currently hard-codes `--accent-strong: #4338ca`. Change it to
derive from `--accent` (e.g. `--accent-strong: color-mix(in oklch, var(--accent) 82%, black);`) so
the single accent knob recolours the strong/soft/on-accent family correctly. (`--accent-soft` is
already derived via `color-mix`.)

## 3. The curated font shortlist (self-hosted via `@fontsource`)

Verified present on npm as variable packages (version ✓ at design time):

| choice value | label              | `@fontsource-variable/*` package | family stack head |
|--------------|--------------------|----------------------------------|-------------------|
| `grotesk`    | Grotesk (default)  | `hanken-grotesk` `5.2.8`         | `'Hanken Grotesk'` |
| `inter`      | Inter              | `inter` `5.2.8`                  | `'Inter'` |
| `source-serif` | Serif (Source Serif) | `source-serif-4` `5.2.9`     | `'Source Serif 4'` |
| `newsreader` | Literary (Newsreader) | `newsreader` `5.2.10`         | `'Newsreader'` |
| `lora`       | Warm serif (Lora)  | `lora` `5.2.8`                   | `'Lora'` |
| `space`      | Space Grotesk      | `space-grotesk` `5.2.10`         | `'Space Grotesk'` |

Each choice's `tokenValue` is its full family stack (e.g.
`"'Source Serif 4', ui-serif, Georgia, serif"`). Mono stays JetBrains Mono
(`@fontsource-variable/jetbrains-mono` `5.2.8`) — not a knob, just self-hosted.

**Delivery (site):** the Layout imports the CSS for **all** curated faces (`import
'@fontsource-variable/hanken-grotesk'` …). Each import only *declares* `@font-face`s; the browser
downloads a face only when a family actually renders, so a page ships **one** font (the selected
body face) + mono. Declaring ~6 unused `@font-face` blocks is a few KB of CSS text — negligible to
the visitor. (Known minor tradeoff: the *deployed static bundle* contains the unused `.woff2`
assets; invisible to visitors; a future build-time prune is an easy optimisation, noted not done.)

## 4. The `themeOptions` config field (`@setu/core`)

Additive change to `packages/core/src/config/`, mirroring the 3b `theme` field exactly:
- `types.ts`: `SaytuConfig` + `ResolvedConfig` gain `themeOptions?: Record<string, string>`.
- `schema.ts`: `configSchema` accepts an optional `themeOptions` (`z.record(z.string(),
  z.string()).optional()`).
- `resolve.ts`: `resolveConfig` passes `themeOptions` through to the resolved object.
- `loadConfig` (Node) therefore returns it too.
- Test: `resolveConfig({ blocks: [...], themeOptions: { accent: '#0ea5e9' } }).themeOptions` round-
  trips; omitting it leaves it `undefined` (back-compat — existing configs still validate).

Config-only; the Markdoc round-trip, content, and existing core tests are unaffected (the field is
never read by the converter — same guarantee as `theme`).

## 5. Build wiring (applying the options)

`apps/saytu-site/saytu.config.ts` — **no value change** (defaults kept); it simply *may* carry a
`themeOptions` map. The build path:
- The Layout takes a `themeOptions?: Record<string,string>` prop, calls the theme's
  `optionsToCss(themeOptions ?? {})`, and injects `<style set:html={css} />` in `<head>` **after**
  the `theme.css`/`site.css` imports (later `:root` wins).
- Pages (`[...path].astro`, `index.astro`) read the resolved config's `themeOptions` and pass it to
  the Layout. Source of the value: a tiny `src/lib/site-config.ts` that imports the app's
  `saytu.config.ts` and re-exports `themeOptions` (Vite/Astro page context can import the config
  module directly; this is the page plane, not the markdoc-config loader that can't import core TS).
- Default/empty `themeOptions` ⇒ `optionsToCss` emits only defaults ⇒ rendered `:root` override is
  the theme's existing values ⇒ **same look** (modulo the intentional font-delivery switch).

**Verify-first (first build task):** confirm a page importing `saytu.config.ts` resolves in the
Astro build and that the injected `<style>` lands after the theme CSS in the built HTML.
**Fallback if importing the config module in a page is awkward:** expose `themeOptions` via the
existing `loadConfig` path used in `astro.config.mjs` (3b) as a Vite virtual module / `define`.
Either way the values reach the Layout; the apply mechanism (values → `:root` override) is unchanged.

## 6. Admin font self-hosting

`apps/saytu-admin`:
- Add `@fontsource-variable/{hanken-grotesk,newsreader,jetbrains-mono}` deps; import their CSS in
  the admin entry (`main.tsx` or the top stylesheet).
- Remove the Google Fonts `<link>` + `preconnect`s from `apps/saytu-admin/index.html`.
- The admin's `tokens.css` font-family stacks are unchanged (the families now resolve to the
  self-hosted faces). `design/admin/tokens.css` is a non-shipped design reference — leave as-is.
- Verify: admin builds, fonts render, no network call to `fonts.googleapis.com`.

## 7. Testing

- **No-regression gate (site):** the existing **27 render tests stay green**, with exactly **one
  intentional change** — the test asserting `fonts.googleapis.com` in the shell
  (`apps/saytu-site/test/render.test.ts:151`) flips to asserting the self-hosted font (e.g. an
  `@font-face`/font CSS marker) and the **absence** of `fonts.googleapis.com`. All other rendered
  HTML (layout, prose, themed callout, lang, zero-JS) stays byte-identical for default options.
- **Core:** unit test for the `themeOptions` field on `resolveConfig` (present + omitted).
- **Engine (`optionsToCss`):** pure unit tests — each knob maps to the right token(s); the `font`
  knob writes both font tokens; an unknown/invalid value falls back to the default; all-default
  values reproduce the current token set.
- **Application (site build):** a test setting a non-default `themeOptions` (e.g.
  `{ accent: '#0ea5e9', width: 'wide' }`) and asserting the built HTML's injected `:root` carries
  the overridden tokens after `theme.css`.
- Whole repo green (core +1 test, blocks 8, site 27, admin tests, + db/git); both apps build;
  zero-JS holds.

## 8. Success criteria

1. The default theme **declares its options** in `options.ts` (the five knobs) — a generic,
   panel-ready API; `optionsToCss` applies chosen values as `:root` token overrides.
2. `@setu/core` gains an additive `themeOptions` config field; round-trip/content untouched
   (existing core tests still green + new ones).
3. Setting `themeOptions` in `saytu.config` **visibly retunes** the built site (accent/font/width/
   size/corners), proven by a build test; **default/empty reproduces today's look.**
4. **Zero runtime Google-Fonts dependency** repo-wide — site theme and admin chrome self-host via
   `@fontsource`; only the selected font ships to a visitor.
5. The visual admin Customizer panel is **absent by design** (deferred to post-bridge); the manifest
   is shaped so it can render itself generically when built.

## 9. Risks & decisions

- **Bridge constraint (owner-aligned split):** the full WordPress Customizer needs the admin to
  *save* values to the live site — the deferred editor→disk bridge. 3c builds the engine with values
  in committed config (no bridge); the visual panel follows. Surfaced and agreed with the owner.
- **Touches `@setu/core`** — additively (a config field), zero effect on the round-trip/content
  path. Same safety profile as the 3b `theme` field; the converter never reads it.
- **Font delivery is the one intentional visible change** — Google `<link>` → self-hosted
  `@font-face`. The single no-regression test asserting the Google link is updated; everything else
  stays identical. Self-hosting is *not* heavier to the visitor (same bytes, one fewer third party)
  and removes the GDPR/IP-leak liability every Saytu-built site would otherwise inherit
  (2022 Munich ruling). `@fontsource` fonts are OFL/Apache-2.0 — 100% OSS-clean.
- **Deployed bundle carries unused `.woff2`** (all curated faces emitted as assets even though a
  page uses one) — invisible to visitors, easy future prune; accepted for v1.
- **`optionsToCss` is pure** (manifest + values → string) — fully unit-testable, no I/O, the engine's
  core correctness lives there. Fallback-to-default means malformed config can't break a site.
- **Theme owns the manifest + CSS mapping** (self-describing themes); core stays minimal
  (carry the values through). Keeps the future panel theme-agnostic.

---

See [[saytu-project]], the parent vision doc, the 3a + 3b specs, and PRD §8.
