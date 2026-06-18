# Subscript/Superscript + Block-type Shortcuts (bubble v2 slice 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subscript/superscript marks (with a Markdoc round-trip) to the format bubble, and surface the existing block-type keyboard shortcuts in the Turn-into menu + cheat sheet.

**Architecture:** Block shortcuts become data on `BLOCK_TYPES` (single source) → shown in the menu + composed into the cheat sheet. Sub/sup use the official MIT `@tiptap/extension-subscript`/`superscript`; their content survives publish via inline `{% sub %}`/`{% sup %}` Markdoc tags built with `node.inline = true` (spike-verified byte-clean).

**Tech Stack:** TypeScript (strict), React 18, Tiptap v3 (`^3.26.1`), `@markdoc/markdoc`, Vitest. New deps: `@tiptap/extension-subscript`, `@tiptap/extension-superscript` (both `^3.26.1`, MIT).

**Spec:** `docs/superpowers/specs/2026-06-17-setu-subsup-and-block-shortcuts-design.md`

**Verified (do NOT re-verify):** StarterKit block shortcuts — Paragraph `Mod-Alt-0`, Heading `Mod-Alt-1..6`, Bullet `Mod-Shift-8`, Ordered `Mod-Shift-7`, Blockquote `Mod-Shift-b`, Code block `Mod-Alt-c`. Sub `Mod-,` / Sup `Mod-.`. Markdoc inline tags round-trip byte-clean ONLY when the built `Ast.Node` has `inline = true` (without it, format inserts newlines → softbreak corruption). `formatKeys`/`ariaKeyshortcuts` already render numbers/punctuation via the single-char branch.

---

## Task 1: block-type shortcuts as data + menu + cheat sheet

**Files:** modify `apps/admin/src/editor/block-types.ts`, `TurnIntoMenu.tsx`, `ShortcutsDialog.tsx`; tests `apps/admin/test/block-types.test.ts` (extend), `turn-into.test.tsx` (extend), `shortcuts-dialog.test.tsx` (extend).

- [ ] **Step 1: Write/extend the failing tests**

Add to `apps/admin/test/block-types.test.ts`:

```ts
import { BLOCK_TYPES } from '../src/editor/block-types'

describe('BLOCK_TYPES shortcuts', () => {
  it('carries the documented StarterKit keys', () => {
    const keyOf = (id: string) => BLOCK_TYPES.find((b) => b.id === id)?.keys
    expect(keyOf('paragraph')).toEqual(['Mod', 'Alt', '0'])
    expect(keyOf('h2')).toEqual(['Mod', 'Alt', '2'])
    expect(keyOf('h3')).toEqual(['Mod', 'Alt', '3'])
    expect(keyOf('h4')).toEqual(['Mod', 'Alt', '4'])
    expect(keyOf('bulletList')).toEqual(['Mod', 'Shift', '8'])
    expect(keyOf('orderedList')).toEqual(['Mod', 'Shift', '7'])
    expect(keyOf('blockquote')).toEqual(['Mod', 'Shift', 'b'])
    expect(keyOf('codeBlock')).toEqual(['Mod', 'Alt', 'c'])
  })
})
```

Add to `apps/admin/test/turn-into.test.tsx` (inside the grouped describe) — a row shows its shortcut:

```ts
  it('shows the block shortcut on a row (Quote)', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /turn into/i }))
    // Quote leaf row shows ⌘⇧B (mac) or Ctrl+Shift+B
    const quote = screen.getByRole('menuitemradio', { name: /quote/i })
    expect(quote.textContent).toMatch(/⌘⇧B|Ctrl\+Shift\+B/)
  })
```

Add to `apps/admin/test/shortcuts-dialog.test.tsx`:

```ts
  it('lists block-type shortcuts (Heading 2, Quote)', () => {
    render(<ShortcutsDialog onClose={() => {}} />)
    expect(screen.getByText('Heading 2')).toBeInTheDocument()
    expect(screen.getByText('Quote')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run — verify failures**

Run: `pnpm --filter @setu/admin test -- block-types turn-into shortcuts-dialog`
Expected: FAIL (no `keys` on BlockType; menu rows + dialog don't show block shortcuts).

- [ ] **Step 3: Add `keys` to `BlockType`** (`block-types.ts`)

Add `keys: string[]` to the `BlockType` interface and to every entry:

```ts
export interface BlockType {
  id: string
  label: string
  icon: IconName
  keys: string[]
  isActive: (editor: Editor) => boolean
  setOn: (chain: ChainedCommands) => ChainedCommands
}
```

Set on each entry: paragraph `['Mod','Alt','0']`, h2 `['Mod','Alt','2']`, h3 `['Mod','Alt','3']`, h4 `['Mod','Alt','4']`, bulletList `['Mod','Shift','8']`, orderedList `['Mod','Shift','7']`, blockquote `['Mod','Shift','b']`, codeBlock `['Mod','Alt','c']`.

- [ ] **Step 4: Show the shortcut in Turn-into rows** (`TurnIntoMenu.tsx`)

Import the formatter + detectMac: `import { formatKeys, detectMac } from './shortcuts'`. Compute `const mac = detectMac()` in the component. For **leaf** and **item** rows (NOT group rows), append after the label span:

```tsx
                <span className="ti-keys">{formatKeys(row.type.keys, mac)}</span>
```

(Use the same `Row` rendering; group rows render no `.ti-keys`.)

- [ ] **Step 5: Compose block shortcuts into the cheat sheet** (`ShortcutsDialog.tsx`)

Import `BLOCK_TYPES`: `import { BLOCK_TYPES } from './block-types'`. After the existing `GROUP_ORDER.map(...)` sections, render a "Turn a block into" section listing the block types:

```tsx
        <section className="sc-group">
          <h3 className="sc-group-title">Turn a block into</h3>
          {BLOCK_TYPES.map((b) => (
            <div key={b.id} className="sc-row">
              <span className="sc-label">{b.label}</span>
              <kbd className="sc-keys">{formatKeys(b.keys, mac)}</kbd>
            </div>
          ))}
        </section>
```

- [ ] **Step 6: Run — verify pass + add CSS**

Run: `pnpm --filter @setu/admin test -- block-types turn-into shortcuts-dialog` → PASS.
Append a style for the row accelerator to `apps/admin/src/styles/editor.css`:

```css
.ti-keys { margin-left: auto; padding-left: 16px; font-size: 11.5px; color: var(--text-3, var(--text-2)); }
```
(Ensure `.ti-item` lays out the label then keys; it's already `display:flex; gap:8px`.)

- [ ] **Step 7: Full admin suite + typecheck + commit**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck` → green.

```bash
git add apps/admin/src/editor/block-types.ts apps/admin/src/editor/TurnIntoMenu.tsx apps/admin/src/editor/ShortcutsDialog.tsx apps/admin/src/styles/editor.css apps/admin/test/block-types.test.ts apps/admin/test/turn-into.test.tsx apps/admin/test/shortcuts-dialog.test.tsx
git commit -m "feat(editor): surface block-type shortcuts in the Turn-into menu + cheat sheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: subscript/superscript Markdoc round-trip (`@setu/core`)

**Files:** modify `packages/core/src/markdoc/to-markdoc.ts`, `to-tiptap.ts`; tests `packages/core/test/roundtrip.examples.test.ts` (extend), `to-tiptap.test.ts` (extend).

- [ ] **Step 1: Write the failing round-trip tests**

Add to `packages/core/test/roundtrip.examples.test.ts` byte-fidelity `cases`:

```ts
['subscript', 'H{% sub %}2{% /sub %}O\n'],
['superscript', 'E=mc{% sup %}2{% /sup %}\n'],
['sub + bold', 'a{% sub %}**b**{% /sub %}c\n'],
```

Add to `packages/core/test/to-tiptap.test.ts`:

```ts
import { markdocToTiptap } from '../src/markdoc/to-tiptap'

