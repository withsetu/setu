# Design Note — Multi-topology publishing & mode/method switching

_Date: 2026-06-14 · Status: forward-looking architecture note (NOT a build spec). Captures the topology/publishing model + what switching modes implies, so we handle it correctly when the edge adapters, the Git→DB reindex, and the render-aware Deploy land. Surfaced by a product-owner question during the publish-lifecycle work._

## The core reframe

The deployment **mode/method is not decided at publish time** — it is a **configured
wiring of adapters behind the ports**. Publishing itself is identical in every
topology; only *which adapter* fills each slot changes. Two independent axes:

**Axis 1 — Write (Publish): canonical content always goes to Git, via `GitPort`.**
- local / self-hosted → `git-local` (commit to a repo on disk)
- edge → `git-github` (commit via the GitHub API — Workers have no filesystem)

**Axis 2 — Serve (render / Deploy): how the live site *reads* that content.**
- **SSG** (free default) — an Astro build reads **Git** → static files. The build runs
  somewhere: locally, or in CI / a host (Cloudflare Pages, Netlify, Vercel) watching
  the remote repo. "local repo vs remote repo" is a **build-location** choice, not a
  different content source — both read Git.
- **SSR** (Pro) — a server reads a **DB-derived index** per request. The DB is **not a
  separate source of truth** — it is a *cache derived from Git* (the "reindex").

"Mode" (local / edge / self-hosted) = the concrete adapter set:
filesystem + sqlite + Node, vs github-api + D1 + Worker.

## Topology matrix

| Mode | Publish (write) | SSG serve | SSR serve (Pro) |
| --- | --- | --- | --- |
| Local | `git-local` | build local clone → static | local Node server ← sqlite index |
| Edge | `git-github` (API) | CI/host build ← remote repo | Worker ← D1 index |
| Self-hosted | `git-local` (or push to remote) | build on the box (or CI) | Node server ← sqlite index |

Additional shapes (don't model as either/or):
- **Hybrid SSG+SSR** — Astro islands: some pages static, some dynamic.
- **SSR always needs the reindex step** (Git → DB index); "db" is *downstream* of Git.
- SSG-free / SSR-Pro is also a licensing line.

## What switching mode/method does to published content + status

**The payoff of Git-canonical:** every topology reads/writes the *same repo* through
different adapters, so **published content is portable — switching never loses it.**
local-SSG → edge-SSR → self-hosted-SSG: the published content is always just the Git
repo.

**What IS topology-local and needs rebuild/migration on a switch:**
1. **The derived DB index** (content list, search, SSR reads) — *derived from Git*, so on
   a new topology you **reindex from Git**. No loss; a rebuild step.
2. **In-flight drafts** (uncommitted, in the DB) — topology-local; a switch needs draft
   export/import (or publish them first). Not *published* loss, but WIP to carry over.
3. **What "Live" means** — driven by the render method:
   - **SSG:** Live = the commit the last static build shipped → a real **Staged → Live
     gap** (committed but not yet rebuilt).
   - **SSR:** Live = whatever the server serves now → committing ≈ going live; the gap
     shrinks/disappears.
   - So **SSG→SSR** can make previously-"Staged" content immediately Live; **SSR→SSG**
     re-introduces the build gap.

**Why the status model already survives this:** lifecycle status is **derived** from
three snapshots — draft (DB), committed (Git), and *what's actually live* (the deploy
target) — via the pure `deriveLifecycle({draft, committed, deployed})`
(`packages/core/src/lifecycle/derive.ts`). Each topology supplies those three its own
way. On a switch, status **recomputes from the new reality** rather than carrying a
stale stored flag. **One status engine, three inputs, any topology** — `deployed` is an
*input*, so each topology's Deploy adapter just computes it differently (the snapshot
the last SSG build shipped; or the current SSR-served index). No redesign needed.

## Built vs. deferred (honest)

- ✅ **Built / building** — the things that make switching *safe and possible*: the ports
  (`DataPort`, `GitPort`), Git-canonical, the `git-local` adapter, the in-browser
  `db-memory`/`git-memory`, `publishService`, and the **derived** `deriveLifecycle`.
- 🔜 **Deferred (by design)** — the *switching mechanics*:
  - **Git→DB reindex** (rebuild the derived index/content-index on a new topology, and for
    SSR reads).
  - **Draft migration** across DataPort adapters.
  - **Render-method-aware Deploy** — SSG = a discrete build+ship (a "deployed commit"
    pointer); SSR = continuous serve from the index (commit ≈ live, or a promote-the-index
    step). `deriveLifecycle`'s `deployed` input must be computed per the active method.
  - **Edge adapters** — `git-github` (GitPort over the GitHub API) + `db-d1` (DataPort over
    D1).
  - **The deploy trigger / build hook** (local build vs CI/host build) and where SSG output
    is served (CDN/Pages/R2).

## Requirements this places on future work (so we get it right when it lands)

1. **Keep `deriveLifecycle` topology-agnostic** — never bake SSG/SSR assumptions into the
   pure function; topologies feed it the three snapshots. (Already true.)
2. **Model `deployed` as a topology-provided snapshot/pointer**, not a stored per-entry
   "published" flag. The slice-2 in-browser Deploy (a Git working-set snapshot) is the
   SSG-shaped stand-in; the edge/SSR Deploy computes `deployed` from the served index.
3. **Reindex must be idempotent + derivable purely from Git** — so any topology can rebuild
   its index from the canonical repo (and so a fresh clone "just works").
4. **Drafts are the only non-portable state worth migrating** — published content rides Git;
   provide a draft export/import (or "publish-before-switch") path.
5. **Surface the active mode/method** in the admin so the status UI can label the Staged↔Live
   gap correctly (SSG shows it; SSR may collapse it).

This note is reference material — no code changes. Revisit when building: slice-2 Deploy,
the reindex/content-index DataPort slice, the edge (`git-github`/`db-d1`) arc, and the
deploy hook.
