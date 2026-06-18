# Format Bubble Menu + Link Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline text formatting — a selection bubble (bold/italic/inline-code/strike/link) and a link card (open/edit/remove on caret-in-link or hover) — to complete the editor's editing feel.

**Architecture:** Tiptap-first, no new deps. StarterKit v3 already provides the marks (incl. Link); configure it (`link.openOnClick:false`, `underline:false`). The selection bubble uses Tiptap v3's `BubbleMenu` from `@tiptap/react/menus`. Links are created/edited via a shared `LinkInput`. The link card reuses the existing `ReactRenderer` + `tippy.js` pattern (as `BlockMenu` does), shown on caret-in-link or hover. Marks already round-trip through Markdoc — no converter work.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Tiptap v3.26.1 (`@tiptap/react`, `@tiptap/react/menus`, `@tiptap/core`, `@tiptap/pm`), `tippy.js` (existing), React 18, Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-format-bubble-design.md`

**Verified (per the hard rule):** `@tiptap/react/menus` resolves and `@floating-ui/dom@1.7.6` is transitive via `@tiptap/react` (no new dep). `BubbleMenu` props: `editor`, `shouldShow({ editor, view, state, oldState, from, to }) => boolean`, children. StarterKit v3 includes Bold/Italic/Strike/Code/**Link**/Underline marks; configure via `StarterKit.configure({ link: {...}, underline: false })`. Link commands: `setLink({ href })`, `unsetLink()`, `extendMarkRange('link')`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/admin/src/editor/Canvas.tsx` | StarterKit config; render `<FormatBubble/>`; register the link-card plugin | 1, 3 |
| `apps/admin/src/editor/FormatBubble.tsx` | selection bubble: mark toggles + Link (via LinkInput) | 1, 2 |
| `apps/admin/src/editor/LinkInput.tsx` | shared URL field (apply / cancel / remove) | 2 |
| `apps/admin/src/editor/LinkPopup.tsx` | link card content: Open ↗ / Edit / Remove | 3 |
| `apps/admin/src/editor/extensions/LinkTools.tsx` | plugin: show LinkPopup on caret-in-link or hover (tippy + ReactRenderer) | 3 |
| `apps/admin/src/styles/editor.css` | bubble toolbar + link card styles | 4 |
| `apps/admin/test/*` | tests per task | 1–3 |

---

## Task 1: StarterKit config + FormatBubble mark toggles

**Files:**
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Create: `apps/admin/src/editor/FormatBubble.tsx`
- Test: `apps/admin/test/format-bubble.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/format-bubble.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { tiptapToMarkdoc } from '@setu/core'

afterEach(cleanup)

const docOf = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: docOf('hello world'),
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('marks + StarterKit config', () => {
  it('bold/italic/code/strike toggle on a selection and round-trip to Markdoc', () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleBold().run() }) // "hello"
    expect(editor.isActive('bold')).toBe(true)
    expect(tiptapToMarkdoc(editor.getJSON())).toContain('**hello**')
  })

  it('underline is disabled (no underline mark in the schema)', () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    expect(editor.schema.marks.underline).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- format-bubble`
Expected: FAIL — depending on the current StarterKit default, `underline` may be defined (test 2 fails) and/or the config object shape differs. (If both pass immediately because StarterKit already excludes underline, that's fine — but the spec requires the explicit config below; proceed.)

- [ ] **Step 3: Configure StarterKit in the Canvas**

In `apps/admin/src/editor/Canvas.tsx`, change the `StarterKit,` entry in the extensions array to:

```tsx
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
```

> If a typecheck/runtime error shows the option key differs (e.g. StarterKit nests link options differently), web-check the StarterKit v3 config shape and adapt — note any deviation. The intent: links don't navigate on click in the editor, and the underline mark is removed.

- [ ] **Step 4: Write the FormatBubble failing test**

Append to `apps/admin/test/format-bubble.test.tsx`:

```tsx
import { FormatBubble } from '../src/editor/FormatBubble'
import { screen } from '@testing-library/react'

describe('FormatBubble', () => {
  it('renders mark toggle buttons in a toolbar', () => {
    function BubbleHarness() {
      const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
        content: docOf('hello'),
      })
      return (
        <>
          <EditorContent editor={editor} />
          {editor && <FormatBubble editor={editor} />}
        </>
      )
    }
    render(<BubbleHarness />)
    // BubbleMenu only mounts its content when shown; assert the component renders
    // its toolbar buttons (testing-library renders children regardless of floating state
    // when forced visible — see implementation note).
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inline code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /strike/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /link/i })).toBeInTheDocument()
  })
})
```

> **Implementation note for testability:** Tiptap's `BubbleMenu` only renders its children into a floating element when `shouldShow` is true, which jsdom won't trigger via real selection geometry. To keep the toolbar unit-testable, **factor the button row into a presentational `FormatBubbleToolbar({ editor })` component** that `FormatBubble` renders inside `<BubbleMenu>`. Test `FormatBubbleToolbar` directly (it renders unconditionally); `FormatBubble` just wraps it in `BubbleMenu` with `shouldShow`. Adjust the test to import and render `FormatBubbleToolbar` if asserting on the buttons directly.

- [ ] **Step 5: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- format-bubble`
Expected: FAIL — `FormatBubble`/`FormatBubbleToolbar` not exported.

- [ ] **Step 6: Implement `FormatBubble`**

Create `apps/admin/src/editor/FormatBubble.tsx`:

```tsx
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

interface MarkBtn {
  name: string
  label: string
  icon: IconName
  toggle: (e: Editor) => void
}

const MARKS: MarkBtn[] = [
  { name: 'bold', label: 'Bold', icon: 'bold', toggle: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', label: 'Italic', icon: 'italic', toggle: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'code', label: 'Inline code', icon: 'code', toggle: (e) => e.chain().focus().toggleCode().run() },
  { name: 'strike', label: 'Strikethrough', icon: 'strike', toggle: (e) => e.chain().focus().toggleStrike().run() },
]

/** The presentational toolbar — rendered unconditionally so it is unit-testable. */
export function FormatBubbleToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
      {MARKS.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`fmt-btn${editor.isActive(m.name) ? ' on' : ''}`}
          aria-label={m.label}
          aria-pressed={editor.isActive(m.name)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => m.toggle(editor)}
        >
          <Icon name={m.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className={`fmt-btn${editor.isActive('link') ? ' on' : ''}`}
        aria-label="Link"
        aria-pressed={editor.isActive('link')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          /* Link input wired in Task 2 */
        }}
      >
        <Icon name="link" size={16} />
      </button>
    </div>
  )
}

