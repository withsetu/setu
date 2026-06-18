# Setu Roadmap / Backlog

> Running list of **deliberately deferred** improvements — things we decided are worth
> doing but chose not to build in the increment where they came up, so we don't forget.
> Newest at the top. When one gets built, move it to the increment's spec and strike it
> here (or delete).

---

## Render / Theme layer

Vision + decomposition: `docs/superpowers/specs/2026-06-17-setu-render-theme-vision.md`
(5 sub-projects; lean frame — default theme + tokens, AI/MCP an accelerant not the identity;
"write once" React core + generated editor/site shells; theme = HTML/CSS/tokens, React sealed).

### ~~Render pipeline #1 — content → static HTML~~ ✅ SHIPPED 2026-06-18 (`7ec53f1`)

`apps/site` (Astro 6 + `@astrojs/markdoc` + `@astrojs/react`) renders committed `.mdoc`
to static HTML (zero JS): standard nodes + callout (one React core + wrapper) + text-align +
sub/sup + checklist + table-column align. **Resolves the deferred render-time mappings**
(text-align + table-column alignment now actually render on the page). Default locale unprefixed
in URLs. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-setu-render-pipeline*`.

### ~~Block component package #2 — one shared callout core~~ ✅ SHIPPED 2026-06-18 (`08f1afd`)

New `@setu/blocks` package holds the callout's **single React visual core** (+ block icons +
variant mapping + token-fallback `callout.css`). The editor node view AND the site wrapper now
render it — the duplicate is gone (deleted `apps/admin/.../callout-variants.ts` +
`apps/site/.../Callout.tsx` + the hardcoded 💡). "Write once" closed. Editor node
definition + round-trip byte-identical (guard green); `react` is a peerDependency; CSS uses
`var(--token, fallback)` (admin themed, site fallbacks — pixel parity follows in #3). Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-18-setu-block-component-package*`.

### ~~Default theme #3a — designed look, token-driven~~ ✅ SHIPPED 2026-06-18 (`bd15af4`)

The Setu site now looks designed: one typographic identity (bold-sans/indigo), a header/footer
shell, **Post (narrow) + Page (wider contained) templates by collection** + a home route — built
entirely from **tokens-with-defaults on `:root`** so it's customization-ready (change a token →
the site restyles). Blocks render themed via those tokens (callout matches the editor). `<html
lang>` carries the entry locale; light-only, zero-JS. Look designed with the owner via the visual
companion. Theme lives in `apps/site` for now. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-18-setu-default-theme*`.

### ~~Theme system #3b — themes as config-activated packages~~ ✅ SHIPPED 2026-06-18 (`246da2a`)

The default theme is now an installable, **config-activated package** (`@setu/theme-default` —
layouts + tokens + styles, extracted from the site). `@setu/core` config gained an optional
`theme` field (additive; round-trip untouched); `apps/site/setu.config.ts` names the active
theme, and the build reads it (`loadConfig`) + aliases `@theme` → the package, so pages render
through whichever theme is configured. **Switch the value + install another theme + rebuild →
different theme.** No visible change (the success criterion — 27 site tests green unchanged); the
render engine (routing/markdoc/block components) stays in the app. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-18-setu-theme-system*`.

### ~~Theme options #3c — declarative options engine + self-hosted fonts~~ ✅ SHIPPED 2026-06-18 (`36aee29`)

