# Settings: Content & Reading — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `settings-reading` (off `main`, which has the settings spine + General)

## Summary

The **second settings group** (after General), building on the shipped Git-backed settings
spine ([[setu-settings]]). Adds a **Content & Reading** group to `settings.json` + an active
**Content & Reading** section in the `/settings` shell, and wires three behavioral settings
end-to-end: **homepage** (which page the site serves at `/`), **search-engine visibility**
(emit `noindex`), and **listing page size** (admin content lists). It also **defines the
schema** for the deferred **feed** and **markdown/LLM** output features so later increments
(#2 RSS feed, #3 markdown/`llms.txt`) just consume the switches — but their form controls +
output generation are out of scope here.

## Goals

- A `reading` group in the Git-backed `settings.json`, mergeable + forward-compatible like
  `general` (defaults on missing, preserves unknown groups).
- **Homepage** configurable — replace the hardcoded `page/en/home` in `apps/site`.
- **Search-engine visibility** — a "discourage indexing" toggle the theme honors via a robots
  meta tag.
- **Listing page size** — replace the hardcoded admin content-list `PAGE_SIZE`.
- An **admin settings provider** — generalize the just-shipped `SiteTitleProvider` into one
  provider that reads the whole `SiteSettings` once, so the admin (page size now, future groups
  later) reads settings cleanly.
- **Bake the feed + markdown switches into the schema** (off by default) so #2/#3 consume them.

## Non-Goals (deferred)

- **RSS feed output** (#2) and **markdown / `llms.txt` output** (#3) — only their *schema fields*
  land here; no feed/markdown is generated, no form controls for them this increment.
- Default locale, default category (locale system is bigger; minor).
- Site-facing archive pagination (the listing page size here is the **admin** content lists,
  not site archives — Setu has no site archives yet).
- Multiple homepages / per-locale homepage.

## Architecture

```
admin /settings → "Content & Reading" (ReadingSettings form)
   reads settings via the admin SettingsProvider (full SiteSettings, read once)
   Save → git.commitFile('settings.json', { ...raw, reading })   (preserve unknown groups)
        ▼
settings.json (reading group)  ──►  site loadSiteSettings().reading
                                       index.astro → homepage entry at '/'
                                       [...path].astro → exclude homepage id
                                       Layout → noindex meta when !searchEngineVisible
                                  ──►  admin ContentList → reading.listPageSize
```

### 1. Schema (`@setu/core`)

Extend `SiteSettings`:

```ts
export interface ReadingSettings {
  homepage: string             // entry id, e.g. 'page/en/home'
  searchEngineVisible: boolean // false → emit noindex
  listPageSize: number         // admin content-list page size
  feed: { enabled: boolean; items: number }                          // consumed by #2
  markdown: { mode: 'off' | 'index' | 'pages'; style: 'raw' | 'rendered' } // consumed by #3
}
export interface SiteSettings {
  general: GeneralSettings
  reading: ReadingSettings
}
```

`DEFAULT_SETTINGS.reading = { homepage: 'page/en/home', searchEngineVisible: true,
listPageSize: 25, feed: { enabled: false, items: 20 }, markdown: { mode: 'off', style: 'raw' } }`.

`parseSettings` deep-merges `reading` (incl. the nested `feed`/`markdown` objects) over
defaults — same defaults-on-missing + preserve-unknown-groups contract as `general`.

### 2. Admin SettingsProvider (generalize `SiteTitleProvider`)

Rename `apps/admin/src/shell/site-title.tsx` → `apps/admin/src/data/settings-store.tsx`,
broadened to read + provide the **whole** `SiteSettings`:
- `SettingsProvider` reads `settings.json` via `useServices().git.readFile` → `parseSettings`
  on mount; holds `{ settings: SiteSettings; refresh: () => void }`.
- `useSettings(): SiteSettings`; `useRefreshSettings(): () => void`.
- Keep the existing API as thin derivations so PR-#46 callers don't break:
  `useSiteTitle() = useSettings().general.title`; `useRefreshSiteTitle() = useRefreshSettings()`.
- Update the 3 importers (`main.tsx` provider mount, `PageHeader.tsx`, `GeneralSettings.tsx`).

### 3. The Reading form (`apps/admin/src/screens/settings/ReadingSettings.tsx`)

Mirrors `GeneralSettings` (read baseline via `git`, `dirty`, commit, `useNotify`, preserve
unknown groups). Controls:
- **Homepage** — a shadcn `Select` of existing **pages** from the content index
  (`useIndex().query({ collection: 'page', limit: 1000 })` → `{ id, title }`); the current
  stored value is always present as an option even if it isn't a page.
- **Search-engine visibility** — a shadcn `Switch` ("Discourage search engines from indexing"
  → sets `searchEngineVisible = !checked`).
- **Listing page size** — a `Select` of sensible sizes (10/25/50/100), current value pinned.
- Save commits `{ ...raw, reading: values }` and calls `useRefreshSettings()` (so the admin
  picks up the new page size immediately).
- **No feed/markdown controls here** (schema only; #2/#3 add them).

Activate it in the shell (`Settings.tsx`): move **Content & Reading** from the `COMING_SOON`
list to an active group rendering `<ReadingSettings />`.

### 4. Site + admin consumption

- **Homepage** (`apps/site`):
  - `index.astro` → `getEntry('entries', loadSiteSettings().reading.homepage)`; if that entry
    is missing, fall back to `'page/en/home'`, and if *that* is missing too, render a minimal
    "No homepage set" placeholder (never crash the build).
  - `[...path].astro` `getStaticPaths` → exclude the configured homepage id (replacing the
    hardcoded `'page/en/home'` filter) so it isn't double-routed.
- **Search-engine visibility** (`packages/theme-default/Layout.astro`): when
  `siteSettings?.reading.searchEngineVisible === false`, emit
  `<meta name="robots" content="noindex, nofollow" />` in `<head>`. (Layout already receives
  `siteSettings` from #46.)
- **Listing page size** (`apps/admin/src/screens/ContentList.tsx`): replace the module
  `PAGE_SIZE = 25` constant with `useSettings().reading.listPageSize` (fallback 25). Reset the
  page index if the size changes.

## Data flow

Admin reads full settings (provider) → Reading form edits the `reading` group → Save commits
`settings.json` (unknown groups preserved) + refreshes the provider → the site reads
`reading` at build (homepage, robots) and the admin lists read `listPageSize`. The feed +
markdown fields sit in the schema, default-off, untouched until #2/#3.

## Error handling

- Missing/malformed `settings.json` → defaults (the existing never-throws contract; `reading`
  filled from defaults).
- **Homepage entry missing** (renamed/deleted) → site falls back to `page/en/home`, then to a
  placeholder; the build never fails on a stale homepage id.
- Save/commit failure → `useNotify.error`, form stays dirty to retry.
- Empty pages list (no pages yet) → the homepage `Select` still shows the current value; the
  author can't pick a different page until one exists (acceptable).

## Testing

- **Core:** `parseSettings` fills `reading` defaults (incl. nested feed/markdown); a partial
  `reading` (only `homepage`) fills the rest; unknown groups still preserved.
- **Site:** `loadSiteSettings` returns the `reading` group; a build with a configured homepage
  serves it at `/` (build test or the load test + a homepage-resolution unit if extracted).
- **Admin:** the Reading form save commits `{ ...raw, reading }` with the edited values (faked
  `git`, mirrors `general-settings.test`); the SettingsProvider derivation keeps `useSiteTitle`
  working.
- **Admin consumption:** `ContentList` uses the configured page size (a focused test or
  verified via the existing list tests + typecheck).

## Rollout / dependencies & branch coordination

- Off `main` (which now has the settings spine + General, PR #46 merged). No stacked-branch
  rebases needed.
- Generalizing `SiteTitleProvider` touches PR-#46 code that's now in `main` — done as part of
  this increment (the derivations keep the old API working).
- The feed + markdown schema fields are **inert** here; #2 (RSS) and #3 (markdown/`llms.txt`)
  are separate increments that flip them on (the markdown one carries the Markdoc→markdown
  converter for `style: 'rendered'` and respects the Cloudflare Pages ~20k-file budget via the
  `index`-vs-`pages` mode — see the roadmap notes).

## Open questions (resolve during planning)

- **O1 — homepage Select source:** the content index `query({ collection: 'page' })` (chosen)
  — confirm the index exposes `id` + a display `title` on its rows (it does for the listing).
  Pages only (not posts) — leaning pages-only; the stored value is always shown.
- **O2 — page-size options:** `10 / 25 / 50 / 100` (chosen) vs a free number input. Leaning the
  curated Select (matches the General timezone/date pattern).
- **O3 — robots when discouraged:** `noindex, nofollow` (chosen) vs `noindex` only. Leaning
  `noindex, nofollow` (matches WordPress's discourage behavior).

## Decisions log (from brainstorm)

- Group = **Content & Reading** (behavioral); homepage + search-engine-visibility + listing
  page size, wired end-to-end. **(approved)**
- **Feed + markdown switches defined in the schema now** (off by default); their controls +
  output ship in #2/#3. **(approved)**
- **Admin SettingsProvider** generalizes `SiteTitleProvider` (reads the whole settings object).
  **(approved)**
- Homepage = a **Select of existing pages** from the content index. **(approved)**
