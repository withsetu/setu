// Tests for `pnpm dev:status` (#779). Every seam the script touches — the port scan, the
// PID→cwd lookup, the git lookups, the clock, the handshake reader — is injected, so these
// run without a real dev stack up and without a real clock. Same convention as
// auth-login-link.test.mjs (env passed explicitly, never mutated).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { execFileSync } from 'node:child_process'

import {
  LSOF_LISTEN_ARGS,
  buildStatus,
  upstreamOf,
  formatUptime,
  loginLinkFor,
  parseCwd,
  parseListeners,
  parseStatusArgs,
  truncateLink,
  parsePsEnv,
  render,
  roleFor
} from './dev-status.mjs'

/** Run git against a THROWAWAY fixture repo. Always `-C <dir>`: these are the only mutating git
 *  calls in the suite and they must never be able to reach the checkout running the tests. */
const fixtureGit = (dir, ...args) =>
  execFileSync(
    'git',
    ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args],
    { stdio: 'pipe' }
  )
    .toString()
    .trim()

const NOW = new Date('2026-07-21T12:00:00Z')
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000)

/** Build a deps object for buildStatus with sane defaults; override per test. */
function deps(over = {}) {
  return {
    listeners: [],
    cwdOf: () => null,
    worktreeOf: () => null,
    startedAt: () => null,
    headMovedAt: () => null,
    depsChangedAt: () => null,
    upstreamOf: () => ({
      upstream: 'origin/main',
      behind: 0,
      base: { ref: 'origin/main', behind: 0, present: true }
    }),
    envOf: () => ({}),
    loginLink: () => ({ error: 'none' }),
    home: '/Users/dev',
    now: NOW,
    ...over
  }
}

test('parseListeners reads pid/port pairs out of `lsof -Fpn` output', () => {
  const out = [
    'p40854',
    'n*:4444',
    'p26222',
    'n[::1]:5173',
    'n127.0.0.1:5173', // same pid+port twice (IPv4+IPv6) → one row
    'p82213',
    'n[::1]:4321',
    'nnot-a-socket',
    ''
  ].join('\n')
  assert.deepEqual(parseListeners(out), [
    { pid: 40854, port: 4444 },
    { pid: 26222, port: 5173 },
    { pid: 82213, port: 4321 }
  ])
})

test('parseListeners returns [] for empty output', () => {
  assert.deepEqual(parseListeners(''), [])
})

test('parseCwd pulls the path out of `lsof -d cwd -Fn` output', () => {
  assert.equal(
    parseCwd('p40854\nfcwd\nn/Users/dev/setu/apps/api\n'),
    '/Users/dev/setu/apps/api'
  )
  assert.equal(parseCwd(''), null)
})

test('roleFor names the app from its cwd, falling back to the default port map', () => {
  assert.equal(roleFor('/Users/dev/setu/apps/api', 4444), 'api')
  assert.equal(roleFor('/Users/dev/wt/x/apps/admin', 5183), 'admin')
  assert.equal(roleFor('/Users/dev/wt/x/apps/site', 4331), 'site')
  // cwd says nothing → the well-known dev ports still identify the process.
  assert.equal(roleFor('/Users/dev/setu', 4321), 'site')
  assert.equal(roleFor('/Users/dev/setu', 9999), '?')
})

test('formatUptime is compact and human (s/m/h/d)', () => {
  assert.equal(formatUptime(45_000), '45s')
  assert.equal(formatUptime(4 * 60_000), '4m')
  assert.equal(formatUptime(2 * 3_600_000 + 61_000), '2h')
  assert.equal(formatUptime(50 * 3_600_000), '2d')
  assert.equal(formatUptime(null), '?')
})

test('nothing running → says so plainly and points at pnpm dev', () => {
  const status = buildStatus(deps())
  assert.deepEqual(status.rows, [])
  const out = render(status)
  assert.match(out, /nothing/i)
  assert.match(out, /pnpm dev/)
  assert.match(out, /4444/)
  // Read-only tool: never suggest the port-killing command (it kills other sessions).
  assert.doesNotMatch(out, /dev:stop/)
})

