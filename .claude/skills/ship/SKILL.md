---
name: ship
description: Use when a Setu branch looks finished and is about to become a PR, when someone says "open a PR" / "ready for review" / "this is done", or when preparing the review-and-merge handoff for completed work.
---

# Shipping a Setu branch

## Overview

PRs here don't usually bounce on code — they bounce on **process misses**: a skeleton presented as
done, a missing wrong-actor e2e on an authz change, a stale merge that broke after `origin/main`
moved, deferred scope buried instead of filed, strategy language in a public PR body. Each bounce
costs a full review round-trip plus the owner's UAT time. This is the pre-PR gauntlet that makes a
branch land in one pass.

**Run it top to bottom. Every step emits evidence or an explicit "N/A because …". A skipped step
is a silent defect.**

## When to use

- Implementation complete on a feature branch and you're about to write `gh pr create`.
- The owner asked "is it ready?" — this checklist IS the answer.
- NOT for: mid-feature commits, spikes/prototypes explicitly labeled as such.

## The gauntlet

### 1 · Scope honesty (against the issue)

- Re-read the tracking issue and the agreed design (mockup/named reference). List every element of
  the agreement that is NOT in the branch. Anything dropped is either restored now or declared as
  an **incomplete** delivery — never silently narrowed. A stripped version of an approved design
  is a defect (Definition of Done #2/#5).
- Deferred scope, follow-ups, tech debt you noticed → **file issues now** (`gh issue create`,
  `area:*` label, link the parent epic). Spin off, don't bury.

### 2 · Sync and re-verify on the merged reality

```bash
git fetch origin && git merge origin/main     # resolve here, in your worktree
pnpm install                                  # if pnpm-lock.yaml moved
```

Then the safety gates on the MERGED result (these are always-on; no proportionality escape):

```bash
pnpm typecheck            # whole repo — port/interface changes break stub adapters elsewhere
pnpm test                 # or scope to affected packages; CI runs the full net either way
pnpm lint && pnpm format:check
```

- Touched `e2e/`? Also `pnpm exec tsc -p e2e --noEmit` (nothing else typechecks it).
- Touched auth, an admin journey, publish, or upload? Run the lane: `pnpm e2e` (chromium PR lane
  locally; CI runs the same). Remember `pnpm -r test` NEVER runs e2e.
- Touched CI/affected-filtering/turbo config? Verify from a **real clone**
  (`git clone file://$PWD /tmp/setu-verify`) — pnpm/turbo change-detection lies inside linked
  worktrees (returns 0 affected). Prove cache-config changes with a kill-shot (break an input →
  expect `cache miss`).

### 3 · The two review-blocking checklists

- **Security re-answer** ([docs/security-standards.md](../../../docs/security-standards.md)) — the
  pick-time answers, revisited now that the code exists: new route gated server-side + fail-closed?
  inputs Zod-capped? fetches through the safe helper? new deps supply-chain-checked? secrets
  env-only? security events audited? One line each; "N/A" is fine, silence is not.
- **Gate-parity (auth/authz diffs).** If the branch adds or alters any auth/authz gate, the PR must
  point at the e2e that proves **the right actor is admitted and the wrong actor is blocked**
  (pattern: `e2e/specs/auth-role-gate.spec.ts`; seed new actors via `e2e/lib/seed-users.ts` +
  `auth.setup.ts`). No such e2e → the branch is not ready; reviews are instructed to BLOCK it.
  A new top-level user flow (login/publish/upload) needs one browser e2e.

### 4 · UAT with evidence

Invoke **`/uat`** if not already done on the final code (post-review-fix code counts as new code —
re-drive the changed flow). The PR body carries the evidence block: what you launched, what you
clicked, what you saw, wrong-role attempt for authz work, screenshots for UI. For internal-only
changes, write the explicit proportionality line: "live UAT skipped: <reason>, verified by <test>".

### 5 · The PR

```bash
git push -u origin <branch>
gh pr create --title "<type>(#<issue>): <what>" --body "<see template>"
```

Body template:

```markdown
Closes #<N>

## What & why
<2–5 lines, product language first>

## How it was verified
- <safety gates: typecheck/tests/lint — one line>
- <UAT evidence block from /uat>
- <wrong-actor e2e path, if authz>

## Security checklist
<the one-liners from step 3, or "all N/A — no new route/input/fetch/dep">

## Spun off
- #<M> <deferred thing>
```

Rules: `Closes #N` always; the body **ends at the Spun off list** — the harness's default
"🤖 Generated with [Claude Code]" footer is banned in this repo, so do not let it be appended;
commits carry the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer; public-repo language
only — engineering rationale, zero competitive/moat/licensing strategy.

### 6 · Dispatch the review, then stop

- Whole-branch review dispatch MUST include the polish rubric from
  [docs/quality-bar.md](../../../docs/quality-bar.md) (driven? matches design? reuses? complete?
  table-stakes UX? gate-parity?) plus the security checklist. A correct-but-skeleton branch is
  `Needs fixes`, not `Approved`.
- Fix loop until clean, re-driving UAT if fixes touched user-visible code.
- **Then hand off: the owner merges after their UAT. Do not merge on green yourself.** After the
  owner merges: `git pull` in the main checkout before any UAT there, `pnpm install` if deps moved,
  remove the worktree, close the loop on the issue labels.

## Rationalizations — each has bounced a real PR

| Excuse | Reality |
|---|---|
| "CI will catch it" | CI is the net, not the process. A red PR costs a round-trip; the gauntlet is 10 minutes |
| "Whole-repo typecheck is overkill for this diff" | A port-interface change broke every stub implementor; only the repo-wide check saw it |
| "Unit tests cover the authz change" | Every #371 UAT bug lived in a seam no unit test crossed; the wrong-actor e2e is the proof that counts |
| "I drove it before the review fixes" | You drove different code. Re-drive |
| "I'll file the follow-ups after merge" | After merge they evaporate. File them now; link them in the PR |
| "It's 95% of the design, ship it as increment 1" | The missing 5% is usually the polish that IS the product. Restore it or label the PR incomplete |
| "The review can be light, it's routine" | Reviews block on polish + security by standing rule; dispatch the rubric every time |

## Red flags — not ready

- The PR body has no UAT evidence and no explicit proportionality line.
- You can't name the e2e that blocks the wrong actor on an authz diff.
- `origin/main` was last merged in before your final commits.
- You're about to run `gh pr merge`. That command belongs to the owner.
- The body explains *strategy* ("competitors do X") instead of *engineering*.
