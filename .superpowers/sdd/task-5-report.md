## Task 5 Report: ShortcutsDialog → shadcn Dialog

**Status:** DONE

### Prop API
- Before: `{ onClose: () => void }` (no `open` prop; parent used conditional rendering `{shortcutsOpen && <ShortcutsDialog .../>}`)
- After: `{ open: boolean; onClose: () => void }` (shadcn Dialog controlled via `open`; parent now always renders `<ShortcutsDialog open={shortcutsOpen} onClose={...}/>`)
- `onOpenChange={(o) => { if (!o) onClose() }}` maps the shadcn dismiss event to the existing `onClose` callback.

### Files Changed
- `apps/admin/src/editor/ShortcutsDialog.tsx` — replaced `.sc-backdrop`/`.sc-dialog` raw markup with shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`; key chips as `<span className="inline-flex items-center rounded border bg-muted px-1.5 text-xs font-mono">`; removed manual Escape/focus/backdrop logic (shadcn handles all of it)
- `apps/admin/src/editor/EditorScreen.tsx` — updated call site: `{shortcutsOpen && <ShortcutsDialog .../>}` → `<ShortcutsDialog open={shortcutsOpen} .../>`
- `apps/admin/test/ShortcutsDialog.test.tsx` — created; tests `open=true` shows heading + shortcut rows; `open=false` shows nothing; close button calls `onClose`; block-type shortcuts present
- `apps/admin/test/shortcuts-dialog.test.tsx` — updated existing tests to use new `open={true}` prop

### Test Command + Output
```
pnpm --filter @setu/admin test -- ShortcutsDialog editor-screen
Test Files  111 passed (111)
Tests       424 passed (424)
```

### Commit
`d33a926` feat(admin): ShortcutsDialog on shadcn Dialog

### Concerns
- The shortcut with label "Keyboard shortcuts" (id: `shortcuts`, `Help` group) collides with the dialog title text. `getByText('Keyboard shortcuts')` returns multiple elements. Fixed by using `getByRole('heading', { name: 'Keyboard shortcuts' })` in the new test file.
- Removed manual `Escape` key listener and `dialogRef.focus()` — shadcn/Radix Dialog handles focus trapping and Escape natively, which is more accessible.
