# Block Library — Foundation B (Block Source Merge + First Core Block) — Design Spec

**Status:** Approved design, ready for implementation plan
**Date:** 2026-06-22
**Feature ID:** Block Library program, sub-project #1b

## Goal

Prove the program's central architecture thesis end-to-end: **the block
*contract* is canonical in core, the *renderer* belongs to the theme, and a
single override order resolves which renderer wins.** Concretely:

1. A block contract can be defined as a **standard block in `@setu/core`** (not
   only as a site-local `blocks/` folder).
2. `@setu/blocks` ships a **deliberately-plain default renderer** for a standard
   block.
3. A **theme can override that renderer** per tag without redeclaring the
   contract.
4. A single **precedence resolution** picks, per tag, the winning contract and
   the winning renderer across the three sources (core standard → theme →
   site-local `blocks/`).
5. Ship the **first canonical core block — `button`** — through this pipeline as
   the working proof.

This keeps Git-stored Markdoc content **portable across themes**: the standard
block vocabulary lives in core, themes vary only presentation. The
theme-author-owned-contract model (WordPress lock-in) is what this avoids.

## Scope decision

The full block library is a multi-subsystem **program** (see Foundation A's
roadmap). This spec is **Foundation B only**, and within Foundation B it is
deliberately scoped to a **minimal vertical slice** that proves the
core→theme→site override without building a second discovery path.

Explicitly **in scope:**

- Standard block contracts living in `@setu/core` (`STANDARD_BLOCKS`).
- A pure `resolveBlockSources()` precedence resolver in `@setu/core`, with
  **contract and renderer resolved independently per tag**.
- A plain default `.astro` renderer for a standard block in `@setu/blocks`.
- A theme-provided renderer override in `@setu/theme-default`, detected by
  convention.
- Wiring the three existing discovery flows (admin glob registry, `gen-blocks`
  codegen, site runtime) to consume standard blocks + the resolver.
- The first core block, `button`, end-to-end: contract, round-trip, default
  renderer, theme override, neutral editor node.
- Adding `packages/core/src/blocks` to `tsconfig.edge.json` so the contract +
  resolver layer is CI-enforced edge-safe.

