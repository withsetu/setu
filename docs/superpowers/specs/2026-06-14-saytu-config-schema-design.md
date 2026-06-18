# Design — `saytu.config.ts` schema + parser (Increment #2)

_Date: 2026-06-14 · Status: approved_

## Purpose

Turn the keystone config (`saytu.config.ts`, PRD §8) from a hardcoded placeholder
into a real, validated, file-loaded configuration object — scoped to **block
definitions only**. This replaces the `knownBlockTags = new Set(['callout'])`
placeholder that increment #1 (`@setu/core` round-trip) shipped, making the
recognised-block set genuinely config-driven.

This is the second build increment of the real implementation, following a
decision-complete PRD (`plan/prd.md`) and a shipped increment #1.

## Scope

**In:**
- A new `src/config/` module inside `@setu/core` (per PRD §23, the config parser
  lives in `core`, not a separate package).
- The authored config shape (`SaytuConfig`, `BlockDefinition`) and a typed,
  resolved shape (`ResolvedConfig`).
- `defineConfig()` — an identity helper that gives authors type inference.
- A Zod **meta-schema** that validates an authored config object.
- `resolveConfig(raw)` — validate, index blocks by tag, derive `knownBlockTags`.
- `loadConfig(path)` — load a real `saytu.config.ts` from disk via **jiti** and
  resolve it.
- A shipped **default config** defining the `callout` block, so the round-trip's
  recognised-tag set is derived from config rather than a magic constant.
- Wiring: `@setu/core`'s round-trip stops hardcoding `['callout']`; the tag set
  is produced by the config layer.

**Out (explicitly deferred to later increments):**
- Collections, fields, and taxonomies (PRD §3) — no consumer exists yet
  (DataPort lands later).
- Permalink patterns (PRD §4) — no router yet.
- Theme / component-override resolution (PRD §8 base-theme + local overrides).
- Attribute-validation during round-trip (config carries the Zod prop schemas
  now; surfacing validation as authoring warnings waits for the editor).
- Editor slash-menu generation and Astro AST→component mapping (they will *read*
  this config in later increments; they are not built here).

## Why blocks-only (scope decision)

Of the four things `saytu.config.ts` eventually defines — blocks, collections,
permalinks, theme overrides — only **blocks** has a live consumer today: the
round-trip's `knownBlockTags`. Collections and permalinks would be validated
schema with nothing reading them, which risks designing them in a vacuum before
the subsystems that use them exist. YAGNI: define what is consumed now; add the
rest when their consumers arrive.

## Architecture

Small, single-purpose, independently testable modules under `packages/core/src/config/`:

```
packages/core/src/config/
├── types.ts           # SaytuConfig, BlockDefinition, ResolvedConfig, ResolvedBlock
├── define-config.ts   # defineConfig() identity helper (type inference)
├── schema.ts          # Zod meta-schema validating an authored config
├── resolve.ts         # resolveConfig(raw): ResolvedConfig
├── load.ts            # loadConfig(path): Promise<ResolvedConfig>  (jiti)
└── default-config.ts  # the shipped default config (callout block)
```

`load.ts` is the only module that touches the filesystem; everything else is
pure and unit-testable without IO.

## Types

```ts
import type { ZodTypeAny } from 'zod'

/** Editor-facing metadata for a block (consumed by the slash menu later). */
export interface BlockEditorMeta {
  label?: string
  icon?: string
  group?: string
}

/** A content block as authored in saytu.config.ts. */
export interface BlockDefinition {
  /** Markdoc tag name, e.g. 'callout'. Unique across the config. */
  tag: string
  /** Zod schema for the block's Markdoc attributes (props). */
  props: ZodTypeAny
  /** Framework-agnostic path to the render component (.astro or framework). */
  component: string
  /** Optional editor metadata (slash-menu label/icon/group). */
  editor?: BlockEditorMeta
}

/** The config object an author exports from saytu.config.ts. */
export interface SaytuConfig {
  blocks: BlockDefinition[]
}

/** A block after resolution (identical shape today; distinct type for future
 *  derived fields). */
export interface ResolvedBlock extends BlockDefinition {}

/** The validated, indexed config the rest of the system consumes. */
export interface ResolvedConfig {
  /** All blocks, in authored order. */
  blocks: ResolvedBlock[]
  /** Blocks indexed by tag for O(1) lookup. */
  blocksByTag: Map<string, ResolvedBlock>
  /** Tag set the round-trip treats as known/editable blocks. */
  knownBlockTags: Set<string>
}
```

## Public API

- `defineConfig(config: SaytuConfig): SaytuConfig` — identity at runtime; exists
  purely so authors get inference and a stable import.
- `resolveConfig(raw: unknown): ResolvedConfig` — validates `raw` against the Zod
  meta-schema, then builds the indexed/derived `ResolvedConfig`. Throws a clear
  error on invalid input (see Error handling).
