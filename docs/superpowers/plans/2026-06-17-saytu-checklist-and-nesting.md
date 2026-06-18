# Checklist + List-Wide Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Checklist block (Tiptap TaskList/TaskItem, GFM `- [ ]`/`- [x]` round-trip) and make nesting work for ALL list types (bullet, numbered, checklist, mixed, unlimited depth) by making the core converter recursive.

**Architecture:** All checklist + nesting logic lives in `@setu/core`'s Markdoc converter (Markdoc itself needs no plugin — it already round-trips `- [ ]` and nested lists as plain text/sub-lists, verified byte-clean both directions). The converter's list conversion becomes recursive in both directions; checklist detection is per-list-level (an unordered list whose every item starts with a `[ ]`/`[x]`/`[X]` marker). The admin app registers the MIT `@tiptap/extension-list` TaskList/TaskItem, adds one `BLOCK_TYPES` entry (auto-surfacing in slash menu + bubble List group), teaches the custom Tab handler about task items, and adds Shift-Tab outdent + CSS.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, `@markdoc/markdoc` 0.5.7, Tiptap v3.26.1 (`@tiptap/extension-list` MIT), pnpm workspaces.

**Verified facts (DO NOT re-verify — confirmed by spikes this session):**
- Markdoc round-trips every nesting/marker shape byte-clean & idempotent, both parse→format and the build direction (6-level mixed bullet+checklist confirmed). It does NOT parse `- [ ]` specially — `[ ]` is literal item text.
- `@tiptap/extension-list` v3.26.1 (MIT) exports `TaskList`, `TaskItem`, `ListKit`. Default toggle `Mod-Shift-9`; command `toggleTaskList()`; TaskItem has a `checked` attr and a `nested` option (**default `false`** → content `"paragraph"`; set `nested: true` → content `"paragraph block*"`, required for nested checklists). DOM render: `ul[data-type="taskList"]`, `li[data-type="taskItem"]` with `data-checked="true|false"`, structure `<li><label><input type=checkbox/><span></span></label><div>content</div></li>`.
- `ListItem`/`TaskItem` content `"paragraph block*"` → nested lists are schema-legal. Both ship `Tab → sinkListItem(this.name)` / `Shift-Tab → liftListItem(this.name)`.
- StarterKit does NOT enable task list. Our `extensions/KeyboardShortcuts.ts` currently only handles `listItem` for Tab indent and has no Shift-Tab.
- Markdoc.format normalises ordered-list counters to `1.` for every item (existing byte-fidelity tests already account for this).

**HARD RULE:** Any NEW dependency/API claim beyond the verified facts above must be web-checked before asserting.

---

## File Structure

**Core converter (`packages/core/src/markdoc/`)** — the heart; content-safety lives here:
- `to-tiptap.ts` — add recursive `listToTiptap` + checklist detection/marker-strip helpers; `blockToTiptap` `case 'list'` delegates to it.
- `to-markdoc.ts` — `buildBlock` list branch handles `taskList` + recurses nested lists via a `buildListItem` helper.
- `test/to-tiptap.test.ts`, `test/to-markdoc.test.ts`, `test/roundtrip.examples.test.ts` — checklist + nesting + negatives.

**Admin editor (`apps/saytu-admin/src/editor/`)**:
- `Canvas.tsx` — register `TaskList` + `TaskItem.configure({ nested: true })`.
- `block-types.ts` — one `taskList` BlockType + add to List group.
- `blocks.ts` — `taskList` slash-menu subtitle.
- `extensions/KeyboardShortcuts.ts` — Tab sink + Shift-Tab lift for `listItem` AND `taskItem`.
- `styles/editor.css` — task checkbox layout + nested-list indentation.
- `apps/saytu-admin/package.json` — `+ @tiptap/extension-list`.

**Worktree:** Execute in an isolated worktree off `main` (use `superpowers:using-git-worktrees` / native `EnterWorktree`). Run `pnpm install` and a baseline `pnpm -r test` before Task 1.

---

