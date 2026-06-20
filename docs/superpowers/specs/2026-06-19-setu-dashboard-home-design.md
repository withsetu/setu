# Setu Admin — Dashboard "Home" — Design

> Status: approved for implementation · Date: 2026-06-19 · Branch: `feat/dashboard` (worktree)

## Overview

Replace the `<Placeholder title="Dashboard" />` stub at the `/dashboard` route with a real,
calm "home of the admin" screen, and make `/` land there. The dashboard is an at-a-glance
overview that helps a writer re-enter their work and surfaces what makes Setu different
(Git-backed, multi-topology). It is built from small, independently-testable presentational
widgets fed by a single thin container, mirroring the existing `ContentList` pattern.

This is the free-tier dashboard described in `plan/admin-design-brief.md` §2, extended with
counts, a site/topology card, a first-run getting-started checklist, and a static tips deck.

## Scope

**In scope (v1):**

- A `Dashboard` screen replacing the placeholder at `App.tsx`.
- Redirect `/` → `/dashboard` (replacing the current `/` → `/posts`).
- Seven widgets (see Widgets), some fully wired, some honest labeled stubs.
- Per-widget unit tests + a container smoke test, matching the existing suite style.
- New CSS in `apps/admin/src/styles/` using the existing design tokens.

**Out of scope (deferred, with reasons):**

- **Real content Sync (git fetch/pull/merge, ahead/behind).** `GitPort` is a deliberately
  narrow 4-method seam (`headSha`, `readFile`, `commitFile`, `list`) with no fetch/pull/push;
  even `git-http` implements only that contract. A true Sync requires new `GitPort` methods
  across all adapters — its own spec. v1 ships a designed-but-disabled Sync affordance.
- **Real deploy pipeline status** (pending/building/live/failed). `useDeploy` is a local
  snapshot stand-in (`getLive`/`setLive`); v1 shows what it can and labels the rest.
- **Remote "what's new" feed.** A network fetch from Setu's blog in a local-first OSS admin
  is a phone-home/privacy + failure/caching concern. v1 ships a bundled static tips deck with
  the same UI; a remote, opt-in feed can graduate later.
- **Traffic/analytics widgets, presence beyond locks** — need a backend / out of brief scope.

## Architecture

One thin container loads data via hooks already in the tree and passes plain props to
presentational widgets. No widget fetches its own data; each is pure and unit-testable.

```
apps/admin/src/screens/Dashboard.tsx      ← container: loads, composes, lays out grid
apps/admin/src/widgets/
  RecentEdits.tsx        list of recent entries, click-to-open      [WIRED]
  QuickActions.tsx       New post / New page                        [WIRED]
  CountsTiles.tsx        posts / pages / drafts / media tiles       [WIRED, media best-effort]
  SiteStatusCard.tsx     topology + deploy state + Sync affordance  [PARTIAL: Sync stubbed]
  GettingStarted.tsx     dismissible first-run checklist            [WIRED]
  TipsDeck.tsx           bundled static tips + Pro teasers          [WIRED, no network]
  WhosEditing.tsx        currently-locked entries (lockedBy)        [BEST-EFFORT]
apps/admin/src/styles/dashboard.css        ← tokens-based styling, imported by index.css
```

