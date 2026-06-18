# Deploy + Unpublish — Implementation Plan (slice 2 of publish/deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the lifecycle loop on the slice-1 seam: a **site-wide Deploy** (snapshots the in-browser Git as "live" → Staged becomes **Live**), **Unpublish/Re-publish** (the reversible `published:false` flag), the derived status now showing **Live/Unpublished** + pending badges, a role-gated **Publish ▾** action menu in the editor, and a **Deploy button** in the sidebar.

**Architecture:** A `DeployProvider` (app context) holds the "live" snapshot — `deploy()` (gated `site.deploy`) copies the current Git working set per known entry + the head sha. This is the **SSG-shaped `deployed` input** described in `docs/superpowers/specs/2026-06-14-saytu-topology-publishing-note.md` (keep `deriveLifecycle` topology-agnostic — `deployed` stays an input). `lifecycleFor` now passes the deployed snapshot, so Live/Unpublished light up. Unpublish/Re-publish flip `metadata.published` then reuse the publish (commit) path. The editor's single Publish button becomes a gated `Publish ▾` menu.

**Tech Stack:** React 18, the in-browser ports, `@setu/core` (`createPublishService`, `deriveLifecycle`, `contentPath`, the authz seam), Vitest. Builds on slice 1 (`useCan`, `lifecycleFor`, `lifecycleLabel`, `publish` in the services context).

**Strict TS:** `verbatimModuleSyntax` (`import type`), `noUncheckedIndexedAccess`. Verify per task: `pnpm --filter @setu/admin test` + `typecheck`.

---

### Task 1: DeployProvider — the in-browser "live" snapshot + deploy()

**Files:**
- Create: `apps/saytu-admin/src/deploy/deploy.tsx`
- Modify: `apps/saytu-admin/src/main.tsx` (wrap), `apps/saytu-admin/src/data/store.tsx` (only if `useServices` is needed inside DeployProvider — it is, for `data`/`git`)
- Test: `apps/saytu-admin/test/deploy.test.tsx`

- [ ] **Step 1: Write the failing test** — `apps/saytu-admin/test/deploy.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createServices, ServicesProvider } from '../src/data/store'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { contentPath } from '@setu/core'

describe('deploy', () => {
  it('snapshots committed content as live, and reports the deployed content per path', async () => {
    const services = createServices()
    const author = { name: 'T', email: 't@x' }
    const ref = { collection: 'post', locale: 'en', slug: 'p1' }
    // seed a committed entry: save a draft + publish it (commit to git-memory)
    await services.data.saveDraft({ ...ref, content: { type: 'doc', content: [] }, metadata: { title: 'P1' } })
    await services.publish.publish({ ref, author })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}><DeployProvider>{children}</DeployProvider></ServicesProvider>
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    // before deploy: nothing live
    expect(result.current.deployedAt(contentPath(ref))).toBeNull()
    await act(async () => { await result.current.deploy() })
    await waitFor(() => expect(result.current.deployedAt(contentPath(ref))).not.toBeNull())
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @setu/admin exec vitest run test/deploy.test.tsx`

- [ ] **Step 3: Implement `apps/saytu-admin/src/deploy/deploy.tsx`:**
```tsx
import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { contentPath } from '@setu/core'
import { useServices } from '../data/store'

interface DeployState {
  /** repo-path -> the content that is "live" (snapshot at the last deploy). */
  snapshot: ReadonlyMap<string, string>
  /** the HEAD sha that was deployed, or null if never deployed. */
  sha: string | null
}

interface DeployApi {
  /** The live content at a repo path, or null if not deployed. */
  deployedAt(path: string): string | null
  /** The deployed HEAD sha (null if never deployed). */
  sha: string | null
  /** Snapshot the current Git working set as "live" (the SSG-shaped stand-in). */
  deploy(): Promise<void>
}

const DeployContext = createContext<DeployApi | null>(null)

export function DeployProvider({ children }: { children: ReactNode }) {
  const { data, git } = useServices()
  const [state, setState] = useState<DeployState>({ snapshot: new Map(), sha: null })

  const deploy = useCallback(async () => {
    // Snapshot the committed content of every known entry as the live version.
    const drafts = await data.listDrafts()
    const next = new Map<string, string>()
    for (const d of drafts) {
      const path = contentPath(d)
      const content = await git.readFile(path)
      if (content !== null) next.set(path, content)
    }
    const sha = await git.headSha()
    setState({ snapshot: next, sha })
  }, [data, git])

  const deployedAt = useCallback((path: string) => state.snapshot.get(path) ?? null, [state])

  return <DeployContext.Provider value={{ deployedAt, sha: state.sha, deploy }}>{children}</DeployContext.Provider>
}

export function useDeploy(): DeployApi {
  const ctx = useContext(DeployContext)
  if (ctx === null) throw new Error('useDeploy must be used within a DeployProvider')
  return ctx
}
```