The Customizer **engine** (the visual admin panel deferred to the editor→disk bridge). A theme now
**declares its tunable knobs** in `options.ts` (`themeOptions: ThemeOption[]` — accent/font/width/
textSize/corners; the "options API" the owner asked for) + a **pure `optionsToCss(values)`** that
maps chosen values → a `:root:root { … }` override string (fallback-to-default; never emits garbage).
`@setu/core` config gained an additive optional `themeOptions` map (mirrors the 3b `theme` field;
round-trip untouched). The site build threads `setu.config`'s `themeOptions` → pages → templates →
`Layout`, which injects the override as the last `<head>` style — `:root:root` specificity (Astro
puts the bundled theme `<link>` *after* an inline style, so source-order loses). `--accent-strong`
now derives from `--accent` via `color-mix`. **Defaults kept → site looks identical** (engine proven
by tests). **Fonts self-hosted via `@fontsource` on BOTH the site theme and the admin chrome →
runtime Google-Fonts dependency removed repo-wide** (curated 6-font shortlist + JetBrains Mono; each
variable pkg registers `'<Name> Variable'`; only the selected font downloads). Whole repo green
(core 180, blocks 8, theme-default 10 [new], site 30, admin 178), both apps build, zero-JS. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-18-setu-theme-options*`.

**Next render-layer sub-projects (deferred, sequenced):**
- **The visual Customizer panel** (the admin UI for #3c's engine): renders generically from any
  theme's `options.ts` manifest (color picker / font dropdown / width+size+corner selects) with live
  preview, then **Save**. The full WordPress loop (Save → live site changes) needs the **editor→disk
  bridge** to persist the chosen `themeOptions` where the published site reads them — so this lands
  after (or with) that bridge. The engine + manifest are done; this is "render the form + persist."
- **child-theme override** (deferred from 3b, PRD §8): config-based per-component/token override
  (map `Callout → MyCallout.astro`) — the advanced "child theme without forking"; harder dynamic
  per-block resolution; lower priority than 3c.
- **#4 custom-component pipeline + codegen** — the `component.ts` contract fanning out to all
  3 planes; **this is where "tag set sourced from setu.config" lands** (blocked in #1:
  `@astrojs/markdoc`'s config loader can't import core's TS source; codegen runs where it can).
- **#5 in-editor preview** — draft preview through the same theme + components, iframed.
- **permalink + i18n URL scheme** — the full locale-prefixing policy (#1 only strips the
  default `en`; config-driven default + non-default front-prefixing is its own slice).
- **dynamic Markdoc** (`{% if %}`/`{% for %}`/`$vars`) in passthrough — Pro/SSR, long-deferred.

### "View Site" / "View Page" links in the admin — preview vs live aware (added 2026-06-18)

**What (owner ask):** from the admin, give the writer **"View Site"** (site root) and **"View
Page"** (this entry's rendered URL) links. The system should **detect the entry's state and
label/target accordingly** — e.g. a not-yet-deployed entry → a **Preview** link (draft preview),
a deployed entry → **"View Live"** to the published URL.

**Why it's its own item (not trivial):** (a) it needs a **shared permalink util** — the admin
must derive the same URL the site renders (`apps/site/src/lib/url.ts` logic: collection/
locale/slug → URL, default locale unprefixed), so this couples to the deferred **permalink/i18n
scheme**. (b) "preview vs live" keys off the **derived lifecycle** (`deriveLifecycle` →
draft/staged/live) already in the admin — Live → real published URL; Draft/Staged → the **#5
in-editor/SSR preview** route (which doesn't exist yet). So this lands cleanly *after* #3 (a real
site/theme to view) and ideally alongside **#5 preview**. Small UI, but it's the seam that ties
the admin's lifecycle pill to actual rendered URLs.

## Tooling / DX

### ~~Single command to launch all dev servers locally~~ ✅ SHIPPED 2026-06-18 (`371ac42`, with the Local Bridge)

Root `pnpm dev` boots **api + admin + site** together via `concurrently` (labeled api/admin/site,
distinct colors, one-Ctrl-C shutdown, fixed ports api 4444 / admin 5173 / site 4321), wiring
`VITE_SETU_API` into the admin and `SETU_REPO_DIR`/`SETU_API_PORT` into the api. Shipped as part
of the Local Bridge increment (the bridge needs all three running to be usable). See below.

## Backend / Platform

### Editor→disk bridge / multi-topology — make admin + site share one store (added 2026-06-18; topology model refined 2026-06-18)

**The gap (owner noticed during UAT):** the admin and the front-end site are **two separate
content worlds today**. The admin runs entirely **in the browser** — drafts/posts live in
**IndexedDB**, its "git" is in-browser (`db-idb`/`git-idb`, wired in `apps/admin/src/data/Bootstrap.tsx`).
The site (`apps/site`) renders only the **on-disk `.mdoc` fixtures** (Astro globs
`base: './content'` in `src/content.config.ts`). So **publishing in the admin does not appear on
the site**, and vice-versa.

**Verified current state (read the code 2026-06-18 — roadmap's old "already built" list is ACCURATE):**
the **ports + services are real and adapter-agnostic** — `servicesFor(data, git)` composes
publish/read/authoring over ANY DataPort+GitPort (`store.tsx`). `git-local` is a real GitPort over
`isomorphic-git` (`commitFile`/`readFile`/`list`/`headSha`; **NO `fetch`/`pull`/`push` yet**, takes
`{dir,fs}`, dir must have `.git`). The **publish service already compiles draft→Markdoc + commits**
to repo-relative `content/<collection>/<locale>/<slug>.mdoc` AND has a **HEAD-based conflict guard**
(returns `conflict` not clobber). `db-sqlite` (better-sqlite3+drizzle) + `lock-policy` exist.
**The architecture already assumes content at repo-root `content/`** (that's what `contentPath`
emits) — the site is the outlier (reads `apps/site/content/`).

**The multi-topology model (the moat — refined with the owner).** A "topology" is THREE independent
choices, and the services don't care (the ports/adapters payoff), so we never build "a mode" — we
build *adapters*:
1. **Runtime:** Node (laptop *or* self-hosted server — same runtime) | Edge (Cloudflare Worker/Pages).
2. **Git backend:** local `.git` (git-local) | remote GitHub API (`git-github`, future).
3. **Drafts/locks store:** none (in-browser) | SQLite (Node) | D1 (edge).

| Topology | Runs on | Git | Drafts/locks | Adapters | Built? |
|---|---|---|---|---|---|
| **Local dev** (FIRST CUT) | Node, laptop | local `.git` | in-browser | git-local, db-idb | ✅ all exist |
| **Self-hosted** | Node, server | local **or** GitHub | SQLite | + git-github | git-github ❌ |
| **Edge** | Cloudflare | **GitHub (must)** | D1 | + git-github, + db-d1 | both ❌ |

**Anchor:** **remote Git (GitHub) is the eventual single source of truth**; the local clone and the
live site are both *derivatives*. The local admin and a future Cloudflare admin are two faucets
writing the same remote.

**Decisions locked (2026-06-18):**
- **NO git submodule for content.** A submodule pins a SHA → Cloudflare would rebuild *old* content
  until a parent pointer-bump commit; breaks "edit→rebuild→live". Instead: **content in the same
  repo now** (top-level `content/`), and the productized end-state is **"the user's repo holds
  content+config and *depends on* Setu (npm/template)"** — separation without submodule pain.
- **Edge can't use local git** (a Worker has no persistent fs / `.git`) → edge ⇒ GitHub API + D1.
  Kills the "local git + Cloudflare" combo from the owner's list.
- **"local+remote git" / "remote only" are not modes** — they're the one future `git-github` adapter
  (+ an optional push-to-remote sync), added when a topology needs it.

**FIRST CUT — Local topology, "Cut A" ✅ SHIPPED 2026-06-18 (`371ac42`):** only the **GitPort** goes
to a server; drafts stay in-browser. `apps/api` (**Hono/Node**, `createGitApi(git): Hono` over
4 RPC routes) wraps `git-local`; **`@setu/git-http`** (browser-side fetch GitPort, passes the shared
contract in-process against the real routes) talks to it; `Bootstrap.tsx` uses it when
`VITE_SETU_API` is set (else the in-browser path — 178 admin tests untouched). Content moved to
**repo-root `content/`** (Astro glob `base: '../../content'`). `pnpm dev` runs all three. Services/
round-trip untouched; e2e proves publish→git-http→api→git-local→disk. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-18-setu-local-bridge*`.
**Caveats:** `git-local` doesn't follow a git *worktree's* `.git` pointer (use a normal checkout for
`SETU_REPO_DIR`); a fontsource `vite.ssr.noExternal` fix was needed so `astro dev` renders themed
routes (3c regression, build-only verification had masked it).