test('a running stack lists role, port, worktree, branch, uptime and its login link', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4444 },
        { pid: 2, port: 5173 }
      ],
      cwdOf: (pid) =>
        pid === 1 ? '/Users/dev/setu/apps/api' : '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(4),
      loginLink: () => ({ url: 'http://localhost:5173/#setu-token=abc' })
    })
  )
  assert.deepEqual(
    status.rows.map((r) => [r.role, r.port, r.branch, r.stale]),
    [
      ['api', 4444, 'main', null],
      ['admin', 5173, 'main', null]
    ]
  )
  const out = render(status)
  assert.match(out, /api\s+:4444/)
  assert.match(out, /admin\s+:5173/)
  assert.match(out, /~\/setu/) // home-relative path
  assert.match(out, /main/)
  assert.match(out, /up 4m/)
  assert.match(out, /http:\/\/localhost:5173\/#setu-token=abc/)
})

// AXIS 1 — the process is older than the working tree. Restart fixes it. The signal is when the
// checkout's HEAD last MOVED (a pull/checkout lands files on disk) and when dependencies were
// last reinstalled — not `rev-list --since`, which counts commits by AUTHOR date and so both
// misses a pull of week-old commits and fires on commits that never reached this disk.
test('a server older than the last HEAD move is flagged, with a restart prescription', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(60 * 48),
      headMovedAt: (root) => {
        assert.equal(root, '/Users/dev/setu')
        return minutesAgo(180)
      },
      loginLink: () => ({ url: 'http://localhost:5173/#setu-token=abc' })
    })
  )
  assert.deepEqual(
    status.rows[0].stale.marks.map((m) => m.kind),
    ['code']
  )
  const out = render(status)
  assert.match(out, /up 2d/)
  assert.match(out, /HEAD moved 3h ago/)
  assert.match(out, /restart/i)
  // Restarting DOES fix this axis, so it must not be told to pull.
  assert.doesNotMatch(out, /git pull/)
})

// The #779 story exactly: `pnpm install` swapped node_modules under a two-day-old vite, and a
// lazy route 404'd. HEAD never moved; only the dependency tree did.
test('a server older than the last dependency install is flagged too', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(60 * 48),
      depsChangedAt: () => minutesAgo(300)
    })
  )
  assert.deepEqual(
    status.rows[0].stale.marks.map((m) => m.kind),
    ['deps']
  )
  assert.match(render(status), /dependencies were reinstalled 5h ago/)
})

// AXIS 2 — the working tree is older than the remote. `git fetch` moves a ref but touches no
// files, so the process is perfectly current with a disk that is behind. Restarting reloads the
// identical code and reports success — the false resolution this check exists to prevent.
test('a checkout behind its upstream prescribes git pull, NOT a restart', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4444 },
        { pid: 2, port: 5173 },
        { pid: 3, port: 4321 }
      ],
      cwdOf: (pid) =>
        `/Users/dev/setu/apps/${{ 1: 'api', 2: 'admin', 3: 'site' }[pid]}`,
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(2), // current with the disk
      upstreamOf: () => ({ upstream: 'origin/main', behind: 6 })
    })
  )
  assert.equal(status.checkouts.length, 1)
  assert.equal(status.checkouts[0].behind, 6)
  assert.equal(
    status.rows.every((r) => r.stale === null),
    true
  )
  const out = render(status)
  assert.match(out, /6 commits behind origin\/main/)
  assert.match(out, /git pull/)
  assert.match(out, /restarting.*will not help/i)
  // A property of the CHECKOUT: said once, not repeated on all three rows.
  assert.equal(out.split('behind origin/main').length - 1, 1)
  // Read-only: the comparison is only as fresh as the last fetch, and we say so rather than
  // silently fetching.
  assert.match(out, /last .*fetch/i)
})

