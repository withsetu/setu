# Admin shadcn/ui Design System — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `apps/admin` (`@setu/admin`)

## 1. Goal & scope

Re-platform the entire admin onto **shadcn/ui** with a **pure, standard shadcn token vocabulary** so new admin themes are drop-in (tweakcn / theme registries / official theme switcher all operate on exactly this token set). Standardize the component layer on shadcn primitives, add a **restrained motion** layer, and upgrade to **React 19**.

Two kinds of code, treated differently:

- **Replaced by shadcn primitives:** app shell, sidebar, dashboard, content lists, forms, pickers, dialogs, menus, popovers, tooltips, tables, toasts, badges, settings, and all editor *chrome* (bubble/format/turn-into/table menus, publish menu, meta panel, link input, shortcut dialog).
- **Kept custom, re-skinned to tokens:** the **TipTap editor canvas** itself (contentEditable rendering, slash command, drag-to-reorder). shadcn has no equivalent; only its surrounding chrome moves. Logic is untouched; styling moves onto the token system.

Migration is **incremental (strangler-fig)**; `main` stays shippable at every step.

### Non-goals / out of scope
- Marketing/landing site (where flashy animation libraries would belong).
- The logging/audit system (separately deferred).
- Buying any paid block kit (optional accelerator only; start free).
- Re-architecting the TipTap canvas internals.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Migration scope | **Full** re-platform (not incremental-new-only) |
| Editor canvas | Stays custom, re-skinned; chrome → shadcn |
| Token vocabulary | **Pure shadcn standard** — no parallel custom vocabulary |
| Token values | **Seed the standard tokens with Setu's tuned palette** (still 100% themeable) |
| Semantic states | **Add a `success`/`warning`/`info` trio** in shadcn's naming convention (the one intentional deviation) |
| shadcn config | `style: new-york`, `baseColor: neutral`, `iconLibrary: lucide`, adopt shadcn `sidebar` |
| React | Upgrade **18 → 19** (dependency tree verified compatible) |
| Animation/UX libs | shadcn-native blocks + restrained `motion` stack; **skip** landing-page eye-candy (Aceternity / React Bits / Skiper / Tailark / UI Layouts / Cult UI / Kine UI; Magic UI only cherry-picked if ever needed) |
| Migration strategy | **Strangler-fig**, surface-by-surface, app shippable throughout |

## 3. Token system (pure shadcn standard)

Rewrite `apps/admin/src/styles/tokens.css` to **only** shadcn's standard token set, expressed in **oklch**, defined in `:root` and `[data-theme="dark"]`:

```
background, foreground,
card, card-foreground, popover, popover-foreground,
primary, primary-foreground, secondary, secondary-foreground,
muted, muted-foreground, accent, accent-foreground,
destructive (+ destructive-foreground),
border, input, ring,
chart-1..5,
sidebar, sidebar-foreground, sidebar-primary, sidebar-primary-foreground,
  sidebar-accent, sidebar-accent-foreground, sidebar-border, sidebar-ring,
radius
```

Plus the **one intentional extension** — semantic state tokens, following shadcn's exact `*/*-foreground` convention:

```
success, success-foreground,
warning, warning-foreground,
info, info-foreground
```

These power CMS states (published = success/green, draft = warning/amber, scheduled = info/blue). They are documented as Setu's only addition to the stock set; a third-party theme that defines only the stock set still renders the rest of the UI correctly, and the state colors fall back to sensible defaults.

**Values:** seed the standard names with Setu's existing tuned palette (cool-neutral grays, indigo brand) so the current look is the *default theme* — not stock shadcn neutral. This is still pure shadcn (it's just "a theme"); any generated theme overrides the identical names.

**Key mappings (values preserved from current `tokens.css`):**