## Task 1: Core to-tiptap — recursive list reading + checklist detection

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts`
- Test: `packages/core/test/to-tiptap.test.ts`

Reads a Markdoc `list` into Tiptap. Today's `case 'list'` is flat (drops nested sub-lists and never produces task lists). Replace it with a recursive `listToTiptap` that (a) detects a checklist per level (unordered + every item starts with a marker), (b) strips the marker and sets `checked` for task items, (c) recurses into each item's nested lists.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-tiptap.test.ts` (new `describe` block at end of file):

```ts
describe('task lists + nesting (markdocToTiptap)', () => {
  it('maps an all-marker unordered list to a taskList with checked flags', () => {
    const doc = markdocToTiptap('- [ ] todo\n- [x] done\n')
    expect(doc.content[0]).toEqual({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
      ],
    })
  })

  it('reads uppercase [X] as checked', () => {
    const doc = markdocToTiptap('- [X] done\n')
    const item = doc.content[0]!.content![0]!
    expect(item).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('strips the marker but keeps inner marks', () => {
    const doc = markdocToTiptap('- [ ] do the **thing**\n')
    const para = doc.content[0]!.content![0]!.content![0]!
    expect(para.content).toEqual([
      { type: 'text', text: 'do the ' },
      { type: 'text', text: 'thing', marks: [{ type: 'bold' }] },
    ])
  })

  it('keeps a plain bullet list as a bulletList (no false checklist)', () => {
    const doc = markdocToTiptap('- a\n- b\n')
    expect(doc.content[0]!.type).toBe('bulletList')
  })

  it('keeps a partial-marker list as a bulletList with literal marker text preserved', () => {
    const doc = markdocToTiptap('- [ ] a\n- b\n')
    expect(doc.content[0]!.type).toBe('bulletList')
    const firstItemPara = doc.content[0]!.content![0]!.content![0]!
    expect(firstItemPara.content).toEqual([{ type: 'text', text: '[ ] a' }])
  })

  it('preserves a nested bullet list inside a list item', () => {
    const doc = markdocToTiptap('- a\n  - b\n')
    expect(doc.content[0]).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
          ],
        },
      ],
    })
  })

  it('preserves a nested checklist under a bullet (mixed)', () => {
    const doc = markdocToTiptap('- parent\n  - [x] sub\n')
    const outer = doc.content[0]!
    expect(outer.type).toBe('bulletList')
    const nested = outer.content![0]!.content![1]!
    expect(nested).toMatchObject({ type: 'taskList' })
    expect(nested.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('drops an empty marker text node (- [ ] with no text)', () => {
    const doc = markdocToTiptap('- [ ]\n')
    // Markdoc keeps "[ ]" as item text only when followed by a space+content; a bare
    // "- [ ]" has item text "[ ]" with no trailing space → NOT a task marker.
    expect(doc.content[0]!.type).toBe('bulletList')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- to-tiptap`
Expected: FAIL — the task-list cases get `bulletList`/dropped-nesting from the current flat `case 'list'`.

- [ ] **Step 3: Implement recursive `listToTiptap` + helpers**

In `packages/core/src/markdoc/to-tiptap.ts`, add helpers above `blockToTiptap` (after `collectInline`):

