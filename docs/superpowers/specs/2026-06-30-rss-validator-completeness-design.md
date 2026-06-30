# RSS validator-completeness + per-item featured image — design

**Issue:** #76 · **Area:** `area:feed` · **Branch:** `feat/rss-validator-completeness`

## Goal

Bring Setu's RSS output up to the channel/item furniture WordPress and feed validators expect, on
**both** the default feed (`/rss.xml`) and every per-locale feed (`/[locale]/rss.xml`). No new
settings, no UI — pure output enrichment.

## What's added

**Channel level** (per feed):
- `<language>` — the feed's locale code (`en` for default, the locale for each per-locale feed).
- `<lastBuildDate>` — newest included post's date, RFC-822 (`Date.toUTCString()`).
- `<generator>` — WordPress-style `https://setu.build/?v=<SETU_VERSION>`.
- `<atom:link rel="self">` — the canonical absolute URL of this feed.

**Item level** (per post):
- `<category>` — one per tag and per category on the post (deduped, order: categories then tags).
- `<media:content>` — the post's featured image as MRSS `media:content`, when present.

## Decisions (owner-approved)

1. **Generator version** comes from a single `SETU_VERSION` constant exported by `@setu/core`
   (value `'1.0'` for now), so the upcoming SEO `<meta name="generator">` (#71) reads the same
   source. The generator string is built as `https://setu.build/?v=${SETU_VERSION}`.
2. **Featured image uses MRSS `<media:content>`, not `<enclosure>`.** `<enclosure>` requires a
   byte-`length` attribute we can't know at build without statting each file (and `@astrojs/rss`
   makes `length` mandatory). `<media:content url type medium="image">` under
   `xmlns:media="http://search.yahoo.com/mrss/"` needs no length and renders in Feedly/etc.

## Architecture

Keep the split that already exists: **`feed.ts` stays pure** (unit-tested, no Astro/URL/env
knowledge); **the endpoint** owns everything that needs `context.site` + media base.

### `@setu/core`
- Add `export const SETU_VERSION = '1.0'` (single source of the version string).

### `apps/site/src/lib/feed.ts`
- `FeedItem` gains:
  - `categories: string[]` — deduped categories-then-tags.
  - `image?: string` — the **raw** `featuredImage` path (e.g. `/media/2026/06/slug.jpg`), or absent.
- New pure helper `feedCategories(data): string[]` — normalizes `data.categories` and `data.tags`
  (each may be `string | string[] | undefined`) into a deduped, order-preserving list
  (categories first, then tags), dropping empties.
- `toFeedItem` populates `categories` (via `feedCategories`) and `image` (`str(data.featuredImage)
  || undefined`). Existing `title`/`link`/`pubDate`/`description` unchanged.

### Endpoints (`rss.xml.ts` and `[locale]/rss.xml.ts`)
Both build a shared `channelExtras(locale, feedPath, items)` + `toRssItem(item)` (extract a tiny
shared helper module `apps/site/src/lib/rss-xml.ts` so the two endpoints don't drift):
- `xmlns: { atom: 'http://www.w3.org/2005/Atom', media: 'http://search.yahoo.com/mrss/' }`.
- channel `customData` string:
  - `<language>${locale}</language>`
  - `<lastBuildDate>${newest.toUTCString()}</lastBuildDate>` (omit if no items)
  - `<generator>https://setu.build/?v=${SETU_VERSION}</generator>`
  - `<atom:link href="${selfUrl}" rel="self" type="application/rss+xml" />`
  - `selfUrl = new URL(feedPath, context.site).href` (`feedPath` = `rss.xml` or `${locale}/rss.xml`).
- per item: map `FeedItem` → `@astrojs/rss` item with
  - `categories: item.categories`
  - `customData: item.image ? '<media:content url="${abs}" medium="image"${typeAttr} />' : ''`
    where `abs = new URL(resolveImg(item.image), context.site).href` and `typeAttr` is a
    best-effort `type="image/<ext>"` derived from the path extension (omitted if unknown).

**Escaping:** all interpolated values into raw-XML `customData` go through a local `xmlEscape()`
(`& < > " '`). Locale codes, URLs, and image paths are escaped before injection.

## Edge / topology

Pure string assembly at prerender time — no native deps, no filesystem, no runtime cost. Safe on all
topologies. (Feeds are already `prerender = true`.)

## Testing

Unit (`feed.test.ts`, extend):
- `feedCategories`: array+array, string+string, mixed, undefined, dedup across tags/categories,
  empties dropped, order = categories then tags.
- `toFeedItem`: sets `categories` + `image` from data; `image` absent when no `featuredImage`.

Endpoint/helper (`rss-xml.test.ts`, new — test the pure `rss-xml.ts` helpers, not the Astro route):
- `channelExtras` emits language/lastBuildDate/generator/atom:self with a given site + locale;
  generator contains `?v=1.0`; `lastBuildDate` omitted when items empty.
- `toRssItem` emits `<media:content>` with an absolute URL when image present; none when absent;
  categories pass through.
- `xmlEscape` escapes the five entities.

No snapshot of the whole feed; assert on substrings so the tests are robust to attribute order.

## Out of scope (tracked separately)

- Channel `<image>` (site logo) + per-item `<dc:creator>` (author) → **#77** (needs Identity data).
- Any feed *settings* changes — none here.
