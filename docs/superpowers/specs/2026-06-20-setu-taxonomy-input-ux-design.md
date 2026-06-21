# Taxonomy Input UX + Notifications — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Make the tag and category inputs across the admin consistent, searchable, keyboard-driven, and clearly-confirmed — by extracting one shared combobox primitive used everywhere, and adding a small in-house notification system. Interaction-polish pass (see `setu-interaction-polish`), not a feature/behavior change.

## Problem & intent

User feedback (2026-06-20): "these functionalities are fine, but there is no focus on UX." Concretely, on the **bulk** tag input: Enter did nothing (had to click Add), no way to search existing tags, and no clear cue the action succeeded. Root cause: the tag-autocomplete logic is **duplicated three ways and diverges** —
- editor `TagField`: search + Enter + chips, but no keyboard nav of suggestions;
- listing `TagFilter`: search, but click-only (no Enter/keyboard);
- `BulkBar` tag: a **plain text box** — no search, no Enter.

And category controls are inconsistent (editor = checkbox tree; bulk = plain `<select>`). Feedback is scattered across **seven** ad-hoc inline `role=status/alert` spots.

Goal: one polished, consistent interaction model for picking tags/categories, with clear confirmation — and a reusable notification system so "it worked" is never a whisper.

## Decisions (locked in brainstorm)

- **Scope (B):** tags **and** categories.
- **Feedback = an in-house notification system**, not a toast library. The admin has zero UI-component deps (it owns its primitives: `Icon`, `StatusPill`, `Tooltip`); a lib would be the first and we'd fight its styling. In-house is small, zero-dep, Cloudflare-safe, fully styleable, and becomes a reusable `useNotify()` for bulk/publish/deploy/errors.
- **Bulk tag Enter = Add** (the common case); **Remove stays an explicit button**.
- **Editor category** keeps its checkbox tree (right for multi + hierarchy) + inline-create; gains a **filter box** to narrow it. **Bulk category** becomes a searchable picker.

## Non-goals (deferred)

- Migrating the other ad-hoc inline feedback spots (Media, Categories screen, EditorScreen, Bootstrap, Canvas, CategoryField error) to `useNotify` — easy follow-up; this pass wires bulk + the new flows only.
- A rich notification queue (stacking groups, swipe, promise-toasts) — success/error/info + auto-dismiss is enough.
- The broader admin visual redesign (the "dated" pass) — still its own thing.

## Architecture

### 1. Shared combobox primitive

A small `Combobox` (`apps/admin/src/ui/Combobox.tsx`) carrying the keyboard model so every picker behaves identically:
- Controlled text `value` + `onChange`.
- A list of `items` (strings) with optional per-item render; suggestions shown when non-empty.
- **Keyboard:** ↑/↓ move the highlight, **Enter** commits the highlighted item (or the typed text when nothing is highlighted/no matches), **Esc** closes the list. Click commits an item.
- `onSubmit(text)` — fired on Enter/click with the committed value.
- ARIA: `role="combobox"` input with `aria-expanded`/`aria-controls`/`aria-activedescendant`; list `role="listbox"`; items `role="option"` with `aria-selected` on the highlight.
- Reuses existing `tag-suggestions`/`tag-suggestion` styles (renamed/generalized to `combo-*`).

### 2. Tag inputs — one `TagAutocomplete` over the primitive

`TagAutocomplete` (`apps/admin/src/ui/TagAutocomplete.tsx`) wraps `Combobox`: debounced `useIndex().distinctTags(query, 8)` for items, minus an `exclude` list, normalizing the committed value via `normalizeTag`. Props: `value`, `onChange`, `onSubmit(tag)`, `exclude?`, `placeholder`, `ariaLabel`, `disabled?`. Applied to:
- **Editor `TagField`** (multi): `onSubmit` → append chip (deduped) + clear; `exclude` = selected. Chips render above.
- **`BulkBar` tag**: `onSubmit` → **Add** (the primary); a separate **Remove** button applies remove to the current value. (Search now works here — the original gap.)
- **Listing `TagFilter`** (single): `onSubmit` → set the filter + clear; the active value renders as a clearable chip (unchanged).

### 3. Category inputs

- **Editor `CategoryField`**: add a **filter input** above the checkbox tree that narrows the visible rows by name match (case-insensitive); checkboxes + inline-create unchanged (inline-create already Enter-friendly).
- **`BulkBar` category**: replace the `<select>` with a `CategoryPicker` (`apps/admin/src/ui/CategoryPicker.tsx`) — `Combobox` over the flattened taxonomy (indented labels, slug values), `onSubmit(slug)` → picks; **Add/Remove** buttons act on the picked category (Enter = Add).

### 4. Notification system

- `apps/admin/src/ui/notify.tsx`: a `NotificationProvider` (mounted near the app root) holding a small array of `{ id, kind: 'success'|'error'|'info', message }`, a fixed-position portal region rendering them (with an `aria-live="polite"` region; errors `assertive`), each auto-dismissing (~4s) with a manual ×.
- `useNotify()` → `{ success(msg), error(msg), info(msg) }`.
- **Wire bulk actions**: `BulkBar.run` calls `notify.success("Added react to 12 posts")` / `notify.success("Deleted 3 posts")` (and `notify.error(...)` on failure), replacing the inline `msg`. (Heads-up count stays inline in the bar — it's pre-action context, not a result.)

### 5. Editor add cue

The new tag chip in `TagField` **animates in** (a brief fade/scale via CSS) so the add registers visually. (Categories in the editor already show via the checkbox toggling.)

## Data flow

- Tag pick: type → `Combobox` shows `distinctTags` matches → ↑/↓/Enter or click → `onSubmit(normalizeTag(value))` → consumer acts (chip / bulk Add / filter) → bulk also fires `useNotify().success`.
- Category bulk: type → `CategoryPicker` filters the taxonomy → pick → Add/Remove → `useNotify`.

## Error handling / edges

- Empty/whitespace commit → no-op (no chip, no action).
- Already-selected tag (editor) / duplicate → no-op (deduped).
- `distinctTags` failure → empty suggestions (no crash); typing still allows create.
- Esc closes the list without committing; blur closes the list.
- Notifications: bounded list (drop oldest beyond, say, 4 visible); auto-dismiss timers cleared on unmount.

## Testing

- **`Combobox`**: ↑/↓ highlight, Enter commits highlighted, Enter commits typed when none highlighted, Esc closes, click commits, ARIA attributes present.
- **`TagAutocomplete`**: suggestions from `distinctTags` minus `exclude`; `onSubmit` normalizes; empty → no-op.
- **Consumers**: editor `TagField` adds a chip on Enter + on suggestion click; `TagFilter` sets the filter; `BulkBar` tag Enter = Add (committed-content assertion), Remove button removes; `CategoryPicker`/bulk category picks + Add/Remove.
- **Editor `CategoryField`** filter narrows the visible tree.
- **`notify`**: `useNotify().success` renders a dismissible message in the region; auto-dismiss; a bulk action surfaces a success notification.

## Sequencing

1. **This slice:** `Combobox` primitive + `TagAutocomplete` (editor/bulk/filter) + category filter (editor) + `CategoryPicker` (bulk) + `useNotify` wired to bulk + chip animation.
2. **Follow-up:** migrate the remaining ad-hoc inline feedback (Media, Categories screen, EditorScreen publish/conflict, Bootstrap, Canvas) to `useNotify`.
3. **Separate:** the broader admin visual redesign.
