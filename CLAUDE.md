# Setu — operating manual for AI sessions

Setu is an OSS, Git-backed, **multi-topology** CMS (local app / self-hosted Node / Cloudflare
edge). The competitive wedge is **editor quality and polish** — not feature count. You are the
engineer; the owner is the product person. This file is the contract for how you work here.

**How to use this file:** read the card below before any task. Consult §5 (failure modes) when
starting, §6 (quality bars) before claiming done, §7 (escalation) when unsure. Rules marked **⊕**
are additions codified in this rewrite (they were owner decisions living only in session memory);
everything else restates standing practice.

## The card — non-negotiables

1. **Issue first.** No dev work without a GitHub issue on `withsetu/setu`. Branch, commits, PR all
   cite it. (§3.1)
2. **Green tests are never "done".** Done = driven in the running app + matches the agreed design
   + reuses what exists + no skeletons. (Definition of Done, below)
3. **Design before UI code.** Non-trivial UI gets a mockup or named reference the owner nodded at,
   then you build **all** of it. (§3.1)
4. **Security checklist at pick time and review time** — docs/security-standards.md. New route →
   server-side authz + fail-closed. New input → Zod. Fetch → safe helper. New dep → supply-chain
   check. (§3.1)
5. **Auth/authz changes need the wrong-actor e2e.** No e2e that blocks the wrong actor → the PR is
   blocked. (§3.3)
6. **Topology check on every function.** If it needs fs / native deps / long compute, it is a
   Node-topology capability: detect and degrade honestly, never silently. (§1)
7. **Saved ≠ live.** Committing to Git does not update a static site. Never imply it did. (§1)
8. **Never commit to `main`.** Worktree per feature off fresh `origin/main`; ship by push + PR;
   owner does final UAT before merge — never merge on green tests yourself. (§3.3, §8)
9. **⊕ Verify dependency facts on the web, never from memory** — license, version, paid-vs-free,
   API shape: npm registry / context7 / official docs, cited in the issue/PR. (§6)
10. **⊕ Public repo discipline:** engineering only in issues/PRs. No competitive strategy, moat,
    monetization, or licensing rationale in public text. No "Generated with Claude Code" links in
    PR/issue bodies; DO keep the `Co-Authored-By: Claude <noreply@anthropic.com>` commit trailer.

## Definition of Done — check before you say "done" or open a PR

A feature is DONE only when EVERY item is true. Green tests are necessary, **never sufficient**.

1. **You drove it in the running app.** Launched it, clicked through the real user flow. Not
   driven = not done — call it a draft. (Invoke the `verify`/`run` skill, or `/uat` here.)
2. **It matches the agreed design.** Shipping a stripped-down version of an approved design is a
   **defect**, not an "increment."
3. **It reuses what exists.** Survey first (§5 has the inventory). Never reinvent a worse version
   of an existing component.
4. **Table-stakes UX.** Dropdowns for known options; searchable pickers, never raw slugs; live
   preview where the user expects one; Enter submits; keyboard operable; visible success/error
   feedback. Notion/WordPress-grade.
5. **No skeletons.** Don't defer the parts that make it good and call the bones an increment.
6. **Self-critique.** Would the owner call it polished? If not, keep going.

**⊕ Proportional effort (owner, 2026-07-05):** the *safety* gates — typecheck, unit tests (TDD),
lint/format, security checklist, green CI — run on EVERY change, no exceptions; they're cheap and
CI enforces them anyway. The *polish* gates — live-app UAT, mockup-first, no-skeletons — are
mandatory for anything user-visible, rendering, interactive, or topology-sensitive; for pure
internal logic already proven by unit tests plus a targeted output check, a full live drive is
optional — **say explicitly** that you skipped it and why, instead of performing it. Scope local
test runs to changed packages (CI runs the full net); batch small related features into one
worktree. Cut waste, never safety.

The full standard with the worked "good vs. skeleton" case study: [docs/quality-bar.md](docs/quality-bar.md).

## 1 · Mental model

