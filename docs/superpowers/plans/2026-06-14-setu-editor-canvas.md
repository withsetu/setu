# Tiptap Editor Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Tiptap block editor on `/edit/:collection/:locale/:slug` in `apps/admin`, wired onto the real read (#7) + authoring/lock (#4) services running in-browser, so a writer can open a draft, edit rich text + a Callout, see unknown Markdoc preserved, and have it autosave and survive a reopen.

**Architecture:** A new `@setu/git-memory` package (in-memory `GitPort`, contract-tested like `db-memory`) lets the read service run client-side. The app's store grows into a services context (`data`+`git`+`read`+`authoring`). The editor is Tiptap StarterKit + two custom nodes (`callout` with `mdAttrs`, `passthrough` atom with `raw`/`flagged`) whose schema is pinned to the converter in `packages/core/src/markdoc/{to-tiptap,to-markdoc}.ts` and guarded by a round-trip test. A config-driven slash menu inserts blocks; the editor screen orchestrates load → lock → debounced autosave.

**Tech Stack:** React 18, Vite 6, Tailwind v4, react-router v6, `@tiptap/{core,react,pm,starter-kit,suggestion}`, `@tiptap/extension-placeholder`, `tippy.js`, Vitest + jsdom + @testing-library/react. All editor deps are MIT/public-npm (no Tiptap SaaS).

**Key constraints:**
- `apps/admin/tsconfig.json` extends the strict base: `verbatimModuleSyntax` (use `import type`), `noUncheckedIndexedAccess` (guard indexed access). No `React.ReactNode` value imports — `import type { ReactNode }`.
- The schema MUST match the converter exactly: `callout` (group `block`, content `block+`, attr `mdAttrs`), `passthrough` (atom, attrs `raw`/`flagged`), built-in node/mark names already match StarterKit (incl. the `link` mark — Tiptap v3 StarterKit bundles Link, so do NOT add `@tiptap/extension-link` separately).
- `prototype/admin-editor/` is a PATTERN reference only. Its node attrs (`callout: inline*`, `passthrough: {label}`) are WRONG vs the engine — do not copy them.
- Never lose content (the CMS cardinal rule) — the round-trip guard test in Task 3 is the gate.

**Reference files to read when a task needs them:**
- `packages/core/src/markdoc/to-tiptap.ts` + `to-markdoc.ts` — the schema ground truth.
- `packages/db-memory/{package.json,tsconfig.json,vitest.config.ts,src/adapter.ts,src/index.ts,test/contract.test.ts}` — the package template Task 1 mirrors.
- `packages/git-testing/src/index.ts` — `runGitPortContract`.
- `design/admin/editor.css` + `design/admin/editor-meta.css` — the CSS to port in Task 6.

---

### Task 1: `@setu/git-memory` package (in-memory GitPort)

**Files:**
- Create: `packages/git-memory/package.json`
- Create: `packages/git-memory/tsconfig.json`
- Create: `packages/git-memory/vitest.config.ts`
- Create: `packages/git-memory/src/adapter.ts`
- Create: `packages/git-memory/src/index.ts`
- Test: `packages/git-memory/test/contract.test.ts`

- [ ] **Step 1: Scaffold the package files** (mirror `@setu/db-memory`)

`packages/git-memory/package.json`:
```json
{
  "name": "@setu/git-memory",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/git-testing": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/git-memory/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

`packages/git-memory/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 2: Write the failing contract + seed test**

`packages/git-memory/test/contract.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runGitPortContract } from '@setu/git-testing'
import { createMemoryGitPort } from '../src/index'

runGitPortContract(() => createMemoryGitPort())

describe('createMemoryGitPort seed', () => {
  it('applies seed files as initial commits (non-null head + readable)', async () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/hello.mdoc', content: '# Hello\n' }])
    expect(await git.headSha()).not.toBeNull()
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe('# Hello\n')
    expect(await git.readFile('missing.mdoc')).toBeNull()
  })
})
```

- [ ] **Step 3: Run from the repo root to install the new workspace package + verify it FAILS**

Run: `pnpm install && pnpm --filter @setu/git-memory test`
Expected: FAIL — `createMemoryGitPort` not found (adapter not written yet).

- [ ] **Step 4: Implement the adapter**

`packages/git-memory/src/adapter.ts`:
```ts
import type { CommitInput, CommitResult, GitPort } from '@setu/core'

/** A pre-existing file to seed into the repo at construction. */
export interface GitSeedFile {
  path: string
  content: string
}

// Deterministic 40-char hex digest (no Date.now/Math.random): 5 salted FNV-1a
// passes. Distinct per commit because the commit counter is mixed in.
function sha40(input: string): string {
  let out = ''
  for (let salt = 0; salt < 5; salt++) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

/** In-memory GitPort (Map-backed, browser-safe). HEAD is the working set after
 *  the latest commit; `readFile` returns the current content at a path. Optional
 *  `seed` files are applied as initial commits so `headSha` is non-null and the
 *  read service can fork from them. Behaviorally equivalent to `git-local`
 *  (proven by `runGitPortContract`). */
export function createMemoryGitPort(seed: GitSeedFile[] = []): GitPort {
  const files = new Map<string, string>()
  let head: string | null = null
  let counter = 0

  const apply = (path: string, content: string): string => {
    counter += 1
    files.set(path, content)
    head = sha40(`${counter}\0${head ?? ''}\0${path}\0${content}`)
    return head
  }

  for (const f of seed) apply(f.path, f.content)

  return {
    async headSha() {
      return head
    },
    async readFile(path: string) {
      return files.has(path) ? files.get(path)! : null
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      return { sha: apply(input.path, input.content) }
    },
  }
}
```