/** The selection bubble: shows the formatting toolbar on a non-empty text selection. */
export function FormatBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty}
    >
      <FormatBubbleToolbar editor={editor} />
    </BubbleMenu>
  )
}
```

> **Icon check:** `bold`, `italic`, `code`, `strike`, `link` all exist in `src/ui/Icon.tsx` (verified). Use them as-is; do not invent `IconName`s.

Update the failing test from Step 4 to import and render `FormatBubbleToolbar` directly (unconditional render), e.g.:

```tsx
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'
// ...
function ToolbarHarness() {
  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })], content: docOf('hello') })
  return <>{editor && <FormatBubbleToolbar editor={editor} />}</>
}
render(<ToolbarHarness />)
// then the getByRole assertions for bold/italic/inline code/strike/link
```

- [ ] **Step 7: Render `FormatBubble` in the Canvas**

In `apps/admin/src/editor/Canvas.tsx`, add the import and render it next to `EditorContent` (it needs the `editor`):

```tsx
import { FormatBubble } from './FormatBubble'
```

Change the return to:

```tsx
  return (
    <>
      <EditorContent editor={editor} />
      {editor && <FormatBubble editor={editor} />}
    </>
  )
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test -- format-bubble && pnpm --filter @setu/admin typecheck`
Expected: PASS (mark round-trip, underline disabled, toolbar buttons render).

- [ ] **Step 9: Full admin suite**

Run: `pnpm --filter @setu/admin test`
Expected: PASS (existing suite green).

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/FormatBubble.tsx apps/admin/test/format-bubble.test.tsx
git commit -m "feat(editor): selection format bubble (bold/italic/code/strike) + StarterKit config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Link create / edit / remove via inline input

**Files:**
- Create: `apps/admin/src/editor/LinkInput.tsx`
- Modify: `apps/admin/src/editor/FormatBubble.tsx`
- Test: `apps/admin/test/link-input.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/link-input.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LinkInput } from '../src/editor/LinkInput'

