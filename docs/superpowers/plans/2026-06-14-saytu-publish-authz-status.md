# Publish + RBAC seam + derived status — Implementation Plan (slice 1 of publish/deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the RBAC capability seam (`can(actor, action)`), a pure `deriveLifecycle` status function, a **role-gated Publish** action in the editor (commit draft → Git, Draft→Staged), and **derived status** in the editor + content list. (Site-wide Deploy, Live/Deployed, and Unpublish are slice 2.)

**Architecture:** Two new pure, edge-safe core modules (`@saytu/core/src/authz`, `.../lifecycle`). The app gains a constant **Owner** actor context (`useActor`/`useCan`) and a `publish` service in the existing services context. The editor flushes-saves then calls `publishService.publish` (gated by `content.publish`), and shows a read-only status pill from `deriveLifecycle`. The content list's status column switches to `deriveLifecycle`. No Deploy yet → the `deployed` input is always `null` (statuses are Draft/Staged this slice).

**Tech Stack:** React 18, Tiptap v3, the in-browser ports (db-memory + git-memory), zod, Vitest. Design refs: `docs/superpowers/specs/2026-06-14-saytu-publish-deploy-design.md` + `...-rbac-design.md`.

**Strict TS:** `verbatimModuleSyntax` (`import type`), `noUncheckedIndexedAccess`. The core modules are edge-safe (add `src/authz` + `src/lifecycle` to `packages/core/tsconfig.edge.json`). Verify per task: `pnpm --filter @saytu/core test`, `pnpm --filter @saytu/admin test`, both `typecheck`.

---

### Task 1: RBAC capability seam (`@saytu/core/src/authz`) + app actor context

**Files:**
- Create: `packages/core/src/authz/types.ts`, `default-roles.ts`, `authz.ts`
- Modify: `packages/core/src/index.ts` (export the authz API), `packages/core/tsconfig.edge.json` (include `src/authz`)
- Create: `apps/saytu-admin/src/auth/actor.tsx`
- Test: `packages/core/test/authz/authz.test.ts`, `apps/saytu-admin/test/actor.test.tsx`

- [ ] **Step 1: Write the failing core authz test** — `packages/core/test/authz/authz.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createAuthz, DEFAULT_ROLES } from '../../src/authz/authz'
import type { Actor } from '../../src/authz/types'

const authz = createAuthz(DEFAULT_ROLES)
const actor = (role: Actor['role']): Actor => ({ id: 'u', role })

describe('can', () => {
  it('owner can do everything', () => {
    expect(authz.can(actor('owner'), 'content.publish')).toBe(true)
    expect(authz.can(actor('owner'), 'site.deploy')).toBe(true)
    expect(authz.can(actor('owner'), 'roles.manage')).toBe(true)
  })
  it('editor can publish but not deploy or manage roles', () => {
    expect(authz.can(actor('editor'), 'content.publish')).toBe(true)
    expect(authz.can(actor('editor'), 'site.deploy')).toBe(false)
    expect(authz.can(actor('editor'), 'roles.manage')).toBe(false)
  })
  it('publisher can deploy', () => {
    expect(authz.can(actor('publisher'), 'site.deploy')).toBe(true)
  })
  it('viewer is read-only', () => {
    expect(authz.can(actor('viewer'), 'content.edit')).toBe(false)
    expect(authz.can(actor('viewer'), 'content.publish')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @saytu/core test -- authz`

- [ ] **Step 3: Implement the authz module.**

`packages/core/src/authz/types.ts`:
```ts
/** The permission vocabulary. Flat + global for now (per-resource scoping later). */
export type Action =
  | 'content.create' | 'content.edit' | 'content.delete'
  | 'content.publish' | 'content.unpublish'
  | 'site.deploy'
  | 'users.manage' | 'roles.manage' | 'settings.manage' | 'theme.manage'

export type Role = 'owner' | 'publisher' | 'editor' | 'author' | 'viewer'

export interface Actor {
  id: string
  role: Role
}

/** Role → the set of actions it may perform. */
export type PermissionMatrix = Record<Role, ReadonlySet<Action>>

export interface Authz {
  can(actor: Actor, action: Action): boolean
}
```