test('both axes at once → pull first, then restart', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(60 * 48),
      headMovedAt: () => minutesAgo(120),
      upstreamOf: () => ({ upstream: 'origin/main', behind: 6 })
    })
  )
  const out = render(status)
  assert.match(out, /HEAD moved 2h ago/)
  assert.match(out, /pull first, then restart/i)
})

test('no upstream configured → says it cannot tell, never a silent all-clear', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'wip-branch' }),
      startedAt: () => minutesAgo(5),
      upstreamOf: () => ({ upstream: null, behind: null })
    })
  )
  assert.equal(status.checkouts[0].behind, null)
  const out = render(status)
  assert.match(out, /no upstream/i)
  assert.doesNotMatch(out, /git pull/)
  assert.doesNotMatch(out, /behind/)
})

test('detached HEAD → named as such, no bogus behind-count', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({
        root: '/Users/dev/setu',
        branch: 'detached@abc1234'
      }),
      startedAt: () => minutesAgo(5),
      upstreamOf: () => ({ upstream: null, behind: null, detached: true })
    })
  )
  const out = render(status)
  assert.match(out, /detached HEAD/i)
  assert.doesNotMatch(out, /git pull/)
})

// CLAUDE.md §8: `origin/main` is the hub, branches are cut from it and synced by merging it back
// in. So for a feature worktree "behind origin/main" is the number that matters — and
// `HEAD..@{upstream}` resolves to the branch's OWN pushed ref, reading a reassuring 0 in exactly
// the case that needs warning. The two counts answer different questions and both are printed.
test('a feature branch level with its own upstream but behind origin/main is still warned', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5183 }],
      cwdOf: () => '/Users/dev/wt/ed/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/wt/ed', branch: 'ed-757' }),
      startedAt: () => minutesAgo(5),
      upstreamOf: () => ({
        upstream: 'origin/ed-757',
        behind: 0, // everything pushed — the reassuring zero
        base: { ref: 'origin/main', behind: 14, present: true }
      })
    })
  )
  assert.equal(status.checkouts[0].base.behind, 14)
  const out = render(status)
  assert.match(out, /14 commits behind origin\/main/)
  assert.match(out, /merge origin\/main into it/)
  // "have I pushed everything?" is a different question and is not conflated with it.
  assert.doesNotMatch(out, /git pull/)
})

test('origin/main missing → says it could not compare, never prints 0', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5183 }],
      cwdOf: () => '/Users/dev/wt/ed/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/wt/ed', branch: 'ed-757' }),
      startedAt: () => minutesAgo(5),
      upstreamOf: () => ({
        upstream: 'origin/ed-757',
        behind: 0,
        base: { ref: 'origin/main', behind: null, present: false }
      })
    })
  )
  const out = render(status)
  assert.match(out, /could not compare .*origin\/main/)
  assert.doesNotMatch(out, /0 commits/)
  assert.doesNotMatch(out, /merge origin\/main into it/)
})

test('the main checkout does not report the same fact twice', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(5),
      upstreamOf: () => ({
        upstream: 'origin/main',
        behind: 6,
        base: { ref: 'origin/main', behind: 6, present: true }
      })
    })
  )
  const out = render(status)
  assert.equal(out.split('behind origin/main').length - 1, 1)
  assert.match(out, /git pull/)
  assert.doesNotMatch(out, /merge origin\/main into it/)
})

test('an up-to-date checkout with fresh servers reports no warnings at all', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(5),
      headMovedAt: () => minutesAgo(600), // moved BEFORE the server started — fine
      depsChangedAt: () => minutesAgo(900)
    })
  )
  assert.equal(status.rows[0].stale, null)
  assert.doesNotMatch(render(status), /⚠/)
})

