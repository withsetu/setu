# Theme Customizer — Slice 2: Publish appearance → live site

**Date:** 2026-06-18
**Status:** approved (owner)
**Builds on:** Customizer Slice 1 (the Appearance panel + live preview) + the Local Bridge + the
content sandbox.

## Goal

A **"Publish appearance"** action on the Appearance screen commits the chosen theme-option values
through the bridge so the **published site** renders with them.

## The model (SSG-honest)

In SSG the live site is pre-built HTML, so *any* change — content or appearance — only shows after
a build. So appearance is **not** instant/special: "Publish appearance" **commits (stages)** the
values to Git; the site reflects them on its next build (the same gate content rides). Practical
behavior **today**:

- **Dev (`pnpm dev`):** `astro dev` renders live from the committed files → after publishing, a
  **browser refresh** shows it (no build/deploy step in dev).
- **Real SSG prod:** the build is the gate; content + appearance go live together on Deploy/rebuild.
  (The real build/deploy hook is still deferred — out of scope here.)
- **Only meaningful under the bridge** (`pnpm dev`), exactly like content publishing; the pure
  in-browser mode commits to in-browser git with no site to read it.

Appearance gets its **own** "Publish appearance" button (it's site-wide config — it can't use the
per-post Publish), but it does **not** bypass the build; it commits and the build makes it live.

## Units

### 1. Site reads the committed `theme-options.json`

`apps/site/src/lib/site-config.ts`:
- The values live in a committed **`theme-options.json` at the content-repo root** (sibling of
  `content/`): in dev that's `<SETU_CONTENT_DIR>/../theme-options.json` (the sandbox root); in prod
  the repo root (resolved relative to `import.meta.url`).
- Replace the eager `const themeOptions` with **`loadThemeOptions(): Record<string,string>`** read
  **fresh per call** (so `astro dev` re-reads on refresh). It reads + parses the file (missing/
  malformed → `{}`, never throws) and returns **`mergeThemeOptions(config.themeOptions, fileValues)`**
  — the committed file wins over the `setu.config` defaults.
- Extract pure **`mergeThemeOptions(configValues, fileValues)`** (file over config) for unit testing.
- Update the two consumers (`index.astro`, `[...path].astro`) to call `loadThemeOptions()`.

### 2. Admin "Publish appearance"

`apps/admin/src/screens/Appearance.tsx` (now also uses `useServices()` + `useCan()`):
- **On mount:** read the published baseline via `git.readFile('theme-options.json')` → parse →
  `published` (or `{}`). Working values stay the local state (hydrated from `localStorage`, the
  unsaved working copy, falling back to `published` then manifest defaults).
- **Dirty** = working values ≠ `published` (shallow record compare). A small helper
  `sameValues(a, b)`.
- **"Publish appearance"** button in the page header (gated `can('theme.manage')`; the constant
  Owner has it): commits `JSON.stringify(values, null, 2)` to `theme-options.json` via
  `git.commitFile({ path, content, message: 'Update appearance', author })`; on success sets
  `published = working` (button → "Published", disabled until the next edit). In-flight guard
  prevents double-commit. Non-bridge git still commits (harmless; no site reads it).
- Keep Slice 1's live preview + reset + localStorage untouched.

### What does NOT change

- `@setu/core`, the converters, the publish/read/authoring services, the deploy/lifecycle pill
  bookkeeping — untouched. `optionsToCss`/`resolveThemeTokens` unchanged.
- No `theme-options.json` is committed to **this** repo's root (so the existing site render tests,
  which build with no env, keep seeing theme defaults → stay green).

## Testing

- **site:** `mergeThemeOptions` unit (file over config; empty file → config; both empty → `{}`).
  `loadThemeOptions` integration: point `SETU_CONTENT_DIR` at a temp dir, write a `theme-options.json`
  at its parent, assert the merged result; missing file → defaults. Existing 30 render tests stay
  green (no file at repo root → defaults).
- **admin:** Appearance publish — render with Services + Actor providers and an in-memory git; change
  a knob → the button enables ("Publish appearance"); click → `theme-options.json` is committed with
  the chosen values; the button settles to "Published"; a remount reads the committed baseline so a
  matching working copy shows "Published" (not dirty). Update Slice 1's appearance tests to wrap in
  the providers.
- **manual UAT:** `pnpm dev` → Appearance → tweak → "Publish appearance" → refresh the site tab →
  the live site shows the new look. Repo `git status` stays clean (sandbox-only writes).

## Out of scope (deliberate)

- The real production build/deploy hook (global deferred item).
- A staged-vs-deployed pill for appearance (the dirty/published button state is enough for v1).
- Full live site-iframe preview; multi-theme manifest; child-theme overrides.
