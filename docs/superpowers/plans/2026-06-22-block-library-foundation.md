# Block Library Foundation A (Taxonomy + Slash Menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock a canonical 7-category block taxonomy, add `group` + `keywords` to the block contract, and rebuild the slash menu so it scales (grouped when no query, keyword-ranked when typing).

**Architecture:** A pure `@setu/core` taxonomy module (edge-safe enum + labels) feeds a pure admin-side `slashRenderModel(blocks, query)` that produces an ordered row list (headers + selectable items). The `SlashCommand` React component renders that row list and runs keyboard nav over the selectable items only. No packaging/source-merge changes — block discovery stays site-local.

**Tech Stack:** TypeScript, Zod (existing block props), Vitest, Tiptap/ProseMirror `@tiptap/suggestion`, React 19.

## Global Constraints

- **`@setu/core` stays edge-safe** — no Node/DOM/React. The taxonomy module must compile under `packages/core/tsconfig.edge.json`.
- **Backward compatible** — `group` and `keywords` are **optional** on the contract; a block with no `group` falls back to `DEFAULT_BLOCK_CATEGORY` (`'text'`).
- **No packaging changes** — discovery stays `import.meta.glob('../../../../blocks/*/block.ts')`. Core/theme source merge is a later sub-project (Foundation B).
- **Locked category set & order:** `text, media, layout, embed, dynamic, marketing, widget`. Order is the grouped-menu display order. Labels: Text, Media, Layout, Embeds, Dynamic, Marketing, Widgets.
- **Ranking score table (exact):** title==query →100; title startsWith →80; keyword==query →70; title includes →50; keyword includes →40; subtitle includes →20; else 0 (filtered out). Ties broken by original list order (stable).

---

### Task 1: Core taxonomy + contract fields + migrate existing folder blocks

**Files:**
- Create: `packages/core/src/blocks/categories.ts`
- Test: `packages/core/src/blocks/categories.test.ts`
- Modify: `packages/core/src/config/types.ts` (the `BlockEditorMeta` interface)
- Modify: `packages/core/src/index.ts` (re-export the taxonomy)
- Modify: `blocks/callout/block.ts` (`group: 'Blocks'` → `'text'`; add keywords)
- Modify: `blocks/notice/block.ts` (add `group: 'text'` + keywords)

**Interfaces:**
- Produces: `BLOCK_CATEGORIES` (readonly tuple), `type BlockCategory`, `BLOCK_CATEGORY_LABELS: Record<BlockCategory,string>`, `DEFAULT_BLOCK_CATEGORY: BlockCategory` (= `'text'`), `isBlockCategory(v:string): v is BlockCategory`. `BlockEditorMeta` now has `group?: BlockCategory` and `keywords?: string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/blocks/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_LABELS,
  DEFAULT_BLOCK_CATEGORY,
  isBlockCategory,
} from './categories'

describe('block categories', () => {
  it('has exactly the seven canonical categories in display order', () => {
    expect([...BLOCK_CATEGORIES]).toEqual([
      'text', 'media', 'layout', 'embed', 'dynamic', 'marketing', 'widget',
    ])
  })

  it('has a label for every category', () => {
    for (const c of BLOCK_CATEGORIES) {
      expect(BLOCK_CATEGORY_LABELS[c]).toBeTruthy()
    }
  })

  it('defaults to text', () => {
    expect(DEFAULT_BLOCK_CATEGORY).toBe('text')
  })

  it('guards membership', () => {
    expect(isBlockCategory('marketing')).toBe(true)
    expect(isBlockCategory('Blocks')).toBe(false)
    expect(isBlockCategory('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/blocks/categories.test.ts`
Expected: FAIL — cannot find module `./categories`.

- [ ] **Step 3: Create the taxonomy module**

Create `packages/core/src/blocks/categories.ts`:

```ts
/** The canonical block taxonomy. Order is the grouped-menu display order. */
export const BLOCK_CATEGORIES = [
  'text',
  'media',
  'layout',
  'embed',
  'dynamic',
  'marketing',
  'widget',
] as const

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]

/** Human label per category (presentation-agnostic; admin maps the icon). */
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: 'Text',
  media: 'Media',
  layout: 'Layout',
  embed: 'Embeds',
  dynamic: 'Dynamic',
  marketing: 'Marketing',
  widget: 'Widgets',
}

/** Fallback category for a block that declares no group. */
export const DEFAULT_BLOCK_CATEGORY: BlockCategory = 'text'

export function isBlockCategory(v: string): v is BlockCategory {
  return (BLOCK_CATEGORIES as readonly string[]).includes(v)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run src/blocks/categories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the contract fields**

In `packages/core/src/config/types.ts`, add an import at the top of the file (after the existing `import type { ZodTypeAny } from 'zod'`):

```ts
import type { BlockCategory } from '../blocks/categories'
```

Then replace the `BlockEditorMeta` interface with:

```ts
/** Editor-facing metadata for a block (consumed by the slash menu). */
export interface BlockEditorMeta {
  label?: string
  icon?: string
  /** Block category — drives slash-menu grouping. Defaults to 'text'. */
  group?: BlockCategory
  /** Extra search terms / aliases for the slash menu (e.g. ['img','photo']). */
  keywords?: string[]
  /** Selectable variant values for the block (e.g. callout types), shown in the
   *  editor's variant picker. The editor maps each to a theme tone/icon. */
  variants?: string[]
}
```

(Leave the rest of the file unchanged. `BlockDefinition`, `BlockContract`, and `buildRegistry` already spread `editor` verbatim, so the new fields flow through with no other edits.)

- [ ] **Step 6: Re-export the taxonomy from core's entrypoint**

In `packages/core/src/index.ts`, immediately after the line `export { buildRegistry } from './blocks/registry'`, add:

```ts
export type { BlockCategory } from './blocks/categories'
export {
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_LABELS,
  DEFAULT_BLOCK_CATEGORY,
  isBlockCategory,
} from './blocks/categories'
```

- [ ] **Step 7: Migrate the two existing folder blocks**

The type-tighten makes `blocks/callout/block.ts`'s `group: 'Blocks'` a compile error. Fix both blocks.

Replace `blocks/callout/block.ts`'s `editor` object with:

```ts
  editor: {
    label: 'Callout',
    icon: 'info',
    group: 'text',
    keywords: ['note', 'aside', 'admonition'],
    variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
  },
```

Replace `blocks/notice/block.ts`'s `editor` object with:

```ts
  editor: { label: 'Notice', icon: 'info', group: 'text', keywords: ['banner', 'alert'] },
```

- [ ] **Step 8: Whole-repo typecheck (the type-tighten blast radius)**

Run: `pnpm -r typecheck`
Expected: PASS for all packages. (If `apps/admin` or `blocks` fail, an unmigrated `group` value remains — fix it before committing.)

- [ ] **Step 9: Run the core test suite**

Run: `pnpm --filter @setu/core test`
Expected: PASS (existing core tests + the 4 new category tests).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/blocks/categories.ts packages/core/src/blocks/categories.test.ts \
        packages/core/src/config/types.ts packages/core/src/index.ts \
        blocks/callout/block.ts blocks/notice/block.ts
git commit -m "feat(core): block taxonomy (BlockCategory) + group/keywords contract fields"
```

---

### Task 2: `slashRenderModel` pure function + unit tests

**Files:**
- Create: `apps/admin/src/editor/slash-model.ts`
- Test: `apps/admin/test/slash-model.test.ts`

