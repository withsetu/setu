# T4 — Publish flow E2E (issue #219) — report

## Status: DONE

## What shipped

- `e2e/specs/publish.spec.ts` — chromium-only, no `editor-` prefix. Journey: create post
  (title + body via existing `ContentListPage`/`EditorPage` methods + `uniqueTitle('publish')`)
  → click the real `Publish` button → assert UI post-publish state → assert the saved≠live
  honesty surface → assert the content list row flips out of "Draft" → assert the real git
  commit landed in `.content-sandbox/e2e`.
- `e2e/pages/EditorPage.ts` — added `publishButton`, `publishedToast`, `stagedStatus`
  getters and a `publish()` intent method.
- `e2e/pages/DashboardPage.ts` — added `notDeployedYetText` getter for `SiteDeployCard`.
- `e2e/pages/ContentListPage.ts` — added `rowStatus(title)`, a row-scoped status-badge
  locator (`getByRole('row', ...).getByText(/^(Draft|Staged|Live|Unpublished)$/)`).
- `e2e/lib/sandbox-git.ts` (new) — the sanctioned direct-git helper: `sandboxHeadSubject()`
  (`git log -1 --format=%s`) and `sandboxStatusPorcelain()` (`git status --porcelain --
  content/`, scoped — see finding below), both executed against `.content-sandbox/e2e`.

No harness/config/T2/T3 files touched. No `.github/workflows/` changes. No semicolons,
single quotes throughout, matching repo style.

## What the real publish UI turned out to be

Explored `apps/admin/src/editor/EditorScreen.tsx` + `PublishMenu.tsx` + the lifecycle seam
(`apps/admin/src/lifecycle/useLifecycle.ts`, `packages/core/src/lifecycle/derive.ts`) before
writing any selector.

- **The publish affordance**: `PublishMenu`'s primary `<Button>Publish</Button>` (only
  rendered once `phase === 'ready' && !composing`, i.e. after the entry's first autosave
  has minted a real slug — a brand-new "New post" doesn't show it until you've typed and
  the URL has flipped from `/edit/post/en/new` to `/edit/post/en/<slug>`). Clicking it runs
  `EditorScreen`'s `commit()`: save-then-`publish.publish()` (a real `git.commitFile`), then
  `notify.success('Published · ' + sha.slice(0,7))`.
- **Post-publish UI state**: two independent, corroborating signals —
  1. A toast, `role="status"` inside a `region "Notifications"` live region
     (`apps/admin/src/ui/notify.tsx`), auto-dismissing after 4s. Text: `Published · <sha7>`.
  2. The editor header's `StripStatus` lifecycle badge (a plain `<span>`, no ARIA role)
     flips from "Draft" to **"Staged"** — `deriveLifecycle`'s state for "committed to Git,
     never deployed" (`packages/core/src/lifecycle/derive.ts`). The content list's
     `ContentTable` shows the same badge per-row, so publishing also flips the list row's
     status away from "Draft" — used for requirement (e).

## The saved≠live honesty surface — what it actually is, and a product finding

Two candidate surfaces exist. One is honest; one is not, and I want to flag that precisely
per CLAUDE.md's saved≠live rule.

**Honest surface (asserted in the spec): the Dashboard's `SiteDeployCard`.**
`apps/admin/src/deploy/deploy.tsx`'s `DeployProvider` holds `{ sha: string | null }`,
starting `null`. It only advances when something calls `useDeploy().deploy()` — and **I
verified nothing in the app currently calls `deploy()` anywhere** (grepped
`apps/admin/src` for `.deploy(` — zero call sites outside the definition itself). So
`SiteDeployCard` (`apps/admin/src/dashboard/widgets/SiteDeployCard.tsx`) reads **"Not
deployed yet"** before publish, and — because publishing a post is only a Git commit, never
a deploy — it *still* reads "Not deployed yet" immediately after. The spec asserts this
explicitly (step d): navigate to `/dashboard`, assert `dashboard.notDeployedYetText` is
visible, right after publishing. This is the real, currently-shipped saved≠live signal.

