# Design — Metadata ↔ YAML Frontmatter (`@saytu/core`) (Increment #8)

_Date: 2026-06-14 · Status: approved_

## Purpose

Close the **metadata** half of the bidirectional round-trip. Today publish (#6)
writes the Markdoc **body only** and the read/fork service (#7) sets
`metadata: {}`, so a published `.mdoc` carries no `title`/`status` and metadata
does not survive publish → open. This adds a **frontmatter module** and wires it
into both ends so content *and* metadata round-trip through Git — completing the
engine the editor will sit on (create + open + edit + publish).

Follows a decision-complete PRD (§2, §3, §7) and shipped increments #1–#7.

## Scope

**In:**
- `packages/core/src/markdoc/frontmatter.ts` — `parseMdoc(raw)` / `serializeMdoc({
  frontmatter, body })`, using **js-yaml** (edge-safe). Exported from `@saytu/core`.
- `js-yaml` dependency + `@types/js-yaml` devDependency on `@saytu/core`.
- Wire the **publish service** (#6) to serialize `draft.metadata` as frontmatter +
  the compiled body.
- Wire the **read/fork service** (#7) to parse frontmatter → `metadata` and the
  body → `markdocToTiptap`.
- Tests: frontmatter unit tests + a **fast-check property test** for object-level
  idempotency (mirroring #1); updated publish test; a content+metadata
  round-trip-through-Git integration test.

**Out (explicitly deferred):**
- A frontmatter **schema** (validating metadata against the collection's Zod
  fields, #2) — for now frontmatter is the open metadata `Record`.
- File-level conflict precision, Git→DB reindex, config-driven `knownBlockTags`
  (all previously deferred, unchanged).
- Byte-fidelity of *hand-authored* frontmatter with non-canonical YAML formatting
  — best-effort (see Idempotency). Object-level round-trip is the guarantee.

## Why these choices

- **js-yaml, not gray-matter.** The publish/read services are edge-guarded (they
  run on workerd in the edge topology), so the YAML lib must be **pure JS / Node-
  free**. `js-yaml` is pure JS (browser-safe); gray-matter has Node-ish bits. An
  explicit `import yaml from 'js-yaml'` resolves its types via `@types/js-yaml`
  even under the edge guard's `types: []` (that option controls auto-included
  *global* @types, not explicitly-imported module types).
- **Frontmatter lives in `src/markdoc/`** — it is part of the `.mdoc` file format
  (YAML frontmatter + Markdoc body), sibling to `to-tiptap`/`to-markdoc`, already
  under the edge guard.
- **Empty frontmatter → body only.** Keeps body-only files (everything published
  by #6/#7) byte-identical, and makes the round-trip idempotent for them.
- **Open metadata `Record`.** `parseMdoc` captures *all* frontmatter keys into
  `metadata`; `serializeMdoc` dumps them all back. Unknown keys are never dropped
  — the never-lose-data ethos, mirroring the Markdoc passthrough.

## The `.mdoc` format

A published `.mdoc` is YAML frontmatter (optional) followed by the Markdoc body:

```
---
title: Summer Launch
status: published
---
# Summer Launch

Body markdoc…
```

**`serializeMdoc({ frontmatter, body })`:**
- If `frontmatter` has **no own keys** → return `body` unchanged (no `---` block).
- Else → `` `---\n${yaml.dump(frontmatter)}---\n${body}` `` (js-yaml `dump` ends
  with `\n`, so the result is `---\n<yaml lines>\n---\n<body>`).

**`parseMdoc(raw): { frontmatter, body }`:**
- Treat leading content as frontmatter **only if** `raw` matches the fence
  `^---\n([\s\S]*?)\n---\n([\s\S]*)$` **and** `yaml.load(block)` returns a
  **non-null, non-array object**. Then `frontmatter` = that object, `body` =
  capture 2.
- Otherwise → `{ frontmatter: {}, body: raw }`.

**The horizontal-rule trap (why parse is conditional):** a Markdoc body can
legitimately *start with* `---` — that is a horizontal rule (#1's byte-fidelity
tests include `'---\n'`). The "must be a closed fence whose block is an object"
rule means a lone leading `---` HR (no valid object-YAML fence) falls through to
body-only, so an HR-leading body is never mis-eaten as frontmatter.

## Idempotency (the #1-style guarantee)

**Object-level round-trip is the contract:**
`parseMdoc(serializeMdoc({ frontmatter, body }))` deep-equals `{ frontmatter,
body }`, and `serializeMdoc` reaches a stable fixed point.

- js-yaml `dump`/`load` is deterministic for JSON-compatible values and preserves
  key insertion order (`sortKeys: false` default); metadata is stored as JSON in
  the DB, which also preserves order — so the object round-trip is stable.
- Metadata values are JSON-compatible (the DB store, #3) — no `undefined`/functions.
- A **fast-check property test** asserts the round-trip over random metadata
  objects (strings, numbers, booleans, nested objects, arrays) paired with random
  bodies **including bodies that start with `---`**.

Byte-fidelity of externally hand-authored frontmatter (non-canonical YAML) is
best-effort: Saytu writes frontmatter only via `serializeMdoc`, and the
content/code separation (§2) means frontmatter is not normally hand-edited in Git.

## Architecture / data flow

```
packages/core/src/markdoc/frontmatter.ts   # parseMdoc / serializeMdoc (js-yaml)
packages/core/src/publish/publish-service.ts  # MODIFIED: serializeMdoc on write
packages/core/src/read/read-service.ts        # MODIFIED: parseMdoc on read
packages/core/src/index.ts                    # + export parseMdoc / serializeMdoc
```

- **Publish (write):** `const body = tiptapToMarkdoc(draft.content); const content
  = serializeMdoc({ frontmatter: draft.metadata, body }); git.commitFile({ ...,
  content, ... })`. (Replaces the body-only NOTE comment.)
- **Read/fork (read):** `const { frontmatter, body } = parseMdoc(published);
  const content = markdocToTiptap(body); … saveDraft({ ...ref, content, metadata:
  frontmatter, baseSha: head })`.

No new module dependencies beyond js-yaml; both services stay edge-portable
(js-yaml is pure JS; the edge guard continues to cover `src/publish`/`src/read`/
`src/markdoc`).

## Error handling

- Malformed YAML in a leading fence → `yaml.load` throws; `parseMdoc` catches and
  falls back to `{ frontmatter: {}, body: raw }` (never throws, never drops the
  body — consistent with the round-trip's never-drop ethos; a broken frontmatter
  surfaces as body content rather than a crash).
- Non-object YAML (scalar/array/null) in the fence → treated as body-only (the
  HR-trap rule).
- `serializeMdoc` of JSON-compatible metadata never throws.

## Testing (TDD)

**frontmatter unit (`test/markdoc/frontmatter.test.ts`):**
- serialize: empty frontmatter → body only (no `---`); non-empty → `---\n…\n---\n`
  + body.
- parse: a `---` fenced doc → `{ frontmatter, body }`; a body-only doc →
  `{ frontmatter: {}, body: raw }`.
- **HR trap:** a body starting with `---` (e.g. `'---\n\npara'`) parses to
  `{ frontmatter: {}, body: '---\n\npara' }` (not eaten as frontmatter).
- malformed YAML fence → falls back to body-only, body preserved.

**frontmatter property (`test/markdoc/frontmatter.property.test.ts`, fast-check):**
- `parseMdoc(serializeMdoc({ fm, body }))` deep-equals `{ fm, body }` and the
  serialize fixed point is stable, over random metadata objects + bodies
  (including `---`-leading bodies).

**publish (update + add):**
- Update the one assertion that expected body-only output for a draft with
  metadata → now assert via `parseMdoc(readFile)` that frontmatter === the
  metadata and body === `tiptapToMarkdoc(draft.content)`.
- The empty-metadata publish cases stay body-only (unchanged assertions still pass).

**read (add):**
- Existing body-only fork tests still pass (parse → `{}` metadata).
- New: fork from a published file *with* frontmatter → `metadata` === the
  frontmatter, `content` === `markdocToTiptap(body)`.

**integration round-trip (in the read or publish test):**
- Build a draft with `content` + `metadata` → publish (serialize) → `loadForEdit`
  (parse) → the forked draft's `metadata` deep-equals the original and
  `tiptapToMarkdoc(content)` equals the published body.

## Definition of done

- `pnpm install` clean (js-yaml added; pure JS, no native build).
- `pnpm typecheck` clean across packages incl. the edge guard (frontmatter +
  both services stay Node-free).
- `pnpm test` green: frontmatter unit + property suites, updated publish tests,
  read round-trip; existing 110 tests otherwise unaffected.
- `parseMdoc` / `serializeMdoc` exported from `@saytu/core`; publish writes
  frontmatter; read restores metadata.
- Committed via the subagent-driven flow.