test('non-default ports are reported as-is (a worktree stack on 4455/5183)', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 7, port: 4455 },
        { pid: 8, port: 5183 }
      ],
      cwdOf: (pid) =>
        pid === 7
          ? '/Users/dev/setu/.claude/worktrees/ed/apps/api'
          : '/Users/dev/setu/.claude/worktrees/ed/apps/admin',
      worktreeOf: () => ({
        root: '/Users/dev/setu/.claude/worktrees/ed',
        branch: 'editor-focus-757'
      }),
      startedAt: () => minutesAgo(6),
      loginLink: () => ({ url: 'http://localhost:5183/#setu-token=zzz' })
    })
  )
  assert.deepEqual(
    status.rows.map((r) => [r.role, r.port]),
    [
      ['api', 4455],
      ['admin', 5183]
    ]
  )
  const out = render(status)
  assert.match(out, /:5183/)
  assert.match(out, /editor-focus-757/)
})

test('one link block per worktree, in first-seen order, even with several stacks up', () => {
  const roots = {
    1: { root: '/Users/dev/setu', branch: 'main' },
    2: { root: '/Users/dev/setu', branch: 'main' },
    3: { root: '/Users/dev/wt/ed', branch: 'ed-757' }
  }
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4444 },
        { pid: 2, port: 5173 },
        { pid: 3, port: 5183 }
      ],
      cwdOf: (pid) => `/x/apps/${pid === 1 ? 'api' : 'admin'}`,
      worktreeOf: (_dir, pid) => roots[pid],
      startedAt: () => minutesAgo(1),
      loginLink: (root) => ({ url: `http://x/#t=${path.basename(root)}` })
    })
  )
  assert.deepEqual(
    status.links.map((l) => [l.branch, l.url]),
    [
      ['main', 'http://x/#t=setu'],
      ['ed-757', 'http://x/#t=ed']
    ]
  )
})

test('a login link that opens another worktree’s admin is called out, not printed bare', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 5173 },
        { pid: 2, port: 5183 }
      ],
      cwdOf: () => '/x/apps/admin',
      worktreeOf: (_dir, pid) =>
        pid === 1
          ? { root: '/Users/dev/setu', branch: 'main' }
          : { root: '/Users/dev/wt/ed', branch: 'ed-757' },
      startedAt: () => minutesAgo(2),
      // The worktree api still advertises main's admin origin (:5173).
      loginLink: (root) => ({
        url:
          root === '/Users/dev/setu'
            ? 'http://localhost:5173/#setu-token=a'
            : 'http://localhost:5173/#setu-token=b'
      })
    })
  )
  const [mainLink, wtLink] = status.links
  assert.equal(mainLink.note, null)
  assert.match(wtLink.note, /opens admin :5173 .*main.*not this worktree/)
  assert.match(render(status), /not this worktree/)
})

test('a worktree with no handshake file explains why instead of printing a dead link', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(3),
      loginLink: () => ({ error: 'no handshake link found — checked: …' })
    })
  )
  assert.equal(status.links[0].url, null)
  const out = render(status)
  assert.match(out, /no handshake link/)
  assert.doesNotMatch(out, /setu-token/)
})

test('processes outside a Setu worktree are ignored (only Setu stacks are listed)', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 8384 },
        { pid: 2, port: 5173 }
      ],
      cwdOf: (pid) => (pid === 1 ? '/Users/dev/other' : '/Users/dev/setu'),
      worktreeOf: (dir) =>
        dir === '/Users/dev/setu'
          ? { root: '/Users/dev/setu', branch: 'main' }
          : null,
      startedAt: () => minutesAgo(2),
      loginLink: () => ({ error: 'none' })
    })
  )
  assert.deepEqual(
    status.rows.map((r) => r.port),
    [5173]
  )
})