Explicitly **out of scope** (named so reviewers don't flag their absence):

- **Theme-adds-bespoke-blocks** (a theme contributing *new* block contracts, not
  just renderer overrides). This is mechanically a second discovery path against
  a different source directory; it proves nothing new architecturally and is
  deferred until a theme actually needs it.
- The **block inspector** (structured side-panel prop editing) — sub-project #4.
- **Theme-accurate WYSIWYG** rendering inside the editor canvas (the editor uses
  a neutral node view here).
- **Editor width / breakout** for layout blocks (sub-project #3); the `button`
  carries no alignment/size prop in this slice.
- Any **second core block** or marketing/layout blocks.

## Architecture decisions inherited (from Foundation A ADR)

- **Two block shapes.** *Shape A* = structured, props-driven, theme-rendered, no
  nesting. *Shape B* = layout containers holding arbitrary blocks. `button` is
  **Shape A** (its body is inline label text, not arbitrary nested blocks).
- **Contract in core, renderer in theme.** Honored here, with the practical
  refinement below (default renderer in `@setu/blocks`, not literally in
  `@setu/core`).
- **Block source merge order:** core standard → active theme (overrides renderer
  per tag) → site-local `blocks/` (overrides both). Implemented here.

## Global constraints

- **Cloudflare-Pages / edge compatible.** The contract + resolver layer in
  `@setu/core` must compile under `tsconfig.edge.json` — pure data, zod, and a
  pure function only; no React, no DOM, no `.astro`.
- **Backward compatible.** Existing site-local `blocks/` (callout, notice) keep
  working unchanged; they simply become the highest-precedence tier. A tag that
  exists only as site-local resolves exactly as today.
- **No packaging changes.** No move of the repo-root `blocks/` directory (that
  deferral stands). Standard blocks and default renderers ship inside existing
  workspace packages (`@setu/core`, `@setu/blocks`) that are already resolvable
  by the three flows' existing resolver patch points.

---

## Where the default renderer lives (the key fork — decided)

`@setu/core` is deliberately edge-safe TS — no `.astro`, no Astro dependency. So
the "core ships a plain default renderer" ADR is satisfied **in spirit** by
splitting along nature, not package name:

- **`@setu/core`** → block *contracts* only (zod props + editor meta + category)
  and the pure resolver. Stays pure and edge-safe.
- **`@setu/blocks`** → the *default* `.astro` renderers. This package already
  owns block presentation (Callout/Notice React cores + CSS), so it is the
  natural home for the plain default renderer.
- **theme packages** → override renderers.

This sidesteps putting `.astro` into the edge-safe core entirely.

### Core vs. site-local blocks differ in renderer model

`callout`/`notice` are site-local blocks with a **single shared visual core**
(React in `@setu/blocks`) reused by both the editor node view and the site
`.astro`. A **core block with per-theme renderers deliberately has no single
shared visual** — that is the entire point. Consequences:

- Its **editor node view is a neutral editing affordance** (auto-form from the
  contract + inline-editable label), not a theme-accurate preview.
- The **theme owns the real look**; the `@setu/blocks` default is only the
  fallback when no theme (or a barebones theme) provides an override.

---

## The precedence resolver (`@setu/core`)

**File:** `packages/core/src/blocks/resolve-sources.ts` (new) — a **pure
function**, the single source of merge truth that the three flows call instead
of each re-implementing precedence.

Resolution is **per tag, contract and renderer chosen independently:**

- **contract(tag)** = site-local → else standard.
  (Theme does not define contracts this slice.)
- **renderer(tag)** = site-local `<tag>.astro` → else theme `blocks/<tag>.astro`
  → else `@setu/blocks` default `.astro`.

Independent selection is the portability guarantee: a theme overriding the
renderer **must not** have to redeclare the contract.

```ts
export interface StandardBlockSource {
  tag: string
  contract: BlockContract       // from @setu/core src/blocks/standard
  defaultRenderer: string       // ref to the @setu/blocks default .astro
}

export interface LocalBlockSource {
  tag: string
  contract: BlockContract
  renderer: string              // blocks/<tag>/<tag>.astro
}

export interface ResolvedSiteBlock {
  tag: string
  contract: BlockContract       // winning contract (local > standard)
  attributes: MarkdocAttributes // derived from the winning contract
  renderer: string              // winning renderer (local > theme > default)
}

export function resolveBlockSources(input: {
  standard: StandardBlockSource[]
  local: LocalBlockSource[]
  /** tags the active theme provides a renderer for, → renderer ref */
  themeRenderers: Record<string, string>
}): ResolvedSiteBlock[]
```

The **admin** uses a renderer-agnostic slice — it only needs the merged contract
set (local > standard) for the slash menu, editor nodes, and `knownBlockTags`;
theme overrides are invisible to it. This can be the same function with empty
`themeRenderers`, or a thin `resolveBlockContracts({ standard, local })` helper
that the full resolver also calls. Either way the **precedence rule is written
once.**

`renderer` refs are opaque strings the caller interprets: the site `gen-blocks`
flow maps each to a path Astro's `component()` can import; the admin ignores
them.

---

## The three discovery flows, after

### Admin registry — `apps/admin/src/blocks/registry.ts`

Today globs `blocks/*/block.ts`. Change: merge `STANDARD_BLOCKS` (imported from
`@setu/core`) with the glob results; **local overrides standard by tag**.
Renderer-agnostic.

Effects:
- `button` appears in the slash menu under **Layout** (its category).
- `button` is in `knownBlockTags`, so the round-trip treats it as a known tag.
- `button` renders in the editor via the **neutral generic block node view**
  (auto-form from the contract; inline-editable body for the label). No bespoke
  editor component this slice.

> **Dependency note:** this relies on the generic block node view from the
> auto-discovery work (#4 Slice B). The implementation plan must confirm the
> generic node handles a body-bearing standard block; if a gap exists, the
> fallback is a minimal bespoke `button` node — but the contract-driven generic
> path is preferred.

### Site codegen — `scripts/gen-blocks.mjs`

Today scans `blocks/` and emits `markdoc.blocks.generated.mjs`. Change:

1. Load `STANDARD_BLOCKS` from `@setu/core` (via the existing jiti alias).
2. Load local blocks from `blocks/` (as today).
3. Read the active theme from `setu.config.ts` (`loadConfig(...).theme`,
   defaulting to `@setu/theme-default`).
4. **Convention-detect** theme renderer overrides: for each standard tag, try to
   resolve `<themePkg>/blocks/<tag>.astro`; if resolvable, the theme overrides
   that tag's renderer.
5. Call `resolveBlockSources({ standard, local, themeRenderers })`.
6. Emit the generated config: each tag → `component(<winning renderer path>)` +
   `attributes` from the winning contract.

Renderer path emission:
- **site-local** → relative path as today (`../../blocks/<tag>/<tag>.astro`).
- **theme / default** → a resolved package path the generated config can import.
  `fs.allow: ['../..']` already permits repo-root + workspace access; the
  implementation plan verifies whether Astro `component()` accepts a package
  specifier directly or needs an absolute resolved path, and picks the form that
  works.

### Site runtime

Unchanged. Astro renders whatever `markdoc.blocks.generated.mjs` points each tag
at.

---

## Theme renderer convention

A theme package exposes block renderers by **convention**: it ships
`blocks/<tag>.astro` and exports them in its `package.json` `exports`
(e.g. `"./blocks/button.astro": "./blocks/button.astro"`). Presence of a
resolvable `<themePkg>/blocks/<tag>.astro` = an override for that tag. No
manifest field is introduced (lighter, and consistent with how `Layout.astro`
etc. are already exposed). `@setu/theme-default` ships `blocks/button.astro`.

---

## The `button` block, concretely

- **Tag:** `button`  **Category:** `layout`
- **Markdoc shape (body-bearing — label is the body):**
  ```
  {% button href="/signup" variant="primary" %}Get started{% /button %}
  ```
  Body-bearing reuses the proven callout/notice round-trip path (lower risk than
  a bodyless tag) and gives an inline-editable label in the editor.
- **Props (zod):**
  - `href: string`
  - `variant: z.enum(['primary', 'secondary']).default('primary')`
  - (No alignment/size — deferred to width/breakout, sub-project #3.)
- **Editor meta:** `label: 'Button'`, `group: 'layout'`,
  `keywords: ['btn', 'cta', 'link']`, and a CTA-appropriate `icon` that is
  already a registered `IconName` in the admin icon map (the plan confirms
  availability and picks one; `link` exists today as a safe fallback).
- **Default renderer** — `@setu/blocks` `src/button/Button.astro`:
  `<a href={href} class={`setu-button setu-button--${variant}`}><slot /></a>`
  with a minimal **unbranded** `button.css` (padding, border, no theme color).
- **Theme override** — `@setu/theme-default` `blocks/button.astro`: same markup,
  styled with theme tokens (`--accent`, radius, etc.).

The default theme **does** provide the override, so the normal site path renders
the themed button; removing the override falls back to the `@setu/blocks` plain
default — both tiers are exercised and tested.

---

## Files

**Create:**
- `packages/core/src/blocks/standard/button.ts` — the `button` standard
  contract.
- `packages/core/src/blocks/standard/index.ts` — `STANDARD_BLOCKS` array.
- `packages/core/src/blocks/resolve-sources.ts` — the pure resolver.
- `packages/blocks/src/button/Button.astro` + `button.css` — plain default
  renderer.
- `packages/theme-default/blocks/button.astro` — theme override.
- Tests: `packages/core/src/blocks/resolve-sources.test.ts`,
  `packages/core/src/blocks/standard/button.test.ts`, and round-trip + admin
  registry + gen-blocks tests (see Testing).

**Modify:**
- `packages/core/src/index.ts` — export `STANDARD_BLOCKS`, `resolveBlockSources`
  (+ types).
- `packages/core/tsconfig.edge.json` — add `src/blocks` to `include`.
- `packages/blocks/package.json` — export `./button.astro`, `./button.css`.
- `packages/theme-default/package.json` — export `./blocks/button.astro`.
- `apps/admin/src/blocks/registry.ts` — merge `STANDARD_BLOCKS` with the glob
  (local wins).
- `scripts/gen-blocks.mjs` — load standard blocks, detect theme renderers, call
  the resolver, emit resolved renderer paths.

---

## Testing

**Pure resolver — `resolve-sources.test.ts`:**
- Tag union across standard + local.
- Contract precedence: a tag present in both local and standard resolves to the
  **local** contract.
- Renderer precedence: local `.astro` > theme `.astro` > `@setu/blocks` default.
- **Theme overrides renderer without redeclaring contract:** a standard tag with
  a theme renderer resolves to `{ contract: standard, renderer: theme }`.
- A standard-only tag with no theme override resolves to the default renderer.

**Button contract — `standard/button.test.ts`:**
- Zod validates `href` + `variant` (default `'primary'`).
- Markdoc attributes derive correctly (the existing `markdocAttributesFor`).

**Round-trip:**
- `{% button href="…" variant="…" %}label{% /button %}` round-trips byte-clean.

**Admin registry:**
- Merged registry includes `button`; local overrides standard on tag collision.
- Slash model places `button` under the **Layout** group.
- `knownBlockTags` includes `button`.

**gen-blocks / site (integration):**
- With the theme override present, the generated config points `button` at the
  **theme** renderer.
- With the theme override removed, it points at the **`@setu/blocks` default**
  (proves the fallback tier).
- The site builds; `button` renders (themed) on a page that uses it.

Existing block behavior (callout, notice insert + round-trip + render) must stay
green — they are unchanged, now resolved as the highest-precedence (site-local)
tier.

## Open questions

None blocking. The one implementation-time verification (does Astro
`component()` take a package specifier or need an absolute resolved path for
theme/default renderers) is a mechanical detail for the plan, with a known
fallback (resolve to an absolute path).
