# Dev content sandbox — design

**Date:** 2026-06-18
**Status:** approved (owner)
**Prerequisite for:** the "View Site / View Page" admin links (and all future UAT).

## Problem

The Local Bridge made the admin's **Publish** write a real `.mdoc` git commit into the repo
(`git-local` runs with `SETU_REPO_DIR=$PWD`). So UAT — clicking around, publishing test posts —
now creates real commits and tracked-file changes on whatever branch is checked out. Throwaway
test content can leak into `main` and the history is hard to keep clean.

We want UAT to be able to create/edit/delete content **freely**, while the repo's tracked
`content/` fixtures and its git history stay pristine and merges stay code-only.

## Audience note (why this is small, not an "environments" system)

There are two audiences, and only one needs this:

- **People building Setu** (this repo): `content/` is **test fixtures**. They need a throwaway
  sandbox so manual UAT can't pollute the fixtures or history. ← this design.
- **People running a site built with Setu** (customers): `content/` is their real, canonical
  content. Their *code* changes (theme/plugin/`pnpm add`) are tested with **plain Git branches +
  PR + preview deploys** — they get that **free** from being Git-backed; we build nothing for it.
  Their only Setu-specific need is "realistic throwaway content to test against," which is the
  **same sandbox** — so we ship the sandbox tooling into every scaffolded site (`create-setu`)
  later. We do **not** build a bespoke dev/test/prod content-server system; Git + preview-deploys
  already do that better.

So: one switch, one gitignored sandbox root, two commands. Not a folder zoo.

## Design

### Canonical vs sandbox

- **Canonical** = tracked `content/` at the repo root. Used by `astro build`, the render tests,
  and any process where the content-dir env var is **unset**. Untouchable by dev workflows.
- **Sandbox** = `.content-sandbox/<name>/` — **gitignored**, each its own self-contained git repo
  (the bridge's `git-local` needs a `.git` to commit into). Seeded from canonical `content/`.
  Default name `dev`. Disposable.

The "three environments" collapse onto one switch:
- prod  → env unset → canonical `content/`
- test  → env unset → canonical `content/` (tests *read* fixtures; nothing writes during tests)
- dev/UAT → env set → a sandbox

### The single switch

- **`SETU_CONTENT_DIR`** (new) — absolute path to the content root the **site** reads.
  - `apps/site/src/content.config.ts`: `base: process.env.SETU_CONTENT_DIR ?? '../../content'`.
  - Unset → the tracked fixtures (build + tests unchanged).
- **`SETU_REPO_DIR`** (existing) — the git repo the **bridge api** commits into. Already env-driven
  in `apps/api/src/server.ts`.

A sandbox `<name>` lives at `.content-sandbox/<name>/`; the bridge commits content at
`<repoDir>/content/<collection>/<locale>/<slug>.mdoc`, so:
- api: `SETU_REPO_DIR = $PWD/.content-sandbox/<name>`
- site: `SETU_CONTENT_DIR = $PWD/.content-sandbox/<name>/content`

### `pnpm dev` wiring

Root `dev` script:
1. **Ensure the `dev` sandbox exists** (auto-seed if missing) — zero-friction start.
2. Run api with `SETU_REPO_DIR=$PWD/.content-sandbox/dev`.
3. Run admin with `VITE_SETU_API=http://localhost:4444` (unchanged).
4. Run site with `SETU_CONTENT_DIR=$PWD/.content-sandbox/dev/content`.

### Commands (portable — no monorepo-specific paths, so they template into `create-setu`)

Plain Node scripts under `scripts/`, exposed as package scripts:

- **`pnpm content:seed [name=dev]`** — if `.content-sandbox/<name>` is missing: create it, copy the
  canonical `content/` tree into `.content-sandbox/<name>/content/`, `git init`, and make an
  initial commit. If it already exists: no-op (don't clobber a sandbox the user is using).
- **`pnpm content:reset [name=dev]`** — `rm -rf .content-sandbox/<name>` then re-seed. One command
  for "fresh, populated sandbox."

The scripts resolve `content/` relative to the repo root they run in (not a hardcoded absolute
path), so the same scripts work verbatim when copied into a scaffolded user site.

### Gitignore

Add `.content-sandbox/` to root `.gitignore`. Covers all sandboxes (files + their nested `.git`),
so nothing test-generated can ever be committed to the main repo.

## What does NOT change

- `@setu/core`, the converters, the publish/read/authoring services, the adapters — **untouched**.
  This is pure dev plumbing (env wiring + scripts + gitignore + one config default).
- `astro build` and the render tests — **unchanged behavior**: env unset → tracked `content/`.
  This is the regression gate (site render tests must stay green, byte-identical).
- The admin app — unchanged (it talks to the api via `VITE_SETU_API` as today; it neither knows
  nor cares which content dir the api/site use).

## Testing

- **Seed/reset script smoke test:** run `content:seed` into a temp name → assert
  `.content-sandbox/<tmp>/content/**/*.mdoc` exists, mirrors `content/`, and `.content-sandbox/<tmp>/.git`
  is a repo; `content:reset` wipes + re-seeds; `seed` on an existing sandbox is a no-op. Clean up the temp.
- **Default-unchanged gate:** the existing `apps/site` render tests run `astro build` with the env
  unset and must stay green (they already assert against the tracked fixtures) → proves canonical is
  the default and the build never depends on a sandbox.
- Manual: `pnpm dev` → publish a test post in the admin → it appears on the site (read from the
  sandbox) and `git status` in the repo root shows **nothing** (sandbox is gitignored).

## Out of scope (deliberate)

- The `create-setu` CLI itself (V1-scope, separate increment) — we only keep the scripts portable.
- Any customer-facing dev/test/prod "environment" system — Git branches + preview deploys cover code;
  this sandbox covers test content. Nothing more.
- A "promote sandbox → canonical" command — dangerous; content reaches canonical only through the
  normal reviewed publish/commit flow.
