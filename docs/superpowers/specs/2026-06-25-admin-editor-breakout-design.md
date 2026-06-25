# Editor chrome — PR C1: canvas width & image breakout (WYSIWYG)

Status: approved approach, ready for plan
Date: 2026-06-25
Editor-chrome PR (A strip ✅ → palette ✅ → B meta panel ✅ → **C1 breakout** → C2 floating-menu polish). Folds in roadmap sub-project #3 ("editor width & breakout"). Done **editor-visible** (live iteration + screenshots). Part of [[setu-admin-shadcn-migration]]. Supersedes the abandoned `origin/editor-width-breakout`.

## Goal

Make the editor canvas faithfully mirror the front-end so an image block's alignment
(`none | left | right | wide | full`) renders **true-to-life while editing** — fixing the bug where
`wide`/`full` look identical to `none` in the flat 720px canvas. Also fix the **site's latent `wide`
bug** so published `wide` actually breaks out. Generalize each context's breakout rules to target
`.align-*` on any block (future layout blocks inherit), WITHOUT forcing one shared stylesheet.

## What's broken today (current `main`)

- **Editor** (`apps/admin/src/styles/editor.css`): `.ed-canvas { max-width: 720px; margin: 0 auto }`
  is a flat box. The image block (`.setu-image-block.align-*`) has breakout rules ONLY for
  `align-left`/`align-right` (img `max-width:50%`); **`wide` and `full` have no rule** → they look
  like `none`. The ProseMirror root carries `class="setu-prose"` (Canvas.tsx:130); the title input
  `.ed-title` lives in `.ed-canvas` alongside `<Canvas/>`.
- **Site** (`packages/theme-default/site.css`): `figure.setu-image.align-wide { max-width:
  var(--measure-page); margin-left:50%; transform:translateX(-50%) }`. `max-width` (not `width`) on a
  `width:auto` block nets back to the column width → **site `wide` doesn't break out either**. `full`
  works (`width:100vw`); `left`/`right` work (float). Measures: `--measure-post:38rem` (608px),
  `--measure-page:64rem` (1024px); post column = `.measure-post { max-width:var(--measure-post);
  margin:0 auto }`.
- The image node (`ImageBlock.tsx`) already emits `class="setu-image-block align-{align}"` + the align
  toolbar — wiring exists; this is a CSS/canvas-geometry problem only. No `@setu/core`, round-trip,
  or node-logic change.

## Why not the abandoned approach

The abandoned `editor-width-breakout` tried ONE shared parameterized `block-align.css` for both
contexts, with the editor's `full` bleeding via `100cqw` (container query on `.ed-scroll`) — which
never took effect. Two documented root causes: (1) `wide` needs an explicit `width`, not `max-width`;
(2) site and editor can't share one identical sheet — the site escapes its measure column via `vw`,
the editor can't (`vw` slides under the sidebar), and the `cqw` substitute failed. We avoid both by
giving the editor a model that needs **no viewport/container escape at all**.

## Architecture

### Editor — per-block-constrain model (no escape needed)

The canvas becomes **full-pane width**; the readable measure is applied **per block**, and aligned
figures use the available pane width directly:

- `.ed-canvas` → drop `max-width: 720px`; let it fill the `.ed-scroll` pane (keep comfortable
  horizontal padding so `full` has a small gutter, and keep the vertical padding).
- The title input `.ed-title` and each **non-aligned** direct child of `.setu-prose`
  (`p, h1–h6, ul, ol, blockquote, pre, hr, .setu-image-block.align-none`, etc.) → capped at
  `max-width: var(--measure-post)` and centered (`margin-inline: auto`). This keeps text at the
  readable post measure.
- Aligned image figures break out, using the pane width via `100%` (NOT `vw`/`cqw`):
  - `.align-wide` → `width: min(var(--measure-page), 100%); margin-inline: auto;`
  - `.align-full` → `width: 100%;`
  - `.align-left` → `float: left; max-width: 50%;` (+ existing margins)
  - `.align-right` → `float: right; max-width: 50%;`
  - `.align-none` → inherits the per-block measure cap.
- `--measure-post: 38rem`, `--measure-page: 64rem` set on the canvas (match the default theme so the
  editor mirrors it).
- The image toolbar (`.block-props`, already `position:static` inside `.setu-image-block`) stays above
  the figure and must remain visible/usable at `wide`/`full` (verify live — no clipping).
- Generalize: target `.setu-prose > .align-*` (any aligned block), not `figure.setu-image` only — so a
  future layout block carrying `.align-*` inherits breakout. (Image is the only consumer today.)
- Remove the now-superseded editor-only `align-left`/`align-right` img rules where the new rules cover
  them; keep image-specific chrome (toolbar, caption, alt, replace, `.sib-img` base sizing).

> The exact widths/paddings/centering are tuned **live** against the running editor (`:5173`) + the
> published preview — this is a CSS-geometry increment; the model above is the frame, screenshots are
> the proof.

### Site — fix the latent `wide` bug only

`packages/theme-default/site.css`: change `figure.setu-image.align-wide` from `max-width:
var(--measure-page)` to an explicit width so it actually breaks out, e.g.
`width: min(var(--measure-page), calc(100vw - 2rem)); margin-left: 50%; transform: translateX(-50%);`
Keep `full`/`left`/`right`/`none` exactly as today (pixel-identical). Generalize the site's align
selectors to `.prose .align-*` is OPTIONAL/out-of-scope here — keep the change minimal (just the
`wide` fix) to protect the working site; broader site generalization can come with the first non-image
aligned block.

## Data flow / round-trip

Unchanged. The image node already round-trips `align` byte-exact via `mdAttrs`; no `@setu/core`,
markdoc, or node-logic change. This is purely CSS + the `.ed-canvas` geometry.

## Testing & verification

Weighted to no-regression + **visual confirmation** (the done bar for a layout increment, per
[[setu-quality-bar]]):
- **Site no-regression (automated):** the existing site image tests (`apps/site/test/image-align*`,
  `image-markup`, `render`) stay green — they assert markup, which is unchanged. Confirm none assert
  the old `max-width` computed value.
- **Editor (automated, light):** the image node still emits `align-{x}` classes (existing
  `image-block-node` test stays green); optionally assert the editor CSS contains the new
  `.align-wide`/`.align-full` width rules so the breakout can't silently regress.
- **Visual confirmation (manual — the real proof):** on `:5173`, set an image to
  `none/left/right/wide/full` and confirm each breaks out true-to-life; text stays at the post
  measure; the align toolbar stays usable at wide/full. Preview/publish and confirm the **same** block
  looks consistent on the site (and site `wide` now breaks out). This is UAT (owner will verify).
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green.

## Out of scope

- Floating-menu token polish (FormatBubble/TableMenu/Slash/Block) → **PR C2** (next).
- `page` content type / page-wide canvas (sub-project #6); generic `setuBlock.align` UI + non-image
  aligned blocks (land with the first real consumer); any round-trip/contract/`text-align` change.

## Decomposition (for the plan)

1. Site: fix `figure.setu-image.align-wide` to explicit `width` (site no-regression tests green).
2. Editor: rework `.ed-canvas` (full-pane) + per-block measure cap + `.align-*` breakout rules; remove
   superseded left/right img rules; set measures. (Live-tuned; light CSS-presence test.)
3. Verify: full gate + editor-visible UAT pass (image none/left/right/wide/full true-to-life;
   toolbar usable).

Built mostly **directly + live** (editor-visible iteration) rather than blind subagents, per the
hard lesson that breakout geometry can't be verified without looking; per-task review still applies.
