# Design — Admin SPA: Shell + Content List (Increment #9)

_Date: 2026-06-14 · Status: approved_

## Purpose

Stand up Saytu's **admin SPA** — the first user-visible piece — and the
in-browser adapter pattern it runs on. This increment delivers the app shell
(sidebar IA, theme, branding) + a content-list view backed by an **in-browser
in-memory `DataPort`**, with zero server. It is the foundation the editor canvas
(#10) and the publish/open flow (#11) build on.

Follows a decision-complete PRD (§22 stack, §23 monorepo, §24 admin UX) and the
complete backend engine (#1–#8). The Claude Design admin bundle at `design/admin/`
is the visual source of truth (tokens + shell + screens already designed).

## The architectural bet: in-browser, in-memory adapters

The entire `@saytu/core` engine is pure/edge-safe, and the in-memory
`DataPort`/`GitPort` are `Map`-based — so the engine runs **in the browser**. The
SPA depends on the **ports**, injected with **in-memory adapters now**; a later
increment swaps in real persistence (Hono API + `db-sqlite`/`git-local` behind a
server) **without touching the UI**. This cashes in the hexagonal architecture: a
fully interactive, UAT-able admin ships client-side with no backend.

## Scope

**In:**
- A new `@saytu/db-memory` package: `createMemoryDataPort(seed?)` — the in-memory
  `DataPort` (currently a test fake) promoted to a real, contract-tested adapter
  (passes `runDataPortContract`); browser-safe; optionally seeded with drafts.
- A new `apps/saytu-admin/` app: Vite + React 18 + TypeScript + Tailwind v4 +
  react-router-dom; `tokens.css` ported; vitest + @testing-library/react + jsdom.
- The **shell**: sidebar nav (the §24 IA), theme toggle (light/dark), Saytu
  logo/branding, collapse; routing.
- The **content list** screen for `posts` and `pages`: a table (title · status ·
  locale · updated) from the seeded in-memory `DataPort` (`listDrafts`),
  filterable by collection; rows link to the (stubbed) editor route.
- Honest "coming soon" placeholders for the other nav items (Dashboard, Media,
  Forms, Site, Settings) so the IA is complete and navigable.

**Out (explicitly deferred):**
- The Tiptap **editor canvas** (#10), publish/open wiring (#11).
- **Real persistence** — the Hono API + `db-sqlite`/`git-local` behind a server.
- Preview, command palette (⌘K), tweaks panel, focus mode, media/forms/site/
  settings functionality, dashboard widgets, the locale switcher logic.
- Radix/shadcn components — introduced in the editor slices where interactive
  a11y (slash-menu combobox, dialogs, §25) actually needs them.

## Why these choices

- **`@saytu/db-memory` as a real package, not an inline mock.** The app, future
  demos, and the editor slices all need a solid browser persistence tier.
  Promoting the in-memory adapter once — and running it through the existing
  `runDataPortContract` — makes it a legitimate, trustworthy adapter (the ports
  pattern: sqlite / d1 / memory are siblings). Browser-safe (Map-based, pure JS).
- **Faithful CSS port over re-Tailwinding the design.** The design bundle is
  high-quality CSS-variable tokens + semantic CSS. The handoff explicitly says
  recreate the *visual output* in whatever tech fits — porting `tokens.css` + the
  shell CSS is faster and more faithful than translating to utilities. Tailwind v4
  is set up (per §22 + the proven prototype) for incremental utility use;
  Radix/shadcn land with the interactive editor components (§24/§25).
- **react-router** (URL-based) over the design prototype's `route`-state: real
  URLs (`/posts`, `/pages`, later `/edit/:collection/:locale/:slug`) are
  deep-linkable and the right foundation for a CMS admin.
- **Component tests via vitest + @testing-library/react + jsdom** fit the
  subagent-driven TDD flow (render a component, assert the DOM) — the same Vitest
  the monorepo already uses, with a jsdom environment for the app.

## Architecture

```
packages/db-memory/                # @saytu/db-memory
├── package.json                   # deps: @saytu/core; dev: @saytu/db-testing, vitest, ts
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── adapter.ts                 # createMemoryDataPort(seed?): DataPort
│   └── index.ts
└── test/contract.test.ts          # runDataPortContract(() => createMemoryDataPort())

apps/saytu-admin/                  # @saytu/admin (private app)
├── package.json                   # react 18, react-dom, react-router-dom, @saytu/core,
│                                  #   @saytu/db-memory; dev: vite, @vitejs/plugin-react,
│                                  #   tailwindcss v4 + @tailwindcss/vite, vitest, jsdom,
│                                  #   @testing-library/react, @testing-library/jest-dom, ts
├── index.html
├── vite.config.ts                 # react + tailwind plugins; vitest test config (jsdom)
├── tsconfig.json
├── src/
│   ├── main.tsx                   # React root + RouterProvider
│   ├── app.tsx                    # routes + shell layout
│   ├── styles/tokens.css          # ported from design/admin/tokens.css
│   ├── styles/shell.css           # ported shell CSS (from design/admin/shell.css, trimmed)
│   ├── data/store.ts              # creates the seeded in-memory DataPort (the app's adapter)
│   ├── shell/Sidebar.tsx          # nav (§24 IA), logo, theme toggle, collapse
│   ├── shell/Layout.tsx           # shell layout (sidebar + main outlet)
│   ├── screens/ContentList.tsx    # the posts/pages table
│   └── screens/Placeholder.tsx    # "coming soon" for not-yet-built routes
└── test/                          # component tests (Sidebar, ContentList)
```

## Data flow

- `src/data/store.ts` creates one `createMemoryDataPort(seed)` instance (seeded
  with a few sample post/page drafts) and exposes it to the app (a module
  singleton, or React context — context, so tests can inject a fresh seeded
  adapter).
- `ContentList` calls `data.listDrafts({ collection })` (async) on mount, renders
  the rows. Columns: title (from `draft.metadata.title` ?? slug), status (from
  `draft.metadata.status` ?? 'draft'), locale, updated (`draft.updatedAt`).
- Routing: `/` redirects to `/posts`; `/posts` and `/pages` render `ContentList`
  with the collection; other nav routes render `Placeholder`.

## `@saytu/db-memory`

`createMemoryDataPort(seed?: DraftInput[]): DataPort` — the full `DataPort`
(`getDraft`/`saveDraft`/`deleteDraft`/`listDrafts`/`getLock`/`putLock`/
`deleteLock`/`close`), Map-backed, identical in behavior to the in-memory fakes
used in tests (createdAt preserved on upsert, etc.). An optional `seed` array of
`DraftInput`s is applied via `saveDraft` at construction. Runs
`runDataPortContract` to prove conformance. No Node APIs — browser/edge-safe.

## Testing

- **`@saytu/db-memory`**: `runDataPortContract(() => createMemoryDataPort())`
  (the 12 shared contract tests) + a seed test (a seeded adapter returns the
  seeded drafts from `listDrafts`).
- **app component tests** (vitest + jsdom + @testing-library/react):
  - `Sidebar`: renders the §24 nav labels (Dashboard, Posts, Pages, Media, Forms,
    Site, Settings); the theme toggle flips `data-theme`.
  - `ContentList`: given a seeded in-memory `DataPort` (injected via context),
    renders one row per draft with title/status/locale; `collection="pages"` shows
    only page drafts.
- A smoke test that the app root renders without crashing (router + shell mount).

## Error handling

- Empty content list (no drafts for a collection) → a friendly empty state, not a
  crash.
- `listDrafts` is async; the screen shows nothing (or a minimal loading state)
  until it resolves — no error path for the in-memory adapter (it never rejects).

## Definition of done

- `pnpm install` clean; `pnpm dev` in `apps/saytu-admin` serves the admin with the
  shell + a populated content list.
- `pnpm test` green: `@saytu/db-memory` contract + the app component tests; the
  existing 121 tests unaffected.
- `pnpm typecheck` clean across packages + the new app. (The app is a browser
  bundle; it is NOT under the core edge guard — that guard governs `@saytu/core`.)
- Committed via the subagent-driven flow.

## Note on scope rhythm

This is a larger increment than the backend ones (a new app + a new package +
shell + list), but it is the frontend foundation; #10 (editor canvas) and #11
(publish flow) are tighter slices built on top. The Tiptap canvas is deliberately
excluded here to keep this slice reviewable.
