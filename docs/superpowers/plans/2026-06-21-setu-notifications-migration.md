# Notifications Migration + Top-Right Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the admin's remaining transient action-feedback through `useNotify`, and move the notification region to the top-right.

**Architecture:** Replace one-off inline `role=status/alert` messages in EditorScreen (publish), Canvas (image error), Categories (re-parent error), and Media (upload+delete) with `useNotify()` calls; flip the `.notify-region` CSS to top-right. Field-validation (CategoryField) and pre-mount (Bootstrap) cases stay inline.

**Tech Stack:** TypeScript, React 18, Vitest + @testing-library/react.

## Global Constraints

- `useNotify()` → `{ success(m), error(m), info(m) }`, from `apps/admin/src/ui/notify.tsx` (already mounted in `main.tsx`).
- **Migrate (transient):** EditorScreen publish, Canvas image error, Categories re-parent error, Media upload **and** delete (Media's `error` state is shared by both — remove it fully).
- **Keep inline (do NOT change):** CategoryField create error; Bootstrap IndexedDB-fallback console.error; EditorScreen autosave `SaveStatus` + "locked by another editor" `ed-banner`; Canvas "Uploading image…" busy banner (progress state).
- **Preserve message wording/intent**; only change the delivery channel.
- **Test fallout:** adding `useNotify` to a component makes its render require `NotificationProvider` — every test that renders a migrated component must wrap its tree with `<NotificationProvider>` (import from `../src/ui/notify`), inside the other providers. Don't weaken existing assertions.
- Position: `.notify-region` → top-right (one CSS change).
- Spec: `docs/superpowers/specs/2026-06-21-setu-notifications-migration-design.md`.

---

### Task 1: EditorScreen + Canvas → `useNotify`

**Files:**
- Modify: `apps/admin/src/editor/EditorScreen.tsx`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Test: the editor test suite (wrap renders with `NotificationProvider`)

**Interfaces:** Consumes `useNotify` from `../ui/notify`.

- [ ] **Step 1: EditorScreen — publish result → notify**

In `apps/admin/src/editor/EditorScreen.tsx`:
- Add import: `import { useNotify } from '../ui/notify'`.
- In the component, add `const notify = useNotify()` (near the other hooks).
- Remove the `publishMsg` state line (`const [publishMsg, setPublishMsg] = useState<string | null>(null)`).
- In `commit()`, remove the `setPublishMsg(null)` line, and replace the result handling:
```ts
      const r = await publish.publish({ ref, author: OWNER_AUTHOR })
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        notify.success('Published · ' + r.sha.slice(0, 7))
        reindex(ref)
        await refreshLifecycle()
      } else if (r.status === 'conflict') {
        notify.error('The published version moved — reload to continue.')
      }
```
- Remove the render line `{publishMsg && <span className="publish-msg">{publishMsg}</span>}`.
- Leave the autosave `SaveStatus` indicator and the `ed-banner` lock banner untouched.

- [ ] **Step 2: Canvas — image error → notify**

In `apps/admin/src/editor/Canvas.tsx`:
- Add import: `import { useNotify } from '../ui/notify'`.
- Add `const notify = useNotify()` in the component.
- Remove the `imgError` state line (`const [imgError, setImgError] = useState<string | null>(null)`).
- Change the error handler: `const onError = (msg: string) => notify.error(msg)` (it was `setImgError(msg)`).
- In `onUploading`, drop the `if (busy) setImgError(null)` (just `setImgBusy(busy)`).
- Remove the render line `{imgError && <div className="editor-banner error" role="alert">{imgError}</div>}`.
- Leave the `{imgBusy && <div className="editor-banner">Uploading image…</div>}` busy banner.

- [ ] **Step 3: Wrap editor tests with NotificationProvider + run**

Run `cd apps/admin && pnpm vitest run` — editor tests that render `EditorScreen` (which renders `Canvas`) now throw "useNotify must be used within a NotificationProvider". For EACH failing test file (expected: `editor-screen.test.tsx`, `editor-publish.test.tsx`, `editor-unpublish.test.tsx`, `editor-preview.test.tsx`, `deploy-status.test.tsx`, `new-entry-flow.test.tsx`, and any Canvas test), wrap the rendered tree with `<NotificationProvider>` (import `{ NotificationProvider } from '../src/ui/notify'`), placed as the OUTERMOST provider (or just inside the router). Add ONLY the wrapper — change no assertions.

Then, in whichever editor-publish test asserts the old publish feedback: if a test asserted `publish-msg` / "Published ·" inline, update it to `await screen.findByText(/Published ·/)` (the toast). If no test asserted it, add one short assertion to `editor-publish.test.tsx` that a successful publish surfaces a "Published ·" notification.

- [ ] **Step 4: Verify**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/EditorScreen.tsx apps/admin/src/editor/Canvas.tsx apps/admin/test
git commit -m "feat(ux): editor publish + image errors via useNotify"
```

---

### Task 2: Categories screen → `useNotify`

**Files:**
- Modify: `apps/admin/src/screens/Categories.tsx`
- Test: the Categories screen test (wrap with `NotificationProvider`)

- [ ] **Step 1: Migrate the re-parent error**

In `apps/admin/src/screens/Categories.tsx`:
- Add import: `import { useNotify } from '../ui/notify'`.
- Add `const notify = useNotify()` in the component.
- Remove the `error` state line (`const [error, setError] = useState<string | null>(null)`).
- In `onReparent`, remove `setError(null)` and change the catch to `notify.error(e instanceof Error ? e.message : String(e))`:
```ts
  const onReparent = async (slug: string, parent: string) => {
    try {
      await reparent(slug, parent || null)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }
```
- Remove the render line `{error && <p role="alert" className="error">{error}</p>}`.
- If `useState` is now unused, drop it from the React import (keep `useMemo`).

- [ ] **Step 2: Wrap the Categories test + run**

Run `cd apps/admin && pnpm vitest run` — the Categories screen test now needs `NotificationProvider`. Wrap its rendered tree with `<NotificationProvider>` (import from `../src/ui/notify`). If a test asserted the inline re-parent error, update it to `await screen.findByText(...)` against the toast; otherwise leave assertions unchanged.

- [ ] **Step 3: Verify + commit**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS.
```bash
git add apps/admin/src/screens/Categories.tsx apps/admin/test
git commit -m "feat(ux): Categories re-parent errors via useNotify"
```

---

### Task 3: Media → `useNotify` (upload + delete)

**Files:**
- Modify: `apps/admin/src/screens/Media.tsx`
- Test: the Media screen test (wrap with `NotificationProvider`)

**Note:** Media's `error` state is shared by upload (`MediaDropzone onError`) and delete (`onDelete` catch). Remove it entirely; route both to `notify`, and add success toasts.

- [ ] **Step 1: Migrate**

In `apps/admin/src/screens/Media.tsx`:
- Add import: `import { useNotify } from '../ui/notify'`.
- Add `const notify = useNotify()` in the component.
- Remove the `error` state line (`const [error, setError] = useState<string | null>(null)`).
- `onUploaded` → also toast success:
```ts
  function onUploaded(result: { record: import('@setu/core').MediaRecord }) {
    void mediaIndex.upsertOne(result.record)
    setRefreshKey((k) => k + 1)
    notify.success('Uploaded ' + result.record.filename)
  }
```
- `onDelete`: remove `setError(null)`; on success after `removeOne`, add `notify.success('Deleted ' + selected.filename)` (capture the filename before `setSelected(null)`); change the catch to `notify.error(err instanceof Error ? err.message : String(err))`.
- Render: remove `{error && <p role="alert" className="media-error error">{error}</p>}`.
- `MediaDropzone` prop: `onError={(m) => notify.error(m)}` (was `onError={setError}`).
- `MediaGrid onSelect`: `onSelect={(row) => setSelected(row)}` (drop the `setError(null)`).
- Detail-panel close button: `onClick={() => setSelected(null)}` (drop the `setError(null)`).
- If `MediaRecord.filename` isn't the right field, use `result.record.mediaKey` / `selected.mediaKey` — verify the type: `grep -n "filename\|mediaKey" packages/core/src/**/*types* 2>/dev/null` or the `MediaRecord` definition.

- [ ] **Step 2: Wrap the Media test + run**

Run `cd apps/admin && pnpm vitest run` — wrap the Media test render with `<NotificationProvider>`. If a test asserted the inline upload/delete error, update it to assert the toast (`await screen.findByText(...)`). Add a short assertion that a successful upload surfaces an "Uploaded" notification if one isn't already covered.

- [ ] **Step 3: Verify + commit**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS.
```bash
git add apps/admin/src/screens/Media.tsx apps/admin/test
git commit -m "feat(ux): Media upload/delete feedback via useNotify"
```

---

### Task 4: Top-right position + dead-CSS prune + whole-monorepo verify

**Files:**
- Modify: `apps/admin/src/styles/components.css` (`.notify-region`)
- Modify: `apps/admin/src/styles/` (prune orphaned inline-message CSS)

- [ ] **Step 1: Move the region to top-right**

In `apps/admin/src/styles/components.css`, change `.notify-region` from `bottom: 24px;` to `top: 24px;` (keep `right: 24px`, the column layout, gap, z-index, `pointer-events`). If the `notifyIn` keyframe slides up from below, optionally flip it to slide down from the top so it reads naturally — using existing token/transform conventions.

- [ ] **Step 2: Prune orphaned CSS**

For each class whose inline element was removed — `.publish-msg`, `.media-error` — grep `apps/admin/src` for any remaining `.tsx` reference; if none, delete the rule. The `.editor-banner` BASE class is still used (busy banner + lock banner) — KEEP it; only remove an `.editor-banner.error` / `.editor-banner .error`-style rule if it exists AND is now unreferenced. The generic `.error` class is used by CategoryField (kept inline) — do NOT remove `.error`. Only delete a selector after grep shows zero `.tsx` uses.

- [ ] **Step 3: Whole-monorepo verification**

Run (repo root): `pnpm -r test`
Then: `pnpm --filter @setu/site exec astro sync && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean (apps/site needs `astro sync` first — pre-existing fresh-worktree codegen).

- [ ] **Step 4: Manual smoke (dev server)**

Confirm: notifications now appear **top-right**; publishing a post toasts "Published ·"; a re-parent cycle in /categories toasts the error; a media upload toasts "Uploaded …"; an image-insert error toasts. CategoryField create errors still show inline at the form.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/styles
git commit -m "style(ux): notifications top-right + prune orphaned inline-message CSS"
```

---

## Self-Review

**Spec coverage:**
- Position → top-right → Task 4. ✓
- Migrate Media (upload+delete) → Task 3; Categories → Task 2; EditorScreen publish → Task 1; Canvas image error → Task 1. ✓
- Keep inline: CategoryField, Bootstrap, EditorScreen autosave+lock, Canvas busy banner → untouched (explicit in each task). ✓
- Test fallout (NotificationProvider wrap) → addressed in Tasks 1–3. ✓
- Dead-CSS prune (grep-gated) → Task 4. ✓
- Non-goals (configurable position; API change) → none built. ✓

**Placeholder scan:** No TBD/TODO; concrete edits per file. Step 1 of Task 3 includes a grep fallback for the `MediaRecord` field name (filename vs mediaKey) — an explicit verification, not a placeholder. CSS steps name exact selectors + grep-gating.

**Type consistency:** `useNotify()` `{success,error,info}` used consistently; messages preserve wording ("Published · " + sha, "The published version moved — reload to continue."); removed states (`publishMsg`, `imgError`, Categories/Media `error`) each have their render + setters removed together; kept-inline classes (`.error`, `.editor-banner`) explicitly preserved.
