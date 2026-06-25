# Contact Block Editor Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `contact` block a dedicated editor node — a live static preview of the form plus a "Form settings" popover — replacing today's generic "Contact form" placeholder.

**Architecture:** A new Tiptap node `contactBlock` (atom; the form has no author-editable body), mirroring the existing `callout` dedicated node. The Markdoc↔Tiptap converters route `{% contact %}` ↔ `contactBlock`. The node-view renders a non-interactive preview derived from the block's Markdoc attributes and edits them via a shadcn Popover. No changes to site rendering, the submission pipeline, or the inbox.

**Tech Stack:** TypeScript (strict), React 19, Tiptap/ProseMirror, shadcn/ui (Popover, Switch, Input, Label, Button), Vitest + @testing-library/react, lucide-react icons.

## Global Constraints

- TS strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`), `isolatedModules`.
- Admin imports UI primitives via the `@/components/ui/*` alias (e.g. `@/components/ui/popover`).
- The block's Markdoc attribute names are FIXED by `blocks/contact/block.ts`: `formId`, `formLabel`, `subject`, `nameRequired`, `subjectRequired`, `messageRequired`, `successMessage`. The node neither adds nor renames attributes.
- Defaults on insert: `subject: false`, `nameRequired: true`, `subjectRequired: false`, `messageRequired: true`, `successMessage: 'Thanks — your message has been sent.'`, `formLabel: 'Contact'`, `formId` generated.
- Required toggles exposed: **Name** and **Subject** only. Email + Message are always required (not exposed).
- `formId` is auto-managed — never shown as a raw editable field; generated once and stable across renames.
- The editor preview must NOT load Turnstile or submit anything (it is static/non-interactive).
- TDD; conventional commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verify with the relevant package's `test` + `typecheck` before completing a task.

---

## Task 1: Pure helpers (preview fields, formId, bool coercion)

**Files:**
- Create: `apps/admin/src/editor/extensions/contact-helpers.ts`
- Create: `apps/admin/test/contact-helpers.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_SUCCESS_MESSAGE: string`
  - `coerceBool(v: unknown, dflt: boolean): boolean`
  - `genFormId(): string`
  - `ensureFormId(mdAttrs: Record<string, unknown>): Record<string, unknown>`
  - `type PreviewField = { name: 'name' | 'email' | 'subject' | 'message'; label: string; type: 'text' | 'email' | 'textarea'; required: boolean }`
  - `contactPreviewFields(mdAttrs: Record<string, unknown>): PreviewField[]`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/admin/test/contact-helpers.test.ts
import { describe, it, expect } from 'vitest'
import {
  coerceBool,
  genFormId,
  ensureFormId,
  contactPreviewFields,
  DEFAULT_SUCCESS_MESSAGE,
} from '../src/editor/extensions/contact-helpers'

describe('coerceBool', () => {
  it('passes through real booleans and coerces Markdoc string booleans', () => {
    expect(coerceBool(true, false)).toBe(true)
    expect(coerceBool(false, true)).toBe(false)
    expect(coerceBool('true', false)).toBe(true)
    expect(coerceBool('false', true)).toBe(false)
  })
  it('falls back to the default for undefined/garbage', () => {
    expect(coerceBool(undefined, true)).toBe(true)
    expect(coerceBool(undefined, false)).toBe(false)
    expect(coerceBool('nonsense', true)).toBe(true)
  })
})

describe('genFormId / ensureFormId', () => {
  it('generates a non-empty contact-prefixed id', () => {
    const id = genFormId()
    expect(id).toMatch(/^contact-[0-9a-f]+$/)
  })
  it('adds a formId when absent, preserves an existing one', () => {
    const added = ensureFormId({ subject: true })
    expect(typeof added.formId).toBe('string')
    expect((added.formId as string).length).toBeGreaterThan(0)
    expect(added.subject).toBe(true)
    const kept = ensureFormId({ formId: 'contact-keepme' })
    expect(kept.formId).toBe('contact-keepme')
  })
})

describe('contactPreviewFields', () => {
  it('omits subject when subject is off; email + message always required', () => {
    const fields = contactPreviewFields({ subject: false, nameRequired: true })
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'message'])
    expect(fields.find((f) => f.name === 'email')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'message')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'name')!.required).toBe(true)
  })
  it('includes subject when on, and reflects per-field required toggles', () => {
    const fields = contactPreviewFields({ subject: true, nameRequired: false, subjectRequired: true })
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'subject', 'message'])
    expect(fields.find((f) => f.name === 'name')!.required).toBe(false)
    expect(fields.find((f) => f.name === 'subject')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'message')!.type).toBe('textarea')
  })
  it('coerces Markdoc string booleans', () => {
    const fields = contactPreviewFields({ subject: 'true', nameRequired: 'false' })
    expect(fields.map((f) => f.name)).toContain('subject')
    expect(fields.find((f) => f.name === 'name')!.required).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- contact-helpers`
Expected: FAIL — module `../src/editor/extensions/contact-helpers` not found.

- [ ] **Step 3: Implement**

```typescript
// apps/admin/src/editor/extensions/contact-helpers.ts
export const DEFAULT_SUCCESS_MESSAGE = 'Thanks — your message has been sent.'

/** Markdoc may deliver booleans as the strings "true"/"false". Normalize. */
export function coerceBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return dflt
}

