# Block styling contract

> **What this is:** the reference for the CSS custom-property vocabulary standard blocks are
> allowed to read, why it exists, and the rules a block author (human or agent) follows. Read
> this before writing or reviewing CSS for a block in `packages/blocks/src/` or in a site-local
> `blocks/<tag>/` folder.
>
> **Source of truth for the vocabulary itself:** `packages/blocks/src/tokens.ts` (the
> `BLOCK_TOKENS` array). This document explains it; the array enforces it. If they ever
> disagree, the array wins — file a doc fix.

---

## Purpose

Block CSS reads a fixed, named vocabulary of CSS custom properties — never a raw hex value,
never an ad-hoc one-off variable name. A theme re-skins every block at once by overriding those
same names in its own `:root`, and nothing else has to change. This is what keeps content
portable across themes: the *contract* (the token names, what they mean, and the rule that a
block may only read them) lives in `@setu/core`'s sibling package `@setu/blocks`, while the
*renderer* — the actual look — is theme-owned. A post written today should look right under
tomorrow's theme, and a theme author should be able to re-skin all 20+ blocks by touching one
`:root` block, not by patching every block's CSS.

---

## The token vocabulary

19 tokens across 6 style axes. Every token is defined with a themeless-safe default in
`packages/blocks/src/tokens.css`; a block reads a token with no inline `var(--x, fallback)` —
the base layer guarantees the name always resolves.

| Token | Axis | Meaning | Default |
| --- | --- | --- | --- |
| `--accent` | accent | Primary brand / action color | `#4f46e5` |
| `--accent-strong` | accent | Darker accent (hover, emphasis) | `color-mix(in oklch, var(--accent) 82%, black)` |
| `--accent-soft` | accent | Tinted accent surface | `color-mix(in oklch, var(--accent) 12%, transparent)` |
| `--on-accent` | accent | Foreground on an accent fill | `#ffffff` |
| `--bg` | surface | Page background | `#f7f7f8` |
| `--surface-2` | surface | Raised/secondary surface | `#fbfbfc` |
| `--canvas` | surface | Card/content surface | `#ffffff` |
| `--border` | surface | Hairline border | `#e8e8ec` |
| `--text` | text | Primary text | `#1a1a1f` |
| `--text-2` | text | Muted/secondary text | `#54545d` |
| `--green` | tone | Success tone | `#15935a` |
| `--green-soft` | tone | Success tinted surface | `color-mix(in oklch, var(--green) 12%, transparent)` |
| `--amber` | tone | Warning tone | `#b7791f` |
| `--amber-soft` | tone | Warning tinted surface | `color-mix(in oklch, var(--amber) 14%, transparent)` |
| `--red` | tone | Danger tone | `#d1453b` |
| `--red-soft` | tone | Danger tinted surface | `color-mix(in oklch, var(--red) 11%, transparent)` |
| `--r-sm` | radius | Small corner radius | `6px` |
| `--r-md` | radius | Medium corner radius | `10px` |
| `--font-ui` | typography | UI / block font family | `ui-sans-serif, system-ui, sans-serif` |

Names are unprefixed and shared by three consumers that must agree on them: block CSS
(`@setu/blocks`), the editor canvas (`apps/admin`), and themes (`theme-default` and any custom
theme). That's the whole point — one name, three readers, no translation layer.

---

## The three theme-override hatches

A theme (or a site-local override) can re-skin a block at three different depths, in order of
how often you'll actually reach for them:

**(a) Override tokens — the ~80% path.** Redeclare a subset of the 19 names in the theme's own
`:root`, after importing the base layer. This is all `theme-default/theme.css` does:

```css
@import '@setu/blocks/tokens.css';

:root {
  --r-md: var(--radius-base);
  --r-sm: calc(var(--radius-base) * 0.6);
  --font-ui: var(--font-body);
}
```

