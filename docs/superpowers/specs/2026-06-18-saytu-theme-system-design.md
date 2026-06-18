# Saytu Theme System (sub-project #3b) — Design

> Slice **3b** of the render/theme epic. Parent vision:
> `docs/superpowers/specs/2026-06-17-saytu-render-theme-vision.md`. 3a (default theme) ✅.
> **In WordPress terms:** 3a built the default theme; **3b makes themes real, installable,
> activatable packages** — the active theme is named in config; switch it + rebuild → a
> different theme. (3c = the Customizer / theme options; the config-based per-component
> *override* = "child themes", deferred.)

**Goal:** turn the default theme into a swappable package (`@saytu/theme-default`) that the
site activates via `saytu.config` — the foundation for distributable themes (the marketplace
long-game), with **no visible change to the current site** (same look, now sourced from a
theme package the config selects).

**Architecture:** extract the theme's *look* (layouts + tokens + styles) out of
`apps/saytu-site` into a new `packages/theme-default` (`@saytu/theme-default`). Add a `theme`
field to `saytu.config`. At build, the site reads that field and aliases `@theme` → the active
theme package; the site's pages import their layouts from `@theme/…`. Switching themes = change
the `theme` value + install the other package + rebuild. The render *engine* (routing, Markdoc
wiring, block components) stays in the app.

**Tech stack:** Astro 6 · a new `@saytu/theme-default` package shipping `.astro` layouts + CSS ·
`@saytu/core` config (new `theme` field; read at build via the existing `loadConfig` / jiti) ·
Vite alias for theme resolution · Vitest. **Both halves of the mechanism are spiked & proven:**
an Astro app renders a layout/tokens imported from a theme package; and a build-time config
*value* selects which theme package renders.

---

## 1. Scope

### In scope
- **New package `packages/theme-default` (`@saytu/theme-default`)** containing the theme's look,
  moved from `apps/saytu-site/src`:
  - `Layout.astro`, `PostLayout.astro`, `PageLayout.astro`
  - `theme.css` (the token layer), `site.css` (body/header/footer/measures/prose)
  - `package.json` with an `exports` map for each layout + css (`./Layout.astro`, etc.);
    `astro` as a peerDependency.
- **`theme` field in `saytu.config`** (`@saytu/core`): an additive, optional `theme?: string`
  (the active theme's package name) on `SaytuConfig` + the schema + `ResolvedConfig`
  (pass-through). Additive only — **does not touch the Markdoc round-trip / content path.**
- **A `saytu.config.ts` in `apps/saytu-site`** declaring `theme: '@saytu/theme-default'`
  (single source of truth, per PRD §8).
- **Build wiring** (`apps/saytu-site/astro.config.mjs`): read `saytu.config`'s `theme` (via
  `@saytu/core`'s Node `loadConfig`, jiti — proven in #2) and set a Vite alias `@theme` → the
  active theme package; default to `@saytu/theme-default` if unset.
- **Rewire the site's pages** (`[...path].astro`, `index.astro`) to import their layouts from
  `@theme/…` instead of `../layouts/…`.
- Tests: the site's existing 27 render tests stay green (same rendered HTML, now sourced from
  the theme package — the no-regression gate); a `@saytu/core` test for the `theme` field.

### Out of scope (named, anti-creep)
- **The Customizer / theme options panel** → **3c** (the admin UI to tune the active theme's
  tokens — colors/fonts/layout — which a single site owner actually reaches for).
- **Config-based per-component / per-token *override* ("child themes")** → deferred (PRD §8's
  `Callout → MyCallout.astro`). The harder, dynamic per-block resolution; not now.
- **Shipping a *second* theme.** 3b proves *one* theme is swappable-by-config; authoring an
  `@saytu/theme-editorial` etc. is future content, not this increment.