/** A stable, opaque form id. Authors never see/edit this; it attributes
 *  submissions in the inbox and must survive form-name renames. */
export function genFormId(): string {
  return `contact-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** Return mdAttrs guaranteed to carry a formId (generating one if absent). */
export function ensureFormId(mdAttrs: Record<string, unknown>): Record<string, unknown> {
  const cur = mdAttrs.formId
  if (typeof cur === 'string' && cur !== '') return mdAttrs
  return { ...mdAttrs, formId: genFormId() }
}

export type PreviewField = {
  name: 'name' | 'email' | 'subject' | 'message'
  label: string
  type: 'text' | 'email' | 'textarea'
  required: boolean
}

/** The fields the rendered form will show, derived purely from attributes.
 *  Email + message are always required; subject appears only when enabled. */
export function contactPreviewFields(mdAttrs: Record<string, unknown>): PreviewField[] {
  const subject = coerceBool(mdAttrs.subject, false)
  const nameRequired = coerceBool(mdAttrs.nameRequired, true)
  const subjectRequired = coerceBool(mdAttrs.subjectRequired, false)
  const fields: PreviewField[] = [
    { name: 'name', label: 'Name', type: 'text', required: nameRequired },
    { name: 'email', label: 'Email', type: 'email', required: true },
  ]
  if (subject) fields.push({ name: 'subject', label: 'Subject', type: 'text', required: subjectRequired })
  fields.push({ name: 'message', label: 'Message', type: 'textarea', required: true })
  return fields
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- contact-helpers`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/extensions/contact-helpers.ts apps/admin/test/contact-helpers.test.ts
git commit -m "feat(admin): contact editor helpers (preview fields, formId, bool coercion)"
```

---

## Task 2: Markdoc ↔ Tiptap routing for `contact` ↔ `contactBlock`

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts` (the `case 'tag'` routing, ~line 149)
- Modify: `packages/core/src/markdoc/to-markdoc.ts` (the node `switch`, ~line 93)
- Modify: `packages/core/test/to-tiptap.test.ts`
- Modify: `packages/core/test/to-markdoc.test.ts`

**Interfaces:**
- Consumes: `markdocToTiptap(source, { knownBlockTags })`, `tiptapToMarkdoc(doc)` (existing).
- Produces: a `contactBlock` Tiptap node `{ type: 'contactBlock', attrs: { mdAttrs } }` (no content) ↔ `{% contact %}`.

> Context: `defaultKnownBlockTags` is empty; callers inject the set from the block registry, which already includes `contact` (a folder block). So no registry change is needed — only the converter `case`s. `contact` has no author-editable body, so its node is content-less (atom).

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-tiptap.test.ts` (inside the `describe('markdocToTiptap', ...)`):

```typescript
  it('maps a known contact tag to a contactBlock node (content-less)', () => {
    const doc = markdocToTiptap('{% contact formId="c-1" subject=true %}\n{% /contact %}\n', {
      knownBlockTags: new Set(['contact']),
    })
    const node = doc.content[0]!
    expect(node.type).toBe('contactBlock')
    expect((node.attrs as { mdAttrs: Record<string, unknown> }).mdAttrs).toMatchObject({
      formId: 'c-1',
      subject: true,
    })
    expect(node.content ?? []).toHaveLength(0)
  })
```

Add to `packages/core/test/to-markdoc.test.ts` (inside the `describe('tiptapToMarkdoc', ...)`):

```typescript
  it('serializes a contactBlock back to a {% contact %} tag and round-trips its attrs', () => {
    const md = tiptapToMarkdoc({
      type: 'doc',
      content: [
        {
          type: 'contactBlock',
          attrs: { mdAttrs: { formId: 'c-1', subject: true, successMessage: 'Thanks' } },
        },
      ],
    })
    expect(md).toContain('{% contact')
    const back = markdocToTiptap(md, { knownBlockTags: new Set(['contact']) })
    expect(back.content[0]!.type).toBe('contactBlock')
    expect((back.content[0]!.attrs as { mdAttrs: Record<string, unknown> }).mdAttrs).toMatchObject({
      formId: 'c-1',
      subject: true,
      successMessage: 'Thanks',
    })
  })
```

(Add `import { markdocToTiptap } from '../src/index'` to `to-markdoc.test.ts` if it is not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- to-tiptap to-markdoc`
Expected: FAIL — contact currently maps to `setuBlock`, and there is no `contactBlock` serialization case.

- [ ] **Step 3: Add the parse routing (to-tiptap.ts)**

In `packages/core/src/markdoc/to-tiptap.ts`, in the `case 'tag'` block, add a `contact` branch alongside the existing `callout`/`image` branches (before the `setuBlock` fallback):

```typescript
      if (tag === 'contact') {
        return { type: 'contactBlock', attrs: { mdAttrs: node.attributes } }
      }
```

- [ ] **Step 4: Add the serialize routing (to-markdoc.ts)**

In `packages/core/src/markdoc/to-markdoc.ts`, in the node `switch`, add a `contactBlock` case alongside the existing `callout`/`setuBlock` cases:

```typescript
    case 'contactBlock':
      return new N('tag', (attrs['mdAttrs'] ?? {}) as Record<string, unknown>, [], 'contact')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test -- to-tiptap to-markdoc`
Expected: PASS (both new cases + existing tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/to-tiptap.test.ts packages/core/test/to-markdoc.test.ts
git commit -m "feat(core): route {% contact %} to a contactBlock editor node"
```

---

## Task 3: `ContactBlock` node + node-view (preview + settings popover)

**Files:**
- Create: `apps/admin/src/editor/extensions/ContactBlock.tsx`
- Create: `apps/admin/test/contact-node.test.tsx`

**Interfaces:**
- Consumes: helpers from Task 1; `Node`/`ReactNodeViewRenderer` (Tiptap); `Popover`/`Switch`/`Input`/`Label`/`Button` (shadcn).
- Produces: `export const ContactBlock: Node` (Tiptap node named `contactBlock`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/contact-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ContactBlock } from '../src/editor/extensions/ContactBlock'

afterEach(cleanup)

function Harness({
  mdAttrs,
  onReady,
}: {
  mdAttrs: Record<string, unknown>
  onReady?: (getJSON: () => unknown) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, ContactBlock],
    content: { type: 'doc', content: [{ type: 'contactBlock', attrs: { mdAttrs } }] },
  })
  if (editor && onReady) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('ContactBlock node view', () => {
  it('previews the fields and shows Subject only when enabled', async () => {
    const { rerender } = render(<Harness mdAttrs={{ formId: 'c-1', subject: false }} />)
    expect(await screen.findByText('Message')).toBeTruthy()
    expect(screen.queryByText('Subject')).toBeNull()
    expect(screen.getByText(/spam protection/i)).toBeTruthy()

    cleanup()
    rerender(<Harness mdAttrs={{ formId: 'c-1', subject: true }} />)
    expect(await screen.findByText('Subject')).toBeTruthy()
  })

  it('auto-generates a formId when the block has none', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness mdAttrs={{ subject: false }} onReady={(g) => (getJSON = g)} />)
    // Let the mount effect run + persist the generated id.
    await screen.findByText('Message')
    const json = getJSON() as {
      content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }>
    }
    const node = json.content.find((n) => n.type === 'contactBlock')
    expect(typeof node?.attrs?.mdAttrs?.formId).toBe('string')
    expect((node?.attrs?.mdAttrs?.formId as string).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- contact-node`
Expected: FAIL — module `ContactBlock` not found.

- [ ] **Step 3: Implement the node + view**

```tsx
// apps/admin/src/editor/extensions/ContactBlock.tsx
import { useEffect } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Settings } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_SUCCESS_MESSAGE,
  coerceBool,
  contactPreviewFields,
  ensureFormId,
} from './contact-helpers'

function ContactView({ node, updateAttributes }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>

  // Back-compat / insert safety: persist a stable formId if missing.
  useEffect(() => {
    const id = mdAttrs.formId
    if (typeof id !== 'string' || id === '') updateAttributes({ mdAttrs: ensureFormId(mdAttrs) })
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setAttrs = (patch: Record<string, unknown>) =>
    updateAttributes({ mdAttrs: { ...mdAttrs, ...patch } })

  const formLabel = String(mdAttrs.formLabel ?? '')
  const subject = coerceBool(mdAttrs.subject, false)
  const nameRequired = coerceBool(mdAttrs.nameRequired, true)
  const subjectRequired = coerceBool(mdAttrs.subjectRequired, false)
  const successMessage = String(mdAttrs.successMessage ?? DEFAULT_SUCCESS_MESSAGE)
  const fields = contactPreviewFields(mdAttrs)

  return (
    <NodeViewWrapper>
      <div
        className="setu-contact-block rounded-lg border bg-card p-4"
        data-contact
        contentEditable={false}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contact form{formLabel ? ` · ${formLabel}` : ''}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Form settings">
                <Settings className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cf-name">Form name</Label>
                <Input
                  id="cf-name"
                  value={formLabel}
                  placeholder="Contact"
                  onChange={(e) => setAttrs({ formLabel: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="cf-subject">Subject field</Label>
                <Switch
                  id="cf-subject"
                  checked={subject}
                  onCheckedChange={(v) => setAttrs({ subject: v })}
                />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Required
                </span>
                <div className="flex items-center justify-between text-sm">
                  <span>Email</span>
                  <span className="text-muted-foreground">Always</span>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="cf-name-req">Name</Label>
                  <Switch
                    id="cf-name-req"
                    checked={nameRequired}
                    onCheckedChange={(v) => setAttrs({ nameRequired: v })}
                  />
                </div>
                {subject && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="cf-subject-req">Subject</Label>
                    <Switch
                      id="cf-subject-req"
                      checked={subjectRequired}
                      onCheckedChange={(v) => setAttrs({ subjectRequired: v })}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span>Message</span>
                  <span className="text-muted-foreground">Always</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cf-success">Success message</Label>
                <Input
                  id="cf-success"
                  value={successMessage}
                  onChange={(e) => setAttrs({ successMessage: e.target.value })}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Static, non-interactive preview of the rendered form. */}
        <div className="grid max-w-md gap-3">
          {fields.map((f) => (
            <div key={f.name} className="grid gap-1">
              <label className="text-sm font-medium">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  disabled
                  rows={3}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
                />
              ) : (
                <input
                  disabled
                  type={f.type}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
          <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Spam protection (Cloudflare Turnstile)
          </div>
          <button
            type="button"
            disabled
            className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-70"
          >
            Send
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** Dedicated editor node for the `{% contact %}` block. Content-less (atom) —
 *  the form has no author-editable body. `mdAttrs` is the block's Markdoc
 *  attribute bag (kept out of the DOM), round-tripped by the converters. */
export const ContactBlock = Node.create({
  name: 'contactBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-contact]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-contact': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContactView)
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test -- contact-node`
Expected: PASS. (If the preview field labels collide with the popover `<Label>`s in a query, the test scopes by visible text "Message"/"Subject" in the preview, which renders regardless of popover state — popover content is closed by default, so its labels are not in the DOM until opened.)

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @setu/admin typecheck`

```bash
git add apps/admin/src/editor/extensions/ContactBlock.tsx apps/admin/test/contact-node.test.tsx
git commit -m "feat(admin): ContactBlock editor node — live preview + settings popover"
```

---

## Task 4: Wire the node into the editor (canvas + slash insert) + UAT

**Files:**
- Modify: `apps/admin/src/editor/Canvas.tsx` (extensions array, ~line 114)
- Modify: `apps/admin/src/editor/blocks.ts` (insertion branch, ~line 75)

**Interfaces:**
- Consumes: `ContactBlock` (Task 3), `ensureFormId` + `DEFAULT_SUCCESS_MESSAGE` (Task 1), the `contactBlock` converter routing (Task 2).

> No `registry.knownBlockTags` change: `contact` is a folder block already present in the injected set (the converter routing from Task 2 is what was missing). The round-trip is exercised by the UAT below.

- [ ] **Step 1: Register the node in the canvas**

In `apps/admin/src/editor/Canvas.tsx`, add the import near the other extension imports:

```typescript
import { ContactBlock } from './extensions/ContactBlock'
```

and add `ContactBlock` to the `extensions` array, immediately after `Callout`:

```typescript
    Callout,
    ContactBlock,
    createSetuBlock(registry.blocks, blockCores),
```

- [ ] **Step 2: Insert a `contactBlock` (not a generic `setuBlock`) from the slash menu**

In `apps/admin/src/editor/blocks.ts`, add a `contact` branch to the insertion `run` (alongside the existing `callout` branch). First add the import at the top:

```typescript
import { ensureFormId, DEFAULT_SUCCESS_MESSAGE } from './extensions/contact-helpers'
```

Then in the `run` function, before the generic `else`:

```typescript
      if (b.tag === 'contact') {
        chain.insertContent({
          type: 'contactBlock',
          attrs: {
            mdAttrs: ensureFormId({
              formLabel: 'Contact',
              subject: false,
              nameRequired: true,
              subjectRequired: false,
              messageRequired: true,
              successMessage: DEFAULT_SUCCESS_MESSAGE,
            }),
          },
        })
      } else if (b.tag === 'callout') {
        chain.insertContent({ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
      } else {
        chain.insertContent({ type: 'setuBlock', attrs: { tag: b.tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] })
      }
```

(Preserve the existing `callout`/`else` bodies exactly — only add the `contact` branch ahead of them. Note `contactBlock` is an atom: insert with NO `content`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 4: UAT — author flow end-to-end**

With the dev stack running (admin on its port), open the editor for a page:
1. Type `/` → choose **Contact form**. Expected: the block inserts as a **live preview** (Name / Email / Message fields, "Spam protection" placeholder, disabled Send) — not the bare "Contact form" label.
2. Click the **gear → Form settings**. Toggle **Subject field on** → the preview gains a Subject field immediately. Set **Form name** = "Sales enquiry", toggle **Name required off**, edit the **Success message**.
3. **Save** the page (publish/save as the editor normally does), then **reopen** it. Expected: the block reloads with the same settings (subject on, name optional, the form name + success message preserved) — confirming the Markdoc round-trip.
4. View the **page on the site**. Expected: the rendered form matches (Subject present, name optional), and submitting it lands in `/forms` attributed to **"Sales enquiry"** with a **stable formId** (rename the form name and confirm existing submissions stay grouped).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/Canvas.tsx apps/admin/src/editor/blocks.ts
git commit -m "feat(admin): insert + register the contact block as a dedicated editor node"
```

**Final:** request a whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- Dedicated `contactBlock` node (callout pattern) → Task 3. ✅
- Live static preview, fields reflect attrs, "Spam protection" placeholder, no Turnstile/submit → Task 3 (+ derived by Task 1's `contactPreviewFields`). ✅
- "Form settings" popover: Form name, Subject on/off, required (Name + Subject), Success message → Task 3. ✅
- `formId` auto-managed (generated on insert + back-compat on first edit; stable across renames) → Task 1 (`ensureFormId`/`genFormId`), Task 3 (mount effect), Task 4 (insert). ✅
- Markdoc round-trip `{% contact %}` ↔ `contactBlock` → Task 2. ✅
- Canvas + slash-insert wiring → Task 4. ✅
- No site/pipeline/inbox changes → none of the tasks touch those. ✅
- Boolean coercion for string-valued Markdoc attrs → Task 1 (`coerceBool`), used in Task 3. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. Wiring touch-points cite exact files + the anchor lines from the converter/canvas/insert pattern.

**3. Type consistency:** `mdAttrs: Record<string, unknown>` envelope, attribute names (`formId`/`formLabel`/`subject`/`nameRequired`/`subjectRequired`/`messageRequired`/`successMessage`), `contactBlock` node name, and helper signatures are consistent across Tasks 1–4. The node is content-less (atom) in Task 3 and the converters (Task 2) emit/accept no content for it.

**Open questions resolved:** O1 → atom node (no body). O2 → helpers admin-local (`apps/admin/src/editor/extensions/contact-helpers.ts`; no site reuse). O3 → settings popover is closed on insert with a visible gear affordance (auto-open dropped as unnecessary; the live preview already makes the block legible).
