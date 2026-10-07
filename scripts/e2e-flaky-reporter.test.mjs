import { test } from 'node:test'
import assert from 'node:assert/strict'
import FlakyReporter, {
  collectFlaky,
  escapeProperty,
  formatAnnotation,
  formatSummary
} from './e2e-flaky-reporter.mjs'

// A minimal stand-in for Playwright's TestCase: only the members the reporter reads.
function tc(
  outcome,
  statuses,
  { title = 'does a thing', project = 'chromium', error } = {}
) {
  return {
    outcome: () => outcome,
    titlePath: () => ['', project, 'specs/x.spec.ts', 'group', title],
    location: { file: '/repo/e2e/specs/x.spec.ts', line: 42, column: 3 },
    results: statuses.map((status) => ({
      status,
      error:
        status === 'passed'
          ? undefined
          : { message: error ?? 'Error: boom\n  at x' }
    }))
  }
}

test('only the flaky outcome is collected', () => {
  const flaky = collectFlaky(
    [
      tc('expected', ['passed']),
      tc('unexpected', ['failed', 'failed']),
      tc('skipped', ['skipped']),
      tc('flaky', ['failed', 'passed'], { title: 'the retried one' })
    ],
    '/repo'
  )
  assert.equal(flaky.length, 1)
  assert.deepEqual(flaky[0], {
    project: 'chromium',
    title: 'group › the retried one',
    file: 'e2e/specs/x.spec.ts',
    line: 42,
    attempts: 2,
    error: 'Error: boom'
  })
})

test('the first error is ANSI-stripped, first-line only', () => {
  const [f] = collectFlaky(
    [
      tc('flaky', ['failed', 'passed'], {
        error: '\u001b[31mexpect(x).toBe\u001b[39m\nmore'
      })
    ],
    '/repo'
  )
  assert.equal(f.error, 'expect(x).toBe')
})

test('annotation is a ::warning with file/line and escaped properties', () => {
  const [f] = collectFlaky(
    [tc('flaky', ['failed', 'passed'], { title: 'a: b, c' })],
    '/repo'
  )
  const line = formatAnnotation(f)
  assert.match(line, /^::warning file=e2e\/specs\/x\.spec\.ts,line=42,title=/)
  // `:` and `,` inside a property would otherwise end the property list early.
  assert.ok(line.includes(escapeProperty('a: b, c')))
  assert.ok(!line.includes('\n'))
})

test('summary lists every flaky test, and says so explicitly when there are none', () => {
  assert.match(formatSummary([]), /None/)
  const flaky = collectFlaky(
    [
      tc('flaky', ['failed', 'passed'], { title: 'one | pipe' }),
      tc('flaky', ['failed', 'passed'])
    ],
    '/repo'
  )
  const md = formatSummary(flaky)
  assert.match(md, /\*\*2\*\* tests failed and then passed on retry/)
  assert.match(md, /one \\\| pipe/)
  assert.equal(
    md.split('\n').filter((l) => l.startsWith('| chromium')).length,
    2
  )
})

function run(env, tests) {
  const out = []
  const summaries = []
  const r = new FlakyReporter({
    env,
    write: (s) => out.push(s),
    appendSummary: (file, s) => summaries.push([file, s])
  })
  r.onBegin({}, { allTests: () => tests })
  r.onEnd({ status: 'passed' })
  return { out, summaries }
}

test('in GitHub Actions: one ::warning per flaky test plus a job-summary section', () => {
  const { out, summaries } = run(
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_STEP_SUMMARY: '/tmp/s.md',
      GITHUB_WORKSPACE: '/repo'
    },
    [tc('flaky', ['failed', 'passed']), tc('expected', ['passed'])]
  )
  assert.equal(out.length, 1)
  assert.match(out[0], /^::warning /)
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0][0], '/tmp/s.md')
  assert.match(summaries[0][1], /Flaky e2e tests/)
})

test('a clean run in Actions still writes the summary section (so "none" is visible, not absent)', () => {
  const { out, summaries } = run(
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_STEP_SUMMARY: '/tmp/s.md',
      GITHUB_WORKSPACE: '/repo'
    },
    [tc('expected', ['passed'])]
  )
  assert.equal(out.length, 0)
  assert.match(summaries[0][1], /None/)
})

test('outside Actions: plain lines, no workflow commands, no summary file', () => {
  const { out, summaries } = run({}, [tc('flaky', ['failed', 'passed'])])
  assert.equal(out.length, 1)
  assert.match(out[0], /^\[flaky\] \[chromium\]/)
  assert.equal(summaries.length, 0)
})
