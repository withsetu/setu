# Design — Admin Shell Visual-Fidelity Pass (Increment #10)

_Date: 2026-06-14 · Status: approved_

## Purpose

Increment #9 shipped a working but visually-thin admin shell: `tokens.css` was
ported verbatim (correct colors/fonts/theming), but the sidebar CSS was a compact
authored placeholder and the **nav icons were dropped**. The product owner (the
Notion/Linear-polish bar) flagged it immediately ("it misses icons and all").

This increment makes the chrome **match the Claude Design mockup** by porting the
design's icon set + the real sidebar and content-list styling/markup — before the
editor canvas (#11) goes on top of it. Design source of truth: `design/admin/`
(committed to the repo).

## Scope

**In — static chrome fidelity for the surfaces visible today (sidebar + content list):**
- `src/ui/Icon.tsx` — port the `ICONS` map (~70 Lucide-style SVG path strings) +
  the `Icon` component from `design/admin/components.jsx`, TS-typed.
- `src/ui/StatusPill.tsx` — port `Badge`/`StatusPill` + `STATUS_MAP` (the status
  chip used in the content list).
- **Sidebar** rebuilt to match `design/admin/shell.jsx`'s structure: workspace
  header (logo + name + chevron), icon nav items (§24 IA), footer theme toggle
  (sun/moon icon).
- **ContentList** rebuilt to match the design's polished table + status pills.
- CSS: port the foundational `components.css` (Icon/Button/Badge/StatusPill), the
  **sidebar** section of `shell.css`, and the **content-list** section of
  `screens.css` into `apps/saytu-admin/src/styles/`; match markup to the design's
  class names. `tokens.css` unchanged.
- Behavior tests for the new bits; the existing 7 admin tests stay green.

**Out (deferred — interactive features get their own increments even though the
design CSS also covers them):**
- Command palette (⌘K), toasts, tweaks panel, pro chips/modals, the user-chip
  menu, the topology/deploy footer indicator, sidebar collapse animation.
- Styling for the Dashboard/Media/Forms/Site/Settings screens (still placeholders).
- The editor canvas (#11) and publish/open flow (#12-ish).

## Why these choices

- **Faithful CSS port, not re-Tailwinded.** The design is high-quality CSS over
  the `tokens.css` variables; the handoff says recreate the visual output in
  whatever tech fits. Porting the design's CSS + matching markup is faster and
  truer than translating to utilities. (Tailwind v4 stays available for
  incidental utilities.)
- **`Icon` via `dangerouslySetInnerHTML` is safe here.** The `ICONS` map is a
  static, trusted, in-repo design asset (never user input), so injecting the SVG
  inner-path string is the same pattern the design uses and carries no XSS risk.
- **Port whole foundational files, extract sections from large ones.**
  `components.css` (Icon/Button/Badge/StatusPill foundations) is small and
  foundational → port whole. `shell.css` (~13KB) and `screens.css` (~29KB) cover
  many deferred features/screens → port only the **sidebar** and **content-list**
  sections to avoid pulling in styling for markup that doesn't exist yet (dead
  CSS that could mislead). Unused-but-harmless base rules are acceptable; styling
  for unbuilt interactive features is not (extract precisely).
- **Pixel-fidelity is a UAT (human) check.** The handoff explicitly says don't
  render/screenshot — fidelity is verified by porting from the source faithfully
  (engineer) and by the product owner running `pnpm dev` (UAT). Automated tests
  cover **behavior** (icons present, status pills present, nav works), not pixels.

## Architecture

```
apps/saytu-admin/src/
├── ui/
│   ├── Icon.tsx            # ICONS map + Icon({name,size,stroke,className})
│   └── StatusPill.tsx      # Badge + StatusPill + STATUS_MAP
├── shell/Sidebar.tsx       # REWRITTEN: workspace header + icon nav + theme toggle
├── screens/ContentList.tsx # REWRITTEN: design table + status pills
└── styles/
    ├── tokens.css          # unchanged
    ├── components.css       # ported from design/admin/components.css (Icon/Button/Badge/StatusPill)
    └── shell.css            # REWRITTEN: design sidebar + main + content-list sections
```

`Icon`/`StatusPill` are presentational, prop-driven, independently testable. The
Sidebar keeps its existing behavior (theme toggle flips `data-theme` + persists;
NavLink active state) — only its markup/classes/icons change. ContentList keeps
its data flow (async `listDrafts` via `useData`, empty/loading states) — only its
presentation changes (table classes + a `StatusPill` for the status cell).

## Types & API

```ts
// Icon.tsx
export const ICONS: Record<string, string>  // name -> SVG inner markup
export type IconName = keyof typeof ICONS
export function Icon(props: {
  name: IconName
  size?: number
  stroke?: number
  className?: string
}): JSX.Element | null   // null for an unknown name

// StatusPill.tsx
export function StatusPill(props: { status: string }): JSX.Element
// maps known statuses (draft/published/staged/deployed/…) to a toned Badge;
// unknown statuses render with a neutral tone + the raw label.
```

## Error handling / edge cases

- `Icon` with an unknown `name` returns `null` (matches the design) — never throws.
- `StatusPill` with an unknown status renders a neutral pill showing the raw
  string (so arbitrary `metadata.status` values still display).
- Nav icons: every §24 nav item maps to a real `ICONS` entry (dashboard, post,
  pages, image, forms, globe, settings) — verified against the ported map.

## Testing (behavior; fidelity = UAT)

- **`Icon`**: renders an `<svg>` (with inner path markup) for a known name (e.g.
  `dashboard`); returns `null` for an unknown name.
- **`StatusPill`**: renders the status label; a known status (`published`) gets
  its toned class; an unknown status renders neutral with the raw text.
- **`Sidebar`** (extends the existing test): every nav item still resolves as a
  link with its label AND now contains an `<svg>` icon; the workspace name
  ("Saytu") renders; the theme toggle still flips `data-theme` + persists
  (existing assertions unchanged).
- **`ContentList`** (extends the existing tests): rows still render per draft with
  title; the status now appears via a `StatusPill` (the status text is still
  present, e.g. "published"); empty/filter/loading behavior unchanged.
- All existing 7 admin tests + the db/core suites stay green.

## Definition of done

- `pnpm --filter @setu/admin test` green (existing 7 + new Icon/StatusPill/sidebar/
  content-list behavior tests); `pnpm test` repo-wide unaffected.
- `pnpm --filter @setu/admin typecheck` clean (verbatimModuleSyntax → `import type`
  where needed; no `React.ReactNode`).
- `pnpm --filter @setu/admin build` succeeds; the brand fonts still load (#9 fix
  preserved).
- `pnpm dev` shows a sidebar with icons + workspace header and a content list with
  status pills that visually matches `design/admin/` (product-owner UAT).
- Committed via the subagent-driven flow.
