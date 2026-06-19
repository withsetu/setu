# Block auto-discovery + registration codegen — Slice A (the write-once plumbing)

**Date:** 2026-06-19
**Status:** proposed (owner reviewing)
**Sub-project:** render/theme **#4**, reframed. *Not* the shelved HTML/Liquid template system —
this is the **DRY single-source plumbing**: define a block once as a self-contained folder, and the
build fans it out to every plane. Components stay plain **Astro** files (full power, islands for the
rich 10%). The shelved template-engine work is recorded in the deferred
`2026-06-19-setu-html-yaml-blocks-skeleton-design.md`.

## Goal

A content block is defined **once**, as a self-contained folder:

```
blocks/callout/
  block.ts        # the contract: props (zod) + editor meta + optional scope
  callout.astro   # the render — a real Astro component (full Astro power)
```

A discovery scan turns `blocks/*` into the block **registry**. That registry — not a hand-maintained
`setu.config.blocks` array — is the single source for all three planes:

1. **Editor** — slash menu + the round-trip's known-tag set read the registry.
2. **Round-trip** — `knownBlockTags` comes from the registry.
3. **Site** — a build-time **codegen** step derives `markdoc.config`'s tag registrations from the
   registry (the one plane that needs codegen, because Astro's Markdoc loader can't import core's TS).

**No central list, no hand-mirrored `markdoc.config`.** Change a block in one place — its folder — and
every plane follows.

> **Scope honesty:** this slice is *plumbing*. Its proof is that **`callout` migrates into a folder
> with zero behavior change** — same editor node, same render, same round-trip — but its registration
> is now folder-sourced and its `markdoc.config` entry is generated. The "drop a *brand-new* folder
> and it just works in the editor" payoff needs the generic node from **Slice B** (see Deferred); this
> slice deliberately stops at one block (callout) to keep the round-trip honest.

## Verified before designing (standing rules)

- **Rule #1 (read the source):** confirmed the round-trip runs in `read-service.ts` as
  `markdocToTiptap(body)` with no tags (falls back to `defaultKnownBlockTags`); `configSchema.blocks`
  is required; `@setu/core/node`'s `loadConfig` already loads TS via jiti (so a codegen step can load
  TS block contracts the same way); `markdoc.config.mjs`'s own comment names this the "#4 codegen"
  wall.
- **Rule #2 (Cloudflare + cost):** all new work is **build-time only** (a scan + codegen in
  `predev`/`prebuild`). The published site stays 100% static; **zero per-visitor function cost**. No
  new runtime/edge surface.

## The block folder convention

`blocks/<tag>/` at the **repo root** (the same place an end-user scaffold keeps blocks):

- **`block.ts`** — default-exports `defineBlock({ props, editor?, scope? })`. The `tag` defaults to
  the folder name; the `component` defaults to the sibling `<tag>.astro`. Authored in TS so the zod
  `props` are reused verbatim — no second schema language, fully DRY. (A no-code `block.yaml` variant
  is a later, untrusted-tier concern; out of scope.)
- **`<tag>.astro`** — the render component for the site. Imports anything it needs (`@setu/blocks`,
  the theme). For callout this is the current `CalloutWrapper.astro`, relocated.

```ts
// blocks/callout/block.ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    type: z.string().optional(),
    title: z.string().optional(),
    icon: z.string().optional(),
  }),
  editor: {
    label: 'Callout', icon: 'info', group: 'Blocks',
    variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
  },
  // scope: ['post', 'page'],   // reserved — parsed & carried, NOT enforced this slice
})
```

## Core — `defineBlock`, the registry, and the codegen helpers

### `defineBlock` + registry types (`@setu/core`, browser-safe)
- `defineBlock(input)` — an identity/validation helper (mirrors `defineConfig`) returning a
  `BlockContract` (`{ props, editor?, scope? }`). It does **not** carry `tag`/`component` — those are
  injected by the scanner from the folder.
- `BlockRegistry` = `ResolvedBlock[]` + `blocksByTag` + `knownBlockTags`, built by a pure
  `buildRegistry(entries)` where each entry is `{ tag, component, contract }`. This reuses the
  existing `ResolvedBlock` shape (`config/types.ts`) plus an optional `scope?: string[]`.

### `markdocAttributesFor(props)` (`@setu/core`, browser-safe)
Introspects a block's zod `props` → Markdoc attribute descriptors: `ZodString → { type: String }`,
`ZodNumber → Number`, `ZodBoolean → Boolean`, `ZodEnum → String` (with `matches`), peeling
`ZodOptional`/`ZodDefault` (carrying the default through). Throws on an unsupported zod type — the
registration must be honest, not silently lossy. **This is the DRY payoff:** the Markdoc attribute
schema derives from the same zod you already wrote.

### `generateMarkdocTagsInclude(registry)` (`@setu/core/node`)
Returns the source text of `apps/site/markdoc.blocks.generated.mjs`:
```js
// AUTO-GENERATED by scripts/gen-blocks.mjs — do not edit.
import { component } from '@astrojs/markdoc/config'
export const tags = {
  callout: {
    render: component('../../blocks/callout/callout.astro'),
    attributes: { type: { type: String }, title: { type: String }, icon: { type: String } },
  },
}
```
(The `component()` path is repo-root-relative-from-`apps/site`; confirming Astro resolves a path that
escapes the project root is a plan-time check, with `vite.server.fs.allow` as the fallback.)