```ts
/** GFM task marker at the very start of an item's text: "[ ] ", "[x] ", "[X] ". */
const TASK_RE = /^\[( |x|X)\] /

/** If `item`'s first inline child is a text node beginning with a task marker, the
 *  parsed marker; else null. Only a leading plain-text marker counts (so a list item
 *  starting with bold/link is never a task item). */
function taskMarker(item: MdNode): { checked: boolean } | null {
  const inline = (item.children ?? []).find((c) => c.type === 'inline')
  const first = inline?.children?.[0]
  if (first?.type !== 'text' || typeof first.attributes.content !== 'string') return null
  const m = TASK_RE.exec(first.attributes.content)
  return m ? { checked: m[1] !== ' ' } : null
}

/** A list is a checklist iff it is unordered and EVERY item starts with a marker. */
function isTaskList(node: MdNode): boolean {
  if (node.attributes.ordered) return false
  const items = node.children ?? []
  return items.length > 0 && items.every((it) => taskMarker(it) !== null)
}

/** Remove the leading task marker from already-converted inline content. Drops the
 *  first text node entirely if it becomes empty. */
function stripMarker(inline: TiptapNode[]): TiptapNode[] {
  const [first, ...rest] = inline
  if (first && first.type === 'text' && typeof first.text === 'string') {
    const stripped = first.text.replace(TASK_RE, '')
    return stripped === '' ? rest : [{ ...first, text: stripped }, ...rest]
  }
  return inline
}

/** Markdoc list → Tiptap list, recursively. Checklist detection is per level. Each
 *  item becomes [paragraph, ...nested lists]. */
function listToTiptap(node: MdNode): TiptapNode {
  const task = isTaskList(node)
  const listType = task ? 'taskList' : node.attributes.ordered ? 'orderedList' : 'bulletList'
  return {
    type: listType,
    content: (node.children ?? []).map((item) => {
      const inline = collectInline(item)
      const nested = (item.children ?? []).filter((c) => c.type === 'list').map(listToTiptap)
      const paragraph: TiptapNode = { type: 'paragraph', content: task ? stripMarker(inline) : inline }
      const content = [paragraph, ...nested]
      if (task) return { type: 'taskItem', attrs: { checked: taskMarker(item)!.checked }, content }
      return { type: 'listItem', content }
    }),
  }
}
```

Then replace the existing `case 'list':` block in `blockToTiptap` with:

```ts
    case 'list':
      return listToTiptap(node)
```

