import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  VerifyError,
  evaluateAdvisory,
  fetchAdvisory,
  parseIgnoreGhsas,
  parseLockfileVersions,
  run,
  satisfies
} from './audit-allowlist-expiry.mjs'

// ─── fixtures ────────────────────────────────────────────────────────────────

const WORKSPACE = `packages:
  - 'packages/*'

# GHSA-mh99-v99m-4gvg was removed (a comment mentioning an id must not count as an entry).
auditConfig:
  ignoreGhsas:
    # foo DoS. Expiry: #101.
    - GHSA-aaaa-bbbb-cccc
    # bar leak. Expiry/re-check: #202.
    - 'GHSA-dddd-eeee-ffff'
`

const LOCK = `lockfileVersion: '9.0'

packages:

  foo@3.0.3:
    resolution: {integrity: sha512-x}

  '@scope/bar@7.13.0':
    resolution: {integrity: sha512-y}

  bar@1.0.0(react@19.2.8):
    resolution: {integrity: sha512-z}

snapshots:

  foo@9.9.9: {}
`

const advisory = (id, vulnerabilities, extra = {}) => ({
  ghsa_id: id,
  withdrawn_at: null,
  vulnerabilities,
  ...extra
})
const vuln = (name, range, patched = null) => ({
  package: { ecosystem: 'npm', name },
  vulnerable_version_range: range,
  first_patched_version: patched,
  vulnerable_functions: []
})

const UNPATCHED = advisory('GHSA-aaaa-bbbb-cccc', [vuln('foo', '<= 3.0.3')])
const PATCHED = advisory('GHSA-aaaa-bbbb-cccc', [
  vuln('foo', '<= 3.0.3', '3.0.4')
])
const installed = parseLockfileVersions(LOCK)
const entry = { id: 'GHSA-aaaa-bbbb-cccc', issue: '#101' }

const okResponse = (body) => ({ status: 200, json: async () => body })
const capture = () => {
  const out = []
  return { out, fn: (s) => out.push(s) }
}

// ─── parsing ─────────────────────────────────────────────────────────────────

test('parseIgnoreGhsas reads block-list entries and their Expiry issue, ignoring comments', () => {
  assert.deepEqual(parseIgnoreGhsas(WORKSPACE), [
    { id: 'GHSA-aaaa-bbbb-cccc', issue: '#101' },
    { id: 'GHSA-dddd-eeee-ffff', issue: '#202' }
  ])
})

test('parseIgnoreGhsas: no auditConfig, empty inline list → empty', () => {
  assert.deepEqual(parseIgnoreGhsas(`packages:\n  - 'apps/*'\n`), [])
  assert.deepEqual(parseIgnoreGhsas(`auditConfig:\n  ignoreGhsas: []\n`), [])
  assert.deepEqual(
    parseIgnoreGhsas(`auditConfig:\n  ignoreGhsas: ['GHSA-aaaa-bbbb-cccc']\n`),
    [{ id: 'GHSA-aaaa-bbbb-cccc', issue: null }]
  )
})

test('parseIgnoreGhsas fails closed on a shape it cannot read, never a short list', () => {
  assert.throws(
    () =>
      parseIgnoreGhsas(
        `auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n    - not-an-id\n`
      ),
    VerifyError
  )
  // An id it skipped (here: a second list nested under another key) trips the count cross-check.
  assert.throws(
    () =>
      parseIgnoreGhsas(
        `auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\nother:\n  - GHSA-dddd-eeee-ffff\n`
      ),
    /GHSA ids outside comments/
  )
})

