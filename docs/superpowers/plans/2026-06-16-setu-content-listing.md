# Git Content Listing / Reindex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin content list (and Deploy) show published Git entries that have no draft, by adding an enumeration primitive to `GitPort` and a pure core derivation that merges Git entries with DB drafts into one status-aware list.

**Architecture:** Add `GitPort.list(prefix?)` (implemented in both adapters, contract-tested). Add a pure `parseContentPath` (inverse of `contentPath`) and a pure `listContentEntries({drafts, committed, deployedAt})` in `@setu/core` that unions drafts + committed entries by ref and derives each one's lifecycle. Rewire `ContentList` and `deploy()` to enumerate via Git. No new commit/write paths — listing and forking are read-only over Git.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, React 18, isomorphic-git (git-local), in-memory Map (git-memory), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-15-setu-content-listing-design.md`

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/core/src/git/git-port.ts` | + `list(prefix?)` on the interface | 1 |
| `packages/git-memory/src/adapter.ts` | implement `list` over the Map | 1 |
| `packages/git-local/src/adapter.ts` | implement `list` via `git.listFiles` at HEAD | 1 |
| `packages/git-testing/src/index.ts` | + `list` contract cases | 1 |
| `packages/git-testing/test/fake-git.test.ts` | + `list` on the in-test fake | 1 |
| `packages/git-memory/test/contract.test.ts` | + seed-list assertion | 1 |
| `packages/core/test/read/read-service.test.ts` | + `list` on `fakeGit` (keep typecheck green) | 1 |
| `packages/core/test/publish/publish-service.test.ts` | + `list` on `fakeGit` (keep typecheck green) | 1 |
| `packages/core/test/git/types.test.ts` | + `list` on the structural stub | 1 |
| `packages/core/src/publish/content-path.ts` | + `parseContentPath(path)` | 2 |
| `packages/core/test/publish/content-path.test.ts` | unit for `parseContentPath` | 2 |
| `packages/core/src/content-index/list-entries.ts` | pure `listContentEntries` + `ContentRow` | 3 |
| `packages/core/test/content-index/list-entries.test.ts` | table unit | 3 |
| `packages/core/src/index.ts` | export new symbols | 2, 3 |
| `packages/core/tsconfig.edge.json` | add `src/content-index` to edge guard | 3 |
| `apps/admin/src/screens/ContentList.tsx` | enumerate Git + merge + render | 4 |
| `apps/admin/test/content-list.test.tsx` | + Git-only-entry tests | 4 |
| `apps/admin/src/deploy/deploy.tsx` | enumerate via `git.list('content/')` | 5 |
| `apps/admin/test/deploy.test.tsx` | + published-no-draft snapshot test | 5 |

---

## Task 1: `GitPort.list(prefix?)` — interface, both adapters, contract, fakes

**Files:**
- Modify: `packages/core/src/git/git-port.ts`
- Modify: `packages/git-memory/src/adapter.ts`
- Modify: `packages/git-local/src/adapter.ts`
- Modify: `packages/git-testing/src/index.ts` (contract runner)
- Modify: `packages/git-testing/test/fake-git.test.ts`
- Modify: `packages/git-memory/test/contract.test.ts`
- Modify: `packages/core/test/read/read-service.test.ts`
- Modify: `packages/core/test/publish/publish-service.test.ts`
- Modify: `packages/core/test/git/types.test.ts`

- [ ] **Step 1: Add the contract cases (failing test)**

In `packages/git-testing/src/index.ts`, inside the `describe('GitPort contract', …)` block, after the existing `it('commits and reads nested paths …')` test, add:

```ts
    it('lists nothing on an empty repo', async () => {
      expect(await port.list()).toEqual([])
    })

    it('lists committed paths, and filters by prefix', async () => {
      await port.commitFile({ path: 'content/post/en/a.mdoc', content: 'A', message: 'm', author })
      await port.commitFile({ path: 'content/page/en/b.mdoc', content: 'B', message: 'm', author })
      await port.commitFile({ path: 'setu.config.ts', content: 'C', message: 'm', author })

      expect([...(await port.list())].sort()).toEqual([
        'content/page/en/b.mdoc',
        'content/post/en/a.mdoc',
        'setu.config.ts',
      ])
      expect([...(await port.list('content/post/'))].sort()).toEqual(['content/post/en/a.mdoc'])
      expect(await port.list('content/none/')).toEqual([])
    })