- **Git is canonical; the DB is derived.** Published content lives in Git (`GitPort`); drafts and
  locks live in the DB (`DataPort`) and are rebuildable. If code trusts a stored copy over Git,
  it's wrong. Full tour: [docs/architecture.md](docs/architecture.md).
- **Ports & Adapters everywhere.** Core (`packages/core`) is pure logic on port interfaces;
  adapters (`git-local`/`git-http`/`db-sqlite`/`db-idb`/`image-sharp`/…) are swapped per topology.
  Every port has a contract test suite every adapter must pass. New capability = extend a port or
  add an adapter — never reach around the seam.
- **Edge-safety is enforced**: `packages/core/tsconfig.edge.json` typechecks the edge-reachable
  graph with no Node/DOM types. If your core change breaks it, your design is topology-bound —
  rethink, don't exclude the file.
- **Topologies:** local app, self-hosted Node, Cloudflare Workers/Pages (no fs, no native bins,
  short request budgets, 20k-files-free/100k-paid deploy cap, 25 MiB/file). Everything must also
  be **cost-safe**: published site stays static; any SSR/on-demand path is admin-volume only,
  bounded, debounced, no per-visitor fan-out.
- **Saved ≠ live.** SSG output changes only on rebuild/redeploy. Admin actions that mutate
  published output must surface the pending state honestly and offer only the deploy mechanism the
  topology can perform. `astro dev` re-reads live, so dev UAT hides this gap. (Epic #207.)
- **Content model:** entry identity = `(collection, locale, slug)`; files are
  `content/<collection>/<locale>/<slug>.mdoc` (YAML frontmatter + Markdoc body).
  **"Published" means committed + `published !== false`. There is NO `status: draft` frontmatter
  concept** — a `status` field in a `.mdoc` is a fixture vestige; filtering on it once shipped an
  RSS bug. Unparseable frontmatter fails closed (treated as live → needs `content.publish`).
- **Roles ladder (4):** admin > maintainer > editor > author. Permission vocabulary = the `Action`
  union in `packages/core/src/authz/` with the compile-time `DEFAULT_ROLES` matrix. Enforcement is
  **server-side** (`requireCan`, `writeActionForChanges` in `apps/api/src/app.ts`); UI `useCan()`
  is UX, not security. Unknown role → null actor → 401 (fail closed).
- **Blocks:** contract in core (`defineBlock`: zod props + editor meta), renderer in theme/
  `@setu/blocks`. Repo-root `blocks/<tag>/` folders are auto-discovered (site-local wins on tag
  collision). Styling obeys the **19-token contract** — read
  [docs/block-styling-contract.md](docs/block-styling-contract.md) before ANY block work; a vitest
  guard (`packages/blocks/test/token-contract.test.ts`) fails the build on violations. Block work
  follows the `/new-block` skill.

## 2 · Where things are

| Thing | Where |
|---|---|
| Design & plans | The **GitHub issue/epic** — never committed spec files (§3.1) |
| Standing reference (in-repo) | `CLAUDE.md`, `docs/quality-bar.md`, `docs/security-standards.md`, `docs/architecture.md`, `docs/block-styling-contract.md`, `docs/collaboration.md` |
| Engine | `packages/core` (markdoc round-trip, config, authoring/publish/read, authz, lifecycle, content-index, settings, permalinks) |
| Adapters | `packages/{git,db,image,email,captcha,storage}-*` + `@setu/auth` |
| Admin SPA | `apps/admin` (React 19 + shadcn/ui + Tiptap 3) — editor in `src/editor/` |
| API | `apps/api` (Hono; control plane under `/api/*`, media assets at `/media/*`) |
| Site | `apps/site` (Astro + Markdoc; themes NOT bound to shadcn) |
| Content blocks | repo-root `blocks/<tag>/` + `@setu/core` `STANDARD_BLOCKS` + `@setu/blocks` renderers |
| E2E | repo-root `e2e/` (Playwright; NOT a workspace package — `pnpm -r test` never runs it) |
| Dev content | gitignored `.content-sandbox/<name>/` seeded from tracked `content/` |

## 3 · Task lifecycle

### 3.1 Start

1. **Find or create the issue** (`gh issue create`, right `area:*` label; `security` label + a
   "Security considerations" section when the checklist bites). Labels:
   `area:seo|feed|site-health|identity|editor|admin|media|taxonomy|content-index|blocks|forms|settings|theme|infra|deploy|docs`
   plus `tech-debt`, `epic`, `security`. Epics = issue labeled `epic` with a `- [ ] #child` list.
   The `gh` token has `repo` scope but NOT `project` scope.
2. **Design lives in the issue** (owner decision 2026-07-01): epic body = design narrative, child
   issues = increments, comments = discussion. Do NOT commit specs/plans to
   the repo (design lives in the issue). Test: *standard the code upholds → repo doc; unit of work →
   issue.*
3. **Run the pick-time gates** — one line each, "N/A" is a fine answer, the point is the question
   was asked: (a) the [security checklist](docs/security-standards.md); (b) the topology check
   (card #6); (c) the cost check (§1); (d) for UI, the design gate — mockup or named reference
   ("WordPress Query Loop") agreed **before** code.
4. **Worktree off fresh origin/main** (see [docs/collaboration.md](docs/collaboration.md)):
   ```bash
   git fetch origin
   git worktree add .claude/worktrees/<name> -b <issue-slug>-<N> origin/main
   cd .claude/worktrees/<name> && pnpm install
   ```
   In a worktree, `better-sqlite3` may need `pnpm rebuild better-sqlite3` (Node ABI mismatch).
5. **⊕ Settled defaults — do NOT re-ask these** (the owner has answered them repeatedly and is
   annoyed by re-asking): execution is **subagent-driven** once a plan exists; one feature = one
   branch = one worktree; ship via push + PR; "your rec" means recommend and proceed; a clean
   review on routine work means proceed to PR. Surface a settled choice only when something
   concrete makes the usual answer wrong this time.

### 3.2 Build

- **TDD.** Write the failing test first. The test pyramid and where a new test belongs:

  | Layer | Lives | Catches | Command |
  |---|---|---|---|
  | Unit/logic (vitest, jsdom for admin) | `packages/*/test`, `apps/*/test` | pure logic, component logic | `pnpm --filter <pkg> test` |
  | Real-browser component (vitest browser mode) | `apps/admin/test-browser/` | Radix portals, ProseMirror↔React loops, focus/paint — the jsdom-blind class | `pnpm --filter @setu/admin test` (runs both) |
  | Render-smoke | `apps/site/test/` (runs a real `astro build`) | blocks through the real markdoc+theme pipeline | `pnpm --filter @setu/site test` |
  | E2E journeys (Playwright) | `e2e/specs/` | cross-system seams, auth gates, publish flow | `pnpm e2e` (+ `pnpm exec tsc -p e2e --noEmit`) |

  Growth policy: one happy-path e2e per new load-bearing journey (~15/year cap); edge cases live at
  lower layers. Interaction-heavy editor work adds **browser-mode** tests, not new e2e.
- **Reuse before building.** Grep for the existing component/pattern first; §5 lists the
  inventory. Extending a shared port/interface breaks all stub implementors — run the
  **whole-repo** typecheck, not just your package.
- **Admin UI = shadcn first.** Before hand-rolling ANY admin control, query the shadcn MCP
  (`mcp__shadcn__search_items_in_registries` → `get_add_command_for_items`, install via
  `npx shadcn add <item>`) and compose. A control missing from `apps/admin/src/components/ui/` is
  a signal to add it via the MCP, not to invent one. **Themes are exempt**: `apps/site` and
  user themes are NOT shadcn — read the theme's own conventions and match them; never import
  admin components into a theme.
- **Admin code idioms:** routes in `src/app.tsx` wrapped in `<RequireCan action=…>`; nav in
  `shell/AppSidebar.tsx`; commands registered via `useRegisterCommands` in
  `command/GlobalCommands.tsx`; API calls through `apiFetch` (`src/lib/api-fetch.ts` — bare
  `fetch` drops the cross-origin session cookie); user feedback via `useNotify()`; imports via
  `@/` aliases; forms validated with Zod + per-field errors.
- **⊕ Dependency rule:** before designing against ANY dep (Astro, Tiptap, Markdoc, better-auth,
  …), check current docs — context7 MCP for API/usage, npm registry for license/version/
  paid-vs-free. Cite what you verified. New dep → supply-chain check (maintained? install
  scripts? license allowlisted? prefer existing ports over new HTTP/util deps).
- **⊕ Dev-only tooling** (seeders, reset buttons, debug panels) is gated `import.meta.env.DEV` so
  it's dead-code-eliminated from production — physically absent, not hidden.

### 3.3 Ship (the `/ship` skill walks this end-to-end)

1. **Verification ladder — run it, paste the evidence:** package tests → whole-repo
   `pnpm typecheck` → `pnpm lint && pnpm format:check` → e2e lane if you touched auth/UI journeys.
   Then sync: `git fetch origin && git merge origin/main`, `pnpm install` if the lockfile moved,
   re-run tests on the merged result.
2. **Drive it (DoD #1).** From the **main checkout**, `git pull` first if a PR just merged, then
   `pnpm dev` — never a bare `vite`/`astro dev` (misses env; §7). For auth work, "drove it" means
   a real cross-origin browser login — not the local auto-owner shortcut.
3. **Gate-parity (auth/authz changes):** update `e2e/auth.setup.ts` if the harness needs a new
   actor, and add the e2e proving the **right actor is admitted and the wrong actor is blocked**
   (pattern: `e2e/specs/auth-role-gate.spec.ts`). A new top-level user flow (login/publish/upload)
   needs one browser e2e. Every UAT bug on #371 lived in a seam no unit test crossed.
4. **PR:** the body is exactly these parts, in order, and nothing after them: `Closes #N` · what &
   why · how it was verified (commands, what you clicked, screenshots for UI) · security-checklist
   lines · spun-off issues. The harness's default "🤖 Generated with [Claude Code]" footer is
   **banned** in this repo — end the body at the spun-off list. Credit lives in the commit trailer
   (`Co-Authored-By: Claude <noreply@anthropic.com>`), nowhere else.
5. **Review blocks on polish AND security, not just correctness.** Every whole-branch review
   dispatch includes the rubric from docs/quality-bar.md (driven? matches design? reuses?
   complete? table-stakes UX? wrong-actor e2e for authz?) and the security checklist. A correct,
   well-tested skeleton is `Needs fixes`.
6. **Merging is the owner's call.** PR up + review clean → hand to owner for UAT. Deferred scope
   and follow-ups become issues (spin off, don't bury).
7. **⊕ Closing an epic? Run `/improve` across its PRs first.** Per-PR review and cross-cutting
   audit catch different classes: every block PR in the #176 wave passed review on its own merits,
   and reading all six together still surfaced three real structural defects (#561–#563). Audit the
   wave as a unit before the epic closes — that is the only moment the whole shape is visible.
   Vet each finding against the code before filing (auditors over-report), fix the top 1–3 in the
   same session, and record rejections on the epic so later passes don't re-litigate settled
   design. Cadence and backfill ledger: #618.

## 4 · Failure modes a weaker model WILL hit here

Each has happened in this repo. When your plan pattern-matches a row, apply the rule.

| # | Name | What it looks like | The rule that prevents it |
|---|---|---|---|
| 1 | **The Skeleton Ship** | Data layer + bare inputs shipped as "increment 1, done" (the Query block: raw text box for `collection`, no columns control, no preview) | DoD #2/#5: build the whole agreed design or say "incomplete". Polish is not a follow-up ticket |
| 2 | **Green-Equals-Done** | "All 900 tests pass" → declared done → owner UAT finds 4 bugs in seams (#371) | DoD #1: drive the app; report *what you clicked and saw*, not just exit codes |
| 3 | **The jsdom Mirage** | Radix/ProseMirror feature passes jsdom, white-screens live (`useSelectedBlock` infinite loop — shipped twice) | Editor-canvas React → browser-mode test in `apps/admin/test-browser/` + live smoke. Never setState a fresh object per editor transaction without an equality guard |
| 4 | **The Hand-Rolled Lookalike** | Rebuilding a picker that exists (BulkBar got a bare input while `TagField` sat polished next door) | Reuse inventory (§5) + shadcn MCP first. If close-but-not-reusable: extend the existing one, never fork a degraded copy |
| 5 | **Topology Blindness** | `fs`/`sharp`/long compute in a path that must run on Workers; "works locally" | Card #6: capability-detect, degrade with a mode-aware message; keep edge guard green |
| 6 | **Saved-Equals-Live** | Toast says "published!" on an SSG deployment where nothing went live | Card #7: show staged-not-live state; offer only the topology's real deploy action |
| 7 | **The Confident Stale Dep "Fact"** | "That's a paid Tiptap Pro extension" (it was MIT on public npm); "cid shipped" (PR still open) | Card #9: verify on npm/context7/web before asserting; verify repo claims against code |
| 8 | **The Wrong-Worktree Commit** | Subagent commits onto `main` or another session's branch (happened twice; one needed a guarded reset) | Every subagent dispatch: first step = `cd <worktree>` + verify `git rev-parse --show-toplevel` and `git branch --show-current`; forbid `checkout/switch/reset/merge`. Controller verifies HEAD advanced on the expected branch after every task |
| 9 | **The Silent TODO** | Deferred scope noted in a comment or memory file and lost | Spin off a labeled issue linked to the parent, in the same session |
| 10 | **The Committed Design Doc** | Committing a design spec/plan to the repo for new work | Design lives in the issue (§3.1). Standing reference only in-repo |
| 11 | **The Re-Asked Settled Question** | "Subagent-driven or inline?" / "Shall I merge?" for the Nth time | §3.1 settled defaults: proceed and report |
| 12 | **The Public Strategy Leak** | Competitor/moat/licensing reasoning pasted into a public issue (issue #299 had to be deleted) | Card #10: engineering-only in public; neutral decision language; strategy stays in private notes |
| 13 | **The UI-Only Gate** | Hiding the button but leaving the API open (#362: Forms PII + Git-write had NO server gate; settings writable via the shared commit route) | Server-side `requireCan` + path/frontmatter-aware `writeActionForChanges`; then the wrong-actor e2e (card #5) |
| 14 | **The Unregistered Preview Block** | New block renders on site but the editor preview crashes with a cryptic `@astrojs/react` toString error | Register the renderer everywhere the block set is enumerated (preview `tagComponentMap` + gen-blocks); the real stack is in the **preview iframe's browser console**, not the daemon log |
| 15 | **The Raw Text Box** | Making the user type a collection/category/locale the system already knows | DoD #4: dropdown/searchable picker fed by the index (`distinctTags` etc.) |
| 16 | **The False "0 Affected"** | pnpm/turbo git change-detection silently returns zero packages inside a linked worktree → "filter is broken" or false-skip | Verify affected-filtering from a **real clone** (`git clone file://…`), which is what CI sees |
| 17 | **The Bare Vite Launch** | Starting admin without `pnpm dev`'s env → `VITE_SETU_API` undefined → preview/media/auth silently missing → "the feature is broken" | Always launch via root `pnpm dev` (or `.claude/launch.json` for worktrees); if a feature "isn't showing", first check it isn't API-gated and the env is set |
| 18 | **The `-r test` Blind Spot** | Believing `pnpm -r test` / `pnpm typecheck` covered e2e (it never does — e2e is outside the workspace on purpose) | UI/auth journeys changed → run `pnpm e2e` and `pnpm exec tsc -p e2e --noEmit` explicitly |
| 19 | **Status-Draft Hallucination** | Filtering on `status: draft` frontmatter (shipped an RSS bug that dropped a live post) | `published !== false` is the ONLY published-ness signal (§1) |
| 20 | **The Yanked-Checkout Phantom** | Mid-UAT the shared main checkout gets switched by another session → HMR serves half-main → phantom bugs | Bizarre UAT failure → check `git branch --show-current` + `git reflog` FIRST, before chasing code |

## 5 · Quality bar per deliverable — checkable criteria

**Baseline for every change (the safety gates — always):**
- [ ] Issue exists and is cited by branch/commits/PR
- [ ] Failing test written first; new behavior has a test at the right pyramid layer (§3.2)
- [ ] `pnpm typecheck` clean repo-wide (core changes: edge guard included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Security checklist answered (one line per item or N/A)
- [ ] Dep facts verified on the web if any dep was touched (cite where)

**Admin UI feature (screen/control/flow):**
- [ ] Mockup or named reference agreed before code; every element of it present (list anything
      dropped — that's a defect, not a note)
- [ ] Composed from shadcn/existing components — name what you reused; no bespoke lookalikes
- [ ] Known-option inputs are dropdowns/pickers; reference inputs are searchable with type-ahead;
      chips/previews where the user expects to see the result
- [ ] Enter submits; fully keyboard-operable (tab order, focus visible, no traps); labels/aria on
      every control
- [ ] Success/error feedback via `useNotify` is visible and legible; loading and empty states exist
- [ ] Spacious, typographically rich (owner's bar: loose > dense; don't shrink type to 11px;
      tables fill the width); dark mode verified (`[data-theme="dark"]`)
- [ ] Gated: route in `RequireCan`, nav filtered by `useCan`, and the server enforces the same
      action (§4 #13)
- [ ] Driven in the running app; evidence in the PR (what you clicked, screenshot)
- [ ] Editor-canvas React → browser-mode test; new top-level journey → one e2e

**Block (new or changed):**
- [ ] Read [docs/block-styling-contract.md](docs/block-styling-contract.md) first
- [ ] Contract via `defineBlock` (zod props + editor meta: label, icon, category, `group`,
      `keywords`, control hints/groups)
- [ ] CSS reads only the 19 contract tokens or `--blk-<block>-*` locals; token guard test green
- [ ] Inserted via slash menu; inspector controls render grouped and typed (no raw text for enums)
- [ ] Renders in the editor canvas AND the preview iframe AND the built site (register everywhere;
      §4 #14); round-trips insert → publish → reopen byte-stable
- [ ] Width/breakout uses the theme's `align-wide/full` pattern (in theme CSS, not block CSS)
- [ ] Sensible with default/empty props (no `undefined` text on screen)

**API route / server change:**
- [ ] Control plane lives under `/api/<name>` (`/media/*` is the content-asset namespace)
- [ ] `authMiddleware` + `requireCan(<action>)` with the correct granular action; mixed-path
      writes derive the strongest needed permission (`writeActionForChanges` pattern)
- [ ] Fails closed: unauth → 401, unauthorized → 403, unknown role → null actor; no stack traces
      or paths in prod responses
- [ ] Zod at the boundary, size-capped; uploads type-constrained
- [ ] Server-side URL fetches go through the shared safe-fetch seam; parsers hardened (no
      XXE/expansion)
- [ ] Topology-bound work capability-gated (`/api/capabilities` reports it; route 409s or degrades
      with a clear message on edge)
- [ ] Security-relevant events emitted via the audit seam (`onAuthEvent`)
- [ ] Tests: unauth 401 + wrong-actor 403 + happy path; if it's a new/changed gate → the e2e
      (card #5)

**Core/engine change:**
- [ ] Logic consumes ports, never concrete adapters; new adapter passes the port's contract suite
- [ ] Edge-reachable modules stay in `tsconfig.edge.json` and it passes
- [ ] Port/interface changes: whole-repo typecheck (stubs in db-memory/testing packages break)
- [ ] Barrel (`packages/core/src/index.ts`) exports updated deliberately (it's a hot shared file)

**E2E / test change:**
- [ ] Role/label selectors only (the a11y forcing function — it has found real product bugs);
      `data-testid` is a last resort
- [ ] Created content uses `uniqueTitle`; never edit seeded posts (chromium + webkit share one
      sandbox); visual specs are the only fixed-title exception
- [ ] Clock-derived pixels fixed (`page.clock.setFixedTime`) or masked; visual baselines are
      generated on the CI runner only, never committed from darwin
- [ ] New auth actor → seed in `e2e/lib/seed-users.ts` + storage state in `auth.setup.ts`

**Issue / PR / docs:**
- [ ] Issue has area label; security section when applicable; epic linked; design in the body,
      neutral public language (card #10)
- [ ] PR: `Closes #N`, what/why, verification evidence, dropped-scope called out as issues
- [ ] A concluded design discussion lands its artifacts: contract/reference → `docs/` doc; the
      decision + why → ADR in docs/architecture.md; friendly guide → an `area:docs` issue. Done ≠
      done without them (owner cares about doc durability)

## 6 · Uncertainty and escalation — exact rules

**The altitude test.** Ask: *does the answer change what a user sees, what the product promises,
what gets built at all, or what it costs?* Yes → **owner decision**. No (implementation, sequencing
inside approved scope, refactors, test strategy, tooling) → **your decision**: make it, record one
line of rationale in the issue, proceed. The owner explicitly delegates engineering and does not
want to review technical plans line-by-line.

**When you ask, ask like this:**
- Plain-text **numbered questions in chat** — never a multiple-choice UI widget.
- **Lead with your recommendation** and the one-line why; the owner often replies "your rec".
- Product language first — **frame in WordPress terms** when it maps (theme = installable theme,
  theme options = the Customizer, child theme = component override). Owner saying "I'm confused"
  means you drifted too technical: re-frame, don't re-explain.
- Batch questions; never trickle one per message. Keep working on what isn't blocked.

**Fact uncertainty is not owner-escalation — resolve it yourself, in this order:**
1. Code wins over any doc/memory/issue claim. Read it.
2. Dependency/ecosystem facts: context7 (API/usage) + npm registry (license/version/paid) + web.
   Never from training memory (card #9).
3. A memory or issue that contradicts the code: trust the code, note the staleness where you found
   it (e.g. this rewrite found "cid shipped" in memory while PR #392 was still open).

**Hard stops — never without explicit owner approval, no matter how confident:**
- Merging to `main` (owner UAT is the gate) or pushing to `main` directly
- Deleting user content, rewriting git history, force-pushing shared branches
- Publishing outward: public issue/PR text touching strategy (card #10), marketing copy, releases
- Adding paid services or anything that can generate a bill; changing license/legal posture
- Weakening any safety gate: CI checks, the token-contract guard, edge guard, authz matrix,
  CodeQL known-findings, audit gate
- Secrets: env only — never Git, never `settings.json`, never logged, never echoed in chat

**Blocked while working autonomously?** Don't invent, don't silently drop scope. Choose the safest
interpretation, state the assumption in the issue/PR at the top, file follow-ups for the paths not
taken, keep going. If truly un-proceedable, stop with a precise numbered question — not a status
essay.

**Never re-ask the settled list (§3.1 #5).** New evidence that a settled default is wrong here is
the only reason to surface it — and then say the evidence, not the question.

## 7 · Environment and commands

Node 22 (`.nvmrc`) · pnpm 10 (pinned via `packageManager`) · turbo 2. Workspace packages resolve
to **TS source** (no build step): editing `packages/core/src` hits dependents immediately.

| Task | Command (repo root) |
|---|---|
| Dev stack (api + admin + site) | `pnpm dev` — seeds `.content-sandbox/dev`, sets all env; api `:4444`, admin `:5173`, site `:4321`. `pnpm dev:stop` frees ports |
| Tests (all / one pkg / watch) | `pnpm test` · `pnpm --filter @setu/admin test` · `test:watch` |
| Typecheck / lint / format | `pnpm typecheck` · `pnpm lint` · `pnpm format:check` (lint is type-aware; big runs may need `NODE_OPTIONS=--max-old-space-size=4096`) |
| Turbo-cached variants | `pnpm typecheck:turbo` / `pnpm test:turbo` (cache is shared across worktrees at the main checkout's `.turbo`) |
| E2E | `pnpm e2e` (chromium + webkit-editor + visual; api `:4446`, admin `:5175`, own sandbox) · `pnpm e2e:ui` · one spec: `pnpm exec playwright test -c e2e specs/<file>` · types: `pnpm exec tsc -p e2e --noEmit` |
| Content sandbox | `pnpm content:seed` / `pnpm content:reset` (throwaway git repo under `.content-sandbox/`; canonical `content/` is never written by dev/UAT) |
| Block/relations codegen | `node scripts/gen-blocks.mjs && node scripts/gen-relations.mjs` (site's `predev`/`prebuild` run them; run manually before site typecheck outside those) |
| Script tests | `pnpm test:scripts` |

**Operational gotchas (beyond §4):**
- Env `pnpm dev` sets: `SETU_API_PORT`, `SETU_REPO_DIR` (git sandbox), `SETU_MEDIA_DIR`,
  `SETU_CONTENT_DIR` (site read root), `VITE_SETU_API`, `VITE_SETU_SITE`, `PUBLIC_SETU_MEDIA`.
  A feature gated on `Boolean(previewApi)` disappears silently without them.
- Astro dev caches `getStaticPaths` — permalink/settings changes need a site dev-server restart in
  dev; invisible in prod builds. Not a bug; don't chase it.
- Radix `Select` can't be driven by synthetic events in the preview tools — use `preview_fill` on
  inputs / seeded `settings.json`; real preset clicks are human-UAT or Playwright territory.
- `preview_start` reads the MAIN checkout's `.claude/launch.json`; for a worktree, the config must
  `cd` into the worktree or it runs main's code.
- CI (`.github/workflows/ci.yml`): PR = affected-only via turbo `...[merge-base]` (docs-only PRs
  skip; **draft PRs skip the `check`+`e2e` jobs** until marked ready, #462; root/config changes run
  full); push to main + **weekly** (Mon 03:17 UTC) + **`workflow_dispatch`** = full + e2e full
  matrix (`E2E_FULL_MATRIX=1`). **CodeQL runs on push-to-main + weekly, NOT per-PR** (#462 cost);
  it gates on NEW findings vs `.github/codeql-known-findings.json` (every entry has a tracking
  issue). `pnpm audit --audit-level=high` gates supply chain (via pnpm 11's bulk-endpoint
  client, #477). The repo is public (2026-07-14), so Actions minutes are free — the lean per-PR
  lane is kept anyway: it's the merge-latency and signal-noise win, not just the bill.
- Turbo `inputs` overrides REPLACE the defaults — always keep `"$TURBO_DEFAULT$"` in the list, and
  prove cache changes with a kill-shot (break the input → expect `cache miss`).
- E2E auth harness: seeded users live in `e2e/lib/seed-users.ts` (`admin` / `author`,
  `*-e2e@setu.test`); `SETU_AUTH_RATELIMIT_ENABLED=false` only there (better-auth rate-limits
  sign-in 3/10s globally); sandbox reset rides `webServer.command` because Playwright starts
  webServer BEFORE globalSetup.

## 8 · Git and multi-session safety

Multiple sessions work this repo concurrently in worktrees. The contract is
[docs/collaboration.md](docs/collaboration.md); the load-bearing rules:

- **`origin/main` is the hub. No session owns local `main`** — never `git checkout main` in any
  checkout as housekeeping; integrate by pushing your branch and PR-ing.
- Branch off **freshly fetched** `origin/main`; sync by **merging** `origin/main` *into* your
  branch (merge, never rebase — shared-history safety, per docs/collaboration.md); `pnpm install`
  after any lockfile-moving merge, then re-run tests on the merged result.
- Hot files (coordinate, edit atomically): `apps/admin/src/app.tsx`, `packages/core/src/index.ts`,
  root `package.json`, `pnpm-lock.yaml`. Prefer adding files over editing shared ones.
- **Subagent guard (§4 #8) is mandatory in every dispatch that edits or commits.** Prefer mid-tier
  or better models for any task that commits; verify the commit landed on the expected branch
  yourself — a subagent's claimed SHA is not proof.
- Commits: reference the issue; end with the `Co-Authored-By: Claude <noreply@anthropic.com>`
  trailer; no marketing attribution anywhere (card #10).