**FINDING — a decoy in the editor header.** `EditorScreen.tsx`'s per-entry "view on the
live site" external-link button toggles between two states purely on
`lifecycle.state === 'staged' || 'live'`:
```tsx
{lifecycle.state === 'staged' || lifecycle.state === 'live' ? (
  <Button aria-label="View this page on the live site">…</Button>
) : (
  <Button disabled aria-label="Not on the site yet — publish to view it live">…</Button>
)}
```
Because a first-ever publish immediately sets `lifecycle.state` to `'staged'` (not `'live'`
— the code conflates the two for this toggle), this button flips to **enabled**, labeled
**"View this page on the live site"**, and links to `siteUrl(ref)` — on this very publish,
before anything has deployed. In the e2e harness the site (port 4321) is intentionally
never booted, so that link would 404/connection-refuse if clicked; in a real deployment
it would point at content that isn't there yet. This directly contradicts the CLAUDE.md
saved≠live rule ("never imply a change is live when it needs a build"): the label says
"View this page on the live site" for content that is staged-only, not live. The
"Staged" badge right next to it is accurate — it's the external-link button's *label*
that overclaims.

I did not fix this (out of scope for a test-authoring task, and it's a product/UX call —
should the label read differently for `staged` vs `live`?). Recommend the owner spin off an
`area:editor` issue referencing this report, `packages/core/src/lifecycle/derive.ts`, and
`EditorScreen.tsx`'s `lifecycle.state === 'staged' || 'live'` toggle, per the CLAUDE.md
"spin off, don't bury" rule. The `EditorPage.stagedStatus` getter's doc comment also calls
this out in-code so a future reader of the test doesn't copy the anti-pattern.

## Verification

Ran `pnpm e2e` three times back-to-back, all green, 6/6 (T1 smoke, T2 edit-post ×2
projects, T3 slash-insert ×2 projects, T4 publish):

```
Running 6 tests using 6 workers
[1/6] [webkit-editor] › editor-slash-insert.spec.ts
[2/6] [chromium] › editor-edit-post.spec.ts
[3/6] [chromium] › smoke.spec.ts
[4/6] [chromium] › publish.spec.ts
[5/6] [chromium] › editor-slash-insert.spec.ts
[6/6] [webkit-editor] › editor-edit-post.spec.ts
  6 passed (6.0s)
```
(repeated twice more — same 6 passed / 0 failed each time)

## Bugs hit + fixed during authoring

1. **Toast accessible-name race**: `getByRole('status', { name: /^Published ·/ })` never
   matched — the status div's computed accessible name gets muddied by the sibling
   "Dismiss" button, and/or the 4s auto-dismiss window raced the assertion. Fixed by
   scoping via the stable `region "Notifications"` live region and matching visible text
   instead of the role's computed name: `getByRole('region', { name: 'Notifications',
   exact: true }).getByText(/^Published ·/)`.
2. **`git status --porcelain` not empty after a clean publish**: the sandbox repo always
   has an untracked `.setu/` (submissions.db, reprocess.db — `apps/api/src/server.ts`
   creates these under `SETU_REPO_DIR/.setu/` unconditionally, independent of
   `SETU_MEDIA_DIR`). This is pre-existing harness/api scaffolding noise, not something a
   publish-correctness check should fail on. Scoped the sanctioned porcelain check to
   `-- content/` only, which is what publish actually touches — documented inline in
   `e2e/lib/sandbox-git.ts`.
3. **Commit-message assertion needed the real slug, not the raw title**: `publish-service.ts`
   defaults the commit message to `Publish <collection>/<locale>/<slug>`, and the slug is
   `slugify(title)` (`apps/admin/src/editor/new-entry.ts`) — not exported from `@setu/core`,
   so re-deriving it in the test risked drift. Instead the spec reads the slug back out of
   `page.url()` after autosave mints it and navigates (`/edit/post/en/<slug>`), which can't
   drift from the app's own logic.

## Concerns

- The toast's 4s auto-dismiss is a real flakiness risk if publish ever gets slower (e.g. a
  slow `reindexEntry`/`markSyncedAt` before the assertion runs) — `publish()` currently
  clicks then immediately asserts, so there's no added delay from this test, but any future
  caller of `EditorPage.publish()` that inserts an `await` before checking the toast will
  reintroduce the race. Documented in the getter's comment.
- The editor-header "View this page on the live site" decoy (see finding above) is a real
  UX defect I did not fix.
- `sandboxStatusPorcelain()` is scoped to `content/` rather than repo-wide; if a future
  publish-adjacent test wants a whole-tree clean check it will need its own reasoning about
  the `.setu/` noise (not a git-ignore fix I made, since `.content-sandbox/e2e/.gitignore`
  doesn't exist and adding one felt out of scope for a test-only task — flagging as a
  possible tiny follow-up for whoever owns the sandbox script).
