# Text Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let writers align paragraphs and headings left / center / right, round-tripping through Markdoc as a node annotation `{% align="center" %}`.

**Architecture:** `@setu/core`'s converter reads a block's `align` attribute → Tiptap `textAlign`, and writes `textAlign` (center/right only) by setting the built Markdoc node's `.annotations` (left/null emits nothing). The admin app registers `@tiptap/extension-text-align` and adds an alignment button group to the format bubble.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, `@markdoc/markdoc` 0.5.7, Tiptap v3.26.1 (`@tiptap/extension-text-align` MIT), pnpm workspaces.

**Verified facts (DO NOT re-verify — spiked this session):**
- `Markdoc.parse('Centered {% align="center" %}\n')` → `paragraph { attributes: { align: 'center' } }`; `## Title {% align="right" %}` → `heading { level:2, align:'right' }`. `Markdoc.format` round-trips byte-clean + idempotent. READ side gets alignment from `node.attributes.align` (a `Record<string, any>`), so no `MdNode` type change is needed.
- WRITE: a plain `align` *attribute* on a built node is NOT emitted by `Markdoc.format`. Setting **`builtNode.annotations = [{ type: 'attribute', name: 'align', value }]`** IS emitted. Spike outputs: built paragraph → `"Centered{% align=\"center\" %}\n"`, heading → `"## Title{% align=\"right\" %}\n"`, with marks → `"a **b**{% align=\"center\" %}\n"`. Idempotent. Our writer emits **no space** before `{%` (canonical form for tests).
- Setting a property on a built Markdoc node is already done in this file: `buildInline` does `tag.inline = true` and typechecks. `built.annotations = [...]` follows the same precedent (if TS flags it, mirror how `.inline` is set / use a minimal local type — do NOT change behavior).
- `@tiptap/extension-text-align` (MIT): `TextAlign.configure({ types: ['heading','paragraph'], alignments: ['left','center','right'] })`; commands `setTextAlign(value)` / `unsetTextAlign()`; stores a `textAlign` attribute; renders `style="text-align:…"`. NOT yet a workspace dep. Default keyboard shortcuts ship with the extension — **verify the exact keys on install** (likely `Mod-Shift-l/e/r`) before putting them in `shortcuts.ts`.
- `alignLeft` / `alignCenter` / `alignRight` icons already exist in `apps/admin/src/ui/Icon.tsx`.
- Converter call sites: `to-tiptap.ts` `blockToTiptap` has `case 'heading': return { type:'heading', attrs:{ level: node.attributes.level }, content: collectInline(node) }` and `case 'paragraph': return { type:'paragraph', content: collectInline(node) }`. `to-markdoc.ts` `buildBlock` has `case 'heading': return new N('heading', { level: attrs['level'] }, [new N('inline', {}, buildInline(node.content))])` and `case 'paragraph': return new N('paragraph', {}, [new N('inline', {}, buildInline(node.content))])`. `formatNative` strips trailing newlines; `tiptapToMarkdoc` joins blocks + adds the final `\n`.
- FormatBubble (`apps/admin/src/editor/FormatBubble.tsx`): `MARKS` button array rendered with `<Icon>` + `Tooltip` + `data-toolbar-item` + `aria-pressed`; a `useEditorState` selector returning `{ bold, italic, … link, from, to }` (with a fallback object); `tipFor(id, fallback)` / `ariaFor(id)` from the `SHORTCUTS` registry; `FormatBubbleToolbar` is exported + unit-testable.
- Edge guard: `pnpm --filter @setu/core typecheck` runs `tsc` + `tsc -p tsconfig.edge.json` — converter must stay Node-free.

**HARD RULE:** Verify the TextAlign shortcut keys + that it's standalone (not a kit) against the installed package in Task 4 before asserting.

---

## File Structure

**Core (`packages/core/src/markdoc/`):**
- `to-tiptap.ts` — heading/paragraph: read `attributes.align` → `attrs.textAlign` (non-left only).
- `to-markdoc.ts` — heading/paragraph: write `attrs.textAlign` (center/right) → `built.annotations` via a `withAlign` helper.
- `test/{to-tiptap,to-markdoc,roundtrip.examples}.test.ts`.