```

- [ ] **Step 2: Run the contract via git-memory — verify it fails to compile/run**

Run: `pnpm --filter @setu/git-memory test`
Expected: FAIL — `Property 'list' does not exist on type 'GitPort'` (typecheck) / runtime `port.list is not a function`.

- [ ] **Step 3: Add `list` to the `GitPort` interface**

In `packages/core/src/git/git-port.ts`, add the method after `commitFile`:

```ts
  /** Write `path` and commit it; returns the new HEAD commit sha. */
  commitFile(input: CommitInput): Promise<CommitResult>
  /** Repo-relative paths of all files at HEAD, filtered to those under `prefix`
   *  (default: all). Empty when the repo has no commits. Order is not guaranteed. */
  list(prefix?: string): Promise<string[]>
```

- [ ] **Step 4: Implement `list` in git-memory**

In `packages/git-memory/src/adapter.ts`, add to the returned object (after `commitFile`):

```ts
    async commitFile(input: CommitInput): Promise<CommitResult> {
      return { sha: apply(input.path, input.content) }
    },
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
```

- [ ] **Step 5: Implement `list` in git-local**

In `packages/git-local/src/adapter.ts`, add to the returned object (after the `commitFile` block, as a sibling method):

```ts
    async list(prefix?: string) {
      const oid = await headSha()
      if (oid === null) return []
      const all = await git.listFiles({ fs, dir, ref: 'HEAD' })
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
```

- [ ] **Step 6: Add `list` to the git-testing in-test fake**

In `packages/git-testing/test/fake-git.test.ts`, inside `createFakeGit`'s returned object, after `commitFile`:

```ts
    async commitFile({ path, content }) {
      files.set(path, content)
      head = `fakesha${++counter}`
      return { sha: head }
    },
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
```

- [ ] **Step 7: Run both git adapter suites — verify they pass**

Run: `pnpm --filter @setu/git-memory test && pnpm --filter @setu/git-local test && pnpm --filter @setu/git-testing test`
Expected: PASS (contract now includes the two `list` cases for all three).

- [ ] **Step 8: Add the git-memory seed-list assertion**

In `packages/git-memory/test/contract.test.ts`, inside `describe('createMemoryGitPort seed', …)`, add a second `it`:

```ts
  it('lists seeded files (filtered by prefix)', async () => {
    const git = createMemoryGitPort([
      { path: 'content/post/en/hello.mdoc', content: '# Hello\n' },
      { path: 'setu.config.ts', content: 'export default {}' },
    ])
    expect(await git.list('content/')).toEqual(['content/post/en/hello.mdoc'])
  })
```

- [ ] **Step 9: Keep the three core test fakes type-complete**

These inline fakes are typed `GitPort`, so they must gain `list` or typecheck fails.

In `packages/core/test/read/read-service.test.ts`, inside `fakeGit()`'s returned object, after `commitFile`:

```ts
    async commitFile(input) {
      files.set(input.path, input.content)
      head = `gitsha${++counter}`
      return { sha: head }
    },
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
```

In `packages/core/test/publish/publish-service.test.ts`, inside `fakeGit()`'s returned object, after the `commitFile` method, add the same `list` method:

```ts
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
```

In `packages/core/test/git/types.test.ts`, add `list` to the structural `stub` (it asserts all methods exist):

```ts
    const stub: GitPort = {
      headSha: async () => null,
      readFile: async () => null,
      commitFile: async () => ({ sha: 'deadbeef' }),
      list: async () => [],
    }
```

- [ ] **Step 10: Run core + admin to confirm nothing else broke**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/admin test`
Expected: PASS (admin's `DeployProvider`/`ContentList` still compile — they don't call `list` yet).

- [ ] **Step 11: Typecheck + edge guard**

Run: `pnpm -r typecheck`
Expected: PASS. (`@setu/core`'s `typecheck` script runs both `tsc --noEmit` and the edge guard `tsc -p tsconfig.edge.json --noEmit`; the interface addition is Node-free.)

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/git/git-port.ts packages/git-memory packages/git-local packages/git-testing packages/core/test/read/read-service.test.ts packages/core/test/publish/publish-service.test.ts packages/core/test/git/types.test.ts
git commit -m "feat(git): add GitPort.list(prefix) enumeration primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `parseContentPath` — inverse of `contentPath`

**Files:**
- Modify: `packages/core/src/publish/content-path.ts`
- Create: `packages/core/test/publish/content-path.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/publish/content-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contentPath, parseContentPath } from '../../src/index'

describe('parseContentPath', () => {
  it('parses a well-formed content path into an EntryRef', () => {
    expect(parseContentPath('content/post/en/hello.mdoc')).toEqual({
      collection: 'post',
      locale: 'en',
      slug: 'hello',
    })
  })

  it('round-trips with contentPath', () => {
    const ref = { collection: 'page', locale: 'fr', slug: 'a-propos' }
    expect(parseContentPath(contentPath(ref))).toEqual(ref)
  })

  it('returns null for non-content paths', () => {
    expect(parseContentPath('setu.config.ts')).toBeNull()
    expect(parseContentPath('content/post/en/hello.md')).toBeNull() // wrong extension
    expect(parseContentPath('content/post/hello.mdoc')).toBeNull() // missing locale segment
    expect(parseContentPath('content/post/en/sub/hello.mdoc')).toBeNull() // extra segment
    expect(parseContentPath('other/post/en/hello.mdoc')).toBeNull() // wrong root
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- content-path`
Expected: FAIL — `parseContentPath` is not exported.

- [ ] **Step 3: Implement `parseContentPath`**

In `packages/core/src/publish/content-path.ts`, add below `contentPath`:

```ts
/** Inverse of `contentPath`: parse `content/<collection>/<locale>/<slug>.mdoc`
 *  into an `EntryRef`. Returns null for any path that does not match exactly
 *  (wrong root, wrong extension, wrong segment count, empty segment). */
export function parseContentPath(path: string): EntryRef | null {
  const match = /^content\/([^/]+)\/([^/]+)\/([^/]+)\.mdoc$/.exec(path)
  if (match === null) return null
  const [, collection, locale, slug] = match
  if (!collection || !locale || !slug) return null
  return { collection, locale, slug }
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, change the `contentPath` export line to also export `parseContentPath`:

```ts
export { contentPath, parseContentPath } from './publish/content-path'
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @setu/core test -- content-path`
Expected: PASS (all four cases).

- [ ] **Step 6: Typecheck + edge guard**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS (this script includes the edge guard; `src/publish` is already in the edge include; the regex/destructure is `noUncheckedIndexedAccess`-safe via the `if (!collection …)` guard).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/publish/content-path.ts packages/core/test/publish/content-path.test.ts packages/core/src/index.ts
git commit -m "feat(core): add parseContentPath (inverse of contentPath)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `listContentEntries` — pure merge/reindex derivation

**Files:**
- Create: `packages/core/src/content-index/list-entries.ts`
- Create: `packages/core/test/content-index/list-entries.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsconfig.edge.json`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/content-index/list-entries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Draft, EntryRef, TiptapDoc } from '../../src/index'
import { listContentEntries, serializeMdoc, tiptapToMarkdoc } from '../../src/index'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
})

function draft(ref: EntryRef, title: string, body: string, updatedAt = 1000): Draft {
  return {
    ...ref,
    content: doc(body),
    metadata: { title },
    baseSha: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

/** Serialize a committed .mdoc the way publish does, so committed === draft when
 *  the bodies match. */
function committedFor(d: Draft): string {
  return serializeMdoc({ frontmatter: d.metadata, body: tiptapToMarkdoc(d.content) })
}

const noDeploy = () => null

describe('listContentEntries', () => {
  it('draft-only entry → one row, Draft (git empty), updatedAt set, hasDraft true', () => {
    const d = draft({ collection: 'post', locale: 'en', slug: 'a' }, 'A', 'body a', 1234)
    const rows = listContentEntries({ drafts: [d], committed: [], deployedAt: noDeploy })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ref: { collection: 'post', locale: 'en', slug: 'a' },
      title: 'A',
      locale: 'en',
      lifecycle: { state: 'draft' },
      updatedAt: 1234,
      hasDraft: true,
    })
  })

  it('committed-only entry → one row, Staged, title from frontmatter, updatedAt null, hasDraft false', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    const committed = serializeMdoc({ frontmatter: { title: 'Ghost' }, body: 'gone' })
    const rows = listContentEntries({ drafts: [], committed: [{ ref, content: committed }], deployedAt: noDeploy })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ref,
      title: 'Ghost',
      lifecycle: { state: 'staged' },
      updatedAt: null,
      hasDraft: false,
    })
  })

  it('draft AND committed for the same ref → a single row, hasDraft true', () => {
    const d = draft({ collection: 'post', locale: 'en', slug: 'a' }, 'A', 'body a')
    const rows = listContentEntries({
      drafts: [d],
      committed: [{ ref: { collection: 'post', locale: 'en', slug: 'a' }, content: committedFor(d) }],
      deployedAt: noDeploy,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ hasDraft: true, lifecycle: { state: 'staged' } })
  })

  it('committed-and-deployed entry → Live', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    const committed = serializeMdoc({ frontmatter: { title: 'Ghost' }, body: 'gone' })
    const rows = listContentEntries({
      drafts: [],
      committed: [{ ref, content: committed }],
      deployedAt: (p) => (p === 'content/post/en/ghost.mdoc' ? committed : null),
    })
    expect(rows[0]?.lifecycle).toEqual({ state: 'live' })
  })

  it('falls back to the slug when no title is present', () => {
    const ref = { collection: 'post', locale: 'en', slug: 'untitled' }
    const committed = serializeMdoc({ frontmatter: {}, body: 'x' })
    const rows = listContentEntries({ drafts: [], committed: [{ ref, content: committed }], deployedAt: noDeploy })
    expect(rows[0]?.title).toBe('untitled')
  })

  it('returns one row per distinct ref (no duplicates across drafts+committed)', () => {
    const d1 = draft({ collection: 'post', locale: 'en', slug: 'a' }, 'A', 'a')
    const ref2 = { collection: 'post', locale: 'en', slug: 'b' }
    const rows = listContentEntries({
      drafts: [d1],
      committed: [
        { ref: { collection: 'post', locale: 'en', slug: 'a' }, content: committedFor(d1) },
        { ref: ref2, content: serializeMdoc({ frontmatter: { title: 'B' }, body: 'b' }) },
      ],
      deployedAt: noDeploy,
    })
    expect(rows.map((r) => r.ref.slug).sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test -- list-entries`
Expected: FAIL — `listContentEntries` is not exported.

- [ ] **Step 3: Implement `listContentEntries`**

Create `packages/core/src/content-index/list-entries.ts`:

```ts
import type { Draft, EntryRef } from '../data/types'
import type { Lifecycle } from '../lifecycle/derive'
import { deriveLifecycle } from '../lifecycle/derive'
import { contentPath } from '../publish/content-path'
import { parseMdoc, serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'

/** One row in the merged content list: an entry that exists as a draft, as a
 *  committed Git file, or both. */
export interface ContentRow {
  ref: EntryRef
  /** draft title → committed frontmatter title → slug. */
  title: string
  locale: string
  lifecycle: Lifecycle
  /** Draft's updatedAt (epoch ms); null for entries that live only in Git. */
  updatedAt: number | null
  hasDraft: boolean
}

export interface ListContentEntriesInput {
  drafts: Draft[]
  committed: { ref: EntryRef; content: string }[]
  /** The live content at a repo path, or null if not deployed. */
  deployedAt: (path: string) => string | null
}

const keyOf = (r: EntryRef): string => `${r.collection}/${r.locale}/${r.slug}`

/** Merge DB drafts with committed Git entries into one status-aware list. The
 *  draft is the identity holder (an entry with both yields a single row). Pure —
 *  the reindex derivation; topology supplies `deployedAt`. */
export function listContentEntries(input: ListContentEntriesInput): ContentRow[] {
  const { drafts, committed, deployedAt } = input

  const draftByKey = new Map<string, Draft>()
  for (const d of drafts) draftByKey.set(keyOf(d), d)
  const committedByKey = new Map<string, string>()
  for (const c of committed) committedByKey.set(keyOf(c.ref), c.content)

  // Union of refs: drafts first (stable), then committed-only.
  const order: EntryRef[] = []
  const seen = new Set<string>()
  for (const d of drafts) {
    const k = keyOf(d)
    if (!seen.has(k)) {
      seen.add(k)
      order.push({ collection: d.collection, locale: d.locale, slug: d.slug })
    }
  }
  for (const c of committed) {
    const k = keyOf(c.ref)
    if (!seen.has(k)) {
      seen.add(k)
      order.push(c.ref)
    }
  }

  return order.map((ref) => {
    const draft = draftByKey.get(keyOf(ref)) ?? null
    const committedStr = committedByKey.get(keyOf(ref)) ?? null
    const draftStr = draft
      ? serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) })
      : null
    const lifecycle = deriveLifecycle({
      draft: draftStr,
      committed: committedStr,
      deployed: deployedAt(contentPath(ref)),
    })
    return {
      ref,
      title: titleOf(draft, committedStr, ref.slug),
      locale: ref.locale,
      lifecycle,
      updatedAt: draft ? draft.updatedAt : null,
      hasDraft: draft !== null,
    }
  })
}

function titleOf(draft: Draft | null, committedStr: string | null, slug: string): string {
  if (draft) {
    const t = draft.metadata['title']
    if (typeof t === 'string' && t.length > 0) return t
  }
  if (committedStr !== null) {
    const t = parseMdoc(committedStr).frontmatter['title']
    if (typeof t === 'string' && t.length > 0) return t
  }
  return slug
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, after the lifecycle exports at the end of the file, add:

```ts
export type { ContentRow, ListContentEntriesInput } from './content-index/list-entries'
export { listContentEntries } from './content-index/list-entries'
```

- [ ] **Step 5: Add the module to the edge guard**

In `packages/core/tsconfig.edge.json`, add `"src/content-index"` to the `include` array:

```json
  "include": ["src/markdoc", "src/data", "src/authoring", "src/git", "src/publish", "src/read", "src/authz", "src/lifecycle", "src/content-index"]
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @setu/core test -- list-entries`
Expected: PASS (all six cases).

- [ ] **Step 7: Typecheck + edge guard**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS (this script includes the edge guard; imports are all Node-free: data/types, lifecycle, publish/content-path, markdoc).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/content-index packages/core/test/content-index packages/core/src/index.ts packages/core/tsconfig.edge.json
git commit -m "feat(core): add listContentEntries pure reindex/merge derivation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewire `ContentList` to enumerate Git + render merged rows

**Files:**
- Modify: `apps/admin/src/screens/ContentList.tsx`
- Modify: `apps/admin/test/content-list.test.tsx`

- [ ] **Step 1: Add the failing Git-only-entry tests**

In `apps/admin/test/content-list.test.tsx`, add imports at the top (after the existing imports):

```ts
import { serializeMdoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
```

Then add a new `describe` block at the end of the file:

```tsx
describe('ContentList — Git-only (published, no draft) entries', () => {
  const ghostMdoc = serializeMdoc({ frontmatter: { title: 'Ghost Post' }, body: 'Still here.' })

  const renderWithGit = () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/ghost.mdoc', content: ghostMdoc }])
    const services = servicesFor(createMemoryDataPort([]), git)
    return render(
      <MemoryRouter>
        <ServicesProvider services={services}>
          <DeployProvider>
            <ContentList collection="post" title="Posts" />
          </DeployProvider>
        </ServicesProvider>
      </MemoryRouter>,
    )
  }

  it('lists a committed entry that has no draft, with a Staged pill and a dash for Updated', async () => {
    renderWithGit()
    expect(await screen.findByText('Ghost Post')).toBeInTheDocument()
    expect(screen.getByText('Staged', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('links a Git-only entry to its editor route (fork-on-open)', async () => {
    renderWithGit()
    const link = await screen.findByRole('link', { name: 'Ghost Post' })
    expect(link).toHaveAttribute('href', '/edit/post/en/ghost')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- content-list`
Expected: FAIL — `Ghost Post` not found (current `ContentList` only lists DB drafts; the seeded entry lives only in Git).

- [ ] **Step 3: Rewire `ContentList`**

Replace the entire contents of `apps/admin/src/screens/ContentList.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ContentRow, EntryRef } from '@setu/core'
import { listContentEntries, parseContentPath } from '@setu/core'
import { useServices } from '../data/store'
import { lifecycleLabel } from '../lifecycle/label'
import { useDeploy } from '../deploy/deploy'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const drafts = await data.listDrafts({ collection })
      const paths = await git.list(`content/${collection}/`)
      const committed: { ref: EntryRef; content: string }[] = []
      for (const p of paths) {
        const ref = parseContentPath(p)
        if (ref === null) continue
        const content = await git.readFile(p)
        if (content !== null) committed.push({ ref, content })
      }
      const merged = listContentEntries({ drafts, committed, deployedAt })
      if (live) setRows(merged)
    })()
    return () => {
      live = false
    }
  }, [data, git, collection, deployedAt, deploySha])

  const noun = collection

  return (
    <>
      <PageHeader
        title={title}
        count={rows?.length}
        subtitle={collection === 'post' ? 'Articles, field notes and announcements.' : 'Standalone pages and landing pages.'}
        actions={
          <Link to={`/edit/${collection}/en/new`} className="btn btn-primary btn-md">
            <Icon name="plus" size={16} />
            <span>New {noun}</span>
          </Link>
        }
      />
      <div className="page-body">
        {rows === null ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">No {title.toLowerCase()} yet.</p>
        ) : (
          <div className="list-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Locale</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { label, pending } = lifecycleLabel(row.lifecycle)
                  return (
                    <tr key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                      <td className="ctable-title">
                        <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                          {row.title}
                        </Link>
                      </td>
                      <td>
                        <StatusPill status={label} />
                        {pending !== undefined && <span className="status-pending">· {pending}</span>}
                      </td>
                      <td className="ctable-muted">{row.ref.locale}</td>
                      <td className="ctable-muted">
                        {row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run the full content-list suite — verify it passes**

Run: `pnpm --filter @setu/admin test -- content-list`
Expected: PASS — both new tests, plus the four existing tests (git is empty in `DataProvider`, so the existing draft-only assertions are unchanged).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS (`ContentRow`/`EntryRef` imported as types; `verbatimModuleSyntax` satisfied).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/screens/ContentList.tsx apps/admin/test/content-list.test.tsx
git commit -m "feat(admin): content list shows committed Git entries merged with drafts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewire `deploy()` to enumerate via Git

**Files:**
- Modify: `apps/admin/src/deploy/deploy.tsx`
- Modify: `apps/admin/test/deploy.test.tsx`

- [ ] **Step 1: Add the failing published-no-draft test**

In `apps/admin/test/deploy.test.tsx`, add a second `it` inside `describe('deploy', …)`:

```tsx
  it('snapshots a published entry that has no draft (enumerated from Git)', async () => {
    const services = createServices()
    const author = { name: 'T', email: 't@x' }
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    await services.data.saveDraft({ ...ref, content: { type: 'doc', content: [] }, metadata: { title: 'Ghost' } })
    await services.publish.publish({ ref, author })
    await services.data.deleteDraft(ref) // now it lives only in Git

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}><DeployProvider>{children}</DeployProvider></ServicesProvider>
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    expect(result.current.deployedAt(contentPath(ref))).toBeNull()
    await act(async () => { await result.current.deploy() })
    await waitFor(() => expect(result.current.deployedAt(contentPath(ref))).not.toBeNull())
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test -- deploy.test`
Expected: FAIL — after `deleteDraft`, `deploy()` (which enumerates `listDrafts()`) skips the entry, so `deployedAt` stays null.

- [ ] **Step 3: Rewire `deploy()` to enumerate Git**

In `apps/admin/src/deploy/deploy.tsx`, replace the `deploy` callback body. Change the imports line:

```ts
import { contentPath, parseContentPath } from '@setu/core'
```

Replace the `deploy` callback:

```ts
  const deploy = useCallback(async () => {
    const paths = await git.list('content/')
    const next = new Map<string, string>()
    for (const path of paths) {
      if (parseContentPath(path) === null) continue
      const content = await git.readFile(path)
      if (content !== null) next.set(path, content)
    }
    const sha = await git.headSha()
    setState({ snapshot: next, sha })
  }, [git])
```

Note: `data` is no longer used by `deploy`. If `data` becomes unused in the component, remove it from the `useServices()` destructure (`const { git } = useServices()`), or leave the destructure as `const { git } = useServices()` to satisfy `noUnusedLocals`. Verify with the typecheck in Step 5.

- [ ] **Step 4: Run the deploy suites — verify they pass**

Run: `pnpm --filter @setu/admin test -- deploy`
Expected: PASS — the new test plus the existing `deploy.test`, `deploy-status`, and `deploy-button` suites (the draft-backed entry still gets snapshotted because it's committed in Git).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS (remove the now-unused `data` binding if the compiler flags it).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/deploy/deploy.tsx apps/admin/test/deploy.test.tsx
git commit -m "feat(admin): deploy snapshots all committed entries via git.list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full-suite + build verification

**Files:** none (verification only — no CSS changes are needed; the merged rows reuse the existing `.ctable` markup, and `—` renders in the existing `.ctable-muted` cell).

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm -r test`
Expected: PASS across `@setu/core`, `@setu/db-*`, `@setu/git-*`, `@setu/admin`. No reduction in count versus before the increment.

- [ ] **Step 2: Typecheck + edge guard, workspace-wide**

Run: `pnpm -r typecheck`
Expected: PASS (`@setu/core`'s `typecheck` includes the edge guard; `verbatimModuleSyntax` + `noUncheckedIndexedAccess` clean; `src/content-index` Node-free).

- [ ] **Step 3: Production build (fonts + jiti-free)**

Run: `pnpm --filter @setu/admin build`
Expected: build succeeds; brand fonts still emitted; no `jiti` in the bundle (the new code imports only browser-safe core subpaths).

- [ ] **Step 4: Manual smoke (optional, for the reviewer)**

Run: `pnpm dev`, then: open a post → **Publish** → from a fresh reload (drafts re-seed, but a published entry with no matching draft would appear) the content list shows committed entries with a Staged/Live pill; **Deploy** snapshots them. (Primary verification is the automated suite; this is a sanity check.)

- [ ] **Step 5: No commit** (verification only; nothing changed).

---

## Self-Review Notes (author)

- **Spec coverage:** enumeration primitive → Task 1; `parseContentPath` → Task 2; `listContentEntries` merge/derive → Task 3; content-list wiring + fork-on-open link + "—" → Task 4; deploy fix → Task 5; suites/build/edge-guard green → Task 6. Deferred items (DB index table, read-only preview, real timestamps) are intentionally absent.
- **Type consistency:** `list(prefix?: string): Promise<string[]>`, `parseContentPath(path): EntryRef | null`, `ContentRow { ref, title, locale, lifecycle, updatedAt, hasDraft }`, and `ListContentEntriesInput { drafts, committed: {ref, content}[], deployedAt }` are used identically across Tasks 1–5.
- **Interface-break coverage:** all four `GitPort` implementers (git-memory, git-local, git-testing fake, three core test fakes, types stub) gain `list` in Task 1, so typecheck stays green.
```
