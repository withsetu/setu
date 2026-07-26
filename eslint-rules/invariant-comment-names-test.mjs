// Setu ESLint rule: `setu/invariant-comment-names-test` (#961).
//
// CLAUDE.md §3.2 / §4 #21: a comment that asserts an invariant as FACT must name the
// literal test path that fails when the invariant breaks, or be worded as intent
// ("intended to …") instead. A fact-worded claim with nothing behind it does not merely
// fail to help — it sits exactly where the next reader goes to verify that property and
// stops them looking. That class produced seven audited findings, three of them a fix for
// a false claim that introduced a new false claim.
//
// This rule buys the CHEAP half only: it makes such a claim awkward to WRITE without
// either naming a test or softening the wording. It does NOT check that the named test
// actually bites — that is a reviewer's job and is not statically decidable. It also does
// not catch every shape: a bare unbackticked English invariant ("Cleared only when the
// queue fully drains") is indistinguishable from ordinary prose at any tolerable noise
// level, and is measured below as such. Reviewer vigilance still owns that half.
//
// TUNING NOTE, because the noise budget is the whole design constraint (§3.2 records why
// a blanket `void <async>()` ban was rejected: 4:1 false positives train suppression).
// The trigger list was measured over the whole repo before it was chosen — the corpus
// table is in the #961 PR. Two families survived; several plausible ones did not:
//   - Bare `cannot` / `can't` / `never` / `always`: 672 matching sentences repo-wide,
//     overwhelmingly ordinary explanatory prose ("React 18's stopPropagation can't stop
//     the native listener"). English, not an invariant claim. Dropped.
//   - A test-ish noun FOLLOWED by an enforcement verb ("nothing else in the suite would
//     have caught it"): ~1:1 false positives, all prose about tests. Dropped.
//   - `only when` / `only if`: 45 further comments, mostly ordinary scheduling prose.
//     Dropped — and this is the drop that costs real coverage, see the paragraph above.
// What survived is scoped by grammar, not vocabulary alone: an enforcement verb applied
// to a test-ish noun; and an absolute claim whose subject is a backticked identifier.
//
// Behaviour of this rule is pinned by scripts/invariant-comment-rule.test.mjs, which
// includes the paired kill-shot for the path detection.

const ENFORCEMENT_VERB =
  'enforced|pinned|covered|proven|proved|asserted|verified|guarded|caught|locked(?: in)?|kept honest'
const TEST_NOUN =
  'test|tests|spec|specs|suite|suites|case|cases|describe|assertion|assertions'

// Each entry is [human-readable name, matcher]. The name is quoted back in the report so
// the author can see which phrasing tripped it.
const TRIGGERS = [
  // Family A: "…enforced by the round-trip test", "pinned by the describe above".
  // Bounded to 90 characters so the verb and the noun have to share a clause; unbounded,
  // a paragraph mentioning "enforced" and, three sentences later, "suite" matches.
  // The lookbehinds drop negated statements ("not covered by the `test/**` glob above"),
  // which are descriptions of a gap rather than claims of enforcement.
  // Cases for every clause here: scripts/invariant-comment-rule.test.mjs.
  [
    'an enforcement claim ("… by … test/suite/spec")',
    new RegExp(
      `(?<!\\bnot )(?<!\\bnever )(?<!\\bnothing )\\b(?:${ENFORCEMENT_VERB}) by\\b[^.;]{0,90}?\\b(?:${TEST_NOUN})\\b`,
      'i'
    )
  ],
  // Family B: an absolute claim whose SUBJECT is a backticked identifier. The backtick
  // requirement is what separates "`roleOptions` is always non-empty" (a claim about this
  // code) from "a slug is the entry's identity, so changing it is always an explicit act"
  // (prose). A heuristic, not a parse — both of those strings are cases in
  // scripts/invariant-comment-rule.test.mjs, on opposite sides.
  ['"`x` is always …"', /`[^`]+`\s+(?:is|are)\s+always\b/i],
  ['"`x` is/can never …"', /`[^`]+`\s+(?:is|are|can)\s+never\b/i],
  ['"`x` cannot …"', /`[^`]+`\s+can\s?not\b/i],
  ['"`x` always <verb>s …"', /`[^`]+`\s+always\s+[a-z]+s\b/i],
  ['"`x` never <verb>s …"', /`[^`]+`\s+never\s+[a-z]+s\b/i],
  ['"`x` guarantees …"', /`[^`]+`\s+guarantees\b/i],
  // "…-safe by construction", "a bijection by construction". Kept despite being only ~9
  // sites because one of them is this defect class caught in the act: db-sqlite's
  // index-port claimed parity "by construction" and needed two later fixes (#897, #898).
  // Case: scripts/invariant-comment-rule.test.mjs, the SSRF-safe entry.
  ['"… by construction"', /\bby construction\b/i]
]

