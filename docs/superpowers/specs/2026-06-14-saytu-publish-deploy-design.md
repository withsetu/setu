# Design — Publish / Deploy / Lifecycle (+ capability seam)

_Date: 2026-06-14 · Status: approved (converged in UAT discussion)_

## Purpose

Complete the editor's purpose: let a writer **Publish** a draft (commit to Git →
Staged), let a publisher **Deploy** the site (Staged → Live), and **Unpublish**
(reversible). Show each entry's true **derived lifecycle status** (read-only pill +
a role-gated action menu). Introduce the **RBAC capability seam** so every
state-changing action flows through `can(actor, action)` from day one. All
in-browser on the existing ports; no server. Real auth/users + the admin matrix UI
are a later arc (see `2026-06-14-saytu-rbac-design.md`).

## The lifecycle model (agreed)

- **Draft** — working copy in the DB; not in Git. **Per-post.**
- **Staged** — committed to Git (canonical), not yet live. **Per-post** action:
  **Publish**.
- **Live** — on the deployed site. **Site-wide** action: **Deploy** (builds/ships
  the whole repo → everything Staged goes Live at once).
- **Unpublished** — was live, taken down (a reversible `published:false` flag).

A post has **two facts**: a primary live state + a *pending* badge when the working
copy is ahead of live (`edited` = uncommitted edits, `staged` = committed-not-live,
`unpublishing` = removal committed-not-live). Combos read: `Live`, `Live · edited`,
`Live · staged`, `Staged`, `Draft`, `Unpublishing`, `Unpublished`.

## Scope

**In:**
1. **Capability seam** — `@saytu/core/src/authz/`: the `Action` vocabulary,
   `DEFAULT_ROLES` matrix, `createAuthz(matrix).can(actor, action)` (pure,
   edge-safe). App context provides a constant **Owner** actor via `useActor()`
   (no auth yet → Owner ⇒ all `can()` true). Publish/Deploy/Unpublish are gated.
2. **Publish service in the app** — add `publish` (`createPublishService({data,
   git})`) to the services context.
3. **Publish action** (editor, per-post, gated `content.publish`): flush-save the
   draft → `publish({ref, author: OWNER_AUTHOR})` → handle `published` (advance
   local baseSha, refresh status) / `conflict` (clear message) / `nothing` (no-op).
4. **Deploy** (site-wide, gated `site.deploy`): a `DeployState` in app context —
   `deploy()` snapshots the Git working set as the "live" version (`snapshot:
   Map<path,content>`, `sha`). Stands in for the real Astro build (deferred). A
   **Deploy button in the app chrome** (sidebar footer) shows the deploy state
   (e.g. "Deploy · N staged").
5. **Unpublish / Re-publish** (gated `content.unpublish`/`content.publish`):
   set `metadata.published = false`/`true`, then publish (commit) — the same
   pipeline, reversible (content kept). Detected via frontmatter.
6. **Derived status** — a pure core fn `deriveLifecycle({draft, committed,
   deployed})` (each = a serialized `.mdoc` string | null) → `{state, pending}`.
   Shown read-only in the editor (pill) + the content-list status column
   (replacing the seeded freeform `metadata.status`).
7. **Status UX** — read-only pill for everyone; the state-changing actions sit in a
   role-gated **"Publish ▾"** dropdown/overflow in the editor top strip, visible+
   enabled only where `can()` holds. (Viewer → pill only.)

**Out (deferred):**
- Real Astro build/deploy to the web (demo Deploy snapshots Git instead).
- Real auth + users + the admin Users&Roles matrix UI (the RBAC arc).
- Browsing Git-only published entries (no draft) in the content list — needs a Git
  listing/reindex; entries that still have a draft show + reopen fine.
- Conflict-resolution UX (beyond a clear message), commit-message box, scheduling,
  per-resource permission scoping, audit log.

## Architecture / data flow

```
packages/core/src/authz/                 # NEW (pure, edge-safe)
├── types.ts        # Action union, Role, Actor, PermissionMatrix
├── default-roles.ts# DEFAULT_ROLES matrix (owner/publisher/editor/author/viewer)
└── authz.ts        # createAuthz(matrix).can(actor, action)
packages/core/src/lifecycle/             # NEW (pure)
└── derive.ts       # deriveLifecycle({draft, committed, deployed}) -> {state, pending}
apps/saytu-admin/src/
├── data/store.tsx          # + publish service; + DeployState + ActorContext
├── auth/actor.tsx          # useActor() -> constant Owner; useCan()
├── deploy/deploy.tsx       # DeployProvider: snapshot + sha + deploy(); useDeploy()
├── editor/EditorScreen.tsx # Publish ▾ menu (gated) + read-only status pill
├── editor/PublishMenu.tsx  # the role-gated action dropdown
├── shell/DeployButton.tsx  # site-wide Deploy in the sidebar footer
├── screens/ContentList.tsx # status column -> deriveLifecycle (needs git+deploy)
└── lifecycle/useLifecycle.ts # compose draft+committed+deployed -> status for a ref
```

