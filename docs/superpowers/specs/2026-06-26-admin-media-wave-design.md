# Media wave — re-skin media surface + image-block picker to shadcn

Status: approved approach, ready for plan
Date: 2026-06-26
Part of the [[setu-admin-shadcn-migration]] surface-by-surface re-platform. The media surface
predates the migration and was never touched; this is the **media wave**. Scope **A**
(consistency + the picker) — token + primitive migration only, **no new capabilities**.

## Goal

Bring the media surface (`/media` screen + the editor's image picker) up to the same pure-shadcn
standard as the rest of the admin: Tailwind utilities + `@/components/ui/*` primitives on shadcn
tokens, dropping bespoke `--surface`/`--text-N`/`--accent-ring`/`--shadow-pop` CSS and hand-rolled
overlays. The only behavior change is replacing the native `window.confirm` delete with a shadcn
`AlertDialog`. No new image-block options (the "B" scope — click-to-select, Link/Remove/Width,
lightbox — was explicitly cut).

## Why now

The admin re-platform is otherwise complete (dashboard, shell, lists, forms, taxonomies, editor
chrome all migrated). The media surface is the last bespoke-token island, and the editor's image
flow leans on its hand-rolled picker. Finishing it closes the migration's main body and removes the
last native `window.confirm` in the admin.

## Current state (what exists)

- `media/MediaBrowser.tsx` — shared browser (dropzone + search/sort/type toolbar + grid). Used by
  both `/media` (manage mode) and the editor picker (pick mode) so they never drift. Raw
  `<input type=search>` + two raw `<select>`s.
- `media/MediaGrid.tsx` — tile grid, `Load more` paging, hand-rolled skeleton tiles.
- `media/MediaDropzone.tsx` — drag-drop upload band.
- `screens/Media.tsx` — the `/media` screen: `PageHeader` + `MediaBrowser` + a hand-rolled
  **detail panel** (`position: fixed` `<aside>`), delete via `window.confirm` (with a
  `referencedBy` where-used warning), Copy URL.
- `editor/MediaPickerModal.tsx` — a hand-rolled overlay/scrim dialog (manual Escape +
  `stopPropagation`), wraps `MediaBrowser` in pick mode.
- `editor/extensions/ImageBlock.tsx` — the `{% image %}` node; inline toolbar (align/alt/caption/
  Replace). Replace routes through `storage.openPicker` → `MediaPickerModal`. Toolbar tokens were
  already swept in editor-chrome C2 (PR #44).
- CSS: `apps/admin/src/styles/components.css` lines ~196–487 — the entire `.media-*` block, on
  bespoke tokens. To be deleted as the markup moves to Tailwind.

Installed primitives confirmed present: `dialog`, `sheet`, `alert-dialog`, `select`, `input`,
`button`, `skeleton`, `scroll-area`, `separator`, `card`. Reference idiom: `screens/content-list/
ListToolbar.tsx` (Input + Search icon + Select with the `__all__` sentinel, Tailwind utilities).

## Changes, surface by surface

1. **Toolbar** (`MediaBrowser`) — match `ListToolbar`: raw `<input>` → `Input` with a `Search`
   lucide icon; the sort + type `<select>`s → `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`
   with the `__all__` sentinel where an "all" option exists. Same flex/gap toolbar layout. Keep the
   200ms debounced-search behavior and the controlled filter props.

2. **Grid + tiles + dropzone** (`MediaGrid`, `MediaDropzone`) — convert bespoke `.media-*` CSS to
   Tailwind utilities on shadcn tokens:
   - Tile surface `--card`, border `--border`, radius `--radius`; hover/selected ring `--ring` +
     `--accent` surface (matching list-row selection across the admin).
   - Loading state → shadcn `Skeleton` tiles (drop the hand-rolled `@keyframes pulse`).
   - Dropzone: dashed `--border`, active/hover state on `--primary` + soft-`--accent`.
   - Grid stays `repeat(auto-fill, minmax(148px, 1fr))` via a Tailwind arbitrary-value class.

3. **Picker** (`MediaPickerModal`) — rebuild on shadcn `Dialog`: `DialogContent`
   (~`max-w-[880px]`), `DialogHeader`/`DialogTitle` ("Add an image"), body = `MediaBrowser` in pick
   mode. Drop the hand-rolled overlay/scrim/Escape/`stopPropagation` — the primitive provides
   focus-trap, Escape, overlay. Keep the `open`/`onClose`/`onPick` contract so `Canvas`/`ImageBlock`
   wiring is unchanged.

4. **Detail panel** (`Media.tsx`) — replace the `position: fixed` `<aside>` with shadcn `Sheet`
   (right side). Same content: thumbnail/dimensions/size/content-type, Copy URL, Delete — on
   `Button`s. `Sheet` open state driven by `selected !== null`; closing clears `selected`.

5. **Delete confirm** — replace `window.confirm` with shadcn `AlertDialog`. The existing
   `index.referencedBy(mediaKey)` where-used result becomes the `AlertDialogDescription`
   ("Used in N post(s): …. Delete anyway?" vs plain "Delete <file>?"). Delete stays on the
   destructive `Button` (`variant="destructive"`). This removes the last native dialog in the admin.

6. **Image block** (`ImageBlock.tsx`) — inherits the new `Dialog` picker automatically via
   `openPicker`. Light consistency pass only: ensure the inline align/alt/caption/Replace toolbar
   reads as one family with the editor chrome and the new picker. No click-to-select, no new
   options (cut B scope).

7. **Cleanup** — delete the dead `.media-*` block from `components.css` once markup is on Tailwind.
   Verify no bespoke `--surface*`/`--text-N`/`--accent-ring`/`--shadow-pop` remain in the media
   markup (chips away at the migration cleanup tail).

## Architecture / boundaries

- `MediaBrowser` stays the single shared browse component (manage + pick) — both the `/media` Sheet
  screen and the `Dialog` picker render it, so they never drift. Unchanged contract.
- Primitive swaps are leaf-level: toolbar controls, grid tiles, dialog/sheet/alert shells. Data
  flow (`useMediaIndex`, paging, upload/delete clients, `referencedBy`) is untouched.
- Tailwind-first like the rest of the migrated admin; bespoke CSS is removed, not re-tokenized.

## Testing & verification

- Existing media tests assert markup/behavior, not computed CSS — they stay green. Update selectors
  only where a tag changes (picker overlay → `Dialog` role, detail aside → `Sheet`). Keep the
  upload/select/delete and where-used coverage.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green.
- **Visual UAT is the done bar** (owner): on `:5173` exercise `/media` — browse, search/sort/type,
  upload (drag + click), select → detail Sheet, Copy URL, Delete (with and without a where-used
  warning) — and the editor image flow — insert via slash/picker, Replace via the Dialog picker —
  light + dark. Everything reads as one shadcn family.

## Decomposition (for the plan)

1. **T1** Toolbar → `Input` + `Select`; grid/tiles/dropzone → Tailwind + shadcn tokens + `Skeleton`.
2. **T2** Picker → shadcn `Dialog`.
3. **T3** Detail panel → `Sheet`; delete → `AlertDialog` (with where-used); `Button`s.
4. **T4** Image-block consistency pass + editor-visible check.
5. **T5** Remove dead `.media-*` CSS; full gate + light/dark UAT.

## Out of scope

Click-to-select image options and Link/Remove/Width/lightbox (B scope); media bulk-delete (6B);
S3 storage, video/audio, embeds. These remain on the roadmap.
