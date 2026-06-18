# View Site / View Page links — design

**Date:** 2026-06-18
**Status:** approved (owner)
**Builds on:** the Local Bridge (admin Publish → on-disk `.mdoc` the site renders) + the dev content sandbox.

## Goal

Make the publish→live loop tangible: from the admin you can jump straight to the **live site**
and to the **live page** for an entry — the real, published output the site renders from Git.

Explicitly **not** a draft preview. These links open the *committed* (published) content from Git
(the `.content-sandbox` repo in dev), **never** the in-browser draft. That honesty is why "View
Page" is gated on an entry actually being published. (A render-of-your-unsaved-edits draft preview
is a separate, larger future increment — the PRD's SSR iframed preview.)

## Where the links go

1. **"View Site"** — in the sidebar footer (near Deploy). Always available. Opens the site home.
2. **"View Page"** — in the editor top strip (`ed-strip-right`, near Publish). **Gated:** enabled
   only when the entry is published to Git (lifecycle `staged` or `live`); otherwise disabled with a
   tooltip "Publish to view it on the site." Opens that entry's live URL.
3. **Per-row "View"** — a small icon link on each content-list row, shown only for published rows
   (same gate). Opens that entry's live URL.

All open in a **new tab** (`target="_blank" rel="noopener noreferrer"`).

### Gate definition

"Viewable" = the entry exists as published content the site renders = lifecycle state ∈
`{staged, live}`. `draft` (only in browser, never committed) and `unpublished` (`published:false`
flag — being removed from the site) are **not** viewable. The editor already derives the lifecycle
(`lifecycleFor`); the content list already has `row.lifecycle`.

## The site URL — single source of truth

The admin must build the exact same URL the site serves. Today that mapping lives only in the site
app (`apps/site/src/lib/url.ts` `toUrlPath` + the home route). Duplicating it in the admin would
drift. So:

- **Add a pure helper to `@setu/core`:** `entryUrlPath(ref: EntryRef): string` — returns the URL
  path **without** a leading slash:
  - home entry (`page/<DEFAULT_LOCALE>/home`) → `''` (the site serves it at `/`).
  - default-locale entry → `<collection>/<slug...>` (locale segment dropped).
  - non-default-locale entry → `<collection>/<locale>/<slug...>` (locale kept).
  - `DEFAULT_LOCALE = 'en'` constant exported too (mirrors today's hardcoding; becomes
    config-driven when permalinks/i18n land — documented).
  Pure, Node-free → added to the edge guard (`tsconfig.edge.json`), unit-tested in core.
- **Refactor the site's `url.ts`** so `toUrlPath(id)` delegates to `entryUrlPath` (split the id into
  a ref). One implementation of the locale-drop logic, shared by site + admin. The site's existing
  home routing (index.astro serves `/`, the catch-all excludes home) is unchanged — it stays green
  (the 30 render tests are the regression gate).

## The site base URL in the admin

- New `VITE_SETU_SITE` env (default `http://localhost:4321`), wired into the `pnpm dev` admin
  command — same pattern as `VITE_SETU_API`.
- Small admin helper `siteUrl(ref?)`: `base = import.meta.env.VITE_SETU_SITE ?? 'http://localhost:4321'`;
  `siteUrl()` → `base` (home/site); `siteUrl(ref)` → `base + '/' + entryUrlPath(ref)` (trailing
  segment-join; home ref → just `base`).

## Components (admin)

- `apps/admin/src/shell/site-url.ts` — `siteUrl(ref?)` over `entryUrlPath` + the env base. Unit-tested
  (home → base, default-locale, non-default-locale, base from env vs default).
- Sidebar footer: a `View Site` link (`<a target=_blank>`, `globe`/`external` icon).
- Editor strip: a `View Page` link/button, gated (disabled state when not viewable + tooltip).
- Content list: a per-row `View` icon link, rendered only for viewable rows; add an actions cell
  (or append to the title cell) — keep the table layout intact.
- An `external` (open-in-new) icon added to the Icon map **and** `design/admin/components.jsx`
  (the verbatim-port invariant), if a suitable one isn't already present.

## Testing

- **core:** `entryUrlPath` unit table — home, default locale, non-default locale, multi-segment slug;
  edge guard stays green.
- **site:** existing 30 render tests must stay green (proves the `url.ts` refactor didn't change
  output).
- **admin:** `siteUrl` unit tests; component tests — "View Page" disabled for a draft row / enabled
  for a published row and points at the right href; sidebar "View Site" points at the base; per-row
  "View" only renders for published rows. (Open-in-new-tab is a plain `<a target>`, asserted by attr.)
- **manual UAT:** `pnpm dev` → publish a post → "View Page" opens the live page in a new tab;
  "View Site" opens home; an unpublished/draft entry shows no/disabled link.

## Out of scope (deliberate)

- **Draft preview** (rendering in-progress, unpublished edits) — separate larger increment.
- Config-driven permalinks / i18n routing — `entryUrlPath` formalizes the seam but keeps today's
  `en`-default hardcoding.
- A "copy link" affordance, social-preview, etc.
