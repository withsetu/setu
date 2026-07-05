import type { AxeResults, Result as AxeViolation, NodeResult } from 'axe-core'

/** One known, already-triaged a11y violation we allow (report, don't fail) — mirrors the
 *  policy shape of e2e/lib/a11y-allowlist.ts (T1's admin-lane allowlist), implemented
 *  locally here since apps/site cannot import across the apps/e2e boundary. Matching is by
 *  `ruleId` (axe's `Result.id`) plus a substring of the violating node's rendered HTML
 *  (`NodeResult.html`) — the rendered `html` string is stable for static-site output
 *  (unlike the admin's Tailwind-generated selectors, our built HTML doesn't churn class
 *  names run to run). */
export interface KnownViolation {
  ruleId: string
  /** A substring to match against each violating node's rendered HTML (`NodeResult.html`). */
  selectorContains: string
  /** The tracking issue this violation is filed under. */
  issue: string
  note: string
}

// Built from a REAL scan of the default-content build's 14 pages (see task-2-report.md for
// the full run). Only one real violation surfaced: the read-only GFM task-list checkbox.
export const KNOWN_VIOLATIONS: KnownViolation[] = [
  {
    ruleId: 'label',
    selectorContains: 'disabled=""',
    issue: '#308',
    note:
      'Read-only task-list checkbox (apps/site/markdoc.config.mjs itemTransform) renders a ' +
      'bare <input type="checkbox" disabled> as a sibling of its label text, with no ' +
      'aria-label/aria-labelledby or wrapping <label> — so it has no accessible name. Seen ' +
      'on post/kitchen-sink (the GFM checklist demo content). NodeResult.html is the ' +
      '<input> element\'s own jsdom-serialized outerHTML — `<input type="checkbox" ' +
      'disabled="">` (unchecked) or `<input type="checkbox" checked="" disabled="">` ' +
      '(checked), so `disabled=""` is the substring common to both. Scoped to the `label` ' +
      'rule, so this only allowlists label-less DISABLED inputs — a future interactive ' +
      '(non-disabled) control missing a label would not match and would still fail.'
  }
]

interface UnexpectedViolation {
  ruleId: string
  impact: string
  help: string
  helpUrl: string
  selector: string
  html: string
}

interface ClassifiedViolations {
  /** Violations that matched an allowlist entry — reported, not fatal. */
  known: { violation: AxeViolation; entry: KnownViolation; node: NodeResult }[]
  /** Violations that matched no allowlist entry — these fail the scan. */
  unexpected: UnexpectedViolation[]
}

function nodeSelector(node: NodeResult): string {
  return node.target
    .map((t: unknown) => (typeof t === 'string' ? t : JSON.stringify(t)))
    .join(' ')
}

function findAllowlistEntry(
  violation: AxeViolation,
  node: NodeResult
): KnownViolation | undefined {
  return KNOWN_VIOLATIONS.find(
    (entry) =>
      entry.ruleId === violation.id &&
      node.html.includes(entry.selectorContains)
  )
}

/** Split an axe scan's violations into allowlisted ("known") vs. everything else
 *  ("unexpected") — per-NODE, not per-rule: a rule can hit both an allowlisted element
 *  and a fresh one on the same page, and only the latter should fail the scan. */
export function classifyViolations(results: AxeResults): ClassifiedViolations {
  const known: ClassifiedViolations['known'] = []
  const unexpected: UnexpectedViolation[] = []

  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const entry = findAllowlistEntry(violation, node)
      if (entry) {
        known.push({ violation, entry, node })
      } else {
        unexpected.push({
          ruleId: violation.id,
          impact: violation.impact ?? 'unknown',
          help: violation.help,
          helpUrl: violation.helpUrl,
          selector: nodeSelector(node),
          html: node.html
        })
      }
    }
  }

  return { known, unexpected }
}

/** A readable multi-line dump of unexpected violations for a failed `expect` message. */
export function formatUnexpectedViolations(
  page: string,
  unexpected: UnexpectedViolation[]
): string {
  const lines = unexpected.map(
    (v, i) =>
      `  ${i + 1}. [${v.impact}] ${v.ruleId} — ${v.help}\n` +
      `     selector: ${v.selector}\n` +
      `     html: ${v.html.slice(0, 200)}\n` +
      `     help: ${v.helpUrl}`
  )
  return `${page}: ${unexpected.length} new (non-allowlisted) axe violation(s):\n${lines.join('\n')}`
}

/** A readable dump of known (allowlisted) violations, for console reporting. */
export function formatKnownViolations(
  page: string,
  known: ClassifiedViolations['known']
): string {
  if (known.length === 0) return `${page}: 0 known (allowlisted) axe violations`
  const lines = known.map(
    (k, i) =>
      `  ${i + 1}. [${k.entry.issue}] ${k.violation.id} — ${nodeSelector(k.node)} (${k.entry.note})`
  )
  return `${page}: ${known.length} known (allowlisted) axe violation(s):\n${lines.join('\n')}`
}