test('parseIgnoreGhsas reads the real pnpm-workspace.yaml', () => {
  const real = readFileSync(
    new URL('../pnpm-workspace.yaml', import.meta.url),
    'utf8'
  )
  const entries = parseIgnoreGhsas(real)
  assert.ok(entries.length > 0)
  for (const e of entries)
    assert.match(e.issue ?? '', /^#\d+$/, `${e.id} names no Expiry issue`)
})

test('parseLockfileVersions reads packages: only, scoped names, strips peer suffixes', () => {
  assert.deepEqual([...installed.get('foo')], ['3.0.3'])
  assert.deepEqual([...installed.get('@scope/bar')], ['7.13.0'])
  assert.deepEqual([...installed.get('bar')], ['1.0.0'])
})

test('satisfies handles GHSA range syntax and refuses what it cannot parse', () => {
  assert.equal(satisfies('7.13.0', '>= 7.12.0, < 7.18.2'), true)
  assert.equal(satisfies('7.18.2', '>= 7.12.0, < 7.18.2'), false)
  assert.equal(satisfies('3.0.3', '<= 3.0.3'), true)
  assert.equal(satisfies('1.2.3', '= 1.2.3'), true)
  assert.equal(satisfies('8.0.0-rc.1', '>= 8.0.0'), false)
  assert.equal(satisfies('8.0.0-rc.1', '< 8.0.0'), true)
  assert.throws(() => satisfies('1.0.0', '^1.0.0'), VerifyError)
  assert.throws(() => satisfies('1.0.0', '>= 1.0.0,'), VerifyError)
})

// ─── decision ────────────────────────────────────────────────────────────────

test('unpatched advisory affecting an installed version → ok (entry still justified)', () => {
  const r = evaluateAdvisory(entry, UNPATCHED, installed)
  assert.deepEqual(r.stale, [])
  assert.equal(r.ok.length, 1)
})

test('patched advisory → stale, naming GHSA, package, range, patched version and the action', () => {
  const r = evaluateAdvisory(entry, PATCHED, installed)
  assert.equal(r.stale.length, 1)
  assert.equal(r.stale[0].kind, 'patched')
  const msg = r.stale[0].message
  for (const part of [
    'GHSA-aaaa-bbbb-cccc',
    'foo',
    '<= 3.0.3',
    '3.0.4',
    'upgrade foo to 3.0.4'
  ]) {
    assert.ok(
      msg.includes(part),
      `message lacks ${JSON.stringify(part)}: ${msg}`
    )
  }
  assert.match(
    msg,
    /delete the GHSA-aaaa-bbbb-cccc ignoreGhsas entry .* and close #101/
  )
})

test('a patched range in a major we do NOT install does not expire the entry', () => {
  // The GHSA-qwww-vcr4-c8h2 shape at allowlist time: 8.x patched, 7.x not.
  const a = advisory('GHSA-aaaa-bbbb-cccc', [
    vuln('@scope/bar', '>= 7.12.0, < 7.99.0'),
    vuln('@scope/bar', '>= 8.0.0, < 8.3.0', '8.3.0')
  ])
  assert.deepEqual(evaluateAdvisory(entry, a, installed).stale, [])
})

test('no installed version in any range → stale "unaffected" (entry suppresses nothing)', () => {
  const a = advisory('GHSA-aaaa-bbbb-cccc', [
    vuln('@scope/bar', '>= 7.12.0, < 7.13.0', '7.13.0')
  ])
  const r = evaluateAdvisory(entry, a, installed)
  assert.equal(r.stale[0].kind, 'unaffected')
  assert.match(
    r.stale[0].message,
    /suppresses nothing.*delete the GHSA-aaaa-bbbb-cccc/
  )
})

test('withdrawn advisory → stale', () => {
  const a = advisory('GHSA-aaaa-bbbb-cccc', [vuln('foo', '<= 3.0.3')], {
    withdrawn_at: '2026-01-01T00:00:00Z'
  })
  assert.equal(evaluateAdvisory(entry, a, installed).stale[0].kind, 'withdrawn')
})

test('a malformed advisory body fails closed', () => {
  assert.throws(
    () =>
      evaluateAdvisory(entry, { ghsa_id: 'GHSA-other-0000-0000' }, installed),
    VerifyError
  )
  assert.throws(
    () => evaluateAdvisory(entry, advisory(entry.id, null), installed),
    VerifyError
  )
  assert.throws(
    () => evaluateAdvisory(entry, advisory(entry.id, []), installed),
    VerifyError
  )
  assert.throws(
    () =>
      evaluateAdvisory(
        entry,
        advisory(entry.id, [vuln('foo', '~3.0.0')]),
        installed
      ),
    VerifyError
  )
})

// ─── fetch + run (exit codes) ────────────────────────────────────────────────

test('fetchAdvisory sends the token and maps every failure to VerifyError', async () => {
  let seen
  const body = await fetchAdvisory('GHSA-aaaa-bbbb-cccc', {
    token: 't0k',
    fetch: async (url, init) => {
      seen = { url, init }
      return okResponse(UNPATCHED)
    }
  })
  assert.equal(body, UNPATCHED)
  assert.equal(
    seen.url,
    'https://api.github.com/advisories/GHSA-aaaa-bbbb-cccc'
  )
  assert.equal(seen.init.headers.Authorization, 'Bearer t0k')

  await assert.rejects(
    fetchAdvisory('GHSA-aaaa-bbbb-cccc', {
      fetch: async () => ({ status: 404 })
    }),
    /HTTP 404/
  )
  await assert.rejects(
    fetchAdvisory('GHSA-aaaa-bbbb-cccc', {
      fetch: async () => {
        throw new Error('ENOTFOUND')
      }
    }),
    (e) => e instanceof VerifyError && /ENOTFOUND/.test(e.message)
  )
})

const ONE = `auditConfig:\n  ignoreGhsas:\n    # Expiry: #101.\n    - GHSA-aaaa-bbbb-cccc\n`

test('run: empty list → exit 0', async () => {
  const log = capture()
  const code = await run({
    workspaceText: `packages:\n  - 'apps/*'\n`,
    lockText: '',
    fetchImpl: async () => assert.fail('must not fetch'),
    log: log.fn,
    err: log.fn
  })
  assert.equal(code, 0)
  assert.match(log.out.join('\n'), /nothing to check/)
})

test('run: unpatched → exit 0', async () => {
  const code = await run({
    workspaceText: ONE,
    lockText: LOCK,
    fetchImpl: async () => okResponse(UNPATCHED),
    log: () => {},
    err: () => {}
  })
  assert.equal(code, 0)
})

test('run: patched → exit 1 with the actionable message', async () => {
  const err = capture()
  const code = await run({
    workspaceText: ONE,
    lockText: LOCK,
    fetchImpl: async () => okResponse(PATCHED),
    log: () => {},
    err: err.fn
  })
  assert.equal(code, 1)
  assert.match(
    err.out.join('\n'),
    /expired.*upgrade foo to 3\.0\.4.*close #101/
  )
})

test('run: API error fails closed (exit 2) with a distinct could-not-verify message', async () => {
  for (const fetchImpl of [
    async () => ({ status: 503 }),
    async () => {
      throw new Error('socket hang up')
    },
    async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError('bad')
      }
    })
  ]) {
    const err = capture()
    const code = await run({
      workspaceText: ONE,
      lockText: LOCK,
      fetchImpl,
      log: () => {},
      err: err.fn
    })
    assert.equal(code, 2)
    assert.match(
      err.out.join('\n'),
      /COULD NOT BE VERIFIED \(this is not a pass\)/
    )
    assert.doesNotMatch(err.out.join('\n'), /expired/)
  }
})

test('run: an unreadable pnpm-workspace.yaml fails closed (exit 2)', async () => {
  const code = await run({
    workspaceText: `auditConfig:\n  ignoreGhsas:\n    - whatever\n`,
    lockText: LOCK,
    fetchImpl: async () => okResponse(UNPATCHED),
    log: () => {},
    err: () => {}
  })
  assert.equal(code, 2)
})