**Admin (`apps/admin/src/editor/`):**
- `Canvas.tsx` — register TextAlign.
- `FormatBubble.tsx` — alignment button group + `textAlign` active state.
- `shortcuts.ts` — align shortcut entries.
- `apps/admin/package.json` — `+ @tiptap/extension-text-align`.

**Worktree:** isolated worktree off `main` (native `EnterWorktree`); `pnpm install` + baseline `pnpm -r test` before Task 1.

---

## Task 1: Core — read block alignment (to-tiptap)

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts`
- Test: `packages/core/test/to-tiptap.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-tiptap.test.ts` (new describe at end):

```ts
describe('text alignment (markdocToTiptap)', () => {
  it('reads an aligned paragraph into a textAlign attr', () => {
    const doc = markdocToTiptap('Centered{% align="center" %}\n')
    expect(doc.content[0]).toEqual({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Centered' }] })
  })

  it('reads an aligned heading', () => {
    const doc = markdocToTiptap('## Title{% align="right" %}\n')
    expect(doc.content[0]).toEqual({ type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [{ type: 'text', text: 'Title' }] })
  })

  it('leaves an unaligned paragraph attr-free (no textAlign)', () => {
    const doc = markdocToTiptap('Plain.\n')
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Plain.' }] })
  })

  it('treats align="left" as the default (no textAlign attr)', () => {
    const doc = markdocToTiptap('L{% align="left" %}\n')
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'L' }] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- to-tiptap`
Expected: FAIL — the aligned cases lack `textAlign`.

- [ ] **Step 3: Implement**

In `packages/core/src/markdoc/to-tiptap.ts`, add a helper above `blockToTiptap`:

```ts
/** Tiptap textAlign attrs for a block, from a Markdoc node's `align` attribute.
 *  `left`/absent → none (default stays clean). */
function alignAttr(node: MdNode): { textAlign: string } | Record<string, never> {
  const a = node.attributes.align
  return a && a !== 'left' ? { textAlign: String(a) } : {}
}
```

Then update the two cases in `blockToTiptap`:

```ts
    case 'heading':
      return { type: 'heading', attrs: { level: node.attributes.level, ...alignAttr(node) }, content: collectInline(node) }
    case 'paragraph':
      return { type: 'paragraph', ...(node.attributes.align && node.attributes.align !== 'left' ? { attrs: alignAttr(node) } : {}), content: collectInline(node) }
```

(Heading always has an `attrs` object — spreading `alignAttr` adds `textAlign` only when aligned, so an unaligned heading stays `{ level }` and existing tests pass. Paragraph gets an `attrs` key ONLY when aligned, so an unaligned paragraph stays `{ type, content }` — existing tests pass.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- to-tiptap`
Expected: PASS (new + existing).

- [ ] **Step 5: Typecheck (edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/test/to-tiptap.test.ts
git commit -m "feat(core): read block align annotation into Tiptap textAlign"
```

---

## Task 2: Core — write block alignment (to-markdoc)

**Files:**
- Modify: `packages/core/src/markdoc/to-markdoc.ts`
- Test: `packages/core/test/to-markdoc.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-markdoc.test.ts` (new describe at end):

```ts
describe('text alignment (tiptapToMarkdoc)', () => {
  const wrap = (node: any) => tiptapToMarkdoc({ type: 'doc', content: [node] })

  it('writes a centered paragraph as a node annotation', () => {
    const md = wrap({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Centered' }] })
    expect(md).toBe('Centered{% align="center" %}\n')
  })

  it('writes a right-aligned heading', () => {
    const md = wrap({ type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [{ type: 'text', text: 'Title' }] })
    expect(md).toBe('## Title{% align="right" %}\n')
  })

  it('keeps alignment annotation after inline marks', () => {
    const md = wrap({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'b', marks: [{ type: 'bold' }] }] })
    expect(md).toBe('a **b**{% align="center" %}\n')
  })

  it('emits NO annotation for left/absent alignment', () => {
    expect(wrap({ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'x' }] })).toBe('x\n')
    expect(wrap({ type: 'paragraph', content: [{ type: 'text', text: 'y' }] })).toBe('y\n')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- to-markdoc`
Expected: FAIL — no annotation emitted (output is `Centered\n` etc.).

- [ ] **Step 3: Implement**

In `packages/core/src/markdoc/to-markdoc.ts`, add a helper above `buildBlock`:

```ts
/** Attach a Markdoc `{% align="…" %}` annotation to a built block node when the Tiptap
 *  node has a center/right textAlign. left/null/undefined → no annotation (clean default).
 *  Returns the same node (mutated), mirroring the `tag.inline = true` pattern in buildInline. */
function withAlign(built: InstanceType<typeof N>, node: TiptapNode): InstanceType<typeof N> {
  const ta = (node.attrs as Record<string, unknown> | undefined)?.['textAlign']
  if (ta === 'center' || ta === 'right') {
    built.annotations = [{ type: 'attribute', name: 'align', value: ta }]
  }
  return built
}
```

Then update the two cases in `buildBlock`:

```ts
    case 'heading':
      return withAlign(new N('heading', { level: attrs['level'] }, [new N('inline', {}, buildInline(node.content))]), node)
    case 'paragraph':
      return withAlign(new N('paragraph', {}, [new N('inline', {}, buildInline(node.content))]), node)
```

(If `tsc` rejects `built.annotations = …` because Markdoc's `Node` type doesn't declare `annotations`, mirror the existing `.inline` write — e.g. assign through a locally-typed reference — without changing runtime behavior. Verify the `inline` precedent compiles the same way first.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- to-markdoc`
Expected: PASS (new + existing).

- [ ] **Step 5: Typecheck (edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-markdoc.ts packages/core/test/to-markdoc.test.ts
git commit -m "feat(core): write Tiptap textAlign as a Markdoc align annotation"
```

---

## Task 3: Core — round-trip examples

**Files:**
- Modify: `packages/core/test/roundtrip.examples.test.ts`

- [ ] **Step 1: Add idempotency SAMPLES**

In the `SAMPLES` object add:

```ts
  alignParagraph: `Centered{% align="center" %}
`,
  alignHeading: `## Title{% align="right" %}
`,
  alignWithMarks: `a **b**{% align="center" %}
`,
```

- [ ] **Step 2: Add byte-fidelity cases**

In the `byte-fidelity round-trip` `cases` array add:

```ts
    ['aligned paragraph', 'Centered{% align="center" %}\n'],
    ['aligned heading', '## Title{% align="right" %}\n'],
    ['align with marks', 'a **b**{% align="center" %}\n'],
```

- [ ] **Step 3: Add a negative (no annotation noise)**

Add a new describe at the end of the file:

```ts
describe('text-align content-safety', () => {
  it('a plain paragraph never gains an align annotation', () => {
    expect(roundtrip('Plain paragraph.\n')).toBe('Plain paragraph.\n')
  })

  it('align="left" normalises away (default, no annotation)', () => {
    expect(roundtrip('L{% align="left" %}\n')).toBe('L\n')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @setu/core test -- roundtrip.examples`
Expected: PASS — aligned samples idempotent + byte-identical to the canonical no-space form; negatives clean. (If a byte-fidelity case mismatches on spacing, the canonical form differs — fix the EXPECTED string to the serializer's actual output; do NOT weaken the converter. `align="left"` normalising to `L\n` is intended.)

- [ ] **Step 5: Full core suite + typecheck**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: green; edge guard clean; no new core deps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/test/roundtrip.examples.test.ts
git commit -m "test(core): text-align round-trip examples + negatives"
```

---

## Task 4: Admin — TextAlign extension + format-bubble alignment group

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Modify: `apps/admin/src/editor/FormatBubble.tsx`
- Modify: `apps/admin/src/editor/shortcuts.ts`
- Test: `apps/admin/test/format-bubble.test.tsx` (or the existing bubble test file — match its path), `apps/admin/test/shortcuts.test.ts`

- [ ] **Step 1: Add dep + install**

Add to `apps/admin/package.json` `dependencies` (alphabetical among `@tiptap/extension-*`):

```json
    "@tiptap/extension-text-align": "3.26.1",
```

(Pin exact to match the Tiptap suite — a `^` previously drifted extension-table to 3.27.0. Use `3.26.1`.)

Run: `cd /Users/mayank/Documents/projects/saytu/.claude/worktrees/<this-worktree> && pnpm install`

- [ ] **Step 2: Verify shortcuts + standalone (HARD RULE)**

```bash
DIR=$(find /Users/mayank/Documents/projects/saytu/node_modules/.pnpm -path '*@tiptap+extension-text-align@3.26.1*/node_modules/@tiptap/extension-text-align/dist' -type d | head -1)
grep -rhoE "Mod-Shift-[a-z]|addKeyboardShortcuts|setTextAlign|unsetTextAlign" "$DIR"/index.js 2>/dev/null | sort -u
```
Note the EXACT shortcut keys printed (e.g. `Mod-Shift-l`, `Mod-Shift-e`, `Mod-Shift-r`). Use those in Step 5. If the extension binds NO shortcuts, add the align entries to `shortcuts.ts` WITHOUT keys (label only) or skip the registry entries — do not invent keys.

- [ ] **Step 3: Register TextAlign in Canvas**

In `apps/admin/src/editor/Canvas.tsx`:
- Import after the table import:
  ```ts
  import { TextAlign } from '@tiptap/extension-text-align'
  ```
- In the `extensions` array (after the table extensions):
  ```ts
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
  ```

- [ ] **Step 4: Write the failing bubble test**

`apps/admin/test/format-bubble.test.tsx` uses an `EditorHarness` whose extensions are `[sk()]` (StarterKit only) — the align buttons need TextAlign registered. Add a TextAlign-aware harness + test (mirror the existing `EditorHarness`/`docOf` helpers + the `@testing-library/react` `render`/`act`/`screen` + `fireEvent` style already imported in the file; import `fireEvent` from `@testing-library/react` if not present):

```ts
import { TextAlign } from '@tiptap/extension-text-align'

function AlignHarness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [sk(), TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] })],
    content: docOf('hello world'),
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('alignment buttons', () => {
  it('aligns the current block and reflects aria-pressed', () => {
    let editor!: Editor
    render(<AlignHarness onReady={(e) => (editor = e)} />)
    act(() => { editor.commands.setTextSelection({ from: 1, to: 6 }) })
    render(<FormatBubbleToolbar editor={editor} />)
    const centerBtn = screen.getByLabelText('Align center')
    act(() => { fireEvent.click(centerBtn) })
    expect(editor.isActive({ textAlign: 'center' })).toBe(true)
    expect(screen.getByLabelText('Align center')).toHaveAttribute('aria-pressed', 'true')
  })
})
```
(Adjust the render/act pattern to match how the existing `marks + StarterKit config` describe in this file drives `FormatBubbleToolbar` — reuse its exact approach so the editor + toolbar wire up consistently.)

- [ ] **Step 5: Implement the bubble alignment group**

In `apps/admin/src/editor/FormatBubble.tsx`:

(a) Add an `ALIGNS` array near `MARKS`:
```ts
interface AlignBtn { id: string; label: string; icon: IconName; apply: (e: Editor) => void }
const ALIGNS: AlignBtn[] = [
  { id: 'alignLeft', label: 'Align left', icon: 'alignLeft', apply: (e) => e.chain().focus().unsetTextAlign().run() },
  { id: 'alignCenter', label: 'Align center', icon: 'alignCenter', apply: (e) => e.chain().focus().setTextAlign('center').run() },
  { id: 'alignRight', label: 'Align right', icon: 'alignRight', apply: (e) => e.chain().focus().setTextAlign('right').run() },
]
```

(b) Extend the `useEditorState` selector (and its fallback object) with alignment state:
```ts
      alignCenter: e.isActive({ textAlign: 'center' }),
      alignRight: e.isActive({ textAlign: 'right' }),
```
(add `alignCenter: false, alignRight: false` to the `?? { … }` fallback too.)

(c) Render the align group after the `MARKS.map(...)` block (before the link button), mirroring the mark-button markup. Left is "pressed" when neither center nor right is active (default = left):
```tsx
      {ALIGNS.map((a) => {
        const pressed = a.id === 'alignCenter' ? active.alignCenter : a.id === 'alignRight' ? active.alignRight : !active.alignCenter && !active.alignRight
        return (
          <Tooltip key={a.id} content={tipFor(a.id, a.label)}>
            <button
              type="button"
              data-toolbar-item
              className={`fmt-btn${pressed ? ' on' : ''}`}
              aria-label={a.label}
              aria-keyshortcuts={ariaFor(a.id)}
              aria-pressed={pressed}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => a.apply(editor)}
            >
              <Icon name={a.icon} size={16} />
            </button>
          </Tooltip>
        )
      })}
```

- [ ] **Step 6: Add align entries to the shortcuts registry**

In `apps/admin/src/editor/shortcuts.ts`, add to `SHORTCUTS` (use the EXACT keys verified in Step 2; example assumes `Mod-Shift-l/e/r`):
```ts
  { id: 'alignLeft', label: 'Align left', keys: ['Mod', 'Shift', 'l'], group: 'Formatting' },
  { id: 'alignCenter', label: 'Align center', keys: ['Mod', 'Shift', 'e'], group: 'Formatting' },
  { id: 'alignRight', label: 'Align right', keys: ['Mod', 'Shift', 'r'], group: 'Formatting' },
```
(If Step 2 showed different keys, use those.) **IMPORTANT:** `apps/admin/test/shortcuts.test.ts` has a test that iterates `SHORTCUTS` asserting every entry has a `label`, **non-empty `keys`**, and a `group` in `['Formatting','Links','Blocks','Help']`. So the align entries MUST use group `'Formatting'` and carry non-empty keys — do NOT add keyless entries. If Step 2 shows the extension binds NO default shortcuts, then either (a) the TextAlign extension is configured/extended to bind `Mod-Shift-l/e/r` ourselves (then register those keys), or (b) omit the align entries from `SHORTCUTS` entirely (the bubble buttons simply won't show a shortcut hint) — but never add an entry with empty keys (it breaks that test). The existing registry test needs no change when the entries have valid keys + the `'Formatting'` group.

- [ ] **Step 7: Verify**

Run:
- `pnpm --filter @setu/admin test` (full suite green incl. the new bubble test; if a registry-count test broke, fix it for the 3 new entries)
- `pnpm --filter @setu/admin typecheck` (clean — `setTextAlign`/`unsetTextAlign` resolve via the dep)
- `pnpm --filter @setu/admin build` (OK)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/package.json apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/FormatBubble.tsx apps/admin/src/editor/shortcuts.ts apps/admin/test/ pnpm-lock.yaml
git commit -m "feat(admin): text-align buttons in the format bubble + TextAlign extension"
```

---

## Final Verification

- [ ] **Step 1:** `pnpm -r test` — all green (core align round-trip + admin bubble).
- [ ] **Step 2:** `pnpm -r typecheck` — clean (incl. core edge guard).
- [ ] **Step 3:** `pnpm --filter @setu/admin build` — OK; `@tiptap/extension-text-align` the only new dep.
- [ ] **Step 4:** Dispatch a final code reviewer; then `superpowers:finishing-a-development-branch` (merge `--no-ff` to local main + **`pnpm install` on main** to sync the new dep + push; remove worktree; delete branch); update `memory/saytu-project.md` with the text-align entry (Markdoc **node-annotation** representation — `built.annotations` on write, `attributes.align` on read, left emits nothing; reuses the align icons; distinct from table-column alignment; render-time mapping deferred) and mark it shipped in `docs/roadmap.md`.

---

## Definition of Done (from spec)

- `pnpm -r test` green; `pnpm -r typecheck` clean (incl. edge guard); `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: select text in a paragraph/heading → bubble shows L/C/R; Center/Right align the block (with shortcut), Left clears; alignment survives publish→reopen as `{% align="center" %}`; cheat sheet lists the align shortcuts.
- Built test-first via the subagent-driven flow.
