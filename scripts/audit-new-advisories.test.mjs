import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuditParseError,
  newAdvisories,
  parseAudit,
  run
} from './audit-new-advisories.mjs'

// ─── fixtures ────────────────────────────────────────────────────────────────

/** The shape `pnpm@11 audit --json` emits (checked against a real run, 2026-10-07). */
function auditJson(advisories, totalDependencies = 1105) {
  return JSON.stringify({
    advisories: Object.fromEntries(
      advisories.map(([ghsa, severity, module_name], i) => [
        String(1000 + i),
        {
          id: 1000 + i,
          github_advisory_id: ghsa,
          severity,
          module_name,
          title: `${module_name} bug`
        }
      ])
    ),
    metadata: { totalDependencies }
  })
}

const BASE = auditJson([
  ['GHSA-old1-high-aaaa', 'high', 'sharp'],
  ['GHSA-old2-mode-bbbb', 'moderate', 'esbuild']
])

function files(base, head) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-new-'))
  writeFileSync(join(dir, 'base.json'), base)
  writeFileSync(join(dir, 'head.json'), head)
  return [join(dir, 'base.json'), join(dir, 'head.json')]
}

function capture() {
  const out = []
  return { log: (s) => out.push(s), text: () => out.join('\n') }
}

// ─── parseAudit ──────────────────────────────────────────────────────────────

test('parseAudit reads ghsa, severity and module from each advisory', () => {
  const parsed = parseAudit(BASE)
  assert.equal(parsed.examined, 1105)
  assert.deepEqual(parsed.advisories, [
    {
      key: 'GHSA-old1-high-aaaa',
      severity: 'high',
      module: 'sharp',
      title: 'sharp bug'
    },
    {
      key: 'GHSA-old2-mode-bbbb',
      severity: 'moderate',
      module: 'esbuild',
      title: 'esbuild bug'
    }
  ])
})

test('parseAudit falls back to the npm advisory id when there is no ghsa', () => {
  const json = JSON.stringify({
    advisories: {
      7: { id: 7, severity: 'high', module_name: 'x', title: 't' }
    },
    metadata: { totalDependencies: 3 }
  })
  assert.equal(parseAudit(json).advisories[0].key, 'npm:7')
})

test('parseAudit fails closed on a vacuous or unreadable scan', () => {
  assert.throws(() => parseAudit('not json'), AuditParseError)
  assert.throws(() => parseAudit('{}'), AuditParseError)
  assert.throws(() => parseAudit(auditJson([], 0)), AuditParseError)
  assert.throws(
    () => parseAudit(JSON.stringify({ metadata: { totalDependencies: 5 } })),
    AuditParseError
  )
})

// ─── newAdvisories ───────────────────────────────────────────────────────────

test('newAdvisories returns only high+ advisories absent from the base', () => {
  const head = parseAudit(
    auditJson([
      ['GHSA-old1-high-aaaa', 'high', 'sharp'], // pre-existing: not the PR's
      ['GHSA-new1-crit-cccc', 'critical', 'lodash'], // introduced: gates
      ['GHSA-new2-high-dddd', 'high', 'braces'], // introduced: gates
      ['GHSA-new3-mode-eeee', 'moderate', 'foo'] // introduced but below the bar
    ])
  )
  assert.deepEqual(
    newAdvisories(parseAudit(BASE), head).map((a) => a.key),
    ['GHSA-new1-crit-cccc', 'GHSA-new2-high-dddd']
  )
})

test('an advisory the base had at a lower severity is not new', () => {
  const head = parseAudit(
    auditJson([['GHSA-old2-mode-bbbb', 'high', 'esbuild']])
  )
  assert.deepEqual(newAdvisories(parseAudit(BASE), head), [])
})

// ─── run ─────────────────────────────────────────────────────────────────────

test('run exits 1 and names the advisory a PR introduces', () => {
  const out = capture()
  const head = auditJson([
    ['GHSA-old1-high-aaaa', 'high', 'sharp'],
    ['GHSA-new1-crit-cccc', 'critical', 'lodash']
  ])
  assert.equal(run(files(BASE, head), out.log), 1)
  assert.match(out.text(), /GHSA-new1-crit-cccc/)
  assert.match(out.text(), /lodash/)
})

test('run exits 0 when every high+ advisory already exists on the base, and still lists them', () => {
  const out = capture()
  assert.equal(run(files(BASE, BASE), out.log), 0)
  assert.match(out.text(), /GHSA-old1-high-aaaa/)
})

test('run exits 2 (fail closed) when either scan is vacuous or missing', () => {
  assert.equal(run(files(auditJson([], 0), BASE), capture().log), 2)
  assert.equal(run(files(BASE, 'garbage'), capture().log), 2)
  assert.equal(
    run(['/nonexistent/base.json', '/nonexistent/head.json'], capture().log),
    2
  )
  assert.equal(run([], capture().log), 2)
})
