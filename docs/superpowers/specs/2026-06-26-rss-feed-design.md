# RSS Feed — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `rss-feed` (off `main`, which has the `reading.feed` schema from PR #48)

## Summary

Increment **#2** after Content & Reading: a standard **RSS feed** for the static Astro site,
consuming the `reading.feed { enabled, items }` switch that #48 put in the schema. A
prerendered endpoint at `/rss.xml` selects the latest N **published posts** and emits
`@astrojs/rss` XML at build time (zero per-request cost — Cloudflare-Pages-safe). This
increment also surfaces the **feed controls** in the Reading settings form (deferred from #48)
and introduces two foundational primitives the feed needs: an explicit post **`date`** and a
build-time **site URL**.

## Goals

- `/rss.xml` — a valid RSS 2.0 feed of the latest published posts, generated at build.
- A post **publish-date primitive**: explicit `date` frontmatter, with a git-commit-date (then
  mtime) fallback so nothing is dateless.
- A build-time **site URL** (`SETU_SITE_URL`) wired into Astro's `site` so feed links are absolute.
- **Feed settings controls** (enable + items) added to the Reading form (the #48-deferred part).
- RSS **autodiscovery** `<link>` in the theme head, gated on the toggle.

## Non-Goals (deferred)

- `content:encoded` / full-post HTML in items (needs HTML sanitization — readers get a summary now).
- **Per-locale feeds** (`/fr/rss.xml`): v1 is a single default-locale (`en`) feed.
- Category/tag-scoped feeds; Atom/JSON Feed formats.
- An **editor date-picker** UI — `date` is author-set frontmatter for now (the date *primitive*
  lands here; the editor field is a later polish).
- Batching the per-file git date lookup (fine at blog scale; noted for large sites).

## Architecture

```
SETU_SITE_URL (env) ─► astro.config `site` ─► context.site (absolute links)

/rss.xml.ts (prerendered endpoint)
  loadSiteSettings().reading.feed.enabled ? : 404
  getFeedPosts(entries, settings.reading.feed.items)        ← pure selection (testable)
    ├─ keep posts only (id starts "post/"), published, default locale (post/en/*)
    ├─ resolvePostDate(entry)  ← frontmatter date → git commit date → mtime  (impure: fs/git)
    ├─ sort by date desc, take N
    └─ → items [{ title, link(abs via toUrlPath), pubDate, description }]
  rss({ title, description, site, items })

Layout.astro ─► <link rel="alternate" rss> when feed.enabled
ReadingSettings.tsx ─► Feed section: enable Switch + items number  (writes reading.feed)
```

### 1. Dependency + site URL

- Add `@astrojs/rss` (latest; official, tracks Astro — pin and let the build verify Astro-7 compat)
  to `apps/site/package.json`.
- `apps/site/astro.config.mjs`: `site: process.env.SETU_SITE_URL ?? 'http://localhost:4321'`.
  Deployment-specific URL via env (Cloudflare-native; never a stale committed value). Dev falls
  back to the local site origin.

### 2. Post date resolver (`apps/site/src/lib/post-date.ts`)

`resolvePostDate(entry, contentDir): Date`
1. `entry.data.date` — if present and parses to a valid Date, use it.
2. else **git commit date**: `git -C <contentDir> log -1 --format=%cI -- <entry.filePath>`; if it
   returns an ISO date, use it. (Needs git history at build — true on Cloudflare; the local
   sandbox may not be a git repo, in which case this step yields nothing.)
3. else **file mtime** (`statSync(filePath).mtime`) — final fallback so every post has a date.

Impure (fs/git); kept isolated from the pure selection logic. One git call *per undated post*
only — posts with an explicit `date` never invoke git.

### 3. Feed selection (`apps/site/src/lib/feed.ts`)

`getFeedPosts(entries, opts): FeedItem[]` — split so the **pure** part is unit-testable:
- `selectFeedPosts(rows, limit): row[]` — **pure**: input rows already `{ id, data, date }`;
  keep posts only (`id.split('/')[0] === 'post'`), published (`data.status !== 'draft' &&
  data.published !== false`), default locale (`id.split('/')[1] === 'en'`); sort by `date` desc;
  take `limit`.
- `getFeedPosts` wires `getCollection('entries')` + `resolvePostDate` into `selectFeedPosts`,
  then maps survivors to `FeedItem { title, link, pubDate, description }`:
  - `title` = `data.title ?? slug`.
  - `link` = `toUrlPath(id)` made absolute by `@astrojs/rss` via `site`.
  - `pubDate` = resolved `Date`.
  - `description` = `data.description ?? data.summary ?? excerpt(entry.body)`.

`excerpt(body): string` (`apps/site/src/lib/feed.ts`, pure) — strip Markdoc tags (`{% … %}`) and
basic markdown syntax from the raw body, collapse whitespace, truncate to ~200 chars on a word
boundary with an ellipsis.

### 4. The endpoint (`apps/site/src/pages/rss.xml.ts`)

```
export const prerender = true
export async function GET(context) {
  const settings = loadSiteSettings()
  if (!settings.reading.feed.enabled) return new Response(null, { status: 404 })
  const items = await getFeedPosts(await getCollection('entries'), { limit: settings.reading.feed.items })
  return rss({
    title: settings.general.title,
    description: settings.general.description || settings.general.tagline || settings.general.title,
    site: context.site,
    items,
  })
}
```

### 5. Settings controls (`apps/admin/src/screens/settings/ReadingSettings.tsx`)

Add a **Feed** section to the existing Reading form (the #48-deferred controls):
- **Enable RSS feed** — a `Switch` bound to `reading.feed.enabled`.
- **Items in feed** — a number input (or Select) bound to `reading.feed.items` (sane bounds, e.g.
  1–100; default 20).
Extends the form's `values`/`dirty`/save to cover `reading.feed` (still `{ ...raw, reading: values }`,
unknown groups preserved). `markdown` stays untouched (still #3's).

### 6. Autodiscovery (`packages/theme-default/Layout.astro`)

In `<head>`, when `siteSettings?.reading.feed.enabled`:
`<link rel="alternate" type="application/rss+xml" title={siteTitle} href="/rss.xml" />`.

## Data flow

Author sets `date:` (optional) in post frontmatter → admin toggles **Feed** on + items in
Settings → Content & Reading (commits `reading.feed` to `settings.json`) → build: the endpoint
reads the toggle, selects the latest N published posts (dating each via frontmatter/git/mtime),
emits `/rss.xml` with absolute links from `SETU_SITE_URL`; the theme advertises it.

## Error handling

- Feed disabled → endpoint returns **404** (and no autodiscovery link). Default is disabled.
- `loadSiteSettings` already never throws (defaults on malformed/missing).
- Undated post → git, then mtime — never dateless.
- Git unavailable (no repo / git missing) → the git step yields nothing, falls to mtime; the
  build never fails on date resolution.
- No published posts → a valid empty feed (channel metadata, zero items).
- `SETU_SITE_URL` unset → dev fallback `http://localhost:4321` (links absolute but local — a prod
  build must set the env; documented).

## Testing

- **Pure unit (`apps/site`):** `selectFeedPosts` — filters out pages/drafts/`published:false`/non-en,
  sorts by date desc, caps at `limit`; `excerpt` — strips Markdoc tags + markdown, truncates on a
  word boundary; frontmatter `date` precedence over fallbacks (resolver unit with injected git/mtime
  or a thin seam).
- **Admin:** the Reading form persists `reading.feed.enabled`/`items` (faked `git`, mirrors the
  existing reading-settings test), unknown groups preserved.
- **Build/integration:** with the feed enabled in the sandbox, `astro build` emits `/rss.xml`
  containing the expected item count and absolute links; disabled → no 200 `/rss.xml`.

## Rollout / dependencies & branch coordination

- Off `main` (has `reading.feed` schema from #48; #49 related-posts is unrelated). No stacked branches.
- New runtime dep `@astrojs/rss` → `pnpm install` after merge (dep-changing merge).
- `SETU_SITE_URL` must be set in the production/CI build env; document it (a prod build with the
  dev fallback would emit localhost links).
- The `date` frontmatter primitive introduced here is reused by #3 (markdown/`llms.txt`) and future
  dated listings / sitemap `lastmod`.

## Open questions (RESOLVED in brainstorm)

- **Post date source — RESOLVED:** explicit `date` frontmatter (canonical), git-commit-date then
  mtime fallback. (Option A.)
- **Site URL source — RESOLVED:** build-time env `SETU_SITE_URL` → Astro `site` (not a committed
  setting). Admin may later show it read-only.
- **Item content — RESOLVED:** `description` = frontmatter description/summary, else derived
  excerpt; no `content:encoded` in v1.
- **Locale scope — RESOLVED:** single default-locale (`en`) feed; per-locale feeds deferred.

## Decisions log

- Standard RSS 2.0 via `@astrojs/rss`, prerendered endpoint, build-time only. **(approved)**
- Post `date` primitive (frontmatter + git/mtime fallback). **(approved)**
- `SETU_SITE_URL` env for the absolute base URL. **(approved)**
- Feed controls added to the Reading form (the #48-deferred part). **(approved)**
- Description = excerpt, single en feed (the two defaulted micro-decisions). **(approved)**