`packages/core/src/authz/default-roles.ts`:
```ts
import type { Action, PermissionMatrix } from './types'

const ALL: Action[] = [
  'content.create', 'content.edit', 'content.delete',
  'content.publish', 'content.unpublish',
  'site.deploy',
  'users.manage', 'roles.manage', 'settings.manage', 'theme.manage',
]

const EDITOR: Action[] = ['content.create', 'content.edit', 'content.delete', 'content.publish', 'content.unpublish']
const AUTHOR: Action[] = ['content.create', 'content.edit']

/** Default role → permissions. Admins can customize later (the matrix is data). */
export const DEFAULT_ROLES: PermissionMatrix = {
  owner: new Set(ALL),
  publisher: new Set<Action>(['site.deploy', ...EDITOR]),
  editor: new Set(EDITOR),
  author: new Set(AUTHOR),
  viewer: new Set<Action>(),
}
```

`packages/core/src/authz/authz.ts`:
```ts
import type { Action, Actor, Authz, PermissionMatrix } from './types'
export { DEFAULT_ROLES } from './default-roles'

/** Pure authorization: an actor's role → the matrix's allowed action set. */
export function createAuthz(matrix: PermissionMatrix): Authz {
  return {
    can(actor: Actor, action: Action): boolean {
      return matrix[actor.role]?.has(action) ?? false
    },
  }
}
```

- [ ] **Step 4: Export + edge guard.** In `packages/core/src/index.ts` add:
```ts
export type { Action, Role, Actor, PermissionMatrix, Authz } from './authz/types'
export { createAuthz, DEFAULT_ROLES } from './authz/authz'
```
In `packages/core/tsconfig.edge.json`, add `"src/authz"` to the `include` array (the authz module must stay Node-free). Run `pnpm --filter @saytu/core test -- authz` (PASS) + `pnpm --filter @saytu/core typecheck` (edge guard clean).

- [ ] **Step 5: Write the failing actor-context test** — `apps/saytu-admin/test/actor.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ActorProvider, useActor, useCan } from '../src/auth/actor'

const wrap = ({ children }: { children: ReactNode }) => <ActorProvider>{children}</ActorProvider>

describe('actor context', () => {
  it('provides a current actor (owner by default)', () => {
    const { result } = renderHook(() => useActor(), { wrapper: wrap })
    expect(result.current.role).toBe('owner')
  })
  it('useCan gates by the actor + DEFAULT_ROLES', () => {
    const { result } = renderHook(() => useCan(), { wrapper: wrap })
    expect(result.current('content.publish')).toBe(true)
    expect(result.current('site.deploy')).toBe(true)
  })
})
```

- [ ] **Step 6: Run — expect FAIL.** `pnpm --filter @saytu/admin test -- actor`

- [ ] **Step 7: Implement `apps/saytu-admin/src/auth/actor.tsx`:**
```tsx
import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Action, Actor } from '@saytu/core'
import { createAuthz, DEFAULT_ROLES } from '@saytu/core'

// No real auth yet — the app runs as a single Owner. Real users + auth swap this
// in later (the RBAC arc); every gated action already flows through useCan().
const OWNER: Actor = { id: 'local', role: 'owner' }

const ActorContext = createContext<Actor>(OWNER)

export function ActorProvider({ actor = OWNER, children }: { actor?: Actor; children: ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>
}

export function useActor(): Actor {
  return useContext(ActorContext)
}

/** Returns a `can(action)` bound to the current actor + the default matrix. */
export function useCan(): (action: Action) => boolean {
  const actor = useActor()
  const authz = useMemo(() => createAuthz(DEFAULT_ROLES), [])
  return (action: Action) => authz.can(actor, action)
}
```
Wrap the app in `<ActorProvider>` in `apps/saytu-admin/src/main.tsx` (inside the existing providers). Run `pnpm --filter @saytu/admin test -- actor` (PASS) + `pnpm --filter @saytu/admin typecheck`.

