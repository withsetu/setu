# Media wave — shadcn re-skin + picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the admin media surface (`/media` screen + the editor's image picker) and the image-block flow to pure shadcn — Tailwind utilities + `@/components/ui/*` primitives — matching the rest of the migrated admin.

**Architecture:** Leaf-level primitive swaps, no data-flow change. `MediaBrowser` stays the single shared browse component (manage + pick). Toolbar → `Input`+`Select`; grid/tiles/dropzone → Tailwind on shadcn tokens + `Skeleton`; picker `MediaPickerModal` → `Dialog`; detail panel → `Sheet`; native `window.confirm` delete → `AlertDialog`. Bespoke `.media-*` CSS is deleted, not re-tokenized.

**Tech Stack:** React 19, Vite, Tailwind v4, shadcn/ui (Radix), Vitest + Testing Library, pnpm workspaces.

## Global Constraints

- Pure shadcn token vocabulary only — NO bespoke `--surface*`/`--text-N`/`--accent-ring`/`--shadow-pop`/`--border-strong` in media markup. Use `--card`/`--popover`/`--muted-foreground`/`--accent`/`--border`/`--ring`/`--primary`/`--radius`. (`no-brand-accent-in-bespoke-css` guard: never bare `var(--accent)` in hand-written CSS — but Tailwind utility classes like `bg-accent` are fine.)
- Tailwind-first like the migrated admin (`ListToolbar` is the reference idiom). Remove bespoke CSS as markup moves to utilities.
- Import primitives from `@/components/ui/*`. `cn` from `@/lib/utils`.
- `MediaBrowser` keeps its controlled-props contract (`apiBase`, `mode`, `filters`, `setFilters`, `onUploaded`, `onError`, `onPick`, `onSelect`, `refreshKey`) — both the `/media` screen and the picker render it, so they never drift.
- `MediaPickerModal` keeps its `{ apiBase, open, onClose, onPick }` contract — `Canvas.tsx` wiring is unchanged.
- Preserve these existing test markers (other suites assert them): tile `<button aria-label={filename}>`, the `Load more` button text, dropzone `data-testid="media-dropzone-input"`, image-block `.sib-img` + `Align wide` label + "Add a caption…"/"Alt text…" placeholders + "Replace" button text, toolbar `aria-label`s "Sort"/"Filter by type"/"Search media".
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green. Visual UAT (owner, light + dark) is the done bar.
- Branch/worktree per the migration norm; commit per task; do NOT `git add` any `.superpowers/` reports.

---

### Task 1: Media toolbar + grid/tiles/dropzone → Tailwind + shadcn

