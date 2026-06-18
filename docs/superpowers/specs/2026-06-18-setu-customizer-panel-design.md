# Theme Customizer — Slice 1: the Appearance panel + live preview

**Date:** 2026-06-18
**Status:** approved (owner)
**Builds on:** the theme-options engine (#3c) — `@setu/theme-default` declares `themeOptions`
(the knob manifest) and `optionsToCss(values)`; the site renders them.

## Goal

A WordPress-Customizer-style **Appearance** screen in the admin: read the active theme's knob
manifest, render controls generically, and show an **instant in-panel preview** that restyles as
you tweak. Your choices are remembered across reloads.

**Slice boundary:** Slice 1 does **not** change the published site — it's the design surface
(controls + live preview + local memory). **Slice 2 (next)** adds "Publish appearance," committing
the values through the bridge so View Site reflects them. Keeping them separate keeps each crisp.

## Units

### 1. `@setu/theme-default/options` — extract a shared token resolver

Refactor so the preview and the published output can never drift:

- New pure **`resolveThemeTokens(values: Record<string,string>): Record<string,string>`** — maps
  chosen values to `{ '--accent': '#…', '--font-body': '…', … }`, applying the **same**
  validation/fallback rules `optionsToCss` already has (invalid color → default; unknown select →
  default choice).
- **`optionsToCss` delegates** to it: `:root:root { …declarations from resolveThemeTokens }`. Its
  output is **byte-unchanged** (the 10 existing theme-default tests are the regression gate).

The admin imports `themeOptions` + `resolveThemeTokens` from `@setu/theme-default/options`.

### 2. Admin `Appearance` screen (`apps/admin/src/screens/Appearance.tsx`)

- **State:** a `Record<string,string>` of chosen values, hydrated on mount from `localStorage`
  (`setu-theme-options`) merged over the manifest defaults; written back on every change (live,
  no explicit Save in slice 1 — like the theme toggle).
- **Controls, generated from the manifest** (no hardcoding — a new knob appears automatically):
  - `type: 'color'` → a color swatch input + a hex text field (kept in sync; invalid hex ignored).
  - `type: 'select'` → a **segmented button group** when ≤4 choices, a **dropdown** when more
    (Font has 6 → dropdown; the rest are 2–3 → segmented).
  - Each control shows its label and a per-knob **reset-to-default**.
  - A global **"Reset all"**.
- **Live mini-preview** (beside the controls): a wrapper whose inline style is the custom-property
  map from `resolveThemeTokens(values)`, containing a representative sample — an `<h2>` heading,
  a paragraph, a primary button, and a **real `@setu/blocks` Callout** (so the preview callout *is*
  the shipped component). The sample's CSS consumes the same tokens (`--accent`, `--font-heading`,
  `--font-body`, `--text-base`, `--radius-base`) the knobs drive.
  - Honest limitation: `--measure-page` (content width) is barely visible in a small card; the
    preview shows what it can (accent/font/text-size/corners are all clearly visible). The real-site
    effect of width lands with Slice 2's View-Site.

### 3. Navigation

- Relabel the sidebar "Site" item → **"Appearance"**, route `/appearance`, icon a new `palette`
  glyph. Add `palette` to **both** `apps/admin/src/ui/Icon.tsx` and `design/admin/components.jsx`
  (the verbatim-port invariant). The old `/site` placeholder route is replaced.

### 4. Styles

- New `apps/admin/src/styles/customize.css` — the two-column layout (controls + preview), segmented
  controls, color field, and preview card. Imports `@setu/blocks/callout.css` if the callout styles
  aren't already global on this screen.

## Dependencies

- `apps/admin` gains a workspace dependency on `@setu/theme-default` (for the manifest + resolver).
- **Slice-1 reads the default theme's manifest directly.** Reading the *active* theme generically
  (a manifest-loading seam, mirroring the site's `@theme` alias) is deferred — there is one theme.

## What does NOT change

- The site, the bridge, `setu.config.ts`, the content path, the publish/deploy pipeline — untouched.
  The published site is unaffected by Slice 1 (that's Slice 2). `optionsToCss` output is unchanged.

## Testing

- **theme-default:** `resolveThemeTokens` unit table (defaults; valid color; invalid color → default;
  a select choice; unknown select → default). The existing `optionsToCss` tests stay green
  (proves the extraction didn't change output).
- **admin:** Appearance screen — renders one control per manifest knob; changing a select updates the
  preview wrapper's corresponding CSS custom property; a valid hex updates `--accent`; an invalid hex
  is ignored; per-knob reset and "Reset all" restore defaults; values persist to `localStorage` and
  re-hydrate on remount.
- **manual UAT:** open Appearance → drag accent / switch font / corners → the preview restyles live;
  reload → choices remembered.

## Out of scope (deliberate — Slice 2 or later)

- Publishing appearance to the live site (Slice 2: committed `theme-options.json` via the bridge).
- Active-theme manifest resolution (multi-theme), child-theme overrides.
- A full live **site iframe** preview (the heavier WordPress-style preview) — the mini-preview is v1.
