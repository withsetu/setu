# Notifications Migration + Top-Right — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Route the admin's remaining ad-hoc inline action-feedback through the shared `useNotify` system, and move the notification region to the top-right. Consistency/polish pass over the notification system shipped in PR #13.

## Problem & intent

`useNotify()` (success/error/info, auto-dismiss, ARIA live) exists and is wired into bulk actions, but several surfaces still surface transient action results as one-off inline `role=status/alert` messages — inconsistent. This pass routes the *transient* ones through `useNotify` so feedback is uniform, and relocates the region to the more conventional top-right. Genuinely inline cases (field validation, persistent state) deliberately stay inline.

## Decisions (locked in brainstorm)

- **Position:** notification region moves bottom-right → **top-right**. Single fixed position; **not** user-configurable (consistency > flexibility; YAGNI — it's a one-constant change if ever needed).
- **Migrate to toasts (transient action results):** Media upload, Categories re-parent, EditorScreen publish, Canvas image-insert.
- **Keep inline (deliberately):** CategoryField create error (field-level validation, shown at the create form), Bootstrap IndexedDB-fallback (a `console.error` that fires before `NotificationProvider` is mounted), and EditorScreen's autosave status + lock banner (persistent state indicators, not transient events).
- **Meaning preserved:** each migrated message keeps its wording/intent; only the delivery channel changes.

## Non-goals

- User-configurable notification position.
- Any change to the `useNotify` API or the notification component itself (beyond the CSS position).
- Changing the kept-inline cases.

## Changes

### 1. Position (CSS)
`.notify-region` in `apps/admin/src/styles/components.css` — change the fixed anchoring from bottom to top (top-right), keeping the column layout, gap, z-index, and `pointer-events` handling. Notification slide-in direction adjusted to read naturally from the top if needed.

### 2. Media (`apps/admin/src/screens/Media.tsx`)
- Replace the inline `error` state + `<p role="alert" className="media-error error">` with `useNotify`: the `MediaPicker`/upload `onError` → `notify.error(message)`.
- Add a success toast: `onUploaded(result)` → `notify.success("Uploaded " + <key or filename>)` (currently there is no success cue).
- Remove the now-unused `error` state and the clear-on-select/clear-on-deselect resets tied to it.

### 3. Categories screen (`apps/admin/src/screens/Categories.tsx`)
- Replace the inline `error` state + `<p role="alert">` with `notify.error(message)` in the re-parent catch.

### 4. EditorScreen (`apps/admin/src/editor/EditorScreen.tsx`)
- Replace the `publishMsg` state + its render: on `r.status === 'published'` → `notify.success('Published · ' + r.sha.slice(0, 7))`; on `r.status === 'conflict'` → `notify.error('The published version moved — reload to continue.')`.
- Remove the `publishMsg` state.
- **Untouched:** the autosave `SaveStatus` indicator and the `ed-banner` "locked by another editor" banner (persistent state).

### 5. Canvas (`apps/admin/src/editor/Canvas.tsx`)
- Replace the inline `imgError` banner (`<div className="editor-banner error" role="alert">`) with `notify.error(imgError)`; route the image-error path to `useNotify` and remove the `imgError` state + banner render.

### 6. Kept inline (no change)
- `CategoryField` create error stays inline at the create form.
- `Bootstrap` IndexedDB-fallback stays a `console.error` (pre-mount; no provider yet).

## Error handling / edges

- All four migrated surfaces are within `NotificationProvider` (mounted in `main.tsx` wrapping the app), so `useNotify()` resolves. (Bootstrap's case is the one outside it — hence kept as console.error.)
- Dead CSS: `.media-error`, `.editor-banner.error` (Canvas image error), and any rule now unreferenced after removing the inline elements should be pruned — but only after grep confirms zero `.tsx` references (the `.editor-banner` base class may still be used by the lock banner / other banners — keep it; only remove the genuinely orphaned error-variant rules).

## Testing

- Each migrated component's test wraps the render with `NotificationProvider` and asserts the notification appears (e.g. `await screen.findByText(/Published/)`), replacing the old inline-message assertion — without weakening what's asserted.
- Media: an upload error surfaces `notify.error`; a successful upload surfaces `notify.success`.
- Categories: a cycle-inducing re-parent surfaces `notify.error`.
- EditorScreen: publish success / conflict surface the right notification; autosave + lock-banner tests unchanged and still pass.
- Canvas: an image-insert error surfaces `notify.error`.
- The kept-inline CategoryField error test stays as-is (still inline).

## Sequencing

1. **This slice:** position → top-right; migrate Media / Categories / EditorScreen / Canvas to `useNotify`; keep CategoryField + Bootstrap inline.
2. **Later (unchanged plans):** broader admin visual redesign; the content-topology / Cut B roadmap items.