Hooks reused (already provided in the app tree): `useServices`/`useData`, `useDeploy`.
Helpers/components reused: `listContentEntries` + `parseContentPath` (`@setu/core`),
`lifecycleLabel` (`lifecycle/label`), `siteUrl` (`shell/site-url`), `Icon`, `StatusPill`,
`PageHeader`. Dismissible widgets persist a flag in `localStorage` via a small local helper
(note: the existing `useDismiss` is an Escape/click-outside popup hook, **not** persistence —
it is not used here). "New post/page" are plain `<Link>`s to `/edit/<collection>/en/new`
(slug minting already happens inside the editor's new-entry route), not `mintSlug` calls.

### Data flow

The container performs one load on mount (like `ContentList`), producing a merged,
cross-collection entry list, then derives every widget's props from it:

1. For each collection in `['post', 'page']`: `data.listDrafts({ collection })` +
   `git.list('content/<collection>/')` → read/parse committed → `listContentEntries(...)`.
2. Concatenate into one array; sort by `updatedAt` desc.
3. Derive:
   - **RecentEdits**: top ~6 by `updatedAt` (title, collection, status, updatedAt, ref).
   - **CountsTiles**: counts grouped by collection and by draft/published. **Media count is
     best-effort** — the media keyspace belongs to the other (api/media) track and may be
     absent on this branch; render `—` when no media source is available rather than faking.
   - **WhosEditing**: `getLock(ref)` over the already-loaded entries; show entries with a
     non-null lock (`lockedBy`). Capped to the loaded list — no extra fan-out. Empty state
     when none.
   - **GettingStarted**: derive checks — site URL set? (`siteUrl`/config), ≥1 post exists?
     (entry list), deployed? (`useDeploy().sha !== null`). Dismiss persisted in `localStorage`.
4. Independent of the entry list:
   - **SiteStatusCard**: site URL + topology label + deploy state (`useDeploy`); Sync button
     rendered **disabled** with a quiet "not yet connected" affordance.
   - **TipsDeck**: a bundled static array of tips/Pro teasers; dismiss persisted in `localStorage`.
   - **QuickActions**: plain `<Link>`s to `/edit/post/en/new` and `/edit/page/en/new`.

### Route change

`App.tsx`: `<Route path="/" element={<Navigate to="/posts" replace />} />` becomes
`<Navigate to="/dashboard" replace />`, and `/dashboard` renders `<Dashboard />` instead of
`<Placeholder title="Dashboard" />`.

## Layout

Calm overview per brief §2. A top strip of `CountsTiles`, then a responsive 2-column grid:

- **Main column:** RecentEdits, QuickActions, WhosEditing.
- **Side column:** SiteStatusCard, GettingStarted, TipsDeck.
- Collapses to a single column on narrow viewports.

Styling uses existing tokens (`styles/tokens.css`) and matches existing semantic class
conventions (`page-body`, `empty-state`, `btn`, card patterns). New rules live in
`styles/dashboard.css`. Light + dark inherited from the token system. Keyboard-accessible,
visible focus, per the brief's AA requirement.

## Error / empty / stub states

- **Empty recent edits** (fresh install): a calm empty state nudging "Create your first post".
- **Best-effort widgets** (WhosEditing, media count): render a neutral empty/`—` state, never
  an error, when the underlying source is unavailable on this branch.
- **Stub affordances** (Sync, deploy detail): visibly present but clearly "not yet wired" —
  intentional, not broken (consistent with the brief's Pro-lock treatment).
- **Load failure**: the container surfaces a single inline error state rather than throwing.

## Testing

Matches the existing 53-file vitest suite:

- One `*.test.tsx` per widget — render with fixture props, assert visible output and that
  empty/stub states render correctly.
- A `dashboard.test.tsx` container smoke test — mounts with seeded services, asserts the
  widgets compose and the recent list reflects seeded drafts.
- A route test asserting `/` redirects to `/dashboard`.

Baseline before work: 213 tests passing (53 files).

## File plan

| File | Change |
|---|---|
| `apps/admin/src/screens/Dashboard.tsx` | new container |
| `apps/admin/src/widgets/*.tsx` | new widget components (7) |
| `apps/admin/src/styles/dashboard.css` | new, imported by `index.css` |
| `apps/admin/src/App.tsx` | route: `/` → `/dashboard`; render `<Dashboard />` |
| `apps/admin/test/dashboard*.test.tsx` | new tests |

## Future work (not now)

- Promote Sync to a real action by extending `GitPort` (fetch/pull, ahead/behind) — own spec.
- Real deploy-pipeline status once a deploy backend exists.
- Opt-in remote tips/news feed (same `TipsDeck` UI), with explicit consent.
- Wire media count once the media/api track lands on the shared branch.