(`collectInline` already ignores nested `list` children because `inlineToTiptap` returns `[]` for a `list` node, so it yields only the item's own inline content — the nested lists are collected separately via the `.filter((c) => c.type === 'list')` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- to-tiptap`
Expected: PASS (new task/nesting cases + existing list cases all green).

- [ ] **Step 5: Run typecheck (incl. edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS — `tsc` + `tsc -p tsconfig.edge.json` clean (converter stays Node-free).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/test/to-tiptap.test.ts
git commit -m "feat(core): recursive list read + checklist detection in markdocToTiptap"
```

---

## Task 2: Core to-markdoc — recursive list building + task markers

**Files:**
- Modify: `packages/core/src/markdoc/to-markdoc.ts`
- Test: `packages/core/test/to-markdoc.test.ts`

Writes a Tiptap list to Markdoc. Today's `bulletList`/`orderedList` branch is flat (only the first paragraph; nested lists dropped). Add `taskList`, prefix item markers, and recurse nested lists via a `buildListItem` helper.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-markdoc.test.ts` (new `describe` at end):

```ts
describe('task lists + nesting (tiptapToMarkdoc)', () => {
  const wrap = (node: any) => tiptapToMarkdoc({ type: 'doc', content: [node] })

  it('serializes a taskList with [ ]/[x] markers', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
      ],
    })
    expect(md).toBe('- [ ] todo\n- [x] done\n')
  })

  it('keeps inner marks after the marker', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'do the ' },
          { type: 'text', text: 'thing', marks: [{ type: 'bold' }] },
        ] }] },
      ],
    })
    expect(md).toBe('- [ ] do the **thing**\n')
  })

  it('serializes a nested bullet list inside an item', () => {
    const md = wrap({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
          ],
        },
      ],
    })
    expect(md).toBe('- a\n  - b\n')
  })

  it('serializes a nested checklist under a bullet (mixed)', () => {
    const md = wrap({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] }] }] },
          ],
        },
      ],
    })
    expect(md).toBe('- parent\n  - [x] sub\n')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- to-markdoc`
Expected: FAIL — `taskList` hits the `default` case (empty paragraph); nested lists dropped.

- [ ] **Step 3: Implement `buildListItem` + extend the list branch**

In `packages/core/src/markdoc/to-markdoc.ts`, add a helper above `buildBlock`:

```ts
/** Build a Markdoc `item` from a Tiptap list item. Uses the item's first paragraph
 *  for inline content (prefixed with a task marker when `task`), and recurses into any
 *  nested lists, appending them as block children of the item. */
function buildListItem(item: TiptapNode, task: boolean): InstanceType<typeof N> {
  const children = item.content ?? []
  const firstPara = children.find((c) => c.type === 'paragraph')
  const inlineNodes = buildInline(firstPara?.content ?? [])
  if (task) {
    const checked = (item.attrs as Record<string, unknown> | undefined)?.['checked'] === true
    inlineNodes.unshift(new N('text', { content: checked ? '[x] ' : '[ ] ' }))
  }
  const nested = children
    .filter((c) => c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList')
    .map(buildBlock)
  return new N('item', {}, [new N('inline', {}, inlineNodes), ...nested])
}
```

Then replace the `case 'bulletList': case 'orderedList':` block in `buildBlock` with:

```ts
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const ordered = node.type === 'orderedList'
      return new N(
        'list',
        { ordered, marker: ordered ? '.' : '-' },
        (node.content ?? []).map((item) => buildListItem(item, node.type === 'taskList')),
      )
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- to-markdoc`
Expected: PASS (new task/nesting cases + existing list cases green).

- [ ] **Step 5: Run typecheck (incl. edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-markdoc.ts packages/core/test/to-markdoc.test.ts
git commit -m "feat(core): recursive list write + task markers in tiptapToMarkdoc"
```

---

## Task 3: Core round-trip examples (idempotency + byte-fidelity)

**Files:**
- Modify: `packages/core/test/roundtrip.examples.test.ts`

The centerpiece: prove checklists and nesting survive a full `tiptapToMarkdoc(markdocToTiptap(s))` loop byte-for-byte and idempotently, including the content-safety negatives.

- [ ] **Step 1: Add idempotency samples**

In `packages/core/test/roundtrip.examples.test.ts`, add to the `SAMPLES` object:

```ts
  checklist: `- [ ] todo
- [x] done with **bold**
`,
  nested: `- a
  - b
    - c
`,
  nestedChecklist: `- [ ] parent
  - [x] child
  - [ ] other
`,
  mixedNesting: `- parent
  - [ ] sub task
  - plain sub
`,
```

- [ ] **Step 2: Add byte-fidelity cases**

In the `byte-fidelity round-trip` describe's `cases` array, add:

```ts
    ['checklist', '- [ ] todo\n- [x] done\n'],
    ['checklist with marks', '- [ ] do the **thing**\n'],
    ['nested bullet', '- a\n  - b\n'],
    ['nested checklist', '- [ ] p\n  - [x] c\n'],
    ['mixed bullet>checklist', '- parent\n  - [ ] sub\n'],
    ['mixed checklist>bullet', '- [ ] parent\n  - plain\n'],
```

- [ ] **Step 3: Add an explicit negative test (content preserved, not lost)**

Add a new describe at the end of the file:

```ts
describe('checklist content-safety negatives', () => {
  it('a plain bullet list round-trips unchanged (no checkbox injected)', () => {
    expect(roundtrip('- a\n- b\n')).toBe('- a\n- b\n')
  })

  it('a partial-marker list keeps its literal [ ] text (not silently converted)', () => {
    expect(roundtrip('- [ ] a\n- b\n')).toBe('- [ ] a\n- b\n')
  })

  it('uppercase [X] normalises to lowercase [x] and stays checked', () => {
    expect(roundtrip('- [X] done\n')).toBe('- [x] done\n')
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- roundtrip.examples`
Expected: PASS — every new sample is idempotent and byte-identical; negatives preserve content.

- [ ] **Step 5: Run the whole core suite + typecheck**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — all existing core tests (incl. `roundtrip.property`) stay green; edge guard clean; no new core deps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/test/roundtrip.examples.test.ts
git commit -m "test(core): checklist + nesting round-trip examples and negatives"
```

---

## Task 4: Register TaskList + TaskItem in the editor

**Files:**
- Modify: `apps/saytu-admin/package.json`
- Modify: `apps/saytu-admin/src/editor/Canvas.tsx`
- Test: `apps/saytu-admin/test/task-list.test.ts` (new; admin tests live in `apps/saytu-admin/test/`, jsdom env, setup `./test/setup.ts`)

Add the MIT `@tiptap/extension-list` dependency and register the two nodes. `TaskItem` must be configured `nested: true` so checklists can nest (default is `false`, which forbids nested blocks).

- [ ] **Step 1: Add the dependency**

In `apps/saytu-admin/package.json`, add to `dependencies` (alphabetically near the other `@tiptap/extension-*` entries):

```json
    "@tiptap/extension-list": "^3.26.1",
```

Then install:

Run: `pnpm install`
Expected: lockfile updates; `@tiptap/extension-list` resolves to 3.26.1.

- [ ] **Step 2: Write the failing test**

Create `apps/saytu-admin/test/task-list.test.ts` (mirrors the `Editor`+StarterKit harness used in `test/tab-nav.test.ts`). The behavior to assert: a configured editor can toggle a task list:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'

let editor: Editor
afterEach(() => editor?.destroy())

describe('task list extension', () => {
  it('toggles a task list', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false }), TaskList, TaskItem.configure({ nested: true })],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
    })
    editor.chain().focus().toggleTaskList().run()
    expect(editor.isActive('taskList')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- task-list`
Expected: FAIL until `@tiptap/extension-list` is installed (Step 1) — the import won't resolve. (Once installed it passes immediately; the test mainly guards that the extension/command surface is available for Canvas + block-types.)

- [ ] **Step 4: Register in Canvas**

In `apps/saytu-admin/src/editor/Canvas.tsx`, add the import after the Superscript import (line ~6):

```ts
import { TaskList, TaskItem } from '@tiptap/extension-list'
```

And in the `extensions` array, add after the `Superscript.extend(...)` line:

```ts
      TaskList,
      TaskItem.configure({ nested: true }),
```

- [ ] **Step 5: Run test + build to verify**

Run: `pnpm --filter @setu/admin test -- task-list && pnpm --filter @setu/admin build`
Expected: PASS; build OK (fonts + jiti-free, no bundle errors).

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/package.json apps/saytu-admin/src/editor/Canvas.tsx apps/saytu-admin/test/task-list.test.ts pnpm-lock.yaml
git commit -m "feat(admin): register TaskList + nested TaskItem in the editor"
```

---

## Task 5: Surface Checklist in block-types (slash menu + bubble List group)

**Files:**
- Modify: `apps/saytu-admin/src/editor/block-types.ts`
- Modify: `apps/saytu-admin/src/editor/blocks.ts`
- Test: `apps/saytu-admin/test/turn-into-groups.test.ts` (existing — has a hard-coded List-group shape assertion that MUST be updated), `apps/saytu-admin/test/blocks.test.ts` (existing — slash menu)

One `BLOCK_TYPES` entry feeds both surfaces. Adding it to the List group makes the bubble show Bullet/Numbered/Checklist; the slash menu picks it up via the `BLOCK_TYPES` map (add a subtitle).

- [ ] **Step 1: Update the existing breaking assertion + add new tests**

In `apps/saytu-admin/test/turn-into-groups.test.ts`, the shape test hard-codes the List group. Change `'group:list[bulletList,orderedList]'` to `'group:list[bulletList,orderedList,taskList]'` in the `expect(shape).toEqual([...])` array. Then add a new describe to the same file:

```ts
describe('checklist block type', () => {
  it('exposes a taskList block type with the Mod-Shift-9 shortcut', () => {
    const t = BLOCK_TYPES.find((b) => b.id === 'taskList')
    expect(t).toBeTruthy()
    expect(t!.label).toBe('Checklist')
    expect(t!.keys).toEqual(['Mod', 'Shift', '9'])
  })

  it('adds Checklist as the third item of the List group', () => {
    const list = TURN_INTO_GROUPS.find((e) => e.kind === 'group' && e.id === 'list')
    expect(list && list.kind === 'group' && list.items.map((i) => i.id)).toEqual(['bulletList', 'orderedList', 'taskList'])
  })
})
```

In `apps/saytu-admin/test/blocks.test.ts`, add to the slash-menu titles test (the one asserting `toContain('Divider')`) an assertion that the Checklist entry is present:

```ts
    expect(titles).toContain('Checklist')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/admin test -- turn-into-groups blocks`
Expected: FAIL — no `taskList` entry; List group has two items; no 'Checklist' slash title.

- [ ] **Step 3: Implement**

In `apps/saytu-admin/src/editor/block-types.ts`, add to the `BLOCK_TYPES` array after the `codeBlock` entry:

```ts
  { id: 'taskList', label: 'Checklist', icon: 'check', keys: ['Mod', 'Shift', '9'], isActive: (e) => e.isActive('taskList'), setOn: (c) => c.toggleTaskList() },
```

And change the List group line in `TURN_INTO_GROUPS` to include the third item:

```ts
  { kind: 'group', id: 'list', label: 'List', icon: 'forms', items: [byId('bulletList'), byId('orderedList'), byId('taskList')] },
```

In `apps/saytu-admin/src/editor/blocks.ts`, add to the `SUBTITLES` record:

```ts
  taskList: 'Checklist with checkboxes',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/admin test -- turn-into-groups blocks`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS — `setOn: (c) => c.toggleTaskList()` typechecks (`@tiptap/extension-list` registers the `toggleTaskList` command type via the new dep added in Task 4).

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/src/editor/block-types.ts apps/saytu-admin/src/editor/blocks.ts apps/saytu-admin/test/turn-into-groups.test.ts apps/saytu-admin/test/blocks.test.ts
git commit -m "feat(admin): surface Checklist in slash menu + bubble List group"
```

---

## Task 6: Tab/Shift-Tab indent-outdent for both list kinds

**Files:**
- Modify: `apps/saytu-admin/src/editor/extensions/KeyboardShortcuts.ts`
- Test: `apps/saytu-admin/test/tab-nav.test.ts` (existing — already tests `tabActionFor` with a StarterKit-only `make()` helper)

`tabActionFor` must report `'indent'` for a caret in a `taskItem` as well as a `listItem`, and the Tab/Shift-Tab handlers must sink/lift the ACTIVE item type. The "Tab never escapes the editor body" guarantee stays (Tab always returns true).

- [ ] **Step 1: Write the failing test**

In `apps/saytu-admin/test/tab-nav.test.ts`, add a task-aware editor factory and a test (the existing `make()` only registers StarterKit, which lacks TaskList). Add near the top imports:

```ts
import { TaskList, TaskItem } from '@tiptap/extension-list'

const makeTasks = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false }), TaskList, TaskItem.configure({ nested: true })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'task' }] }] },
  })