describe('subscript/superscript inline tags', () => {
  it('maps {% sub %}/{% sup %} to subscript/superscript marks', () => {
    const doc = markdocToTiptap('H{% sub %}2{% /sub %}O e=mc{% sup %}2{% /sup %}\n')
    const text = JSON.stringify(doc)
    expect(text).toContain('"subscript"')
    expect(text).toContain('"superscript"')
  })
})
```

- [ ] **Step 2: Run — verify failures**

Run: `pnpm --filter @setu/core test -- roundtrip to-tiptap`
Expected: FAIL — sub/sup dropped (default `return []`) and byte-fidelity off.

- [ ] **Step 3: to-markdoc — build inline sub/sup tags** (`to-markdoc.ts`, in `buildInline`)

In the marks loop, after the `link` case, add:

```ts
      else if (m.type === 'subscript') {
        const t = new N('tag', {}, [n], 'sub')
        t.inline = true
        n = t
      } else if (m.type === 'superscript') {
        const t = new N('tag', {}, [n], 'sup')
        t.inline = true
        n = t
      }
```

> `t.inline = true` is the spike's key finding — without it `Markdoc.format` newline-breaks the inline tag and the round-trip corrupts with softbreaks.

- [ ] **Step 4: to-tiptap — map sub/sup tags to marks** (`to-tiptap.ts`, in `inlineToTiptap`)

Add a `case 'tag'` before the `default`:

```ts
    case 'tag': {
      if (node.tag === 'sub') return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'subscript' }]))
      if (node.tag === 'sup') return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'superscript' }]))
      return [] // other inline tags: unchanged (pre-existing behavior)
    }
