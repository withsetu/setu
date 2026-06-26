# Featured Image — Design

> Status: design / approved-to-plan (2026-06-26). A single optional featured image per post,
> set from the editor's right-hand meta panel (reusing the existing media picker), stored in
> frontmatter, and rendered responsively as a post lead/hero. Foundation for archive-card and
> related-widget thumbnails (later increments).

## Purpose

Let an editor attach one **featured image** to a post from the meta panel. It is stored in the
post's frontmatter and rendered as a responsive lead image on the post page. Because it is a normal
media reference, it reuses the entire existing pipeline — picker, variants/srcset, and "where-used"
— with almost no new plumbing. Later increments reuse the same field for archive-card and
related-widget thumbnails at smaller sizes.

## Key finding: most of this is free

Verified against the codebase:

- **Round-trip is transparent.** `publish-service` serializes the *entire* `draft.metadata` to YAML
  frontmatter via `serializeMdoc`, and `parseMdoc` reads it back. A new `featuredImage` key in
  `metadata` round-trips (draft ↔ `.mdoc` ↔ editor) with **zero core changes**.
- **Where-used is automatic.** `extractMediaRefs` already scans the serialized doc for `/media/<key>`
  references *including frontmatter cover images* and normalizes them; so storing the value as the
  `/media/<key>` **src string** means the media library's "referenced-by" picks it up with no change.
- **The picker already returns what we store.** `MediaPickerModal.onPick(src)` yields `'/media/' +
  row.key` — exactly the string we persist and exactly what `Image.astro` consumes as `src`.

So the value we store is the **`/media/<key>` src string** (not a bare key): one representation that
is simultaneously picker output, render input, and where-used input.

## Decisions (locked)

- **One optional image** per post; field key `featuredImage` in frontmatter/metadata.
- **Store the `/media/<key>` src string** verbatim from the picker.
- **A renders it as a post lead/hero** (top of the post) so it is immediately visible/testable;
  archive (B) and related (C) reuse the same field + `Image.astro` with smaller `sizes`.
- **`og:image`/SEO meta deferred** to a later SEO slice.
- **No core changes** for round-trip/indexing — guarded by tests, not new code.

## Architecture

```
apps/admin/src/editor/
  FeaturedImageField.tsx   # (1) new: pick / preview / remove, opens MediaPickerModal
  MetaPanel.tsx            # (1) add apiBase prop + a "Featured image" <Section>
  EditorScreen.tsx         # (1) pass apiBase to MetaPanel
packages/theme-default/
  PostLayout.astro         # (2) render the lead <Image> when featuredImage present
apps/site/src/pages/
  [...path].astro          # (2) pass featuredImage from entry.data to PostLayout
packages/core/                # (3) NO code change — guard tests only
```

### 1. Admin — `FeaturedImageField` + meta panel

`FeaturedImageField` props: `{ value?: string; onChange: (next: string | undefined) => void;
editable: boolean; apiBase: string }`.

- **Empty** → a "Set featured image" button (disabled when `!editable`).
- **Set** → a thumbnail preview (`<img src={resolveMediaSrc(value, apiBase)}>`) + "Change" (re-open
  picker) and "Remove" (`onChange(undefined)`) controls (hidden when `!editable`).
- Clicking Set/Change opens the existing `MediaPickerModal`; its `onPick(src)` → `onChange(src)`.

`MetaPanel` gains an `apiBase: string` prop and a `<Section title="Featured image">` (placed after
Permalink, before Categories) wiring `metadata['featuredImage']` (string|undefined) to the field;
on change it sets the key when a value is chosen and **deletes the key** when removed (keeps
frontmatter clean). `EditorScreen` passes `apiBase={(import.meta.env.VITE_SETU_API as string) ??
''}` — the same source `Canvas` already uses for the inline image picker.

### 2. Site — lead/hero render

`[...path].astro` reads `entry.data.featuredImage` and passes it to `PostLayout`. `PostLayout`
accepts `featuredImage?: string`; when present it renders, above the `<article>`, a responsive lead
image reusing `Image.astro` (`src={featuredImage}`, `alt={title}`, a wide `sizes` hint) inside the
`measure-post` column. Absent → nothing rendered (no empty wrapper). Zero JS.

### 3. Core — guard tests only (no code change)

Two tests lock the "free" behavior so a future refactor can't silently break it:
- `serializeMdoc`→`parseMdoc` round-trips a `metadata.featuredImage` string unchanged.
- `extractMediaRefs` returns the bare media key for a frontmatter `featuredImage: /media/<key>`.

## Out of scope (later)

- Archive/listing page + card thumbnails (Feature B).
- Related-widget image option (Feature C).
- `og:image` / social meta, multiple images / galleries, focal point, alt-text override for the
  featured image (the post title is used as alt for now).

## Testing

- **Admin (vitest + Testing Library):** `FeaturedImageField` — empty shows "Set" button; with a value
  shows the preview + Remove; Remove calls `onChange(undefined)`; the Set button opens the picker
  dialog (stub `fetch` so `MediaBrowser` mounts cleanly). `MetaPanel` — the new "Featured image"
  section renders in order; selecting/removing threads `featuredImage` through `onChange`.
- **Site (vitest render):** a post fixture with `featuredImage` frontmatter (+ a manifest fixture,
  as `render.test.ts` does) renders a responsive lead `<img>` with the resolved `/media` src +
  srcset; a post without it renders no lead image; zero JS.
- **Core:** the two guard tests above.

## Touches

- `apps/admin/src/editor/FeaturedImageField.tsx` (new) + `MetaPanel.tsx`, `EditorScreen.tsx` (modify)
- `apps/admin/test/FeaturedImageField.test.tsx` (new) + `MetaPanel.test.tsx` (modify)
- `packages/theme-default/PostLayout.astro`, `apps/site/src/pages/[...path].astro` (modify)
- `apps/site/test/` lead-image render test (new) + a tagged/featured fixture post
- `packages/core/src/.../featured-image guard tests` (new)
