// Playwright reporter that makes a retried-then-passed ("flaky") test visible (#1201).
//
// CI runs the e2e suite with `retries` > 0, so a test that fails once and passes on retry leaves
// the job green and, without this reporter, says nothing — 8 of 30 green main runs carried such a
// test, one of them a real data-loss bug (#1195). We deliberately do NOT set `failOnFlakyTests`:
// with required status checks on main, every flake would block every merge. Instead each flaky
// test becomes:
//   - a GitHub Actions `::warning` annotation (file + line, shown on the run and the PR), and
//   - a "Flaky tests" section in the job summary ($GITHUB_STEP_SUMMARY),
// and, outside Actions, one plain line per flaky test on stdout.
//
// Reporter API used (verified against Playwright 1.62.1's types/testReporter.d.ts and the docs at
// playwright.dev/docs/api/class-reporter): `onBegin(config, suite)`, `onEnd(result)`,
// `suite.allTests()`, and `TestCase.outcome()`, which is `'flaky'` exactly when a test failed and
// then passed on a retry. The pure helpers are exported for scripts/e2e-flaky-reporter.test.mjs.
import fs from 'node:fs'
import path from 'node:path'

/** Escape a workflow-command MESSAGE (the part after `::`) — the same rules as @actions/core's
 *  `escapeData` (actions/toolkit packages/core/src/command.ts): `%`, CR, LF. */
export function escapeData(s) {
  return String(s)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}

/** Escape a workflow-command PROPERTY value (file=, title=) — @actions/core's `escapeProperty`:
 *  the data rules plus `:` and `,`, which delimit properties. */
export function escapeProperty(s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

/** ANSI colour codes (ESC `[` … `m`) Playwright embeds in error messages. Built from a string so
 *  the regex source carries no literal control character. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** First line of the first error any failed attempt recorded, ANSI-stripped and capped. */
function firstErrorLine(results) {
  for (const r of results) {
    const msg = r.error?.message ?? r.errors?.[0]?.message
    if (msg) {
      const line = msg.replace(ANSI_SGR, '').split('\n')[0].trim()
      return line.length > 200 ? `${line.slice(0, 197)}...` : line
    }
  }
  return ''
}

/** Reduce Playwright TestCases to plain flaky-test records. Anything whose outcome is not
 *  `'flaky'` (passed first time, failed outright, skipped) is left out. */
export function collectFlaky(tests, workspaceDir) {
  const out = []
  for (const t of tests) {
    if (t.outcome() !== 'flaky') continue
    // titlePath(): ['', projectName, file, ...describes, title]
    const [, project = '', , ...titles] = t.titlePath()
    out.push({
      project,
      title: titles.join(' › '),
      file: path.relative(workspaceDir, t.location.file),
      line: t.location.line,
      attempts: t.results.length,
      error: firstErrorLine(t.results.filter((r) => r.status !== 'passed'))
    })
  }
  return out
}

export function formatAnnotation(f) {
  const title = `Flaky test (passed on retry ${f.attempts - 1}): [${f.project}] ${f.title}`
  const msg =
    `Failed then passed on retry — the retry hid a failure. ${f.error ? `First error: ${f.error}` : ''}`.trim()
  return `::warning file=${escapeProperty(f.file)},line=${f.line},title=${escapeProperty(title)}::${escapeData(msg)}`
}

/** Make a value safe inside one GFM table cell. Backslashes are escaped FIRST, so an input
 *  `\|` cannot turn our own `\|` into `\\|` (an escaped backslash followed by a live column
 *  separator); then `|` is escaped, and CR/LF (which would end the row) become spaces. Enforced by
 *  scripts/e2e-flaky-reporter.test.mjs ("table cells survive backslashes, pipes and newlines"). */
export function mdCell(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, ' ')
}

export function formatSummary(flaky, heading = 'Flaky e2e tests') {
  if (flaky.length === 0)
    return `### ${heading}\n\nNone — no test needed a retry to pass.\n`
  const rows = flaky.map(
    (f) =>
      `| ${mdCell(f.project)} | ${mdCell(f.title)} | \`${mdCell(f.file).replace(/`/g, "'")}:${f.line}\` | ${f.attempts} | ${mdCell(f.error)} |`
  )
  return [
    `### ${heading}`,
    '',
    `:warning: **${flaky.length}** test${flaky.length === 1 ? '' : 's'} failed and then passed on retry. The run is green, but each row is a real failure that a retry hid — investigate, don't ignore.`,
    '',
    '| Project | Test | Location | Attempts | First error |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n')
}

export default class FlakyReporter {
  constructor(options = {}) {
    this.heading = options.heading ?? 'Flaky e2e tests'
    this.env = options.env ?? process.env
    this.write = options.write ?? ((s) => process.stdout.write(s))
    this.appendSummary =
      options.appendSummary ?? ((file, s) => fs.appendFileSync(file, s))
  }

  printsToStdio() {
    return false
  }

  onBegin(_config, suite) {
    this.suite = suite
  }

  onEnd() {
    if (!this.suite) return
    const workspace = this.env.GITHUB_WORKSPACE || process.cwd()
    const flaky = collectFlaky(this.suite.allTests(), workspace)
    const inActions = this.env.GITHUB_ACTIONS === 'true'
    for (const f of flaky) {
      this.write(
        inActions
          ? `${formatAnnotation(f)}\n`
          : `[flaky] [${f.project}] ${f.title} (${f.file}:${f.line}) passed only after ${f.attempts} attempts\n`
      )
    }
    const summaryFile = this.env.GITHUB_STEP_SUMMARY
    if (inActions && summaryFile)
      this.appendSummary(summaryFile, `${formatSummary(flaky, this.heading)}\n`)
  }
}