| Current | shadcn standard |
|---|---|
| `--bg` | `--background` |
| `--surface` | `--card`, `--popover` |
| `--surface-2` | `--secondary` / `--muted` |
| `--surface-hover` / `--surface-active` | `--accent` (shadcn's hover/selected token) |
| `--text` | `--foreground` |
| `--text-2` / `--text-3` | `--muted-foreground` |
| **`--accent` (brand indigo)** | **`--primary`** (NOT `--accent`) |
| `--border` | `--border`, `--input` |
| `--accent-ring` | `--ring` |
| `--red` | `--destructive` |
| `--green` / `--amber` / `--blue` | `--success` / `--warning` / `--info` (+ used for `--chart-*`) |
| `--radius-base` | `--radius` |

**Trap to avoid:** in shadcn, `--accent` is the *subtle hover/selected background*, not the brand color. Setu's brand indigo maps to `--primary`; the neutral hover surface maps to `--accent`.

**Mechanics:**
- `@custom-variant dark (&:is([data-theme="dark"] *))` — keep the existing `data-theme` dark mechanism (do **not** switch to shadcn's `.dark` class).
- `@theme inline { --color-*: var(--*) }` so Tailwind utilities (`bg-card`, `text-muted-foreground`, `border-input`, …) resolve.
- `--radius` drives shadcn's `--radius-sm/md/lg/xl` calc chain.

**Care-point (Appearance screen):** the Appearance screen customizes the **site** theme (`theme-options.json` → `@setu/theme-default`); its live preview renders in the **site's** token namespace (`--accent`, `--font-body`, `--radius-base`, `--measure-page`) applied **inline to the `.cz-preview-card` subtree only**. That is independent of the admin-chrome tokens. The migration re-skins only the *controls* around the preview; the preview subtree keeps site-theme tokens. Verify no shadcn component renders inside that subtree (so the inline site `--accent` can't mis-style a shadcn primitive). Note: the admin chrome is not runtime-themeable today — standardizing on shadcn tokens is precisely what enables drop-in admin themes later.

## 4. Foundation install (PRs 0a + 0b — no visual change)

**PR 0a — React 19 upgrade alone** (de-risked, isolated):
- React `18.3 → ^19`; `@types/react(-dom) → ^19`. Verify `@setu/*` workspace packages that import React (`@setu/blocks`, theme packages) build under 19. Typecheck + full test suite green before merging. No shadcn, no token changes.

**PR 0b — shadcn + tokens:**
- shadcn for Vite + Tailwind v4: `components.json` (`style: new-york`, `rsc: false`, `tsx: true`, `tailwind.css: src/index.css`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`).
- `@/` path alias in `vite.config.ts` + `tsconfig`.
- `cn` helper at `src/lib/utils.ts` (`clsx` + `tailwind-merge`).
- Deps: `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `motion`, `tw-animate-css` (replaces `tailwindcss-animate` under TW v4), plus shadcn-pulled `sonner`, `cmdk`, `vaul`.
- Add core primitives to `src/components/ui/`: button, card, input, textarea, label, select, dropdown-menu, dialog, popover, tooltip, tabs, table, badge, checkbox, switch, separator, scroll-area, skeleton, sonner (Toaster), command, drawer, breadcrumb, avatar, sidebar.
- **Temporary aliases** during migration: keep `--bg: var(--background)`, `--surface: var(--card)`, `--text: var(--foreground)`, etc., so untouched bespoke CSS renders identically until each file is migrated. Removed in the cleanup PR.

## 5. Component mapping (bespoke → shadcn)

| Current | shadcn |
|---|---|
| `ui/Combobox`, `ui/CategoryPicker`, `ui/TagAutocomplete` | Command + Popover (combobox pattern) |
| `ui/StatusPill` | Badge (variants incl. success/warning/info) |
| `ui/notify` | Sonner `toast()` |
| `editor/Tooltip`, `editor/bubble-popup` | Tooltip / Popover |
| `ui/Icon` | `lucide-react` |
| `shell/Sidebar`, `shell/PageHeader` | shadcn `sidebar` + nav, header composition |
| `editor/PublishMenu`, `TurnIntoMenu`, `TableMenu` | DropdownMenu |
| `editor/ShortcutsDialog`, modals | Dialog |
| `editor/MetaPanel` fields | Input / Select / Label |
| `editor/LinkInput`, `LinkPopup` | Popover + Input |
| `media/*` modals, buttons | Dialog / Button / Card |

Editor **canvas** (`Canvas.tsx`, slash command, drag handle, ImageBlock) keeps its logic; only re-skinned to tokens.

## 6. Motion & polish (restraint = the goal)

The polish that drives CMS adoption is **perceived speed and restraint** (Linear/Notion), not animation volume.

- `motion` (`motion/react`) used sparingly: route/state transitions, list-item enter, optimistic UI.
- `tw-animate-css` for enter/exit + accordion utilities (CSS-only).
- **Skeleton** loaders replace spinners; **Sonner** toasts; **cmdk** ⌘K command palette; strong empty states; crisp hover/press feedback.
- Honor the existing `prefers-reduced-motion` block.
- **Explicitly excluded:** Three.js / aurora / marquee / 3D-tilt / WebGL backgrounds — reserved for a future marketing site, never the daily-driver admin.

## 7. Migration sequence (one PR each, app shippable throughout)

| PR | Surface |
|---|---|
| 0a | **React 19 upgrade alone** — bump `react`/`react-dom`/`@types`, verify `@setu/*` workspace packages, typecheck + tests green. No visual change. Isolates any peer-dep surprise. |
| 0b | shadcn install + token remap (pure standard + state trio) + temporary aliases + core primitives. No visual change. |
| 1 | Shell: sidebar, page header, deploy button |
| 2 | Dashboard: rebuild on `dashboard-01` scaffold + widgets on Card primitives + Skeleton loaders |
| 3 | Content lists: Table, filter toolbar, search/sort, BulkBar |
| 4 | Forms & pickers: Combobox/Category/Tag/MetaPanel on Command + Input + Select |
| 5 | Editor chrome (menus, publish, dialogs, link input) + canvas re-skin |
| 6 | Media: grid, browser, dropzone, picker modal |
| 7 | Cleanup: drop temporary aliases + dead CSS (`components.css`, `shell.css`, `customize.css` chrome, `dashboard.css`); trim `editor.css` to canvas-only |

Each PR: `pnpm typecheck` + `pnpm -r test` green; manual run-check of that surface; dark mode verified.

## 8. Governance ("fix it from now")

Add a short convention doc (`docs/admin-ui-conventions.md` or a project skill): new admin UI **must** use `src/components/ui` primitives + standard tokens + lucide icons + `motion` per the restraint rules; **no new bespoke CSS classes or ad-hoc token names**. This is the guardrail that prevents drift from recurring.

## 9. Verification & risks

- **Highest risk:** token remap must not break **dark mode** or the **Appearance preview** (site-theme subtree). Explicit check each.
- `@setu/*` workspace React-19 compatibility — verify in PR 0.
- `new-york`'s default look differs slightly from current — tuned away via the palette-seeded tokens.
- Paid kits remain optional; start free with official shadcn blocks.

## 10. Tooling

- shadcn MCP server added to `.mcp.json` (`npx shadcn@latest mcp`); becomes available after a Claude Code reload. Used during implementation to add/inspect components and registries.
