# Taxonomy Input UX + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tag/category inputs across the admin consistent, searchable, keyboard-driven, and clearly confirmed — via one shared `Combobox` primitive + an in-house notification system.

**Architecture:** A controlled `Combobox` (↑/↓/Enter/Esc + ARIA) underpins a `TagAutocomplete` (async `distinctTags`) and a `CategoryPicker` (sync taxonomy); the editor `TagField`, listing `TagFilter`, and `BulkBar` adopt them. A `NotificationProvider`/`useNotify` gives bulk actions clear feedback.

**Tech Stack:** TypeScript, React 18, Vitest + @testing-library/react. NO new runtime deps.

## Global Constraints

- **In-house notifications, no toast library** (admin owns its UI primitives; zero new deps; Cloudflare-safe).
- **One shared `Combobox`** carries the keyboard model: ↑/↓ highlight, **Enter** commits highlighted (or, with `allowFreeText`, the typed text; else the top match), **Esc** closes, click commits. ARIA `combobox`/`listbox`/`option` + `aria-activedescendant`.
- **Tags** committed via `normalizeTag`; **bulk tag Enter = Add**, Remove is an explicit button. **Bulk category** is pick-existing only (`allowFreeText={false}`).
- **Editor category** keeps the checkbox tree + inline-create; adds a filter box.
- New shared UI lives in `apps/admin/src/ui/`. Admin tests under `apps/admin/test/`.
- Spec: `docs/superpowers/specs/2026-06-20-setu-taxonomy-input-ux-design.md`.

---

### Task 1: `Combobox` primitive

**Files:**
- Create: `apps/admin/src/ui/Combobox.tsx`
- Test: `apps/admin/test/combobox.test.tsx`

**Interfaces:**
- Produces: `ComboItem = { value: string; label?: React.ReactNode }`; `Combobox({ value, onChange, onSubmit, items, allowFreeText?, placeholder?, ariaLabel, disabled?, className? })` where `onChange(text)`, `onSubmit(text)`, `items: ComboItem[]`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/combobox.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Combobox } from '../src/ui/Combobox'

function setup(over: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onSubmit = vi.fn()
  const onChange = vi.fn()
  render(
    <Combobox
      value={over.value ?? 're'}
      onChange={onChange}
      onSubmit={onSubmit}
      items={over.items ?? [{ value: 'react' }, { value: 'redux' }]}
      allowFreeText={over.allowFreeText}
      ariaLabel="Test combo"
    />,
  )
  return { onSubmit, onChange }
}

