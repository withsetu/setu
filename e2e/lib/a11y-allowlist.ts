import type { AxeResults, Result as AxeViolation, NodeResult } from 'axe-core'

/** One known, already-triaged a11y violation we allow (report, don't fail) — see
 *  task-1-report.md for the full reconciliation against a real scan. Matching is by
 *  `ruleId` (axe's `Result.id`) plus a substring of the violating node's rendered HTML
 *  (`NodeResult.html`) — NOT axe's derived `target` CSS selector, which is unstable
 *  across runs for these components (Tailwind's arbitrary-value/utility classes get
 *  serialized into a minimal-but-not-deterministic selector, e.g. `.w-fit` one run and
 *  `.bg-warning\/15.text-warning[data-variant="warning"]` the next, for the exact same
 *  Badge element — verified empirically in task-1-report.md's two scan runs). The
 *  rendered `html` string is the actual DOM as emitted (tag + real class attribute +
 *  text), which is what stays stable run over run. */
export interface KnownViolation {
  ruleId: string
  /** A substring to match against each violating node's rendered HTML (`NodeResult.html`)
   *  — e.g. a stable `data-*` attribute, class fragment, or text snippet. */
  selectorContains: string
  /** The tracking issue this violation is filed under — '#295' for the known trio, or
   *  the literal `'#307'` placeholder for a newly-discovered product violation this
   *  task found but did not yet get a real issue number for (see report). */
  issue: string
  note: string
}

// Built from a REAL scan (task-1-report.md has the full per-surface raw dump) — every
// entry below is something axe actually reported against these 6 surfaces, reconciled
// one by one. None of #295's known trio (canvas contenteditable exposed as `generic`;
// slash-option names concatenated; DragHandle/BlockMenu shared "Block actions" label)
// showed up as an axe violation in this scan — axe doesn't flag "generic instead of
// textbox" or "labels concatenated" as WCAG failures on their own, and the shared
// aria-label is disambiguated by role, which axe accepts. Everything found instead is a
// single rule, `color-contrast`, across several distinct design-token/component gaps —
// all NEW real product violations, filed as `issue: '#307'` per the brief (the
// controller will create real issues from this list; see task-1-report.md).
export const KNOWN_VIOLATIONS: KnownViolation[] = [
  {
    ruleId: 'color-contrast',
    selectorContains: 'data-slot="badge" data-variant="warning"',
    issue: '#307',
    note:
      'Badge variant="warning" (e.g. the "Draft" status badge) — light-mode --warning ' +
      '(#b7791f text on a ~15%-alpha warning tile) falls under the AA 4.5:1 text threshold. ' +
      'Seen in the editor header StripStatus badge and the content-list status column.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'data-slot="badge" data-variant="info"',
    issue: '#307',
    note:
      'Badge variant="info" (e.g. a "Staged" status badge) — light-mode --info (#2563eb ' +
      'text on a ~15%-alpha info tile) falls under the AA 4.5:1 text threshold. Seen in the ' +
      'content-list status column.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'data-slot="badge" data-variant="outline"',
    issue: '#307',
    note:
      'Badge variant="outline" (category/tag chips in the content-list) — the outline ' +
      "badge's foreground/border combination falls under the AA 4.5:1 threshold against " +
      'the row background.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'text-[12.5px] text-muted-foreground',
    issue: '#307',
    note:
      'ContentTable row subtitle (the slug/path line under a post title) uses ' +
      '--muted-foreground (#54545d) at 12.5px, which falls under AA 4.5:1 against the ' +
      'table row background (including the zebra-striped bg-muted/25 rows).'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'pr-6 text-right text-muted-foreground',
    issue: '#307',
    note:
      'ContentTable "Updated" relative-time cell — same --muted-foreground contrast gap ' +
      'as the row subtitle, in the rightmost column.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains:
      '[role=checkbox])]:pr-0 [&amp;&gt;[role=checkbox]]:translate-y-[2px] text-muted-foreground">',
    issue: '#307',
    note:
      'ContentTable locale cell ("en") — plain text-muted-foreground table cell (no ' +
      '`text-right`, distinguishing it from the "Updated" cell above), same ' +
      '--muted-foreground contrast gap as the other muted row text.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains:
      'truncate text-[15px] font-medium text-foreground hover:underline',
    issue: '#307',
    note:
      'ContentTable row title link (text-foreground) — passes AA against the plain ' +
      '--background, but ContentTable.tsx tints alternating rows with `bg-muted/25` ' +
      '(zebra striping) and selected rows with `bg-primary/10`; against those tinted ' +
      'backgrounds the same text-foreground color falls under the AA 4.5:1 threshold.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'text-muted-foreground/50" title="Coming soon"',
    issue: '#307',
    note:
      'Settings sub-nav "Coming soon" disabled entries (Users & Roles, Deploy) — ' +
      'text-muted-foreground at 50% opacity falls well under the AA 4.5:1 threshold. A ' +
      'disabled/coming-soon affordance still needs to meet contrast if it renders visible text.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'class="slash-head" role="presentation"',
    issue: '#307',
    note:
      'Slash-menu category heading (SlashCommand.tsx, e.g. "Text" grouping the block ' +
      'options) — the `.slash-head` text color falls under the AA 4.5:1 threshold against ' +
      'the popup background. Found on a second scan run: the popup only renders the ' +
      'category headings for rows currently visible/filtered, so which real elements axe ' +
      'sees varies run to run — not a flaky finding, three distinct real elements in the ' +
      'same component.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'class="slash-label"',
    issue: '#307',
    note:
      'Slash-menu option title (SlashCommand.tsx CommandList, e.g. "Text") — the ' +
      '`.slash-label` text color falls under the AA 4.5:1 threshold against the popup ' +
      'background. Found while scanning the editor with the slash menu open.'
  },
  {
    ruleId: 'color-contrast',
    selectorContains: 'class="slash-desc"',
    issue: '#307',
    note:
      'Slash-menu option subtitle (e.g. "Plain paragraph") — the `.slash-desc` (more muted ' +
      'than `.slash-label`) text color falls under the AA 4.5:1 threshold against the popup ' +
      'background. Found while scanning the editor with the slash menu open.'
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
  surface: string,
  unexpected: UnexpectedViolation[]
): string {
  const lines = unexpected.map(
    (v, i) =>
      `  ${i + 1}. [${v.impact}] ${v.ruleId} — ${v.help}\n` +
      `     selector: ${v.selector}\n` +
      `     html: ${v.html.slice(0, 200)}\n` +
      `     help: ${v.helpUrl}`
  )
  return `${surface}: ${unexpected.length} new (non-allowlisted) axe violation(s):\n${lines.join('\n')}`
}

/** A readable dump of known (allowlisted) violations, for console reporting. */
export function formatKnownViolations(
  surface: string,
  known: ClassifiedViolations['known']
): string {
  if (known.length === 0)
    return `${surface}: 0 known (allowlisted) axe violations`
  const lines = known.map(
    (k, i) =>
      `  ${i + 1}. [${k.entry.issue}] ${k.violation.id} — ${nodeSelector(k.node)} (${k.entry.note})`
  )
  return `${surface}: ${known.length} known (allowlisted) axe violation(s):\n${lines.join('\n')}`
}