- [ ] **Step 4: Wrap in `main.tsx`** — add `<DeployProvider>` INSIDE the services provider (so it can `useServices`) and inside `ActorProvider`, wrapping `<App/>`. Read main.tsx first; preserve nesting order (Services/Data → Actor → Deploy → App).

- [ ] **Step 5: Run — expect PASS** + full suite. `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`. (If a test that renders `<App/>`/editor now needs `DeployProvider`, wrap its render helper — minimal.)

- [ ] **Step 6: Commit**
```bash
git add apps/saytu-admin/src/deploy apps/saytu-admin/src/main.tsx apps/saytu-admin/test/deploy.test.tsx
git commit -m "feat(deploy): in-browser DeployProvider — snapshot Git as the live version"
```

---

### Task 2: Wire the deployed snapshot into derived status (editor + content list)

**Files:**
- Modify: `apps/saytu-admin/src/lifecycle/useLifecycle.ts`, `apps/saytu-admin/src/editor/EditorScreen.tsx`, `apps/saytu-admin/src/screens/ContentList.tsx`
- Test: `apps/saytu-admin/test/deploy-status.test.tsx`

- [ ] **Step 1: Change `lifecycleFor` to accept the deployed lookup.** In `useLifecycle.ts`:
```ts
import type { Draft, EntryRef, GitPort, Lifecycle } from '@setu/core'
import { contentPath, deriveLifecycle, serializeMdoc, tiptapToMarkdoc } from '@setu/core'

/** Compose an entry's lifecycle from the draft (memory) + Git HEAD + the live
 *  (deployed) snapshot. `deployedAt(path)` returns the live content or null. */
export async function lifecycleFor(
  ref: EntryRef,
  draft: Draft | null,
  git: GitPort,
  deployedAt: (path: string) => string | null,
): Promise<Lifecycle> {
  const path = contentPath(ref)
  const draftStr = draft ? serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) }) : null
  const committed = await git.readFile(path)
  return deriveLifecycle({ draft: draftStr, committed, deployed: deployedAt(path) })
}
```

- [ ] **Step 2: Pass `deployedAt` in the editor + content list.** In `EditorScreen.tsx` and `ContentList.tsx`, add `const { deployedAt } = useDeploy()` and pass it to `lifecycleFor(ref, draft, git, deployedAt)`. In the editor, ALSO call `refreshLifecycle()` whenever the deploy snapshot changes — easiest: include `deployedAt` (a stable `useCallback`) in `refreshLifecycle`'s deps and re-run on deploy. Since deploy is a global action from the sidebar, the editor should re-derive when it regains focus or via the deploy `sha` — pull `sha` from `useDeploy()` and add it to a `useEffect` that calls `refreshLifecycle()`. Keep it simple: `useEffect(() => { void refreshLifecycle() }, [deploySha, refreshLifecycle])` where `deploySha = useDeploy().sha`.

- [ ] **Step 3: Write a status-after-deploy test** — `apps/saytu-admin/test/deploy-status.test.tsx`: render the editor at a seeded post inside `ServicesProvider`+`ActorProvider`+`DeployProvider`; publish (pill → Staged); then trigger a deploy (render a tiny harness that calls `useDeploy().deploy()`, or expose a Deploy control — simplest: render the sidebar `DeployButton` from Task 4 OR call deploy via a test harness component) and assert the pill becomes **Live**. If Task 4's button isn't built yet, use a small in-test harness component that calls `useDeploy().deploy()` on click. Assert pill `.badge` goes Staged → Live.