- **Dark mode, the marketplace/registry, theme scaffolding CLI** — all later.
- **The render engine stays put:** routing, `content.config`, `lib/url`, `markdoc.config`, and
  the block-render components (callout/align/sub-sup) remain in `apps/saytu-site` (#1). The
  callout still themes — it reads the *tokens*, which now live in the theme package and load via
  the theme's `Layout`.

---

## 2. The theme package

```
packages/theme-default/
  package.json        @saytu/theme-default; type module; exports each layout + css; astro peerDep
  Layout.astro        moved from apps/saytu-site/src/layouts/Layout.astro (head/fonts/header/footer)
  PostLayout.astro    moved — narrow .measure-post (imports ./Layout.astro)
  PageLayout.astro    moved — wider .measure-page (imports ./Layout.astro)
  theme.css           moved from src/styles/theme.css (the :root token layer)
  site.css            moved from src/styles/site.css (body/header/footer/measures/prose)
```

`package.json` `exports`:
```json
{
  "./Layout.astro": "./Layout.astro",
  "./PostLayout.astro": "./PostLayout.astro",
  "./PageLayout.astro": "./PageLayout.astro",
  "./theme.css": "./theme.css",
  "./site.css": "./site.css"
}
```
Internal imports stay relative (`PostLayout` → `./Layout.astro`; `Layout` → `./theme.css` +
`./site.css`). `astro` is a **peerDependency** (the app provides it). Nothing else moves —
the theme is purely look + layout.

## 3. The `theme` config field (`@saytu/core`)

Additive change to `packages/core/src/config/`:
- `types.ts`: `SaytuConfig` gains `theme?: string`; `ResolvedConfig` gains `theme?: string`.
- `schema.ts`: the config schema accepts an optional `theme` string.
- `resolve.ts`: `resolveConfig` passes `theme` through to the resolved object.
- `loadConfig` (Node) therefore returns `theme` too.
- A unit test: `resolveConfig({ blocks: […], theme: '@saytu/theme-default' }).theme === '@saytu/theme-default'`; and that omitting `theme` leaves it `undefined` (back-compat — existing blocks-only configs still validate).

This is config-only; the Markdoc round-trip, content, and all existing 175 core tests are
unaffected (the `theme` field is never read by the converter).

## 4. Build wiring (the activation mechanism)

`apps/saytu-site/saytu.config.ts` (new):
```ts
import { defineConfig, defaultConfig } from '@saytu/core'
export default defineConfig({ blocks: defaultConfig.blocks, theme: '@saytu/theme-default' })
```

`apps/saytu-site/astro.config.mjs`: read the active theme + alias `@theme` to it:
```js
import { loadConfig } from '@saytu/core/node'
const config = await loadConfig(new URL('./saytu.config.ts', import.meta.url).pathname)
const activeTheme = config.theme ?? '@saytu/theme-default'
// alias '@theme' -> the active theme package; '@theme/PostLayout.astro' resolves via its exports
export default defineConfig({
  integrations: [markdoc(), react()],
  vite: { resolve: { alias: { '@theme': activeTheme } } },
})
```
**Verify-first (first build task):** confirm `loadConfig` runs cleanly inside `astro.config.mjs`
during the build (Node + jiti — proven in #2) and that `@theme/PostLayout.astro` resolves to the
package's export. **Fallbacks if fiddly:** (a) if aliasing to the package *name* doesn't resolve,
alias to the resolved path via `import.meta.resolve`; (b) if `loadConfig` is awkward in the
config context, read the `theme` value directly (a constant in `astro.config`, or a tiny JSON)
and wire `saytu.config` as a follow-on — either way the theme is config-selected. The selection
mechanism itself (value → alias → rendered theme) is already spiked.

## 5. Site rewiring

- `apps/saytu-site/src/pages/[...path].astro`: `import PostLayout from '@theme/PostLayout.astro'`
  + `import PageLayout from '@theme/PageLayout.astro'` (was `../layouts/…`). Logic unchanged.
- `apps/saytu-site/src/pages/index.astro`: `import PageLayout from '@theme/PageLayout.astro'`.
- Delete `apps/saytu-site/src/layouts/{Layout,PostLayout,PageLayout}.astro` and
  `src/styles/{theme,site}.css` (now owned by the theme package).
- `apps/saytu-site/package.json`: add `@saytu/theme-default` (workspace) + `@saytu/core` deps.
- **What stays:** `content.config.ts`, `lib/url.ts`, `markdoc.config.mjs`, the block components
  (`CalloutWrapper`/`Heading`/`Paragraph`/`Sub`/`Sup`/`Th`/`Td`), `content/`, `test/`.

## 6. Testing
- **No-regression gate:** the site's existing **27 render tests stay green unchanged** — the
  rendered HTML (shell, templates, themed callout, prose, lang, zero-JS) is identical, just
  sourced from `@saytu/theme-default`. This proves the extraction is behavior-preserving.
- **Core:** a unit test for the `theme` field on `resolveConfig` (present + omitted).
- **Activation proven structurally:** the site builds with `@theme` resolving to the configured
  package; the spike already proved a *different* config value selects a *different* theme.
- Whole repo green (core 176-ish with the new test, blocks 8, site 27, admin 178, + db/git);
  both apps build; zero-JS holds.

## 7. Success criteria
1. `@saytu/theme-default` exists as a package; the site renders **through it**, selected by
   `saytu.config`'s `theme` field — with **no visible change** vs 3a (same look).
2. Switching the `theme` value (+ installing another theme package) would render a different
   theme — the activation mechanism is real (spiked) and wired.
3. `@saytu/core` gains an additive `theme` config field; round-trip/content untouched (175 core
   tests still green + 1 new).
4. The render engine (routing, Markdoc wiring, block components) stays in the app; the deferred
   override ("child themes") and the Customizer (3c) are absent.

## 8. Risks & decisions
- **Mechanism de-risked** (both layers spiked): theme-package `.astro` import ✓; config-value →
  theme selection ✓. The only unproven sliver — `loadConfig` *inside* `astro.config` — is jiti
  in Node (proven in #2) with concrete fallbacks (§4).
- **Touches `@saytu/core`** — but additively (a config field), with zero effect on the round-trip
  / content path. The core's round-trip + edge guard are unaffected (the `theme` field isn't in
  the converter's graph).
- **"Shelf before books"** (accepted by the owner): 3b adds the activation plumbing with one
  theme, so there's no *visible* change today — it's the foundation for distributable themes /
  the marketplace. The no-regression gate (§6) is exactly right: success = "looks identical,
  now swappable."
- **Theme = look only** (layouts + tokens + styles); render engine stays in the app. Overriding
  block components ("child themes") is the deferred, harder slice.

---

See [[saytu-project]], the parent vision doc, the 3a spec, and PRD §8.
