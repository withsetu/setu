# Multi-session collaboration workflow

How two or more Claude Code sessions work the same repo **concurrently** without
stepping on each other. Read this before starting work in a new session.

The hard rule that prevents 90% of the pain:

> **`origin/main` is the single source of truth. No session "owns" local `main`.
> You integrate by *pushing*, never by checking out `main` in a worktree.**

This repo uses **git worktrees** (`.claude/worktrees/feat+X`). All worktrees share
one local repo, so there is only one `main` ref — and git lets only **one** worktree
have `main` checked out at a time. If a session sits on local `main`, no other
worktree can `git checkout main` to merge into it ("main is already checked out at …").
That is exactly the lock we hit. The flow below routes around it.

---

## The golden rules

1. **One feature → one branch → one worktree → one session.** Never edit another
   session's branch or worktree.
2. **Branch off freshly-fetched `origin/main`**, not local `main` (decouples you from
   whatever another session has staged locally).
3. **Integrate by merging `origin/main` *into* your branch** (pull direction — always
   allowed) and **ship by *pushing* your branch** (push direction — always allowed).
   **Never `git checkout main` in a worktree to merge into it.**
4. **`pnpm install` after every merge/pull that changes the dependency graph or
   `pnpm-lock.yaml`.** (This bit us: a merge added a workspace devDep and tests failed
   with "Failed to load url @setu/…" until `pnpm install` relinked it.)
5. **Sync small and often.** Merge `origin/main` into your branch at least at the start
   of each feature and before you ship — not once at the end.
6. **Claim your turf** (see Ownership below) so two sessions don't edit the same files.

---

## The lifecycle (commands)

### 1. Start a feature (fresh, decoupled base)
```bash
git fetch origin
git worktree add .claude/worktrees/feat+<name> -b feat/<name> origin/main
cd .claude/worktrees/feat+<name>
pnpm install
```
(The superpowers `using-git-worktrees` skill creates the worktree; just make sure the
base is `origin/main` after a fetch.)

### 2. Work — commit normally on `feat/<name>`.

### 3. Sync before shipping (and periodically)
```bash
git fetch origin
git merge origin/main          # merge (not rebase) — safer for shared history
pnpm install                   # if pnpm-lock.yaml / deps changed
pnpm -r test && pnpm -r typecheck
```
Resolve any conflicts **here, in your own worktree** — this never blocks anyone else.

### 4. Ship — push, then integrate on the remote
Pick **one**:

**A) GitHub PR (recommended for parallel sessions):**
```bash
git push -u origin feat/<name>
gh pr create --fill
gh pr merge --merge        # (or --squash) — merges on GitHub, no local main needed
git fetch origin           # refresh local refs
```

**B) Hand off to the integrator session** (lightweight, what we did once):
```bash
git push -u origin feat/<name>
# then tell the session/human that owns the primary checkout:
#   "feat/<name> is pushed and green — please merge it into main"
```
The integrator (the one worktree on `main`) runs:
```bash
git fetch origin
git merge --no-ff origin/feat/<name>
pnpm install && pnpm -r test && pnpm -r typecheck
git push origin main
```

### 5. Clean up
Use the superpowers `finishing-a-development-branch` skill, **choosing "Push and create
a Pull Request" (option 2), NEVER "Merge locally" (option 1)** in multi-session mode.
After the branch is merged on origin, remove the worktree.

---

## Ownership — avoid editing the same files

Agree on **zones** up front so changes don't collide. Example split:

- **Session A:** `packages/core/src/image`, `apps/api`, `apps/site` (media pipeline)
- **Session B:** `apps/admin` (dashboard, content listing)

**Hot files both sessions tend to touch — coordinate or serialize edits to these:**
- `apps/admin/src/app.tsx` (route table)
- `packages/core/src/index.ts` (barrel exports)
- root `package.json` (dev script / scripts)
- `pnpm-lock.yaml` (any dependency change)

Tactics:
- **Prefer adding new files over editing shared ones.** The codebase already favors this
  (auto-discovered block folders, per-feature modules) — lean on it.
- Whoever must touch a hot file **pushes first**; the other session then
  `git merge origin/main` and resolves locally.
- Keep edits to shared files **small and atomic** (one concern, one commit).

---

## A lightweight "who's doing what" board

Before starting a feature, each session appends a line here (and removes it when merged),
so the other session can see the turf. Keep it short.

<!-- ACTIVE WORK (newest first) -->
- _(none currently — add `Session <id>: feat/<name> — touching <paths> — started <date>`)_

---

## Gotchas checklist (the things that actually broke)

- [ ] Branched off **`origin/main`** (fetched), not stale local `main`.
- [ ] Ran **`pnpm install`** after any merge/pull that changed deps or the lockfile.
- [ ] Never ran `git checkout main` inside a worktree to merge into it.
- [ ] Ran **`pnpm -r test && pnpm -r typecheck`** on the *merged* result before pushing.
- [ ] Pushed the branch to `origin`; integrated via PR (or via the integrator session).
- [ ] Synced `origin/main` into the branch **before** shipping, not after a long divergence.
