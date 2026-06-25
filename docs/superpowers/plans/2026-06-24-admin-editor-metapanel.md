# Editor chrome PR B — meta panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the editor meta panel (CategoryField/TagField/MetaPanel) onto shadcn primitives, remove the vestigial Status segmented control, and reorder the panel Permalink → Categories → Tags.

**Architecture:** Swap CategoryField's raw inputs for shadcn Checkbox/Input/Select/Button, TagField's chips for shadcn Badge, then rebuild the MetaPanel shell (drop Status, reorder sections, loose/modern). Behavior (category/tag editing, inline-create, editable-disabling) is preserved verbatim; only `metadata['status']` handling is removed.

**Tech Stack:** React 19, Vite, Vitest + Testing Library, shadcn/ui (`Checkbox`, `Input`, `Select`, `Button`, `Badge`), lucide-react, `@setu/core` (`buildTree`), `useTaxonomy`, `TagAutocomplete`.

## Global Constraints

- Editor opts OUT of `PageBody`; the meta panel stays the editor's right `<aside>` (~300px, `flex-shrink-0`, `overflow-y-auto`). Editor layout around it is unchanged.
- Section order in MetaPanel: **Permalink → Categories → Tags**. The Status section is REMOVED (the segmented control + the `metadata['status']` read/write). The panel never reads or writes `metadata['status']` after this PR. Do NOT strip `status` from existing content files — just stop maintaining it.
- Preserve behavior verbatim: category toggle/filter/inline-create (`useTaxonomy().create`), tag add/remove via `onChange`, the `editable` flag disabling all controls, the inline category-create error line.
- `MetaPanel` props unchanged: `{ metadata, locale, slug, editable, onChange }`. `onChange` drives `categories`/`tags` exactly as today.
- `TagAutocomplete` is reused as-is (already restyled) — do not modify it.
- Aesthetic: loose/modern, ~13px muted sentence-case section labels, hairline dividers, indigo (`--primary`) for checked boxes / Add button / tag chips, tokens only (no hardcoded colors).
- Full gate before done: `pnpm typecheck && pnpm test && pnpm build` ALL green (typecheck included — vitest does not typecheck).
- Keep editor/meta tests green; update only changed selectors (e.g. `.segmented`/`.tag-chip` → role/label), never weaken assertions.

---

### Task 1: `CategoryField` → shadcn

**Files:**
- Modify: `apps/admin/src/editor/CategoryField.tsx`
- Create/Modify: `apps/admin/test/CategoryField.test.tsx` (extend existing if present)

**Interfaces:**
- Consumes: shadcn `Checkbox`, `Input`, `Button`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`; lucide `Search`; `useTaxonomy()` (`categories`, `create`); `buildTree` (`@setu/core`).
- Produces: same `CategoryField({ selected, onChange, editable })` export — signature unchanged.

- [ ] **Step 1: Read the existing test + component**

Read `apps/admin/test/CategoryField.test.tsx` (and `category-field-filter.test.tsx` if present) to see what's asserted, and `CategoryField.tsx` for the exact `toggle`/`submit`/filter logic to preserve.

- [ ] **Step 2: Write/extend the failing test**

Cover (reuse the existing harness — these tests already wrap in the taxonomy/Index providers):

```tsx
// - checking a category row calls onChange with the slug added; unchecking removes it
// - the filter input narrows visible rows (type a name fragment → only matches shown)
// - inline-create: type a name, click Add → useTaxonomy().create called; new slug selected
// - editable=false disables the checkboxes + create controls
```
Query by role/label (`getByRole('checkbox', { name: 'Engineering' })`, `getByPlaceholderText('Filter categories')`, `getByRole('button', { name: 'Add' })`) — NOT CSS classes. Radix `Select` in jsdom needs the established stubs (scrollIntoView) + open via keyboard (Space/Enter) as in the taxonomy tests; for the parent-select assertion, opening it is optional — the create test can leave parent as default ("No parent").

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- CategoryField`
Expected: FAIL against the old markup (or new assertions).

- [ ] **Step 4: Implement**

Rewrite `CategoryField.tsx` keeping ALL logic; swap primitives:

```tsx
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) { out.push(n); flatten(n.children, out) }
  return out
}

export function CategoryField({ selected, onChange, editable }: {
  selected: string[]; onChange: (next: string[]) => void; editable: boolean
}) {
  const { categories, create } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fq = filter.trim().toLowerCase()
  const visible = fq === '' ? rows : rows.filter((n) => n.name.toLowerCase().includes(fq))
  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    try {
      const slug = await create({ name: trimmed, parent: parent || null })
      if (!selected.includes(slug)) onChange([...selected, slug])
      setName(''); setParent('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Filter categories" aria-label="Filter categories"
            value={filter} disabled={!editable} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No categories yet — add one below.</p>}
      {rows.length > 0 && (
        <div className="max-h-64 space-y-0.5 overflow-y-auto" role="group" aria-label="Categories">
          {visible.map((node) => (
            <label key={node.slug} className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 text-sm hover:bg-muted/50"
              style={{ paddingLeft: `${4 + node.depth * 20}px` }}>
              <Checkbox checked={selected.includes(node.slug)} disabled={!editable}
                aria-label={node.name} onCheckedChange={() => toggle(node.slug)} />
              <span>{node.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Input className="h-9 flex-1" placeholder="New category" value={name} disabled={!editable}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} />
          <Button size="sm" disabled={!editable} onClick={() => void submit()}>Add</Button>
        </div>
        {rows.length > 0 && (
          <Select value={parent || 'none'} disabled={!editable} onValueChange={(v) => setParent(v === 'none' ? '' : v)}>
            <SelectTrigger className="h-9 w-full" aria-label="Parent category"><SelectValue placeholder="No parent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No parent</SelectItem>
              {rows.map((node) => (
                <SelectItem key={node.slug} value={node.slug}>
                  <span style={{ paddingLeft: `${node.depth * 12}px` }}>{node.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
```
> Note: shadcn `Select` cannot use an empty-string `value`, so "No parent" maps to the sentinel `'none'` ↔ `''` (the create call still passes `parent || null`). Confirm `Checkbox`'s `onCheckedChange` + `Select`'s exports match the repo's `components/ui/{checkbox,select}.tsx`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- CategoryField category-field`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/CategoryField.tsx apps/admin/test/CategoryField.test.tsx
git commit -m "feat(admin): CategoryField on shadcn Checkbox/Input/Select/Button"
```

---

### Task 2: `TagField` → shadcn Badge chips

**Files:**
- Modify: `apps/admin/src/editor/TagField.tsx`
- Create/Modify: `apps/admin/test/TagField.test.tsx` (extend existing if present)

**Interfaces:**
- Consumes: shadcn `Badge`; lucide `X`; `TagAutocomplete` (unchanged).
- Produces: same `TagField({ selected, onChange, editable })` export.

- [ ] **Step 1: Write/extend the failing test**

```tsx
// - renders a Badge chip per selected tag
// - clicking a chip's remove (aria-label "Remove react") calls onChange without 'react'
// - editable=false hides the remove buttons
// - the autocomplete add path still appends (submit a tag → onChange includes it)
```
Query by `getByLabelText('Remove react')` / text. Reuse the existing TagField/editor harness.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- TagField`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagField({ selected, onChange, editable }: {
  selected: string[]; onChange: (next: string[]) => void; editable: boolean
}) {
  const [input, setInput] = useState('')
  const remove = (tag: string) => onChange(selected.filter((t) => t !== tag))
  return (
    <div className="space-y-2.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 font-normal">
              {tag}
              {editable && (
                <button type="button" aria-label={`Remove ${tag}`} onClick={() => remove(tag)}
                  className="rounded-sm opacity-70 hover:opacity-100">
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <TagAutocomplete
        value={input}
        onChange={setInput}
        onSubmit={(tag) => { if (!selected.includes(tag)) onChange([...selected, tag]); setInput('') }}
        exclude={selected}
        placeholder="Add a tag"
        ariaLabel="Add a tag"
        disabled={!editable}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @setu/admin test -- TagField`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/TagField.tsx apps/admin/test/TagField.test.tsx
git commit -m "feat(admin): TagField chips on shadcn Badge"
```

---

### Task 3: `MetaPanel` — remove Status, reorder, shell re-skin

**Files:**
- Modify: `apps/admin/src/editor/MetaPanel.tsx`
- Create/Modify: `apps/admin/test/MetaPanel.test.tsx`

**Interfaces:**
- Consumes: `CategoryField` (Task 1), `TagField` (Task 2). Props unchanged.

- [ ] **Step 1: Write the failing test**

`MetaPanel.test.tsx` — render within the editor/taxonomy provider harness (read CategoryField's test for the wrapper). Cover:

```tsx
// - renders section headings in DOM order: Permalink, Categories, Tags
// - does NOT render a Status control: queryByText('Draft'/'Staged'/'Deployed') as buttons are null
//   AND onChange is never called with a `status` key (no segmented control to click)
// - Permalink shows /{slug} and {locale}
```
For the order assertion, query the three section headings and assert their relative DOM position (e.g. via `compareDocumentPosition` or by reading all headings text in order).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- MetaPanel`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { CategoryField } from './CategoryField'
import { TagField } from './TagField'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-[18px] py-[18px] last:border-b-0">
      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function MetaPanel({ metadata, locale, slug, editable, onChange }: {
  metadata: Record<string, unknown>
  locale: string
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
}) {
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border/60">
      <Section title="Permalink">
        <div className="flex justify-between py-0.5 text-[13px]"><span className="text-muted-foreground">Slug</span><span className="font-mono text-muted-foreground">/{slug}</span></div>
        <div className="flex justify-between py-0.5 text-[13px]"><span className="text-muted-foreground">Locale</span><span className="font-mono text-muted-foreground">{locale}</span></div>
      </Section>
      <Section title="Categories">
        <CategoryField
          selected={Array.isArray(metadata['categories']) ? (metadata['categories'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, categories: next })}
          editable={editable}
        />
      </Section>
      <Section title="Tags">
        <TagField
          selected={Array.isArray(metadata['tags']) ? (metadata['tags'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, tags: next })}
          editable={editable}
        />
      </Section>
    </aside>
  )
}
```
> Confirm the editor layout still places `<MetaPanel>` correctly — it was previously `.meta-panel` inside `.editor-stage`; the new `<aside>` carries its own width/border, so check `EditorScreen`'s stage layout still lays canvas + panel side by side (the `.editor-stage`/`.ed-scroll` flex parent is unchanged; only the aside's own classes moved from CSS to Tailwind). If the stage relied on `.meta-panel`'s flex/width from CSS, the new inline `w-[300px] shrink-0` replaces that.

- [ ] **Step 4: Run to verify pass + editor sweep**

Run: `pnpm --filter @setu/admin test -- MetaPanel editor-screen`
Expected: PASS. Fix any editor test that queried the old `.segmented`/status buttons — those assertions should be removed/updated since the control is intentionally gone (this is a spec'd removal, not a regression). Never weaken unrelated assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/MetaPanel.tsx apps/admin/test/MetaPanel.test.tsx
git commit -m "feat(admin): MetaPanel — drop Status, reorder Permalink/Categories/Tags, re-skin"
```

---

### Task 4: Cleanup dead CSS + full gate

**Files:**
- Modify: `apps/admin/src/styles/editor.css`

- [ ] **Step 1: Remove dead meta CSS**

Run: `grep -rn "meta-panel\|meta-section\|meta-title\|meta-row\|meta-label\|meta-value\|\.segmented\|segmented-opt\|category-field\|category-tree\|category-filter\|category-row\|category-new\|tag-field\|tag-chips\|tag-chip\b\|tag-chip-x" apps/admin/src`
For each match in `editor.css` with NO remaining JSX referent (the meta panel + fields are now Tailwind), delete the selector block. Note: `category-new` may also appear in editor.css used by something else — only delete selectors with zero JSX uses. Re-run the grep; remaining matches must be legitimately live (none expected from the meta panel).

- [ ] **Step 2: Full gate**

Run from repo root: `pnpm typecheck && pnpm test && pnpm build`
Expected: ALL green. Note the admin test count.

- [ ] **Step 3: Editor-visible spot check (optional, if dev server up)**

Open a post: the meta panel shows Permalink (top), Categories (checkbox tree + filter + create), Tags (Badge chips + autocomplete) — no Status control; all controls disabled in a read-only/locked entry.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(admin): remove dead meta-panel CSS"
```
(Skip if no changes.)

---

## Self-Review

**Spec coverage:**
- Remove Status segmented control + stop writing `metadata['status']` → Task 3. ✓
- Reorder Permalink → Categories → Tags → Task 3. ✓
- CategoryField → Checkbox/Input/Select/Button → Task 1. ✓
- TagField chips → Badge (TagAutocomplete reused) → Task 2. ✓
- Permalink cleaner + at top → Task 3. ✓
- Dead CSS cleanup → Task 4. ✓
- Behavior preserved (toggle/filter/create/remove/editable) → Tasks 1/2 keep the exact logic. ✓

**Placeholder scan:** No "TBD"/"add error handling". The `>`-notes (Select empty-value sentinel, checkbox/select export names, editor-stage layout check) flag real-code checks the implementer resolves against the repo — concrete, not skipped work.

**Type consistency:** `CategoryField`/`TagField`/`MetaPanel` prop signatures identical to current (Tasks 1/2/3). `onChange(next: Record<string, unknown>)` on MetaPanel; `onChange(next: string[])` on the fields — matches current. `useTaxonomy().create({name, parent})` usage unchanged. Select sentinel `'none'`↔`''` consistent within Task 1.