`packages/git-memory/src/index.ts`:
```ts
export { createMemoryGitPort } from './adapter'
export type { GitSeedFile } from './adapter'
```

- [ ] **Step 5: Run the tests + typecheck — verify PASS**

Run: `pnpm --filter @setu/git-memory test && pnpm --filter @setu/git-memory typecheck`
Expected: PASS — the 6 contract tests + the seed test green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/git-memory pnpm-lock.yaml
git commit -m "feat(git-memory): in-memory GitPort adapter (contract-tested)"
```

---

### Task 2: Services context in the admin app

**Files:**
- Modify: `apps/admin/package.json` (add deps)
- Modify: `apps/admin/src/data/store.tsx` (add services context; keep `useData`/`DataProvider` working)
- Test: `apps/admin/test/services.test.tsx` (new)

- [ ] **Step 1: Add dependencies**

Edit `apps/admin/package.json` `dependencies` to add (keep existing entries):
```json
    "@setu/git-memory": "workspace:*",
    "@tiptap/core": "^3.26.1",
    "@tiptap/react": "^3.26.1",
    "@tiptap/pm": "^3.26.1",
    "@tiptap/starter-kit": "^3.26.1",
    "@tiptap/suggestion": "^3.26.1",
    "@tiptap/extension-placeholder": "^3.26.1",
    "tippy.js": "^6.3.7"
```
Then run: `pnpm install`

- [ ] **Step 2: Write the failing services test**

`apps/admin/test/services.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ServicesProvider, createServices, useServices, useData } from '../src/data/store'

describe('services context', () => {
  it('exposes data + git + read + authoring from one provider', () => {
    const services = createServices()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}>{children}</ServicesProvider>
    )
    const { result } = renderHook(() => useServices(), { wrapper })
    expect(typeof result.current.read.loadForEdit).toBe('function')
    expect(typeof result.current.authoring.open).toBe('function')
    expect(typeof result.current.git.headSha).toBe('function')
    expect(typeof result.current.data.listDrafts).toBe('function')
  })

  it('useData() returns the same DataPort the services bundle holds', () => {
    const services = createServices()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}>{children}</ServicesProvider>
    )
    const { result } = renderHook(() => useData(), { wrapper })
    expect(result.current).toBe(services.data)
  })
})
```

- [ ] **Step 3: Run — verify it FAILS**

Run: `pnpm --filter @setu/admin test -- services`
Expected: FAIL — `ServicesProvider`/`createServices`/`useServices` not exported.

- [ ] **Step 4: Rewrite the store with a services context (back-compatible)**

Replace `apps/admin/src/data/store.tsx`:
```tsx
import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthoringService,
  DataPort,
  DraftInput,
  GitPort,
  ReadService,
  TiptapDoc,
} from '@setu/core'
import { createAuthoringService, createReadService } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Sample content so the admin has something to show before real persistence. */
export const seedDrafts: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'the-quiet-week', content: doc('The quiet week before a launch.'), metadata: { title: 'The quiet week before a launch', status: 'published' } },
  { collection: 'post', locale: 'en', slug: 'release-notes', content: doc('What shipped.'), metadata: { title: 'Release notes', status: 'draft' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('About us.'), metadata: { title: 'About', status: 'published' } },
]

/** The composed in-browser services the admin runs on. */
export interface Services {
  data: DataPort
  git: GitPort
  read: ReadService
  authoring: AuthoringService
}

/** Build the in-browser services bundle around a DataPort + GitPort. */
export function servicesFor(data: DataPort, git: GitPort): Services {
  return {
    data,
    git,
    read: createReadService({ data, git }),
    authoring: createAuthoringService({ data }),
  }
}

/** The app's default services: seeded in-memory adapters (swapped for real
 *  persistence later without touching the UI). */
export function createServices(): Services {
  return servicesFor(createMemoryDataPort(seedDrafts), createMemoryGitPort())
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext)
  if (ctx === null) throw new Error('useServices must be used within a ServicesProvider')
  return ctx
}

/** Back-compat accessor for screens that only need the DataPort (ContentList). */
export function useData(): DataPort {
  return useServices().data
}

/** Back-compat provider: builds a services bundle around a given DataPort so the
 *  existing content-list/smoke tests (which inject a DataPort) keep working. */
export function DataProvider({ adapter, children }: { adapter: DataPort; children: ReactNode }) {
  const services = useMemo(() => servicesFor(adapter, createMemoryGitPort()), [adapter])
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}

/** The app's DataPort (in-memory, seeded). Kept for main.tsx back-compat. */
export function createAppDataPort(): DataPort {
  return createMemoryDataPort(seedDrafts)
}
```

- [ ] **Step 5: Run the services test + the full admin suite — verify PASS**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — the new services tests green AND the existing 14 tests (content-list/smoke/sidebar/icon/status-pill) still green (they use `DataProvider`/`createAppDataPort`, now backed by the services context). Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/package.json apps/admin/src/data/store.tsx apps/admin/test/services.test.tsx pnpm-lock.yaml
git commit -m "feat(admin): services context (data+git+read+authoring) + Tiptap deps"
```

---

### Task 3: Tiptap schema — Callout + Passthrough nodes + the round-trip guard

**Files:**
- Create: `apps/admin/src/editor/extensions/Callout.tsx`
- Create: `apps/admin/src/editor/extensions/Passthrough.tsx`
- Test: `apps/admin/test/editor-schema.test.tsx`

- [ ] **Step 1: Write the failing round-trip guard test**

