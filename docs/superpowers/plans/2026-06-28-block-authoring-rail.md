# Block Authoring Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the half-baked block inspector with a polished, structured, purpose-built authoring rail (a reusable control kit + grouping system), proven by redoing the hero block.

**Architecture:** A control **registry** in the admin (`controlType → React component`, uniform `ControlProps` interface) replaces the `if/else` chain in `BlockInspector`. The block contract (`@setu/core`) gains two new control types (`position9`, `align`) and an optional `groups` declaration. The rail renders always-open labeled sections. The hero block is the flagship: it adopts the kit and gets a renderer polish pass.

**Tech Stack:** React 19, shadcn/ui (Radix), Tailwind v4, Zod (core contracts), Astro (site renderer), Vitest + Testing Library.

## Global Constraints

- **shadcn-first (admin):** every control built on shadcn primitives; query the shadcn MCP (`mcp__shadcn__*`) before hand-rolling; never write a custom-CSS lookalike of a control shadcn provides. (CLAUDE.md "Building UI".)
- **No bare brand accent in hand-written CSS:** the `no-brand-accent-in-bespoke-css` guard forbids literal `var(--accent)` in admin CSS; use Tailwind `bg-accent`/token utilities.
- **Media is never a bare file input:** the `media` control opens `MediaPickerModal` (the real library) and shows a thumbnail with replace/remove.
- **Node-view stays an `atom`:** do NOT add inline-editable text regions to the hero node-view (deferred fast-follow; avoids the prior re-render/infinite-loop class).
- **Definition of Done:** driven live in the running app, matches the agreed design, reuses existing components, no skeletons. Green tests are necessary, never sufficient.
- **Test commands:** core → `pnpm --filter @setu/core test`; admin → `pnpm --filter @setu/admin test`; blocks → `pnpm --filter @setu/blocks test`. Typecheck → `pnpm -r typecheck`.
- **Commit cadence:** one commit per task (end of task). Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/core/src/config/types.ts` — extend `BlockControl` union (`position9`, `align`); add `groups` to `BlockEditorMeta`.
- `packages/core/src/blocks/resolve-controls.ts` — allow `position9`/`align` hints on enum props.
- `packages/core/src/blocks/standard/hero.ts` — add `align` prop + `groups` + control hints.
- `apps/admin/src/editor/controls/types.ts` — `ControlProps` interface.
- `apps/admin/src/editor/controls/*.tsx` — one component per control type.
- `apps/admin/src/editor/controls/registry.ts` — `controlRegistry: Record<BlockControl, FC<ControlProps>>`.
- `apps/admin/src/editor/BlockInspector.tsx` — thin shell: render groups → registry lookup.
- `apps/admin/src/editor/extensions/ImageBlock.tsx` — reuse the shared `AlignControl`.
- `apps/admin/src/components/ui/toggle-group.tsx` — added via shadcn.
- `packages/blocks/src/hero/{Hero.astro,Hero.tsx,hero.css,hero-classes.ts}` — renderer polish + align/width.

---

### Task 1: Core — new control types + groups + resolve-controls

**Files:**
- Modify: `packages/core/src/config/types.ts:4` and `BlockEditorMeta` (around `:7-22`)
- Modify: `packages/core/src/blocks/resolve-controls.ts:35-40`
- Test: `packages/core/test/resolve-controls-rail.test.ts` (create)

**Interfaces:**
- Produces: `BlockControl` now includes `'position9' | 'align'`; `BlockEditorMeta.groups?: Array<{ id: string; label: string; controls: string[] }>`; `resolveControls` accepts `position9`/`align` hints on enum (`a.matches`) String props, preserving `options`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/resolve-controls-rail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../src/blocks/resolve-controls'

const POS = ['top-left','top-center','top-right','middle-left','center','middle-right','bottom-left','bottom-center','bottom-right'] as const

describe('resolveControls — rail control types', () => {
  it('upgrades an enum prop to position9 and preserves options', () => {
    const props = z.object({ textPosition: z.enum(POS).default('center') })
    const out = resolveControls(props, { textPosition: 'position9' })
    const c = out.find((x) => x.name === 'textPosition')!
    expect(c.control).toBe('position9')
    expect(c.options).toEqual([...POS])
    expect(c.default).toBe('center')
  })

  it('upgrades an enum prop to align', () => {
    const props = z.object({ width: z.enum(['none','wide','full']).default('none') })
    const out = resolveControls(props, { width: 'align' })
    expect(out[0].control).toBe('align')
    expect(out[0].options).toEqual(['none','wide','full'])
  })

  it('throws when position9 hints a non-enum String prop', () => {
    const props = z.object({ headline: z.string() })
    expect(() => resolveControls(props, { headline: 'position9' as never })).toThrow(/incompatible/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test resolve-controls-rail`
Expected: FAIL — `position9` not assignable / hint rejected.

- [ ] **Step 3: Extend the BlockControl union and editor meta**

In `packages/core/src/config/types.ts`, line 4:

```ts
export type BlockControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'media' | 'url' | 'color' | 'position9' | 'align'
```

In `BlockEditorMeta` (after the `showWhen?` field), add:

```ts
  /** Optional ordered sections for the inspector rail. Controls not listed in any
   *  group fall into an implicit leading "Content" section in declaration order. */
  groups?: Array<{ id: string; label: string; controls: string[] }>
