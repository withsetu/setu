# Saytu Architecture (Concepts)

> **What this is:** a plain-English tour of how Saytu is built and *why*. It explains the
> ideas — not the API surface (method signatures change; the ideas don't). If you're new
> to the codebase, read this first.
>
> **Status:** this describes what is **actually built today**, and flags what is **planned**.
> The product requirements doc ([../plan/prd.md](../plan/prd.md)) describes the full target
> system; where the two differ, this file is the source of truth for *current reality*.

---

## What Saytu is

A 100% open-source, Git-backed, **multi-topology** content management engine. "Multi-topology"
is the whole point: the *same* engine runs as a local app on your laptop, as a self-hosted
server, or on the edge (Cloudflare Workers) — without rewriting the core. It pairs a
block-based Tiptap editor with Git as the canonical store.

The single architectural bet that makes this possible is **Ports & Adapters**.

---

## The big idea: Ports & Adapters (Hexagonal Architecture)

Saytu's core logic never hardcodes *where* it runs or *what* it talks to. Instead it depends
only on **ports** — small contracts that say "here's what I need," not "here's how to do it."
Concrete **adapters** fulfill those contracts and are swapped per environment.

**Analogy — a wall power socket.** Your charger doesn't care whether the electricity comes
from coal, solar, or a battery. It needs the socket to deliver power in the agreed shape. The
socket is the *contract* (the port); the power source behind it is swappable (the adapter).

```
            ┌───────────────────────────────────┐
            │        @setu/core  (engine)        │
            │  pure logic — knows only the ports  │
            └───────┬───────────────────┬─────────┘
                    │ GitPort            │ DataPort
        ┌───────────┴──────┐    ┌────────┴───────────┐
   git-memory  git-local   │    │ db-memory  db-sqlite
   (browser)   (disk)  git-github│  (browser)  (file)   db-d1
                        *planned*│                     *planned*
```

The payoff: **write the engine once, run it anywhere** by plugging in different adapters. It's
also why the entire engine can run *inside the browser* with no server at all (see
[The in-browser bet](#the-in-browser-bet)).

---

## The two ports we have today

### `GitPort` — the canonical store

Everything Saytu needs to do with Git, as a contract:

- `headSha()` — what's the latest commit?
- `readFile(path)` — give me this file's content
- `commitFile(...)` — save this file and commit it
- `list(prefix?)` — what files exist? *(in the repo / under a prefix)*

That's the whole interface. It says nothing about *where* the repo lives. Adapters built today:

- **`git-memory`** — a `Map` in browser memory (the in-browser demo)
- **`git-local`** — a real Git repo on disk via isomorphic-git (local / self-hosted)
- **`git-github`** *(planned)* — commits via the GitHub API, for edge (Workers have no filesystem)

### `DataPort` — the working store

Everything Saytu needs from a database. Two clusters of verbs — **drafts** and **locks**:

- `getDraft` / `saveDraft` / `deleteDraft` / `listDrafts` — work-in-progress edits
- `getLock` / `putLock` / `deleteLock` — pessimistic edit locks (so two people don't clobber
  each other on the same entry)
- `close()` — release the database

Adapters built today:

- **`db-memory`** — a `Map` in browser memory (the in-browser demo)
- **`db-sqlite`** — a real SQLite database (local / self-hosted)
- **`db-d1`** *(planned)* — Cloudflare D1, for edge

> Every port has a shared **contract test suite** (e.g. `runGitPortContract`) that every adapter
> must pass. That's how we guarantee the in-memory fake and the real adapter behave identically —
> so the engine genuinely doesn't care which is plugged in.

**Planned ports (not built yet):** `StoragePort` (media uploads), `ImagePort` (image
optimization), `AuthPort` (identity), `EmailPort` (notifications).

---

## Source of truth: Git is canonical, the database is derived

This is the most important idea in Saytu, and it drives everything else.

- **Git (`GitPort`) is canonical** — it holds your real, published content. It is the truth.
- **The database (`DataPort`) is derived and disposable** — it holds *drafts* (not yet
  published) and *locks* (who's editing now). It's a fast working layer + cache.

**Analogy — filing cabinet vs scratchpad.** Git is the filing cabinet (permanent, authoritative).
The database is the scratchpad (fast, convenient, throwaway). If the database vanished, you'd lose
in-progress drafts but **nothing published** — because published content lives in Git.

The big consequence: **the database can always be rebuilt from Git.** Move to a faster machine,
or switch to edge mode? Point the engine at the canonical Git repo and *replay* it — the database
index reconstructs itself, no published content lost. This rebuild step is called a **reindex**.
The `listContentEntries` function (the content list) is the first, in-memory version of exactly
that: it derives the live view by reading from Git, not by trusting a stored copy.

---

## The content lifecycle: Draft → Staged → Live

Because of the Git/DB split, every entry moves through a small set of states. Status is
**derived** from three snapshots (the draft in the DB, the committed file in Git, and what's
actually deployed) — never stored as a flag that could go stale.

| State | Where it lives | How it gets there |
| --- | --- | --- |
| **Draft** | database only | you're editing; autosave writes to `DataPort` |
| **Staged** | committed to Git | you hit **Publish** → `commitFile` to `GitPort` |
| **Live** | on the deployed site | site-wide **Deploy** ships everything staged |
| **Unpublished** | taken down (reversibly) | a `published: false` flag — content is kept, never deleted |

A post can also be *ahead* of where it's live — e.g. **Live · edited** (live, but you've made
newer edits) or **Live · staged** (live, but a newer version is committed and waiting for the
next Deploy). One status engine, three inputs, any topology.

> **Per-post vs site-wide:** *Publish* is per-post (a writer commits their entry). *Deploy* is
> site-wide (everything staged goes live at once). That split mirrors how SSG sites actually ship.

---

## The engine: `@setu/core`

`@setu/core` is pure logic that depends only on the ports. It contains:

- **`markdoc/`** — the round-trip between the editor's Tiptap JSON and Markdoc `.mdoc` files
  (`tiptapToMarkdoc` / `markdocToTiptap`), plus frontmatter (`parseMdoc` / `serializeMdoc`).
- **`config/`** — `saytu.config.ts` schema, parsing, and the default block set.
- **`authoring/`** — draft + lock orchestration (the first core logic to consume a port).
- **`publish/`** — the publish service: compile draft → commit to Git, with a **base-SHA
  conflict guard** (won't clobber external Git edits).
- **`read/`** — load an entry for editing; if there's no draft, **fork one from published Git
  content** (this is "open-on-click" for published posts).
- **`authz/`** — `can(actor, action)` permission checks against a role matrix.
- **`lifecycle/`** — `deriveLifecycle(...)`, the pure status engine above.
- **`content-index/`** — `listContentEntries(...)`, the reindex/merge that unions drafts + Git
  entries into one list.

A key discipline: most of core is **edge-safe** (no Node/DOM dependencies), enforced by a
separate typecheck (`tsconfig.edge.json`). That's what lets the same code run in a Cloudflare
Worker *and* the browser.

---

## Multi-topology: same engine, different adapters

"Topology" = a concrete set of adapters wired behind the ports. The engine is identical across
all of them; only the plugs change.

| Topology | Write (Publish) | Serve | Database |
| --- | --- | --- | --- |
| **Local** | `git-local` | SSG build reads Git → static files | `db-sqlite` |
| **Self-hosted** | `git-local` (or push to remote) | SSG, or SSR server | `db-sqlite` |
| **Edge** *(planned)* | `git-github` (API) | SSG via CI/host, or SSR Worker | `db-d1` |

Two independent axes worth separating in your head:

- **Write** always goes to Git (`GitPort`) — canonical content is portable across every topology.
- **Serve** is how the live site *reads* that content: **SSG** (a build reads Git → static files,
  the free default) or **SSR** (a server reads the DB-derived index per request — a Pro feature).

Because Git is canonical, **switching topology never loses published content** — at worst you
*reindex* the derived database on the new environment. (Full detail:
[the topology note](superpowers/specs/2026-06-14-saytu-topology-publishing-note.md).)

---

## The in-browser bet

Today's admin app (`apps/saytu-admin`) runs the **entire `@setu/core` engine plus the in-memory
adapters (`git-memory` + `db-memory`) directly in the browser** — no server. The publish service,
the lifecycle engine, the content list, deploy: all of it executes client-side against a `Map`.

This is only possible *because* of Ports & Adapters: the SPA depends on the ports, and the
in-memory adapters satisfy the same contracts a real server would. It makes the product instantly
demoable, and it proves the core is genuinely decoupled from its environment.

---

## Content safety: never lose content

The cardinal rule. A CMS that loses your writing is worthless, so several mechanisms defend it:

- **Round-trip fidelity** — content survives the Tiptap ↔ Markdoc conversion losslessly; a
  dedicated passthrough node carries anything the editor doesn't natively understand.
- **Base-SHA conflict guard** — Publish refuses to overwrite Git changes it didn't see, instead
  of silently clobbering.
- **Reversible unpublish** — taking a post down sets a flag; the content stays in Git.
- **Read-only derivation** — listing, forking, and deploy only *read* Git; they never write,
  so browsing your content can't corrupt it.

---

## Glossary

- **Port** — a small interface (contract) the engine depends on; e.g. `GitPort`, `DataPort`.
- **Adapter** — a concrete implementation of a port; e.g. `git-local`, `db-sqlite`.
- **Canonical** — the authoritative source of truth (Git, for published content).
- **Derived** — rebuildable from the canonical source (the database index).
- **Reindex** — rebuilding the derived database from canonical Git.
- **SSG / SSR** — Static Site Generation (build-time) / Server-Side Rendering (request-time).
- **Topology** — a specific wiring of adapters for an environment (local / self-hosted / edge).
- **Entry** — one piece of content, identified by `(collection, locale, slug)`.
- **Draft / Staged / Live / Unpublished** — the content lifecycle states (see above).

---

## Where to go next

- The full product spec: [../plan/prd.md](../plan/prd.md)
- Design decisions, one per increment: [superpowers/specs/](superpowers/specs/)
- The multi-topology / reindex deep-dive:
  [superpowers/specs/2026-06-14-saytu-topology-publishing-note.md](superpowers/specs/2026-06-14-saytu-topology-publishing-note.md)
