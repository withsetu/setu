# Settings Framework + General — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `settings-general` (off `main`)

## Summary

Setu is config-light: **Appearance** (the theme customizer) is the only setting with an admin
UI; `/settings` is an empty placeholder, and everything else (branding, homepage, locale, page
sizes, media, forms) is hardcoded, in env vars, or scattered constants. This is **Increment 1**
of a WordPress-style Settings system: the **Git-backed settings store + a grouped `/settings`
screen + the General group**, wired end-to-end so setting your site title in the admin actually
changes the site header and tab title.

Every later group (Identity, Content & Reading, Media, Forms, Users & Roles, SEO, Deploy,
Comments) reuses this exact store + screen shell — so this increment is the spine, not a
one-off.

## Goals

- A **Git-backed, owned, versioned** settings store — a committed `settings.json` at the
  content-repo root, sibling to `theme-options.json`, edited via the same publish-to-Git path
  Appearance already uses.
- A typed `SiteSettings` schema in `@setu/core`, **grouped** so future sections add cleanly.
- A `/settings` admin screen (replacing the placeholder) with a grouped shell and a working
  **General** form (title, tagline, description, timezone, date format).
- The **site consumes** General settings: the theme header brand + document `<title>` + meta
  description stop being hardcoded "Setu" and reflect the configured values.
- **No secrets in this file** — secrets stay in env (the captcha/email pattern), never here.

## Non-Goals (deferred to later increments)

- All other groups: **Identity** (logo/nav/footer/social), **Content & Reading** (homepage,
  page sizes, locales, default category), **Media** (image widths/limits), **Forms** (captcha
  + email config UI), **Users & Roles**, **SEO & Privacy**, **Deploy**, **Comments**.
- Consuming `timezone`/`dateFormat` for actual date *rendering* on the site (stored now,
  consumed when date display is wired — keeps the General group whole without the extra work).
- A draft/live-preview model (settings are text; one commit per Save, like editing content —
  no preview dance). Appearance keeps its own preview model; Settings does not need it.
- Any DB-backed settings store, any admin secret entry.

## Architecture

```
admin /settings (General form)
   │  git.readFile('settings.json')  →  current values
   │  Save → git.commitFile('settings.json', SiteSettings JSON)   (one commit per save)
   ▼
content-repo root: settings.json  ──(Git, owned + versioned)──►  apps/site loadSiteSettings()
                                                                  at build → theme Layout
                                                                  (brand, <title>, <meta>)
```

Mirrors the proven Appearance path (`apps/admin/src/screens/Appearance.tsx`): `const { git } =
useServices()`, `git.readFile(PATH)`, `git.commitFile({ path, content, message, author })`, with
a `published` baseline + `dirty` + `saving` state.

## Components

### 1. `@setu/core` — settings schema (pure)

`packages/core/src/settings/`:
- `types.ts` — `SiteSettings`, grouped:
  ```ts
  export interface SiteSettings {
    general: {
      title: string
      tagline: string
      description: string
      timezone: string    // IANA, e.g. 'UTC'
      dateFormat: string  // a preset token, e.g. 'MMM D, YYYY'
    }
  }
  ```
  (Group-of-groups shape so `identity`, `content`, `media`, `forms` slot in later without
  reshaping.)
- `defaults.ts` — `DEFAULT_SETTINGS` (`title: 'Setu'` to preserve current header until changed;
  empty tagline/description; `timezone: 'UTC'`; `dateFormat: 'MMM D, YYYY'`).
- `merge.ts` — `parseSettings(raw: unknown): SiteSettings` (Zod parse, falls back to defaults on
  malformed/missing) and a deep merge of `DEFAULT_SETTINGS` with a partial file (so a settings
  file missing future keys still resolves). Pure, unit-tested.
- Exported from the core barrel.

### 2. `apps/site` — load + consume

- `apps/site/src/lib/site-settings.ts` — `loadSiteSettings(): SiteSettings`, mirroring
  `loadThemeOptions` in `site-config.ts`: read `settings.json` from the content-repo root
  (`SETU_CONTENT_DIR/..` in dev, repo root otherwise), `parseSettings`, return merged. Read
  fresh per call (so `astro dev` reflects a freshly-published file). Never throws.
- `apps/site/src/pages/[...path].astro` + `index.astro` — call `loadSiteSettings()` and pass
  `siteSettings` into the layout (alongside the existing `themeOptions`).
