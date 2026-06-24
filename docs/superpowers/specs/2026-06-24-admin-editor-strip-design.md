# Editor chrome — PR A: header strip + Shortcuts dialog

Status: approved design, ready for plan
Date: 2026-06-24
First of the editor-chrome migration (A: strip+shortcuts → B: meta panel → C: canvas/breakout, done editor-visible). Sibling: a separate Command-palette PR slots after A. Part of [[setu-admin-shadcn-migration]].

## Goal

Re-skin the editor top strip (`ed-strip`) and the Shortcuts dialog onto shadcn primitives, and
**consolidate the scattered status display** into one canonical place — without touching the TipTap
canvas, its floating menus, or any publish/preview/autosave behavior.

## Scope boundary

- **In:** the `ed-strip` header bar (back, breadcrumb, save indicator, status, view-on-site, preview,
  shortcuts, publish menu) and `ShortcutsDialog`.
- **Out (later PRs):** meta panel (PR B), TipTap canvas + floating menus FormatBubble/TableMenu/
  SlashCommand/BlockMenu/drag-handle + the width/breakout fix (PR C), MediaPickerModal (Media PR),
  the command palette (its own PR).

## Current state (what exists)

`apps/admin/src/editor/EditorScreen.tsx` renders the strip with bespoke CSS classes and a custom
`Icon` set:
- `.ed-strip` → `.ed-strip-left` (back `<Link className="strip-btn btn-icononly">` + `.ed-breadcrumb`
  span), `.ed-strip-center` (`<SaveIndicator status readonly>`), `.ed-strip-right` (status via
  `<StatusPill status={label}/>` + `· {pending}` suffix, view-on-site link OR disabled button,
  preview button, shortcuts button, `<PublishMenu>`).
- Tooltips via the editor's Tippy wrapper `apps/admin/src/editor/Tooltip.tsx`.
- `apps/admin/src/ui/StatusPill.tsx` — custom badge classes.
- `apps/admin/src/editor/PublishMenu.tsx` — primary Publish `<button className="btn btn-primary">` +
  a `▾` toggle opening a bespoke dropdown of unpublish/re-publish items.
- `apps/admin/src/editor/ShortcutsDialog.tsx` — raw `.sc-*` modal (backdrop + dialog + grouped rows).
- `SaveIndicator` (center) shows save state; the breadcrumb shows context; lifecycle status shows in
  BOTH the right `StatusPill` and (PR B's) meta-panel segmented control — the redundancy we fix.
- Styles live in `apps/admin/src/styles/editor.css` (`.ed-strip*`, `.strip-btn`, `.ed-breadcrumb`,
  `.autosave*`, `.publish-menu*`, `.sc-*`).
- Handlers/seams to preserve verbatim: `onPublish`/`onUnpublish`/`onRepublish`, `onPreview`,
  `useAutosave` status, `lifecycleLabel(lifecycle)`, `can('content.publish'|'content.unpublish')`,
  `siteUrl(ref)`, `setShortcutsOpen`.

## Architecture

### Status consolidation (the cleanup)

Lifecycle status is *derived* (Draft until published; Staged/Live via publish+deploy). After this PR
it has ONE home in the strip, and save state is the only thing in the center:

- **Center (`ed-strip-center`) = save state only.** `SaveIndicator` re-skinned to a quiet inline
  indicator: `Saved` (check, muted), `Saving…` (pulsing dot), `Unsaved`, and the read-only/locked
  case. No lifecycle words here (today it can read "Draft" — remove that).
- **Right = one lifecycle `Badge`.** Replace `StatusPill` usage in the strip with shadcn `Badge`
  mapping lifecycle → the admin's shared status variants (the SAME mapping the lists/dashboard use via
  `src/lib/status-badge`): `draft` → secondary/muted, `staged` → warning, `live` → success. Keep the
  `· {pending}` suffix. This Badge is the canonical status.
- **Hand-off to PR B (noted, not done here):** the meta-panel "segmented control" for Status must
  become a read-only echo or be dropped — status is not directly settable, and the strip Badge now
  carries it. (Captured so B closes the loop; out of scope for A.)

### Component swaps (shadcn)