- [ ] **Step 8: Commit**
```bash
git add packages/core/src/authz packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/authz apps/saytu-admin/src/auth apps/saytu-admin/src/main.tsx apps/saytu-admin/test/actor.test.tsx
git commit -m "feat(authz): can(actor, action) capability seam + app Owner actor context"
```

---

### Task 2: `deriveLifecycle` pure status function (`@saytu/core/src/lifecycle`)

**Files:**
- Create: `packages/core/src/lifecycle/derive.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/tsconfig.edge.json` (include `src/lifecycle`)
- Test: `packages/core/test/lifecycle/derive.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/lifecycle/derive.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveLifecycle } from '../../src/lifecycle/derive'

// serialized .mdoc helpers
const body = (s: string) => `${s}\n`
const hidden = (s: string) => `---\npublished: false\n---\n${s}\n`

describe('deriveLifecycle', () => {
  it('draft-only (uncommitted, never deployed) → draft', () => {
    expect(deriveLifecycle({ draft: body('a'), committed: null, deployed: null })).toEqual({ state: 'draft' })
  })
  it('committed, not deployed → staged', () => {
    expect(deriveLifecycle({ draft: body('a'), committed: body('a'), deployed: null })).toEqual({ state: 'staged' })
  })
  it('committed but newer uncommitted edits, not deployed → staged · edited', () => {
    expect(deriveLifecycle({ draft: body('b'), committed: body('a'), deployed: null })).toEqual({ state: 'staged', pending: 'edited' })
  })
  it('deployed == committed == draft → live', () => {
    expect(deriveLifecycle({ draft: body('a'), committed: body('a'), deployed: body('a') })).toEqual({ state: 'live' })
  })
  it('live with newer uncommitted edits → live · edited', () => {
    expect(deriveLifecycle({ draft: body('b'), committed: body('a'), deployed: body('a') })).toEqual({ state: 'live', pending: 'edited' })
  })
  it('live with newer committed (not yet deployed) → live · staged', () => {
    expect(deriveLifecycle({ draft: body('b'), committed: body('b'), deployed: body('a') })).toEqual({ state: 'live', pending: 'staged' })
  })
  it('unpublish committed over a live entry → live · unpublishing', () => {
    expect(deriveLifecycle({ draft: hidden('a'), committed: hidden('a'), deployed: body('a') })).toEqual({ state: 'live', pending: 'unpublishing' })
  })
  it('hidden + deployed → unpublished', () => {
    expect(deriveLifecycle({ draft: hidden('a'), committed: hidden('a'), deployed: hidden('a') })).toEqual({ state: 'unpublished' })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @saytu/core test -- derive`

- [ ] **Step 3: Implement `packages/core/src/lifecycle/derive.ts`:**
```ts
import { parseMdoc } from '../markdoc/frontmatter'

export type LifecycleState = 'draft' | 'staged' | 'live' | 'unpublished'
export type LifecyclePending = 'edited' | 'staged' | 'unpublishing'

export interface Lifecycle {
  state: LifecycleState
  pending?: LifecyclePending
}

/** A serialized .mdoc whose frontmatter `published` is explicitly false. */
function hidden(s: string | null): boolean {
  if (s === null) return false
  return parseMdoc(s).frontmatter['published'] === false
}

/** Derive an entry's lifecycle from three serialized .mdoc snapshots:
 *  - `draft`: the working copy (DB), serialized; null if no draft
 *  - `committed`: the content at Git HEAD; null if never committed
 *  - `deployed`: the content in the live snapshot; null if never deployed
 *  Pure — no IO. */
export function deriveLifecycle(snap: {
  draft: string | null
  committed: string | null
  deployed: string | null
}): Lifecycle {
  const { draft, committed, deployed } = snap
  const aheadEdited = draft !== null && draft !== committed
  const liveOnSite = deployed !== null && !hidden(deployed)
  const takenDown = deployed !== null && hidden(deployed)

  if (liveOnSite) {
    if (aheadEdited) return { state: 'live', pending: 'edited' }
    if (committed !== deployed) return { state: 'live', pending: hidden(committed) ? 'unpublishing' : 'staged' }
    return { state: 'live' }
  }
  if (takenDown) {
    if (aheadEdited) return { state: 'unpublished', pending: 'edited' }
    if (committed !== deployed) return { state: 'unpublished', pending: 'staged' }
    return { state: 'unpublished' }
  }
  // never deployed
  if (committed !== null) {
    const state: LifecycleState = hidden(committed) ? 'draft' : 'staged'
    return aheadEdited ? { state, pending: 'edited' } : { state }
  }
  return { state: 'draft' }
}
```