- `loadConfig(path: string): Promise<ResolvedConfig>` — imports the TS/JS config
  module at `path` via jiti, takes its default export, and runs `resolveConfig`.
- `defaultConfig: SaytuConfig` — the shipped default (one `callout` block).

New types exported from `@setu/core`: `SaytuConfig`, `BlockDefinition`,
`BlockEditorMeta`, `ResolvedConfig`, `ResolvedBlock`.

## Meta-schema (validation rules)

The Zod meta-schema in `schema.ts` validates an authored config:

- `blocks` is an array (may be empty).
- Each block: `tag` is a non-empty string; `component` is a non-empty string;
  `props` is a Zod schema instance (validated with a refinement that checks for
  a Zod schema's `safeParse` method, since Zod schemas are opaque objects);
  `editor` is optional with optional string `label`/`icon`/`group`.
- **No duplicate `tag`** across `blocks` (enforced in `resolveConfig` with a
  precise error naming the offending tag — superrefine or post-parse check).

`resolveConfig` is the single validation entry point: it runs the meta-schema and
the duplicate-tag check, then constructs `blocksByTag` and `knownBlockTags`.

## Data flow

**Authoring → resolved:**
1. Author writes `saytu.config.ts` exporting `defineConfig({ blocks: [...] })`.
2. `loadConfig(path)` imports it via jiti → raw default export.
3. `resolveConfig(raw)` validates (meta-schema + duplicate-tag check), then builds
   `blocks` (authored order), `blocksByTag` (Map), `knownBlockTags` (Set of tags).

**Resolved → round-trip:**
- `ResolvedConfig.knownBlockTags` is passed as the round-trip's `knownBlockTags`.
  The hardcoded `new Set(['callout'])` default in `to-tiptap.ts` is removed; the
  `callout` block now lives in `defaultConfig`, and the recognised set is derived
  from it. The round-trip primitive keeps its `RoundtripOptions.knownBlockTags`
  parameter (clean low-level API) — the config layer is what *produces* the set.

## Config loading (jiti)

`saytu.config.ts` is TypeScript and may be ESM; loading it at runtime needs
transpilation. Use **jiti** (unjs; runtime TS/ESM import, no build step, mature,
used by Nuxt/unjs config loaders). `loadConfig` creates a jiti instance and
imports the path, reads the default export, and resolves it. jiti is added as a
dependency of `@setu/core`.

Rationale over alternatives: bundle-require/esbuild adds a heavier build step;
hand-rolled `tsc`/transpile is fragile. jiti is the lightest correct option.

## Error handling

Configuration errors must fail **loudly and clearly** (unlike content, which is
never dropped). `resolveConfig` throws an `Error` with an actionable message:
- invalid shape → the Zod error's formatted message (which block/field failed).
- duplicate tag → `Duplicate block tag "callout" in saytu.config.ts`.
`loadConfig` surfaces filesystem/import errors (missing file, no default export)
with a message naming the path.

## Testing (TDD — tests first)

`packages/core/test/config/`:

- **`resolve.test.ts`**
  - valid config → `ResolvedConfig` with `blocks` in order, `blocksByTag` lookup
    works, `knownBlockTags` contains every tag.
  - missing `tag`/`component` → throws with a message naming the field.
  - `props` not a Zod schema → throws.
  - duplicate tag → throws naming the tag.
  - empty `blocks` → resolves to empty config (valid).
- **`define-config.test.ts`** — `defineConfig(x)` returns `x` unchanged (runtime
  identity; the value is type inference at compile time).
- **`load.test.ts`** — `loadConfig` against a real fixture
  `test/config/fixtures/saytu.config.ts` (exports a `callout` block via
  `defineConfig`) → resolves to a config whose `knownBlockTags` has `callout`;
  loading a path with no default export → throws naming the path.
- **`default-config.test.ts`** — `defaultConfig` resolves and yields
  `knownBlockTags` = `{ callout }`.
- **Integration** (extend existing round-trip tests or a new
  `config-roundtrip.test.ts`): `markdocToTiptap(src, { knownBlockTags:
  resolveConfig(defaultConfig).knownBlockTags })` recognises `{% callout %}` as a
  known block, and an undefined tag falls through to `passthrough`. Confirms the
  placeholder removal preserves increment #1 behaviour.

## Definition of done

- `pnpm install` clean (jiti added to `@setu/core`).
- `pnpm typecheck` clean (strict).
- `pnpm test` green at repo root — new config suite + the existing 21 round-trip
  tests still pass (the placeholder removal must not regress them).
- The `new Set(['callout'])` magic constant is gone from `to-tiptap.ts`; the
  recognised set is config-derived.
- Committed on a feature branch via the subagent-driven flow.