- `packages/theme-default/Layout.astro` (+ `PageLayout.astro`/`PostLayout.astro` pass-through) —
  accept `siteSettings`; replace hardcoded **"Setu"**:
  - header brand → `siteSettings.general.title`
  - document `<title>` → `\`${pageTitle} · ${siteSettings.general.title}\`` (or just the site
    title on the home page)
  - `<meta name="description">` → `siteSettings.general.description` (when non-empty)
  - optional header tagline → `siteSettings.general.tagline` (when non-empty)
  - footer "Built with Setu" stays (it's attribution, not site identity).

### 3. `apps/admin` — the Settings screen

- `apps/admin/src/screens/settings/Settings.tsx` — the grouped shell: a left sub-nav (or tabs)
  listing groups; **General** is the only active group this increment, and the future groups
  (Identity, Content & Reading, Media, Forms, Users & Roles, SEO & Privacy, Deploy) appear as
  **disabled "coming soon" items** so the nav signals the roadmap. Reads `settings.json` via
  `git.readFile`, holds form state + a `published` baseline, computes `dirty`.
- `apps/admin/src/screens/settings/GeneralSettings.tsx` — the General form: text inputs for
  title/tagline, a textarea for description, a `<select>` for timezone (a curated list of common
  IANA zones + the current value) and date format (a few presets). **Save changes** →
  `git.commitFile({ path: 'settings.json', content: JSON.stringify(merged, null, 2) + '\n',
  message: 'chore(settings): update general settings', author: OWNER_AUTHOR })` → `useNotify`
  success; button disabled when not dirty / while saving (mirror Appearance).
- `apps/admin/src/app.tsx` — route `/settings` → `<Settings />` (replacing the placeholder).
- Interaction polish per the project bar: Enter-friendly inputs, clear saved/dirty state,
  success cue.

## Data flow

Admin loads `settings.json` (git read) → edits the General form → **Save** writes the full
`SiteSettings` JSON back via `git.commitFile` (one commit) → the site's `loadSiteSettings()`
reads it at build → the theme renders the configured title/tagline/description. No secrets pass
through this file.

## Error handling

- Missing/malformed `settings.json` → `parseSettings` returns `DEFAULT_SETTINGS` (site renders
  with defaults; admin shows defaults as the baseline). Never throws on read.
- Save/commit failure → `useNotify.error` with the message; form stays dirty so the user can
  retry (mirror Appearance's publish error path).
- Forward-compat: a `settings.json` written by a newer version with extra group keys is
  preserved on save (merge over the parsed object, don't drop unknown groups) — or, simpler for
  v1, the admin writes the full known shape and unknown future keys are out of scope until those
  groups exist (decision O3).

## Testing

- **Core (pure):** `parseSettings` (valid → typed; missing keys → filled from defaults;
  malformed → defaults), deep-merge (partial file over defaults), `DEFAULT_SETTINGS` shape.
- **Site:** `loadSiteSettings` reads a fixture `settings.json` + merges defaults; missing file →
  defaults.
- **Admin:** the General save path (read baseline → edit → commit called with the right path +
  serialized content) with a faked `git` service; dirty/disabled state.
- **Theme (light):** `Layout.astro` renders the configured title in the brand + `<title>` (a
  render test if the theme test harness supports it, else covered by the site build + UAT).

## Rollout / dependencies & branch coordination

- Independent of the submission pipeline; touches core (new module), `apps/site` (layout +
  loader), `apps/admin` (settings screen + route), `packages/theme-default` (Layout).
- **Coordination:** PR #43 (pluggable captcha) added a simple `apps/admin/src/screens/Settings.tsx`
  hosting the captcha **status card**. This increment turns `/settings` into a grouped shell.
  When both land, the captcha status card **relocates into the future Forms group** (or sits as
  a card until then). Cleanest order: merge #43 (and #45 editor-authoring) first, then rebase
  this branch onto that `main` and fold the captcha card into the Settings shell. (The
  controller manages the rebase.)

## Open questions (resolve during planning)

- **O1 — settings file name/shape:** `settings.json` (chosen) vs `site-settings.json`; and the
  grouped object shape above vs a flat map. Leaning `settings.json` + grouped.
- **O2 — RESOLVED:** future groups appear in the nav as **disabled "coming soon" items**
  (signals the roadmap); only General is active this increment.
- **O3 — forward-compat on save:** preserve unknown future group keys on write (merge over the
  raw parsed object) vs write only the known shape. Leaning preserve (merge over raw) — cheap
  insurance so a newer file isn't clobbered by an older admin.
- **O4 — timezone/dateFormat inputs:** curated `<select>` of common zones + format presets vs
  free text. Leaning curated selects (less error-prone) with the stored value always shown.

## Decisions log (from brainstorm)

- Persistence: **Git-backed `settings.json`** (owned/versioned) via the Appearance publish path;
  **secrets stay in env**, never in this file. **(approved)**
- Increment 1 = **framework + General + wire the site** (title/tagline/description consumed;
  timezone/dateFormat stored, consumed later). **(approved)**
- Grouped schema + grouped screen shell so every future settings group is a small add.
