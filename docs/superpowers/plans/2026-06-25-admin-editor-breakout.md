# Editor chrome PR C1 — canvas width & image breakout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (INLINE) — this is a CSS/canvas-geometry increment tuned **editor-visible** (live on `:5173` + screenshots). Blind subagent execution is the wrong tool here (the documented reason the prior attempt was abandoned). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the editor canvas WYSIWYG for image alignment (`none/left/right/wide/full` break out true-to-life) and fix the site's latent `wide` bug — pure CSS + `.ed-canvas` geometry.

**Architecture:** Editor adopts a per-block-constrain model: `.ed-canvas` full-pane width, the title + non-aligned `.setu-prose` children capped at `--measure-post` and centered, aligned figures breaking out via `100%` of the pane (NO `vw`/`cqw` escape). Site gets a one-rule fix: `align-wide` uses explicit `width` instead of `max-width`.

**Tech Stack:** CSS only (`apps/admin/src/styles/editor.css`, `packages/theme-default/site.css`); Vitest for no-regression; live visual verification.

## Global Constraints

- Measures: `--measure-post: 38rem` (608px), `--measure-page: 64rem` (1024px) — match the default theme so the editor mirrors the site.
- Breakout uses explicit `width` (NOT `max-width`) — that was root cause #1. NO `vw`/`cqw` in the editor — root cause #2 (the editor escape slides under the sidebar / cqw didn't take effect). The editor's full-pane canvas means `100%` already resolves to the pane.
- The ProseMirror root is `.setu-prose` (set in Canvas.tsx). The title input is `.ed-title` (sibling inside `.ed-canvas`). The image figure is `.setu-image-block.align-{x}`, a direct child of `.setu-prose`; its toolbar `.block-props` is `position:static` inside it.
- Site `none`/`full`/`left`/`right` must stay pixel-identical; only `wide` changes (it currently doesn't break out at all). Site render tests assert markup (unchanged) → stay green.
- Round-trip / `@setu/core` / node logic: NO change.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green. The REAL done bar is visual UAT (owner verifies image alignments true-to-life on `:5173` + preview).

---

### Task 1: Site — fix the latent `wide` breakout

**Files:**
- Modify: `packages/theme-default/site.css` (the `figure.setu-image.align-wide` rule)

- [ ] **Step 1: Note the current site image tests are markup-only**

Run: `pnpm --filter @setu/site test -- image` and confirm green BEFORE the change (baseline). These assert the `setu-image align-{x}` markup, not computed CSS — so a CSS-value change keeps them green. If any assert the literal `max-width: var(--measure-page)` string, note it (unlikely).

- [ ] **Step 2: Change `align-wide` to explicit width**

In `packages/theme-default/site.css`, replace:
```css
.prose figure.setu-image.align-wide { max-width: var(--measure-page); margin-left: 50%; transform: translateX(-50%); }
```
with:
```css
.prose figure.setu-image.align-wide { width: min(var(--measure-page), calc(100vw - 2rem)); margin-left: 50%; transform: translateX(-50%); }
```
(`width` makes the figure actually expand to the page measure — capped to the viewport minus a small gutter so it never overflows on narrow screens. `full` (`width:100vw`), `left`/`right` (float), `none` unchanged.)

- [ ] **Step 3: Run site tests + build**

Run: `pnpm --filter @setu/site test && pnpm --filter @setu/site build`
Expected: green (markup unchanged). Visually (live preview) `wide` now sits wider than body text and narrower than `full`.

- [ ] **Step 4: Commit**

```bash
git add packages/theme-default/site.css
git commit -m "fix(theme): site image align-wide breaks out (explicit width, not max-width)"
```

---

### Task 2: Editor — full-pane canvas + per-block measure + breakout (LIVE)

**Files:**
- Modify: `apps/admin/src/styles/editor.css` (`.ed-canvas`, `.ed-title`, `.setu-prose` children, `.setu-image-block.align-*`)

This task is tuned LIVE against `:5173`. The starting CSS below is the model; adjust paddings/measures by screenshot until each alignment reads true-to-life.

- [ ] **Step 1: Start the dev stack**

From the repo root (main checkout): `pnpm dev` (admin on `:5173`, with the API). Open a post with an image block (or insert one).

- [ ] **Step 2: Validate the breakout geometry in isolation first**

Before touching the editor, validate the CSS math in a standalone render (a static HTML mock of `.setu-prose` with paragraphs + figures at each align class, using the rules below) so the model is proven before wiring it in. Confirm: paragraphs at `--measure-post`, `wide` wider+centered, `full` full-width, `left`/`right` floated at ~50%.

- [ ] **Step 3: Apply the editor model**

Rework `apps/admin/src/styles/editor.css`:
```css
/* full-pane canvas; the readable measure is applied per-block */
.ed-canvas { max-width: none; margin: 0; padding: 64px clamp(24px, 6vw, 80px) 40vh; --measure-post: 38rem; --measure-page: 64rem; }

/* title + non-aligned prose blocks sit at the post measure, centered */
.ed-title,
.setu-prose > :not(.align-left):not(.align-right):not(.align-wide):not(.align-full) {
  max-width: var(--measure-post); margin-inline: auto;
}

/* aligned figures break out using the pane width (100% = the full-pane canvas) */
.setu-prose > .align-wide  { width: min(var(--measure-page), 100%); margin-inline: auto; }
.setu-prose > .align-full  { width: 100%; }
.setu-prose > .align-left  { float: left;  max-width: 50%; margin: .3rem 1.25rem 1rem 0; }
.setu-prose > .align-right { float: right; max-width: 50%; margin: .3rem 0 1rem 1.25rem; }
/* .align-none inherits the per-block measure cap above */
```
Then remove the now-superseded editor-only image rules that conflict:
```css
.setu-image-block.align-left .sib-img,
.setu-image-block.align-right .sib-img { max-width: 50%; }   /* DELETE — the figure now floats at 50%; the img fills it */
```
Keep image-specific chrome: `.setu-image-block { margin: 1.25rem 0 }`, `.sib-img { max-width:100% }`, `.block-props`/caption/alt/replace styling, and for `wide`/`full` ensure `.sib-img { width: 100% }` so the image fills the broken-out figure.

> The `clamp()` padding, the exact measure for the editor (it can be `38rem` to mirror the post, or slightly wider if the canvas feels cramped — owner's call at UAT), and toolbar-visibility at `wide`/`full` are tuned live. Verify the align toolbar (`.block-props`, static above the figure) is not clipped when the figure breaks out full-width.

- [ ] **Step 4: Screenshot each alignment + iterate**

In the running editor, set the image to `none`, `left`, `right`, `wide`, `full` in turn; screenshot each; adjust the CSS until: body text at post measure; `none` = post measure; `wide` clearly wider + centered; `full` fills the pane; `left`/`right` float beside text; toolbar usable throughout. (This is the felt fix — iterate until it's right.)

- [ ] **Step 5: Light automated guard + gate**

Optionally add a test asserting `editor.css` contains the `.align-wide`/`.align-full` width rules (so the breakout can't silently regress). Then run:
`pnpm typecheck && pnpm test && pnpm build` — green. The `image-block-node` test (align classes emitted) stays green (no node change).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/styles/editor.css apps/admin/test/*.ts*
git commit -m "feat(admin): editor canvas mirrors front-end image breakout (wide/full WYSIWYG)"
```

---

### Task 3: Verify + UAT handoff

- [ ] **Step 1: Full gate (independent)**

Run from repo root: `pnpm typecheck && pnpm test && pnpm build` — all green. Note the test count.

- [ ] **Step 2: Self visual check**

On `:5173`: confirm the five alignments render true-to-life and the toolbar stays usable; confirm body text didn't shift unreadably wide. On the site preview, confirm `wide` now breaks out and `none/full/left/right` are unchanged.

- [ ] **Step 3: Hand to owner for UAT**

Summarize what to check (image none/left/right/wide/full in the editor vs the published page). Owner UAT is the done bar.

---

## Self-Review

**Spec coverage:**
- Editor WYSIWYG breakout (per-block model, no vw/cqw) → Task 2. ✓
- Site latent `wide` fix (explicit width) → Task 1. ✓
- Generalize to `.align-*` (any block) in the editor → Task 2 (`.setu-prose > .align-*`). ✓
- No round-trip/core/node change → respected (CSS only). ✓
- Visual UAT as the done bar → Task 3. ✓

**Placeholder scan:** The "tuned live" notes are intrinsic to a visual increment (the model is concrete; exact paddings/measures are screenshot-tuned), not skipped work — each names the file + the rules. No "TBD"/"add error handling".

**Type consistency:** N/A (CSS). Class names consistent: `.setu-prose`, `.ed-canvas`, `.ed-title`, `.setu-image-block.align-{x}`, `--measure-post`/`--measure-page` used identically across tasks and matching the real DOM (Canvas.tsx `setu-prose`, ImageBlock `align-{x}`).
