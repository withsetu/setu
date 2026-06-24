# Editor chrome PR A — header strip + Shortcuts dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the editor `ed-strip` header + Shortcuts dialog onto shadcn primitives and consolidate status into one save-indicator (center) + one lifecycle Badge (right), with all publish/preview/autosave behavior unchanged.

**Architecture:** Extract/re-skin `SaveIndicator`, add a `StripStatus` Badge (reusing `src/lib/status-badge`), rebuild `PublishMenu` as a shadcn split button (Button + DropdownMenu), rebuild the `ed-strip` JSX with shadcn `Button`/`Tooltip` + lucide icons, and convert `ShortcutsDialog` to shadcn `Dialog`. Then delete the dead bespoke CSS.

**Tech Stack:** React 19, Vite, Vitest + Testing Library, shadcn/ui (`Button`, `Badge`, `DropdownMenu`, `Dialog`, `Tooltip`), lucide-react, `@setu/core`.

## Global Constraints

- Editor opts OUT of `PageBody`; the strip stays a plain flex bar (`.editor` root unchanged structurally).
- Status: lifecycle Badge variants come from `src/lib/status-badge.ts` `statusBadge(lifecycle)` → `{label, variant}` where variant ∈ `warning|info|success|secondary` (draft→warning, staged→info, live→success) — IDENTICAL to the content lists. Do NOT invent a new mapping. Keep the `· {pending}` suffix.
- Save indicator labels: `saving`→"Saving…", `saved`→"Saved", `readonly`→"Read-only", `idle`→ render nothing (null). Remove the old `idle`→"Draft" (that conflated save-state with lifecycle).
- shadcn `Tooltip` requires a `TooltipProvider` ancestor. The app already wraps content in shadcn `SidebarProvider`, which renders a `TooltipProvider` — verify this covers the editor route; if not, wrap the strip in a local `TooltipProvider`.
- Preserve ALL behavior seams verbatim: `onPublish`/`onUnpublish`/`onRepublish`/`onPreview`, autosave `status`, `lifecycleLabel`/`statusBadge`, `can('content.publish'|'content.unpublish')`, `siteUrl(ref)`, `composing`, `previewApi`, `shortcutsOpen`/`setShortcutsOpen`, `phase` ('loading'|'ready'|'readonly').
- Brand indigo = `--primary` (shadcn `Button` default). Icons from lucide for the strip.
- Full gate before done: `pnpm typecheck && pnpm test && pnpm build` ALL green (vitest does not typecheck — the gate must include `pnpm typecheck`).
- Keep editor tests green: `editor-screen`, `editor-publish`, `editor-unpublish`, `editor-preview`. Update only selectors that genuinely changed; never weaken an assertion.

---

### Task 1: Re-skin `SaveIndicator` (save-state only)

**Files:**
- Create: `apps/admin/src/editor/SaveIndicator.tsx`
- Create: `apps/admin/test/SaveIndicator.test.tsx`
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (remove the inline `SaveIndicator`, import the new one)

**Interfaces:**
- Consumes: `SaveStatus = 'idle' | 'saving' | 'saved'` (from `./useAutosave`).
- Produces: `export function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean })`.

- [ ] **Step 1: Write the failing test**

`SaveIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SaveIndicator } from '../src/editor/SaveIndicator'

describe('SaveIndicator', () => {
  it('shows Saving… while saving', () => {
    render(<SaveIndicator status="saving" readonly={false} />)
    expect(screen.getByText('Saving…')).toBeInTheDocument()
  })
  it('shows Saved when saved', () => {
    render(<SaveIndicator status="saved" readonly={false} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
  it('shows Read-only when readonly', () => {
    render(<SaveIndicator status="saved" readonly />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })
  it('renders nothing when idle', () => {
    const { container } = render(<SaveIndicator status="idle" readonly={false} />)
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- SaveIndicator`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`SaveIndicator.tsx`:

```tsx
import { Check, Loader2, Lock } from 'lucide-react'
import type { SaveStatus } from './useAutosave'

/** Quiet save-state indicator for the editor strip center. Shows ONLY persistence
 *  state — lifecycle status lives in the strip Badge, not here. */
export function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean }) {
  if (readonly) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock className="size-3.5" /> Read-only
      </span>
    )
  }
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Check className="size-3.5 text-success" /> Saved
      </span>
    )
  }
  return null
}
```

