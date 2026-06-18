# Metadata ↔ YAML Frontmatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the metadata half of the round-trip — serialize a draft's metadata to YAML frontmatter on publish and parse it back on open, so content *and* metadata survive publish → open.

**Architecture:** A `frontmatter.ts` module in `@setu/core` (`parseMdoc`/`serializeMdoc`, js-yaml — edge-safe) wired into the publish service (write) and the read/fork service (read). Empty frontmatter ⇒ body-only (backward-compatible); a body starting with `---` (a horizontal rule) is never mistaken for frontmatter. Object-level round-trip idempotency is guaranteed by a fast-check property test.

**Tech Stack:** TypeScript (strict), js-yaml, Vitest + fast-check.

**Spec:** `docs/superpowers/specs/2026-06-14-setu-frontmatter-design.md`

---

## File Structure

```
packages/core/src/markdoc/frontmatter.ts     # parseMdoc / serializeMdoc (js-yaml)
packages/core/src/publish/publish-service.ts  # MODIFIED: serializeMdoc on write
packages/core/src/read/read-service.ts        # MODIFIED: parseMdoc on read
packages/core/src/index.ts                    # + export parseMdoc / serializeMdoc
packages/core/test/frontmatter.test.ts
packages/core/test/frontmatter.property.test.ts
packages/core/test/publish/publish-service.test.ts   # MODIFIED: one assertion + a new test
packages/core/test/read/read-service.test.ts         # MODIFIED: add tests
```

`src/markdoc` is already in the edge guard, so no `tsconfig.edge.json` change is needed — but the implementer must confirm the edge typecheck still passes with js-yaml (it is pure JS / Node-free).

---

### Task 1: `frontmatter.ts` (parseMdoc / serializeMdoc) + property test

**Files:**
- Modify: `packages/core/package.json` (add js-yaml + @types/js-yaml)
- Create: `packages/core/src/markdoc/frontmatter.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/frontmatter.test.ts`
- Test: `packages/core/test/frontmatter.property.test.ts`

- [ ] **Step 1: Add js-yaml**

Run:
```bash
pnpm --filter @setu/core add js-yaml
pnpm --filter @setu/core add -D @types/js-yaml
```
Expected: both resolve and install (js-yaml is pure JS — no native build).

- [ ] **Step 2: Write the failing unit test**

Create `packages/core/test/frontmatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseMdoc, serializeMdoc } from '../src/index'

describe('serializeMdoc', () => {
  it('emits body only when frontmatter is empty', () => {
    expect(serializeMdoc({ frontmatter: {}, body: '# Hi\n' })).toBe('# Hi\n')
  })

  it('emits a --- fence for non-empty frontmatter', () => {
    expect(serializeMdoc({ frontmatter: { title: 'Hi' }, body: '# Body\n' })).toBe(
      '---\ntitle: Hi\n---\n# Body\n',
    )
  })
})

describe('parseMdoc', () => {
  it('parses a fenced document into frontmatter + body', () => {
    expect(parseMdoc('---\ntitle: Hi\n---\n# Body\n')).toEqual({
      frontmatter: { title: 'Hi' },
      body: '# Body\n',
    })
  })

  it('treats a body-only document as empty frontmatter', () => {
    expect(parseMdoc('# Just a body\n')).toEqual({ frontmatter: {}, body: '# Just a body\n' })
  })

  it('does NOT eat a leading horizontal rule as frontmatter', () => {
    // a Markdoc body can start with `---` (an HR); it must survive verbatim
    expect(parseMdoc('---\n\npara\n')).toEqual({ frontmatter: {}, body: '---\n\npara\n' })
    expect(parseMdoc('---\n')).toEqual({ frontmatter: {}, body: '---\n' })
  })

  it('falls back to body-only on malformed YAML in the fence', () => {
    const raw = '---\n: : bad yaml :\n---\nbody\n'
    const r = parseMdoc(raw)
    expect(r.frontmatter).toEqual({})
    expect(r.body).toBe(raw)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- frontmatter.test`
Expected: FAIL — `parseMdoc`/`serializeMdoc` not exported.

- [ ] **Step 4: Implement the module**

Create `packages/core/src/markdoc/frontmatter.ts`:

```ts
import { dump, load } from 'js-yaml'

/** A parsed `.mdoc` file: YAML frontmatter (open record) + Markdoc body. */
export interface MdocFile {
  frontmatter: Record<string, unknown>
  body: string
}

const FENCE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/** Parse a `.mdoc` file into frontmatter + Markdoc body. A leading `---` block is
 *  treated as frontmatter ONLY when it is a closed fence whose YAML is a plain
 *  object — so a body that starts with `---` (a horizontal rule) is never
 *  mistaken for frontmatter, and malformed/empty YAML falls back to body-only.
 *  Never throws and never drops the body. */
export function parseMdoc(raw: string): MdocFile {
  const m = FENCE.exec(raw)
  if (m) {
    let data: unknown
    try {
      data = load(m[1]!)
    } catch {
      return { frontmatter: {}, body: raw }
    }
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      return { frontmatter: data as Record<string, unknown>, body: m[2]! }
    }
  }
  return { frontmatter: {}, body: raw }
}

/** Serialize frontmatter + a Markdoc body into a `.mdoc` file. Empty frontmatter
 *  produces a body-only file (no `---` block) so body-only content round-trips
 *  unchanged. */
export function serializeMdoc({ frontmatter, body }: MdocFile): string {
  if (Object.keys(frontmatter).length === 0) return body
  return `---\n${dump(frontmatter)}---\n${body}`
}
```

Note: if `import { dump, load } from 'js-yaml'` does not typecheck under the
installed `@types/js-yaml` + `verbatimModuleSyntax`, fall back to
`import jsYaml from 'js-yaml'` and use `jsYaml.dump`/`jsYaml.load` — keep the
behavior identical and note the change.

- [ ] **Step 5: Export from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type { MdocFile } from './markdoc/frontmatter'
export { parseMdoc, serializeMdoc } from './markdoc/frontmatter'
```

- [ ] **Step 6: Run the unit test to verify it passes**

Run: `pnpm --filter @setu/core test -- frontmatter.test`
Expected: PASS.

- [ ] **Step 7: Write the property test (idempotency)**

Create `packages/core/test/frontmatter.property.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseMdoc, serializeMdoc } from '../src/index'

// Safe content avoids YAML metacharacters so the test exercises OUR round-trip
// (parse/serialize + the HR-trap), not js-yaml's unicode edge cases.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz '.split('')
const KEYCHARS = 'abcdefghijklmnopqrstuvwxyz'.split('')
const safeStr = fc.array(fc.constantFrom(...LETTERS), { minLength: 0, maxLength: 20 }).map((a) => a.join(''))
const safeKey = fc.array(fc.constantFrom(...KEYCHARS), { minLength: 1, maxLength: 8 }).map((a) => a.join(''))
const metaValue = fc.oneof(safeStr, fc.integer(), fc.boolean())
const metadata = fc.dictionary(safeKey, metaValue, { maxKeys: 5 })
const body = fc.oneof(
  safeStr,
  safeStr.map((s) => `# ${s}\n\n${s}\n`),
  safeStr.map((s) => `---\n\n${s}\n`), // a body that starts with a horizontal rule
  fc.constant('---\n'),
  fc.constant(''),
)

describe('frontmatter round-trip (property-based)', () => {
  it('parseMdoc(serializeMdoc(x)) deep-equals x', () => {
    fc.assert(
      fc.property(metadata, body, (frontmatter, b) => {
        const r = parseMdoc(serializeMdoc({ frontmatter, body: b }))
        expect(r.frontmatter).toEqual(frontmatter)
        expect(r.body).toBe(b)
      }),
    )
  })

  it('serializeMdoc is a stable fixed point', () => {
    fc.assert(
      fc.property(metadata, body, (frontmatter, b) => {
        const s1 = serializeMdoc({ frontmatter, body: b })
        const s2 = serializeMdoc(parseMdoc(s1))
        expect(s2).toBe(s1)
      }),
    )
  })
})
```

- [ ] **Step 8: Run the property test**

Run: `pnpm --filter @setu/core test -- frontmatter.property`
Expected: PASS. (If fast-check finds a failing case, it is a real round-trip bug — fix `frontmatter.ts`, do NOT weaken the generators beyond the safe-content constraint already in place. Report any such finding.)

- [ ] **Step 9: Typecheck (incl. edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: clean — both the main check and the edge guard. js-yaml is pure JS (Node-free), so `src/markdoc/frontmatter.ts` passes the `types: []` edge guard. If the edge check fails because js-yaml pulls Node types, STOP and report (it should not).

- [ ] **Step 10: Run the full core suite + commit**

Run: `pnpm --filter @setu/core test`
Expected: PASS — existing tests + the new frontmatter suites.

```bash
git add packages/core/package.json packages/core/src/markdoc/frontmatter.ts packages/core/src/index.ts packages/core/test/frontmatter.test.ts packages/core/test/frontmatter.property.test.ts pnpm-lock.yaml
git commit -m "feat(core): frontmatter parse/serialize (js-yaml) with round-trip property test"
```

---

### Task 2: Wire the publish service to write frontmatter

**Files:**
- Modify: `packages/core/src/publish/publish-service.ts`
- Test: `packages/core/test/publish/publish-service.test.ts`

- [ ] **Step 1: Update the breaking test + add a frontmatter test**

Edit `packages/core/test/publish/publish-service.test.ts`.

(a) Add `parseMdoc` to the value imports from `../../src/index` (the file already imports `createPublishService, tiptapToMarkdoc`):

```ts
import { createPublishService, tiptapToMarkdoc, parseMdoc } from '../../src/index'
```

(b) In the test `'first publish commits the compiled markdoc and advances baseSha'`, the draft has `metadata: { title: 'T' }`, so the committed file now carries frontmatter. Replace the body-only assertion line:

```ts
    expect(await git.readFile(r.path)).toBe(tiptapToMarkdoc(doc('hi')))
