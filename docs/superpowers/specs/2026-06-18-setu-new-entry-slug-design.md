# New-entry slug minting — design (bugfix)

**Date:** 2026-06-18
**Status:** approved (owner)

## Bug

"New {post|page}" links to `/edit/<collection>/en/**new**`, so the editor opens with the literal
slug `new`, autosaves a draft keyed `(collection, en, new)`, and every later "New" reopens that
same draft. The slug is read-only in the UI, so there's no escape.

## Decision: slug stays the identity — no UUID

Published content keeps file-path identity (`content/<collection>/<locale>/<slug>.mdoc`) — Git-native,
human-readable files are the wedge; UUID-in-frontmatter muddies that and solves problems we don't have
yet (cross-references, translated slugs) that have lighter solutions (redirects, a future
`translationKey`). The real flaw is conflating "a draft exists" with "it has its final slug." Fix that.

## Behavior

`new` becomes a **compose sentinel**:
- **Compose mode** (`slug === 'new'`): blank, editable, **nothing persisted** and **no lock taken**
  until the first save. (So opening "New" and leaving without typing leaves no ghost draft.)
- **On first autosave**, mint a **unique slug from the title** (`"Post Test"` → `post-test`),
  uniquified against existing drafts + committed entries in that `(collection, locale)`
  (`post-test-2`, …; empty title → `untitled`), save the draft under it, and **`navigate(replace)`**
  to `/edit/<collection>/<locale>/<slug>`. Each "New" → its own draft; clean slugs, not `untitled-x7f3`.
- The slug is minted **once** (it doesn't churn as you keep typing the title).
- **Content-safety:** after the redirect the load effect detects the just-minted slug and keeps the
  in-memory doc as the source of truth (it may hold keystrokes newer than the saved copy) rather than
  reloading over it. Leaving still flushes via the existing unmount/`beforeunload` autosave guard.
- **Publish** is disabled while composing (no entry yet); the first keystroke mints within the
  autosave debounce, after which it's a normal entry and Publish enables.
- The editor breadcrumb reads "New <collection>" while composing (not "<collection> / new").

## Units

- **`apps/admin/src/editor/new-entry.ts`** — pure `slugify(title)` + `uniqueSlug(base, taken)`;
  `existingSlugs(data, git, collection, locale)` (drafts + committed + the `new` sentinel);
  `mintSlug(data, git, collection, locale, title)`. `NEW_SLUG = 'new'`.
- **`EditorScreen.tsx`** — compose-mode load branch; mint+save+redirect in the autosave `save`
  callback; just-minted guard in the load effect; Publish gated off while composing; breadcrumb.

## Out of scope (follow-up)

- **Editable slug** in the MetaPanel (rename a draft) — its own increment (needs DataPort rename
  = save-new + delete-old). Title-derived slug covers the common case for now.
- Slug editing / permalink config / redirects (the broader permalink system).

## Testing

- **pure:** `slugify` (spaces/case/symbols/unicode/empty); `uniqueSlug` (free, collision → `-2`,
  reserved `new`).
- **mintSlug:** with in-memory data+git — derives from title; bumps to `-2` when the slug exists as a
  draft or as a committed entry; respects locale.
- **editor flow:** mount at `/edit/post/en/new`, type a title, advance the autosave debounce →
  a draft is saved under the title-derived slug (not `new`) and the route is replaced to it; a second
  `/edit/post/en/new` mount is blank (distinct).