**Interfaces:**
- Consumes: `BlockCategory`, `BLOCK_CATEGORIES`, `BLOCK_CATEGORY_LABELS` from `@setu/core` (Task 1); `IconName` from `../ui/Icon`; `Editor`, `Range` (type-only) from `@tiptap/core`.
- Produces:
  - `interface SlashBlock { title: string; subtitle: string; icon: IconName; group: BlockCategory; keywords: string[]; run: (editor: Editor, range: Range) => void }`
  - `type SlashRow = { kind: 'header'; category: BlockCategory; label: string } | { kind: 'item'; block: SlashBlock; itemIndex: number }`
  - `scoreBlock(block: SlashBlock, q: string): number` (q already lowercased/trimmed)
  - `slashRenderModel(blocks: SlashBlock[], query: string): SlashRow[]`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/slash-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { slashRenderModel, scoreBlock } from '../src/editor/slash-model'
import type { SlashBlock, SlashRow } from '../src/editor/slash-model'

const block = (over: Partial<SlashBlock>): SlashBlock => ({
  title: 'X', subtitle: '', icon: 'sparkle', group: 'text', keywords: [], run: () => {}, ...over,
})

const headings = block({ title: 'Heading 2', group: 'text', keywords: ['heading', 'h2'] })
const image = block({ title: 'Image', subtitle: 'Pick or upload', group: 'media', keywords: ['img', 'photo'] })
const hero = block({ title: 'Hero', group: 'marketing', keywords: ['banner'] })

const ALL = [headings, image, hero]

const items = (rows: SlashRow[]) => rows.filter((r): r is Extract<SlashRow, { kind: 'item' }> => r.kind === 'item')

describe('slashRenderModel — empty query (grouped)', () => {
  const rows = slashRenderModel(ALL, '')

  it('emits a header per non-empty category in canonical order', () => {
    const heads = rows.filter((r) => r.kind === 'header').map((r) => (r as { label: string }).label)
    expect(heads).toEqual(['Text', 'Media', 'Marketing']) // layout/embed/dynamic/widget omitted (empty)
  })

  it('assigns sequential itemIndex skipping headers', () => {
    expect(items(rows).map((r) => r.itemIndex)).toEqual([0, 1, 2])
  })

  it('orders items by category then original order', () => {
    expect(items(rows).map((r) => r.block.title)).toEqual(['Heading 2', 'Image', 'Hero'])
  })
})

describe('slashRenderModel — typing (flat ranked)', () => {
  it('drops headers when a query is present', () => {
    const rows = slashRenderModel(ALL, 'h')
    expect(rows.every((r) => r.kind === 'item')).toBe(true)
  })

  it('ranks keyword-equals above subtitle-contains (/img)', () => {
    const subtitleHit = block({ title: 'Zeta', subtitle: 'an image caption', group: 'text' })
    const rows = slashRenderModel([subtitleHit, image], 'img')
    expect(items(rows).map((r) => r.block.title)).toEqual(['Image', 'Zeta'])
  })

  it('ranks title-startsWith first (/he)', () => {
    const keywordHit = block({ title: 'Zeta', keywords: ['header'] })
    const rows = slashRenderModel([keywordHit, headings], 'he')
    expect(items(rows)[0]!.block.title).toBe('Heading 2')
  })

  it('returns no items when nothing matches', () => {
    expect(items(slashRenderModel(ALL, 'zzz'))).toHaveLength(0)
  })

  it('renumbers itemIndex sequentially in ranked mode', () => {
    const rows = slashRenderModel(ALL, 'a') // matches Image(photo? no)/Hero(banner)/Heading? — at least Hero via 'banner'? no 'a'
    expect(items(rows).map((r) => r.itemIndex)).toEqual(items(rows).map((_, i) => i))
  })
})

