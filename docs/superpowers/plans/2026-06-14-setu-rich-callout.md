# Rich Callout (titled, config-driven variants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the callout into a titled admonition with config-driven variants — one `{% callout %}` block whose `type` selects a tone+icon, plus an optional inline title and icon override, authored via a toolbar and round-tripping to Markdoc losslessly.

**Architecture:** The callout node's `mdAttrs` bag already round-trips verbatim, so `type`/`title`/`icon` need NO converter change. A new `editor.variants` config field lists the selectable types; the editor maps each to a default-theme `{tone, icon, label}`. The node view renders a header (icon + editable title) + body (`NodeViewContent`) + a `:focus-within` toolbar (tone swatches + icon picker). The round-trip guard is extended to prove a titled/typed callout survives.

**Tech Stack:** React 18, Tiptap v3 (StarterKit + custom Callout), `@setu/core` config, Vitest + jsdom.

**Strict TS:** `verbatimModuleSyntax` (`import type`), `noUncheckedIndexedAccess`. Verify each task with `pnpm --filter @setu/admin test` + `typecheck`; repo-wide `pnpm test` at the end.

**Schema ground truth (do NOT change):** `packages/core/src/markdoc/to-markdoc.ts` serializes a callout as `new N('tag', mdAttrs, children, 'callout')` → `{% callout <attrs> %}…{% /callout %}`. So any keys in `mdAttrs` (type/title/icon) serialize as tag attributes automatically. The Callout node stays `group:'block'`, `content:'block+'`, `mdAttrs` JSON-only.

---

### Task 1: Config variants + the callout-variants helper

**Files:**
- Modify: `packages/core/src/config/types.ts` (add `variants?` to `BlockEditorMeta`)
- Modify: `packages/core/src/config/default-config.ts` (permissive callout props + `editor.variants`)
- Create: `apps/admin/src/editor/callout-variants.ts`
- Test: `apps/admin/test/callout-variants.test.tsx`

- [ ] **Step 1: Add `variants?: string[]` to `BlockEditorMeta`**

In `packages/core/src/config/types.ts`, extend the interface (keep existing fields):
```ts
export interface BlockEditorMeta {
  label?: string
  icon?: string
  group?: string
  /** Selectable variant values for the block (e.g. callout types), shown in the
   *  editor's variant picker. The editor maps each to a theme tone/icon. */
  variants?: string[]
}
```

- [ ] **Step 2: Expand the default callout config**

In `packages/core/src/config/default-config.ts`, change the callout block (keep the rest of the file, incl. `defaultKnownBlockTags`):
```ts
    {
      tag: 'callout',
      // Permissive props — attribute-value validation is a later increment; the
      // editor offers the `editor.variants` set, the renderer/theme interprets them.
      props: z.object({
        type: z.string().optional(),
        title: z.string().optional(),
        icon: z.string().optional(),
      }),
      component: './src/components/Callout.astro',
      editor: {
        label: 'Callout',
        icon: 'info',
        group: 'Blocks',
        variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
      },
    },
```

- [ ] **Step 3: Run core tests — fix any that asserted the old callout zod**

Run: `pnpm --filter @setu/core test`
If a config test asserted the callout's `type` enum (e.g. that `type:'info'` validates or `type:'bogus'` throws), UPDATE it to the new permissive schema (a string `type` now validates; there's no enum rejection). Keep `resolveConfig(defaultConfig)` working and `defaultKnownBlockTags` = `Set(['callout'])` (unchanged — it derives from `tag`, not props). Re-run until green. Report which tests you updated.

- [ ] **Step 4: Write the failing variants test**

`apps/admin/test/callout-variants.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { calloutVariants, variantFor, CALLOUT_ICONS } from '../src/editor/callout-variants'

describe('callout variants', () => {
  it('derives one variant per config editor.variants entry, with tone+icon+label', () => {
    const vs = calloutVariants()
    expect(vs.map((v) => v.type)).toEqual(['info', 'note', 'success', 'warning', 'danger', 'neutral'])
    const success = vs.find((v) => v.type === 'success')
    expect(success?.tone).toBe('green')
    expect(typeof success?.icon).toBe('string')
    expect(typeof success?.label).toBe('string')
  })

  it('falls back to a neutral tone for an unknown type', () => {
    const v = variantFor('totally-unknown')
    expect(v.tone).toBe('neutral')
    expect(v.type).toBe('totally-unknown')
  })

  it('offers a non-empty curated icon set', () => {
    expect(CALLOUT_ICONS.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: Run — expect FAIL.** `pnpm --filter @setu/admin test -- callout-variants`

- [ ] **Step 6: Implement `callout-variants.ts`**

`apps/admin/src/editor/callout-variants.ts`:
```ts
import type { IconName } from '../ui/Icon'
import { isIconName } from '../ui/Icon'
import { defaultConfig, resolveConfig } from '@setu/core'