## The discovery scan — two runtime contexts

The block contract is TS, so each context loads it the native way; **core itself never touches the
filesystem** (stays browser-safe):

- **Editor (`apps/admin`, Vite):** `import.meta.glob('../../../../blocks/*/block.ts', { eager: true })`
  → pair each module's default export with its folder name → `buildRegistry(...)`. Feeds `slashBlocks`
  and the `knownBlockTags` handed to the read-service. (Blocks live outside the admin root → add the
  repo root to `vite.server.fs.allow`, as the deferred plan already noted.)
- **Codegen (`scripts/gen-blocks.mjs`, node):** a thin **jiti** bootstrap (jiti added to the repo
  root, matching core's own usage) scans `blocks/*/block.ts`, builds the registry, and writes the
  generated include via `generateMarkdocTagsInclude`. Runs as `apps/site`'s `predev`/`prebuild`; the
  generated file is gitignored.

The **round-trip** doesn't scan: `read-service` gains an injected `knownBlockTags` (see below).

## Migrations (the heart of the slice)

1. **`read-service`** — accept `knownBlockTags` (via its deps/options) and pass it into
   `markdocToTiptap(body, { knownBlockTags })`. The admin constructs the read-service with the
   registry's tags, so `callout` keeps round-tripping once it leaves `defaultConfig`.
2. **`defaultConfig.blocks` → empty**, and `configSchema.blocks` becomes **optional (default `[]`)**.
   `setu.config.ts` keeps `theme` + `themeOptions`; its `blocks` line is removed. The block source is
   now the folder registry. `defaultKnownBlockTags` is retired (or derives from an empty config) — all
   tag knowledge flows from the registry.
3. **`callout` → `blocks/callout/`**: move `CalloutWrapper.astro` → `blocks/callout/callout.astro`,
   author `blocks/callout/block.ts`, and **delete the hand-authored `callout` entry** in
   `markdoc.config.mjs` (now generated). `sub`/`sup` stay hand-authored (inline Markdoc tags, not
   blocks). The callout **editor node** (`Callout.tsx`) and the `@setu/blocks` React core are
   **untouched** — only its registration/source moves.

After this, `callout` behaves identically; the difference is invisible to a user and total to the
architecture: one folder drives the site registration, the slash menu, and the round-trip.

## The reserved `scope` field

`block.ts` may declare `scope?: string[]` (content types/collections the block is meant for). This
slice **parses and carries it through the registry** but does **not** filter or enforce. It exists so
the future "lock blocks to content types" feature (soft slash-menu filtering first, then careful
publish-time validation that never drops content) is a one-line addition, not a re-architecture. It is
intentionally inert here.

## Error handling

- **Malformed block folder** (no `block.ts`, no `<tag>.astro`, default export isn't a `defineBlock`
  result, unsupported zod type in `markdocAttributesFor`): the scan/codegen throws with the folder
  name and reason → the build fails loudly. A block never silently vanishes.
- **Unknown tag in content** (no matching folder): unchanged — preserved as a passthrough block, so
  content is never dropped.
- **Duplicate tags** across folders: throw (mirrors `resolveConfig`'s existing duplicate-tag guard).

## Testing

- **core:** `defineBlock`/`buildRegistry` (happy + duplicate-tag throw); `markdocAttributesFor`
  (string/number/boolean/enum, optional, default, unsupported→throw); `generateMarkdocTagsInclude`
  (emits the expected `component()` + attributes); `read-service` honors an injected `knownBlockTags`.
- **scripts:** `gen-blocks` against a fixture `blocks/` dir writes the expected include (mirrors
  `content-sandbox.test.mjs`).
- **admin:** the glob registry yields `callout` in the slash menu and as a known tag; existing
  callout editor/round-trip tests stay green (proves zero behavior change).
- **site:** the **30 existing render tests stay green and unchanged** — callout still renders
  identically, now through the generated registration (proves the codegen is faithful). `pnpm build`
  triggers `prebuild` → `gen-blocks` so the generated include exists before Astro reads its config.

## Deferred (explicitly out)

- **Slice B — the generic `setuBlock`** round-trip + editor node, so a *new* (non-callout) folder
  block round-trips and edits as itself (Astro render + generic chrome + auto-form). This is the
  visible-capability unlock; this slice's hardcoded `tag → callout` mapping is left intact.
- **`scope` enforcement** + a first-class **content-type system** (today "types" are path-segment
  collections).
- **No-code `block.yaml`** contract + the untrusted/marketplace authoring tier (LiquidJS) — revisited
  when untrusted authoring is real.

## Success criteria

`blocks/callout/` is the sole definition of the callout block. Editing its `block.ts` or `callout.astro`
changes the editor, round-trip, and site with **no** edit to `setu.config.ts` or `markdoc.config.mjs`'s
block tags. `defaultConfig.blocks` is empty, the central array is gone, and **all existing tests stay
green** — callout is bit-for-bit what it was, now folder-sourced.
