# Per-Locale RSS Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one RSS feed per content locale (`/rss.xml` default + `/<locale>/rss.xml`) and advertise every language feed in the page `<head>`.

**Architecture:** Locale-parameterise the existing feed selection, add a `feedLocales()` discovery helper, add a dynamic `/[locale]/rss.xml` endpoint for non-default locales with posts, and have the theme `Layout` emit one hreflang-tagged `<link rel="alternate">` per locale (threaded from the pages).

**Tech Stack:** Astro + `@astrojs/rss`, TypeScript (strict), Vitest. Extends PR #51 (the `rss-feed` branch).

## Global Constraints

- TS strict, `verbatimModuleSyntax` (`import type`), `isolatedModules`.
- Default locale = `DEFAULT_LOCALE` (`'en'`) from `@setu/core`. Default-locale feed URL is `/rss.xml`; non-default is `/<locale>/rss.xml` (mirrors the site URL convention via `entryUrlPath`, which already keeps the locale segment for non-default posts).
- **Published-ness rule:** posts only (`id` starts `post/`), **`data.published !== false`** (Setu's only "not published" signal — see [[setu-publish-semantics]]). No `status` field check.
- Feeds gated on the single global `reading.feed.enabled`; `reading.feed.items` caps each feed. No per-locale settings.
- Single-locale sites: no `/[locale]/` routes, one header link — today's behaviour preserved.
- Absolute links via `SETU_SITE_URL` → Astro `site` (unchanged). The admin `tsc` has one **pre-existing, unrelated** `BlockInspector.tsx` error — ignore it; it's not in this branch's scope.
- TDD; conventional commits ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Feed lib — locale parameter + `feedLocales`

**Files:**
- Modify: `apps/site/src/lib/feed.ts`
- Test: `apps/site/test/feed.test.ts`

**Interfaces:**
- Produces: `selectFeedPosts(rows, limit, locale?)`; `getFeedPosts(entries, limit, locale?)`; `feedLocales(entries): string[]`.

- [ ] **Step 1: Add the failing tests**

Append to `apps/site/test/feed.test.ts`:
```ts
import { feedLocales } from '../src/lib/feed'

describe('selectFeedPosts — non-default locale', () => {
  it('selects only the requested locale, newest first', () => {
    const rows: FeedRow[] = [
      row('post/en/a', '2024-01-01'),
      row('post/fr/x', '2024-02-01'),
      row('post/fr/y', '2024-03-01'),
    ]
    expect(selectFeedPosts(rows, 10, 'fr').map((r) => r.id)).toEqual(['post/fr/y', 'post/fr/x'])
    expect(selectFeedPosts(rows, 10, 'en').map((r) => r.id)).toEqual(['post/en/a'])
  })
})

describe('feedLocales', () => {
  it('returns distinct published-post locales, default locale first', () => {
    const entries = [
      { id: 'post/fr/x', data: {} },
      { id: 'post/en/a', data: {} },
      { id: 'post/de/z', data: { published: false } }, // only-unpublished locale → excluded
      { id: 'page/en/about', data: {} },                // page → ignored
    ]
    expect(feedLocales(entries)).toEqual(['en', 'fr'])
  })
  it('single-locale → just the default', () => {
    expect(feedLocales([{ id: 'post/en/a', data: {} }])).toEqual(['en'])
  })
})
```
(The existing `selectFeedPosts(rows, 10)` tests still pass — the new `locale` arg defaults to `DEFAULT_LOCALE` = `'en'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/site test -- feed`
Expected: FAIL — `feedLocales` not exported; `selectFeedPosts` ignores the 3rd arg.

- [ ] **Step 3: Edit `apps/site/src/lib/feed.ts`**

Add the import at the top (alongside the existing imports):
```ts
import { DEFAULT_LOCALE } from '@setu/core'
```
Change `selectFeedPosts` to take a `locale`:
```ts
/** Pure: keep published posts for `locale`, newest first, capped at `limit`. */
export function selectFeedPosts(rows: FeedRow[], limit: number, locale: string = DEFAULT_LOCALE): FeedRow[] {
  return rows
    .filter((r) => {
      const [collection, loc] = r.id.split('/')
      if (collection !== 'post' || loc !== locale) return false
      // `published:false` is Setu's only "not published" signal (lifecycle hidden()); committed = live.
      if (r.data.published === false) return false
      return true
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, Math.max(0, limit))
}
```
Thread `locale` through `getFeedPosts`:
```ts
export function getFeedPosts(
  entries: { id: string; data: Record<string, unknown>; body?: string; filePath?: string }[],
  limit: number,
  locale: string = DEFAULT_LOCALE,
): FeedItem[] {
  const rows: FeedRow[] = entries.map((e) => ({
    id: e.id,
    data: e.data,
    body: e.body,
    date: resolvePostDate(e as DatableEntry),
  }))
  return selectFeedPosts(rows, limit, locale).map(toFeedItem)
}
```
Add the discovery helper (anywhere after `getFeedPosts`):
```ts
/** Distinct locales that have at least one published post, default locale first. */
export function feedLocales(entries: { id: string; data: Record<string, unknown> }[]): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    const [collection, locale] = e.id.split('/')
    if (collection !== 'post' || !locale) continue
    if (e.data.published === false) continue
    set.add(locale)
  }
  return [...set].sort((a, b) =>
    a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b),
  )
}
```

- [ ] **Step 4: Run tests + full suite + typecheck**

Run: `pnpm --filter @setu/site test -- feed` → PASS. Then `pnpm --filter @setu/site test` (full) and `pnpm --filter @setu/site typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/feed.ts apps/site/test/feed.test.ts
git commit -m "feat(site): locale-parameterised feed selection + feedLocales helper"
```

---

## Task 2: The `/[locale]/rss.xml` endpoint

**Files:**
- Create: `apps/site/src/pages/[locale]/rss.xml.ts`
- (`apps/site/src/pages/rss.xml.ts` is unchanged — `getFeedPosts`'s default `locale` already serves the default-locale feed.)

**Interfaces:**
- Consumes: `getFeedPosts`, `feedLocales` (Task 1); `DEFAULT_LOCALE` (`@setu/core`); `loadSiteSettings`.

- [ ] **Step 1: Create `apps/site/src/pages/[locale]/rss.xml.ts`**

```ts
import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'
import { DEFAULT_LOCALE } from '@setu/core'
import { loadSiteSettings } from '../../lib/site-settings'
import { getFeedPosts, feedLocales } from '../../lib/feed'

export const prerender = true

export async function getStaticPaths() {
  const entries = await getCollection('entries')
  return feedLocales(entries.map((e) => ({ id: e.id, data: e.data as Record<string, unknown> })))
    .filter((locale) => locale !== DEFAULT_LOCALE)
    .map((locale) => ({ params: { locale } }))
}

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  if (!settings.reading.feed.enabled) return new Response(null, { status: 404 })
  const locale = context.params.locale as string
  const entries = await getCollection('entries')
  const items = getFeedPosts(
    entries.map((e) => ({
      id: e.id,
      data: e.data as Record<string, unknown>,
      body: e.body,
      filePath: e.filePath,
    })),
    settings.reading.feed.items,
    locale,
  )
  return rss({
    title: `${settings.general.title} (${locale.toUpperCase()})`,
    description:
      settings.general.description || settings.general.tagline || settings.general.title,
    site: context.site ?? 'http://localhost:4321',
    items,
  })
}
```

- [ ] **Step 2: Verify the build emits both feeds (multilingual sandbox, feed enabled)**

Sync + generate first (fresh worktree): `pnpm --filter @setu/site exec astro sync`, `node ../../scripts/gen-blocks.mjs`, `node ../../scripts/gen-relations.mjs` (mirror render.test.ts's setup if needed).
Enable the feed for the build — point at a content dir that has `fr` posts and a `settings.json` with `reading.feed.enabled: true`, then:
Run: `SETU_SITE_URL=https://example.com SETU_CONTENT_DIR=<dir-with-fr-posts> pnpm --filter @setu/site build`
Expected: both `apps/site/dist/rss.xml` and `apps/site/dist/fr/rss.xml` exist. Confirm: `/fr/rss.xml` `<channel><title>` ends `(FR)`, its `<item>` links start `https://example.com/post/fr/`, and it contains only `fr` posts; `/rss.xml` contains only default-locale posts.
> If no `fr` posts are present in the chosen content dir, `dist/fr/rss.xml` is correctly absent — verify against a dir that has them (the dev sandbox seeds `post/fr/bonjour`).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @setu/site typecheck`
```bash
git add apps/site/src/pages/'[locale]'/rss.xml.ts
git commit -m "feat(site): /[locale]/rss.xml endpoint for non-default-locale feeds"
```

---

## Task 3: Per-locale autodiscovery in the header

**Files:**
- Modify: `packages/theme-default/Layout.astro`, `packages/theme-default/PageLayout.astro`, `packages/theme-default/PostLayout.astro`
- Modify: `apps/site/src/pages/index.astro`, `apps/site/src/pages/[...path].astro`

**Interfaces:**
- Consumes: `feedLocales` (Task 1); the feed routes (Task 2).

- [ ] **Step 1: `packages/theme-default/Layout.astro` — emit one link per locale**

Add `import { DEFAULT_LOCALE } from '@setu/core'` to the frontmatter imports. Add `feedLocales?: string[]` to the `Props` interface, and destructure it with a default:
```ts
const { title, lang = 'en', themeOptions = {}, siteSettings, feedLocales = [] } = Astro.props
```
Compute the links (after `docTitle`):
```ts
const feedLinks = siteSettings?.reading.feed.enabled
  ? (feedLocales.length ? feedLocales : [DEFAULT_LOCALE])
  : []
```
Replace the existing single feed `<link>` block in `<head>`:
```astro
    {feedLinks.map((loc) => (
      <link
        rel="alternate"
        type="application/rss+xml"
        title={loc === DEFAULT_LOCALE ? siteTitle : `${siteTitle} (${loc.toUpperCase()})`}
        href={loc === DEFAULT_LOCALE ? '/rss.xml' : `/${loc}/rss.xml`}
        hreflang={loc}
      />
    ))}
```
(When `feedLocales` is empty/undefined but the feed is enabled, this still emits the single default `/rss.xml` link — no regression.)

- [ ] **Step 2: Thread `feedLocales` through `PageLayout.astro` + `PostLayout.astro`**

In each, add `feedLocales?: string[]` to the `Props` interface, destructure it (`const { …, feedLocales } = Astro.props`), and pass it to `<Layout … feedLocales={feedLocales}>`.

- [ ] **Step 3: Compute + pass `feedLocales` in the pages**

`apps/site/src/pages/index.astro` — add imports and compute the list:
```astro
import { getCollection } from 'astro:content'
import { feedLocales } from '../lib/feed'
```
```ts
const localesForFeed = feedLocales(
  (await getCollection('entries')).map((e) => ({ id: e.id, data: e.data as Record<string, unknown> })),
)
```
and pass it: `<PageLayout … siteSettings={siteSettings} feedLocales={localesForFeed}>`.

`apps/site/src/pages/[...path].astro` — `getCollection` is already imported; add `import { feedLocales } from '../lib/feed'`, then in the page frontmatter:
```ts
const localesForFeed = feedLocales(
  (await getCollection('entries')).map((e) => ({ id: e.id, data: e.data as Record<string, unknown> })),
)
```
and pass it: `<TemplateLayout … siteSettings={siteSettings} related={related} feedLocales={localesForFeed}>`.

- [ ] **Step 4: Verify the header (build with feed enabled, multilingual)**

Run: `SETU_SITE_URL=https://example.com SETU_CONTENT_DIR=<dir-with-fr-posts> pnpm --filter @setu/site build`
Expected: `apps/site/dist/index.html` `<head>` contains `<link rel="alternate" type="application/rss+xml" … hreflang="en" href="/rss.xml">` AND `… hreflang="fr" href="/fr/rss.xml">`. With the feed disabled → no such links. Single-locale content → only the `en` link.

- [ ] **Step 5: Typecheck + full site suite + commit**

Run: `pnpm --filter @setu/site typecheck` and `pnpm --filter @setu/site test`.
```bash
git add packages/theme-default/Layout.astro packages/theme-default/PageLayout.astro packages/theme-default/PostLayout.astro apps/site/src/pages/index.astro apps/site/src/pages/'[...path].astro'
git commit -m "feat(theme): advertise every locale's RSS feed in <head> (hreflang)"
```

- [ ] **Step 6: UAT** (dev stack)

Enable the feed in Settings → Content & Reading. Visit `/rss.xml` (default-locale posts) and `/fr/rss.xml` (fr posts only). View-source the home page → a `<link rel="alternate" rss>` for each locale. Disable → all 404 + links gone.

**Final:** whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** locale-parameterised selection + `feedLocales` (T1); `/rss.xml` default unchanged + `/[locale]/rss.xml` route (T2); per-locale hreflang header threaded from pages (T3); single-locale degrades cleanly (T1 `feedLocales` single-default test + T3 default-link fallback); published-ness via `published !== false` (T1/T2). ✅ Non-goals (per-locale settings, cross-feed translation links, Atom/JSON) excluded.

**2. Placeholder scan:** No TBD/TODO. The build-verification steps name exact expected files/strings; the one conditional ("if no fr posts, dist/fr/rss.xml is absent") is a correctness note with the exact dir to use, not a gap.

**3. Type consistency:** `selectFeedPosts(rows, limit, locale?)`, `getFeedPosts(entries, limit, locale?)`, `feedLocales(entries): string[]`, the `feedLocales?: string[]` prop (Layout/PageLayout/PostLayout), and `DEFAULT_LOCALE` usage are consistent across T1–T3. The `/[locale]/rss.xml.ts` import depth (`../../lib/…`) matches the `pages/[locale]/` location. Default-locale feed URL `/rss.xml` matches `entryUrlPath`'s locale-drop rule.