1. **Strip icon buttons** (back, view-on-site, preview, shortcuts) → shadcn `Button`
   `variant="ghost" size="icon"`, icons from **lucide** (`ChevronLeft`, `ExternalLink`, `Eye`,
   `Keyboard`) to match the rest of the admin; the back button stays an `asChild` wrapper around the
   `<Link>`. Each wrapped in shadcn **`Tooltip`** (the strip retires the Tippy wrapper; the canvas
   menus keep Tippy until PR C — a temporary two-system overlap, documented). The disabled
   view-on-site case keeps its tooltip via a wrapper (shadcn Tooltip on a disabled trigger needs a
   `span` wrapper, same reason as today).
2. **`PublishMenu`** → a **split button**: a primary shadcn `Button` ("Publish") + a `DropdownMenu`
   whose trigger is a small `Button size="icon"` with a `ChevronDown`, holding the unpublish /
   re-publish items (`DropdownMenuItem`). Same `canPublish`/`canUnpublish`/`isUnpublished` gating and
   the same three callbacks. When only the menu (no primary Publish) applies, render just the menu;
   when neither applies, render nothing — preserve today's conditional logic.
3. **Breadcrumb** → muted text, same content (`New {collection}` / `{collection} / {slug}`), lighter
   styling.
4. **`ShortcutsDialog`** → shadcn `Dialog` (`DialogContent`/`DialogHeader`/`DialogTitle`), the same
   grouped shortcut rows restyled (key chips as small `kbd`-like spans), opened/closed via the
   existing `shortcutsOpen` state.

### Layout

Keep the 3-region strip (`left` / `center` / `right`), ~52px tall, loose spacing per the approved
mockup. The strip stays a plain flex bar (editor still opts out of `PageBody`). Rebuild its layout
with Tailwind utilities; delete the bespoke `.ed-strip*` / `.strip-btn` / `.publish-menu*` / `.sc-*`
CSS once nothing references them.

## Data flow / behavior (unchanged)

All seams are preserved exactly: autosave status drives the save indicator; `lifecycleLabel` drives
the status badge; publish/unpublish/re-publish/preview callbacks and their permission gating are
passed through to the re-skinned controls untouched; shortcuts open/close state unchanged.

## Error handling

No new flows. Publish/preview errors continue to surface via `useNotify` exactly as today.

## Testing

- Existing editor tests must stay green: `editor-screen`, `editor-publish`, `editor-unpublish`,
  `editor-preview` (they assert publish/unpublish/preview behavior + save status — the re-skin must
  not change roles/labels they query; update only selectors that change, never weaken assertions).
- New/updated component coverage:
  - Save indicator renders `Saved`/`Saving…`/`Unsaved` for the autosave states + the read-only case.
  - Strip status Badge shows the right variant+label per lifecycle state (draft/staged/live) with the
    `· pending` suffix.
  - Publish split-button: primary Publish calls `onPublish`; the menu exposes unpublish/re-publish per
    gating and calls the right callbacks; nothing renders when neither applies.
  - Shortcuts `Dialog` opens from the strip button and lists groups.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green (typecheck included — vitest alone
  does not typecheck).

## Out of scope (explicit)

- Meta panel, canvas, floating menus, breakout, media picker, command palette (each its own cycle).
- No change to the `Icon` set elsewhere; only the strip's icons move to lucide.

## Decomposition (for the plan)

1. `SaveIndicator` re-skin → quiet save-state-only indicator (TDD).
2. Strip status `Badge` (reuse `src/lib/status-badge` mapping) replacing `StatusPill` in the strip (TDD).
3. `PublishMenu` → shadcn split button (Button + DropdownMenu), gating + callbacks preserved (TDD).
4. Strip icon buttons → shadcn `Button`/`Tooltip` + lucide icons; rebuild `ed-strip` layout in
   `EditorScreen` (TDD/component).
5. `ShortcutsDialog` → shadcn `Dialog` (TDD).
6. Cleanup: delete dead `.ed-strip*`/`.strip-btn`/`.publish-menu*`/`.sc-*` CSS + unused `StatusPill`
   if no longer referenced; full gate.

Built subagent-driven per [[setu-execution-default]]; quick editor-visible spot-check at the end.