- [ ] **Step 4: Run + commit.** `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
```bash
git add apps/saytu-admin/src/lifecycle/useLifecycle.ts apps/saytu-admin/src/editor/EditorScreen.tsx apps/saytu-admin/src/screens/ContentList.tsx apps/saytu-admin/test/deploy-status.test.tsx
git commit -m "feat(status): feed the deployed snapshot into deriveLifecycle (Live/Unpublished)"
```

---

### Task 3: Unpublish / Re-publish + the gated Publish ▾ menu (editor)

**Files:**
- Create: `apps/saytu-admin/src/editor/PublishMenu.tsx`
- Modify: `apps/saytu-admin/src/editor/EditorScreen.tsx`
- Test: `apps/saytu-admin/test/editor-unpublish.test.tsx`

- [ ] **Step 1: Implement `PublishMenu.tsx`** — a small dropdown: a primary **Publish** button + an overflow with **Unpublish** (when `can('content.unpublish')` and the entry is live/staged) / **Re-publish** (when unpublished). Props: `{ canPublish, canUnpublish, isUnpublished, onPublish, onUnpublish, onRepublish }`. Render the primary `Publish` button (label "Publish") + a `▾` toggle that reveals the menu (a simple `useState` open + a list of `role="menuitem"` buttons). Keyboard-accessible (the toggle is a button; menu items are buttons). Gate each item by its `can*` flag.

- [ ] **Step 2: Write the failing unpublish test** — `apps/saytu-admin/test/editor-unpublish.test.tsx`: render the editor (real services + providers), publish, open the Publish menu, click **Unpublish**, assert the draft's `metadata.published === false` got committed (read via `services.git.readFile(contentPath(ref))` → `parseMdoc(...).frontmatter.published === false`) OR assert the status pill reflects an unpublish-pending/unpublished state. Keep the assertion concrete (prefer reading the committed file's frontmatter).

- [ ] **Step 3: Wire the handlers in `EditorScreen.tsx`:**
  - `onUnpublish`: `metaRef.current = { ...metaRef.current, published: false }; setMetadata(metaRef.current);` then run the existing publish flow (flush-save → `publish.publish` → refresh). Factor the publish flow into a reusable `commit()` so onPublish/onUnpublish/onRepublish share it.
  - `onRepublish`: `metaRef.current = { ...metaRef.current, published: true }` (or delete the key) then `commit()`.
  - Replace the single Publish button with `<PublishMenu .../>`, passing `canPublish={can('content.publish')}`, `canUnpublish={can('content.unpublish')}`, `isUnpublished={lifecycle.state === 'unpublished'}`, and the three handlers.

- [ ] **Step 4: Run + commit.** `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
```bash
git add apps/saytu-admin/src/editor/PublishMenu.tsx apps/saytu-admin/src/editor/EditorScreen.tsx apps/saytu-admin/test/editor-unpublish.test.tsx
git commit -m "feat(editor): Unpublish/Re-publish + gated Publish menu"
```

---

### Task 4: Sidebar Deploy button (site-wide, gated)

**Files:**
- Create: `apps/saytu-admin/src/shell/DeployButton.tsx`
- Modify: `apps/saytu-admin/src/shell/Sidebar.tsx`
- Test: `apps/saytu-admin/test/deploy-button.test.tsx`

- [ ] **Step 1: Implement `DeployButton.tsx`** — in the sidebar footer (near the theme toggle). Renders only when `can('site.deploy')`. A button "Deploy" that calls `useDeploy().deploy()`; shows the deployed short sha when present (e.g. "Deployed · a1b2c3d") or "Deploy" when never deployed. Optional: a staged count (entries whose `committed !== deployedAt`) — keep simple, the label + sha is enough for v1; a tooltip/subtext is fine.

- [ ] **Step 2: Write the test** — `apps/saytu-admin/test/deploy-button.test.tsx`: render the Sidebar (it needs `ActorProvider`+`ServicesProvider`+`DeployProvider`+`MemoryRouter`); assert a "Deploy" control is present for the owner; clicking it calls deploy (after a publish, the deployed sha appears / the label updates). For a non-permitted actor (`role: 'viewer'`), assert no Deploy control.

