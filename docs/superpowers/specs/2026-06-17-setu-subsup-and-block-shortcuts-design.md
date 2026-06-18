# Design — Subscript/Superscript + surfacing block-type shortcuts (bubble v2 slice 2)

_Date: 2026-06-17 · Status: approved (owner asked for sub/sup + visible block shortcuts; round-trip de-risked by spike)_

## Purpose

Two things the owner asked for during UAT:

1. **Subscript / Superscript** — add the two inline marks (with a Markdoc round-trip so they
   survive publish), surfaced in the format bubble next to Bold/Italic/Code/Strike.
2. **Surface the block-type keyboard shortcuts** — Heading/List/Quote/Code already have working
   StarterKit shortcuts, but they're invisible. Show them in the Turn-into menu rows and the
   keyboard cheat sheet.

## Key context (verified)

- **StarterKit default block shortcuts (confirmed from Tiptap docs):** Paragraph `Mod-Alt-0`;
  Headings `Mod-Alt-1..6`; Bullet list `Mod-Shift-8`; Ordered list `Mod-Shift-7`; Task list
  `Mod-Shift-9` (slice 3); Blockquote `Mod-Shift-b`; Code block `Mod-Alt-c`. They already work —
  we only need to *display* them.
- **Subscript/Superscript:** official `@tiptap/extension-subscript` + `@tiptap/extension-superscript`
  (MIT, on public npm), default shortcuts **Subscript `Mod-,`**, **Superscript `Mod-.`**, marks named
  `subscript`/`superscript`, render `<sub>`/`<sup>`. No native Markdown → needs a Markdoc representation.
- **Round-trip spike (DONE — de-risked the spike-class risk):** Markdoc parses inline
  `{% sub %}x{% /sub %}` correctly. `Markdoc.format` newline-breaks an inline tag BY DEFAULT
  (corrupting the round-trip with softbreaks) **UNLESS** the built `Ast.Node` has `node.inline = true`
  — with that flag, `H{% sub %}2{% /sub %}O e=mc{% sup %}2{% /sup %}` formats and re-parses
  **byte-clean**. So the representation is **inline `{% sub %}` / `{% sup %}` Markdoc tags**, built
  with `inline = true`.
- The converter (`packages/core/src/markdoc/`): `buildInline` wraps marks into Ast nodes
  (to-markdoc); `inlineToTiptap` maps inline nodes → marks (to-tiptap, `default: return []` today —
  so unknown inline tags are dropped; we add `sub`/`sup` handling). Block-level callout tag handling
  is separate (block conversion + passthrough) and unaffected.
- The shortcuts cheat sheet (`ShortcutsDialog`) reads the `SHORTCUTS` registry (`shortcuts.ts`);
  the format-bubble buttons read it via `tipFor`/`ariaFor`. The Turn-into menu reads `BLOCK_TYPES`
  (`block-types.ts`). `formatKeys`/`ariaKeyshortcuts` already render any `keys[]` (numbers/letters/
  punctuation pass through the single-char upper-case branch — `['Mod','Alt','1']` → `⌘⌥1` /
  `Ctrl+Alt+1`; `['Mod',',']` → `⌘,` / `Ctrl+,`).

## Scope

**In:**

1. **Block-type shortcuts as data (single source).** Add `keys: string[]` to each `BlockType`
   (`block-types.ts`): paragraph `[Mod,Alt,0]`, h2 `[Mod,Alt,2]`, h3 `[Mod,Alt,3]`, h4 `[Mod,Alt,4]`,
   bulletList `[Mod,Shift,8]`, orderedList `[Mod,Shift,7]`, blockquote `[Mod,Shift,b]`, codeBlock
   `[Mod,Alt,c]`. (These match the StarterKit bindings; we only display them.)
2. **Show them in the Turn-into menu rows.** Each leaf/item row renders `formatKeys(keys, mac)`
   right-aligned (a menu accelerator). Group rows (Heading/List) show no key (their items do).
3. **Include them in the cheat sheet.** `ShortcutsDialog` composes its list from `SHORTCUTS`
   (marks/links/moves/help) **plus** the `BLOCK_TYPES` entries (a "Turn a block into" section) so
   block shortcuts appear without duplicating the data. `formatKeys` shared.
4. **Subscript & Superscript marks.** Add `@tiptap/extension-subscript` + `@tiptap/extension-superscript`
   to the editor extensions (Canvas). Mark names `subscript`/`superscript`, default `Mod-,` / `Mod-.`.