**Known v1 limitations to STATE (not discover):** (a) **drafts don't travel** across devices/admins
(in-browser) — publish before switching; (b) **"local behind remote"** needs git-local `fetch`/`pull`
(not built) — only matters once a 2nd faucet exists; (c) **concurrent-editor conflicts are coarse**
(whole-repo HEAD guard) until the `lock-policy` is wired to a shared DB; (d) edge needs a
**server-side GitHub token** + build-latency UX ("live in ~30s"). None block the first cut.

**NEXT adapters/increments (each = swap an adapter, zero service rewrites):** **Cut B** — server-side
drafts/locks via `db-sqlite` over HTTP (drafts travel across devices; real edit-locks via the
`lock-policy`); **`git-github`** GitPort (unlocks self-hosted-remote + remote-as-source-of-truth +
edge); **`db-d1`** + Cloudflare Worker/Pages runtime (the edge topology); git-local
`fetch`/`pull`/`push` (the "local behind remote" sync once a 2nd faucet exists); auth/tokens for any
non-local API. **The "View Site/View Page" preview-aware links are now unblocked** (a real site +
publish flow exist).

## Editor

### Editor feature wishlist — sequenced by content-model constraint (added 2026-06-16)

Owner dumped a feature wishlist during UAT of the enriched bubble. The gating factor is
**not** "add the Tiptap extension" — it's that **every new node/mark must round-trip through
Markdoc or it silently drops on publish** (the content-safety cardinal rule), plus a few need
the media backend or are render-time, plus a couple may be Tiptap **Pro** (Setu is 100% OSS →
build-our-own if so). Grouped by that constraint:

### ~~Bubble v2 — Turn-into regroup + subscript/superscript + checklist~~ ✅ SHIPPED 2026-06-17 (3 slices)

- slice 1 (`53019b7`): Turn-into dropdown regrouped into categories (Heading → levels, List →
  bullet/numbered/checklist, Quote, Code, sub/sup together).
- slice 2 (`96f1fd5`): **Subscript/Superscript** marks — inline `{% sub %}`/`{% sup %}` Markdoc
  tags (the `node.inline = true` round-trip finding); + surfaced block-type shortcuts.
- slice 3 (`87aa69b`): **Checklist** (TaskList/TaskItem, GFM `- [ ]`/`- [x]`) **+ list-wide
  nesting** (recursive converter both directions; bullet/numbered/checklist, mixed, unlimited
  depth). **Note: GFM task lists needed NO Markdoc tokenizer work** — Markdoc treats `- [ ]` as a
  bullet with literal text and round-trips all nesting byte-clean, so all logic lives in our
  converter. Underline remains deferred (same inline-tag pattern available to reuse).

**New nodes/marks needing `@setu/core` converter work first:**
- ~~**Tables**~~ ✅ SHIPPED 2026-06-17 (`276762d`): GFM pipe tables with per-column alignment.
  Core writes tables itself (`tableToGfm`) since Markdoc.format drops alignment; Markdoc stays the
  reader. `@tiptap/extension-table` (pinned 3.26.1) + cell `align` attr, slash insert, icon action
  menu, Tab/Shift-Tab cell nav + Tab-at-last-cell adds a row. No merged cells / resize / block-in-cell
  (GFM can't represent). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-setu-tables*`.
- ~~**Text align**~~ ✅ SHIPPED 2026-06-17 (`8b42924`): L/C/R for paragraphs + headings via a Markdoc
  **node annotation** `{% align="center" %}` (read from `attributes.align`, written via the built
  node's `.annotations`; left emits nothing). `@tiptap/extension-text-align` + an L/C/R bubble group.
  Distinct from table-column alignment. Published-site rendering deferred to the render pipeline.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-17-setu-text-align*`.
- **Text direction (RTL/LTR)** → `dir` attr; niche; same representation question — can reuse the
  node-annotation pattern established by text-align.

**Needs the media / render backend:**
- **Images** → Markdown `![alt](src)` round-trips, BUT image **upload** (where bytes go) needs the
  deferred **`ImagePort`/media pipeline** (PRD). Insert-by-URL is easy; upload is the real work.
  NOTE: the Tiptap **"image-node-pro"** UI component name suggests Pro — verify before use.
- **Code syntax highlighting** → code blocks already round-trip; highlighting is editor-DISPLAY via
  `@tiptap/extension-code-block-lowlight` (free MIT) + lowlight; main round-trip need is persisting
  the **language** (fence info string). Mostly additive/low-risk.

**Render-time / navigation (+ licensing to verify):**
- **Table of contents** → generated from headings, typically a render/theme concern, not stored
  content. The Tiptap ToC sits near **Pro** — VERIFY licensing; if Pro, build our own (it's a
  heading walk) or make it a theme/render feature.

**Licensing (HARD RULE, partially verified):** free MIT — Table, TextAlign, Subscript, Superscript,
TaskList, CodeBlockLowlight, Image. **To confirm not Pro-gated before committing:** Table-of-Contents,
the "image-node-pro" component.

### ~~Toolbar keyboard model — roving arrow nav + Esc-to-leave~~ ✅ SHIPPED 2026-06-16 (enriched bubble)

Done in the enriched-bubble increment (`974f1b5`): `useToolbarRoving` roving-tabindex (←/→ +
Home/End) on the format bubble + the callout style toolbar; Esc leaves (bubble collapses the
selection; callout returns the caret to its body).

**Why deferred (decided with owner):** build the bubble's full keyboard model **once, together
with the enriched format bubble** — that increment adds many more controls (headings/lists/
quote/color/…), which is exactly when arrow-navigation earns its keep and the focus order needs
designing as a whole. Doing it piecemeal now would be redone when the button set changes.

**Touches:** `FormatBubble.tsx` (roving tabindex + arrow handler on the `role="toolbar"`),
the callout node-view toolbar (`Callout.tsx`), Esc-to-leave wiring (reuse `dismiss.ts`).

### Per-link attributes — "open in new window" + `nofollow` (deferred 2026-06-16)

**What:** let a writer set, per link: **open in a new window** (`target="_blank"` + `rel="noopener"`) and **`nofollow`** (and likely its cousins `sponsored` / `ugc` later). Surfaced while designing the format bubble / link card increment.

**Why deferred (not just UI):** standard Markdown links `[text](url)` **cannot carry `target` or `rel`**, so supporting these means **extending the Markdoc link representation in the core round-trip** (`packages/core/src/markdoc/`) — e.g. attributed links serialize as a `{% link href=… target=… rel=… %}` tag while plain links stay clean `[text](url)` — plus round-trip tests (content-safety / cardinal rule), and eventually the renderer applying them. That's content-model work in `@setu/core`, deliberately kept out of the editing-*feel* increment. Do it as its own tight slice.

**Note:** **"noindex" is NOT per-link** — it's a **page-level** directive (robots meta / `X-Robots-Tag`) that belongs in the SEO feature set (PRD §5), not on individual links. Per-link we only model `target` + `rel`.

**Touches:** `@setu/core` markdoc converter (both directions) + round-trip tests; the link card / bubble UI (attribute toggles); later, the SSG/SSR renderer.

### Underline round-trip support (deferred 2026-06-16)

**What:** StarterKit v3 bundles an **Underline** mark, but the Markdoc round-trip
(`packages/core/src/markdoc/`) doesn't serialize underline (Markdown has no underline) — so it
would silently drop on publish. We **disabled underline** in the format-bubble increment
(`underline: false`) to avoid content loss. To offer underline later: extend the converter
(e.g. an `{% u %}` tag or HTML passthrough) + round-trip tests, then re-enable the mark and add
a bubble button.

**Touches:** `@setu/core` markdoc converter + round-trip tests; StarterKit config; the format
bubble.

---