// `lsof -ti tcp:5173` returns EVERY process holding a socket on that port — the vite server AND
// every connected browser tab (measured on this machine: 3 pids for one server). Mapping a Chrome
// pid's cwd to a worktree prints pure garbage, so the scan must be LISTEN-filtered at the source.
test('the port scan is LISTEN-filtered (clients on a port are never mistaken for the server)', () => {
  assert.ok(
    LSOF_LISTEN_ARGS.includes('-sTCP:LISTEN'),
    'lsof invocation must filter to listening sockets'
  )
  // With the filter in place lsof emits only the listener, so one port → one row even when
  // browser tabs and other clients are connected to it.
  assert.deepEqual(parseListeners('p26222\nn[::1]:5173\n'), [
    { pid: 26222, port: 5173 }
  ])
})

test('parsePsEnv picks the wiring vars out of `ps eww` output', () => {
  const out =
    'node /x/vite.js VITE_SETU_API=http://localhost:4444 ' +
    'VITE_SETU_SITE=http://localhost:4321 PATH=/usr/bin\n'
  assert.deepEqual(parsePsEnv(out), {
    VITE_SETU_API: 'http://localhost:4444',
    VITE_SETU_SITE: 'http://localhost:4321'
  })
  assert.deepEqual(parsePsEnv(''), {})
})

test('a consistent stack reports no wiring warning', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4444 },
        { pid: 2, port: 5173 }
      ],
      cwdOf: (pid) => `/Users/dev/setu/apps/${pid === 1 ? 'api' : 'admin'}`,
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(3),
      envOf: () => ({ VITE_SETU_API: 'http://localhost:4444' })
    })
  )
  const admin = status.rows.find((r) => r.role === 'admin')
  assert.equal(admin.wiring.known, true)
  assert.deepEqual(admin.wiring.issues, [])
  assert.doesNotMatch(render(status), /cross-wired/)
})

test('a cross-wired admin (worktree UI against main’s api) is flagged loudly', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4444 },
        { pid: 2, port: 5183 }
      ],
      cwdOf: (pid) =>
        pid === 1
          ? '/Users/dev/setu/apps/api'
          : '/Users/dev/wt/editor-focus/apps/admin',
      worktreeOf: (dir) =>
        dir.startsWith('/Users/dev/wt/')
          ? { root: '/Users/dev/wt/editor-focus', branch: 'editor-focus-757' }
          : { root: '/Users/dev/setu', branch: 'main' },
      startedAt: () => minutesAgo(6),
      envOf: (pid) =>
        pid === 2 ? { VITE_SETU_API: 'http://localhost:4444' } : {}
    })
  )
  const admin = status.rows.find((r) => r.role === 'admin')
  assert.equal(admin.wiring.known, true)
  assert.equal(admin.wiring.issues.length, 1)
  const out = render(status)
  assert.match(out, /cross-wired/)
  assert.match(out, /api :4444/)
  assert.match(out, /main/)
})

test('a cross-wired site (content dir from another worktree) is flagged too', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 3, port: 4455 },
        { pid: 4, port: 4331 }
      ],
      cwdOf: (pid) =>
        `/Users/dev/wt/editor-focus/apps/${pid === 3 ? 'api' : 'site'}`,
      worktreeOf: () => ({
        root: '/Users/dev/wt/editor-focus',
        branch: 'editor-focus-757'
      }),
      startedAt: () => minutesAgo(6),
      envOf: (pid) =>
        pid === 4
          ? {
              // api is this worktree's own (consistent) — only the content dir is foreign.
              SETU_API_URL: 'http://localhost:4455',
              SETU_CONTENT_DIR: '/Users/dev/setu/.content-sandbox/dev/content'
            }
          : {}
    })
  )
  const site = status.rows.find((r) => r.role === 'site')
  assert.equal(site.wiring.issues.length, 1)
  assert.match(render(status), /content from .*cross-wired/s)
})