`apps/admin/test/editor-schema.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { TiptapDoc } from '@setu/core'
import { markdocToTiptap, tiptapToMarkdoc } from '@setu/core'
import { Callout } from '../src/editor/extensions/Callout'
import { Passthrough } from '../src/editor/extensions/Passthrough'

const SOURCE =
  '# Title\n\n' +
  'A **bold** and *italic* line with `code` and a [link](https://x.com).\n\n' +
  '- one\n- two\n\n' +
  '{% callout type="warning" %}\nHeads up.\n{% /callout %}\n\n' +
  '{% if $x %}\nsecret\n{% /if %}\n\n' +
  'Done.\n'

describe('editor schema round-trips through the Markdoc converter', () => {
  it('preserves every node + callout mdAttrs + passthrough raw/flagged via getJSON', () => {
    const editor = new Editor({ extensions: [StarterKit, Callout, Passthrough], content: markdocToTiptap(SOURCE) })
    const json = editor.getJSON() as TiptapDoc

    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs).toEqual({ type: 'warning' })

    const pass = json.content.find((n) => n.type === 'passthrough')
    expect(pass?.attrs).toEqual({ raw: '{% if $x %}\nsecret\n{% /if %}', flagged: false })

    // The full round-trip back to Markdoc reproduces the source byte-for-byte.
    expect(tiptapToMarkdoc(json)).toBe(SOURCE)
    editor.destroy()
  })
})
```

- [ ] **Step 2: Run — verify it FAILS**

Run: `pnpm --filter @setu/admin test -- editor-schema`
Expected: FAIL — `Callout`/`Passthrough` modules not found.

- [ ] **Step 3: Implement the Callout node**

`apps/admin/src/editor/extensions/Callout.tsx`:
```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Icon } from '../../ui/Icon'

function CalloutView() {
  return (
    <NodeViewWrapper className="blk-callout tone-accent" aria-label="Callout block">
      <span className="callout-ic" contentEditable={false}>
        <Icon name="sparkle" size={18} />
      </span>
      <NodeViewContent className="callout-text" />
    </NodeViewWrapper>
  )
}

/** The config `{% callout %}` block. Schema matches the converter
 *  (packages/core/src/markdoc/to-tiptap.ts): group 'block', block content, and an
 *  `mdAttrs` bag round-tripped verbatim (to-markdoc always serializes the tag as
 *  `{% callout %}`). `mdAttrs` is JSON-only (kept out of the DOM). Tone/icon
 *  pickers are deferred — the node preserves mdAttrs, it just can't change it yet. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      mdAttrs: {
        default: {},
        // Keep the attribute bag in the node's JSON only, not in the editor DOM.
        renderHTML: () => ({}),
        parseHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
```

- [ ] **Step 4: Implement the Passthrough node (never-drop chip)**

`apps/admin/src/editor/extensions/Passthrough.tsx`:
```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Icon } from '../../ui/Icon'

function PassthroughView({ node }: { node: { attrs: { raw: unknown; flagged: unknown } } }) {
  const raw = String(node.attrs.raw ?? '')
  const flagged = Boolean(node.attrs.flagged)
  return (
    <NodeViewWrapper className={`blk-dynamic${flagged ? ' is-flagged' : ''}`} contentEditable={false} aria-label="Preserved Markdoc block (read-only)">
      <div className="dyn-rail" />
      <div className="dyn-head">
        <span className="dyn-ic"><Icon name="zap" size={15} /></span>
        <span className="dyn-title">{flagged ? 'Unparsed Markdoc' : 'Advanced Markdoc'}</span>
        <span className="dyn-lock"><Icon name="lock" size={14} /></span>
      </div>
      <pre className="dyn-raw"><code>{raw}</code></pre>
    </NodeViewWrapper>
  )
}

/** Unknown/advanced Markdoc preserved verbatim (the never-drop guarantee).
 *  Atom (leaf) + `raw`/`flagged` attrs matching the converter; to-markdoc emits
 *  `raw` verbatim. Read-only (contentEditable=false) but selectable/deletable. */
export const Passthrough = Node.create({
  name: 'passthrough',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      raw: { default: '', renderHTML: () => ({}), parseHTML: () => ({}) },
      flagged: { default: false, renderHTML: () => ({}), parseHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-passthrough]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-passthrough': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PassthroughView)
  },
})
```

- [ ] **Step 5: Run — verify PASS**

