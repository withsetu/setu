// Enforce the expiry of the audit allowlist (#1152).
//
// `auditConfig.ignoreGhsas` in pnpm-workspace.yaml may only hold advisories with NO patched
// release for the version range we actually install, and `pnpm audit` keeps ignoring an entry
// forever once it is there. This check is that entry's expiry: for every allowlisted GHSA it asks
// the GitHub Advisory Database (GET https://api.github.com/advisories/{ghsa_id}) whether the
// advisory still deserves to be ignored, and fails when it does not.
//
// An entry is STALE (exit 1) when, for the package versions resolved in pnpm-lock.yaml:
//   * patched    — an installed version sits in a vulnerable range that now has a
//                  `first_patched_version` (upgrade, then delete the entry);
//   * unaffected — no installed version sits in ANY vulnerable range, so the entry suppresses
//                  nothing (delete it);
//   * withdrawn  — the advisory itself was withdrawn (delete it).
// "Installed" rather than "any range" because an advisory can list a patched range in a major
// we don't use (GHSA-qwww-vcr4-c8h2 was patched in 8.x long before 7.x) — that is exactly the
// case the allowlist exists for, and must not fail.
//
// Anything that stops the check from DECIDING — network failure, non-200, a malformed body, a
// range or version this parser can't read, a pnpm-workspace.yaml shape it doesn't recognise —
// is exit 2 with a distinct "could not verify" message. It never passes silently: a dead check
// and a clean allowlist must not look the same.
//
// Kept dependency-free (node builtins only). The pure decision logic (parseIgnoreGhsas,
// parseLockfileVersions, satisfies, evaluateAdvisory) is separate from fetch so it is tested
// with fixtures; every behaviour described above is asserted in
// scripts/audit-allowlist-expiry.test.mjs.
//
// Usage:  node scripts/audit-allowlist-expiry.mjs   (GITHUB_TOKEN / GH_TOKEN used if set)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { isDirectInvocation } from './auth-login-link.mjs'

const GHSA_RE = /GHSA(?:-[0-9a-z]{4}){3}/
const GHSA_ONLY = new RegExp(`^${GHSA_RE.source}$`)

/** A failure to DECIDE (as opposed to a decision that an entry is stale). */
export class VerifyError extends Error {}

// ─── pnpm-workspace.yaml ──────────────────────────────────────────────────────

/**
 * Extract `auditConfig.ignoreGhsas` from pnpm-workspace.yaml text. Hand-parsed (no YAML dep in
 * the root), so it accepts only the shapes it can read with certainty — a block list of plain or
 * quoted ids, or an inline `[]` / `[a, b]` — and throws VerifyError on anything else rather than
 * returning a short list.
 *
 * @param {string} text
 * @returns {{ id: string, issue: string | null }[]} each entry with the tracking issue named by
 *   an `Expiry…#N` line in the comment block directly above it (null when none)
 */
export function parseIgnoreGhsas(text) {
  const lines = text.split(/\r?\n/)
  const auditIdx = lines.findIndex((l) => /^auditConfig:\s*(#.*)?$/.test(l))
  if (auditIdx === -1) {
    if (/ignoreGhsas/.test(stripComments(text)))
      throw new VerifyError(
        'found `ignoreGhsas` outside a top-level `auditConfig:` block'
      )
    return []
  }

  let keyIdx = -1
  let keyIndent = 0
  for (let i = auditIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l) && !l.startsWith('#')) break // next top-level key
    const m = /^(\s+)ignoreGhsas:\s*(.*?)\s*(#.*)?$/.exec(l)
    if (m) {
      keyIdx = i
      keyIndent = m[1].length
      if (m[2] !== '') return parseInline(m[2])
      break
    }
  }
  if (keyIdx === -1) {
    if (/ignoreGhsas/.test(stripComments(text)))
      throw new VerifyError('found `ignoreGhsas` in an unrecognised position')
    return []
  }

  const entries = []
  let comments = []
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') {
      comments = []
      continue
    }
    if (/^\s*#/.test(l)) {
      comments.push(l)
      continue
    }
    const indent = /^(\s*)/.exec(l)[1].length
    if (indent <= keyIndent) break // end of the list
    const item = /^\s*-\s+(['"]?)([^'"#\s]+)\1\s*(#.*)?$/.exec(l)
    if (!item || !GHSA_ONLY.test(item[2]))
      throw new VerifyError(
        `unrecognised ignoreGhsas line ${i + 1}: ${JSON.stringify(l.trim())}`
      )
    entries.push({ id: item[2], issue: expiryIssue(comments) })
    comments = []
  }

  // Belt and braces: every GHSA id on a non-comment line of the file must have been read. A
  // shape the loop above skipped would otherwise shrink the checked set without a sound.
  const outside = (
    stripComments(text).match(new RegExp(GHSA_RE.source, 'g')) ?? []
  ).length
  if (outside !== entries.length)
    throw new VerifyError(
      `read ${entries.length} ignoreGhsas entries but the file has ${outside} GHSA ids outside comments`
    )
  return entries
}

function parseInline(value) {
  const m = /^\[(.*)\]$/.exec(value)
  if (!m)
    throw new VerifyError(`unrecognised inline ignoreGhsas value: ${value}`)
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter(Boolean)
    .map((id) => {
      if (!GHSA_ONLY.test(id))
        throw new VerifyError(`not a GHSA id: ${JSON.stringify(id)}`)
      return { id, issue: null }
    })
}

function stripComments(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n')
}

function expiryIssue(comments) {
  let issue = null
  for (const c of comments) {
    const m = /Expiry[^#\n]*#(\d+)/i.exec(c)
    if (m) issue = `#${m[1]}`
  }
  return issue
}

// ─── pnpm-lock.yaml ───────────────────────────────────────────────────────────

/**
 * Map every package name in the lockfile's `packages:` section to the set of versions resolved
 * for it (peer-suffixes such as `(react@19.2.8)` stripped).
 * @param {string} text
 * @returns {Map<string, Set<string>>}
 */
export function parseLockfileVersions(text) {
  const out = new Map()
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf('packages:')
  if (start === -1)
    throw new VerifyError('pnpm-lock.yaml has no `packages:` section')
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l)) break // next top-level section (snapshots:)
    const m = /^ {2}'?((?:@[^@/\s']+\/)?[^@\s']+)@([^('\s:]+)/.exec(l)
    if (!m) continue
    if (!out.has(m[1])) out.set(m[1], new Set())
    out.get(m[1]).add(m[2])
  }
  if (out.size === 0)
    throw new VerifyError('pnpm-lock.yaml `packages:` section listed nothing')
  return out
}