```

- [ ] **Step 4: Allow position9/align hints on enum props**

In `packages/core/src/blocks/resolve-controls.ts`, replace the `ok` expression (lines 35-40) with:

```ts
    const ENUM_HINTS: ReadonlySet<BlockControl> = new Set(['select', 'position9', 'align'])
    const ok =
      (a.matches && ENUM_HINTS.has(hint)) ||
      (a.type === 'Number' && hint === 'number') ||
      (a.type === 'Boolean' && hint === 'switch') ||
      (a.type === 'String' && !a.matches && STRING_CONTROLS.has(hint))
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @setu/core test resolve-controls-rail && pnpm --filter @setu/core typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/blocks/resolve-controls.ts packages/core/test/resolve-controls-rail.test.ts
git commit -m "feat(core): add position9/align control types + block groups; allow enum-hint upgrades

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Admin — control registry + migrate existing controls

**Files:**
- Create: `apps/admin/src/editor/controls/types.ts`, `text.tsx`, `textarea.tsx`, `number.tsx`, `switch.tsx`, `url.tsx`, `color.tsx`, `media.tsx`, `select.tsx`, `registry.ts`
- Modify: `apps/admin/src/editor/BlockInspector.tsx` (rewire to registry; grouping comes in Task 6)
- Test: `apps/admin/test/controls-registry.test.tsx` (create)

**Interfaces:**
- Produces: `ControlProps` = `{ value: unknown; onChange: (v: unknown) => void; meta: ControlMeta }` where `ControlMeta = { name: string; options?: string[]; default?: unknown; apiBase: string; onPickMedia: (name: string) => void }`. `controlRegistry: Record<BlockControl, React.FC<ControlProps>>`. Every control reads `value` (already `?? default` resolved by the shell) and calls `onChange`.
- Consumes: `ResolvedControl` from `@setu/core`; `MediaPickerModal`, `resolveMediaSrc` from `../`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/controls-registry.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { controlRegistry } from '../src/editor/controls/registry'

const meta = (over = {}) => ({ name: 'headline', apiBase: '', onPickMedia: vi.fn(), ...over })

describe('controlRegistry', () => {
  it('has a component for every control type', () => {
    for (const t of ['text','textarea','number','switch','select','media','url','color'] as const) {
      expect(controlRegistry[t]).toBeTypeOf('function')
    }
  })

  it('text control emits onChange with the typed string', () => {
    const onChange = vi.fn()
    const C = controlRegistry.text
    render(<C value="" onChange={onChange} meta={meta()} />)
    fireEvent.change(screen.getByLabelText('headline'), { target: { value: 'Hi' } })
    expect(onChange).toHaveBeenCalledWith('Hi')
  })

  it('switch control emits boolean', () => {
    const onChange = vi.fn()
    const C = controlRegistry.switch
    render(<C value={false} onChange={onChange} meta={meta({ name: 'parallax' })} />)
    fireEvent.click(screen.getByLabelText('parallax'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test controls-registry`
Expected: FAIL — `controls/registry` not found.

- [ ] **Step 3: Create the ControlProps interface**

Create `apps/admin/src/editor/controls/types.ts`:

```ts
export interface ControlMeta {
  name: string
  options?: string[]
  default?: unknown
  apiBase: string
  /** Open the media library for this control's prop name. */
  onPickMedia: (name: string) => void
}

export interface ControlProps {
  value: unknown
  onChange: (next: unknown) => void
  meta: ControlMeta
}
```

- [ ] **Step 4: Create the simple control components**

Create `apps/admin/src/editor/controls/text.tsx`:

```tsx
import { Input } from '@/components/ui/input'
import type { ControlProps } from './types'

export function TextControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)} />
}
export function UrlControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} type="url" value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)} />
}
export function NumberControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} type="number" value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
}
```

Create `apps/admin/src/editor/controls/textarea.tsx`:

```tsx
import { Textarea } from '@/components/ui/textarea'
import type { ControlProps } from './types'

