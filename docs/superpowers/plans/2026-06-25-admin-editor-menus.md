# Editor chrome PR C2 — floating-menu token polish Implementation Plan

> Executed INLINE + editor-visible (live on `:5173`, like C1). CSS-only; validate against the REAL menus. Steps use `- [ ]`.

**Goal:** Re-skin all editor floating menus to the shadcn token vocabulary + one consistent polished look. No component/positioning change.

**Architecture:** Add a unified `--shadow-popover`; rewrite each menu's CSS in `editor.css` to `--popover`/`--popover-foreground`/`--muted-foreground`/`--border`/`--accent` (hover)/soft-`--primary` (active)/`--ring` (focus), keeping `--r-md`/`--r-sm`.

## Global Constraints
- CSS only (`apps/admin/src/styles/editor.css` + `tokens.css` for `--shadow-popover`). No `.tsx` change.
- Active toggle state (`.fmt-btn.on`, `.slash-item.sel`, `.ti-item.on`, `.bp-align.on`, selected) = soft primary (`color-mix(--primary 12%, transparent)` bg + `--primary` text), matching active-nav/status-pills/list-selection across the admin — NOT solid indigo.
- Hover = `--accent`. Surface = `--popover`. Border = `--border`. Shadow = `--shadow-popover`. Radius `--r-md` container / `--r-sm` items. Focus-visible = `--ring`.
- Menus keep markup/positioning/keyboard nav. Editor tests assert markup/behavior (not computed CSS) → stay green.
- Full gate `pnpm typecheck && pnpm test && pnpm build` green; visual UAT is the done bar.

---

### Task 1: `--shadow-popover` token + selection-bubble cluster
- [ ] Add `--shadow-popover` (light + dark) to `tokens.css` (subtle lift, replacing heavy `--shadow-pop` for menus).
- [ ] Re-skin `.fmt-bubble`/`.fmt-btn`(`.on`), TurnInto (`.ti-trigger`/`.ti-menu`/`.ti-item`/`.ti-chev`/`.ti-keys`/`.ti-label`), LinkInput (`.link-input*`) to the token map. Live-check the bubble on `:5173` (select text → marks/align/turn-into/link).
- [ ] Commit: `feat(admin): re-skin editor selection bubble to shadcn tokens (+ --shadow-popover)`.

### Task 2: Slash menu
- [ ] Re-skin `.slash`/`.slash-list`/`.slash-head`/`.slash-item`(`.sel`)/`.slash-ic`/`.slash-text`/`.slash-label`/`.slash-desc`/`.slash-empty`. Live-check `/` menu.
- [ ] Commit: `feat(admin): re-skin slash menu to shadcn tokens`.

### Task 3: Block menu + grip + table menu
- [ ] Re-skin `.blk-menu`/`.blk-menu-item`(`.sel`/`:disabled`)/`.blk-menu-key`, `.blk-grip`, `.table-menu`/`.table-menu button`. Live-check via drag-handle menu + a table.
- [ ] Commit: `feat(admin): re-skin block menu, grip, table menu to shadcn tokens`.

### Task 4: Link card + image toolbar
- [ ] Re-skin `.link-card*` and `.block-props`/`.bp-*`/`.sib-alt`. Live-check a link + an image.
- [ ] Commit: `feat(admin): re-skin link card + image toolbar to shadcn tokens`.

### Task 5: Gate + UAT
- [ ] `pnpm typecheck && pnpm test && pnpm build` green. Grep editor.css for leftover bespoke `--surface-2`/`--border-strong`/`--shadow-pop`/`--text-3`/`--text-4`/`--accent-soft` in menu rules → none (or noted).
- [ ] Editor-visible UAT: all six menus consistent + polished, light + dark. Owner approves.