Every block that reads `--r-md` or `--font-ui` re-skins automatically — no block CSS changes.
Most theming work should stop here.

**(b) Target the namespaced classes.** Every block renders under a stable, namespaced class —
`.setu-<block>` (e.g. `.setu-button`) or `.blk-<block>` (e.g. `.blk-callout`, `.blk-hero`), plus
block-local element classes like `.blk-hero-headline`. A theme can write CSS against these
classes directly for a look the token vocabulary doesn't cover (a layout tweak, a breakout rule,
a hover treatment) without forking the block. `theme-default/site.css` does exactly this for the
hero's width breakout (see below) and the image block's `.align-wide`/`.align-full`.

**(c) Replace the renderer entirely.** A site can supply its own component + CSS for a given
block tag in a site-local `blocks/<tag>/` folder (auto-discovered — see root `CLAUDE.md`),
shadowing the core-shipped version outright. This is the escape hatch of last resort: it opts out
of the shared contract for that one tag, so use it when a block needs to diverge structurally, not
just cosmetically. Because the contract lives in `@setu/core`/`@setu/blocks` rather than being
baked into any one theme, content written against a standard block tag stays portable even if a
site later replaces the renderer — the Markdoc source doesn't change, only which component
renders it.

**Merge order:** core standard → active theme → site-local `blocks/`. The two hatches above sit
on different mechanisms, not one uniform cascade:

- **Tokens (hatch a) genuinely cascade.** `theme-default/theme.css` imports
  `@setu/blocks/tokens.css` first, then its own `:root` block runs after — same-specificity CSS,
  later wins — so a theme's token overrides beat the base defaults, and `site.css` loads after
  `theme.css` for a further site-specific layer on top of that.
- **A block's component + CSS (hatch c) is a full shadow, not a cascade.** A site-local
  `blocks/<tag>/` folder with the same tag name excludes the core standard block of that tag from
  the registry entirely — whichever one is picked (site-local wins on a collision) supplies both
  the component *and* its CSS; the other's CSS is simply never loaded, not overridden by it.

---

## Authoring rules for a standard block

If you're writing or reviewing CSS for a block in `packages/blocks/src/<block>/`, follow these
rules. They're grounded in the three shipped blocks (`button`, `callout`, `hero`) and enforced
by the test guard below.

- **Read contract tokens, never hardcode brand values.** `background: var(--accent)`, not
  `background: #4f46e5`. The only literal hex values a block may write are the neutrals `#fff` /
  `#ffffff` / `#000` / `#000000` — e.g. `callout.css`'s `.tone-slate` sets `color: #fff` on a dark
  computed fill, which isn't a brand color, it's a contrast neutral.
- **Namespaced classes.** Root element gets `.setu-<block>` or `.blk-<block>`; internal parts get
  `.blk-<block>-<part>` (`.blk-hero-headline`, `.blk-hero-media`). This is what makes hatch (b)
  above possible — a theme has a stable selector to target.
- **Global CSS, not Astro-scoped.** Block stylesheets are plain global `.css` files, not
  Astro's `<style>` scoped blocks. Scoping would hash the class names and hide them from theme
  CSS, breaking hatch (b) entirely. A theme has to be able to write `.prose .blk-hero.w-full { … }`
  and have it win.