- [ ] **Step 4: Export + edge guard.** In `packages/core/src/index.ts`:
```ts
export type { LifecycleState, LifecyclePending, Lifecycle } from './lifecycle/derive'
export { deriveLifecycle } from './lifecycle/derive'
```
Add `"src/lifecycle"` to `packages/core/tsconfig.edge.json` `include`. Run `pnpm --filter @saytu/core test -- derive` (PASS) + `pnpm --filter @saytu/core typecheck` (edge guard clean — `parseMdoc` is already edge-safe).

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/lifecycle packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/lifecycle
git commit -m "feat(lifecycle): deriveLifecycle pure status from draft/committed/deployed snapshots"
```

---

### Task 3: Publish wiring + gated Publish button + read-only status pill (editor)

**Files:**
- Modify: `apps/saytu-admin/src/data/store.tsx` (add `publish` to services), `apps/saytu-admin/src/editor/EditorScreen.tsx`
- Create: `apps/saytu-admin/src/lifecycle/useLifecycle.ts`
- Test: `apps/saytu-admin/test/editor-publish.test.tsx`

- [ ] **Step 1: Add the publish service to the context.** In `apps/saytu-admin/src/data/store.tsx`: import `createPublishService`, `type PublishService` from `@saytu/core`; add `publish: PublishService` to the `Services` interface; in `servicesFor`, add `publish: createPublishService({ data, git })`. (Keep everything else.)

- [ ] **Step 2: Create the lifecycle helper** — `apps/saytu-admin/src/lifecycle/useLifecycle.ts`:
```ts
import type { Draft, EntryRef, GitPort, Lifecycle } from '@saytu/core'
import { contentPath, deriveLifecycle, serializeMdoc, tiptapToMarkdoc } from '@saytu/core'

/** Compose an entry's lifecycle from the draft (in memory) + Git HEAD. `deployed`
 *  is null until slice 2 (Deploy) — so statuses are draft/staged here. */