- **Status for an entry** = `deriveLifecycle({ draft: draft && serializeMdoc(draft),
  committed: await git.readFile(contentPath(ref)), deployed:
  deployState.snapshot.get(contentPath(ref)) ?? null })`. Pure derivation in core;
  the app gathers the three inputs.
- **Publish:** save → `publish()` → on `published`, the committed file now equals
  the draft’s serialization (round-trip determinism), so status recomputes to
  Staged (or Live·staged if already deployed).
- **Deploy:** snapshot the Git working set → entries whose committed == snapshot
  become Live/Deployed.

## `deriveLifecycle` rules (the pure fn; precise)

`hidden(s)` = `s != null && parseMdoc(s).frontmatter.published === false`.
Inputs `draft|committed|deployed` are serialized `.mdoc` strings or null.

1. **liveOnSite** = `deployed != null && !hidden(deployed)`.
   **takenDown** = `deployed != null && hidden(deployed)`.
2. If **liveOnSite** → `state:'live'`; pending: `draft && draft !== committed →
   'edited'` else `committed !== deployed → (hidden(committed) ? 'unpublishing' :
   'staged')` else none.
3. Else if **takenDown** → `state:'unpublished'`; pending: `draft && draft !==
   committed → 'edited'` else `committed !== deployed → 'staged'` else none.
4. Else (never deployed):
   - `committed != null` → `state: hidden(committed) ? 'draft' : 'staged'`; pending
     `draft && draft !== committed → 'edited'`.
   - else → `state:'draft'`.

Tested as a pure unit (a table of input triples → expected `{state, pending}`).

## Error handling / edge cases

- **Forbidden action** (`can()` false) → the UI doesn't render/enable it; if a
  service path is reached, it returns `forbidden` and writes nothing (defense in
  depth). Owner ⇒ never forbidden today.
- **Publish conflict** (base-SHA guard) → a clear inline message; nothing
  committed (durable-commit semantics from the tested core service).
- **Save-before-publish** → publish reads storage, so the latest edits must be
  flushed first (cardinal rule: publish the current content).
- **Unpublish is non-destructive** → a `published:false` flag commit; content stays
  in Git; Re-publish flips it back.
- **Deploy with nothing staged** → no-op (snapshot == current); button reflects "0
  staged".

## Testing (behavior)

- **authz:** `can()` against `DEFAULT_ROLES` — owner all-true; viewer read-only;
  editor can publish but not deploy; publisher can deploy; unknown action false.
- **deriveLifecycle:** the rule table (draft-only→draft; committed-not-deployed→
  staged; deployed==committed==draft→live; deployed + newer draft→live·edited;
  deployed + newer commit→live·staged; published:false deployed→unpublished;
  hidden committed over live→live·unpublishing).
- **Publish wiring:** clicking Publish (with `content.publish`) saves then calls
  `publish`; `published`→status recomputes to staged/live·staged; `conflict`→
  message. A viewer (no permission) sees no Publish control.
- **Deploy wiring:** `deploy()` snapshots git; an entry’s status flips to live; the
  Deploy button reflects staged count.
- **Unpublish:** sets `published:false` + commits; status → unpublishing→
  (after deploy) unpublished; Re-publish reverses.
- **Content list status column** uses `deriveLifecycle`. Existing admin tests stay
  green (the seeded `metadata.status` strings give way to derived status — update
  those assertions). `verbatimModuleSyntax`/`noUncheckedIndexedAccess` clean; build
  keeps fonts + stays jiti-free.

## Definition of done

- `pnpm --filter @saytu/core test` (authz + lifecycle units) + `pnpm --filter
  @saytu/admin test` green; typecheck + edge guard clean; build OK (fonts, no jiti).
- `pnpm dev`: open a draft → **Publish** (status → Staged) → **Deploy** in the
  sidebar (status → Live) → edit (Live · edited) → Publish (Live · staged) → Deploy
  (Live) → **Unpublish** (Unpublishing → after Deploy, Unpublished) → Re-publish.
  A non-permitted role sees the read-only pill only (Owner has all permissions
  today, so this is exercised via a test actor).
- Committed via the subagent-driven flow.

## Note on scope

Larger increment (capability seam + publish + deploy + unpublish + derived status +
status UI). Decomposed into tight tasks in the plan: (1) authz seam, (2)
deriveLifecycle, (3) publish wiring + actor/deploy context, (4) Deploy button +
status pill + content-list status, (5) Unpublish/Re-publish + the role-gated
PublishMenu, (6) CSS. Built test-first; content safety (publish/round-trip/conflict)
already guaranteed by the core services this composes.
