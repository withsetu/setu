# Design — Text alignment (paragraphs & headings)

_Date: 2026-06-17 · Status: approved (owner chose L/C/R + format-bubble placement; Markdoc representation de-risked by spike)_

## Purpose

Let writers align **paragraphs and headings** left / center / right. This is the general
block text-align the owner has wanted ("we'll ultimately need text alignment one way or the
other") — **distinct** from the GFM-native table-column alignment already shipped (that lives
in the table separator syntax; this is a per-block attribute).

## The representation decision (the spike-class risk — de-risked)

Markdown has **no native syntax** for block alignment, so we need a Markdoc representation
that round-trips byte-clean. Chosen: a **Markdoc node annotation** `{% align="center" %}`
attached to the block. Verified by spike (do not re-verify):

- **Read:** `Markdoc.parse('Centered {% align="center" %}\n')` → `paragraph { attributes:{align:"center"}, annotations:[{type:'attribute',name:'align',value:'center'}] }`. Headings too: `## Title {% align="right" %}` → `heading { level:2, align:"right" }`. `Markdoc.format` round-trips byte-clean + idempotent.
- **Write:** setting a plain `align` *attribute* on a built node does NOT emit the annotation (Markdoc.format re-emits from `node.annotations`, not `attributes`). So on write we set **`node.annotations = [{ type:'attribute', name:'align', value }]`** → `Markdoc.format` emits `{% align="center" %}`. Confirmed: built paragraph → `"Centered{% align=\"center\" %}\n"`, heading → `"## Title{% align=\"right\" %}\n"`, with inline marks → `"a **b**{% align=\"center\" %}\n"`. Idempotent.
- **Canonical form note:** our writer emits no space before `{%` (`text{% align="center" %}`); a hand-typed source with a space (`text {% align="center" %}`) is also valid and idempotent. Round-trip tests assert the canonical (no-space) form, same convention as ordered-list `1.` / table padding normalization.
- **`left` / null emits NOTHING** — unaligned text stays plain (no `{% align="left" %}` noise). Only `center` / `right` get an annotation.

This is a presentational attribute living in content. The published-site renderer (SSG/SSR)
maps `align` → a class/style at render time — a **separate later concern**, not this increment.
(Round-trip uses `Markdoc.parse`/`format`, which need no schema, so nothing else is required now.)

## Key context (verified)

- **Tiptap `@tiptap/extension-text-align`** (MIT). Config: `types` (e.g. `['heading','paragraph']`), `alignments` (default `['left','center','right','justify']`; we use `['left','center','right']`), `defaultAlignment`. Commands `setTextAlign(value)` / `unsetTextAlign()`; stores a `textAlign` attribute on the configured node types; renders `style="text-align:…"`. Default keyboard shortcuts are bundled by the extension (commonly `Mod-Shift-l/e/r`) — the plan **verifies the exact keys against the installed package** (HARD RULE) before surfacing them. NOT yet a workspace dep (must add). Standalone in v3 (not folded into a kit, unlike list/table) — plan confirms on install.
- **Converter** (`packages/core/src/markdoc/`): `to-markdoc.ts` `buildBlock` builds `heading`/`paragraph` via `new N('heading',{level},[inline])` / `new N('paragraph',{},[inline])`; `to-tiptap.ts` `blockToTiptap` `case 'heading'`/`'paragraph'` use `collectInline`. `MdNode` has an `annotations?` field at runtime (spike-confirmed) though not in the minimal `MdNode` type — the plan adds it to the type.
- **FormatBubble** (`apps/saytu-admin/src/editor/FormatBubble.tsx`): a `MARKS` button array, a `useEditorState` selector for active state, `tipFor`/`ariaFor` from the `SHORTCUTS` registry, toolbar roving (`data-toolbar-item`), and the `TurnIntoMenu`. Alignment buttons slot in as a new group using `editor.isActive({ textAlign: 'center' })` for active state.
- The `alignLeft` / `alignCenter` / `alignRight` icons already exist in `Icon.tsx` (added for tables) — reuse them.

## Scope

**In:**

### A. Core converter (`packages/core/src/markdoc/`)

1. **Types** (`types.ts`): add `annotations?: Array<{ type: string; name: string; value: unknown }>` to `MdNode` (read side) — Markdoc populates it at runtime.
2. **`to-tiptap.ts`** — in `case 'heading'` and `case 'paragraph'`, read `node.attributes.align`; if it's `'center'`/`'right'` (any non-left value), add `textAlign` to the node's `attrs`. Concretely: `attrs: { ...(level for heading), ...(align ? { textAlign: align } : {}) }`. A missing/`left` align adds no `textAlign` (keeps existing output identical for unaligned blocks → existing tests stay green).
3. **`to-markdoc.ts`** — in `buildBlock` for `heading`/`paragraph`, read `node.attrs.textAlign`; if it's `'center'`/`'right'` (not `left`/null/undefined), set `built.annotations = [{ type: 'attribute', name: 'align', value: textAlign }]` on the constructed Markdoc node before returning. Unaligned blocks set no annotation. A small `withAlign(builtNode, tiptapNode)` helper keeps this DRY across the two cases.
4. Round-trip tests (the centerpiece): aligned paragraph + heading; alignment with inline marks; **default-left emits no annotation**; idempotency + byte-fidelity (canonical no-space form); negative (plain paragraph stays annotation-free).