// ─── semver subset (GHSA range syntax) ────────────────────────────────────────

/** @returns {{ nums: number[], pre: (string|number)[] }} @throws {VerifyError} */
export function parseVersion(v) {
  const m =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      v.trim()
    )
  if (!m) throw new VerifyError(`unparseable version ${JSON.stringify(v)}`)
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4]
      ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
      : []
  }
}

/** semver precedence: <0, 0, >0 */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++)
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length // release > prerelease
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1
    if (i >= y.pre.length) return 1
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

/**
 * Does `version` satisfy a GHSA `vulnerable_version_range` such as `>= 7.12.0, < 7.18.2`,
 * `<= 3.0.3` or `= 1.2.3` (comma = AND)? Throws VerifyError on syntax it can't read.
 */
export function satisfies(version, range) {
  const parts = String(range)
    .split(',')
    .map((s) => s.trim())
  if (parts.length === 0 || parts.some((p) => p === ''))
    throw new VerifyError(`unparseable range ${JSON.stringify(range)}`)
  return parts.every((p) => {
    const m = /^(<=|>=|<|>|=)\s*(\S+)$/.exec(p)
    if (!m) throw new VerifyError(`unparseable range ${JSON.stringify(range)}`)
    const c = compareVersions(version, m[2])
    switch (m[1]) {
      case '<':
        return c < 0
      case '<=':
        return c <= 0
      case '>':
        return c > 0
      case '>=':
        return c >= 0
      default:
        return c === 0
    }
  })
}

// ─── decision ─────────────────────────────────────────────────────────────────

/**
 * Decide whether one allowlist entry is still justified. Pure: no I/O.
 *
 * @param {{ id: string, issue: string | null }} entry
 * @param {any} advisory the parsed body of GET /advisories/{ghsa_id}
 * @param {Map<string, Set<string>>} installed from parseLockfileVersions
 * @returns {{ id: string, stale: { kind: 'patched'|'unaffected'|'withdrawn', message: string }[], ok: string[] }}
 * @throws {VerifyError} when the advisory body can't be evaluated
 */
