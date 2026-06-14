# Design — `@saytu/core` Markdoc ⇄ Tiptap round-trip (Increment #1)

_Date: 2026-06-14 · Status: approved_

## Purpose

Stand up the real Saytu monorepo and convert the **proven** Markdoc⇄Tiptap
round-trip spike (`prototype/markdoc-roundtrip/`) into the first real, typed,
test-covered module of `@saytu/core`. This is the foundation every later
package builds on, so it must be trustworthy and green.

This is the first build increment of "C" (the real implementation), following a
decision-complete PRD (`plan/prd.md`) and two passing spikes.

## Scope

**In:**
- Monorepo skeleton (Node + pnpm workspaces + Vitest; TypeScript).
- `@saytu/core` containing only the round-trip: `markdocToTiptap` and
  `tiptapToMarkdoc`, ported faithfully from the spike.
- A real Vitest suite: example-based (the spike's samples) + property-based
  (fast-check) idempotency.

**Out (explicitly deferred to later increments):**
- `saytu.config.ts` schema and the unified config parser.
- The Ports/adapters (Data, Storage, Auth, Email, Git, Image).
- Inline-variable (`{% $var %}`) handling.
- Tiptap editor wiring; Astro rendering; publish pipeline.

## Toolchain decision

**Node + pnpm workspaces + Vitest.** Bun stays installed as an optional tool but
is **not** foundational and **does not** run Astro — Astro's own docs warn of
rough edges running Astro on Bun, and we want one safe runtime (Node) where
Astro is involved. This increment is pure TypeScript (no Astro), so the choice
is purely about a mature, CI-friendly package manager + test runner.

_PRD follow-up (separate change): revise §16/§11 "Bun for local/VPS" →
"Node (Bun optional, with Astro caveats)"; `bun:sqlite` → `node:sqlite`._

## Approach

**Faithful behavior port.** Reorganize the spike into focused modules with real
types, but **do not change behavior**. Same proven algorithm: source-slice
preservation for unknown/advanced content, error-fragment coalescing, AST-build
+ `Markdoc.format` for native blocks. Opportunistic feature improvements
(inline variables, richer config) are explicitly out of scope — the value of
this increment is *trusted parity with the proven spike*.

## Architecture

Small, single-purpose, independently testable modules:

```
packages/core/
├── package.json          # Node + Vitest + @markdoc/markdoc + fast-check
├── tsconfig.json         # extends ../../tsconfig.base.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # public surface
│   └── markdoc/
│       ├── types.ts      # TiptapDoc, TiptapNode, TiptapMark, RoundtripOptions
│       ├── to-tiptap.ts  # markdocToTiptap()
│       └── to-markdoc.ts # tiptapToMarkdoc()
└── test/
    ├── roundtrip.examples.test.ts
    └── roundtrip.property.test.ts
```

## Public API

- `markdocToTiptap(source: string, opts?: RoundtripOptions): TiptapDoc`
- `tiptapToMarkdoc(doc: TiptapDoc): string`
- `RoundtripOptions = { knownBlockTags?: Set<string> }` — default `new Set(['callout'])`.
  A minimal nod to config; the full `saytu.config.ts` schema is increment #2.

Types exported: `TiptapDoc`, `TiptapNode`, `TiptapMark`, `RoundtripOptions`.

## Data flow (unchanged from the spike)

**Markdoc → Tiptap:**
1. `Markdoc.parse(source, { location: true })`.
2. Walk top-level nodes. Native blocks (heading, paragraph, list, blockquote,
   fence, hr, known-block tags) → corresponding Tiptap nodes.
3. Unknown tags, control-flow tags, and parse-error nodes → a `passthrough`
   node whose `raw` is the **original source sliced by line range**
   (start line → next sibling's start line).
4. Consecutive error fragments are **coalesced** (absorb through the matching
   closing error) into one `passthrough`, marked `flagged: true`.

**Tiptap → Markdoc:**
1. Native Tiptap nodes → built Markdoc AST nodes (`new Markdoc.Ast.Node(...)`).
2. `passthrough` nodes → their `raw` source emitted **verbatim**.
3. Native blocks formatted via `Markdoc.format`; passthrough raw spliced in;
   blocks joined with blank lines + trailing newline.

## Error handling

Parse errors **never throw and never drop content**. Anything Markdoc cannot
fully parse becomes a `flagged` `passthrough` preserved byte-for-byte. This is
the spike's central finding (`Markdoc.format()` silently drops unparseable
nodes — source-slicing does not) and is now a hard contract enforced by tests.

## Testing (TDD — tests first)

**Example-based** (`roundtrip.examples.test.ts`) — port the spike's samples:
basic markdown, known block (callout), advanced `{% if %}`, malformed/unknown,
self-closing partial, mixed. For each, assert:
- idempotency: `S1 === S2` (serialize is a stable fixed point),
- byte-identical first save where expected (`S0 === S1`),
- advanced/unknown syntax preserved verbatim in `S1`.

**Property-based** (`roundtrip.property.test.ts`, fast-check — the §26
non-negotiable): generate random valid Markdoc documents from safe block
generators; assert idempotency (`S1 === S2`) across many inputs.

## Definition of done

- `pnpm install` clean (Node + pnpm workspaces).
- `pnpm typecheck` clean (`tsc --noEmit`, strict).
- `pnpm test` green at the repo root (example + property suites).
- Committed; provisional pnpm scaffold finalized (no leftover stray config).