export function TextareaControl({ value, onChange, meta }: ControlProps) {
  return <Textarea id={`bi-${meta.name}`} aria-label={meta.name} value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)} />
}
```

Create `apps/admin/src/editor/controls/switch.tsx`:

```tsx
import { Switch } from '@/components/ui/switch'
import type { ControlProps } from './types'

export function SwitchControl({ value, onChange, meta }: ControlProps) {
  return <Switch id={`bi-${meta.name}`} aria-label={meta.name} checked={Boolean(value)}
    onCheckedChange={(v) => onChange(v)} />
}
```

Create `apps/admin/src/editor/controls/select.tsx` (plain dropdown for now; Task 3 adds segmentation):

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import type { ControlProps } from './types'

export function SelectControl({ value, onChange, meta }: ControlProps) {
  return (
    <Select value={String(value ?? '')} onValueChange={(v) => onChange(v)}>
      <SelectTrigger id={`bi-${meta.name}`} aria-label={meta.name}><SelectValue /></SelectTrigger>
      <SelectContent>
        {(meta.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
```

Create `apps/admin/src/editor/controls/color.tsx`:

```tsx
import type { ControlProps } from './types'

export function ColorControl({ value, onChange, meta }: ControlProps) {
  const hex = String(value ?? '#000000ff')
  const alphaPct = Math.round((parseInt(hex.slice(7) || 'ff', 16) / 255) * 100)
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={meta.name} value={hex.slice(0, 7)}
        onChange={(e) => onChange(e.target.value + (hex.slice(7) || 'ff'))}
        className="h-8 w-10 rounded border border-border bg-transparent p-0.5" />
      <input type="range" min={0} max={100} aria-label={`${meta.name} opacity`} value={alphaPct}
        onChange={(e) => {
          const a = Math.round((Number(e.target.value) / 100) * 255).toString(16).padStart(2, '0')
          onChange(hex.slice(0, 7) + a)
        }}
        className="flex-1" />
    </div>
  )
}
```

Create `apps/admin/src/editor/controls/media.tsx` (first-class affordance — thumbnail + replace/remove):

```tsx
import { Button } from '@/components/ui/button'
import { resolveMediaSrc } from '../media-src'
import type { ControlProps } from './types'

export function MediaControl({ value, onChange, meta }: ControlProps) {
  const src = value ? resolveMediaSrc(String(value), meta.apiBase || undefined) : ''
  if (!src) {
    return (
      <button type="button" aria-label={meta.name} onClick={() => meta.onPickMedia(meta.name)}
        className="flex h-24 w-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
        Choose from library
      </button>
    )
  }
  return (
    <div className="group relative overflow-hidden rounded-md border border-border">
      <img src={src} alt="" className="block max-h-40 w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button type="button" size="sm" variant="secondary" aria-label={`Replace ${meta.name}`}
          onClick={() => meta.onPickMedia(meta.name)}>Replace</Button>
        <Button type="button" size="sm" variant="secondary" aria-label={`Remove ${meta.name}`}
          onClick={() => onChange('')}>Remove</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create the registry**

Create `apps/admin/src/editor/controls/registry.ts`:

```ts
import type { BlockControl } from '@setu/core'
import type { ControlProps } from './types'
import { TextControl, UrlControl, NumberControl } from './text'
import { TextareaControl } from './textarea'
import { SwitchControl } from './switch'
import { SelectControl } from './select'
import { ColorControl } from './color'
import { MediaControl } from './media'

export const controlRegistry: Record<BlockControl, React.FC<ControlProps>> = {
  text: TextControl,
  url: UrlControl,
  number: NumberControl,
  textarea: TextareaControl,
  switch: SwitchControl,
  select: SelectControl,
  color: ColorControl,
  media: MediaControl,
  // position9 + align registered in Tasks 4 & 5:
  position9: SelectControl,
  align: SelectControl,
}
```

(Note: `position9`/`align` temporarily alias `SelectControl` so the map is total; Tasks 4 & 5 replace them.)

- [ ] **Step 6: Rewire BlockInspector to the registry (behavior-preserving)**

Replace the body of `apps/admin/src/editor/BlockInspector.tsx` with:

```tsx
import { useState } from 'react'
import { resolveControls } from '@setu/core'
import { registry } from '../blocks/registry'
import { Label } from '@/components/ui/label'
import { MediaPickerModal } from './MediaPickerModal'
import { controlRegistry } from './controls/registry'