export function evaluateAdvisory(entry, advisory, installed) {
  const { id } = entry
  const close = entry.issue
    ? `close ${entry.issue}`
    : 'close its tracking issue'
  const dropEntry = `delete the ${id} ignoreGhsas entry in pnpm-workspace.yaml and ${close}`

  if (!advisory || typeof advisory !== 'object' || advisory.ghsa_id !== id)
    throw new VerifyError(
      `${id}: response is not the advisory that was requested`
    )
  if (advisory.withdrawn_at) {
    return {
      id,
      ok: [],
      stale: [
        {
          kind: 'withdrawn',
          message: `${id} was WITHDRAWN on ${advisory.withdrawn_at}. Action: ${dropEntry}.`
        }
      ]
    }
  }
  if (!Array.isArray(advisory.vulnerabilities))
    throw new VerifyError(`${id}: response has no vulnerabilities[] array`)

  const npm = advisory.vulnerabilities.filter(
    (v) => v?.package?.ecosystem === 'npm'
  )
  if (npm.length === 0)
    throw new VerifyError(`${id}: advisory lists no npm vulnerabilities`)

  const stale = []
  const ok = []
  const byPkg = new Map()
  for (const v of npm) {
    const name = v.package.name
    if (
      typeof name !== 'string' ||
      typeof v.vulnerable_version_range !== 'string'
    )
      throw new VerifyError(
        `${id}: vulnerability entry without a package name or range`
      )
    if (!byPkg.has(name)) byPkg.set(name, [])
    byPkg.get(name).push(v)
  }

  let affectsAnything = false
  const summary = []
  for (const [name, vulns] of byPkg) {
    const versions = [...(installed.get(name) ?? [])]
    summary.push(`${name} installed: ${versions.join(', ') || 'none'}`)
    for (const v of vulns) {
      const range = v.vulnerable_version_range
      const hits = versions.filter((ver) => satisfies(ver, range))
      if (hits.length === 0) continue
      affectsAnything = true
      const patched = v.first_patched_version
      if (patched) {
        stale.push({
          kind: 'patched',
          message:
            `${id}: ${name} ${range} (installed ${hits.join(', ')}) now has a patched release: ` +
            `${patched}. Action: upgrade ${name} to ${patched} or later, then ${dropEntry}.`
        })
      } else {
        ok.push(
          `${id}: ${name} ${range} (installed ${hits.join(', ')}) — still no patched release.`
        )
      }
    }
  }

  if (!affectsAnything) {
    const ranges = npm
      .map(
        (v) =>
          `${v.package.name} ${v.vulnerable_version_range}` +
          (v.first_patched_version ? ` → ${v.first_patched_version}` : '')
      )
      .join('; ')
    stale.push({
      kind: 'unaffected',
      message:
        `${id}: no installed version falls in any vulnerable range (${ranges}; ${summary.join('; ')}), ` +
        `so the entry suppresses nothing. Action: ${dropEntry}.`
    })
  }
  return { id, stale, ok }
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

/**
 * GET https://api.github.com/advisories/{ghsa_id}. Every failure is a VerifyError.
 * @param {string} id
 * @param {{ fetch?: typeof fetch, token?: string, timeoutMs?: number }} [opts]
 */
export async function fetchAdvisory(id, opts = {}) {
  const doFetch = opts.fetch ?? fetch
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'setu-audit-allowlist-expiry'
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  let res
  try {
    res = await doFetch(`https://api.github.com/advisories/${id}`, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000)
    })
  } catch (err) {
    throw new VerifyError(`${id}: request failed — ${err?.message ?? err}`)
  }
  if (res.status !== 200)
    throw new VerifyError(
      `${id}: GitHub Advisory API returned HTTP ${res.status}`
    )
  try {
    return await res.json()
  } catch {
    throw new VerifyError(
      `${id}: GitHub Advisory API returned a body that is not JSON`
    )
  }
}

/**
 * Run the whole check. Returns the exit code: 0 all entries justified, 1 a stale entry,
 * 2 could not verify.
 */
export async function run({
  workspaceText,
  lockText,
  fetchImpl,
  token,
  log = console.log,
  err = console.error
}) {
  let entries
  let installed
  try {
    entries = parseIgnoreGhsas(workspaceText)
    if (entries.length === 0) {
      log(
        'audit-allowlist-expiry: pnpm-workspace.yaml has no ignoreGhsas entries — nothing to check.'
      )
      return 0
    }
    installed = parseLockfileVersions(lockText)
  } catch (e) {
    return couldNotVerify([e], err)
  }

  const errors = []
  const stale = []
  for (const entry of entries) {
    try {
      const advisory = await fetchAdvisory(entry.id, {
        fetch: fetchImpl,
        token
      })
      const r = evaluateAdvisory(entry, advisory, installed)
      for (const line of r.ok) log(`  ok     ${line}`)
      for (const s of r.stale) {
        log(`  STALE  ${s.message}`)
        stale.push(s)
      }
    } catch (e) {
      errors.push(e)
    }
  }

  if (errors.length) return couldNotVerify(errors, err)
  if (stale.length) {
    err(
      `::error::audit allowlist: ${stale.length} ignoreGhsas entr${stale.length === 1 ? 'y has' : 'ies have'} expired — ` +
        stale.map((s) => s.message).join(' | ')
    )
    return 1
  }
  log(
    `audit-allowlist-expiry: all ${entries.length} ignoreGhsas entries still have no patched release for the installed versions.`
  )
  return 0
}

function couldNotVerify(errors, err) {
  for (const e of errors) {
    if (!(e instanceof VerifyError)) throw e // a bug in this script, not a verdict — surface it
    err(
      `::error::audit allowlist COULD NOT BE VERIFIED (this is not a pass): ${e.message}`
    )
  }
  return 2
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const code = await run({
    workspaceText: readFileSync(`${root}pnpm-workspace.yaml`, 'utf8'),
    lockText: readFileSync(`${root}pnpm-lock.yaml`, 'utf8'),
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined
  })
  process.exitCode = code
}

if (isDirectInvocation(process.argv[1], import.meta.url)) await main()