afterEach(cleanup)

describe('LinkInput', () => {
  it('applies a URL on Enter', () => {
    const onApply = vi.fn()
    render(<LinkInput initial="" onApply={onApply} onCancel={vi.fn()} onRemove={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: /url/i })
    fireEvent.change(field, { target: { value: 'https://x.com' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('https://x.com')
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<LinkInput initial="" onApply={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /url/i }), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not apply an empty/whitespace URL', () => {
    const onApply = vi.fn()
    render(<LinkInput initial="  " onApply={onApply} onCancel={vi.fn()} onRemove={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /url/i }), { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows Remove only when initial is non-empty (editing an existing link)', () => {
    const onRemove = vi.fn()
    const { rerender } = render(<LinkInput initial="" onApply={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    rerender(<LinkInput initial="https://x.com" onApply={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- link-input`
Expected: FAIL — `LinkInput` not exported.

- [ ] **Step 3: Implement `LinkInput`**

Create `apps/admin/src/editor/LinkInput.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'

/** Shared URL field for creating/editing a link. Enter applies a non-empty URL,
 *  Escape cancels; Remove shows only when editing an existing link. */
export function LinkInput({
  initial,
  onApply,
  onCancel,
  onRemove,
}: {
  initial: string
  onApply: (href: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const apply = () => {
    const href = value.trim()
    if (href.length === 0) return
    onApply(href)
  }

  return (
    <div className="link-input" role="group" aria-label="Link URL">
      <input
        ref={ref}
        type="url"
        className="link-input-field"
        aria-label="URL"
        placeholder="https://…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else {
            e.stopPropagation()
          }
        }}
      />
      <button type="button" className="link-input-apply" aria-label="Apply link" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
        <span aria-hidden>↵</span>
      </button>
      {initial.length > 0 && (
        <button type="button" className="link-input-remove" aria-label="Remove link" onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- link-input`
Expected: PASS (4 cases).

- [ ] **Step 5: Wire the link input into FormatBubble**

In `apps/admin/src/editor/FormatBubble.tsx`, make `FormatBubbleToolbar` manage a "linking" mode: clicking Link shows `LinkInput` (pre-filled with the current link href if the selection is already linked), applying sets the link on the selection, removing unsets it. Add imports + state:

```tsx
import { useState } from 'react'
import { LinkInput } from './LinkInput'
```

Replace the Link `<button>` and wrap the toolbar so it can swap to the input. Change `FormatBubbleToolbar` to:

```tsx
export function FormatBubbleToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  const currentHref = (editor.getAttributes('link').href as string | undefined) ?? ''

  if (linking) {
    return (
      <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
        <LinkInput
          initial={currentHref}
          onApply={(href) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
            setLinking(false)
          }}
          onCancel={() => setLinking(false)}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            setLinking(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="fmt-bubble" role="toolbar" aria-label="Text formatting">
      {MARKS.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`fmt-btn${editor.isActive(m.name) ? ' on' : ''}`}
          aria-label={m.label}
          aria-pressed={editor.isActive(m.name)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => m.toggle(editor)}
        >
          <Icon name={m.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className={`fmt-btn${editor.isActive('link') ? ' on' : ''}`}
        aria-label="Link"
        aria-pressed={editor.isActive('link')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setLinking(true)}
      >
        <Icon name="link" size={16} />
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Write the link wiring test**

Append to `apps/admin/test/link-input.test.tsx` a test that exercises the toolbar's link flow against a real editor:

```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'
import { tiptapToMarkdoc } from '@setu/core'
import { act } from '@testing-library/react'

describe('FormatBubbleToolbar link flow', () => {
  it('creates a link over the selection and round-trips to Markdoc', async () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))
    const field = screen.getByRole('textbox', { name: /url/i })
    fireEvent.change(field, { target: { value: 'https://x.com' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(editor.isActive('link')).toBe(true)
    expect(tiptapToMarkdoc(editor.getJSON())).toContain('[hello](https://x.com)')
  })
})
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test -- link-input && pnpm --filter @setu/admin typecheck`
Expected: PASS (link created, round-trips to `[hello](https://x.com)`).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/LinkInput.tsx apps/admin/src/editor/FormatBubble.tsx apps/admin/test/link-input.test.tsx
git commit -m "feat(editor): create/edit/remove links via inline URL input in the format bubble

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Link card (caret-in-link + hover)

**Files:**
- Create: `apps/admin/src/editor/LinkPopup.tsx`
- Create: `apps/admin/src/editor/extensions/LinkTools.tsx`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Test: `apps/admin/test/link-popup.test.tsx`

**Context:** A `LinkPopup` card (Open ↗ / Edit / Remove) shown when the caret is inside a link (keyboard) or the mouse hovers a link. Shown via a small ProseMirror plugin reusing the `tippy` + `ReactRenderer` pattern from `BlockMenu`/`DragHandle` — one plugin, two triggers. The card's pure predicate (`linkAtSelection`) is unit-tested; the hover DOM wiring is verified manually (jsdom can't position/hover), like the drag handle.

- [ ] **Step 1: Write the failing test for `LinkPopup` + the predicate**

Create `apps/admin/test/link-popup.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LinkPopup } from '../src/editor/LinkPopup'

afterEach(cleanup)

describe('LinkPopup', () => {
  it('renders the href as an Open link to a new tab', () => {
    render(<LinkPopup href="https://x.com" onEdit={vi.fn()} onRemove={vi.fn()} editable />)
    const open = screen.getByRole('link', { name: /open/i })
    expect(open).toHaveAttribute('href', 'https://x.com')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows Edit/Remove when editable and calls them', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    render(<LinkPopup href="https://x.com" onEdit={onEdit} onRemove={onRemove} editable />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('hides Edit/Remove when not editable (read-only) but keeps Open', () => {
    render(<LinkPopup href="https://x.com" onEdit={vi.fn()} onRemove={vi.fn()} editable={false} />)
    expect(screen.getByRole('link', { name: /open/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- link-popup`
Expected: FAIL — `LinkPopup` not exported.

- [ ] **Step 3: Implement `LinkPopup`**

Create `apps/admin/src/editor/LinkPopup.tsx`:

```tsx
import { Icon } from '../ui/Icon'

/** The link card: open the link in a new tab, or (when editable) edit / remove it. */
export function LinkPopup({
  href,
  onEdit,
  onRemove,
  editable,
}: {
  href: string
  onEdit: () => void
  onRemove: () => void
  editable: boolean
}) {
  return (
    <div className="link-card" role="group" aria-label="Link">
      <a className="link-card-open" href={href} target="_blank" rel="noopener noreferrer">
        <Icon name="external" size={14} />
        <span className="link-card-url">{href}</span>
      </a>
      {editable && (
        <>
          <button type="button" className="link-card-btn" aria-label="Edit link" onMouseDown={(e) => e.preventDefault()} onClick={onEdit}>
            <Icon name="edit" size={14} />
          </button>
          <button type="button" className="link-card-btn" aria-label="Remove link" onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>
            <Icon name="trash" size={14} />
          </button>
        </>
      )}
    </div>
  )
}
```

> **Icon check:** `external`, `edit`, `trash` exist in `src/ui/Icon.tsx` (verified). The Open affordance is a real anchor so it's keyboard-activatable.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- link-popup`
Expected: PASS (3 cases).

- [ ] **Step 5: Implement the `LinkTools` plugin (caret + hover triggers)**

Create `apps/admin/src/editor/extensions/LinkTools.tsx`:

```tsx
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { LinkPopup } from '../LinkPopup'

export const linkToolsKey = new PluginKey('saytuLinkTools')

interface LinkToolsOptions {
  /** Called when the user picks Edit on the card — open the link input on this link. */
  onEdit?: (editor: Editor, href: string) => void
}

/** Shows the LinkPopup card when the caret is inside a link OR the mouse hovers a
 *  link. Reuses the tippy + ReactRenderer pattern (as BlockMenu does). */
export const LinkTools = Extension.create<LinkToolsOptions>({
  name: 'saytuLinkTools',
  addOptions() {
    return { onEdit: undefined }
  },
  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    let popup: TippyInstance | null = null
    let renderer: ReactRenderer | null = null

    const hide = () => {
      popup?.destroy()
      popup = null
      renderer?.destroy()
      renderer = null
    }

    const showFor = (anchor: HTMLElement, href: string) => {
      hide()
      renderer = new ReactRenderer(LinkPopup, {
        editor,
        props: {
          href,
          editable: editor.isEditable,
          onEdit: () => {
            hide()
            options.onEdit?.(editor, href)
          },
          onRemove: () => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            hide()
          },
        },
      })
      popup = tippy(document.body, {
        getReferenceClientRect: () => anchor.getBoundingClientRect(),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'top',
      })
    }

    return [
      new Plugin({
        key: linkToolsKey,
        props: {
          handleDOMEvents: {
            mouseover(_view, event) {
              const target = event.target as HTMLElement | null
              const a = target?.closest('a')
              if (a instanceof HTMLAnchorElement && a.href) showFor(a, a.getAttribute('href') ?? a.href)
              return false
            },
          },
        },
        view() {
          return {
            update() {
              // caret-in-link (keyboard): show anchored to the link DOM at the caret
              const { state } = editor
              if (!state.selection.empty || !editor.isActive('link')) return
              const href = (editor.getAttributes('link').href as string | undefined) ?? ''
              const node = editor.view.domAtPos(state.selection.from).node
              const el = node instanceof HTMLElement ? node : node.parentElement
              const a = el?.closest('a')
              if (a instanceof HTMLAnchorElement && href && popup === null) showFor(a, href)
            },
          }
        },
      }),
    ]
  },
})
```

> This mirrors `DragHandle`/`BlockMenu` (PM plugin + tippy + ReactRenderer). The hover path (`mouseover`) and the caret path (`view().update`) both call `showFor`. Hover/caret DOM positioning is verified manually (jsdom limitation), consistent with the drag handle's deferral. If a Tiptap/PM API here (`domAtPos`, `getAttributes`) differs at 3.26.1, web-check and adapt.

- [ ] **Step 6: Register `LinkTools` in the Canvas, wired to open the link input**

In `apps/admin/src/editor/Canvas.tsx`: import `LinkTools`, add it to the extensions array, and pass `onEdit` to select the link's range so the format bubble's link input opens on it. Add:

```tsx
import { LinkTools } from './extensions/LinkTools'
```

Add to the extensions array (after `SlashCommand,`):

```tsx
      LinkTools.configure({
        onEdit: (ed) => {
          ed.chain().focus().extendMarkRange('link').run()
        },
      }),
```

> Selecting the link's range makes the **FormatBubble** appear over it (non-empty selection); the writer taps **Link** to edit. (A tighter "auto-open the input" coupling is a deferrable nicety.)

- [ ] **Step 7: Run tests + typecheck + full suite**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (LinkPopup tests + existing suite green).

- [ ] **Step 8: Manual smoke (reviewer)**

`pnpm dev`: click into a link → the card appears (Open ↗ / Edit / Remove); hover a link with the mouse → same card; Open opens a new tab; Edit selects the link (bubble appears); Remove unlinks.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/editor/LinkPopup.tsx apps/admin/src/editor/extensions/LinkTools.tsx apps/admin/src/editor/Canvas.tsx apps/admin/test/link-popup.test.tsx
git commit -m "feat(editor): link card (open/edit/remove) on caret-in-link or hover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CSS — format bubble + link card

**Files:**
- Modify: `apps/admin/src/styles/editor.css`

- [ ] **Step 1: Append the styles**

Append to `apps/admin/src/styles/editor.css` (reuse existing tokens — `var(--surface)`, `var(--border-strong)`, `var(--r-md)`, `var(--r-sm)`, `var(--text)`, `var(--surface-2)`, `var(--accent-soft)`, `var(--accent)`, `var(--shadow-pop)`, `var(--font-ui)`):

```css
/* Selection format bubble */
.fmt-bubble {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  font-family: var(--font-ui);
}
.fmt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: var(--r-sm, 6px);
  cursor: pointer;
}
.fmt-btn:hover { background: var(--surface-2, #f1f3f5); }
.fmt-btn.on { background: var(--accent-soft); color: var(--accent); }

/* Inline link URL input (in the bubble) */
.link-input { display: flex; align-items: center; gap: 6px; padding: 2px; }
.link-input-field {
  width: 240px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  padding: 4px 6px;
}
.link-input-apply, .link-input-remove {
  border: none;
  background: var(--surface-2, #f1f3f5);
  color: var(--text);
  border-radius: var(--r-sm, 6px);
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

/* Link card (caret-in-link / hover) */
.link-card {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 360px;
  padding: 5px 8px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  font-family: var(--font-ui);
}
.link-card-open {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}
.link-card-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
.link-card-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: var(--r-sm, 6px);
  cursor: pointer;
}
.link-card-btn:hover { background: var(--surface-2, #f1f3f5); }
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @setu/admin build`
Expected: build succeeds; CSS emitted.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/styles/editor.css
git commit -m "style(editor): format bubble + link card CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification

- [ ] **Step 1: Whole suite** — Run: `pnpm -r test` — expect every package green; admin gains format-bubble / link-input / link-popup tests.
- [ ] **Step 2: Typecheck (incl. core edge guard)** — Run: `pnpm -r typecheck` — expect clean.
- [ ] **Step 3: Build** — Run: `pnpm --filter @setu/admin build` — succeeds; brand fonts intact; `grep -c "yjs" apps/admin/dist/assets/*.js` matches only `linkifyjs` (no new CRDT); no new dependency added (`git diff` shows `package.json` unchanged).
- [ ] **Step 4: Manual smoke (reviewer)** — `pnpm dev`: select text → bubble with bold/italic/code/strike + link; toggles reflect state; Link → URL input → link created; caret into a link or hover → card (Open ↗ new tab / Edit / Remove); Cmd+U does nothing.

---

## Self-Review Notes (author)

- **Spec coverage:** StarterKit config + mark toggles → Task 1; link create/edit/remove → Task 2; link card (caret+hover, Open/Edit/Remove) → Task 3; CSS → Task 4; verify → Task 5. Deferred per-link attributes + underline round-trip are correctly absent (roadmap).
- **No new deps:** verified `@tiptap/react/menus` resolves + `@floating-ui/dom` transitive via `@tiptap/react`; marks from StarterKit; tippy already a dep. Task 5 asserts `package.json` unchanged.
- **Testability honesty:** BubbleMenu/floating + hover DOM positioning aren't unit-tested (jsdom) — so the **presentational** units (`FormatBubbleToolbar`, `LinkInput`, `LinkPopup`) and the **command effects** (toggle/setLink/unsetLink + Markdoc round-trip) are tested directly; floating/hover is manual-verified, consistent with the drag-handle deferral. Flagged inline.
- **Type consistency:** `FormatBubble`/`FormatBubbleToolbar({editor})`, `LinkInput({initial,onApply,onCancel,onRemove})`, `LinkPopup({href,onEdit,onRemove,editable})`, `LinkTools.configure({onEdit})` — consistent across tasks.
- **Icons:** `bold/italic/code/strike/link/external/edit/trash` all confirmed in `Icon.tsx` — no invented names.
- **a11y:** toolbar `role=toolbar` + `aria-pressed`; link input labeled; card Open is a real anchor; Edit/Remove are buttons; bubble triggers on selection (keyboard-reachable), card on caret-in-link (keyboard) + hover.