describe('scoreBlock score table', () => {
  const b = block({ title: 'callout', subtitle: 'a note block', keywords: ['note'] })
  it('title equals = 100', () => expect(scoreBlock(b, 'callout')).toBe(100))
  it('title startsWith = 80', () => expect(scoreBlock(b, 'call')).toBe(80))
  it('keyword equals = 70', () => expect(scoreBlock(b, 'note')).toBe(70))
  it('title includes = 50', () => expect(scoreBlock(b, 'allou')).toBe(50))
  it('keyword includes = 40', () => expect(scoreBlock(block({ title: 'x', keywords: ['note'] }), 'ot')).toBe(40))
  it('subtitle includes = 20', () => expect(scoreBlock(b, 'block')).toBe(20))
  it('no match = 0', () => expect(scoreBlock(b, 'zzz')).toBe(0))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin exec vitest run test/slash-model.test.ts`
Expected: FAIL — cannot find module `../src/editor/slash-model`.

- [ ] **Step 3: Implement the model**

Create `apps/admin/src/editor/slash-model.ts`:

```ts
import type { Editor, Range } from '@tiptap/core'
import type { IconName } from '../ui/Icon'
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABELS } from '@setu/core'
import type { BlockCategory } from '@setu/core'

/** One insertable block in the slash menu. `run` performs the insertion. */
export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  group: BlockCategory
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

/** A render row: a non-selectable category header, or a selectable item carrying
 *  its sequential keyboard index (`itemIndex`). */
export type SlashRow =
  | { kind: 'header'; category: BlockCategory; label: string }
  | { kind: 'item'; block: SlashBlock; itemIndex: number }

/** Relevance score of a block against an already-lowercased, already-trimmed query.
 *  0 means no match (the block is filtered out). Higher wins. */
export function scoreBlock(block: SlashBlock, q: string): number {
  const title = block.title.toLowerCase()
  const keywords = block.keywords.map((k) => k.toLowerCase())
  if (title === q) return 100
  if (title.startsWith(q)) return 80
  if (keywords.some((k) => k === q)) return 70
  if (title.includes(q)) return 50
  if (keywords.some((k) => k.includes(q))) return 40
  if (block.subtitle.toLowerCase().includes(q)) return 20
  return 0
}

/** Build the slash-menu row list. Empty query → grouped by category in canonical
 *  order (empty categories omitted). Non-empty query → flat list ranked by score,
 *  no headers. `itemIndex` is the selectable-item index for keyboard nav. */
export function slashRenderModel(blocks: SlashBlock[], query: string): SlashRow[] {
  const q = query.trim().toLowerCase()

  if (q === '') {
    const rows: SlashRow[] = []
    let itemIndex = 0
    for (const category of BLOCK_CATEGORIES) {
      const inGroup = blocks.filter((b) => b.group === category)
      if (inGroup.length === 0) continue
      rows.push({ kind: 'header', category, label: BLOCK_CATEGORY_LABELS[category] })
      for (const block of inGroup) rows.push({ kind: 'item', block, itemIndex: itemIndex++ })
    }
    return rows
  }

  return blocks
    .map((block, order) => ({ block, score: scoreBlock(block, q), order }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((s, itemIndex) => ({ kind: 'item', block: s.block, itemIndex }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin exec vitest run test/slash-model.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/slash-model.ts apps/admin/test/slash-model.test.ts
git commit -m "feat(admin): slashRenderModel — grouped/ranked slash-menu model"
```

---

### Task 3: Wire `blocks.ts`, `SlashCommand.tsx`, and group-header CSS

**Files:**
- Modify: `apps/admin/src/editor/blocks.ts` (own `SlashBlock` via slash-model; add group+keywords)
- Modify: `apps/admin/src/editor/extensions/SlashCommand.tsx` (render the model; flatten keyboard nav; ARIA)
- Modify: `apps/admin/src/styles/editor.css` (per-group `.slash-head`)

**Interfaces:**
- Consumes: `SlashBlock`, `SlashRow`, `slashRenderModel` from `../slash-model` / `./slash-model`; `DEFAULT_BLOCK_CATEGORY`, `BlockCategory` from `@setu/core`.
- Produces: `slashBlocks(): SlashBlock[]` (unchanged signature) — every returned block now carries `group` + `keywords`.

This task is wiring; its risky logic (grouping/ranking) is already covered by Task 2. Verification is typecheck + build + existing tests + a manual smoke check.

- [ ] **Step 1: Replace `apps/admin/src/editor/blocks.ts`**

Replace the whole file with (the `SlashBlock` interface moves to `slash-model.ts`; built-ins gain a `group`/`keywords` metadata table; folder blocks map their contract fields):

```ts
import type { Editor, Range } from '@tiptap/core'
import { isIconName } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { DEFAULT_BLOCK_CATEGORY } from '@setu/core'
import type { BlockCategory } from '@setu/core'
import { registry } from '../blocks/registry'
import { BLOCK_TYPES } from './block-types'
import { pickImageAndInsert, imageBlockFromSrc } from './image-insert'
import type { SlashBlock } from './slash-model'

export type { SlashBlock } from './slash-model'

const SUBTITLES: Record<string, string> = {
  paragraph: 'Plain paragraph',
  h2: 'Large section heading',
  h3: 'Medium section heading',
  h4: 'Small section heading',
  bulletList: 'Simple bulleted list',
  orderedList: 'Ordered list',
  blockquote: 'Block quote',
  codeBlock: 'Code block',
  taskList: 'Checklist with checkboxes',
}

// Per built-in block id: its category + extra search aliases.
const BUILTIN_META: Record<string, { group: BlockCategory; keywords: string[] }> = {
  paragraph: { group: 'text', keywords: ['text', 'body', 'p'] },
  h2: { group: 'text', keywords: ['heading', 'title', 'h2'] },
  h3: { group: 'text', keywords: ['heading', 'subheading', 'h3'] },
  h4: { group: 'text', keywords: ['heading', 'h4'] },
  bulletList: { group: 'text', keywords: ['bullets', 'ul', 'unordered'] },
  orderedList: { group: 'text', keywords: ['numbered', 'ol'] },
  blockquote: { group: 'text', keywords: ['quote', 'cite'] },
  codeBlock: { group: 'text', keywords: ['code', 'pre', 'snippet'] },
  taskList: { group: 'text', keywords: ['todo', 'checklist', 'checkbox'] },
}

const BUILTINS: SlashBlock[] = [
  ...BLOCK_TYPES.map((b) => ({
    title: b.label,
    subtitle: SUBTITLES[b.id] ?? b.label,
    icon: b.icon,
    group: BUILTIN_META[b.id]?.group ?? DEFAULT_BLOCK_CATEGORY,
    keywords: BUILTIN_META[b.id]?.keywords ?? [],
    run: (e: Editor, r: Range) => b.setOn(e.chain().focus().deleteRange(r)).run(),
  })),
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'divider', group: 'text', keywords: ['hr', 'rule', 'separator', 'line'], run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Table', subtitle: 'Table with header row', icon: 'table', group: 'layout', keywords: ['grid', 'rows', 'columns'], run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Image', subtitle: 'Pick or upload an image', icon: 'image', group: 'media', keywords: ['img', 'photo', 'picture', 'media'], run: (e, r) => {
    e.chain().focus().deleteRange(r).run()
    const storage = (e.storage as unknown as { imageBlock?: { openPicker?: (onPick: (src: string) => void) => void } }).imageBlock
    if (storage?.openPicker) {
      storage.openPicker((src) => e.chain().focus().insertContent(imageBlockFromSrc(src)).run())
    } else {
      // Fallback: direct upload (no modal wired yet)
      const editor = e as Editor & { storage: { imageBlock?: { onUploading?: (b: boolean) => void; onError?: (m: string) => void } } }
      pickImageAndInsert(editor, (import.meta.env.VITE_SETU_API as string) ?? '', editor.storage.imageBlock ?? {})
    }
  } },
]

const toIconName = (raw: string | undefined): IconName => (raw && isIconName(raw) ? raw : 'sparkle')

/** Insertable blocks = built-ins + every auto-discovered folder block. Each folder block
 *  inserts a node of its tag (today only `callout` has an editor node). */
export function slashBlocks(): SlashBlock[] {
  const fromBlocks: SlashBlock[] = registry.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: toIconName(b.editor?.icon),
    group: b.editor?.group ?? DEFAULT_BLOCK_CATEGORY,
    keywords: b.editor?.keywords ?? [],
    run: (e: Editor, r: Range) => {
      const chain = e.chain().focus().deleteRange(r)
      if (b.tag === 'callout') {
        chain.insertContent({ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
      } else {
        chain.insertContent({ type: 'setuBlock', attrs: { tag: b.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
      }
      chain.run()
    },
  }))
  return [...BUILTINS, ...fromBlocks]
}
```

(Note: `Divider`'s icon changes from `settings` to the existing `divider` glyph — a correctness fix surfaced while categorizing.)

- [ ] **Step 2: Replace the `CommandList` component and `items` config in `apps/admin/src/editor/extensions/SlashCommand.tsx`**

Change the imports near the top — replace the two lines:

```ts
import { slashBlocks } from '../blocks'
import type { SlashBlock } from '../blocks'
```

with:

```ts
import { slashBlocks } from '../blocks'
import type { SlashBlock } from '../slash-model'
import { slashRenderModel } from '../slash-model'
import type { SlashRow } from '../slash-model'
```

Replace the entire `CommandList` component (from `export const CommandList = forwardRef…` through `CommandList.displayName = 'CommandList'`) with:

```tsx
export const CommandList = forwardRef<CommandListHandle, SuggestionProps<SlashBlock>>((props, ref) => {
  const rows = slashRenderModel(props.items, props.query)
  const itemRows = rows.filter((r): r is Extract<SlashRow, { kind: 'item' }> => r.kind === 'item')
  const [selected, setSelected] = useState(0)
  // Reset the highlight whenever the result set changes (filter or query).
  useEffect(() => setSelected(0), [props.items, props.query])

  // Keep the highlighted item scrolled into view as the user arrows through.
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (index: number) => {
    const row = itemRows[index]
    if (row) props.command(row.block)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (itemRows.length === 0) return false
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + itemRows.length - 1) % itemRows.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % itemRows.length)
        return true
      }
      if (event.key === 'Enter') {
        pick(selected)
        return true
      }
      return false
    },
  }))

  return (
    <div className="slash" role="listbox" aria-label="Insert block">
      <div className="slash-list">
        {itemRows.length === 0 && <div className="slash-empty">No blocks</div>}
        {rows.map((row) =>
          row.kind === 'header' ? (
            <div key={`h-${row.category}`} className="slash-head" role="presentation">
              {row.label}
            </div>
          ) : (
            <button
              key={row.block.title}
              ref={(el) => {
                itemRefs.current[row.itemIndex] = el
              }}
              type="button"
              role="option"
              aria-selected={row.itemIndex === selected}
              className={`slash-item${row.itemIndex === selected ? ' sel' : ''}`}
              onMouseEnter={() => setSelected(row.itemIndex)}
              onClick={() => pick(row.itemIndex)}
            >
              <span className="slash-ic"><Icon name={row.block.icon} size={16} /></span>
              <span className="slash-text">
                <span className="slash-label">{row.block.title}</span>
                <span className="slash-desc">{row.block.subtitle}</span>
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  )
})
CommandList.displayName = 'CommandList'
```

Then, in the `Suggestion<SlashBlock>({ … })` config below, replace the `items` function:

```ts
        items: ({ query }) =>
          slashBlocks().filter((b) => b.title.toLowerCase().includes(query.toLowerCase())),
```

with (the component now does grouping/ranking from `props.query`, so pass the full set):

```ts
        items: () => slashBlocks(),
```

(Leave `command`, `render`, and the rest of the Suggestion config unchanged.)

- [ ] **Step 3: Update slash-menu CSS for repeated group headers**

In `apps/admin/src/styles/editor.css`, the `.slash-head` rule currently styles one top label outside the list. Headers now repeat inside `.slash-list`. Replace the existing `.slash-head` rule (line ~79) with:

```css
.slash-head { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-4); padding: 9px 8px 4px; }
.slash-list .slash-head:not(:first-child) { margin-top: 4px; border-top: 1px solid var(--border); padding-top: 9px; }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS. (Catches any mismatch in the SlashBlock import move or the row types.)

- [ ] **Step 5: Run the admin test suite (no regressions)**

Run: `pnpm --filter @setu/admin test`
Expected: PASS — existing tests plus `slash-model` stay green. The slash `run()` handlers are unchanged, so insert behavior is unaffected.

- [ ] **Step 6: Build (verifies the Vite glob + bundling still resolve)**

Run: `pnpm --filter @setu/admin build`
Expected: build completes with no type or import errors.

- [ ] **Step 7: Manual smoke check**

Start the admin dev server (`pnpm dev:fresh` if needed), open the editor, and verify:
1. Type `/` on an empty line → the menu shows **category headers** (Text, then Media, Layout…) with blocks grouped under them; callout + notice appear under **Text**.
2. Arrow Up/Down moves the highlight across groups, skipping headers; Enter inserts the highlighted block.
3. Type `/img` → headers disappear, **Image** is the top result.
4. Type `/he` → **Heading 2/3/4** rank at the top.
5. Type `/zzz` → "No blocks".

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/blocks.ts apps/admin/src/editor/extensions/SlashCommand.tsx apps/admin/src/styles/editor.css
git commit -m "feat(admin): grouped/ranked slash menu with category headers + aliases"
```

---

## Self-Review

**Spec coverage:**
- Locked 7-category enum + labels + default + guard → Task 1 (`categories.ts`). ✅
- `group` typed to `BlockCategory` + `keywords` on `BlockEditorMeta` → Task 1. ✅
- Core re-exports → Task 1 Step 6. ✅
- `SlashBlock` gains `group`/`keywords` → Task 2 (owns the type) + Task 3 (populates). ✅
- Grouped-empty / ranked-typing / scored ranking / alias matching → Task 2 (`slashRenderModel` + `scoreBlock`), tested. ✅
- Flattened keyboard nav + ARIA (listbox/option/presentation) → Task 3 Step 2. ✅
- Per-group header CSS → Task 3 Step 3. ✅
- Migrate callout + notice → Task 1 Step 7 (folded in because the type-tighten requires it to stay green). ✅
- Built-ins categorized (text/headings/lists… = text; Image = media; Table = layout) → Task 3 Step 1. ✅
- Pure `slashRenderModel` unit-testable without a DOM → Task 2. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; test code is concrete with expected pass/fail.

**Type consistency:** `SlashBlock` is defined once in `slash-model.ts` (Task 2) and re-exported from `blocks.ts` (Task 3) so there is a single shape. `slashRenderModel(blocks, query)` and `scoreBlock(block, q)` signatures match between Task 2's definition, its tests, and Task 3's call site. `BlockCategory` / `DEFAULT_BLOCK_CATEGORY` names match between Task 1 (definition/export) and Tasks 2–3 (consumption). `itemIndex` semantics (sequential selectable index) are consistent between model, tests, and the component's keyboard nav.

**Note on task count:** The spec listed callout/notice migration as a separate task; this plan folds it into Task 1 because tightening `group` to `BlockCategory` breaks `blocks/callout/block.ts` (`group: 'Blocks'`) — the migration must land in the same commit to keep `pnpm -r typecheck` green. Net: 3 tasks, each independently green and reviewable.