- [ ] **Step 3: Place it in `Sidebar.tsx`** — in the `sidebar-bottom`/footer area, before/after the theme toggle. Run + commit.
```bash
pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck
git add apps/saytu-admin/src/shell/DeployButton.tsx apps/saytu-admin/src/shell/Sidebar.tsx apps/saytu-admin/test/deploy-button.test.tsx
git commit -m "feat(deploy): site-wide Deploy button in the sidebar (gated site.deploy)"
```

---

### Task 5: StatusPill tones (live/unpublished) + CSS + full verification

**Files:**
- Modify: `apps/saytu-admin/src/ui/StatusPill.tsx`, `apps/saytu-admin/src/styles/{components,editor}.css`
- Test: `apps/saytu-admin/test/status-pill.test.tsx` (extend)

- [ ] **Step 1: Add tones for the new states.** In `StatusPill.tsx`'s `STATUS_TONE` map, add: `live: { tone: 'green', label: 'Live' }`, `unpublished: { tone: 'neutral', label: 'Unpublished' }` (keep `staged: amber`, `draft: neutral`, etc.). Extend `status-pill.test.tsx` to assert `Live`→`badge-green` and `Unpublished` renders.

- [ ] **Step 2: CSS** — add styling for `PublishMenu` (`.publish-menu`, `.publish-menu-toggle`, `.publish-menu-list`, `role=menuitem` items) and the `DeployButton` (`.deploy-btn`) in `editor.css`/`shell.css`, ported in the design spirit (use existing tokens; reuse `.btn`/`.strip-btn` patterns where possible). Verify every `var(--…)` resolves.

- [ ] **Step 3: Full verification + commit.**
```bash
pnpm --filter @setu/admin test
pnpm --filter @setu/admin typecheck
pnpm --filter @setu/admin build && grep -c fonts.googleapis apps/saytu-admin/dist/index.html
pnpm test && pnpm typecheck
```
Expected: all green; build OK + fonts > 0 + no jiti in dist; whole repo green; edge guard clean.
```bash
git add apps/saytu-admin/src/ui/StatusPill.tsx apps/saytu-admin/src/styles apps/saytu-admin/test/status-pill.test.tsx
git commit -m "feat(status): Live/Unpublished pill tones + PublishMenu/DeployButton CSS"
```

---

## Self-Review

**Spec coverage (slice 2 of the publish/deploy spec):**
- Site-wide Deploy (`DeployProvider` snapshot of Git as live, gated `site.deploy`) → Task 1 + 4. ✓
- Derived status now uses the real `deployed` input → Live/Unpublished + pending → Task 2. ✓
- Unpublish/Re-publish (reversible `published:false` flag via the commit path) + gated Publish ▾ menu → Task 3. ✓
- Sidebar Deploy button → Task 4. ✓
- StatusPill tones for live/unpublished + UI CSS → Task 5. ✓
- Topology note honored: `deriveLifecycle` stays topology-agnostic; the DeployProvider is the SSG-shaped `deployed` input (a Git working-set snapshot). ✓
- Content safety: Unpublish/Re-publish reuse the tested `publishService` commit path (conflict guard + durable commit); reversible flag never deletes content. ✓

**Placeholder scan:** No TBD/TODO. Task 3/4/5's UI is described against named props/classes with the handlers fully specified; the only prose-level bits (menu markup, button label) are bounded.

**Type consistency:** `useDeploy().deployedAt`/`deploy`/`sha` (Task 1) consumed by `lifecycleFor` (Task 2) + `DeployButton` (Task 4). `lifecycleFor(ref, draft, git, deployedAt)` signature updated once (Task 2) + both call sites updated. `PublishMenu` props (Task 3) match the editor's `can*`/handlers. `Lifecycle.state` `'live'`/`'unpublished'` (slice-1 core) drive the pill tones (Task 5). ✓

## Note on the topology design

Per `docs/superpowers/specs/2026-06-14-saytu-topology-publishing-note.md`: this slice's `DeployProvider` is the **SSG-shaped** stand-in for a real Astro build — it computes the `deployed` snapshot from the Git working set. A real edge/SSR Deploy would compute `deployed` differently (the served D1 index), but `deriveLifecycle` is unchanged — only the `deployed` input's source differs. Keep that boundary intact.