// Worktrees live under the main checkout, so main's root is a string prefix of every worktree
// path: a main-rooted site pointed at a WORKTREE's sandbox must still be flagged.
test('nested worktree paths do not hide a cross-wired content dir', () => {
  const wt = '/Users/dev/setu/.claude/worktrees/ed'
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 1, port: 4321 },
        { pid: 2, port: 5183 }
      ],
      cwdOf: (pid) =>
        pid === 1 ? '/Users/dev/setu/apps/site' : `${wt}/apps/admin`,
      worktreeOf: (dir) =>
        dir.startsWith(wt)
          ? { root: wt, branch: 'ed-757' }
          : { root: '/Users/dev/setu', branch: 'main' },
      startedAt: () => minutesAgo(5),
      envOf: (pid) =>
        pid === 1
          ? { SETU_CONTENT_DIR: `${wt}/.content-sandbox/dev/content` }
          : {}
    })
  )
  const site = status.rows.find((r) => r.role === 'site')
  assert.equal(site.wiring.issues.length, 1)
  assert.match(site.wiring.issues[0], /ed-757.*cross-wired/)
})

test('unreadable env → wiring reported as unknown, never as a clean bill of health', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(3),
      envOf: () => null // ps restricted / unsupported platform
    })
  )
  assert.equal(status.rows[0].wiring.known, false)
  const out = render(status)
  assert.match(out, /wiring unknown/i)
  assert.doesNotMatch(out, /cross-wired/)
})

test('an admin pointed at a port nothing is listening on says so', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(3),
      envOf: () => ({ VITE_SETU_API: 'http://localhost:4444' })
    })
  )
  assert.match(status.rows[0].wiring.issues[0], /nothing listening/)
})

