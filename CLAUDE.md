# Setu — working agreement for AI sessions

Setu is an OSS, Git-backed, multi-topology CMS. Its competitive wedge is **editor quality and
polish** — not feature count. Build accordingly. The detailed standard, with a worked
"good vs. skeleton" case study, lives in [docs/quality-bar.md](docs/quality-bar.md). Read it once.

## Definition of Done — check this before you say "done" or open a PR

A feature is DONE only when EVERY item is true. Green tests are necessary, **never sufficient**.

1. **You drove it in the running app.** You launched it and clicked through the real user flow. If
   you have not *used* the feature, it is not done — it's a draft. (Invoke the `verify` or `run` skill.)
2. **It matches the agreed design.** For any UI, agree the UX first (a mockup, or a named reference
   like "WordPress Query Loop"), then build to it. Shipping a stripped-down version of an approved
   design is a **defect**, not an "increment."
3. **It reuses what exists.** Survey the codebase first. Never reinvent a worse version of a component
   that already exists (taxonomy pickers, the block inspector, fields, layouts, the media picker).
4. **Table-stakes UX, no excuses.** Dropdowns for known options (never make the user type a known
   value); searchable pickers (never raw slugs); a live preview where the user expects to see the
   result; sensible grouping. Match Notion/WordPress-grade conventions.
5. **No skeletons.** Do not defer the parts that make a feature good (a control, a preview, the
   polish) and call the remaining bones an "increment." Ship the whole agreed thing, or don't claim
   it's done.
6. **Self-critique before declaring done.** Would the owner call this polished? If not, keep going.

## How we work

- **Design-first for UI.** Agree the UX before writing code; use the visual-mockup tooling for any
  non-trivial UI. Don't build a UI nobody has seen a picture of.
- **UAT is a gate.** Drive the running app before "done." The owner does the final UAT before merge —
  do not pre-empt it by merging on green tests.
- **Reviews block on polish, not only correctness.** Every whole-branch review MUST return a
  **polish + UAT verdict** — "Was it driven in the app? Does it match the agreed design? Does it
  reuse existing components? Is it complete, not a skeleton?" — and must **block** anything that fails
  the Definition of Done. A correct-but-skeleton feature does NOT pass review. (See the rubric in
  docs/quality-bar.md and include it in every review dispatch.)
- **Security standards gate every pick (decided 2026-07-02).** When picking ANY issue, run the
  pick-time checklist in [docs/security-standards.md](docs/security-standards.md) (mapped to OWASP
  Top 10:2025) — new route → authz + fail-closed errors; new input → Zod; server-side fetch → the
  shared safe-fetch helper; new dep → supply-chain check; user content rendered → XSS review.
  Security-relevant issues carry the **`security` label** and a "Security considerations" section.
  Reviews **block** on this checklist the same way they block on polish.
