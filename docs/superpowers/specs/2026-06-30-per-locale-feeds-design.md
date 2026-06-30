# Per-Locale RSS Feeds — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `rss-feed` (extends PR #51; this completes the feed as multi-locale)

## Summary

Extend the RSS feed (#51) from a single default-locale (`en`) feed to **one feed per content
locale**: `/rss.xml` for the default locale and `/<locale>/rss.xml` for each other locale that
has published posts, with **every language feed advertised in the page `<head>`** (one
`<link rel="alternate">` per locale, `hreflang`-tagged). Single-language sites are unaffected
(no extra routes, one header link).

## Goals

- Locale-parameterised selection: `selectFeedPosts(rows, limit, locale)` / `getFeedPosts(entries, limit, locale)`.
- A `feedLocales(entries)` helper — the distinct locales that have **published** posts.
- `/<locale>/rss.xml` routes for each **non-default** locale with posts (default stays at `/rss.xml`).
- The theme `Layout` emits a `<link rel="alternate" type="application/rss+xml" hreflang>` per locale feed, gated on `feed.enabled`.
- No empty feeds; degrades cleanly to today's behaviour for single-locale sites.

## Non-Goals (deferred)

- Per-locale **enable** toggle or per-locale **items** count — the single `reading.feed.enabled` + `items` governs all locales (YAGNI).
- Cross-feed translation linking inside items (hreflang *within* `<item>`), Atom/JSON Feed.
- A configurable default locale — `DEFAULT_LOCALE` (`'en'`, from `@setu/core`) remains the default; this rides whatever that is.

## Architecture

```
feed.ts
  selectFeedPosts(rows, limit, locale=DEFAULT_LOCALE)   // filter id segment-1 === locale (was hardcoded 'en')
  getFeedPosts(entries, limit, locale)                  // threads locale through
  feedLocales(entries): string[]                        // distinct locales of published posts (post/, not published:false)

apps/site/src/pages/rss.xml.ts            // default-locale feed → getFeedPosts(..., DEFAULT_LOCALE)
apps/site/src/pages/[locale]/rss.xml.ts   // NEW — getStaticPaths = feedLocales minus DEFAULT_LOCALE; emits that locale's feed

theme Layout.astro   // feedLocales?: string[] prop → one <link rel="alternate" rss hreflang> per locale
  PageLayout.astro / PostLayout.astro     // thread the feedLocales prop through (like siteSettings)
  index.astro / [...path].astro           // compute feedLocales (from getCollection) + pass it
```

### 1. Locale-parameterised selection (`apps/site/src/lib/feed.ts`)

- `selectFeedPosts(rows, limit, locale = DEFAULT_LOCALE)` — replace the hardcoded `locale !== 'en'`
  with `localeSeg !== locale`. Everything else (post-only, `published !== false`, sort desc, cap)
  unchanged. (`DEFAULT_LOCALE` imported from `@setu/core`.)
- `getFeedPosts(entries, limit, locale = DEFAULT_LOCALE)` — pass `locale` to `selectFeedPosts`.
  `toFeedItem`'s link already locale-aware: `entryUrlPath` keeps the locale segment for non-default
  (`/post/fr/slug`), drops it for default (`/post/slug`) — no change needed.
- `feedLocales(entries): string[]` — from the entries, keep `post/` ids that are published
  (`data.published !== false`), take the distinct **locale segment**, return sorted (default
  locale first for stable output). Used by both the route's `getStaticPaths` and the header.

### 2. Routes

- `apps/site/src/pages/rss.xml.ts` (existing) — pass `DEFAULT_LOCALE` to `getFeedPosts`. Otherwise
  unchanged (404 when `feed.enabled` is false).
- **New** `apps/site/src/pages/[locale]/rss.xml.ts`:
  - `prerender = true`.
  - `getStaticPaths()` → `feedLocales(await getCollection('entries'))` minus `DEFAULT_LOCALE` →
    `[{ params: { locale } }]`. (Empty for single-locale sites → no routes emitted.)
  - `GET(context)` → if `!feed.enabled` return 404; else `getFeedPosts(entries, items, context.params.locale)`
    and `rss({ title: \`${general.title} (${locale.toUpperCase()})\`, description, site, items })`.

### 3. Header autodiscovery (theme)

- `Layout.astro` gains `feedLocales?: string[]`. When `feed.enabled`, for each locale emit:
  ```astro
  <link rel="alternate" type="application/rss+xml"
        title={`${siteTitle} (${loc.toUpperCase()})`}
        href={loc === DEFAULT_LOCALE ? '/rss.xml' : `/${loc}/rss.xml`}
        hreflang={loc} />
  ```
  (Single default link when only the default locale is present — same as today. Falls back to the
  single `/rss.xml` link if `feedLocales` is undefined/empty, preserving current behaviour.)
- `PageLayout.astro` + `PostLayout.astro` accept + forward `feedLocales` to `Layout` (mirrors how
  `siteSettings`/`themeOptions` are threaded).
- `index.astro` + `[...path].astro` compute `feedLocales(await getCollection('entries'))` and pass
  it down. (`index.astro` already has the entry; it additionally pulls the collection for the locale
  list, or reuses a shared computation.)

## Data flow

Build time: each page computes `feedLocales` from the content collection → passes to the theme,
which advertises every language feed (hreflang-tagged) when the feed is enabled. The `/rss.xml`
and `/<locale>/rss.xml` endpoints each select that locale's published posts and emit absolute-link
XML (via `SETU_SITE_URL`). Enabling/disabling the feed (settings) flips all of it together.

## Error handling

- `feed.enabled` false → every feed route 404s and no header links (unchanged gate).
- Single-locale site → `feedLocales` = `[DEFAULT_LOCALE]` → no `[locale]/` routes, one header link
  (today's behaviour, preserved).
- A locale with zero published posts never appears (the helper filters on published posts).
- `feedLocales` undefined at the theme (e.g. a theme/page that doesn't pass it) → Layout falls back
  to the single `/rss.xml` link, so no regression.

## Testing

- **Unit (`apps/site`):** `selectFeedPosts(rows, limit, 'fr')` keeps only `post/fr/*` (and `'en'`
  keeps only `post/en/*`); `feedLocales` returns the distinct published-post locales (excludes
  pages, `published:false`, and locales with no posts), default-first.
- **Build/integration:** with the multilingual sandbox + feed enabled, `astro build` emits both
  `/rss.xml` (en items only) and `/fr/rss.xml` (fr items only), each with absolute links; the built
  home page `<head>` contains a `<link rel="alternate" rss hreflang="en">` and `hreflang="fr">`.
- **Single-locale guard:** a build with only `en` posts emits no `/[locale]/rss.xml` and one header link.

## Rollout / dependencies & coordination

- **Folds into PR #51** (`rss-feed` branch) — this finishes the feed as multi-locale; the additions
  get re-reviewed and #51 becomes "RSS feed (multi-locale)". No new deps. `SETU_SITE_URL` still
  required for absolute links in prod.
- Reuses the existing `published !== false` published-ness rule ([[setu-publish-semantics]]) — the
  same fix that landed the kitchen-sink post; `feedLocales` and `selectFeedPosts` both honour it.

## Open questions (resolve during planning)

- **O1 — feed title suffix for non-default locales:** `"${title} (FR)"` (chosen) vs a localised
  language name. Lean: the uppercased locale code (simple, no i18n name table).
- **O2 — `feedLocales` computation site:** computed in the app pages + passed to the theme (chosen,
  mirrors `siteSettings`) vs the theme querying content itself (rejected — theme shouldn't depend on
  the app's content lib / own content queries).

## Decisions log (from brainstorm)

- One feed per content locale; `/rss.xml` (default) + `/<locale>/rss.xml` (non-default, posts-only).
  **(approved)**
- **Advertise all** language feeds in every page `<head>`, hreflang-tagged. **(approved)**
- Single global enable/items toggle (no per-locale settings). **(approved)**
- **Fold into PR #51** (multi-locale finishes the feed feature). **(approved)**