In `EditorScreen.tsx`: delete the inline `function SaveIndicator(...) {...}` (lines ~29-33) and add `import { SaveIndicator } from './SaveIndicator'`. The existing `<SaveIndicator status={status} readonly={phase === 'readonly'} />` call site stays.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- SaveIndicator`
Expected: PASS.

- [ ] **Step 5: Check editor-screen test for stale idle text**

Run: `grep -n "Draft\|Saving\|Saved\|Read-only" apps/admin/test/editor-screen.test.tsx`
If it asserts the old idle "Draft" center text, update that assertion to match the new behavior (idle → no center text). Do NOT weaken other assertions. Re-run: `pnpm --filter @setu/admin test -- editor-screen` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/SaveIndicator.tsx apps/admin/test/SaveIndicator.test.tsx apps/admin/src/editor/EditorScreen.tsx apps/admin/test/editor-screen.test.tsx
git commit -m "feat(admin): editor SaveIndicator — save-state-only, re-skinned"
```

---

### Task 2: `StripStatus` lifecycle Badge

**Files:**
- Create: `apps/admin/src/editor/StripStatus.tsx`
- Create: `apps/admin/test/StripStatus.test.tsx`
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (replace the inline `StatusPill` usage)

**Interfaces:**
- Consumes: `Lifecycle` (`@setu/core`); `statusBadge(lc)` (`../lib/status-badge`) → `{label, variant}`; `lifecycleLabel(lc)` (`../lifecycle/label`) → `{label, pending?}`; shadcn `Badge`.
- Produces: `export function StripStatus({ lifecycle }: { lifecycle: Lifecycle })`.

- [ ] **Step 1: Write the failing test**

`StripStatus.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StripStatus } from '../src/editor/StripStatus'

describe('StripStatus', () => {
  it('renders the draft label', () => {
    render(<StripStatus lifecycle={{ state: 'draft' }} />)
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
  it('renders the live label', () => {
    render(<StripStatus lifecycle={{ state: 'live' }} />)
    expect(screen.getByText(/live/i)).toBeInTheDocument()
  })
  it('shows the pending suffix when present', () => {
    render(<StripStatus lifecycle={{ state: 'staged', pending: 'deploy' }} />)
    expect(screen.getByText(/· deploy/)).toBeInTheDocument()
  })
})
```
(Confirm the exact `pending` shape against `lifecycle/label.ts` / the `Lifecycle` type — adjust the staged fixture to a valid `pending` value if the type differs. The assertion is on the rendered `· {pending}` text.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- StripStatus`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`StripStatus.tsx`:

```tsx
import type { Lifecycle } from '@setu/core'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '../lib/status-badge'
import { lifecycleLabel } from '../lifecycle/label'

/** Canonical lifecycle status for the editor strip — same variant mapping as the
 *  content lists (src/lib/status-badge), with the pending suffix. */
export function StripStatus({ lifecycle }: { lifecycle: Lifecycle }) {
  const { label, variant } = statusBadge(lifecycle)
  const { pending } = lifecycleLabel(lifecycle)
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{label}</Badge>
      {pending && <span className="text-xs text-muted-foreground">· {pending}</span>}
    </span>
  )
}
```

In `EditorScreen.tsx`, replace the IIFE block:
```tsx
{(() => { const { label, pending } = lifecycleLabel(lifecycle); return (
  <span className="ed-status"><StatusPill status={label} />{pending && <span className="status-pending">· {pending}</span>}</span>
) })()}
```
with `<StripStatus lifecycle={lifecycle} />` and add `import { StripStatus } from './StripStatus'`. Remove the now-unused `StatusPill` import and the `lifecycleLabel` import if nothing else in the file uses them (check first).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- StripStatus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/StripStatus.tsx apps/admin/test/StripStatus.test.tsx apps/admin/src/editor/EditorScreen.tsx
git commit -m "feat(admin): editor strip status Badge (shared lists mapping)"
```

---

### Task 3: `PublishMenu` → shadcn split button

**Files:**
- Modify: `apps/admin/src/editor/PublishMenu.tsx` (rewrite internals; SAME props)
- Create: `apps/admin/test/PublishMenu.test.tsx`