**Files:**
- Modify: `apps/admin/src/media/MediaBrowser.tsx` (toolbar)
- Modify: `apps/admin/src/media/MediaGrid.tsx` (grid, tiles, skeleton, Load more)
- Modify: `apps/admin/src/media/MediaDropzone.tsx` (dashed zone)
- Test (must stay green, no rewrite): `apps/admin/test/media-screen.test.tsx` (toolbar roles), `apps/admin/test/media-grid.test.tsx`, `apps/admin/test/media-dropzone.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: same component contracts; only internal markup/classes change.

- [ ] **Step 1: Toolbar in `MediaBrowser.tsx`.** Replace the raw `<input type="search">` and two `<select>`s with shadcn primitives, mirroring `ListToolbar`. Keep the debounced-search effect and the `aria-label`s exactly. Sort/type values are already non-empty (`uploadedAt-desc`, `all`…), so NO `__all__` sentinel is needed.

```tsx
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
// ...
<div className="flex flex-wrap items-center gap-2">
  <div className="relative min-w-48 flex-1">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input type="search" className="pl-8" placeholder="Search media" aria-label="Search media"
      value={search} onChange={(e) => setSearch(e.target.value)} />
  </div>
  <Select value={sortValueOf(filters.sort)} onValueChange={(v) => setFilters({ sort: parseSortValue(v) })}>
    <SelectTrigger size="sm" aria-label="Sort" className="w-36"><SelectValue /></SelectTrigger>
    <SelectContent>
      {SORT_OPTIONS.map((o) => <SelectItem key={`${o.key}-${o.dir}`} value={`${o.key}-${o.dir}`}>{o.label}</SelectItem>)}
    </SelectContent>
  </Select>
  <Select value={filters.type} onValueChange={(v) => setFilters({ type: v as MediaFilters['type'] })}>
    <SelectTrigger size="sm" aria-label="Filter by type" className="w-36"><SelectValue /></SelectTrigger>
    <SelectContent>
      {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
```
Replace the wrapping `<div className="media-browser">`/`list-toolbar` with `<div className="flex flex-col gap-3.5">` for the browser root (drop the `.media-browser` class) — keep `MediaDropzone` first, then the toolbar div, then `MediaGrid`.

- [ ] **Step 2: Grid + tiles + skeleton in `MediaGrid.tsx`.** Convert `.media-*` classes to Tailwind on tokens. Keep the `<button aria-label={row.filename}>` tile and `Load more` button text. Loading state → shadcn `Skeleton`.

```tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
// grid:
<div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3" data-total={total}>
// tile:
<button type="button" aria-label={row.filename} onClick={() => handleTileClick(row)}
  className="group flex flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-sm transition-[border-color,box-shadow] hover:border-ring hover:ring-2 hover:ring-ring/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
    {thumbSrc ? <img src={thumbSrc} alt={row.filename} loading="lazy" className="size-full object-cover" />
             : <FileIcon />}
  </div>
  <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
    <span className="truncate text-xs font-medium">{row.filename}</span>
    {row.isImage && row.width != null && row.height != null && (
      <span className="text-[11px] text-muted-foreground">{row.width}×{row.height}</span>)}
    <span className="text-[11px] text-muted-foreground">{humanSize(row.bytes)}</span>
  </div>
</button>
// loading:
<div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3" aria-busy="true" aria-label="Loading media">
  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-md" />)}
</div>
// empty:
<p className="px-5 py-12 text-center text-sm text-muted-foreground">{isEmpty ? 'No media yet' : 'No matches'}</p>
// load more:
<div className="flex justify-center pt-4">
  <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
    {loadingMore ? 'Loading…' : `Load more (${total - rows.length} more)`}
  </Button>
</div>
```
Update `FileIcon` className from `media-tile-file-icon` to `className="size-10 text-muted-foreground opacity-60"`.

- [ ] **Step 3: Dropzone in `MediaDropzone.tsx`.** Convert `.media-dropzone` to Tailwind. KEEP `data-testid="media-dropzone-input"` on the input and the `data-drag-active` attribute.

```tsx
className={cn(
  'flex min-h-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-border px-5 text-sm text-muted-foreground transition-colors',
  'hover:border-primary hover:bg-accent data-[drag-active]:border-primary data-[drag-active]:bg-accent',
)}
```
(import `cn` from `@/lib/utils`.)

- [ ] **Step 4: Run the affected suites — expect GREEN (markup roles/markers preserved).**

Run: `cd apps/admin && pnpm vitest run test/media-screen.test.tsx test/media-grid.test.tsx test/media-dropzone.test.tsx`
Expected: PASS. The toolbar `combobox`/`searchbox` role assertions pass (Radix `Select` trigger → `combobox`, `Input type=search` → `searchbox`); tile + Load more + dropzone markers unchanged.

- [ ] **Step 5: Commit.**

```bash
git add apps/admin/src/media/MediaBrowser.tsx apps/admin/src/media/MediaGrid.tsx apps/admin/src/media/MediaDropzone.tsx
git commit -m "feat(admin): re-skin media toolbar + grid + dropzone to shadcn"
```

---

### Task 2: Picker modal → shadcn `Dialog`

**Files:**
- Modify: `apps/admin/src/editor/MediaPickerModal.tsx`
- Test (update if needed): `apps/admin/test/media-picker-modal.test.tsx`

**Interfaces:**
- Consumes: `MediaBrowser` (Task-1 shape).
- Produces: unchanged `MediaPickerModal({ apiBase, open, onClose, onPick })` — `Canvas.tsx` untouched.

- [ ] **Step 1: Rebuild `MediaPickerModal.tsx` on `Dialog`.** Drop the hand-rolled overlay/scrim/Escape/`stopPropagation`. Keep state + `pick`.

```tsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MediaBrowser, DEFAULT_SORT } from '../media/MediaBrowser'
import type { MediaFilters } from '../media/MediaBrowser'
import { srcFromUploadUrl } from './image-insert'