- **Gate-parity + flow-proof (decided 2026-07-06).** When a change adds or alters an auth or authz
  gate, you MUST (a) update the e2e harness to authenticate and (b) add an e2e proving the **right
  actor is admitted and the wrong actor is blocked**. A new top-level user flow (login / publish /
  upload) needs one browser e2e. For auth specifically, *"drove it in the running app"* means a real
  cross-origin browser login — **not** the local auto-owner shortcut. Green unit tests are necessary,
  never sufficient: every UAT bug on #371 (settings writable by maintainer, maintainer users-list,
  logout→setup, author can't save) lived in a seam no unit test crossed. Reviews **block** a
  security/authz PR that cannot point at the e2e which blocks the wrong actor — no such e2e → BLOCK.
  (Harness + pattern: `e2e/specs/auth-*.spec.ts`, `e2e/auth.setup.ts`; gap history in #391.)
- **Git:** `origin/main` is the hub. Work on a branch in a worktree; PR to `main`; never commit to
  `main` directly. Run `pnpm install` after dep-changing merges.

## Issue tracking — every piece of work has an issue

All work is tracked as **GitHub issues on `withsetu/setu`** (not markdown roadmaps). This is the
single source of truth for **status and design**. No exceptions for "small" changes.

- **Start from an issue.** Before any dev work, there must be an issue for it. If one doesn't exist,
  create it first (`gh issue create`) with the right `area:*` label, then work against it.
- **Reference it everywhere.** Branch name, commits, and the PR body cite the issue; the PR closes it
  (`Closes #N`). A merged PR with no issue is a process miss.
- **Keep status honest.** Label the active issue `next`/in-progress while working; close it (or let
  the PR close it) when the Definition of Done is met — not on green tests alone.
- **Spin off, don't bury.** Deferred scope, follow-ups, and tech-debt you notice become their own
  issues (labeled `area:*` / `tech-debt`, linked to the parent epic) — never a silent TODO or a note
  that only lives in a memory file.
- **Epics** = a tracking issue labeled `epic` with a `- [ ] #child` task-list (e.g. the SEO module
  #75). Multi-increment features get one, with each increment its own child issue + PR.
- **Design lives in the issue, not the repo (decided 2026-07-01).** Do NOT commit design specs/plans
  to `docs/superpowers/{specs,plans}/`. When a skill (brainstorming / writing-plans) would produce a
  spec or plan, put that content in the **tracking issue**: the epic body holds the design narrative,
  child issues hold the increments, comments hold the discussion. Create the epic/issue first if
  needed. A scratch draft is fine; a committed design doc is not. This deliberately overrides the
  superpowers default of writing spec/plan files. The only design-adjacent files that stay in-repo are
  standing **reference** — things the code must uphold, read repeatedly, not a unit of work:
  `CLAUDE.md`, `plan/prd.md`, `docs/quality-bar.md`, `docs/security-standards.md`,
  `docs/architecture.md`/ADRs. (Legacy specs under `docs/superpowers/` migrate to issues over time.)
- **Labels are the taxonomy:** `area:seo|feed|site-health|identity|editor|admin|media|taxonomy|`
  `content-index|blocks|forms|settings|theme|infra|deploy|docs`, plus `tech-debt`, `epic`, and
  `security` (apply the pick-time checklist in docs/security-standards.md).
- The `gh` token has `repo` but **not** `project` scope — manage issues/labels via CLI; the Project
  board (if used) is a view the owner configures.
- **Topology-impact check — ALWAYS.** Setu is **multi-topology**: the same engine runs as a local
  app, a self-hosted Node server, or on the edge (Cloudflare Workers/Pages — no filesystem, no native
  binaries, short request budgets). Before adding ANY function, evaluate how it behaves across those
  topologies: does it need a native dep (e.g. `sharp`), a filesystem, long-running compute, or
  persistent local state the edge doesn't have? If so it is a **Node-topology capability** — detect
  the capability at runtime and **degrade or disable gracefully with a clear, mode-aware message**.
  Never offer an action a deployment physically cannot perform, never silently break, and never assume
  "it works locally" means it ships. (See `docs/architecture.md` — Ports & Adapters.)
- **Saved ≠ live — be honest about the deploy gap.** On a statically-built site (SSG, our default
  output), committing to Git does **not** update the deployed site — published output only changes on
  a rebuild/redeploy. So any admin action that mutates published output (settings, publish, taxonomy)
  must **surface the saved-but-not-yet-live state honestly** — never imply a change is live when it
  needs a build — and offer **only the deploy mechanism the current topology can actually perform**
  (local/VPS → in-process `astro build`; edge → git-push to CI or a deploy-hook; an SSR/hybrid
  topology reads live and needs none). `astro dev` re-reads on demand, so this gap is invisible in
  dev and bites only in production-static — don't let dev UAT mislead. (Deploy epic #207.)

## Building UI — check shadcn first (admin side)

The admin (`apps/admin`) is built on **shadcn/ui** (React 19). Before hand-rolling ANY admin
component or control, **query the shadcn MCP server** (`mcp__shadcn__*` — `search_items_in_registries`
/ `list_items_in_registries` / `view_items_in_registries` to find a component across the registries,
then `get_add_command_for_items` to install it). Add the official component
(`npx shadcn add <item>`) and compose from it — do **not** write a custom-CSS lookalike of a control
that shadcn already provides. This is Definition-of-Done rule 3 (reuse) applied to UI: a known
control comes from shadcn, not bespoke markup. If the component isn't already in
`apps/admin/src/components/ui/`, that's a signal to add it via the MCP, not to invent one.

**Admin vs. front-end themes.** This shadcn-first rule governs the **admin** only. Front-end
**themes** (`apps/site` and user-authored themes) are NOT bound to shadcn — a theme may use its own
component library, plain semantic HTML + CSS, or shadcn by choice. Don't import admin shadcn
components into a theme, and don't assume a theme is shadcn; read that theme's own conventions first
and match them.

## Where things are

- Design & plans: in the **GitHub issue/epic** (not repo docs — see Issue tracking). Standing
  reference only, in-repo: `plan/prd.md`, `docs/quality-bar.md`, `docs/security-standards.md`,
  `docs/architecture.md`. (Legacy
  specs still under `docs/superpowers/{specs,plans}/` until migrated.)
- Content blocks: repo-root `blocks/<tag>/` (auto-discovered) + `@setu/core` standard blocks
- Admin editor: `apps/admin/src/editor/` · Site render: `apps/site/` · Core: `packages/core/`
- Dev stack: `pnpm dev` (api + admin + site against a gitignored `.content-sandbox/`)