**Interfaces:**
- Consumes: shadcn `Button`, `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`; lucide `ChevronDown`.
- Produces: same export `PublishMenu({ canPublish, canUnpublish, isUnpublished, onPublish, onUnpublish, onRepublish })` — signature unchanged.

- [ ] **Step 1: Write the failing test**

`PublishMenu.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PublishMenu } from '../src/editor/PublishMenu'

const noop = () => {}

describe('PublishMenu', () => {
  it('renders nothing when neither publish nor unpublish is allowed', () => {
    const { container } = render(<PublishMenu canPublish={false} canUnpublish={false} isUnpublished={false} onPublish={noop} onUnpublish={noop} onRepublish={noop} />)
    expect(container.textContent).toBe('')
  })
  it('primary Publish calls onPublish', () => {
    const onPublish = vi.fn()
    render(<PublishMenu canPublish canUnpublish={false} isUnpublished={false} onPublish={onPublish} onUnpublish={noop} onRepublish={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalledOnce()
  })
  it('menu offers Unpublish when published + can unpublish', () => {
    const onUnpublish = vi.fn()
    render(<PublishMenu canPublish canUnpublish isUnpublished={false} onPublish={noop} onUnpublish={onUnpublish} onRepublish={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /more publish/i }))
    fireEvent.click(screen.getByText('Unpublish'))
    expect(onUnpublish).toHaveBeenCalledOnce()
  })
})
```
(Radix `DropdownMenu` in jsdom may need a pointer/`scrollIntoView` workaround as established in the taxonomy tests — open via `fireEvent.click` on the trigger; if the menu doesn't appear, apply the same `scrollIntoView` stub + `fireEvent.keyDown(trigger, {key:'Enter'})` pattern used in `CategoriesTab.test.tsx`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- PublishMenu`
Expected: FAIL — assertions fail against the old bespoke markup (or the test file is new).

- [ ] **Step 3: Implement**

Rewrite `PublishMenu.tsx`:

```tsx
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

export function PublishMenu({
  canPublish, canUnpublish, isUnpublished, onPublish, onUnpublish, onRepublish,
}: {
  canPublish: boolean; canUnpublish: boolean; isUnpublished: boolean
  onPublish: () => void; onUnpublish: () => void; onRepublish: () => void
}) {
  if (!canPublish && !canUnpublish) return null
  const items = [
    { key: 'unpublish', label: 'Unpublish', run: onUnpublish, show: canUnpublish && !isUnpublished },
    { key: 'republish', label: 'Re-publish', run: onRepublish, show: canPublish && isUnpublished },
  ].filter((i) => i.show)
  return (
    <div className="inline-flex items-center">
      {canPublish && (
        <Button size="sm" className={items.length > 0 ? 'rounded-r-none' : ''} onClick={onPublish}>Publish</Button>
      )}
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={canPublish ? 'default' : 'outline'} aria-label="More publish actions"
              className={canPublish ? 'rounded-l-none border-l border-l-primary-foreground/25 px-2' : 'px-2'}>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((i) => <DropdownMenuItem key={i.key} onSelect={() => i.run()}>{i.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
```
The old `useDismiss`/`useState` import + usage are removed (DropdownMenu manages its own open state).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- PublishMenu`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/PublishMenu.tsx apps/admin/test/PublishMenu.test.tsx
git commit -m "feat(admin): PublishMenu — shadcn split button"
```

---

### Task 4: Rebuild the `ed-strip` layout (shadcn Button + Tooltip + lucide)

**Files:**
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (the `<div className="ed-strip">…</div>` block, ~lines 224-296)

**Interfaces:**
- Consumes: shadcn `Button`, `Tooltip`/`TooltipTrigger`/`TooltipContent`(/`TooltipProvider`); lucide `ChevronLeft`, `ExternalLink`, `Eye`, `Keyboard`; `SaveIndicator` (Task 1), `StripStatus` (Task 2), `PublishMenu` (Task 3).

- [ ] **Step 1: Confirm a TooltipProvider is in scope**

Run: `grep -rn "TooltipProvider" apps/admin/src/components/ui/sidebar.tsx apps/admin/src/shell` — confirm `SidebarProvider` renders a `TooltipProvider` that wraps the routed content (it does in stock shadcn sidebar). If yes, no provider needed here. If not, import `TooltipProvider` and wrap the strip's tooltip buttons in one.

- [ ] **Step 2: Rebuild the strip JSX**

Replace the `<div className="ed-strip">…</div>` block. Each icon control follows this shape (Tooltip wrapping a ghost icon Button); the back button uses `asChild` around the `<Link>`, the view-on-site uses `asChild` around the `<a>`:

```tsx
<div className="flex h-13 items-center gap-2 border-b border-border/60 px-3.5">
  {/* left */}
  <Tooltip>
    <TooltipTrigger asChild>
      <Button asChild variant="ghost" size="icon" aria-label="Back to list">
        <Link to={listPath}><ChevronLeft className="size-[18px]" /></Link>
      </Button>
    </TooltipTrigger>
    <TooltipContent>Back to list</TooltipContent>
  </Tooltip>
  <span className="text-[13.5px] text-muted-foreground">{composing ? `New ${collection}` : `${collection} / ${slug}`}</span>

  {/* center: save state only */}
  <div className="flex flex-1 justify-center"><SaveIndicator status={status} readonly={phase === 'readonly'} /></div>

  {/* right */}
  <StripStatus lifecycle={lifecycle} />
  <span className="mx-1 h-5 w-px bg-border" />

  {lifecycle.state === 'staged' || lifecycle.state === 'live' ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" aria-label="View this page on the live site">
          <a href={siteUrl(ref)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-[18px]" /></a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>View this page on the live site</TooltipContent>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* disabled button can't trigger hover; wrap in span so the tooltip still shows */}
        <span><Button variant="ghost" size="icon" disabled aria-label="Not on the site yet — publish to view it live"><ExternalLink className="size-[18px]" /></Button></span>
      </TooltipTrigger>
      <TooltipContent>Not on the site yet — publish to view it live</TooltipContent>
    </Tooltip>
  )}

  {previewApi && !composing && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Preview the draft in your site theme" onClick={() => void onPreview()}><Eye className="size-[18px]" /></Button>
      </TooltipTrigger>
      <TooltipContent>Preview the draft in your site theme</TooltipContent>
    </Tooltip>
  )}

  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard className="size-[18px]" /></Button>
    </TooltipTrigger>
    <TooltipContent>Keyboard shortcuts</TooltipContent>
  </Tooltip>

  <PublishMenu
    canPublish={can('content.publish') && phase === 'ready' && !composing}
    canUnpublish={can('content.unpublish') && phase === 'ready' && !composing}
    isUnpublished={metadata['published'] === false}
    onPublish={onPublish} onUnpublish={onUnpublish} onRepublish={onRepublish}
  />
</div>
```
Remove the old editor `Tooltip` (Tippy) import + the `Icon` import IF nothing else in the file uses them (the canvas/other code may still use `Icon` — check; only remove if unused). Keep `h-13` ≈ 52px (define via `h-[52px]` if `h-13` is not in the scale).

- [ ] **Step 3: Add/confirm a strip component test**

Add to (or create) a test that renders the editor and asserts the strip renders: the Back link (`role link` / aria-label "Back to list"), the Keyboard-shortcuts button, and the Publish button when allowed. The existing `editor-screen.test.tsx` `renderEditor()` harness is the vehicle — extend it rather than build a new harness. Assert by `aria-label`/role, not CSS classes.

- [ ] **Step 4: Run the editor suites**

Run: `pnpm --filter @setu/admin test -- editor-screen editor-publish editor-unpublish editor-preview`
Expected: PASS. Fix any selector that changed (e.g. a test querying `.strip-btn` → query by `aria-label`); never weaken assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/EditorScreen.tsx apps/admin/test/editor-screen.test.tsx
git commit -m "feat(admin): rebuild editor strip on shadcn Button/Tooltip + lucide"
```

---

### Task 5: `ShortcutsDialog` → shadcn `Dialog`

**Files:**
- Modify: `apps/admin/src/editor/ShortcutsDialog.tsx`
- Create/Modify: `apps/admin/test/ShortcutsDialog.test.tsx`

**Interfaces:**
- Consumes: shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`. Keep the existing props (the open flag + onClose, and the shortcut data source from `./shortcuts`).

- [ ] **Step 1: Read the current component + props**

Read `apps/admin/src/editor/ShortcutsDialog.tsx` for its props (open/onClose) and the grouped shortcut data it renders. Preserve the same groups/rows.

- [ ] **Step 2: Write the failing test**

`ShortcutsDialog.test.tsx`: render with the dialog open; assert the dialog title ("Keyboard shortcuts") and at least one known shortcut row render; render closed → content absent. Use the props the component actually exposes.

```tsx
// open → getByText('Keyboard shortcuts') present + a sample shortcut label present
// closed → queryByText('Keyboard shortcuts') is null
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- ShortcutsDialog`
Expected: FAIL.

- [ ] **Step 4: Convert to shadcn Dialog**

Replace the `.sc-backdrop`/`.sc-dialog` markup with `Dialog` (`open` + `onOpenChange`) → `DialogContent` → `DialogHeader`/`DialogTitle` "Keyboard shortcuts" → the same grouped rows, with key chips as small spans (`inline-flex items-center rounded border bg-muted px-1.5 text-xs`). Keep the same shortcut data and grouping; only the container/styling changes.

- [ ] **Step 5: Run to verify pass + the screen test**

Run: `pnpm --filter @setu/admin test -- ShortcutsDialog editor-screen`
Expected: PASS (the strip's shortcuts button still opens it via `shortcutsOpen`).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/ShortcutsDialog.tsx apps/admin/test/ShortcutsDialog.test.tsx
git commit -m "feat(admin): ShortcutsDialog on shadcn Dialog"
```

---

### Task 6: Cleanup — dead CSS + unused StatusPill, full gate

**Files:**
- Delete: `apps/admin/src/ui/StatusPill.tsx` (if now unreferenced)
- Modify: `apps/admin/src/styles/editor.css` (+ `components.css` for StatusPill `.badge-*` only if dead)

- [ ] **Step 1: Confirm StatusPill is unused**

Run: `grep -rn "StatusPill" apps/admin/src` — expect only its own file. If so, `git rm apps/admin/src/ui/StatusPill.tsx`. (If other files still use it, skip the delete and note it.)

- [ ] **Step 2: Remove dead strip CSS**

Run: `grep -rn "ed-strip\|strip-btn\|ed-breadcrumb\|\.autosave\|publish-menu\|status-pending\|ed-status\|sc-backdrop\|sc-dialog\|sc-head\|sc-title\|sc-close\|sc-group\|sc-row\|sc-label\|sc-keys\|strip-tipwrap" apps/admin/src`
Delete every matched CSS selector block in `editor.css` that no longer has a JSX referent (these were the strip/publish-menu/shortcuts styles). Leave any class still referenced by remaining JSX (the canvas/meta still use editor.css). Re-run the grep; the only matches should be in CSS that is being removed or in still-live non-strip code — verify each remaining match is legitimately still used.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: ALL green. Note the admin test count.

- [ ] **Step 4: Editor-visible spot check (manual, optional)**

If a dev server is up, open an entry: strip shows back+breadcrumb, centered save state, one status badge, the icon actions with tooltips, and the split Publish; shortcuts opens the dialog. (Reviewer confidence comes from the tests; this is a glance.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(admin): remove dead editor-strip CSS + unused StatusPill"
```

---

## Self-Review

**Spec coverage:**
- Status consolidation (center=save only; right=one Badge) → Tasks 1 + 2. ✓
- Strip icon buttons → shadcn Button/Tooltip + lucide → Task 4. ✓
- PublishMenu → split button → Task 3. ✓
- ShortcutsDialog → shadcn Dialog → Task 5. ✓
- Behavior seams preserved (publish/preview/autosave/permissions) → Tasks 3/4 wire the same callbacks + gating. ✓
- Dead CSS + StatusPill cleanup → Task 6. ✓
- PR B hand-off (meta-panel segmented status) — noted in spec; not a task here (correct). ✓

**Placeholder scan:** No "TBD"/"add error handling". The `>`-notes (TooltipProvider presence, pending-shape, Radix jsdom workaround, Icon-import removal only-if-unused) flag real-code checks the implementer resolves against the repo, naming the exact file — not skipped work.

**Type consistency:** `SaveStatus` from `./useAutosave` used in Task 1. `statusBadge(lifecycle)→{label,variant}` (variants warning|info|success|secondary, all valid `Badge` variants) in Task 2. `PublishMenu` props identical to current (Task 3). `Lifecycle` from `@setu/core` in Task 2. Component names `SaveIndicator`/`StripStatus`/`PublishMenu` consistent across tasks.