export async function lifecycleFor(ref: EntryRef, draft: Draft | null, git: GitPort): Promise<Lifecycle> {
  const draftStr = draft ? serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) }) : null
  const committed = await git.readFile(contentPath(ref))
  return deriveLifecycle({ draft: draftStr, committed, deployed: null })
}
```

- [ ] **Step 3: Write the failing editor-publish test** — `apps/saytu-admin/test/editor-publish.test.tsx`. It renders `EditorScreen` with REAL services (`createServices()`), at a seeded post; asserts a **Publish** button is present (owner can publish); clicks it; waits; then asserts the status pill shows **Staged** (the draft got committed). Use `ActorProvider` + `ServicesProvider`. (Model it on the existing `editor-screen.test.tsx` real-services reopen test — same providers + `MemoryRouter`/`Routes`.) Example core of the test:
```tsx
it('publishing commits the draft and the status becomes Staged', async () => {
  const services = createServices()
  render(
    <MemoryRouter initialEntries={['/edit/post/en/release-notes']}>
      <ActorProvider>
        <ServicesProvider services={services}>
          <Routes><Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} /></Routes>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )
  await screen.findByDisplayValue('Release notes')
  fireEvent.click(screen.getByRole('button', { name: /publish/i }))
  await waitFor(() => expect(screen.getByText(/staged/i)).toBeInTheDocument())
})
```

- [ ] **Step 4: Run — expect FAIL** (no Publish button). `pnpm --filter @saytu/admin test -- editor-publish`

- [ ] **Step 5: Wire publish + status in `EditorScreen.tsx`.** Add (keep existing load/lock/autosave):
  - `const { publish } = useServices()`, `const can = useCan()`, `const [lifecycle, setLifecycle] = useState<Lifecycle>({ state: 'draft' })`, `const [publishMsg, setPublishMsg] = useState<string | null>(null)`.
  - A `refreshLifecycle()` that calls `lifecycleFor(ref, await services.data.getDraft(ref), services.git)` → `setLifecycle`. Call it after load and after publish. (Pull `data`/`git` from `useServices` too.)
  - `const OWNER_AUTHOR = { name: 'Local', email: 'local@saytu.dev' }`.
  - An `onPublish` handler (only when `can('content.publish')`): flush-save the current draft via `authoring.save({ ...ref, content: docRef.current, metadata: metaRef.current, baseSha: baseShaRef.current }, EDITOR_ID)`; then `const r = await publish.publish({ ref, author: OWNER_AUTHOR })`; on `r.status==='published'` → `baseShaRef.current = r.sha`, `setPublishMsg('Published · ' + r.sha.slice(0,7))`, `await refreshLifecycle()`; on `'conflict'` → `setPublishMsg('The published version moved — reload to continue.')`; on `'nothing'` → no-op.
  - In the top strip's `ed-strip-right`, render a **read-only status pill** (`<StatusPill>` from `../ui/StatusPill`, mapping the lifecycle to a label — see below) and, when `can('content.publish')`, a `<button className="btn btn-primary btn-md" onClick={onPublish}>Publish</button>` + the `publishMsg` inline. When `!can('content.publish')`, render only the pill.
  - Status label: map `lifecycle` → a string for the pill: `state==='staged' ? 'Staged' : state==='live' ? 'Live' : state==='unpublished' ? 'Unpublished' : 'Draft'`, appending the pending badge if present (e.g. `Live · edited`). Pass that string to `StatusPill` (it already tones known words; `Staged`→amber, etc.). For the pending-suffixed labels, render the base word in `StatusPill` and the `· pending` as a small muted span beside it (keep it simple — a `<span className="status-pending">· {pending}</span>`).

- [ ] **Step 6: Run — expect PASS** + full suite. `pnpm --filter @saytu/admin test && pnpm --filter @saytu/admin typecheck`. The publish test goes green (after publish, `git.readFile` returns the committed file == the serialized draft → `deriveLifecycle` → `staged`). Existing editor tests stay green (the new providers/pill don't break them — if `editor-screen.test.tsx` now needs `ActorProvider`, wrap its render helper; update minimally).

- [ ] **Step 7: Commit**
```bash
git add apps/saytu-admin/src/data/store.tsx apps/saytu-admin/src/lifecycle apps/saytu-admin/src/editor/EditorScreen.tsx apps/saytu-admin/test/editor-publish.test.tsx
git commit -m "feat(editor): gated Publish (commit -> Staged) + read-only derived status pill"
```

---

### Task 4: Content-list derived status + CSS + test updates

**Files:**
- Modify: `apps/saytu-admin/src/screens/ContentList.tsx`, `apps/saytu-admin/src/styles/editor.css` (or a small status-pending rule), `apps/saytu-admin/test/content-list.test.tsx`

- [ ] **Step 1: Update the content-list status column.** `ContentList` currently shows `metadata.status` via `StatusPill`. Switch each row to the **derived** status: after loading drafts, for each draft compute `await lifecycleFor({collection,locale,slug}, draft, git)` (pull `git` from `useServices`), store a `Map<slug, Lifecycle>` in state, and render the pill from the lifecycle (same label mapping as the editor — factor it into a tiny `lifecycleLabel(lifecycle): {label, pending?}` helper in `apps/saytu-admin/src/lifecycle/label.ts`, used by both ContentList and EditorScreen). Seeded drafts were never committed to git-memory → they derive to `draft` (honest — they aren't really published yet); after a real publish they show `staged`.

- [ ] **Step 2: Add the `lifecycleLabel` helper** — `apps/saytu-admin/src/lifecycle/label.ts`:
```ts
import type { Lifecycle } from '@saytu/core'

const STATE_LABEL: Record<Lifecycle['state'], string> = {
  draft: 'Draft', staged: 'Staged', live: 'Live', unpublished: 'Unpublished',
}