```

> Block-level tags (callout) are handled in the block walk + passthrough — unaffected. `known`/passthrough is block-level, so inline sub/sup tags never trigger it.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @setu/core test -- roundtrip to-tiptap` → PASS (byte-fidelity + mark mapping). Then the full core suite + edge guard: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck` → green (the converter stays Node-free; edge guard passes).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-markdoc.ts packages/core/src/markdoc/to-tiptap.ts packages/core/test/roundtrip.examples.test.ts packages/core/test/to-tiptap.test.ts
git commit -m "feat(core): round-trip subscript/superscript as inline {% sub %}/{% sup %} tags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: sub/sup marks + bubble buttons + registry

**Files:** modify `apps/admin/package.json`, `Canvas.tsx`, `shortcuts.ts`, `FormatBubble.tsx`, `ui/Icon.tsx`; test `apps/admin/test/format-tooltips.test.tsx` (extend) + a round-trip-through-editor guard.

- [ ] **Step 1: Add the deps**

Run: `pnpm --filter @setu/admin add @tiptap/extension-subscript@^3.26.1 @tiptap/extension-superscript@^3.26.1`
(Confirm the resolved version matches the rest of the `@tiptap/*` line.)

- [ ] **Step 2: Register the extensions** (`Canvas.tsx`)

Import and add to the extensions array (after StarterKit; configure mutual exclusion):

```tsx
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
```
```tsx
      Subscript,
      Superscript,
```
(Verify the export shape — these may be default or named exports for v3; check `node_modules/@tiptap/extension-subscript/dist` or its docs. If default-exported, `import Subscript from '...'`.)

- [ ] **Step 3: Add registry entries** (`shortcuts.ts`) — in `SHORTCUTS`, Formatting group, after `strike`:

```ts
  { id: 'subscript', label: 'Subscript', keys: ['Mod', ','], group: 'Formatting' },
  { id: 'superscript', label: 'Superscript', keys: ['Mod', '.'], group: 'Formatting' },
```

- [ ] **Step 4: Add icons** (`ui/Icon.tsx`) — add to the ICONS map (confirm names absent first):

```ts
  subscript: '<path d="M4 6l8 10M12 6l-8 10"/><path d="M20 19h-4l4-4v-1h-4"/>',
  superscript: '<path d="M4 8l8 10M12 8l-8 10"/><path d="M20 9h-4l4-4V4h-4"/>',
```
(These are simple `x`-with-small-digit glyphs; adjust to match the icon set's stroke style. If the set has better sub/sup glyphs, use those — do NOT invent an unused name elsewhere.)

- [ ] **Step 5: Add the bubble buttons** (`FormatBubble.tsx`) — extend the `MARKS` array after `strike`:

```ts
  { name: 'subscript', label: 'Subscript', icon: 'subscript', toggle: (e) => e.chain().focus().toggleSubscript().run() },
  { name: 'superscript', label: 'Superscript', icon: 'superscript', toggle: (e) => e.chain().focus().toggleSuperscript().run() },
```
Add `subscript`/`superscript` to the `useEditorState` selector so `active` tracks them:

```ts
      subscript: e.isActive('subscript'),
      superscript: e.isActive('superscript'),
```
and the fallback object. (The `MARKS.map` already wires tooltips via `tipFor(m.name,...)`/`ariaFor(m.name)` — the registry ids `subscript`/`superscript` match, so the keys show automatically; `data-toolbar-item` already added per mark.)

- [ ] **Step 6: Write/extend the test** (`format-tooltips.test.tsx`) — assert the buttons + their aria-keyshortcuts:

```ts
    expect(screen.getByRole('button', { name: /^subscript$/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+,')
    expect(screen.getByRole('button', { name: /^superscript$/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+.')
```
Add an editor round-trip guard (a real Editor with Subscript/Superscript): apply subscript to a selection → `tiptapToMarkdoc(editor.getJSON())` contains `{% sub %}` → `markdocToTiptap` back has the `subscript` mark. (Mirror the existing editor-schema round-trip test pattern.)

- [ ] **Step 7: Run + typecheck + build + commit**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin build` → green; build jiti-free + fonts intact.

```bash
git add apps/admin/package.json apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/shortcuts.ts apps/admin/src/editor/FormatBubble.tsx apps/admin/src/ui/Icon.tsx apps/admin/test/format-tooltips.test.tsx
git commit -m "feat(editor): subscript/superscript marks + bubble buttons (Mod-, / Mod-.)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1: Whole suite** — `pnpm -r test` — every package green (core sub/sup round-trip + admin display/buttons).
- [ ] **Step 2: Typecheck + edge guard** — `pnpm -r typecheck` — clean (core edge guard passes — converter stays Node-free).
- [ ] **Step 3: Build** — `pnpm --filter @setu/admin build` — OK; only `package.json` dep change is the two `@tiptap/extension-*`; jiti-free; fonts intact.
- [ ] **Step 4: Manual (reviewer)** — `pnpm dev`: select text → bubble shows Subscript/Superscript (tooltips `⌘,`/`⌘.`), toggling applies `<sub>`/`<sup>`; the Turn-into rows show shortcuts (e.g. Quote `⌘⇧B`); `Cmd/Ctrl+/` cheat sheet lists block + sub/sup shortcuts; publish a doc with sub/sup → reopen → marks intact (round-trip).

---

## Self-Review Notes (author)

- **Spec coverage:** block shortcuts as data + menu + cheat sheet → T1; sub/sup round-trip → T2; sub/sup marks + bubble + registry → T3; verify → T4.
- **Single source:** block shortcuts live on `BLOCK_TYPES.keys` (menu + cheat-sheet section both read it); sub/sup shortcuts in `SHORTCUTS` (bubble tooltips + cheat sheet). `formatKeys`/`ariaKeyshortcuts` shared.
- **Round-trip de-risked:** the `inline = true` flag is the load-bearing detail (spike-verified); a byte-fidelity test guards it. Edge guard confirms the converter stays edge-portable.
- **Marks reuse the existing bubble machinery** (MARKS map → tooltips/aria/roving/`useEditorState`), so adding two entries + selector keys is enough; no new wiring.
- **Deps:** two official MIT `@tiptap/extension-*` at the pinned `^3.26.1`. No yjs, no Pro.
- **Type consistency:** `BlockType.keys`, `formatKeys(keys,mac)`, mark names `subscript`/`superscript`, ids match across registry/menu/converter.
- **Honest test scope:** converter round-trip + mark mapping + registry + menu/dialog display + aria are unit/integration tested; the live bubble render stays build+manual (jsdom can't mount BubbleMenu). Verify the sub/sup extension export shape (default vs named) at implementation time.
