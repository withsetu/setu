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
- **Git:** `origin/main` is the hub. Work on a branch in a worktree; PR to `main`; never commit to
  `main` directly. Run `pnpm install` after dep-changing merges.

## Where things are

- Specs/plans: `docs/superpowers/{specs,plans}/`
- Content blocks: repo-root `blocks/<tag>/` (auto-discovered) + `@setu/core` standard blocks
- Admin editor: `apps/admin/src/editor/` · Site render: `apps/site/` · Core: `packages/core/`
- Dev stack: `pnpm dev` (api + admin + site against a gitignored `.content-sandbox/`)