describe('Combobox', () => {
  it('Arrow-down highlights and Enter commits the highlighted item', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Test combo')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // highlight index 0 → react
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('react')
  })

  it('Enter with no highlight commits typed text when allowFreeText', () => {
    const { onSubmit } = setup({ value: 'brandnew', items: [], allowFreeText: true })
    fireEvent.keyDown(screen.getByLabelText('Test combo'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brandnew')
  })

  it('Enter with no highlight commits the top match when NOT allowFreeText', () => {
    const { onSubmit } = setup({ value: 'gu', items: [{ value: 'guides' }], allowFreeText: false })
    fireEvent.keyDown(screen.getByLabelText('Test combo'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('guides')
  })

  it('clicking an option commits its value', () => {
    const { onSubmit } = setup()
    fireEvent.focus(screen.getByLabelText('Test combo'))
    fireEvent.mouseDown(screen.getByText('redux'))
    expect(onSubmit).toHaveBeenCalledWith('redux')
  })

  it('renders item.label but commits item.value', () => {
    const { onSubmit } = setup({ items: [{ value: 'tut', label: '  Tutorials' }] })
    fireEvent.focus(screen.getByLabelText('Test combo'))
    fireEvent.mouseDown(screen.getByText('Tutorials'))
    expect(onSubmit).toHaveBeenCalledWith('tut')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/combobox.test.tsx`
Expected: FAIL — cannot find module `../src/ui/Combobox`.

- [ ] **Step 3: Implement**

`apps/admin/src/ui/Combobox.tsx`:
```tsx
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface ComboItem {
  value: string
  label?: ReactNode
}

export function Combobox({
  value,
  onChange,
  onSubmit,
  items,
  allowFreeText = true,
  placeholder,
  ariaLabel,
  disabled = false,
  className = '',
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (text: string) => void
  items: ComboItem[]
  allowFreeText?: boolean
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const show = open && items.length > 0

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const commit = (text: string) => {
    onSubmit(text)
    close()
  }
  const onEnter = () => {
    if (active >= 0 && active < items.length) commit(items[active]!.value)
    else if (allowFreeText) commit(value)
    else if (items.length > 0) commit(items[0]!.value)
  }

  return (
    <div className={`combo ${className}`.trim()}>
      <input
        type="text"
        className="combo-input"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, -1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          } else if (e.key === 'Escape') {
            close()
          }
        }}
      />
      {show && (
        <ul className="combo-list" role="listbox" id={listId}>
          {items.map((item, i) => (
            <li
              key={item.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combo-option${i === active ? ' active' : ''}`}
              // mousedown fires before the input's blur, so the click registers
              onMouseDown={(e) => {
                e.preventDefault()
                commit(item.value)
              }}
            >
              {item.label ?? item.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/combobox.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ui/Combobox.tsx apps/admin/test/combobox.test.tsx
git commit -m "feat(ux): Combobox primitive (keyboard nav + ARIA)"
```

---

### Task 2: `TagAutocomplete` + `CategoryPicker` wrappers

**Files:**
- Create: `apps/admin/src/ui/TagAutocomplete.tsx`
- Create: `apps/admin/src/ui/CategoryPicker.tsx`
- Test: `apps/admin/test/tag-autocomplete.test.tsx`

**Interfaces:**
- Consumes: `Combobox`/`ComboItem` (Task 1); `useIndex().distinctTags`; `useTaxonomy()`, `buildTree`, `normalizeTag` from `@setu/core`.
- Produces:
  - `TagAutocomplete({ value, onChange, onSubmit, exclude?, placeholder?, ariaLabel, disabled? })` — `onSubmit(tag)` receives the normalized tag.
  - `CategoryPicker({ value, onChange, onSubmit, placeholder?, ariaLabel, disabled? })` — `onSubmit(slug)`; pick-existing only.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/tag-autocomplete.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagAutocomplete } from '../src/ui/TagAutocomplete'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function Harness({ exclude }: { exclude?: string[] }) {
  const [v, setV] = (await import('react')).useState('')
  return <TagAutocomplete value={v} onChange={setV} onSubmit={() => {}} exclude={exclude} ariaLabel="Add a tag" />
}

function setup(onSubmit = vi.fn(), exclude: string[] = []) {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 's', content: doc('x'), metadata: { title: 'S', tags: ['react', 'redux'] } },
  ])
  const services = servicesFor(data, createMemoryGitPort())
  function Wrap() {
    const React = require('react')
    const [v, setV] = React.useState('')
    return <TagAutocomplete value={v} onChange={setV} onSubmit={onSubmit} exclude={exclude} ariaLabel="Add a tag" />
  }
  render(
    <ServicesProvider services={services}><DeployProvider><IndexProvider>
      <Wrap />
    </IndexProvider></DeployProvider></ServicesProvider>,
  )
  return { onSubmit }
}

describe('TagAutocomplete', () => {
  it('suggests existing tags and submits the normalized value on Enter', async () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 're' } })
    await screen.findByText('redux')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // react
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('react')
  })

  it('Enter on free text submits a normalized new tag', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'Brand New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brand-new')
  })

  it('excludes already-selected tags from suggestions', async () => {
    setup(vi.fn(), ['react'])
    fireEvent.change(screen.getByLabelText('Add a tag'), { target: { value: 're' } })
    await screen.findByText('redux')
    expect(screen.queryByText('react')).toBeNull()
  })
})
```
(Note: drop the broken `Harness` stub above — use the `Wrap` component inside `setup`. If `require` is unavailable in the test env, `import { useState } from 'react'` at the top and use it in `Wrap`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/tag-autocomplete.test.tsx`
Expected: FAIL — cannot find module `../src/ui/TagAutocomplete`.

- [ ] **Step 3: Implement `TagAutocomplete`**

`apps/admin/src/ui/TagAutocomplete.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { normalizeTag } from '@setu/core'
import { useIndex } from '../data/index-store'
import { Combobox } from './Combobox'

export function TagAutocomplete({
  value,
  onChange,
  onSubmit,
  exclude = [],
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (tag: string) => void
  exclude?: string[]
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const index = useIndex()
  const [matches, setMatches] = useState<string[]>([])
  const excludeKey = exclude.join('\0')

  useEffect(() => {
    const q = value.trim()
    if (q === '') {
      setMatches([])
      return
    }
    let cancelled = false
    const excluded = new Set(excludeKey ? excludeKey.split('\0') : [])
    const timer = setTimeout(() => {
      void index
        .distinctTags(q, 8)
        .then((tags) => {
          if (!cancelled) setMatches(tags.filter((t) => !excluded.has(t)))
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, index, excludeKey])

  return (
    <Combobox
      value={value}
      onChange={onChange}
      onSubmit={(text) => {
        const tag = normalizeTag(text)
        if (tag) onSubmit(tag)
      }}
      items={matches.map((v) => ({ value: v }))}
      allowFreeText
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  )
}
```

- [ ] **Step 4: Implement `CategoryPicker`**

`apps/admin/src/ui/CategoryPicker.tsx`:
```tsx
import { useMemo } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'
import { Combobox } from './Combobox'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function CategoryPicker({
  value,
  onChange,
  onSubmit,
  placeholder = 'Category…',
  ariaLabel,
  disabled = false,
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (slug: string) => void
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const { categories } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const q = value.trim().toLowerCase()
  const items = rows
    .filter((r) => q === '' || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))
    .map((r) => ({ value: r.slug, label: `${'  '.repeat(r.depth)}${r.name}` }))

  return (
    <Combobox
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      items={items}
      allowFreeText={false}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  )
}
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `cd apps/admin && pnpm vitest run test/tag-autocomplete.test.tsx && pnpm typecheck`
Expected: PASS (3 tests); typecheck clean. (`CategoryPicker` has no dedicated test here — it's exercised via the BulkBar test in Task 5; it's a thin wrapper.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/ui/TagAutocomplete.tsx apps/admin/src/ui/CategoryPicker.tsx apps/admin/test/tag-autocomplete.test.tsx
git commit -m "feat(ux): TagAutocomplete + CategoryPicker over Combobox"
```

---

### Task 3: Notification system (`useNotify`)

**Files:**
- Create: `apps/admin/src/ui/notify.tsx`
- Test: `apps/admin/test/notify.test.tsx`
- Modify: `apps/admin/src/main.tsx` (mount `NotificationProvider`)

**Interfaces:**
- Produces: `NotificationProvider({ children })`; `useNotify(): { success(m): void; error(m): void; info(m): void }`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/notify.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationProvider, useNotify } from '../src/ui/notify'

function Trigger() {
  const notify = useNotify()
  return <button onClick={() => notify.success('Saved 3 posts')}>go</button>
}

describe('useNotify', () => {
  it('shows a dismissible success notification', async () => {
    render(<NotificationProvider><Trigger /></NotificationProvider>)
    fireEvent.click(screen.getByText('go'))
    expect(await screen.findByText('Saved 3 posts')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    await waitFor(() => expect(screen.queryByText('Saved 3 posts')).toBeNull())
  })

  it('throws when used outside the provider', () => {
    function Bare() {
      useNotify()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/NotificationProvider/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/notify.test.tsx`
Expected: FAIL — cannot find module `../src/ui/notify`.

- [ ] **Step 3: Implement**

`apps/admin/src/ui/notify.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Kind = 'success' | 'error' | 'info'
interface Note { id: number; kind: Kind; message: string }
export interface NotifyApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const NotifyContext = createContext<NotifyApi | null>(null)
const AUTODISMISS_MS = 4000
const MAX_VISIBLE = 4

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setNotes((ns) => ns.filter((n) => n.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = nextId.current++
      setNotes((ns) => [...ns, { id, kind, message }].slice(-MAX_VISIBLE))
      timers.current.set(id, setTimeout(() => dismiss(id), AUTODISMISS_MS))
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
    }
  }, [])

  const api = useMemo<NotifyApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <NotifyContext.Provider value={api}>
      {children}
      <div className="notify-region" role="region" aria-label="Notifications" aria-live="polite">
        {notes.map((n) => (
          <div key={n.id} className={`notify notify-${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            <span className="notify-msg">{n.message}</span>
            <button type="button" className="notify-x" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  )
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext)
  if (ctx === null) throw new Error('useNotify must be used within a NotificationProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/notify.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount in `main.tsx`**

In `apps/admin/src/main.tsx`, add the import:
```tsx
import { NotificationProvider } from './ui/notify'
```
Wrap the provider stack (inside `Bootstrap`, around `ActorProvider`):
```tsx
      <Bootstrap>
        <NotificationProvider>
          <ActorProvider>
            <DeployProvider>
              <IndexProvider>
                <TaxonomyProvider>
                  <App />
                </TaxonomyProvider>
              </IndexProvider>
            </DeployProvider>
          </ActorProvider>
          <DevReset />
        </NotificationProvider>
      </Bootstrap>
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/ui/notify.tsx apps/admin/test/notify.test.tsx apps/admin/src/main.tsx
git commit -m "feat(ux): in-house useNotify notification system"
```

---

### Task 4: Adopt in editor `TagField`, listing `TagFilter`, editor `CategoryField` filter

**Files:**
- Modify: `apps/admin/src/editor/TagField.tsx`
- Modify: `apps/admin/src/screens/TagFilter.tsx`
- Modify: `apps/admin/src/editor/CategoryField.tsx`
- Test: existing `apps/admin/test/TagField.test.tsx`, `apps/admin/test/TagFilter.test.tsx` must still pass; add a `CategoryField` filter assertion.

**Interfaces:**
- Consumes: `TagAutocomplete` (Task 2).

- [ ] **Step 1: Rewrite editor `TagField` to use `TagAutocomplete`**

Replace the whole body of `apps/admin/src/editor/TagField.tsx` with (chips above + the shared autocomplete; the local debounce/suggestions code is gone):
```tsx
import { useState } from 'react'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagField({
  selected,
  onChange,
  editable,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editable: boolean
}) {
  const [input, setInput] = useState('')
  const remove = (tag: string) => onChange(selected.filter((t) => t !== tag))

  return (
    <div className="tag-field">
      <div className="tag-chips">
        {selected.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            {editable && (
              <button type="button" className="tag-chip-x" aria-label={`Remove ${tag}`} onClick={() => remove(tag)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <TagAutocomplete
        value={input}
        onChange={setInput}
        onSubmit={(tag) => {
          if (!selected.includes(tag)) onChange([...selected, tag])
          setInput('')
        }}
        exclude={selected}
        placeholder="Add a tag"
        ariaLabel="Add a tag"
        disabled={!editable}
      />
    </div>
  )
}
```

- [ ] **Step 2: Rewrite listing `TagFilter` to use `TagAutocomplete`**

Replace the body of `apps/admin/src/screens/TagFilter.tsx` (keep the active-value chip; the input becomes the shared autocomplete):
```tsx
import { useState } from 'react'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagFilter({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  const [input, setInput] = useState('')

  if (value) {
    return (
      <span className="tag-chip">
        {value}
        <button type="button" className="tag-chip-x" aria-label="Clear tag filter" onClick={() => onChange('')}>
          ×
        </button>
      </span>
    )
  }

  return (
    <TagAutocomplete
      value={input}
      onChange={setInput}
      onSubmit={(tag) => {
        onChange(tag)
        setInput('')
      }}
      placeholder="Filter by tag"
      ariaLabel="Filter by tag"
    />
  )
}
```

- [ ] **Step 3: Add a filter box to editor `CategoryField`**

In `apps/admin/src/editor/CategoryField.tsx`, add a filter state + narrow the rendered checkbox rows (keep inline-create + parent `<select>` using the full `rows`):
- Add near the other `useState`s: `const [filter, setFilter] = useState('')`.
- Compute the visible rows for the tree: `const fq = filter.trim().toLowerCase()` and `const visible = fq === '' ? rows : rows.filter((n) => n.name.toLowerCase().includes(fq))`.
- Replace the tree's `{rows.map(...)}` with `{visible.map(...)}` (the checkbox list only).
- Add a filter input as the FIRST child of `<div className="category-tree" ...>` (before the rows), shown only when there are categories:
```tsx
        {rows.length > 0 && (
          <input
            type="text"
            className="category-filter"
            placeholder="Filter categories"
            aria-label="Filter categories"
            value={filter}
            disabled={!editable}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
```
(Leave the `rows.length === 0` empty-state and the parent `<select>` — which lists all `rows` — unchanged.)

- [ ] **Step 4: Add a CategoryField filter test + run the affected suites**

Append a test to `apps/admin/test/` for the category filter (or add to an existing CategoryField test if present). New `apps/admin/test/category-field-filter.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { CategoryField } from '../src/editor/CategoryField'

const seed: GitSeedFile[] = [{ path: 'taxonomy/categories.yaml', content: '- slug: tutorials\n  name: Tutorials\n  parent: null\n- slug: news\n  name: News\n  parent: null\n' }]

function setup() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort(seed))
  render(
    <ServicesProvider services={services}><TaxonomyProvider>
      <CategoryField selected={[]} onChange={() => {}} editable />
    </TaxonomyProvider></ServicesProvider>,
  )
}

describe('CategoryField filter', () => {
  it('narrows the visible categories as you type', async () => {
    setup()
    await screen.findByText('Tutorials')
    expect(screen.getByText('News')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter categories'), { target: { value: 'tut' } })
    await waitFor(() => expect(screen.queryByText('News')).toBeNull())
    expect(screen.getByText('Tutorials')).toBeTruthy()
  })
})
```

Run: `cd apps/admin && pnpm vitest run test/TagField.test.tsx test/TagFilter.test.tsx test/category-field-filter.test.tsx`
Expected: PASS. The existing TagField/TagFilter tests should still pass — they assert "Add a tag" / "Filter by tag" inputs + suggestion behavior, all preserved. If a TagField/TagFilter test asserted the OLD internal markup (e.g. a specific suggestion container), update it to the new combobox markup WITHOUT weakening the behavior asserted.

- [ ] **Step 5: Full admin suite + typecheck + commit**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS.
```bash
git add apps/admin/src/editor/TagField.tsx apps/admin/src/screens/TagFilter.tsx apps/admin/src/editor/CategoryField.tsx apps/admin/test
git commit -m "feat(ux): editor TagField/CategoryField + listing TagFilter adopt shared inputs"
```

---

### Task 5: `BulkBar` adopts `TagAutocomplete` + `CategoryPicker` + `useNotify`

**Files:**
- Modify: `apps/admin/src/screens/BulkBar.tsx`
- Test: existing `apps/admin/test/bulk-bar.test.tsx` (update to the new controls + assert a notification)

**Interfaces:**
- Consumes: `TagAutocomplete`, `CategoryPicker` (Task 2), `useNotify` (Task 3).

- [ ] **Step 1: Update the BulkBar test**

Rewrite the action assertions in `apps/admin/test/bulk-bar.test.tsx` to drive the new controls and check a notification. The render harness must add `NotificationProvider` (BulkBar now calls `useNotify`). Key cases:
```tsx
// in the render wrapper, wrap with <NotificationProvider> (import from '../src/ui/notify')
// ...
it('adds a tag to all selected entries (Enter) and notifies', async () => {
  const { git } = setup([row('a'), row('b')])
  const input = screen.getByLabelText('Bulk tag')
  fireEvent.change(input, { target: { value: 'news' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByText(/Added .*news.* to 2/i)).toBeTruthy()
  const { parseMdoc } = await import('@setu/core')
  const a = parseMdoc((await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' })))!)
  expect(a.frontmatter.tags).toEqual(['news'])
})

it('deletes selected entries after confirm and notifies', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { git } = setup([row('a')])
  fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
  expect(await screen.findByText(/Deleted 1/i)).toBeTruthy()
  expect(await git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'a' }))).toBeNull()
})

it('shows the unpublished-changes heads-up count', () => {
  setup([row('a', { hasDraft: true, lifecycle: { state: 'staged' } }), row('b')])
  expect(screen.getByText(/1 of 2 have unpublished changes/i)).toBeTruthy()
})
```
(Seed the memory git so `loadForEdit` can fork — as the existing test already does. Add a `taxonomy/categories.yaml` seed if you also assert the category control.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm vitest run test/bulk-bar.test.tsx`
Expected: FAIL — `Bulk tag` is no longer a plain input with an Enter handler / no notification yet.

- [ ] **Step 3: Rewrite BulkBar**

Replace `apps/admin/src/screens/BulkBar.tsx` with:
```tsx
import { useState } from 'react'
import type { ContentRow, EntryRef } from '@setu/core'
import { bulkAddCategory, bulkRemoveCategory, bulkAddTag, bulkRemoveTag } from '@setu/core'
import { useServices } from '../data/store'
import { useIndex } from '../data/index-store'
import { useNotify } from '../ui/notify'
import { TagAutocomplete } from '../ui/TagAutocomplete'
import { CategoryPicker } from '../ui/CategoryPicker'

export function BulkBar({
  rows,
  selected,
  onClear,
  onDone,
}: {
  rows: ContentRow[]
  selected: Set<string>
  onClear: () => void
  onDone: () => void
}) {
  const { bulk } = useServices()
  const index = useIndex()
  const notify = useNotify()
  const [catVal, setCatVal] = useState('')
  const [cat, setCat] = useState('')
  const [tagVal, setTagVal] = useState('')
  const [busy, setBusy] = useState(false)

  const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)))
  const refs: EntryRef[] = selectedRows.map((r) => r.ref)
  const pendingCount = selectedRows.filter((r) => r.hasDraft && r.lifecycle.state !== 'live').length

  const run = async (op: () => Promise<{ applied: EntryRef[]; skipped: { ref: EntryRef }[] }>, label: string) => {
    setBusy(true)
    try {
      const r = await op()
      for (const ref of r.applied) await index.reindexEntry(ref).catch(() => {})
      const skipped = r.skipped.length ? ` · ${r.skipped.length} skipped` : ''
      notify.success(`${label} ${r.applied.length} post${r.applied.length === 1 ? '' : 's'}${skipped}`)
      onDone()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyCat = (mut: typeof bulkAddCategory, verb: string) => {
    if (!cat) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, cat)), verb).then(() => {
      setCat('')
      setCatVal('')
    })
  }
  const applyTag = (rawTag: string, mut: typeof bulkAddTag, verb: string) => {
    const t = rawTag.trim()
    if (!t) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, t)), verb).then(() => setTagVal(''))
  }
  const del = () => {
    if (!window.confirm(`Delete ${refs.length} post${refs.length === 1 ? '' : 's'}? This commits their removal.`)) return
    void run(() => bulk.deleteEntries(refs), 'Deleted')
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selected.size} selected</span>

      <span className="bulk-group">
        <CategoryPicker
          value={catVal}
          onChange={setCatVal}
          onSubmit={(slug) => setCat(slug)}
          ariaLabel="Bulk category"
          disabled={busy}
        />
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkAddCategory, 'Added category to')}>Add</button>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkRemoveCategory, 'Removed category from')}>Remove</button>
      </span>

      <span className="bulk-group">
        <TagAutocomplete
          value={tagVal}
          onChange={setTagVal}
          onSubmit={(tag) => applyTag(tag, bulkAddTag, `Added "${tag}" to`)}
          placeholder="Tag…"
          ariaLabel="Bulk tag"
          disabled={busy}
        />
        <button type="button" className="btn btn-sm" disabled={busy || !tagVal.trim()} onClick={() => applyTag(tagVal, bulkRemoveTag, 'Removed tag from')}>Remove</button>
      </span>

      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={del}>Delete</button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onClear}>Clear selection</button>

      {pendingCount > 0 && (
        <span className="bulk-note">{pendingCount} of {selectedRows.length} have unpublished changes that will also go live.</span>
      )}
    </div>
  )
}
```
Note: the category Add/Remove act on the picked `cat` slug (set when the user picks from `CategoryPicker`); `catVal` is the visible text. The tag autocomplete's Enter/pick → Add (the primary); the Remove button removes the typed `tagVal`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm vitest run test/bulk-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full admin suite + typecheck + commit**

Run: `cd apps/admin && pnpm vitest run && pnpm typecheck`
Expected: all PASS.
```bash
git add apps/admin/src/screens/BulkBar.tsx apps/admin/test/bulk-bar.test.tsx
git commit -m "feat(ux): BulkBar uses shared tag/category pickers + notifications"
```

---

### Task 6: CSS (combobox, notifications, chip animation) + whole-feature verification

**Files:**
- Modify: `apps/admin/src/styles/` (combobox, notify region, chip animation)

- [ ] **Step 1: Whole-monorepo verification**

Run (repo root): `pnpm -r test`
Then: `pnpm --filter @setu/site exec astro sync && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean (the `astro sync` is the pre-existing fresh-worktree codegen need).

- [ ] **Step 2: Style the new classes**

Read `apps/admin/src/styles/` (`shell.css` + `editor.css` hold the tag/bulk styles; `tokens.css` the variables). Add, using ONLY existing tokens:
- **Combobox** — `combo` (position: relative wrapper), `combo-input` (match existing `tag-input`/`list-search` input styling), `combo-list` (absolute dropdown panel under the input — surface bg, border, radius, `var(--shadow-md)`, z-index, max-height + scroll), `combo-option` (padded row; `.active` and `:hover` use an accent/surface highlight token). Reuse/much like the existing `tag-suggestions`/`tag-suggestion` rules.
- **Notifications** — `notify-region` (fixed; bottom-right; column; gap; high z-index; `pointer-events: none` on the region, `auto` on each `notify`), `notify` (surface card, border, radius, shadow, padding, flex with the × button), `notify-success`/`notify-error`/`notify-info` (left-border or subtle tint using existing accent / a danger token / muted; check tokens — don't invent colors), `notify-x` (subtle icon button), `notify-msg`. A gentle slide/fade-in via a keyframe (mirror the existing `popIn` if present).
- **Chip animation** — make `.tag-chip` animate in (a short fade/scale keyframe) so an added tag visibly registers.
- **Category filter** — `category-filter` (a small input matching the others) sized to sit above the tree.

Use existing tokens; match the admin look. Then:
```bash
git add apps/admin/src/styles
git commit -m "style(ux): combobox, notifications, chip animation"
```

- [ ] **Step 3: Manual smoke (dev server)**

In the running admin: open a post — typing a tag shows suggestions, ↑/↓ + Enter adds it, the chip animates in; the category filter narrows the tree. On Posts, select rows — the bulk tag field searches + Enter adds (a notification appears bottom-right), the category picker searches + Add/Remove, Delete confirms + notifies. Confirm the combobox dropdown + notifications look clean.

---

## Self-Review

**Spec coverage:**
- Shared combobox primitive (kbd nav + ARIA) → Task 1. ✓
- `TagAutocomplete` (editor/bulk/filter) + `CategoryPicker` (bulk) → Tasks 2, 4, 5. ✓
- Editor category filter box → Task 4. ✓
- In-house `useNotify` + wired to bulk → Tasks 3, 5. ✓
- Bulk tag Enter=Add, Remove explicit; bulk category pick-existing (`allowFreeText=false`) → Tasks 1, 5. ✓
- Chip add animation → Task 6. ✓
- Non-goals (migrate other feedback spots; rich queue; visual redesign) → none built. ✓

**Placeholder scan:** No TBD/TODO in steps; full code for all new components + consumer edits. The Task 2 test note flags the `Harness` stub to drop in favor of `Wrap` (an explicit correction, not a placeholder). Step 6.2 (CSS) is open-ended by nature but names exact classes + token conventions.

**Type consistency:** `ComboItem`/`Combobox` props consistent across Task 1 and the wrappers; `TagAutocomplete`/`CategoryPicker` signatures (`value`/`onChange`/`onSubmit`/`ariaLabel`) identical in Tasks 2/4/5; `useNotify().success|error` used in Tasks 3/5; `allowFreeText` default true (tags) / false (CategoryPicker); BulkBar `run` returns the `{applied,skipped}` shape from `bulkService`.