Run: `pnpm --filter @setu/admin test -- editor-schema && pnpm --filter @setu/admin typecheck`
Expected: PASS. If `tiptapToMarkdoc(json) === SOURCE` fails because ProseMirror normalized the doc (e.g. appended a trailing empty paragraph), do NOT weaken the attr assertions — fix faithfully: the fixture already ends in a `Done.` paragraph to avoid a trailing-atom textblock; if a discrepancy remains, inspect `editor.getJSON()` and reconcile the node/attr handling so the serialization matches (the engine's converter is idempotent, so any gap is in the editor schema, which is exactly what this guards).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/extensions/Callout.tsx apps/admin/src/editor/extensions/Passthrough.tsx apps/admin/test/editor-schema.test.tsx
git commit -m "feat(admin): Callout + Passthrough Tiptap nodes matching the converter schema"
```

---

### Task 4: Config-driven slash menu

**Files:**
- Create: `apps/admin/src/editor/blocks.ts`
- Create: `apps/admin/src/editor/extensions/SlashCommand.tsx`
- Test: `apps/admin/test/slash.test.tsx`

- [ ] **Step 1: Write the failing slash-blocks test**

`apps/admin/test/slash.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../src/editor/extensions/Callout'
import { Passthrough } from '../src/editor/extensions/Passthrough'
import { slashBlocks } from '../src/editor/blocks'

describe('slashBlocks', () => {
  it('includes the built-ins and the config Callout block', () => {
    const titles = slashBlocks().map((b) => b.title)
    expect(titles).toContain('Heading 1')
    expect(titles).toContain('Callout')
  })

  it('the Callout block inserts a callout node', () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout, Passthrough],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const callout = slashBlocks().find((b) => b.title === 'Callout')
    expect(callout).toBeDefined()
    callout!.run(editor, { from: 1, to: 1 })
    expect(editor.getJSON().content?.some((n) => n.type === 'callout')).toBe(true)
    editor.destroy()
  })
})
```

- [ ] **Step 2: Run — verify it FAILS**

Run: `pnpm --filter @setu/admin test -- slash`
Expected: FAIL — `slashBlocks` not found.

- [ ] **Step 3: Implement the block list**

`apps/admin/src/editor/blocks.ts`:
```ts
import type { Editor, Range } from '@tiptap/core'
import type { IconName } from '../ui/Icon'
import { defaultConfig, resolveConfig } from '@setu/core'

export interface SlashBlock {
  title: string
  subtitle: string
  icon: IconName
  run: (editor: Editor, range: Range) => void
}

const BUILTINS: SlashBlock[] = [
  { title: 'Text', subtitle: 'Plain paragraph', icon: 'post', run: (e, r) => e.chain().focus().deleteRange(r).setNode('paragraph').run() },
  { title: 'Heading 1', subtitle: 'Large section heading', icon: 'pages', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', subtitle: 'Medium section heading', icon: 'pages', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { title: 'Bullet list', subtitle: 'Simple bulleted list', icon: 'forms', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: 'Numbered list', subtitle: 'Ordered list', icon: 'forms', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: 'Quote', subtitle: 'Block quote', icon: 'post', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: 'Code', subtitle: 'Code block', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
]

/** Insertable blocks = built-ins + the resolved config blocks (Callout). Each
 *  config block inserts a node of its tag (only `callout` has a node today). */
export function slashBlocks(): SlashBlock[] {
  const config = resolveConfig(defaultConfig)
  const fromConfig: SlashBlock[] = config.blocks.map((b) => ({
    title: b.editor?.label ?? b.tag,
    subtitle: `Insert a ${b.tag} block`,
    icon: (b.editor?.icon as IconName) ?? 'sparkle',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: b.tag, attrs: { mdAttrs: {} }, content: [{ type: 'paragraph' }] })
        .run(),
  }))
  return [...BUILTINS, ...fromConfig]
}
```

Note: `defaultConfig`'s callout has `editor: { label: 'Callout', icon: 'info', ... }`. `'info'` is a valid `IconName`. If a config icon is not a known `IconName`, the `Icon` component returns null (safe) — the cast is acceptable here.

- [ ] **Step 4: Implement the SlashCommand extension + CommandList**

`apps/admin/src/editor/extensions/SlashCommand.tsx`:
```tsx
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { Icon } from '../../ui/Icon'
import { slashBlocks } from '../blocks'
import type { SlashBlock } from '../blocks'

export interface CommandListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export const CommandList = forwardRef<CommandListHandle, SuggestionProps<SlashBlock>>((props, ref) => {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [props.items])

  const pick = (index: number) => {
    const item = props.items[index]
    if (item) props.command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % props.items.length)
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
      <div className="slash-head">Blocks</div>
      <div className="slash-list">
        {props.items.length === 0 && <div className="slash-empty">No blocks</div>}
        {props.items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`slash-item${index === selected ? ' sel' : ''}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => pick(index)}
          >
            <span className="slash-ic"><Icon name={item.icon} size={16} /></span>
            <span className="slash-text">
              <span className="slash-label">{item.title}</span>
              <span className="slash-desc">{item.subtitle}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
})
CommandList.displayName = 'CommandList'

/** Slash-command menu: `/` opens a config-driven block picker (ARIA listbox). */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashBlock>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) =>
          slashBlocks().filter((b) => b.title.toLowerCase().includes(query.toLowerCase())),
        command: ({ editor, range, props }) => props.run(editor as Editor, range as Range),
        render: () => {
          let component: ReactRenderer<CommandListHandle, SuggestionProps<SlashBlock>>
          let popup: TippyInstance[] = []
          return {
            onStart: (props) => {
              component = new ReactRenderer(CommandList, { props, editor: props.editor })
              const rect = props.clientRect
              if (!rect) return
              popup = tippy('body', {
                getReferenceClientRect: () => rect() ?? new DOMRect(),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate: (props) => {
              component.updateProps(props)
              const rect = props.clientRect
              if (rect) popup[0]?.setProps({ getReferenceClientRect: () => rect() ?? new DOMRect() })
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup[0]?.hide()
                return true
              }
              return component.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              popup[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})
```

If the `@tiptap/suggestion` generic types (`SuggestionProps`/`SuggestionKeyDownProps`) differ slightly by patch version, adapt the import/annotations to the installed types — the runtime shape (an `items`/`command`/`render` config and a `ref.onKeyDown(props)` handle) is stable. Keep `noUncheckedIndexedAccess` guards (`popup[0]?`, `props.items[index]` checked via the `item` const).

- [ ] **Step 5: Run — verify PASS**

Run: `pnpm --filter @setu/admin test -- slash && pnpm --filter @setu/admin typecheck`
Expected: PASS — slashBlocks includes Callout + inserts a callout node; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/blocks.ts apps/admin/src/editor/extensions/SlashCommand.tsx apps/admin/test/slash.test.tsx
git commit -m "feat(admin): config-driven slash-command block menu"
```

---

### Task 5: Editor screen + metadata panel + autosave + route

**Files:**
- Create: `apps/admin/src/editor/Canvas.tsx`
- Create: `apps/admin/src/editor/useAutosave.ts`
- Create: `apps/admin/src/editor/MetaPanel.tsx`
- Create: `apps/admin/src/editor/EditorScreen.tsx`
- Modify: `apps/admin/src/app.tsx` (wire the route)
- Test: `apps/admin/test/autosave.test.ts`
- Test: `apps/admin/test/editor-screen.test.tsx`

- [ ] **Step 1: Write the failing autosave hook test**

`apps/admin/test/autosave.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from '../src/editor/useAutosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutosave', () => {
  it('debounces and calls save once after the delay; skips the initial rev', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const statuses: string[] = []
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: { type: 'doc', content: [] }, metadata: {}, baseSha: null }),
      save,
      onStatus: (s: 'idle' | 'saving' | 'saved') => statuses.push(s),
      delayMs: 800,
    })
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: props(0) })
    rerender(props(1)) // a change
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('saving')
    expect(statuses).toContain('saved')
  })

  it('does not save on the initial rev (rev 0)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { rerender } = renderHook(
      (p) => useAutosave(p),
      {
        initialProps: {
          enabled: true, rev: 0,
          getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: { type: 'doc', content: [] }, metadata: {}, baseSha: null }),
          save, onStatus: () => {}, delayMs: 800,
        },
      },
    )
    rerender({ enabled: true, rev: 0, getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: { type: 'doc', content: [] }, metadata: {}, baseSha: null }), save, onStatus: () => {}, delayMs: 800 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify it FAILS**

