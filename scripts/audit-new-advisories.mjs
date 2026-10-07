// PR audit gate: fail only on high/critical advisories the PR introduces (#1211).
//
// Compares two `pnpm@11 audit --json` scans, one of the base branch's lockfile and one of the
// PR's, by advisory id (GHSA, or the npm advisory id when there is none). An advisory gates the
// PR when it is high/critical in the PR's scan and absent from the base scan at any severity.
// Advisories the base already had are listed as a warning but do not fail the PR: they are
// main's to fix, and main's own full-lockfile gate (push / weekly / dispatch in ci.yml) stays red
// until someone does.
//
// Exit codes: 0 no new high+ advisory · 1 the PR introduces one · 2 a scan could not be read or
// examined zero packages. 2 never passes: a dead gate and a clean tree must not look the same
// (the same non-vacuity rule as the canary in ci.yml, #817).
//
// Every behaviour above is asserted in scripts/audit-new-advisories.test.mjs.
//
// Usage:  node scripts/audit-new-advisories.mjs <base-audit.json> <head-audit.json>
import { readFileSync } from 'node:fs'
import { isDirectInvocation } from './auth-login-link.mjs'

const GATING = new Set(['high', 'critical'])

export class AuditParseError extends Error {}

/** Parse one scan; throws AuditParseError when it is unreadable or examined nothing. */
export function parseAudit(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new AuditParseError('audit output is not JSON')
  }
  const examined = json?.metadata?.totalDependencies
  if (!Number.isInteger(examined) || examined <= 0) {
    throw new AuditParseError(
      'audit examined 0 packages (or emitted no scan metadata)'
    )
  }
  if (typeof json.advisories !== 'object' || json.advisories === null) {
    throw new AuditParseError('audit output has no advisories map')
  }
  const advisories = Object.values(json.advisories).map((a) => ({
    key: a.github_advisory_id || `npm:${a.id}`,
    severity: a.severity,
    module: a.module_name,
    title: a.title
  }))
  return { examined, advisories }
}

/** High/critical advisories in `head` whose id the `base` scan does not contain. */
export function newAdvisories(base, head) {
  const known = new Set(base.advisories.map((a) => a.key))
  return head.advisories.filter(
    (a) => GATING.has(a.severity) && !known.has(a.key)
  )
}

function describe(a) {
  return `${a.key} (${a.severity}) ${a.module}: ${a.title}`
}

export function run(argv, log = console.log) {
  const [basePath, headPath] = argv
  let base, head
  try {
    if (!basePath || !headPath)
      throw new AuditParseError('usage: <base-audit.json> <head-audit.json>')
    base = parseAudit(readFileSync(basePath, 'utf8'))
    head = parseAudit(readFileSync(headPath, 'utf8'))
  } catch (e) {
    log(
      `::error::PR audit gate COULD NOT RUN (this is not a pass): ${e.message}`
    )
    return 2
  }
  log(
    `Base scan examined ${base.examined} packages; PR scan examined ${head.examined}.`
  )

  const introduced = newAdvisories(base, head)
  for (const a of head.advisories) {
    if (GATING.has(a.severity) && !introduced.includes(a)) {
      log(
        `::warning::already on the base branch, not this PR's to fix: ${describe(a)}`
      )
    }
  }
  if (introduced.length === 0) {
    log('No high/critical advisory introduced by this PR.')
    return 0
  }
  for (const a of introduced)
    log(`::error::introduced by this PR: ${describe(a)}`)
  return 1
}

if (isDirectInvocation(process.argv[1], import.meta.url))
  process.exitCode = run(process.argv.slice(2))