export interface CalloutVariant {
  type: string
  label: string
  /** CSS tone suffix: accent | green | amber | red | slate | neutral. */
  tone: string
  /** Default icon for the type (the theme's default-theme mapping). */
  icon: IconName
}

// Default-theme presentation per callout type. The set of allowed types is
// config-driven (editor.variants); this map supplies each type's tone+icon+label.
const VARIANT_MAP: Record<string, { label: string; tone: string; icon: IconName }> = {
  info: { label: 'Info', tone: 'accent', icon: 'info' },
  note: { label: 'Note', tone: 'neutral', icon: 'sparkle' },
  success: { label: 'Success', tone: 'green', icon: 'check' },
  warning: { label: 'Warning', tone: 'amber', icon: 'alert' },
  danger: { label: 'Danger', tone: 'red', icon: 'alert' },
  neutral: { label: 'Neutral', tone: 'neutral', icon: 'sparkle' },
}

const NEUTRAL = { label: 'Neutral', tone: 'neutral', icon: 'sparkle' as IconName }

/** Icons offered in the callout icon-override picker (curated). */
export const CALLOUT_ICONS: IconName[] = ['info', 'check', 'alert', 'sparkle', 'zap', 'pin', 'lock', 'settings']

function configVariantTypes(): string[] {
  const callout = resolveConfig(defaultConfig).blocksByTag.get('callout')
  const variants = callout?.editor?.variants
  return Array.isArray(variants) && variants.length ? variants : Object.keys(VARIANT_MAP)
}

export function variantFor(type: string): CalloutVariant {
  const v = VARIANT_MAP[type] ?? NEUTRAL
  return { type, label: v.label, tone: v.tone, icon: v.icon }
}

export function calloutVariants(): CalloutVariant[] {
  return configVariantTypes().map((t) => variantFor(t))
}
```
IMPORTANT — icon names: every icon used in `VARIANT_MAP` and `CALLOUT_ICONS` MUST be a valid `IconName` (check `apps/admin/src/ui/Icon.tsx`'s ICONS). `info`, `sparkle`, `zap`, `pin`, `lock`, `settings` should already exist. If `check` and/or `alert` do NOT exist in ICONS, add them to BOTH `apps/admin/src/ui/Icon.tsx` AND `design/admin/components.jsx` (byte-identical, per the verbatim-port invariant), using proper Lucide-style stroke paths:
- `check`: `'<path d="M20 6 9 17l-5-5"/>'`
- `alert`: `'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'`
Report which icons you added (if any). If you prefer existing icons over adding, you may map `warning`/`danger` to an existing icon and `success` to an existing one — but `check` for success and `alert` for warning/danger are strongly preferred for clarity; adding them (synced to the design source) is the right call. Confirm `isIconName` is exported from `Icon.tsx` (it was added in #11); if not, export it.

- [ ] **Step 7: Run — expect PASS.** `pnpm --filter @setu/admin test -- callout-variants && pnpm --filter @setu/admin typecheck`

- [ ] **Step 8: Commit**
```bash
git add packages/core/src/config/types.ts packages/core/src/config/default-config.ts apps/admin/src/editor/callout-variants.ts apps/admin/test/callout-variants.test.tsx apps/admin/src/ui/Icon.tsx design/admin/components.jsx
git commit -m "feat(callout): config-driven variants (editor.variants) + default-theme tone/icon map"
```

---

### Task 2: Rebuild the Callout node (titled header + body + toolbar) + extend the guard + slash insert

**Files:**
- Modify: `apps/admin/src/editor/extensions/Callout.tsx`
- Modify: `apps/admin/src/editor/blocks.ts` (slash insert)
- Test: `apps/admin/test/editor-schema.test.tsx` (extend guard) + `apps/admin/test/callout-node.test.tsx` (new)

- [ ] **Step 1: Extend the round-trip guard test**

In `apps/admin/test/editor-schema.test.tsx`, ADD a test (keep the existing one):
```tsx
  it('preserves a titled/typed/iconned callout through getJSON + round-trips', () => {
    const SRC =
      '{% callout type="success" title="Success & Prosperity" icon="check" %}\n' +
      'Body text.\n' +
      '{% /callout %}\n\n' +
      'After.\n'
    const editor = new Editor({ extensions: [StarterKit, Callout, Passthrough], content: markdocToTiptap(SRC) })
    const json = editor.getJSON() as TiptapDoc
    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs).toEqual({ type: 'success', title: 'Success & Prosperity', icon: 'check' })
    expect(tiptapToMarkdoc(json)).toBe(SRC)
    editor.destroy()
  })

  it('a plain callout (no attrs) still round-trips', () => {
    const SRC = '{% callout %}\nJust body.\n{% /callout %}\n\nAfter.\n'
    const editor = new Editor({ extensions: [StarterKit, Callout, Passthrough], content: markdocToTiptap(SRC) })
    expect(tiptapToMarkdoc(editor.getJSON() as TiptapDoc)).toBe(SRC)
    editor.destroy()
  })