test('loginLinkFor wraps readLoginLink: url on success, error string on failure', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setu-dev-status-'))
  try {
    assert.match(loginLinkFor(root, {}).error, /handshake/i)
    mkdirSync(path.join(root, '.setu'), { recursive: true })
    writeFileSync(
      path.join(root, '.setu', 'handshake-url'),
      'http://localhost:5173/#setu-token=real\n'
    )
    assert.equal(
      loginLinkFor(root, {}).url,
      'http://localhost:5173/#setu-token=real'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The seam above is unit-tested through injection; this exercises the REAL git plumbing, which is
// where a wrong revision range would hide. It builds the exact situation CLAUDE.md §8 produces: a
// feature branch cut from main, pushed (so its own upstream is level), while origin/main moves on.
test('upstreamOf against real git: level with own upstream, behind origin/main', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'setu-upstream-'))
  const originDir = path.join(tmp, 'origin')
  const cloneDir = path.join(tmp, 'clone')
  try {
    mkdirSync(originDir)
    fixtureGit(originDir, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(originDir, 'a.txt'), 'one\n')
    fixtureGit(originDir, 'add', '-A')
    fixtureGit(originDir, 'commit', '-qm', 'one')
    execFileSync('git', ['clone', '-q', originDir, cloneDir], { stdio: 'pipe' })

    // A feature branch cut from main, pushed → its own upstream is level.
    fixtureGit(cloneDir, 'checkout', '-q', '-b', 'feat-1')
    writeFileSync(path.join(cloneDir, 'b.txt'), 'mine\n')
    fixtureGit(cloneDir, 'add', '-A')
    fixtureGit(cloneDir, 'commit', '-qm', 'my work')
    fixtureGit(cloneDir, 'push', '-q', '-u', 'origin', 'feat-1')

    // Meanwhile main moves on by two commits, and the clone fetches (but does not merge).
    for (const n of ['two', 'three']) {
      writeFileSync(path.join(originDir, `${n}.txt`), `${n}\n`)
      fixtureGit(originDir, 'add', '-A')
      fixtureGit(originDir, 'commit', '-qm', n)
    }
    fixtureGit(cloneDir, 'fetch', '-q', 'origin')

    const res = upstreamOf(cloneDir)
    assert.equal(res.upstream, 'origin/feat-1')
    assert.equal(res.behind, 0, 'everything pushed — the reassuring zero')
    assert.deepEqual(res.base, { ref: 'origin/main', behind: 2, present: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('upstreamOf against real git: no remote at all → present:false, not 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-upstream-solo-'))
  try {
    fixtureGit(dir, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    fixtureGit(dir, 'add', '-A')
    fixtureGit(dir, 'commit', '-qm', 'one')
    const res = upstreamOf(dir)
    assert.equal(res.upstream, null)
    assert.equal(res.behind, null)
    assert.deepEqual(res.base, {
      ref: 'origin/main',
      behind: null,
      present: false
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- #820: dev:status is a routine "what's running" command whose output gets pasted into issues,
// PRs and agent transcripts. It must not carry every discoverable worktree's admin sign-in
// credential in there by default. `pnpm auth:login-link` stays the explicit way to get one.
// Deliberately low-entropy and self-describing: a realistic random-looking token here trips the
// gitleaks pre-push scan (generic-api-key) even though nothing about it is real.
const LONG_TOKEN = 'not-a-real-token-not-a-real-token-not-a-real-token'

function statusWithLink(url) {
  return buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(3),
      loginLink: () => ({ url })
    })
  )
}

test('the SIGN IN block truncates the token by default and says where to get the full link', () => {
  const url = `http://localhost:5173/#setu-token=${LONG_TOKEN}`
  const out = render(statusWithLink(url))
  assert.doesNotMatch(
    out,
    new RegExp(LONG_TOKEN),
    'the full token must not appear in default output'
  )
  assert.match(out, /http:\/\/localhost:5173\/#setu-token=/) // the origin is still useful
  assert.match(out, /pnpm auth:login-link/)
  assert.match(out, /--show-links/)
})

test('--show-links prints the full sign-in link verbatim', () => {
  const url = `http://localhost:5173/#setu-token=${LONG_TOKEN}`
  const out = render(statusWithLink(url), { showLinks: true })
  assert.match(out, new RegExp(LONG_TOKEN))
  assert.doesNotMatch(out, /pnpm auth:login-link/)
})

test('truncateLink keeps the origin and a token stub, never the whole token', () => {
  assert.equal(
    truncateLink(`http://localhost:5173/#setu-token=${LONG_TOKEN}`),
    'http://localhost:5173/#setu-token=not-a-…'
  )
  // A short token is not padded into looking longer than it is, and is still cut.
  assert.equal(
    truncateLink('http://localhost:5173/#setu-token=abc'),
    'http://localhost:5173/#setu-token=abc'
  )
  // A URL with no recognisable token is still bounded.
  assert.ok(
    truncateLink(`http://localhost:5173/${'a'.repeat(200)}`).length < 80
  )
})

test('the cross-worktree link warning survives truncation (#820 keeps the note)', () => {
  const status = buildStatus(
    deps({
      listeners: [
        { pid: 2, port: 5173 },
        { pid: 3, port: 5183 }
      ],
      cwdOf: (pid) =>
        pid === 2
          ? '/Users/dev/setu/apps/admin'
          : '/Users/dev/setu/.claude/worktrees/ed/apps/admin',
      worktreeOf: (cwd) =>
        cwd.includes('worktrees/ed')
          ? { root: '/Users/dev/setu/.claude/worktrees/ed', branch: 'ed-1' }
          : { root: '/Users/dev/setu', branch: 'main' },
      startedAt: () => minutesAgo(3),
      loginLink: (root) => ({
        url:
          root === '/Users/dev/setu'
            ? `http://localhost:5183/#setu-token=${LONG_TOKEN}`
            : `http://localhost:5173/#setu-token=${LONG_TOKEN}`
      })
    })
  )
  const out = render(status)
  assert.match(out, /not this worktree/)
  assert.doesNotMatch(out, new RegExp(LONG_TOKEN))
})

test('parseStatusArgs reads --show-links', () => {
  assert.deepEqual(parseStatusArgs([]), { showLinks: false })
  assert.deepEqual(parseStatusArgs(['--show-links']), { showLinks: true })
  assert.deepEqual(parseStatusArgs(['--other']), { showLinks: false })
})