// Intent phrasing is the sanctioned way out, so a sentence carrying any of it is not a
// fact claim and is skipped. `would`/`could`/`used to` are here for the same reason: they
// are counterfactual or historical, not an assertion about how the code behaves now.
const INTENT =
  /\b(?:intended to|intent|meant to|should|aims? to|tries to|would|could|used to|ideally|in theory)\b/i

// What counts as "names a test". Deliberately wider than a `.test.`/`.spec.` filename:
// `packages/*-testing/` ships the port CONTRACT suites (runGitPortContract and friends),
// `apps/admin/test-browser/<name>` is how the browser-mode specs are referred to, and a
// path into a test directory is exactly as greppable as a filename. All of them are
// things that FAIL when the invariant breaks, which is the property being asked for. An
// issue number is not one of those, and deliberately does not satisfy this.
const TEST_REFERENCE =
  /[\w@./-]*\.(?:test|spec)\.[cm]?[jt]sx?\b|\btests?[\w-]*\/[\w@./-]+|[\w@./-]*-testing\/[\w@./-]+/

/**
 * Group runs of adjacent `//` comments into one logical comment, so a claim split across
 * three lines is matched as one sentence and a path on the last line exempts the run.
 * Block comments stay one logical comment each.
 */
function toLogicalComments(comments) {
  const logical = []
  for (const comment of comments) {
    const previous = logical.at(-1)
    const contiguous =
      previous !== undefined &&
      comment.type === 'Line' &&
      previous.type === 'Line' &&
      comment.loc.start.line === previous.endLine + 1
    if (contiguous) {
      previous.text += ` ${comment.value}`
      previous.endLine = comment.loc.end.line
      continue
    }
    logical.push({
      type: comment.type,
      // Strip the leading ` * ` of a docblock so the text reads back as prose.
      text: comment.value.replace(/^[ \t]*\*[ \t]?/gm, ' '),
      loc: comment.loc,
      endLine: comment.loc.end.line
    })
  }
  return logical
}

/** Split on sentence enders, so a trigger and its hedge have to share a clause. */
function sentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.;])\s+/)
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a fact-worded invariant comment to name the test path that enforces it (CLAUDE.md §3.2)'
    },
    schema: [],
    messages: {
      noTest:
        'This comment states an invariant as fact ({{phrase}}) but names no test that would fail if it stopped being true — so it reads as verification while verifying nothing (CLAUDE.md §3.2, §4 #21). Either name the enforcing test path (e.g. `packages/core/test/foo.test.ts`) — an issue number does not count — or word it as intent ("intended to …").'
    }
  },
  create(context) {
    return {
      Program() {
        for (const comment of toLogicalComments(
          context.sourceCode.getAllComments()
        )) {
          if (TEST_REFERENCE.test(comment.text)) continue
          for (const sentence of sentences(comment.text)) {
            if (INTENT.test(sentence)) continue
            const trigger = TRIGGERS.find(([, matcher]) =>
              matcher.test(sentence)
            )
            if (trigger === undefined) continue
            context.report({
              loc: comment.loc,
              messageId: 'noTest',
              data: { phrase: trigger[0] }
            })
            // One report per comment: a docblock that trips twice is still one edit.
            break
          }
        }
      }
    }
  }
}