5. **Markdoc round-trip for sub/sup (`@setu/core`).**
   - **to-markdoc** (`buildInline`): for a `subscript`/`superscript` mark, wrap the text node in
     `const n = new N('tag', {}, [inner], 'sub'|'sup'); n.inline = true` (the `inline` flag is the
     spike's key finding).
   - **to-tiptap** (`inlineToTiptap`): add `case 'tag'` → if `node.tag === 'sub'` recurse with mark
     `{type:'subscript'}`, if `'sup'` with `{type:'superscript'}`; other inline tags keep today's
     behavior. (Block-level tags unaffected.)
   - Round-trip tests (idempotency + byte-fidelity) in the core suite, incl. sub/sup mixed with
     other marks and inside headings/lists.
6. **Bubble buttons.** Add Subscript + Superscript to the format-bubble marks (after Strike): icon
   buttons (`x₂` / `x²` — add `subscript`/`superscript` icons to `Icon.tsx`), reactive `aria-pressed`
   via the existing `useEditorState`, tooltips + `aria-keyshortcuts` from `SHORTCUTS`. Add `subscript`
   `[Mod,,]` and `superscript` `[Mod,.]` to the `SHORTCUTS` registry (group Formatting) so the
   tooltips + cheat sheet pick them up (same path as Bold/Italic).

**Out (deferred):**

- Checklist / task list (slice 3) — `Mod-Shift-9` already noted; not added here.
- Preserving *unknown* inline tags (beyond sub/sup) through the round-trip — pre-existing gap,
  separate content-safety task.
- Underline (still its own roadmap item; sub/sup establishes the inline-tag pattern it can reuse).

## Architecture / components

```
packages/core/src/markdoc/
├── to-markdoc.ts          # MODIFY — buildInline: subscript/superscript → inline {% sub %}/{% sup %} (inline=true)
├── to-tiptap.ts           # MODIFY — inlineToTiptap: case 'tag' sub/sup → subscript/superscript mark
└── test/roundtrip.examples.test.ts (+ to-*.test.ts)  # MODIFY — sub/sup round-trip samples
apps/admin/src/editor/
├── block-types.ts         # MODIFY — add keys[] to each BlockType
├── TurnIntoMenu.tsx       # MODIFY — render formatKeys(keys) on each row
├── shortcuts.ts           # MODIFY — add subscript/superscript entries
├── ShortcutsDialog.tsx    # MODIFY — compose SHORTCUTS + BLOCK_TYPES (block section)
├── FormatBubble.tsx       # MODIFY — add Subscript/Superscript mark buttons
├── Canvas.tsx             # MODIFY — register Subscript + Superscript extensions
└── ../ui/Icon.tsx         # MODIFY — add subscript/superscript icons
apps/admin/package.json  # + @tiptap/extension-subscript, @tiptap/extension-superscript
```

## Error handling / edge cases

- **`Markdoc.format` inline flag:** building sub/sup tags WITHOUT `inline = true` corrupts the
  round-trip (softbreaks) — the build helper must set it; a round-trip test guards this.
- **Mark exclusivity:** subscript and superscript should be mutually exclusive (toggling one clears
  the other) — the official extensions can `excludes` each other; configure so.
- **`Mod-,` / `Mod-.`:** browser/OS rarely bind these in-page; kept as the Tiptap defaults. If a
  platform eats one, the bubble button still works (no hard dependency on the key).
- **Unknown inline tags** other than sub/sup still fall through to today's behavior (dropped) — not
  regressed, noted as a separate task.
- **StarterKit shortcuts are the real bindings;** our `keys[]`/`SHORTCUTS` are display only — a
  registry test asserts they match the documented StarterKit values so they can't silently drift.

## Accessibility

- Sub/sup buttons get `aria-label`, `aria-pressed`, `aria-keyshortcuts`, and tooltips (focus+hover),
  matching the existing mark buttons; they join the toolbar roving (`data-toolbar-item`). The
  Turn-into rows' accelerators are decorative text next to the labelled control. The cheat sheet now
  documents block + sub/sup shortcuts for keyboard discovery.

## Testing (behavior)

- **Core round-trip (the important one):** `H{% sub %}2{% /sub %}O`, `E=mc{% sup %}2{% /sup %}`,
  sub/sup combined with bold/italic, and inside a heading/list — idempotent (2nd pass == 1st) and
  byte-identical where the source is canonical. A guard that building without `inline=true` would
  break it (i.e. assert the formatted output has no spurious newline around the tag).
- **to-tiptap:** `{% sub %}x{% /sub %}` → text with `subscript` mark; `{% sup %}` → `superscript`.
- **block-types:** each `BlockType.keys` matches the documented StarterKit shortcut (table guard).
- **TurnIntoMenu:** a row shows its formatted shortcut (e.g. the Quote row shows `⌘⇧B`/`Ctrl+Shift+B`).
- **ShortcutsDialog:** lists a block shortcut (e.g. "Heading 2") and a sub/sup shortcut.
- **FormatBubble:** Subscript/Superscript buttons present with `aria-keyshortcuts` (`Meta+,` / `Meta+.`)
  and reactive `aria-pressed`.
- Existing suites green; `verbatimModuleSyntax`/`noUncheckedIndexedAccess` clean; **edge guard** still
  passes (the converter changes stay Node-free); admin build OK + jiti-free; the two new deps are the
  only `package.json` change.

## Definition of done

- `pnpm -r test` green (core sub/sup round-trip + admin display/buttons) ; `pnpm -r typecheck` clean
  (incl. edge guard) ; `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: select text → bubble shows Subscript/Superscript buttons (with `⌘,` / `⌘.` tooltips)
  that toggle and survive a publish→reopen round-trip; the Turn-into menu rows show their shortcuts;
  `Cmd/Ctrl+/` cheat sheet lists block + sub/sup shortcuts.
- Built test-first via the subagent-driven flow.

## Note on scope

Two requested features in one slice: a small, low-risk display change (block shortcuts as data →
menu + cheat sheet) and the sub/sup marks whose only real risk — the Markdoc round-trip — is already
de-risked (inline tags with `inline=true`). The inline-tag pattern this establishes is what the
deferred underline will reuse. Checklist remains slice 3.