```

- [ ] **Step 2: Run — expect the new titled-callout test to behave per current code** (the existing Callout already preserves arbitrary `mdAttrs`, so these may already PASS — that's fine; they lock the behavior in before the node-view rebuild). `pnpm --filter @setu/admin test -- editor-schema`. If the titled test FAILS on the round-trip string (e.g. attribute order), inspect `tiptapToMarkdoc` output and align the SRC's attribute order to what Markdoc.format emits (Markdoc preserves the object key order of `mdAttrs`; `markdocToTiptap` builds `mdAttrs` from the parsed tag's attributes in source order, so `type,title,icon` order should match). Adjust SRC ordering to match the emitted order if needed — do NOT weaken the assertion.

- [ ] **Step 3: Write the node-view behavior test**

`apps/admin/test/callout-node.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../src/editor/extensions/Callout'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout],
    content: { type: 'doc', content: [{ type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('Callout node view', () => {
  it('renders a title input and the body, and editing the title updates mdAttrs.title', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    fireEvent.change(title, { target: { value: 'Heads up' } })
    const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs?.title).toBe('Heads up')
  })
})
```

- [ ] **Step 4: Run — expect FAIL** (no title input yet). `pnpm --filter @setu/admin test -- callout-node`

- [ ] **Step 5: Rebuild the Callout node view**

Replace the `CalloutView` component (and keep the `Node.create` config below it; only the view + imports change) in `apps/admin/src/editor/extensions/Callout.tsx`:
```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'
import { isIconName } from '../../ui/Icon'
import { calloutVariants, variantFor, CALLOUT_ICONS } from '../callout-variants'

function CalloutView({ node, updateAttributes }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const type = String(mdAttrs['type'] ?? 'info')
  const title = String(mdAttrs['title'] ?? '')
  const variant = variantFor(type)
  const overrideIcon = mdAttrs['icon']
  const icon: IconName = typeof overrideIcon === 'string' && isIconName(overrideIcon) ? overrideIcon : variant.icon

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['title'] === '') delete next['title']
    if (next['icon'] === '') delete next['icon']
    updateAttributes({ mdAttrs: next })
  }

  // Keep editor focus when clicking toolbar buttons (so :focus-within keeps the
  // toolbar open and selection isn't lost).
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

  return (
    <NodeViewWrapper className={`blk-callout tone-${variant.tone}`} aria-label="Callout block">
      <div className="block-props" contentEditable={false}>
        <span className="bp-label">Tone</span>
        {calloutVariants().map((v) => (
          <button
            key={v.type}
            type="button"
            className={`bp-swatch tone-${v.tone}${type === v.type ? ' on' : ''}`}
            title={v.label}
            aria-label={v.label}
            onMouseDown={keepFocus}
            onClick={() => setAttrs({ type: v.type })}
          />
        ))}
        <span className="bp-sep" />
        {CALLOUT_ICONS.map((ic) => (
          <button
            key={ic}
            type="button"
            className={`bp-icon${icon === ic ? ' on' : ''}`}
            title={ic}
            aria-label={`Icon ${ic}`}
            onMouseDown={keepFocus}
            onClick={() => setAttrs({ icon: ic })}
          >
            <Icon name={ic} size={15} />
          </button>
        ))}
      </div>
      <div className="callout-head" contentEditable={false}>
        <span className="callout-ic"><Icon name={icon} size={18} /></span>
        <input
          className="callout-title"
          placeholder="Add a title…"
          value={title}
          onChange={(e) => setAttrs({ title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}
```
Keep the existing `export const Callout = Node.create({ ... })` EXACTLY as-is (name `callout`, group `block`, content `block+`, `defining:true`, `mdAttrs` attr JSON-only, parseHTML/renderHTML, `addNodeView: () => ReactNodeViewRenderer(CalloutView)`). Only the view + imports change. The `mdAttrs` attribute already preserves type/title/icon — do NOT add separate attrs.

Notes: the title `<input>` calls `e.stopPropagation()` on keydown so ProseMirror doesn't treat Backspace/Enter as doc edits while typing the title. The toolbar buttons use `onMouseDown preventDefault` so clicking them doesn't blur the editor (keeps `:focus-within` true and the toolbar visible). The toolbar visibility is CSS-driven (`:focus-within`, Task 3).

- [ ] **Step 6: Update the slash insert to a typed callout**

In `apps/admin/src/editor/blocks.ts`, the config-block insert currently inserts `{ type: b.tag, attrs: { mdAttrs: {} }, content: [{ type: 'paragraph' }] }`. Change the callout insert to seed `type: 'info'`:
```ts
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: b.tag, attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph' }] })
        .run(),
```
(Only the `mdAttrs` default changes from `{}` to `{ type: 'info' }`.)

- [ ] **Step 7: Run — expect PASS.** `pnpm --filter @setu/admin test -- editor-schema callout-node && pnpm --filter @setu/admin typecheck`
If the `callout-node` test can't find the title input because the React node view doesn't mount in jsdom, ensure the test renders via the real `useEditor`/`EditorContent` (as written) and that `test/setup.ts`'s `elementFromPoint` stub is present (added in #11). Do not weaken the assertion.

- [ ] **Step 8: Commit**
```bash
git add apps/admin/src/editor/extensions/Callout.tsx apps/admin/src/editor/blocks.ts apps/admin/test/editor-schema.test.tsx apps/admin/test/callout-node.test.tsx
git commit -m "feat(callout): titled node view (icon+title header, body) + variant toolbar"
```

---

### Task 3: CSS — titled callout layout + the six tones + the toolbar

**Files:**
- Modify: `apps/admin/src/styles/editor.css`

- [ ] **Step 1: Replace the callout CSS block**

In `apps/admin/src/styles/editor.css`, REPLACE the current `.blk-callout` … `.callout-text` rules (the `/* ---- CALLOUT ---- */` section + the `.callout-text > [data-node-view-content-react]` rule) with the titled layout below. Port the `.block-props`/`.bp-*` values from `design/admin/editor.css` where present; verify every `var(--…)` exists in `tokens.css` (substitute nearest + comment if not — esp. `--slate`/dark tone; if no slate token, use a dark surface token or `color-mix`):
```css
/* ---- CALLOUT (titled admonition) ---- */
.blk-callout { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 15px 16px; border-radius: var(--r-md); margin: 12px 0; font-family: var(--font-ui); }
.blk-callout.tone-accent { background: var(--accent-soft); }
.blk-callout.tone-green { background: var(--green-soft); }
.blk-callout.tone-amber { background: var(--amber-soft); }
.blk-callout.tone-red { background: var(--red-soft); }
.blk-callout.tone-neutral { background: var(--surface-2); }
.blk-callout.tone-slate { background: color-mix(in oklch, var(--text) 88%, var(--bg)); color: #fff; }

.callout-head { display: flex; align-items: center; gap: 10px; }
.callout-ic { flex-shrink: 0; width: 30px; height: 30px; border-radius: var(--r-sm); display: grid; place-items: center; border: none; background: color-mix(in oklch, var(--canvas) 55%, transparent); }
.tone-accent .callout-ic { color: var(--accent-strong); }
.tone-green .callout-ic { color: var(--green); }
.tone-amber .callout-ic { color: var(--amber); }
.tone-red .callout-ic { color: var(--red); }
.tone-neutral .callout-ic { color: var(--text-2); }
.tone-slate .callout-ic { color: #fff; background: color-mix(in oklch, #fff 16%, transparent); }

.callout-title { flex: 1; min-width: 0; border: none; background: transparent; outline: none; font-family: var(--font-ui); font-size: 18px; font-weight: 700; letter-spacing: -.01em; color: inherit; padding: 0; }
.callout-title::placeholder { color: var(--text-4); font-weight: 600; }
.tone-slate .callout-title::placeholder { color: color-mix(in oklch, #fff 55%, transparent); }

.callout-body { font-size: 16px; line-height: 1.6; color: inherit; outline: none; }
.callout-body p { font-size: 16px; line-height: 1.6; margin: 0; padding: 2px 0; color: inherit; }
.callout-body > [data-node-view-content-react] { min-width: 0; }

/* ---- BLOCK PROPS TOOLBAR (shown when the callout has focus) ---- */
.block-props { position: absolute; top: -44px; left: 0; display: none; align-items: center; gap: 6px; padding: 6px 9px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r-sm); box-shadow: var(--shadow-pop); z-index: 40; }
.blk-callout:focus-within .block-props { display: flex; }
.bp-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-4); margin-right: 2px; }
.bp-swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.bp-swatch.tone-accent { background: var(--accent); }
.bp-swatch.tone-green { background: var(--green); }
.bp-swatch.tone-amber { background: var(--amber); }
.bp-swatch.tone-red { background: var(--red); }
.bp-swatch.tone-neutral { background: var(--text-3); }
.bp-swatch.tone-slate { background: var(--text); }
.bp-swatch.on { border-color: var(--text); }
.bp-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
.bp-icon { display: grid; place-items: center; width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--r-xs); color: var(--text-2); cursor: pointer; }
.bp-icon:hover { background: var(--surface-hover); color: var(--text); }
.bp-icon.on { background: var(--accent-soft); color: var(--accent-strong); }
```
NOTE on tokens: verify `--green-soft`/`--amber-soft`/`--red-soft`/`--accent-soft`/`--surface-2`/`--surface`/`--surface-hover`/`--border-strong`/`--shadow-pop`/`--text-2`/`--text-3`/`--text-4`/`--accent`/`--accent-strong`/`--green`/`--amber`/`--red`/`--canvas`/`--bg`/`--text`/`--r-sm`/`--r-xs`/`--r-md`/`--font-ui` all exist in `apps/admin/src/styles/tokens.css`. For any missing, substitute the nearest present token and add a `/* sub: X→Y */` comment. Report substitutions. (`tone-slate` is intentionally derived via `color-mix` from `--text` since there's likely no `--slate` token — fine.)

- [ ] **Step 2: Verify build, tests, fonts**
```bash
pnpm --filter @setu/admin test
pnpm --filter @setu/admin typecheck
pnpm --filter @setu/admin build
grep -c fonts.googleapis apps/admin/dist/index.html
```
Expected: all admin tests green; typecheck clean; build succeeds; fonts count > 0.

- [ ] **Step 3: Whole-repo green**
```bash
pnpm test && pnpm typecheck
```

- [ ] **Step 4: Commit**
```bash
git add apps/admin/src/styles/editor.css
git commit -m "feat(callout): titled-callout + six-tone + toolbar CSS"
```

---

## Self-Review

**Spec coverage:**
- One block, variant by `type`; allowed set from `editor.variants` (config) → Task 1. ✓
- Default config expanded (permissive props + icon + variants) + `BlockEditorMeta.variants` → Task 1. ✓
- `callout-variants.ts` (config-driven list + default-theme tone/icon/label, neutral fallback) → Task 1. ✓
- Titled node view (icon + editable title header + body) + inline toolbar (tone swatches + icon picker), `updateAttributes` with empty-key hygiene → Task 2. ✓
- Round-trip guard extended (typed+titled+icon byte-for-byte; plain callout) → Task 2. ✓
- Slash insert seeds `type:'info'` → Task 2. ✓
- CSS: titled layout + 6 tones + `:focus-within` toolbar → Task 3. ✓
- mdAttrs round-trips with NO converter change (cardinal rule, guarded) → Tasks 2. ✓
- Deferred (published-site tone rendering, Theme-API hooks, attr validation, other blocks' tones) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO. The icon-add and token-substitution steps are bounded reconciliations against named symbols with provided fallbacks, not vague placeholders.

**Type consistency:** `CalloutVariant {type,label,tone,icon:IconName}` + `variantFor`/`calloutVariants`/`CALLOUT_ICONS` (Task 1) consumed by the node view (Task 2). `BlockEditorMeta.variants` (Task 1) read by `configVariantTypes()`. `mdAttrs` keys `type`/`title`/`icon` written by the view and asserted by the guard. `isIconName` (from `Icon.tsx`, #11) used in both. Tone class names (`tone-accent/green/amber/red/neutral/slate`) consistent between the view's `variant.tone`, the CSS, and the swatch classes. ✓