Run: `pnpm --filter @setu/admin test -- autosave`
Expected: FAIL — `useAutosave` not found.

- [ ] **Step 3: Implement the autosave hook**

`apps/admin/src/editor/useAutosave.ts`:
```ts
import { useEffect, useRef } from 'react'
import type { DraftInput } from '@setu/core'

export type SaveStatus = 'idle' | 'saving' | 'saved'

/** Debounced autosave with a single-in-flight guard. Fires `save(getInput())`
 *  ~`delayMs` after `rev` changes (skipping the initial rev 0). A change during
 *  an in-flight save queues exactly one follow-up. */
export function useAutosave(opts: {
  enabled: boolean
  rev: number
  getInput: () => DraftInput
  save: (input: DraftInput) => Promise<{ saved: boolean }>
  onStatus: (s: SaveStatus) => void
  delayMs?: number
}): void {
  const { enabled, rev, getInput, save, onStatus, delayMs = 800 } = opts
  const inFlight = useRef(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || rev === 0) return
    if (timer.current) clearTimeout(timer.current)

    const run = async (): Promise<void> => {
      if (inFlight.current) {
        pending.current = true
        return
      }
      inFlight.current = true
      onStatus('saving')
      try {
        await save(getInput())
      } finally {
        inFlight.current = false
        if (pending.current) {
          pending.current = false
          void run()
        } else {
          onStatus('saved')
        }
      }
    }

    timer.current = setTimeout(() => void run(), delayMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [rev, enabled, delayMs, getInput, save, onStatus])
}
```

- [ ] **Step 4: Run — verify the autosave test PASSES**

Run: `pnpm --filter @setu/admin test -- autosave`
Expected: PASS.

- [ ] **Step 5: Implement Canvas, MetaPanel, and EditorScreen**

`apps/admin/src/editor/Canvas.tsx`:
```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { TiptapDoc } from '@setu/core'
import { Callout } from './extensions/Callout'
import { Passthrough } from './extensions/Passthrough'
import { SlashCommand } from './extensions/SlashCommand'

export function Canvas({
  initialContent,
  editable,
  onChange,
}: {
  initialContent: TiptapDoc
  editable: boolean
  onChange: (doc: TiptapDoc) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      Callout,
      Passthrough,
      SlashCommand,
    ],
    content: initialContent,
    editorProps: { attributes: { class: 'setu-prose', 'aria-label': 'Content editor' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc),
  })

  return <EditorContent editor={editor} />
}
```

`apps/admin/src/editor/MetaPanel.tsx`:
```tsx
const STATUSES = ['Draft', 'Staged', 'Deployed'] as const

export function MetaPanel({
  metadata,
  locale,
  slug,
  editable,
  onChange,
}: {
  metadata: Record<string, unknown>
  locale: string
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
}) {
  const current = String(metadata['status'] ?? 'draft').toLowerCase()
  return (
    <aside className="meta-panel">
      <section className="meta-section">
        <h2 className="meta-title">Status</h2>
        <div className="segmented" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`segmented-opt${current === s.toLowerCase() ? ' on' : ''}`}
              aria-pressed={current === s.toLowerCase()}
              disabled={!editable}
              onClick={() => onChange({ ...metadata, status: s.toLowerCase() })}
            >
              {s}
            </button>
          ))}
        </div>
      </section>
      <section className="meta-section">
        <h2 className="meta-title">Permalink</h2>
        <div className="meta-row"><span className="meta-label">Slug</span><span className="meta-value">/{slug}</span></div>
        <div className="meta-row"><span className="meta-label">Locale</span><span className="meta-value">{locale}</span></div>
      </section>
    </aside>
  )
}
```