- **Structural vs. themeable is a real split — spacing is structural, not tokenized.**
  Padding and margins are block-owned structure (e.g. `callout.css`'s `padding: 15px 16px`,
  `hero.css`'s `padding-block: clamp(2rem, 6vw, 4rem)`), not read from a token. This is
  intentional, not an oversight: there is no spacing-scale axis in `BLOCK_TOKENS` yet (see
  "What's intentionally not here" below).
- **Breakout lives in the theme, not the block.** A block widening past its column (Gutenberg's
  wide/full align) is layout-context-specific — it depends on the page's measure, gutter, and
  grid, which only the theme knows. The block itself only marks *intent* via a class
  (`.blk-hero.w-wide`, `.blk-hero.w-full`) and does the minimum block-local adjustment (e.g.
  dropping its own corner radius on full-bleed); the actual breakout math —
  `width: min(var(--measure-page), calc(100vw - 2rem)); margin-left: 50%; transform:
  translateX(-50%);` — is written once in `theme-default/site.css` against `.prose .blk-hero.w-wide`
  / `.w-full`, mirroring the pattern already proven by the image block's `.align-wide`/`.align-full`.
  Don't put breakout math in block CSS — it was tried for the hero and had to be pulled back out
  into the theme.
- **`--blk-<block>-*` for block-local computed values.** Values that are derived per-instance
  from a prop (not part of the shared contract) get a block-scoped custom property name and are
  exempt from the token contract — e.g. `--blk-hero-scrim` and `--blk-hero-text-color` in
  `hero.css`, set inline by the component from the `scrim`/`textColor` props. Unlike contract
  tokens, these **keep their inline fallback** (`var(--blk-hero-scrim, rgba(15, 17, 26, 0.55))`)
  because nothing guarantees an inline style sets them — there's no base-layer definition to fall
  back on.

---

## Enforcement

`packages/blocks/test/token-contract.test.ts` runs in CI and enforces the contract mechanically
so it can't silently drift as more blocks land:

- **Every `BLOCK_TOKENS` entry must be defined in `tokens.css`** — a definition (`--accent:`),
  not merely referenced. Adding a token to the vocabulary without giving it a default fails CI.
- **Every block CSS file may only read a declared contract token or a `--blk-*` local.** The
  test globs every `.css` file under `packages/blocks/src/` (excluding `tokens.css` itself, which
  is allowed to define literals), strips comments, extracts every `var(--...)` read, and fails if
  any name isn't in `BLOCK_TOKENS` and doesn't start with `--blk-`. This is what stops a new block
  from inventing a one-off variable name instead of using — or proposing an addition to — the
  shared vocabulary.
- **No block CSS may hardcode a color literal** other than the allowed neutrals
  (`#fff`/`#ffffff`/`#000`/`#000000`). Any other hex value fails the test, forcing the author to
  route it through a token.

---

## What's intentionally NOT here (yet)

Three things are deliberately out of scope for this contract, not oversights:

- **A spacing-scale token axis.** Padding/margin values stay block-owned structure (see
  "Authoring rules" above) rather than themeable tokens, until there's real pressure to make
  spacing a theme-level knob.
- **An auto-CSS `supports`-style generator.** Gutenberg's `supports` mechanism lets a block
  declare a themeable axis and have the framework auto-generate both editor controls and CSS.
  Setu already auto-generates editor *controls* from a block's zod schema (the control registry).
  Auto-generating *CSS* from declared axes is deferred — its only real payoff is an MCP agent
  that can introspect "this block is themeable on `accent`/`radius`" and act on it, and there's no
  MCP consumer yet. The forward hook is already in place: `BlockEditorMeta.style.themeable` (an
  array of `BlockStyleAxis` — `'accent' | 'surface' | 'text' | 'tone' | 'radius' | 'typography'`)
  in `@setu/core`'s block contract type, carried as data today and not enforced at runtime.
- **A `theme.json`-style config or Global-Styles GUI.** Setu theme authors are developers (or
  AI agents) who edit theme CSS directly; a click-to-configure GUI is the wrong interface for
  that audience, not a missing feature.

All three are sequenced to the block/MCP epic ([#301](https://github.com/withsetu/setu/issues/301)).
The full design reasoning — why the token vocabulary is "the load-bearing half" of a
Gutenberg-style system, and why the rest is deferred rather than skipped — is recorded in
[issue #369](https://github.com/withsetu/setu/issues/369). See also the architecture note:
[Block theming: token contract now, supports sequenced, no GUI](architecture.md#block-theming-token-contract-now-supports-sequenced-no-gui).
