# Admin Shell Redesign — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `apps/admin` shell — sidebar, app layout, page container, page header, theme toggle
**Depends on:** shadcn foundation (merged, PR #25) + dashboard redesign (merged, PR #27). Branch `admin-shell` off `main`.

## 1. Goal

Migrate the admin **shell** (the chrome that frames every screen) onto shadcn, and establish the **one shared page container** that gives every screen consistent gutters/alignment — the "design language" backbone. After this, all content-screen PRs (lists, forms, editor, media) sit inside a coherent, consistent frame.

## 2. Scope (decided)

- **Sidebar** → shadcn `Sidebar`, **`collapsible="icon"`** (collapse-to-rail), **desktop-only** (mobile Sheet suppressed). Retire the custom `shell/Sidebar.tsx`.
- **App layout** → shadcn `SidebarProvider` + `<AppSidebar/>` + `<SidebarInset>`, replacing the bespoke `.app` grid / `.main`.
- **PageBody** → one shared container (standard gutter + max-width), adopted by all content screens; **editor opts out** (full-bleed). Removes the per-screen hardcoded `30px`.
- **PageHeader** → rebuilt on shadcn primitives/tokens, keeping 30px alignment with PageBody.
- **Theme toggle** → carry the existing, working light/dark toggle (`data-theme` + localStorage, restored in `index.html`), re-skinned in the sidebar footer.
- **Logo fix** → the sidebar logo `<rect fill="var(--accent)">` (`Sidebar.tsx:63`) renders neutral after the foundation token remap (the one inline `var(--accent)` the CSS-only redirect missed). Rebuilt logo uses **`--primary`** (brand).
- **Deploy becomes global** (sidebar footer) → **remove the Deploy button from the dashboard header** (`screens/Dashboard.tsx` `HeaderActions`) so it isn't duplicated. Dashboard header keeps New post / New page.

### Out of scope
- Content-screen **internals** (lists/forms/editor/media bodies) — they're only wrapped in `PageBody` + the new frame here; their internal migration is later PRs.
- Mobile/responsive (desktop-only by decision).
- Workspace switcher — the decorative chevron in today's sidebar header does nothing; **dropped** (YAGNI).

## 3. Components

| File | Responsibility |
|---|---|
| `shell/AppShell.tsx` | `SidebarProvider` wrapping `<AppSidebar/>` + `<SidebarInset>{children}</SidebarInset>`; mounted in `app.tsx` around `<Routes>` |
| `shell/AppSidebar.tsx` | shadcn `Sidebar` (`collapsible="icon"`): header (logo+name), grouped nav, footer (View site / Deploy / theme); replaces `Sidebar.tsx` |
| `shell/ThemeToggle.tsx` | light/dark toggle (reads/sets `data-theme`, persists `setu-theme`); footer button |
| `shell/PageBody.tsx` | shared content container: `max-w-[1400px]` + `px-[30px]` + vertical rhythm; `className` passthrough for per-screen tweaks |
| `shell/PageHeader.tsx` | rebuilt on tokens (title/subtitle/actions); 30px aligned |
| `components/ui/sidebar.tsx` | **edit the generated file**: force desktop-only (the `useIsMobile()` path renders a `Sheet`; pin `isMobile=false` / drop the mobile branch) |

**Removed:** `shell/Sidebar.tsx`, `shell/DeployButton.tsx` (deploy folds into the sidebar footer as a shadcn button), and the bespoke shell CSS in `styles/shell.css` for `.app`, `.main`, `.sidebar*`, `.nav*`, `.theme-toggle`, `.page-header` (the page-header rules move to the new `PageHeader`; `.page-body` rule removed in favor of `PageBody`).

## 4. Navigation (preserved structure)

shadcn `SidebarGroup` per section, `SidebarMenuButton` + `NavLink` active state, lucide icons:
- (no group): Dashboard (`layout-dashboard`)
- **Content**: Posts (`file-text`), Pages (`files`), Categories (`folder`)
- **Workspace**: Media (`image`), Forms (`clipboard-list`), Appearance (`palette`), Settings (`settings`)

Collapsed (rail): icon-only with shadcn tooltips. Footer items (View site `external-link`, Deploy `rocket`, theme `sun`/`moon`) also icon-only when collapsed.

## 5. Page container adoption

Every screen rendering `<div className="page-body">` switches to `<PageBody>`:
- `screens/Dashboard.tsx` — already has the gutter inline; replace its hand-rolled wrapper with `<PageBody>`.
- `screens/ContentList.tsx`, `screens/Media.tsx`, `screens/Appearance.tsx` — wrap content; remove their per-screen `30px` horizontal padding (e.g. `.categories-screen .category-new`, `.category-manage-list`, list toolbars).
- `screens/Categories.tsx` — **deferred** to the Categories content PR. It uses a bespoke full-height toolbar+list layout (not `.page-body`) and already aligns at 30px, so it's not visibly broken; reconciling it onto `PageBody` happens when Categories gets its content migration. (Scope trim to keep this PR focused/low-risk.)
- `editor/EditorScreen.tsx` — **does NOT** use `PageBody` (keeps its full-bleed centered canvas).

Gutter = `30px` (matches the header). Max-width `1400px`, left-aligned (so it tracks the title, not centered). Tokenizing the gutter value is a later refinement.

## 6. Theme toggle

The mechanism already works end-to-end (`index.html` restores `data-theme` from `localStorage('setu-theme')`; toggling sets the attribute + persists). `ThemeToggle.tsx` reproduces today's logic on a shadcn `Button` (light/dark only — no system mode, YAGNI), placed in the sidebar footer; icon-only in the rail.

## 7. Testing

- `AppSidebar`: renders all nav items with correct routes + active state; footer has View site / Deploy / theme; logo present.
- Desktop-only: the sidebar renders its desktop variant (no `Sheet`) regardless of viewport (assert no `role="dialog"` sheet at narrow width, or that the rail/trigger is present).
- `PageBody`: applies the gutter container; `className` passthrough merges.
- `ThemeToggle`: clicking flips `document.documentElement` `data-theme` and persists `setu-theme`.
- `PageHeader`: title/subtitle/actions render.
- Existing screen tests still pass after the `page-body` → `PageBody` swap (Dashboard, ContentList, Media, Appearance, Categories).
- Cumulative: typecheck + full suite + build green.

## 8. Verification (manual)

Run on `:5174`: collapse/expand the rail (persists across reload); nav active states; light/dark toggle (persists); logo is brand indigo (not washed out); every screen's content aligns with its header at the same gutter; editor remains full-bleed; the dashboard header no longer shows a duplicate Deploy.