`apps/admin/src/editor/EditorScreen.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Draft, DraftInput, TiptapDoc } from '@setu/core'
import { useServices } from '../data/store'
import { Canvas } from './Canvas'
import { MetaPanel } from './MetaPanel'
import { useAutosave } from './useAutosave'
import type { SaveStatus } from './useAutosave'

const EDITOR_ID = 'local'
const BLANK: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean }) {
  if (readonly) return <span className="autosave saving">Read-only</span>
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Draft'
  return <span className={`autosave${status === 'saving' ? ' saving' : ''}`}>{label}</span>
}

export function EditorScreen() {
  const { collection = '', locale = '', slug = '' } = useParams()
  const { read, authoring } = useServices()
  const ref = useMemo(() => ({ collection, locale, slug }), [collection, locale, slug])

  const [phase, setPhase] = useState<'loading' | 'ready' | 'readonly'>('loading')
  const [initialDoc, setInitialDoc] = useState<TiptapDoc>(BLANK)
  const [metadata, setMetadata] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [rev, setRev] = useState(0)

  const docRef = useRef<TiptapDoc>(BLANK)
  const metaRef = useRef<Record<string, unknown>>({})
  const baseShaRef = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    setPhase('loading')
    void (async () => {
      const result = await read.loadForEdit(ref)
      const draft: Draft | null = result.source === 'absent' ? null : result.draft
      const open = await authoring.open(ref, EDITOR_ID)
      if (!live) return
      const content = draft?.content ?? BLANK
      const meta = draft?.metadata ?? {}
      docRef.current = content
      metaRef.current = meta
      baseShaRef.current = draft?.baseSha ?? null
      setInitialDoc(content)
      setMetadata(meta)
      setRev(0)
      setStatus('idle')
      setPhase(open.granted ? 'ready' : 'readonly')
    })()
    return () => {
      live = false
    }
  }, [ref, read, authoring])

  useAutosave({
    enabled: phase === 'ready',
    rev,
    getInput: (): DraftInput => ({ ...ref, content: docRef.current, metadata: metaRef.current, baseSha: baseShaRef.current }),
    save: (input) => authoring.save(input, EDITOR_ID),
    onStatus: setStatus,
  })

  const onDocChange = (doc: TiptapDoc) => {
    docRef.current = doc
    setRev((r) => r + 1)
  }
  const onMetaChange = (next: Record<string, unknown>) => {
    metaRef.current = next
    setMetadata(next)
    setRev((r) => r + 1)
  }
  const title = String(metadata['title'] ?? '')

  if (phase === 'loading') {
    return <div className="editor"><p className="empty-state">Loading…</p></div>
  }

  return (
    <div className="editor">
      <div className="ed-strip">
        <div className="ed-strip-left"><span className="ed-breadcrumb">{collection} / {slug}</span></div>
        <div className="ed-strip-center"><SaveIndicator status={status} readonly={phase === 'readonly'} /></div>
        <div className="ed-strip-right" />
      </div>
      {phase === 'readonly' && (
        <div className="ed-banner" role="status">This entry is locked by another editor — viewing read-only.</div>
      )}
      <div className="editor-stage">
        <div className="ed-scroll">
          <div className="ed-canvas">
            <input
              className="ed-title"
              aria-label="Title"
              placeholder="Untitled"
              value={title}
              disabled={phase === 'readonly'}
              onChange={(e) => onMetaChange({ ...metaRef.current, title: e.target.value })}
            />
            <Canvas key={`${collection}/${locale}/${slug}`} initialContent={initialDoc} editable={phase === 'ready'} onChange={onDocChange} />
          </div>
        </div>
        <MetaPanel metadata={metadata} locale={locale} slug={slug} editable={phase === 'ready'} onChange={onMetaChange} />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Wire the route**

In `apps/admin/src/app.tsx`: add the import and replace the `/edit/*` placeholder route with the param route (keep the rest).
```tsx
import { EditorScreen } from './editor/EditorScreen'
```
Replace:
```tsx
          <Route path="/edit/*" element={<Placeholder title="Editor (coming soon)" />} />
```
with:
```tsx
          <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
```

- [ ] **Step 7: Write the editor-screen tests**

`apps/admin/test/editor-screen.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Draft, TiptapDoc } from '@setu/core'
import { ServicesProvider, createServices } from '../src/data/store'
import type { Services } from '../src/data/store'
import { EditorScreen } from '../src/editor/EditorScreen'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const aDraft: Draft = { collection: 'post', locale: 'en', slug: 'p1', content: doc('Hello body'), metadata: { title: 'Hello', status: 'draft' }, baseSha: null, createdAt: 0, updatedAt: 0 }

function fakeServices(over: Partial<Services> = {}): Services {
  const save = vi.fn(async (input) => ({ saved: true, outcome: 'refreshed', lock: { collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'local', lockedAt: 0 }, draft: { ...aDraft, ...input } }))
  return {
    data: {} as Services['data'],
    git: {} as Services['git'],
    read: { loadForEdit: vi.fn(async () => ({ source: 'draft', draft: aDraft })) } as unknown as Services['read'],
    authoring: {
      open: vi.fn(async () => ({ granted: true, outcome: 'acquired', lock: { collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'local', lockedAt: 0 }, draft: aDraft })),
      save,
      release: vi.fn(), forceUnlock: vi.fn(), status: vi.fn(),
    } as unknown as Services['authoring'],
    ...over,
  }
}

function renderEditor(services: Services, path = '/edit/post/en/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ServicesProvider services={services}>
        <Routes>
          <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
        </Routes>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('EditorScreen', () => {
  it('loads a draft and renders its title + status', async () => {
    renderEditor(fakeServices())
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changing the status autosaves and flips the indicator to Saved', async () => {
    vi.useFakeTimers()
    const services = fakeServices()
    renderEditor(services)
    await act(async () => { await vi.runOnlyPendingTimersAsync() }) // flush load
    fireEvent.click(screen.getByRole('button', { name: 'Staged' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(services.authoring.save).toHaveBeenCalled()
    const lastCall = (services.authoring.save as ReturnType<typeof vi.fn>).mock.calls.at(-1)
    expect(lastCall?.[0].metadata.status).toBe('staged')
    vi.useRealTimers()
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('opens a blank canvas for an absent entry', async () => {
    const services = fakeServices({ read: { loadForEdit: vi.fn(async () => ({ source: 'absent' })) } as unknown as Services['read'] })
    renderEditor(services, '/edit/post/en/new')
    expect(await screen.findByLabelText('Title')).toHaveValue('')
  })

  it('renders read-only with a banner when the lock is blocked', async () => {
    const services = fakeServices()
    ;(services.authoring.open as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ granted: false, outcome: 'blocked', lock: { collection: 'post', locale: 'en', slug: 'p1', lockedBy: 'someone', lockedAt: 0 }, draft: aDraft })
    renderEditor(services)
    expect(await screen.findByText(/locked by another editor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft' })).toBeDisabled()
  })

  it('persists across a reopen (real services)', async () => {
    const services = createServices()
    const { unmount } = renderEditor(services, '/edit/post/en/release-notes')
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: 'Staged' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 3000 })
    unmount()
    renderEditor(services, '/edit/post/en/release-notes')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Staged' })).toHaveAttribute('aria-pressed', 'true'))
  })
})
```

If a Tiptap mount warning or an async `act(...)` warning appears but assertions pass, it is benign (the editor mounts in an effect). Keep the assertions targeting the title input + status buttons (no ProseMirror typing). If `vi.runOnlyPendingTimersAsync` interacts badly with the load promise, switch that flush to `await screen.findByDisplayValue('Hello')` before the click.

- [ ] **Step 8: Run the full admin suite + typecheck — verify PASS**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — editor-screen + autosave + all prior tests green; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/editor apps/admin/src/app.tsx apps/admin/test/autosave.test.ts apps/admin/test/editor-screen.test.tsx
git commit -m "feat(admin): editor screen — load/lock/autosave + canvas + metadata panel + route"
```

---

### Task 6: CSS port (editor canvas + prose + chips + slim meta panel)

**Files:**
- Create: `apps/admin/src/styles/editor.css`
- Modify: `apps/admin/src/index.css` (import editor.css last)

This task has no new behavior tests — fidelity is a UAT check. The gate is: existing tests stay green, typecheck + build pass, brand fonts preserved.

- [ ] **Step 1: Create `apps/admin/src/styles/editor.css`**

Port the editor chrome faithfully from `design/admin/editor.css` (read it). Copy these rule blocks verbatim (values, not invented): `.editor`, `.ed-strip`, `.ed-strip-left`, `.ed-strip-center`, `.ed-strip-right`, `.ed-breadcrumb`, `.autosave`, `.autosave.saving`, `.editor-stage`, `.ed-scroll`, `.ed-canvas`, `.ed-title` (+ the `::placeholder` equivalent — the design uses a `[data-empty]` attr trick; since our title is an `<input>`, use the native `::placeholder`), `.blk-callout` + `.blk-callout.tone-*` + `.callout-ic` + `.callout-text`, the dynamic/Pro chip `.blk-dynamic` + `.dyn-rail` + `.dyn-head` + `.dyn-ic` + `.dyn-title` + `.dyn-lock`, and the slash menu `.slash` + `.slash-head` + `.slash-list` + `.slash-item` + `.slash-item.sel` + `.slash-ic` + `.slash-text` + `.slash-label` + `.slash-desc` (read their values from `design/admin/editor.css`).

Then ADD these app-specific rules (Tiptap renders semantic tags inside `.setu-prose`, so map the design's per-block typography onto the real tags; values mirror `design/admin/editor.css`'s `.blk-*`):
```css
/* Tiptap renders semantic tags; map the design's block typography onto them. */
.setu-prose { outline: none; }
.setu-prose p { font-size: 19px; line-height: 1.75; color: var(--text); padding: 5px 0; letter-spacing: -.003em; margin: 0; }
.setu-prose h1 { font-size: 31px; line-height: 1.25; font-weight: 700; letter-spacing: -.02em; margin: 30px 0 8px; color: var(--text); }
.setu-prose h2 { font-size: 25px; line-height: 1.3; font-weight: 700; letter-spacing: -.018em; margin: 28px 0 6px; color: var(--text); }
.setu-prose h3 { font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -.01em; margin: 20px 0 4px; color: var(--text); }
.setu-prose ul, .setu-prose ol { margin: 6px 0; padding-left: 26px; }
.setu-prose li { font-size: 19px; line-height: 1.7; padding: 2px 0; color: var(--text); }
.setu-prose blockquote { font-size: 22px; line-height: 1.55; font-style: italic; color: var(--text); padding: 4px 0 4px 22px; border-left: 3px solid var(--accent); margin: 8px 0; }
.setu-prose pre { background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 14px 16px; font-size: 14px; line-height: 1.6; color: var(--text); white-space: pre-wrap; font-family: var(--font-mono); margin: 10px 0; }
.setu-prose code { font-family: var(--font-mono); font-size: .9em; }
.setu-prose hr { border: none; height: 1px; background: var(--border-strong); margin: 18px 0; }
.setu-prose a { color: var(--accent-strong); text-decoration: underline; }
/* Placeholder (from @tiptap/extension-placeholder). */
.setu-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--text-4); float: left; height: 0; pointer-events: none; }
/* The passthrough chip's raw source. */
.blk-dynamic .dyn-raw { margin: 11px 0 0; }
.blk-dynamic .dyn-raw code { font-family: var(--font-mono); font-size: 12px; color: var(--text-2); background: var(--surface-active); padding: 3px 8px; border-radius: var(--r-xs); white-space: pre-wrap; }
.ed-title { width: 100%; border: none; background: transparent; }
.ed-title::placeholder { color: var(--text-4); }
/* Read-only lock banner. */
.ed-banner { padding: 10px 16px; font-size: 13px; color: var(--amber); background: var(--amber-soft); border-bottom: 1px solid var(--border); }
/* Slim metadata panel (the full design panel is deferred). */
.meta-panel { width: 300px; flex-shrink: 0; border-left: 1px solid var(--border); padding: 22px 18px; overflow-y: auto; background: var(--canvas); }
.meta-section { margin-bottom: 22px; }
.meta-title { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin: 0 0 10px; }
.meta-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; font-size: 13px; }
.meta-label { color: var(--text-3); }
.meta-value { color: var(--text); font-family: var(--font-mono); font-size: 12.5px; }
.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm); }
.segmented-opt { padding: 5px 12px; font-size: 12.5px; font-weight: 550; color: var(--text-2); background: transparent; border: none; border-radius: var(--r-xs); }
.segmented-opt.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1, 0 1px 2px rgba(0,0,0,.06)); }
.segmented-opt:disabled { opacity: .55; cursor: default; }
```
If any `var(--…)` referenced is NOT in `apps/admin/src/styles/tokens.css`, substitute the nearest present token and note it (e.g. `--surface-active`, `--bg-sunken`, `--shadow-1` — verify each exists; if not, use `--surface-hover`/`--bg`/a literal shadow respectively).

- [ ] **Step 2: Import editor.css last in `apps/admin/src/index.css`**

Edit the import block so order is tailwind → tokens → components → shell → editor:
```css
@import 'tailwindcss';
@import './styles/tokens.css';
@import './styles/components.css';
@import './styles/shell.css';
@import './styles/editor.css';
```

- [ ] **Step 3: Verify tests, typecheck, build, and fonts**

Run:
```bash
pnpm --filter @setu/admin test
pnpm --filter @setu/admin typecheck
pnpm --filter @setu/admin build
grep -c fonts.googleapis apps/admin/dist/index.html
```
Expected: all admin tests green; typecheck clean; build succeeds; the `grep` prints a number > 0 (brand fonts preserved).

- [ ] **Step 4: Whole-repo green**

Run: `pnpm test && pnpm typecheck`
Expected: all suites pass (core/db/git/admin) and typecheck clean repo-wide.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/styles/editor.css apps/admin/src/index.css
git commit -m "feat(admin): editor canvas + prose + chip + slim meta-panel CSS (ported)"
```

