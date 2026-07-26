// Tests for the `setu/invariant-comment-names-test` ESLint rule (#961).
//
// The rule lives in eslint-rules/ rather than in a package, so it has no vitest project of
// its own; it rides the `pnpm test:scripts` lane (`node --test 'scripts/*.test.mjs'`)
// alongside scripts/turbo-api-deps.test.mjs, which likewise tests a root-level file.
//
// Read the KILL-SHOT PAIRS below before changing anything: each pair is two cases whose
// ONLY difference is the test path, one expected valid and one expected invalid. Break the
// path detection and the valid half fails; break the triggers and the invalid half fails.
// That is what stops this file from becoming a suite that cannot fail (§3.3 #4).
import test from 'node:test'
import { RuleTester } from 'eslint'
import rule from '../eslint-rules/invariant-comment-names-test.mjs'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
})

const noTest = [{ messageId: 'noTest' }]

test('setu/invariant-comment-names-test', () => {
  ruleTester.run('invariant-comment-names-test', rule, {
    valid: [
      // ---- KILL-SHOT PAIR 1: a `.test.` filename is what makes this one pass ----
      {
        code: `/** \`roleOptions\` is always non-empty — apps/admin/test/roles.test.ts. */
export const roleOptions = ['editor']`
      },
      // ---- KILL-SHOT PAIR 2: an enforcement claim that names its spec file ----
      {
        code: `/** Enforced by the "half-built sandbox self-heals" case in e2e/specs/seed.spec.ts. */
export function seed() {}`
      },
      // ---- KILL-SHOT PAIR 3: the path arrives on the LAST line of a \`//\` run ----
      {
        code: `// \`dirty\` is always cleared once the queue drains.
// Pinned by apps/admin/test/useAutosave.test.ts.
export const dirty = false`
      },

      // A port contract suite is a test even though its filename is not *.test.*
      {
        code: `/** Parity is enforced by the shared IndexPort contract suite in
 *  packages/db-testing/src/index.ts. */
export const parity = true`
      },
      // Browser-mode specs are referred to by directory + name, and that is greppable.
      {
        code: `/** \`autosave\` never remounts mid-write — regression test in
 *  apps/admin/test-browser/lazy-route-autosave. */
export const autosave = true`
      },
      // A path into a plain test/ directory counts too.
      {
        code: `/** \`slug\` cannot contain a slash. Covered by packages/core/test/slug-guard.ts. */
export const slug = 'a'`
      },

      // ---- Intent phrasing is the sanctioned way out ----
      {
        code: `/** Intended to keep \`roleOptions\` non-empty for every actor. */
export const roleOptions = ['editor']`
      },
      {
        code: `/** \`roleOptions\` should always be non-empty. */
export const roleOptions = ['editor']`
      },
      {
        code: `/** A caller could always pass an empty list, which \`normalize\` guarantees away. */
export const normalize = () => []`
      },

      // ---- Ordinary prose the trigger list deliberately does NOT reach ----
      // No backticked subject: this is English, not a claim about this code. Widening
      // the rule to catch it measured 672 hits repo-wide — see the rule's tuning note.
      {
        code: `/** A slug is the entry's identity, so changing it is always an explicit act. */
export const rename = () => {}`
      },
      {
        code: `/** React 18 synthetic stopPropagation cannot stop the native document listener. */
export const bubble = () => {}`
      },
      // An enforcement verb with no test-ish noun: the enforcer is a runtime gate, and
      // demanding a test path for that would be wrong.
      {
        code: `/** Every repo-root write is guarded by \`requireCan('settings.manage')\` server-side. */
export const write = () => {}`
      },
      // Negated: a description of a GAP is not a claim of enforcement.
      {
        code: `// Real text from eslint.config.mjs: the browser project is
// not covered by the \`test/**\` glob above (different directory name).
export const scope = []`
      },
      // Line comments separated by a blank line are two comments, so the trigger in the
      // second does not borrow the first one's sentence.
      {
        code: `// Nothing here asserts anything.

// Just a note.
export const x = 1`
      }
    ],

    invalid: [
      // ---- KILL-SHOT PAIR 1, path removed ----
      {
        code: `/** \`roleOptions\` is always non-empty for any actor that reaches this dialog. */
export const roleOptions = ['editor']`,
        errors: noTest
      },
      // ---- KILL-SHOT PAIR 2, path removed: names the test only by TITLE ----
      {
        code: `/** Enforced by the "half-built sandbox self-heals" test. */
export function seed() {}`,
        errors: noTest
      },
      // ---- KILL-SHOT PAIR 3, path removed: the claim still spans the \`//\` run ----
      {
        code: `// \`dirty\` is always cleared once the
// queue drains.
export const dirty = false`,
        errors: noTest
      },

      // An issue number is not a test — the exact substitution CLAUDE.md §3.2 records as
      // going 0-for-6 in the first audit of this rule.
      {
        code: `/** Fallback identity only — a session's \`gitAuthor\` is always stamped over it (#382). */
export const fallback = 'local'`,
        errors: noTest
      },
      // The other absolute shapes.
      {
        code: `/** \`taskList\` never matches here, which is why a checklist keeps its bytes. */
export const taskList = null`,
        errors: noTest
      },
      {
        code: `/** \`isCanonicalRepoPath\` guarantees every path reaching the lookup is ASCII. */
export const fold = () => ''`,
        errors: noTest
      },
      {
        code: `/** \`position\` cannot bind there, so the branch opens a line of its own. */
export const position = null`,
        errors: noTest
      },
      {
        code: `/** \`gitAuthor\` can never be empty once a session exists. */
export const gitAuthor = 'x'`,
        errors: noTest
      },
      {
        code: `/** SSRF-safe by construction: an unmatched URL makes no network call. */
export const resolve = () => null`,
        errors: noTest
      },
      // A `//` claim, not just docblocks.
      {
        code: `// \`isCanonicalRepoPath\` guarantees the bound; belt-and-braces for direct callers.
export const bound = 1`,
        errors: noTest
      },

      // One report per comment even when several sentences trip, because it is one edit.
      {
        code: `/** \`a\` is always set. \`b\` can never be null. Enforced by the round-trip test. */
export const a = 1`,
        errors: noTest
      },

      // A hedge in a NEIGHBOURING sentence must not launder the fact-worded one.
      {
        code: `/** This is intended to be cheap. \`cache\` never misses on a warm boot. */
export const cache = new Map()`,
        errors: noTest
      }
    ]
  })
})