```

And inside the `describe('tabActionFor', ...)` block:

```ts
  it('indents (and always consumes) inside a task list', () => {
    editor = makeTasks()
    editor.chain().setTextSelection({ from: 1, to: 5 }).toggleTaskList().run()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('indent')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- tab-nav`
Expected: FAIL — `tabActionFor` returns `'consume'` for a task item (only checks `listItem`).

- [ ] **Step 3: Implement**

In `apps/saytu-admin/src/editor/extensions/KeyboardShortcuts.ts`:

Update `tabActionFor`:

```ts
export function tabActionFor(editor: Editor): 'bubble' | 'indent' | 'consume' {
  if (!editor.state.selection.empty) return 'bubble'
  if (editor.isActive('listItem') || editor.isActive('taskItem')) return 'indent'
  return 'consume'
}
```

Update the `Tab` handler body (sink the active item type) and add `Shift-Tab` (lift the active item type), inside the returned keymap object:

```ts
      Tab: () => {
        const action = tabActionFor(this.editor)
        if (action === 'bubble') requestFocusToolbar()
        else if (action === 'indent') {
          const itemType = this.editor.isActive('taskItem') ? 'taskItem' : 'listItem'
          this.editor.chain().focus().sinkListItem(itemType).run()
        }
        return true
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('taskItem')) return this.editor.chain().focus().liftListItem('taskItem').run()
        if (this.editor.isActive('listItem')) return this.editor.chain().focus().liftListItem('listItem').run()
        return false
      },
```

(Keep the existing `Mod-k`, `Mod-/`, and `Escape` handlers unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/admin test -- tab-nav`
Expected: PASS — `tabActionFor` returns `'indent'` for both item types; existing Tab/escape tests stay green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS — `sinkListItem`/`liftListItem` accept the item-type-name string.

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/src/editor/extensions/KeyboardShortcuts.ts apps/saytu-admin/test/tab-nav.test.ts
git commit -m "feat(admin): Tab/Shift-Tab indent-outdent for task items and list items"
```

---

## Task 7: CSS — task checkbox layout + nested indentation

**Files:**
- Modify: `apps/saytu-admin/src/editor/styles/editor.css`

Style the TaskItem render (`<li data-type="taskItem"><label><input type=checkbox/></label><div>content</div></li>`) so the checkbox sits beside the content with no list marker, and verify nested lists indent sensibly. This is a visual task; verification is manual via `pnpm dev` plus a build check.

- [ ] **Step 1: Add the CSS**

In `apps/saytu-admin/src/editor/styles/editor.css`, after the existing `.saytu-prose li::marker` rule (~line 120), add:

```css
/* ---- Task list (checklist) ---- */
.saytu-prose ul[data-type="taskList"] { list-style: none; padding-left: 4px; margin: 6px 0; }
.saytu-prose ul[data-type="taskList"] li[data-type="taskItem"] { display: flex; align-items: flex-start; gap: 9px; padding: 1px 0; }
.saytu-prose li[data-type="taskItem"] > label { flex-shrink: 0; margin-top: 7px; user-select: none; }
.saytu-prose li[data-type="taskItem"] > label > input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-strong); }
.saytu-prose li[data-type="taskItem"] > div { flex: 1; min-width: 0; }
.saytu-prose li[data-type="taskItem"] > div > p { margin: 0; padding: 0; }
.saytu-prose li[data-type="taskItem"][data-checked="true"] > div { color: var(--text-3); text-decoration: line-through; }
/* nested lists keep their own marker style and indent under the content column */
.saytu-prose li[data-type="taskItem"] ul[data-type="taskList"] { padding-left: 0; }
```

- [ ] **Step 2: Build to verify CSS is valid + bundled**

Run: `pnpm --filter @setu/admin build`
Expected: PASS — no CSS/build errors.

- [ ] **Step 3: Manual visual check**

Run: `pnpm --filter @setu/admin dev` (one clean server; kill any stale ones first).
Verify in the browser:
- `/` → Checklist inserts a task list with a clickable checkbox; clicking toggles done (strike-through).
- Select text → bubble → List ▸ → Checklist (shows ⌘⇧9); converts the block.
- Tab nests a checklist/bullet/numbered item; Shift-Tab outdents; mixed nesting renders indented.
- `Cmd/Ctrl+/` cheat sheet lists the Checklist shortcut.

- [ ] **Step 4: Commit**

```bash
git add apps/saytu-admin/src/editor/styles/editor.css
git commit -m "feat(admin): checklist checkbox styling + nested list layout"
```

---

## Final Verification

- [ ] **Step 1: Full test suite**

Run: `pnpm -r test`
Expected: All green (core round-trip + admin display/keymap/block-types/task-list).

- [ ] **Step 2: Full typecheck (incl. edge guard)**

Run: `pnpm -r typecheck`
Expected: Clean — `tsc` + core `tsconfig.edge.json` (converter Node-free).

- [ ] **Step 3: Admin build**

Run: `pnpm --filter @setu/admin build`
Expected: OK — `@tiptap/extension-list` is the only new dependency; fonts + jiti-free.

- [ ] **Step 4: Dispatch final code reviewer**, then use `superpowers:finishing-a-development-branch` (merge `--no-ff` to local main + push; remove worktree; delete branch), and update `memory/saytu-project.md` with the slice-3 entry (checklist + list-wide nesting; the "Markdoc treats `- [ ]` as literal text so all logic is in our converter" finding; the recursive-list pattern; TaskItem `nested: true` requirement).

---

## Definition of Done (from spec)

- `pnpm -r test` green; `pnpm -r typecheck` clean (incl. edge guard); `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: bubble List ▸ shows Bullet / Numbered / **Checklist** (⌘⇧9); `/` inserts a Checklist; checkbox toggles done; **Tab nests** any list item and **Shift-Tab outdents**; checklists + nested lists survive publish→reopen byte-clean; cheat sheet lists the Checklist shortcut.
- Built test-first via the subagent-driven flow.
