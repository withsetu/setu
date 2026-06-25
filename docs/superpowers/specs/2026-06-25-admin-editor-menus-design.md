# Editor chrome — PR C2: floating-menu token polish

Status: approved approach, ready for plan
Date: 2026-06-25
Final editor-chrome PR (A strip ✅ → palette ✅ → B meta panel ✅ → C1 breakout ✅ → **C2 menus**). Done **editor-visible**. Part of [[setu-admin-shadcn-migration]].

## Goal

Re-skin every editor **floating menu** to the shadcn token vocabulary and polish them to one
consistent, modern (Linear/Notion-grade) look. Positioning stays TipTap/Tippy — this is **CSS-only**,
no shadcn primitives and no component/logic change. This also retires the bespoke
`--surface*`/`--border-strong`/`--shadow-pop`/`--text-3/4`/`--accent-soft` usage in these rules, so the
later cleanup PR has less to do.

## Scope (all in `apps/admin/src/styles/editor.css`, + one token addition)

The menus + their classes (from the map):
- **Selection bubble:** `.fmt-bubble`, `.fmt-btn`(`.on`); **TurnInto** `.ti-trigger`/`.ti-menu`/`.ti-item`(`.on`/`.sel`/`.ti-group`/`.ti-sub`)/`.ti-chev`/`.ti-keys`/`.ti-label`; **LinkInput** `.link-input`/`.link-input-field`/`.link-input-apply`/`.link-input-remove`.
- **Slash menu:** `.slash`/`.slash-list`/`.slash-head`/`.slash-item`(`.sel`)/`.slash-ic`/`.slash-text`/`.slash-label`/`.slash-desc`/`.slash-empty`.
- **Block menu + grip:** `.blk-menu`/`.blk-menu-item`(`.sel`/`:disabled`)/`.blk-menu-key`; `.blk-grip`(`:hover`/`:active`/`:focus-visible`).
- **Table menu:** `.table-menu`/`.table-menu button`(`:hover`).
- **Link card:** `.link-card`/`.link-card-open`/`.link-card-url`/`.link-card-btn`.
- **Image toolbar:** `.block-props`/`.bp-label`/`.bp-align`(`.on`)/`.bp-sep`/`.sib-alt`/`.bp-replace` (image-specific but re-skinned for consistency).

Out of scope: TipTap/Tippy positioning, any `.tsx`/component logic, the table cell/prose styling
(only the table *menu*), and the global temp-alias drop (the full cleanup PR handles dropping aliases
repo-wide; C2 only rewrites the menu rules).

## Architecture (token mapping)

Define ONE refined popover elevation in `apps/admin/src/styles/tokens.css` (light + dark), used by all
menus, replacing the heavy `--shadow-pop` (`0 24px 50px`) with a subtler lift:
```css
--shadow-popover: 0 4px 12px -2px hsl(230 12% 20% / 0.10), 0 12px 28px -8px hsl(230 12% 20% / 0.12);   /* light */
--shadow-popover: 0 4px 14px -2px hsl(240 40% 2% / 0.5), 0 16px 36px -10px hsl(240 40% 2% / 0.5);       /* dark */
```
(tuned live — the values above are the starting point.)

Per-menu rewrites apply this consistent mapping:

| concern | from (bespoke) | to (shadcn) |
|---|---|---|
| menu surface | `--surface` | `--popover` |
| menu text | `--text` | `--popover-foreground` |
| muted text (desc/keys/labels) | `--text-2`/`--text-3`/`--text-4` | `--muted-foreground` (and a touch lighter for hints if needed) |
| menu border | `--border-strong` / `--border` | `--border` |
| menu shadow | `--shadow-pop` | `--shadow-popover` |
| item hover | `--surface-2` / `--surface-hover` | `--accent` (neutral hover surface) |
| **active toggle** (`.fmt-btn.on`, `.slash-item.sel`, `.ti-item.on`, `.bp-align.on`, selected items) | `--primary` solid / `--accent-soft` | **soft primary: `color-mix(--primary 12%, transparent)` bg + `--primary` text** (matches active-nav / status pills / list selection across the admin) |
| container radius | `--r-md` | `--r-md` (= `--radius`; keep) |
| item radius | `--r-sm` | `--r-sm` (keep) |
| focus | (none/ad-hoc) | `--ring` focus-visible ring where an item is keyboard-focusable |

**Polish beyond token swaps:** consistent container padding (e.g. 4–6px), consistent item height +
gap, the soft-primary active state everywhere (not solid indigo), `--accent` hover everywhere,
focus-visible rings, and the lighter unified shadow — so all six menus read as one family.

## Data flow / behavior

None — pure CSS. Every menu keeps its markup, positioning, keyboard nav, and logic. The `.on`/`.sel`
state classes already exist; only their *styling* changes.

## Testing & verification

- **Automated:** the editor tests assert markup/behavior, not computed CSS, so they stay green
  (`editor-screen`, `format-bubble`, slash/menu tests, `image-block-node`). Full gate
  `pnpm typecheck && pnpm test && pnpm build` green.
- **Visual (the done bar):** on `:5173`, exercise each menu — select text (bubble: marks, align,
  turn-into, link), `/` slash menu, drag-handle → block menu, a table (table menu), a link (link
  card), an image (toolbar) — and confirm a consistent, polished popover look: same surface/border/
  shadow/radius, neutral hover, soft-indigo active, readable hints, dark-mode correct. Owner UAT.

## Decomposition (for the plan)

1. Add `--shadow-popover` (light + dark) to tokens.css.
2. Re-skin the **selection bubble** cluster (`.fmt-bubble`/`.fmt-btn`/TurnInto/LinkInput) — live.
3. Re-skin the **slash menu** (`.slash*`) — live.
4. Re-skin **block menu + grip** and **table menu** — live.
5. Re-skin **link card** and **image toolbar** (`.block-props`/`.bp-*`) — live.
6. Full gate + editor-visible UAT.

Built **directly + live** (editor-visible iteration), like C1; per-task review where it adds value.
Validate against the REAL menus on `:5173` (the C1 lesson: don't trust a mock that omits real DOM).