### B. Editor (`apps/saytu-admin/`)

5. **Register** `@tiptap/extension-text-align` in `Canvas.tsx`: `TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] })`.
6. **FormatBubble alignment group** — three icon buttons (`alignLeft`/`alignCenter`/`alignRight`) after the marks (or near Turn-into), each: `aria-pressed` from `editor.isActive({ textAlign: <v> })`, tooltip + `aria-keyshortcuts` from the `SHORTCUTS` registry, `data-toolbar-item` (joins roving). Click: center/right → `setTextAlign(v)`; left → `unsetTextAlign()` (clean default). Add `textAlign` active-state to the `useEditorState` selector.
7. **Shortcuts registry** (`shortcuts.ts`): add `alignLeft`/`alignCenter`/`alignRight` entries (group e.g. `Formatting` or a new `Alignment`) with the verified TextAlign keys, so tooltips + the cheat sheet show them (same path as bold/sub-sup).

**Out (deferred / not exposed):**

- **Justify** — owner chose L/C/R (justify reads poorly on responsive web; YAGNI).
- Alignment on lists / blockquotes / table cells (table-column alignment is the separate shipped mechanism).
- The **render-time** mapping of `align` → class/style on the published site (renderer increment).
- Per-node default-alignment config / RTL (RTL is its own roadmap item).

## Architecture / components

```
packages/core/src/markdoc/
├── types.ts          # MODIFY — add annotations?: [...] to MdNode
├── to-tiptap.ts      # MODIFY — heading/paragraph: align attr → textAlign
├── to-markdoc.ts     # MODIFY — heading/paragraph: textAlign → node.annotations (withAlign helper)
└── test/{to-markdoc,to-tiptap,roundtrip.examples}.test.ts
apps/saytu-admin/src/editor/
├── Canvas.tsx        # MODIFY — register TextAlign (types: heading,paragraph; L/C/R)
├── FormatBubble.tsx  # MODIFY — alignment button group + textAlign active state
├── shortcuts.ts      # MODIFY — align shortcuts (verified keys)
apps/saytu-admin/package.json  # + @tiptap/extension-text-align
```

## Error handling / edge cases

- **Default left → no annotation** (clean output; keeps all existing unaligned-block tests green).
- **Unknown align value** (e.g. an imported `justify`): read maps it to `textAlign:'justify'`; since TextAlign is configured without justify, Tiptap drops/normalizes it on edit, but the round-trip preserves whatever value is present until edited (no content loss). Acceptable; we only *write* values the UI produces (center/right).
- **Annotation on a non-aligned node type** (e.g. an `align` on something we don't handle): ignored gracefully (only heading/paragraph read it).
- **Inline marks + alignment** coexist (annotation trails the inline content) — spike-confirmed.

## Accessibility (standing bar)

- Align buttons get `aria-label`, `aria-pressed`, `aria-keyshortcuts`, tooltips (hover+focus), and join the existing toolbar roving (←/→, Home/End, Esc-to-leave). The cheat sheet documents the align shortcuts for keyboard discovery.

## Testing (behavior)

- **Core (centerpiece):** `Centered {% align="center" %}` ↔ paragraph `textAlign:'center'`; `## T {% align="right" %}` ↔ heading; alignment + bold in one block; **plain paragraph → no annotation** (byte-identical to today); idempotency + byte-fidelity for the canonical no-space form. Edge guard clean; no new core deps.
- **Editor:** the bubble shows three align buttons; clicking Center sets `editor.isActive({textAlign:'center'})`; Left calls `unsetTextAlign`; `aria-pressed` reflects state; a centered heading survives publish→reopen. `@tiptap/extension-text-align` is the only new `package.json` change; build OK; existing suites green.

## Definition of done

- `pnpm -r test` green (core align round-trip + admin bubble) ; `pnpm -r typecheck` clean (incl. edge guard) ; `pnpm --filter @saytu/admin build` OK.
- `pnpm dev`: select text in a paragraph/heading → bubble shows L/C/R; Center/Right align the block (with shortcut), Left clears; alignment survives publish→reopen as `{% align="center" %}`; cheat sheet lists the align shortcuts.
- Built test-first via the subagent-driven flow.

## Note on scope

A focused increment: one Markdoc-representation choice (node annotation, de-risked) wired through
the converter both directions + a TextAlign extension + a bubble button group. The published-site
visual rendering of `align` is intentionally a separate later renderer concern; here we guarantee
alignment is captured in content and round-trips losslessly.