```

with a parse-based assertion:

```ts
    const parsed = parseMdoc((await git.readFile(r.path))!)
    expect(parsed.frontmatter).toEqual({ title: 'T' })
    expect(parsed.body).toBe(tiptapToMarkdoc(doc('hi')))
```

(c) Add a dedicated test inside the `describe('createPublishService', ...)` block:

```ts
  it('serializes draft metadata as YAML frontmatter in the committed file', async () => {
    await data.saveDraft({ ...ref, content: doc('hello'), metadata: { title: 'Hello', status: 'published' } })
    const r = await svc().publish({ ref, author })
    expect(r.status).toBe('published')
    if (r.status !== 'published') throw new Error('unreachable')
    const file = (await git.readFile(r.path))!
    expect(file.startsWith('---\n')).toBe(true)
    const parsed = parseMdoc(file)
    expect(parsed.frontmatter).toEqual({ title: 'Hello', status: 'published' })
    expect(parsed.body).toBe(tiptapToMarkdoc(doc('hello')))
  })
```

(The empty-metadata publish tests — republish v2, new-entry — keep `metadata: {}`, so they stay body-only and their existing `toBe(tiptapToMarkdoc(...))` assertions still pass.)

- [ ] **Step 2: Run to verify the updated test fails**

Run: `pnpm --filter @setu/core test -- publish/publish-service`
Expected: FAIL — publish still writes body-only, so the new frontmatter assertions fail.

- [ ] **Step 3: Wire the publish service**

Edit `packages/core/src/publish/publish-service.ts`.

(a) Add the import (next to the existing `tiptapToMarkdoc`/`contentPath` imports):

```ts
import { serializeMdoc } from '../markdoc/frontmatter'
```

(b) Replace the body-only NOTE comment + the `content` line:

```ts
      // NOTE: this compiles the body only. The draft's `metadata` is not yet
      // serialized to YAML frontmatter in the .mdoc — frontmatter write/parse is
      // a later increment (it needs a matching parser in markdocToTiptap too).
      const content = tiptapToMarkdoc(draft.content)
```

with:

```ts
      // Serialize metadata → YAML frontmatter + the compiled Markdoc body.
      const content = serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) })
```

(Leave the rest of `publish` unchanged.)

- [ ] **Step 4: Run the publish suite to verify it passes**

Run: `pnpm --filter @setu/core test -- publish/publish-service`
Expected: PASS (all publish tests, incl. the updated + new ones).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @setu/core typecheck`
Expected: clean (incl. edge guard — `serializeMdoc` is edge-safe).

```bash
git add packages/core/src/publish/publish-service.ts packages/core/test/publish/publish-service.test.ts
git commit -m "feat(core): publish writes metadata as YAML frontmatter"
```

---

### Task 3: Wire the read service to restore metadata + round-trip test

**Files:**
- Modify: `packages/core/src/read/read-service.ts`
- Test: `packages/core/test/read/read-service.test.ts`

- [ ] **Step 1: Add the failing read tests**

Edit `packages/core/test/read/read-service.test.ts`.

(a) Add `serializeMdoc` to the value imports (the file already imports `createReadService, tiptapToMarkdoc, markdocToTiptap, contentPath`):

```ts
import { createReadService, tiptapToMarkdoc, markdocToTiptap, contentPath, serializeMdoc } from '../../src/index'
```

(b) Add these tests inside the `describe('createReadService.loadForEdit', ...)` block:

```ts
  it('forks metadata from a published file with frontmatter', async () => {
    const file = serializeMdoc({ frontmatter: { title: 'Kept', status: 'published' }, body: tiptapToMarkdoc(doc('body')) })
    await git.commitFile({ path: contentPath(ref), content: file, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.metadata).toEqual({ title: 'Kept', status: 'published' })
    expect(r.draft.content).toEqual(markdocToTiptap(tiptapToMarkdoc(doc('body'))))
  })

  it('round-trips content AND metadata through Git (publish shape → open)', async () => {
    const original = doc('full round trip')
    const metadata = { title: 'Round Trip', n: 3 }
    // simulate a publish: serialize metadata + compiled body, commit
    const file = serializeMdoc({ frontmatter: metadata, body: tiptapToMarkdoc(original) })
    await git.commitFile({ path: contentPath(ref), content: file, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.metadata).toEqual(metadata)
    expect(tiptapToMarkdoc(r.draft.content)).toBe(tiptapToMarkdoc(original))
  })
```