export interface MediaPickerModalProps {
  apiBase: string; open: boolean; onClose: () => void; onPick: (src: string) => void
}

export function MediaPickerModal({ apiBase, open, onClose, onPick }: MediaPickerModalProps) {
  const [filters, setFilters] = useState<MediaFilters>({ q: '', type: 'all', sort: DEFAULT_SORT })
  const pick = (src: string) => { onPick(src); onClose() }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[880px] gap-0 p-0 sm:max-w-[880px]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>Add an image</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto p-5">
          <MediaBrowser apiBase={apiBase} mode="pick" filters={filters}
            setFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            onUploaded={(r) => pick(srcFromUploadUrl(r.url))}
            onError={(msg) => console.error('upload error:', msg)} onPick={pick} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Run the picker suite.**

Run: `cd apps/admin && pnpm vitest run test/media-picker-modal.test.tsx`
Expected: PASS. If a query relied on the old `.media-picker-*` markup, update it to query by content (`screen.getByLabelText('Search media')`, the tile button) — the `Dialog` portals into `document.body`, which `screen` already searches. Do NOT change behavior.

- [ ] **Step 3: Commit.**

```bash
git add apps/admin/src/editor/MediaPickerModal.tsx apps/admin/test/media-picker-modal.test.tsx
git commit -m "feat(admin): rebuild image picker on shadcn Dialog"
```

---

### Task 3: Detail panel → `Sheet`; delete → `AlertDialog`

**Files:**
- Modify: `apps/admin/src/screens/Media.tsx`
- Test (rewrite detail + delete cases): `apps/admin/test/media-screen.test.tsx`

**Interfaces:**
- Consumes: `useServices().index.referencedBy(mediaKey) → Promise<EntryIndexRow[]>` (each has `.title`), `deleteMedia(apiBase, mediaKey)`, `mediaIndex.removeOne`.
- Produces: detail region is now `role="dialog"` named "Media details"; delete confirm is an `AlertDialog` whose action button is named exactly **"Delete"**, cancel **"Cancel"**.

- [ ] **Step 1: Rewrite the detail + delete tests FIRST.** In `media-screen.test.tsx`: (a) remove the `vi.spyOn(window, 'confirm')` line from `beforeEach`; (b) change the four detail assertions from `role: 'complementary'` to `role: 'dialog'` (keep name `/Media details/i`); (c) rewrite the delete flow to click through the `AlertDialog`.

```tsx
// 'opens the detail panel when a tile is selected'
fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /Delete cat\.png/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /Copy URL/i })).toBeInTheDocument()

// 'shows the referencing post title in the confirm and deletes on confirm'
fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))   // opens AlertDialog
await waitFor(() => expect(screen.getByText(/My Post/)).toBeInTheDocument())
fireEvent.click(screen.getByRole('button', { name: 'Delete' }))             // confirm action (exact name)
await waitFor(() => expect(deleteMedia).toHaveBeenCalledWith('', '2026/06/cat'))

// 'closes the detail panel after a successful delete'
fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
await waitFor(() => expect(screen.queryByRole('dialog', { name: /Media details/i })).not.toBeInTheDocument())

// 'does NOT delete if user cancels'
fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
expect(deleteMedia).not.toHaveBeenCalled()
expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()

// 'surfaces delete errors as an error toast'
fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
await waitFor(() => { /* existing error-toast assertion unchanged */ })
```
Note: `{ name: 'Delete' }` is a full-string match, so it targets ONLY the AlertDialog action, never the `Delete cat.png` trigger. The detail `Sheet` is `role="dialog"`; the `AlertDialog` is `role="alertdialog"`, so the `dialog`-by-name queries never collide.

- [ ] **Step 2: Run the tests — expect FAIL** (panel still `complementary`, no AlertDialog yet).

Run: `cd apps/admin && pnpm vitest run test/media-screen.test.tsx`
Expected: FAIL on the rewritten cases.

- [ ] **Step 3: Implement `Media.tsx`.** Replace the `<aside className="media-detail">` with a `Sheet`, and the `window.confirm` delete with an `AlertDialog`. Compute `referencedBy` on Delete-click to build the description, then open the alert.

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
// state:
const [confirmOpen, setConfirmOpen] = useState(false)
const [usedBy, setUsedBy] = useState<EntryIndexRow[]>([])
// open the confirm (replaces window.confirm path):
async function requestDelete() {
  if (!selected) return
  try { setUsedBy(await index.referencedBy(selected.mediaKey)) }
  catch { setUsedBy([]) }
  setConfirmOpen(true)
}
// actual delete (runs on AlertDialog action):
async function confirmDelete() {
  if (!selected) return
  setDeleting(true)
  const deletedFilename = selected.filename
  try {
    await deleteMedia(apiBase, selected.mediaKey)
    await mediaIndex.removeOne(selected.mediaKey)
    setSelected(null)
    setRefreshKey((k) => k + 1)
    notify.success('Deleted ' + deletedFilename)
  } catch (err) {
    notify.error(err instanceof Error ? err.message : String(err))
  } finally { setDeleting(false) }
}
const usedNote = usedBy.length > 0
  ? `Used in ${usedBy.length} post(s): ${usedBy.map((u) => u.title).join(', ')}. This can't be undone.`
  : "This can't be undone."
```
```tsx
<Sheet open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null) }}>
  <SheetContent className="w-80 gap-0 p-0" aria-label="Media details">
    <SheetHeader className="border-b p-4">
      <SheetTitle className="sr-only">Media details</SheetTitle>
      <h2 className="truncate text-sm font-semibold">{selected?.filename}</h2>
    </SheetHeader>
    {selected && (
      <>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
          {selected.isImage && selected.width != null && selected.height != null && (
            <p className="text-xs text-foreground/80">{selected.width} × {selected.height}px</p>)}
          <p className="text-xs text-foreground/80">{humanSize(selected.bytes)}</p>
          <p className="text-xs text-muted-foreground">{selected.contentType}</p>
        </div>
        <div className="flex gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onCopyUrl}>Copy URL</Button>
          <Button variant="destructive" size="sm" disabled={deleting}
            aria-label={`Delete ${selected.filename}`} onClick={() => void requestDelete()}>
            Delete
          </Button>
        </div>
      </>
    )}
  </SheetContent>
