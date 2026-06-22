# Admin Dashboard Redesign — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `apps/admin` dashboard screen (`src/screens/Dashboard.tsx` + `src/dashboard/`)
**Depends on:** the shadcn foundation ([PR #25](https://github.com/saytudev/setu/pull/25), branch `admin-shadcn-foundation`). This work branches off that, not `main` — it needs the standard tokens + primitives.

## 1. Goal

Rebuild the dashboard as the **first surface migrated onto shadcn**, and the reference for "this is how we do screens now." Today's dashboard is an unfocused grab-bag of 7 widgets trying to be a launcher, a status board, and an onboarding guide at once. The redesign gives it one clear job — **get the user to work, then answer "what's the state of my site" at a glance** — on the shadcn primitives + restrained motion.

This is genuinely the first PR with a *visible* before/after (the foundation PR was deliberately inert).

## 2. Information architecture (decided)

Primary user/job: **the daily editor first, site-health second** (work-first, ruthlessly prioritized; onboarding only for a fresh site).

**Header**
- Greeting (time-of-day only — the `Actor` model is `{id, role}` with no name yet; per-user identity is a later arc) + subtitle.
- Primary actions, lifted out of a card: **New post** (primary) · **New page** · **Deploy**.

**Get-to-work**
- **Resume editing** (hero) — the most-recent edits, richer than today: title · collection chip · status badge · "edited Xh ago". (No author column — `ContentRow` has no author field; not faked.) Row click opens the editor.

**Site-health strip (3 cards)**
- **At a glance** — Posts · Pages · Published · Drafts. **Drafts is a link → `/posts?status=draft`** (reuses the findability filter). Media tile dropped (separate surface).
- **Site & deploy** — from today's SiteStatusCard: live URL, last deploy + SHA, "View site". (The Deploy *action* lives in the header — gated by `site.deploy` — so it isn't duplicated here.)
- **Who's editing** — active locks, **rendered only when a lock is held**.

**Conditional**
- **Getting started** — a 3-step onboarding checklist (set site URL · create first post · deploy). It **auto-hides once all three steps are done** (`hasSiteUrl && hasPost && hasDeployed`, where `hasPost = posts > 0`, matching the checklist's own "first post" item), or when manually dismissed. (The hide rule tracks the checklist's own items rather than a separate content count, so it stays self-consistent with what it shows.)

**Cut**
- **TipsDeck** (rotating tips = demo noise in a daily-driver tool).
- **QuickActions** as a card (its actions moved into the header).

## 3. Component structure

`src/screens/Dashboard.tsx` orchestrates; widgets live in `src/dashboard/widgets/`, each one card with a single responsibility, built on `@/components/ui`.

| File | Responsibility | Built from |
|---|---|---|
| `screens/Dashboard.tsx` | Layout + data load + greeting + header actions; composes the widgets | header + Button |
| `dashboard/widgets/ResumeEditing.tsx` | Recent-edits hero list; row → editor; empty state | Card, Badge, motion |
| `dashboard/widgets/StatTiles.tsx` | 2×2 metric grid; Drafts → filtered list link | Card, metric layout |
| `dashboard/widgets/SiteDeployCard.tsx` | URL + last deploy/SHA + "View site" link (status only; Deploy action is in the header) | Card, Button |
| `dashboard/widgets/WhosEditing.tsx` | Active locks; returns null when none | Card, Avatar |
| `dashboard/widgets/GettingStarted.tsx` | 3-step onboarding checklist; renders only when `!(hasSiteUrl && hasPost && hasDeployed)` and not dismissed | Card |
| `dashboard/DashboardSkeleton.tsx` | Loading placeholders mirroring the layout | Skeleton |

**Removed:** `widgets/TipsDeck.tsx`, `widgets/QuickActions.tsx`, `widgets/CountsTiles.tsx` (→ StatTiles), `widgets/RecentEdits.tsx` (→ ResumeEditing), `widgets/SiteStatusCard.tsx` (→ SiteDeployCard). `widgets/WhosEditing.tsx` and `GettingStarted.tsx` are rewritten on shadcn.

## 4. Data flow

No new data layer — reuse `src/dashboard/entries.ts` exactly:
- `loadDashboardEntries(data, git, deployedAt)` → rows (sorted by `updatedAt`).
- `dashboardCounts(rows)` → `{ posts, pages, drafts, published }`.
- `recentEntries(rows, n)` → hero rows (n = 5).
- `loadActiveLocks(data, rows)` → locks for Who's-editing.
- `useDeploy()` → `{ deployedAt, sha }` for SiteDeployCard.

**Status → Badge mapping** (lifecycle.state):
- `draft` → `warning`
- `staged` → `info`
- `live` → `success`

`hasDeployed` = `useDeploy().sha !== null`; the Getting-started hide rule uses `hasSiteUrl` (`siteUrl() !== ''`), `hasPost` (`counts.posts > 0`), and `hasDeployed` — the three checklist steps. Greeting is time-of-day only (`Actor` has no name field — not invented).

## 5. Polish & feel (restrained)

- **Loading:** `DashboardSkeleton` (shadcn `Skeleton`) mirrors the final layout — no spinners, no layout shift.
- **Motion (`motion`, used sparingly):** Resume-editing rows do a subtle staggered fade/slide-in on first load only; honors `prefers-reduced-motion` (no animation when set). Hover/press feedback on rows + buttons via tokens. No decorative animation.
- **Empty states:** Resume editing with no rows → "No edits yet" + a New-post affordance; stats show `0`; Who's-editing absent when no locks; the whole "site-health" still renders for a fresh site (with zeros) beneath Getting started.
- **Error state:** load failure → one quiet inline message (keep today's "Couldn't load your dashboard. Try refreshing." behavior), not a broken layout.

## 6. Testing

Component tests (jsdom + Testing Library), following existing `recent-edits.test.tsx` / `counts-tiles.test.tsx` patterns:
- `ResumeEditing`: renders rows with title/collection/relative-time; maps each lifecycle.state to the correct Badge variant; row links to the editor route; empty state when no rows.
- `StatTiles`: renders the four counts; Drafts is a link to `/posts?status=draft`.
- `SiteDeployCard`: shows URL + SHA; "View site" uses the site URL (no Deploy button — that's header-only).
- `WhosEditing`: renders a lock holder; returns nothing when there are no locks.
- `GettingStarted`: visible on a fresh site (all three steps incomplete); absent when `hasSiteUrl && hasPost && hasDeployed` are all true.
- `Dashboard`: greeting present; header has New post / New page / Deploy; skeleton shown before data resolves.

## 7. Non-goals

- The shell/sidebar migration (its own later PR; the dashboard renders inside the existing shell, re-skinned only via the shared tokens).
- Any new data/telemetry (e.g. an activity feed across users) — reuse existing data only.
- Multi-site / multi-topology aggregation — single-site, as today.
- Removing the legacy `notify` system or wiring Sonner (tracked for the Forms PR).

## 8. Verification

- `pnpm --filter @setu/admin typecheck` + `test` + `build` green.
- Manual run on `:5174` (worktree admin) for the real before/after: greeting, Resume editing hero, status badges in brand colors, stat strip, deploy card, dark mode, empty/skeleton states.