export function lifecycleLabel(lc: Lifecycle): { label: string; pending?: string } {
  const label = STATE_LABEL[lc.state]
  return lc.pending ? { label, pending: lc.pending } : { label }
}
```
Use it in both `ContentList` and `EditorScreen` (replace the inline mapping in Task 3 Step 5 with this helper for consistency).

- [ ] **Step 3: Update the content-list tests.** `apps/saytu-admin/test/content-list.test.tsx` currently asserts `'Published'` for a seeded `metadata.status:'published'` row. With derived status (git empty → all seeded rows are `draft`), change those assertions: the rows now show **Draft** (the seeded `metadata.status` no longer drives the pill). Update the assertions to the derived labels (e.g. expect `getAllByText('Draft')` for the seeded posts). Keep the row-count/filter/empty-state tests. The test's `renderList` wraps in `DataProvider` (which builds services incl. `git`) — `useServices().git` is available; if `ContentList` now needs `git`, confirm `DataProvider` provides it (it does, via `servicesFor`). Add `ActorProvider` to `renderList` only if `ContentList` reads `useCan` (it doesn't need to — the list is read-only display; skip).

- [ ] **Step 4: Add minimal CSS** for the pending badge in `apps/saytu-admin/src/styles/editor.css` (or `components.css`):
```css
.status-pending { font-size: 12px; color: var(--text-4); margin-left: 4px; font-weight: 500; }
```
Verify the token resolves; substitute if needed.

- [ ] **Step 5: Full verification + commit**
```bash
pnpm --filter @saytu/admin test
pnpm --filter @saytu/admin typecheck
pnpm --filter @saytu/admin build && grep -c fonts.googleapis apps/saytu-admin/dist/index.html
pnpm test && pnpm typecheck
```
Expected: all green; build OK + fonts > 0; whole repo green (core authz + lifecycle units; edge guard clean).
```bash
git add apps/saytu-admin/src/screens/ContentList.tsx apps/saytu-admin/src/lifecycle/label.ts apps/saytu-admin/src/styles/editor.css apps/saytu-admin/test/content-list.test.tsx
git commit -m "feat(content-list): derived lifecycle status column"
```

---

## Self-Review

**Spec coverage (slice 1 of the publish/deploy spec):**
- Capability seam (`Action`/`Role`/`Actor`/matrix/`can()`, DEFAULT_ROLES, edge-safe) + app Owner actor + `useCan` → Task 1. ✓
- `deriveLifecycle` pure fn (all states incl. live/unpublished/pending, though `deployed` is null until slice 2) → Task 2. ✓
- Publish service in context + gated Publish (flush-save → publish → published/conflict) + read-only status pill → Task 3. ✓
- Content-list derived status + shared `lifecycleLabel` → Task 4. ✓
- Read-only-pill-for-all + gated-action (Publish button only when `can('content.publish')`) → Task 3. ✓
- Deferred to slice 2: Deploy + DeployState + Live/Deployed + Unpublish/Re-publish + the "Publish ▾" multi-action dropdown + the sidebar Deploy button. (This slice's status pill shows Draft/Staged; Live/Unpublished light up once Deploy exists.) ✓
- Content-safety: publish reuses the tested core service (round-trip + conflict guard); flush-save before publish. ✓

**Placeholder scan:** No TBD/TODO. Task 3 Step 5 / Task 1 Step 7 give the exact wiring against named symbols; the only prose-described UI is the pill label mapping, fully specified + factored into `lifecycleLabel`.

**Type consistency:** `Action`/`Actor`/`Role` (Task 1) used by `useCan` (Task 1) + the Publish gate (Task 3). `Lifecycle` (Task 2) returned by `deriveLifecycle` + `lifecycleFor` (Task 3) + `lifecycleLabel` (Task 4), consumed by EditorScreen + ContentList. `PublishService`/`publish()` from `@saytu/core` added to `Services` (Task 3). `serializeMdoc`/`tiptapToMarkdoc`/`contentPath`/`parseMdoc` are existing core exports. ✓