(The existing fork tests commit body-only Markdoc, which parses to `frontmatter: {}` → `metadata: {}`, so their assertions still pass.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @setu/core test -- read/read-service`
Expected: FAIL — the read service still uses `metadata: {}` and `markdocToTiptap(published)` (whole file incl. frontmatter), so the metadata + content assertions fail.

- [ ] **Step 3: Wire the read service**

Edit `packages/core/src/read/read-service.ts`.

(a) Add the import:

```ts
import { parseMdoc } from '../markdoc/frontmatter'
```

(b) Replace the fork block. Change:

```ts
      const published = await git.readFile(contentPath(ref))
      if (published === null) return { source: 'absent' }

      // Git → Tiptap (the read half of the round-trip). Body only for now;
      // metadata ↔ frontmatter is a later increment, so a forked draft starts
      // with empty metadata.
      const content = markdocToTiptap(published)
      const head = await git.headSha()
      const draft = await data.saveDraft({ ...ref, content, metadata: {}, baseSha: head })
      return { source: 'forked', draft }
```

to:

```ts
      const published = await git.readFile(contentPath(ref))
      if (published === null) return { source: 'absent' }

      // Git → Tiptap: split YAML frontmatter from the Markdoc body, restoring
      // both metadata and content (the read half of the round-trip).
      const { frontmatter, body } = parseMdoc(published)
      const content = markdocToTiptap(body)
      const head = await git.headSha()
      const draft = await data.saveDraft({ ...ref, content, metadata: frontmatter, baseSha: head })
      return { source: 'forked', draft }
```

- [ ] **Step 4: Run the read suite to verify it passes**

Run: `pnpm --filter @setu/core test -- read/read-service`
Expected: PASS (existing body-only fork tests + the two new metadata tests).

- [ ] **Step 5: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@setu/core` now larger (110 prior core 72 → frontmatter unit + property + publish + read additions), `@setu/db-testing` 11, `@setu/db-sqlite` 12, `@setu/git-testing` 6, `@setu/git-local` 9; typecheck clean across all packages incl. the core edge guard.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/read/read-service.ts packages/core/test/read/read-service.test.ts
git commit -m "feat(core): read restores metadata from frontmatter — closes the metadata loop"
```

---

## Self-Review

**Spec coverage:**
- `frontmatter.ts` (`parseMdoc`/`serializeMdoc`, js-yaml, empty→body-only, HR-trap via object-YAML check, malformed→fallback) → Task 1. ✓
- js-yaml + @types/js-yaml deps → Task 1 Step 1. ✓
- Object-level idempotency via fast-check property test (random metadata + `---`-leading bodies) → Task 1 Step 7. ✓
- Publish wires `serializeMdoc({ frontmatter: draft.metadata, body })`; the one breaking test updated; a frontmatter test added → Task 2. ✓
- Read wires `parseMdoc` → `metadata = frontmatter`, `content = markdocToTiptap(body)`; existing body-only tests survive; fork-with-frontmatter + content+metadata round-trip-through-Git → Task 3. ✓
- Edge guard unchanged (`src/markdoc` already covered); js-yaml edge-safe confirmed by the edge typecheck → Task 1 Step 9, Task 2 Step 5, Task 3 Step 5. ✓
- Exports (`parseMdoc`, `serializeMdoc`, `MdocFile`) → Task 1 Step 5. ✓
- Existing 110 tests stay green except the one intentionally-updated publish assertion → Tasks 2 & 3 + Step 5. ✓
- Deferred (frontmatter schema/Zod validation, file-level precision, reindex, config knownBlockTags) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. The js-yaml import-form note (Task 1 Step 4) gives a concrete fallback, not a vague placeholder. ✓

**Type consistency:** `MdocFile { frontmatter: Record<string, unknown>; body: string }` is the shared shape; `parseMdoc(raw): MdocFile` and `serializeMdoc(file: MdocFile): string` are used identically in publish (`serializeMdoc({ frontmatter: draft.metadata, body })` — `draft.metadata` is `Record<string, unknown>`) and read (`parseMdoc(published)` → `metadata: frontmatter` matches `DraftInput.metadata: Record<string, unknown>`). The fast-check generators produce `Record<string, string|number|boolean>` assignable to `Record<string, unknown>`. ✓