</Sheet>

<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {selected?.filename}?</AlertDialogTitle>
      <AlertDialogDescription>{usedNote}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```
Delete the old `onDelete` function and the `aside`/detail JSX. Keep `onCopyUrl`. Note: `aria-label` on `SheetContent` plus the `sr-only` `SheetTitle` both name the region "Media details" (Radix requires a `Title`; the visible filename is a plain `<h2>`).

- [ ] **Step 4: Run the tests — expect PASS.**

Run: `cd apps/admin && pnpm vitest run test/media-screen.test.tsx`
Expected: PASS (all detail + delete cases).

- [ ] **Step 5: Commit.**

```bash
git add apps/admin/src/screens/Media.tsx apps/admin/test/media-screen.test.tsx
git commit -m "feat(admin): media detail panel as Sheet + AlertDialog delete confirm"
```

---

### Task 4: Image-block consistency pass (editor-visible)

**Files:**
- Modify (light): `apps/admin/src/editor/extensions/ImageBlock.tsx` and/or `apps/admin/src/styles/editor.css` only if a token/spacing inconsistency is visible against the new picker.
- Test (must stay green): `apps/admin/test/image-block-node.test.tsx`

**Interfaces:**
- Consumes: the Task-2 `Dialog` picker via `storage.openPicker` (already wired in `Canvas.tsx` → `MediaPickerModal`). No code change needed for Replace to open the new Dialog.

- [ ] **Step 1: Verify the Replace flow opens the new Dialog picker.** Run the dev server (`pnpm dev` from the main checkout so `VITE_SETU_API` is wired), open the editor, insert an image, click **Replace** → the shadcn `Dialog` picker opens; pick/upload swaps the image. Confirm the inline align/alt/caption/Replace toolbar reads as one family with the editor chrome (it was token-swept in C2 — only adjust if something is visibly off).

- [ ] **Step 2: If any visible inconsistency, fix minimally** (token/spacing in `editor.css` `.block-props`/`.bp-*`, or markup in `ImageBlock.tsx`). KEEP `.sib-img`, the `Align wide` label, the "Add a caption…"/"Alt text…" placeholders, and the "Replace" button text. No click-to-select, no new options (cut B scope).

- [ ] **Step 3: Run the image-block suite — expect GREEN.**

Run: `cd apps/admin && pnpm vitest run test/image-block-node.test.tsx`
Expected: PASS (markup markers preserved).

- [ ] **Step 4: Commit (skip if no change was needed).**

```bash
git add apps/admin/src/editor/extensions/ImageBlock.tsx apps/admin/src/styles/editor.css
git commit -m "polish(admin): image-block toolbar consistency with shadcn picker"
```

---

### Task 5: Remove dead media CSS + full gate + UAT

**Files:**
- Modify: `apps/admin/src/styles/components.css` (delete the `.media-*` block)

- [ ] **Step 1: Delete the dead `.media-*` block** from `components.css` (the lines re-skinned away in Tasks 1–3: `.media-grid`, `.media-tile*`, `.media-dropzone*`, `.media-screen`, `.media-detail*`, `.media-picker*`, `.media-browser`, `.media-loadmore`, and the now-unused `@keyframes pulse` if nothing else uses it). Keep `.btn-danger` only if other surfaces still reference it — grep first:

Run: `grep -rn "btn-danger\|media-detail\|media-picker\|media-tile\|media-browser\|media-grid\|media-dropzone" apps/admin/src --include=*.tsx`
Expected: no remaining references in `.tsx` (all migrated). Remove the matching CSS; if `btn-danger`/`pulse` is still used elsewhere, leave it.

- [ ] **Step 2: Grep for leftover bespoke tokens in media markup.**

Run: `grep -rn "media" apps/admin/src --include=*.tsx | grep -E "surface|text-[0-9]|accent-ring|shadow-pop|border-strong"`
Expected: no matches (or noted/justified).

- [ ] **Step 3: Full gate.**

Run: `cd /Users/mayank/Documents/projects/setu && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add apps/admin/src/styles/components.css
git commit -m "chore(admin): drop dead bespoke media CSS"
```

- [ ] **Step 5: Visual UAT (owner, the done bar).** On `:5173`, light + dark: `/media` — browse, search/sort/type, upload (drag + click), select → detail `Sheet`, Copy URL, Delete (with a where-used post and without), Load more; editor — insert image via slash/picker, Replace via the `Dialog` picker. Everything reads as one shadcn family.

## Self-Review

- **Spec coverage:** toolbar (T1) ✓, grid/tiles/dropzone+Skeleton (T1) ✓, picker→Dialog (T2) ✓, detail→Sheet (T3) ✓, delete→AlertDialog with where-used (T3) ✓, image-block consistency (T4) ✓, dead-CSS cleanup + gate + UAT (T5) ✓. All spec sections mapped.
- **Placeholder scan:** no TBD/"handle edge cases"/bare "write tests" — every code + test step shows actual content.
- **Type consistency:** `referencedBy → EntryIndexRow[]` with `.title`; `deleteMedia(apiBase, mediaKey)`; AlertDialog action named "Delete" / cancel "Cancel" used identically in test (Step 1) and impl (Step 3); `MediaPickerModal` contract unchanged across T2 + Canvas; `MediaBrowser` contract unchanged across T1/T2/T3.