---

## Self-Review

**Spec coverage:**
- `@setu/git-memory` package, contract-tested + seed → Task 1. ✓
- Services context (`data`/`git`/`read`/`authoring`, `useServices`, `useData` kept) + Tiptap deps → Task 2. ✓
- Custom Callout (`mdAttrs`, block content) + Passthrough (atom, `raw`/`flagged`) + the round-trip guard → Task 3. ✓
- Config-driven slash menu (built-ins + `resolveConfig(defaultConfig)` Callout; ARIA listbox + keyboard) → Task 4. ✓
- Editor screen: `loadForEdit` (draft/forked/absent→blank), `open` lock (blocked→read-only banner), Canvas from `draft.content`, slim MetaPanel (Status segmented + Slug/Locale), debounced autosave via `authoring.save` + indicator + single-in-flight, route wired → Task 5. ✓
- CSS port (canvas + prose + callout + passthrough chip + slim meta panel) + import order → Task 6. ✓
- Existing 14 admin tests + core/db/git suites stay green; `verbatimModuleSyntax`/`noUncheckedIndexedAccess` clean; build keeps brand fonts → Tasks 2/5/6 verification steps. ✓
- Deferred items (publish/preview/focus mode/block-props/bubble toolbar/command palette/media/SEO/translations/tags/Pro modals/schedule/version history/raw-source/drag-handle/slug editing) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO. CSS Step 1 is a precise port-from-source directive (names the file + exact rule blocks) plus fully-specified app rules — consistent with the #9/#10 CSS-port tasks. The two "adapt to installed types / nearest token" notes are bounded reconciliation instructions against named symbols, not vague placeholders.

**Type consistency:** `Services { data, git, read, authoring }` defined in Task 2, consumed via `useServices()` in Task 5. `SlashBlock { title, subtitle, icon: IconName, run(editor, range) }` defined in Task 4, consumed by `SlashCommand` + the slash test. `SaveStatus` + `useAutosave({enabled, rev, getInput, save, onStatus, delayMs})` defined in Task 5 Step 3, tested in Step 1 and consumed in `EditorScreen`. `createMemoryGitPort(seed?: GitSeedFile[])` (Task 1) consumed in Task 2's store. Node names/attrs (`callout.mdAttrs`, `passthrough.raw/flagged`) defined in Task 3 and asserted by the Task 3 guard + used by Task 4 insertion + Task 5 canvas. `TiptapDoc`/`Draft`/`DraftInput` are from `@setu/core` (exact fields confirmed against `packages/core/src/data/types.ts`). ✓
