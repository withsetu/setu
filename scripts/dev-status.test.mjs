// Tests for `pnpm dev:status` (#779). Every seam the script touches — the port scan, the
// PID→cwd lookup, the git lookups, the clock, the handshake reader — is injected, so these
// run without a real dev stack up and without a real clock. Same convention as
// auth-login-link.test.mjs (env passed explicitly, never mutated).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  LSOF_LISTEN_ARGS,
  buildStatus,
  formatUptime,
  loginLinkFor,
  parseCwd,
  parseListeners,
  parsePsEnv,
  render,
  roleFor
} from './dev-status.mjs'

const NOW = new Date('2026-07-21T12:00:00Z')
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000)

/** Build a deps object for buildStatus with sane defaults; override per test. */
function deps(over = {}) {
  return {
    listeners: [],
    cwdOf: () => null,
    worktreeOf: () => null,
    startedAt: () => null,
    commitsSince: () => ({ count: 0 }),
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

test('a server started before commits landed is flagged stale (the load-bearing warning)', () => {
  const status = buildStatus(
    deps({
      listeners: [{ pid: 2, port: 5173 }],
      cwdOf: () => '/Users/dev/setu/apps/admin',
      worktreeOf: () => ({ root: '/Users/dev/setu', branch: 'main' }),
      startedAt: () => minutesAgo(60 * 48),
      commitsSince: (root, since) => {
        assert.equal(root, '/Users/dev/setu')
        assert.equal(since.getTime(), minutesAgo(60 * 48).getTime())
        return { count: 47 }
      },
      loginLink: () => ({ url: 'http://localhost:5173/#setu-token=abc' })
    })
  )
  assert.deepEqual(status.rows[0].stale, { commits: 47 })
  const out = render(status)
  assert.match(out, /up 2d/)
  assert.match(out, /47 commits/)
  assert.match(out, /restart/i)
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