export function BlockInspector({
  tag, mdAttrs, onChange, apiBase,
}: { tag: string; mdAttrs: Record<string, unknown>; onChange: (name: string, value: unknown) => void; apiBase: string }) {
  const block = registry.blocks.find((b) => b.tag === tag)
  const [pickFor, setPickFor] = useState<string | null>(null)
  if (!block) return <p className="px-1 py-2 text-sm text-muted-foreground">No editable properties.</p>

  const controls = resolveControls(block.props, block.editor?.controls)
  const showWhen = block.editor?.showWhen ?? {}
  const visible = controls.filter((c) => {
    const rule = showWhen[c.name]
    if (!rule) return true
    return Object.entries(rule).every(([k, v]) => {
      const cur = mdAttrs[k]
      return Array.isArray(v) ? v.includes(cur as string) : cur === v
    })
  })

  return (
    <div className="flex flex-col gap-3">
      {visible.map((c) => {
        const Control = controlRegistry[c.control]
        return (
          <div key={c.name} className="flex flex-col gap-1.5">
            <Label htmlFor={`bi-${c.name}`} className="capitalize">{c.name}</Label>
            <Control
              value={mdAttrs[c.name] ?? c.default}
              onChange={(v) => onChange(c.name, v)}
              meta={{ name: c.name, options: c.options, default: c.default, apiBase, onPickMedia: setPickFor }}
            />
          </div>
        )
      })}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test controls-registry && pnpm --filter @setu/admin typecheck`
Expected: PASS. Also run existing inspector tests: `pnpm --filter @setu/admin test selected-block-rail` → still PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/controls apps/admin/src/editor/BlockInspector.tsx apps/admin/test/controls-registry.test.tsx
git commit -m "feat(admin): control registry; migrate inspector controls to components (media first-class)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: SegmentedSelect — small enums as a toggle-group

**Files:**
- Add via shadcn: `apps/admin/src/components/ui/toggle-group.tsx`
- Create: `apps/admin/src/editor/controls/segmented-select.tsx`
- Modify: `apps/admin/src/editor/controls/registry.ts` (point `select` at the new component)
- Test: `apps/admin/test/controls-segmented.test.tsx` (create)

**Interfaces:**
- Produces: `SegmentedSelect` (ControlProps) — renders a single-select `ToggleGroup` when `meta.options.length <= 4`, else falls back to the dropdown `SelectControl`.

- [ ] **Step 1: Add the shadcn toggle-group**

Get the exact command from the shadcn MCP, then run it:

Run: `cd apps/admin && npx shadcn@latest add toggle-group`
Expected: creates `apps/admin/src/components/ui/toggle-group.tsx`.

- [ ] **Step 2: Write the failing test**

Create `apps/admin/test/controls-segmented.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentedSelect } from '../src/editor/controls/segmented-select'

const meta = (options: string[]) => ({ name: 'layout', options, apiBase: '', onPickMedia: vi.fn() })

describe('SegmentedSelect', () => {
  it('renders a segmented button per option for small enums and emits on click', () => {
    const onChange = vi.fn()
    render(<SegmentedSelect value="centered" onChange={onChange} meta={meta(['centered','split-left','background'])} />)
    fireEvent.click(screen.getByRole('radio', { name: 'background' }))
    expect(onChange).toHaveBeenCalledWith('background')
  })

  it('falls back to a dropdown for long enums (>4)', () => {
    render(<SegmentedSelect value="a" onChange={vi.fn()} meta={meta(['a','b','c','d','e'])} />)
    // dropdown renders a combobox trigger, not 5 radios
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test controls-segmented`
Expected: FAIL — `segmented-select` not found.

- [ ] **Step 4: Implement SegmentedSelect**

Create `apps/admin/src/editor/controls/segmented-select.tsx`:

```tsx
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SelectControl } from './select'
import type { ControlProps } from './types'

export function SegmentedSelect(props: ControlProps) {
  const options = props.meta.options ?? []
  if (options.length === 0 || options.length > 4) return <SelectControl {...props} />
  return (
    <ToggleGroup type="single" value={String(props.value ?? '')}
      onValueChange={(v) => { if (v) props.onChange(v) }}
      className="flex-wrap justify-start gap-1" aria-label={props.meta.name}>
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} aria-label={o} className="px-2.5 text-xs capitalize">
          {o.replace(/-/g, ' ')}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
```

- [ ] **Step 5: Point the registry's `select` at SegmentedSelect**

In `apps/admin/src/editor/controls/registry.ts`, change the import and the `select:` entry:

```ts
import { SegmentedSelect } from './segmented-select'
// ...
  select: SegmentedSelect,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test controls-segmented && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/ui/toggle-group.tsx apps/admin/src/editor/controls/segmented-select.tsx apps/admin/src/editor/controls/registry.ts apps/admin/test/controls-segmented.test.tsx
git commit -m "feat(admin): SegmentedSelect control (toggle-group for small enums)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Position9 — 3×3 grid picker

**Files:**
- Create: `apps/admin/src/editor/controls/position9.tsx`
- Modify: `apps/admin/src/editor/controls/registry.ts` (`position9`)
- Test: `apps/admin/test/controls-position9.test.tsx` (create)

**Interfaces:**
- Produces: `Position9` (ControlProps) — a 3×3 grid of the nine position enum values; clicking a cell emits that value; the active cell is visually marked.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/controls-position9.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Position9 } from '../src/editor/controls/position9'

const meta = { name: 'textPosition', apiBase: '', onPickMedia: vi.fn() }

describe('Position9', () => {
  it('renders 9 cells and emits the clicked position', () => {
    const onChange = vi.fn()
    render(<Position9 value="center" onChange={onChange} meta={meta} />)
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    fireEvent.click(screen.getByRole('radio', { name: 'bottom-right' }))
    expect(onChange).toHaveBeenCalledWith('bottom-right')
  })

  it('marks the active cell', () => {
    render(<Position9 value="top-left" onChange={vi.fn()} meta={meta} />)
    expect(screen.getByRole('radio', { name: 'top-left' })).toHaveAttribute('aria-checked', 'true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test controls-position9`
Expected: FAIL — `position9` not found.

- [ ] **Step 3: Implement Position9**

Create `apps/admin/src/editor/controls/position9.tsx`:

```tsx
import type { ControlProps } from './types'

const CELLS = [
  'top-left','top-center','top-right',
  'middle-left','center','middle-right',
  'bottom-left','bottom-center','bottom-right',
] as const

export function Position9({ value, onChange, meta }: ControlProps) {
  const current = String(value ?? 'center')
  return (
    <div role="radiogroup" aria-label={meta.name}
      className="grid w-[84px] grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1">
      {CELLS.map((c) => {
        const active = c === current
        return (
          <button key={c} type="button" role="radio" aria-checked={active} aria-label={c}
            onClick={() => onChange(c)}
            className={`size-6 rounded-sm transition-colors ${active ? 'bg-foreground' : 'bg-foreground/15 hover:bg-foreground/30'}`} />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Register it**

In `apps/admin/src/editor/controls/registry.ts`: `import { Position9 } from './position9'` and set `position9: Position9`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test controls-position9 && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/controls/position9.tsx apps/admin/src/editor/controls/registry.ts apps/admin/test/controls-position9.test.tsx
git commit -m "feat(admin): Position9 3x3 grid control

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Align control — shared width/alignment, reused by the image block

**Files:**
- Create: `apps/admin/src/editor/controls/align.tsx`
- Modify: `apps/admin/src/editor/controls/registry.ts` (`align`)
- Modify: `apps/admin/src/editor/extensions/ImageBlock.tsx` (reuse the control)
- Test: `apps/admin/test/controls-align.test.tsx` (create)

**Interfaces:**
- Produces: `AlignControl` (ControlProps) — an icon/label `ToggleGroup` over `meta.options` (default `['none','wide','full']` if absent); emits the chosen value.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/controls-align.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlignControl } from '../src/editor/controls/align'

const meta = (options?: string[]) => ({ name: 'width', options, apiBase: '', onPickMedia: vi.fn() })

describe('AlignControl', () => {
  it('renders the provided options and emits on click', () => {
    const onChange = vi.fn()
    render(<AlignControl value="none" onChange={onChange} meta={meta(['none','wide','full'])} />)
    fireEvent.click(screen.getByRole('radio', { name: 'full' }))
    expect(onChange).toHaveBeenCalledWith('full')
  })

  it('defaults to none/wide/full when options absent', () => {
    render(<AlignControl value="none" onChange={vi.fn()} meta={meta()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test controls-align`
Expected: FAIL — `align` control not found.

- [ ] **Step 3: Implement AlignControl**

Create `apps/admin/src/editor/controls/align.tsx`:

```tsx
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ControlProps } from './types'

const DEFAULT_OPTIONS = ['none', 'wide', 'full']

export function AlignControl({ value, onChange, meta }: ControlProps) {
  const options = meta.options ?? DEFAULT_OPTIONS
  return (
    <ToggleGroup type="single" value={String(value ?? options[0])}
      onValueChange={(v) => { if (v) onChange(v) }}
      className="justify-start gap-1" aria-label={meta.name}>
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} aria-label={o} className="px-2.5 text-xs capitalize">{o}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
```

- [ ] **Step 4: Register it**

In `apps/admin/src/editor/controls/registry.ts`: `import { AlignControl } from './align'` and set `align: AlignControl`.

- [ ] **Step 5: Reuse it in the image block node-view**

In `apps/admin/src/editor/extensions/ImageBlock.tsx`, replace the bespoke `ALIGNMENTS.map(...)` `<button className="bp-align">` toolbar with the shared control (keep the existing `setAttrs`):

```tsx
import { AlignControl } from '../controls/align'
// ...inside the node view, where the bespoke align buttons were:
<AlignControl
  value={align}
  onChange={(v) => setAttrs({ align: String(v) })}
  meta={{ name: 'align', options: ['none','left','right','wide','full'], apiBase: '', onPickMedia: () => {} }}
/>
```

Remove the now-unused `ALIGNMENTS` constant and the `.bp-align` button markup. (Leave `.bp-label` "Align" caption.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test controls-align && pnpm --filter @setu/admin typecheck`
Expected: PASS. Run `pnpm --filter @setu/admin test image` if an image-block test exists → still PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/controls/align.tsx apps/admin/src/editor/controls/registry.ts apps/admin/src/editor/extensions/ImageBlock.tsx apps/admin/test/controls-align.test.tsx
git commit -m "feat(admin): shared AlignControl; image block reuses it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Grouping — render Content/Layout/Style sections

**Files:**
- Modify: `apps/admin/src/editor/BlockInspector.tsx`
- Test: `apps/admin/test/inspector-groups.test.tsx` (create)

**Interfaces:**
- Consumes: `block.editor?.groups` (Task 1 type). Produces: the rail renders one labeled `<section>` per group (always-open); a single implicit "Content" group when `groups` is absent; controls listed in no group append to the first section; hidden-by-`showWhen` controls drop out and an all-hidden group renders nothing.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/inspector-groups.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockInspector } from '../src/editor/BlockInspector'

// hero is a registered block with groups (Task 8). For this test we rely on hero's
// groups; if Task 8 not yet merged, this test is written against hero and will pass once both land.
describe('BlockInspector grouping', () => {
  it('renders group headers for a grouped block', () => {
    render(<BlockInspector tag="hero" mdAttrs={{ headline: 'Hi', layout: 'centered' }} onChange={vi.fn()} apiBase="" />)
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Layout')).toBeInTheDocument()
  })

  it('hides the Style group when its controls are all gated off (layout != background)', () => {
    render(<BlockInspector tag="hero" mdAttrs={{ headline: 'Hi', layout: 'centered' }} onChange={vi.fn()} apiBase="" />)
    expect(screen.queryByText('Style')).toBeNull()
  })
})
```

(This test depends on Task 8's hero groups. Sequence Task 8 before re-running if executing strictly in order; the assertion is correct either way.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test inspector-groups`
Expected: FAIL — no group headers rendered (flat list).

- [ ] **Step 3: Implement grouping in BlockInspector**

Replace the `return (...)` block of `apps/admin/src/editor/BlockInspector.tsx` with a grouped renderer. Insert after the `visible` computation:

```tsx
  const byName = new Map(visible.map((c) => [c.name, c]))
  const declared = block.editor?.groups
  const groups = declared
    ? declared.map((g) => ({ label: g.label, controls: g.controls.map((n) => byName.get(n)).filter(Boolean) as typeof visible }))
    : [{ label: 'Content', controls: visible }]
  // Controls not named in any declared group append to the first section.
  if (declared) {
    const named = new Set(declared.flatMap((g) => g.controls))
    const orphans = visible.filter((c) => !named.has(c.name))
    if (orphans.length && groups[0]) groups[0].controls.push(...orphans)
  }
  const renderControl = (c: (typeof visible)[number]) => {
    const Control = controlRegistry[c.control]
    return (
      <div key={c.name} className="flex flex-col gap-1.5">
        <Label htmlFor={`bi-${c.name}`} className="capitalize">{c.name}</Label>
        <Control value={mdAttrs[c.name] ?? c.default} onChange={(v) => onChange(c.name, v)}
          meta={{ name: c.name, options: c.options, default: c.default, apiBase, onPickMedia: setPickFor }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.filter((g) => g.controls.length > 0).map((g) => (
        <section key={g.label} className="flex flex-col gap-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
          {g.controls.map(renderControl)}
        </section>
      ))}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
```

Remove the now-replaced flat `.map` return body.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test inspector-groups && pnpm --filter @setu/admin typecheck`
Expected: PASS (after Task 8 hero groups exist). If running before Task 8, proceed and re-verify after Task 8.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/BlockInspector.tsx apps/admin/test/inspector-groups.test.tsx
git commit -m "feat(admin): grouped inspector sections (always-open, showWhen-aware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Rail shell polish

**Files:**
- Modify: `apps/admin/src/editor/BlockInspector.tsx` (header), and the inspector container in its parent (locate via `grep -rn "BlockInspector" apps/admin/src`).
- Test: `apps/admin/test/inspector-groups.test.tsx` (extend — header text)

**Interfaces:** purely presentational; no new exports.

- [ ] **Step 1: Add a header test**

Append to `apps/admin/test/inspector-groups.test.tsx`:

```tsx
it('shows the block label header', () => {
  render(<BlockInspector tag="hero" mdAttrs={{ headline: 'Hi', layout: 'centered' }} onChange={() => {}} apiBase="" />)
  expect(screen.getByText(/hero/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test inspector-groups`
Expected: FAIL — no header yet.

- [ ] **Step 3: Add the header + spacing polish**

In `BlockInspector.tsx`, wrap the return in a header + body. At the top of the outer `<div>`:

```tsx
    <div className="flex flex-col gap-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Block · {block.editor?.label ?? tag}
      </div>
      {groups.filter((g) => g.controls.length > 0).map((g) => ( /* ...as Task 6... */ ))}
      {/* MediaPickerModal ... */}
    </div>
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @setu/admin test inspector-groups && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/BlockInspector.tsx apps/admin/test/inspector-groups.test.tsx
git commit -m "feat(admin): inspector rail header + section spacing polish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Hero contract — groups + align/width + control hints

**Files:**
- Modify: `packages/core/src/blocks/standard/hero.ts`
- Test: `packages/core/test/hero-contract.test.ts` (create)

**Interfaces:**
- Produces: hero props gain `width: z.enum(['none','wide','full']).default('none')`; `controls` map sets `textPosition: 'position9'`, `width: 'align'`, plus existing; `groups` = Content/Layout/Style.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/hero-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { heroBlock } from '../src/blocks/standard/hero'
import { resolveControls } from '../src/blocks/resolve-controls'

describe('hero contract', () => {
  it('uses position9 for textPosition and align for width', () => {
    const out = resolveControls(heroBlock.contract.props, heroBlock.contract.editor!.controls)
    expect(out.find((c) => c.name === 'textPosition')!.control).toBe('position9')
    expect(out.find((c) => c.name === 'width')!.control).toBe('align')
  })
  it('declares Content/Layout/Style groups', () => {
    const labels = heroBlock.contract.editor!.groups!.map((g) => g.label)
    expect(labels).toEqual(['Content', 'Layout', 'Style'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test hero-contract`
Expected: FAIL — no `width` prop / no `groups`.

- [ ] **Step 3: Update the hero contract**

In `packages/core/src/blocks/standard/hero.ts`, add the `width` prop to the `z.object`, extend `controls`, and add `groups`:

```ts
      // in props:
      width: z.enum(['none', 'wide', 'full']).default('none'),
      // in editor.controls:
      headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url',
      layout: 'select', textPosition: 'position9', width: 'align', overlayColor: 'color', parallax: 'switch',
      // add after showWhen:
      groups: [
        { id: 'content', label: 'Content', controls: ['headline', 'subhead', 'image', 'ctaLabel', 'ctaHref'] },
        { id: 'layout', label: 'Layout', controls: ['layout', 'textPosition', 'width'] },
        { id: 'style', label: 'Style', controls: ['overlayColor', 'parallax'] },
      ],
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/core test hero-contract && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blocks/standard/hero.ts packages/core/test/hero-contract.test.ts
git commit -m "feat(core): hero adopts position9/align + width prop + inspector groups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Hero renderer polish (site + canvas)

**Files:**
- Modify: `packages/blocks/src/hero/hero-classes.ts` (add `width` → class)
- Modify: `packages/blocks/src/hero/Hero.astro`, `packages/blocks/src/hero/Hero.tsx` (consume `width`)
- Modify: `packages/blocks/src/hero/hero.css` (width rules + craft pass)
- Modify: `apps/admin/src/editor/extensions/HeroBlock.tsx` (pass `width`)
- Test: `packages/blocks/test/hero-classes.test.ts` (extend or create)

**Interfaces:**
- Produces: `heroClasses(layout, textPosition, width)` appends `w-<width>`; CSS `.blk-hero.w-wide`/`.w-full` constrain/relax max-width matching the image block's wide/full semantics.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/blocks/test/hero-classes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { heroClasses } from '../src/hero/hero-classes'

describe('heroClasses width', () => {
  it('appends the width class', () => {
    expect(heroClasses('centered', 'center', 'full')).toContain('w-full')
    expect(heroClasses('centered', 'center', 'wide')).toContain('w-wide')
  })
  it('omits width class for none/undefined', () => {
    expect(heroClasses('centered', 'center', 'none')).not.toMatch(/\bw-/)
    expect(heroClasses('centered', 'center')).not.toMatch(/\bw-/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/blocks test hero-classes`
Expected: FAIL — `heroClasses` takes 2 args / no width class.

- [ ] **Step 3: Add width to heroClasses**

In `packages/blocks/src/hero/hero-classes.ts`, extend the signature:

```ts
export function heroClasses(layout: HeroLayout, textPosition: string, width?: string): string {
  const w = width && width !== 'none' ? ` w-${width}` : ''
  return `blk-hero layout-${layout} pos-${textPosition}${w}`
}
```

- [ ] **Step 4: Consume width in renderers**

In `packages/blocks/src/hero/Hero.astro` and `Hero.tsx`, read `width` from props and pass it to `heroClasses(layout, textPosition, width)`. In `apps/admin/src/editor/extensions/HeroBlock.tsx`, pass `width={md['width'] ? String(md['width']) : undefined}` to `<Hero>` and add `width?: string` to the props it forwards.

- [ ] **Step 5: Add width CSS + craft pass**

Append to `packages/blocks/src/hero/hero.css`:

```css
/* ── Width (mirrors the image block: none = content width, wide = breakout, full = bleed) ── */
.blk-hero { max-width: 72rem; margin-inline: auto; }
.blk-hero.w-wide { max-width: 90rem; }
.blk-hero.w-full { max-width: none; border-radius: 0; }
```

Craft pass (tighten the defaults already in `hero.css`): confirm headline `text-wrap: balance;` on `.blk-hero-headline`, and `gap`/`padding` use the existing clamp scale. (Visual — verified live in Task 10.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @setu/blocks test hero-classes && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/blocks/src/hero apps/admin/src/editor/extensions/HeroBlock.tsx packages/blocks/test/hero-classes.test.ts
git commit -m "feat(blocks): hero width (none/wide/full) + renderer craft pass

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Live UAT gate (Definition of Done)

**Files:** none (verification only). Uses the running dev stack (admin :5173, api :4444, site :4321).

- [ ] **Step 1: Full check + typecheck**

Run: `pnpm -r typecheck && pnpm --filter @setu/core test && pnpm --filter @setu/admin test && pnpm --filter @setu/blocks test`
Expected: all PASS.

- [ ] **Step 2: Drive the editor live**

Open http://localhost:5173, edit a page, insert `/hero`, select it. In the rail confirm: a **Block · Hero** header; **Content / Layout / Style** sections; headline/subhead/cta as inputs; **image** shows "Choose from library" → opens the media library → picking shows a thumbnail with Replace/Remove; **layout** is a segmented toggle; **textPosition** is a 3×3 grid that moves the text; **width** is a none/wide/full toggle; **overlay color + parallax** appear only when layout = background. Switch light/dark.

- [ ] **Step 3: Verify the site render**

Save, open http://localhost:4321/page/<slug>. Confirm the hero renders with the chosen layout, position, width, overlay, and a responsive `srcset` image. Shrink the viewport → a smaller image variant loads.

- [ ] **Step 4: Self-critique (DoD rule 6)**

Confirm: driven live ✓, matches the agreed design ✓, reuses MediaPickerModal + shared AlignControl ✓, no skeleton (every control purpose-built, sections grouped, renderer polished) ✓. If any "no", return to the relevant task.

- [ ] **Step 5: Mark the plan done**

Update the progress ledger; the branch is ready for whole-branch review (include the polish + UAT verdict per CLAUDE.md).
