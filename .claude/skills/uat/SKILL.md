---
name: uat
description: Use when about to claim a Setu change works, is fixed, or is done; before opening a PR for anything user-visible; when asked to verify, demo, or screenshot a feature; or when the running app misbehaves — feature missing, blank screen, preview/media silently gone, weird navigation, "worked yesterday".
---

# Driving Setu UAT

## Overview

In this repo, **green tests have repeatedly certified broken software**: a skeleton Query block
("done" with a raw text box and no preview), an editor that white-screened on first owner click
(jsdom passed; the live Radix-in-canvas integration infinite-looped — twice), and four authz holes
on #371 that lived in seams no unit test crossed. UAT — driving the real flow in a real browser and
reporting what you *saw* — is the Definition of Done gate that catches this class. This skill is
how to do it without losing an hour to a mis-launched stack.

**Core principle: you have not verified a feature until you have *used* it. Exit codes are not
usage.**

## When to use

- Before any "done / works / fixed" claim for user-visible, rendering, interactive, or
  topology-sensitive changes — and before every PR containing them (DoD #1).
- When a feature "isn't showing", a screen is blank, or dev behavior looks impossible — run the
  Phantom-bug checklist below **before** touching code.
- When NOT required: pure internal logic fully proven by unit tests plus a targeted output check
  (the proportional-effort clause). Then **say explicitly** in the report/PR: "live UAT skipped:
  internal-only change, verified by <test> + <output check>". Silence is not an option.

## Launch the stack correctly (most "bugs" die here)

**From the main checkout** (`/Users/mayank/Documents/projects/setu`):

```bash
git branch --show-current   # MUST be the branch under test — see hazard below
git pull                    # if a PR just merged; a stale checkout UATs pre-merge code
pnpm install                # if pnpm-lock.yaml moved since last install
pnpm dev                    # api :4444 · admin :5173 · site :4321 — seeds .content-sandbox/dev
```

**Never launch a bare `vite` or `astro dev`.** Root `pnpm dev` injects the env everything is gated
on (`VITE_SETU_API`, `VITE_SETU_SITE`, `SETU_REPO_DIR`, `SETU_CONTENT_DIR`, `PUBLIC_SETU_MEDIA`).
Without it, preview, media upload, and auth **silently vanish** (controls are gated
`Boolean(previewApi)`) and you will "debug" a feature that isn't broken.

**From a worktree:** use a `.claude/launch.json` configuration that (a) `cd`s into the worktree —
`preview_start` otherwise runs the MAIN checkout's code — and (b) uses non-dev ports (the
`date-authoring-uat-365` config is the precedent: api `:4446`, admin `:5175`, site `:4325`; note
`:4446/:5175` collide with the e2e harness — don't run both at once). The worktree seeds its own
`.content-sandbox/dev`. `better-sqlite3` may need `pnpm rebuild better-sqlite3` there.

**Shared-checkout hazard:** another session can `git checkout` the main checkout mid-UAT — HMR then
serves a half-switched tree and you chase phantom bugs. If behavior turns bizarre, check
`git branch --show-current` and `git reflog` FIRST.

## What "driven" means, per surface

Drive the flow a real user would, operating **every control you added** — not just loading the
screen.

| Surface | Minimum drive |
|---|---|
| Admin screen / control | Open via nav AND deep link; operate every new control; submit with **Enter**; tab through it (keyboard-only pass); watch the success/error toast; reload and confirm persistence; check dark mode (`[data-theme="dark"]`) |
| Editor / block | Insert via slash menu; edit every inspector control and watch the canvas update; check the **preview iframe**; publish; open the site (`:4321`) and see it rendered; reopen the entry and confirm round-trip (nothing dropped/reordered) |
| Auth / authz | Real cross-origin browser login — **the local auto-owner shortcut does not count**. Drive as the WRONG role too: attempt the operation (save/publish/delete/API call), don't just eyeball nav visibility — #371's UAT bugs were operations, not menus. The durable form of this proof is the wrong-actor e2e (`e2e/specs/auth-role-gate.spec.ts` pattern; seeded users in `e2e/lib/seed-users.ts`: `admin` / `author`, `*-e2e@setu.test`) |
| Settings / publish / taxonomy | Save; verify the commit landed in the sandbox repo (`git -C .content-sandbox/dev log --oneline -3`); confirm the site reflects it (dev re-reads live; remember saved ≠ live on prod SSG — don't claim "live") |
| Media | Upload, pick from library, confirm the rendered URL under `/media/YYYY/MM/…` resolves |

**Editor-canvas React smoke (the jsdom-blind class):** after mounting anything Radix/ProseMirror-
reactive, watch the browser console for `Maximum update depth exceeded` while selecting/typing
across blocks. For scripted checks, the Tiptap instance is reachable via the React fiber on
`#root` (`__reactContainer$` key) — `editor.chain().insertContent(...).run()`,
`setNodeSelection`, then read `console.error`. Preview crashes report the real stack **only in the
preview iframe's browser console** — the api daemon log truncates it.

## Evidence — what a UAT report contains

A done-claim carries proof, in this shape:

```
UAT: <branch> at <sha>, `pnpm dev` from <checkout>
- Drove: <flow 1> → saw <result>   (screenshot for visual changes)
- Drove: <wrong-role attempt> → blocked with <exact behavior>
- Console: clean / <what appeared>
- Skipped: <surface> because <reason>
```

"Tests pass and it builds" is not a UAT report.

## Phantom-bug checklist (run BEFORE blaming the code)

1. `git branch --show-current` — right branch? `git reflog` — did another session move it?
2. Launched via `pnpm dev` (or a worktree launch config)? Is `VITE_SETU_API` actually set?
3. Is the missing feature **API-gated** (`Boolean(previewApi)` / capability-gated)?
4. Did a merge just land? → `git pull` + `pnpm install`, then re-check.
5. Permalink/settings change not taking? Astro dev caches `getStaticPaths` — restart the site dev
   server; it's not a bug.
6. Editor preview crash? Read the **preview iframe's** browser console, not the daemon log.
7. Worktree: native module errors → `pnpm rebuild better-sqlite3`.

## Rationalizations — all of these have shipped bugs here

| Excuse | Reality |
|---|---|
| "All tests pass, it's done" | The #371 authz holes, the looping editor, and the skeleton Query block all had green suites |
| "It's a small change" | Small user-visible changes get the proportional drive: open it, click it — minutes |
| "The jsdom test mounts the whole component" | jsdom passed while the live editor white-screened. Twice |
| "I checked the nav hides it for authors" | Nav-hiding is UX. Drive the *operation* as the wrong role, or point at the wrong-actor e2e |
| "I drove it before the review fixes" | You drove old code. Re-drive the changed flow |
| "The dev server is being weird, I'll assume it works" | Run the phantom-bug checklist; a mis-launched stack is 10 minutes, a false done-claim costs the owner's UAT round |
| "I'll let the owner's UAT catch it" | The owner's UAT is the *final* gate; pre-empting it with drafts burns their time and your credibility |

## Red flags — stop and drive it

- You're typing "done", "works", "fixed", or "ready for review" and there's no UAT evidence block.
- You're about to debug code because a feature "disappeared" and you haven't run the phantom-bug
  checklist.
- Your authz verification consists of screenshots of menus.
- You're claiming a publish/settings change is "live" without a deploy step existing.
