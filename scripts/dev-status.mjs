// `pnpm dev:status` — answer the three questions you need answered before touching a running
// dev stack (#779): what is running, whose code is it serving, and how do I sign in to it.
//
// STRICTLY READ-ONLY. This command never frees a port, kills a pid, or writes a file — that is
// the whole point of it. With several worktrees in play, a blind `pnpm dev:stop` takes down
// another session's servers; this exists so you can look first and never need to.
//
// How it works (all of it is `lsof` + `ps` + `git`, node builtins only, same style as
// content-sandbox.mjs / auth-login-link.mjs):
//   1. DISCOVER, don't guess: one `lsof -nP -iTCP -sTCP:LISTEN` lists every listening socket on
//      the machine, so a worktree stack on non-default ports (4455/5183) shows up exactly like
//      the `pnpm dev` defaults. The LISTEN filter is load-bearing — `lsof -ti tcp:5173` also
//      returns every connected browser tab, and a Chrome pid's cwd is not a worktree.
//   2. pid → cwd  (`lsof -a -p <pid> -d cwd -Fn`), cwd → worktree root + branch (`git rev-parse`
//      / `git branch --show-current`). Anything whose root is not a Setu checkout is dropped.
//   3. STALENESS: process start time (`ps -o lstart=`) vs commits landed in that worktree since.
//      A server started before N commits is serving code you are no longer editing — the
//      "This screen couldn't be loaded" ghost in #779 was exactly this, two days old.
//   4. WIRING: a stack is wired by ENV, not by location, so worktree A's admin can be pointed at
//      main's api and sandbox. `ps eww <pid>` exposes VITE_SETU_API / SETU_API_URL /
//      SETU_CONTENT_DIR for your own processes; we resolve those back to a worktree and flag a
//      mismatch. If the env cannot be read we say "wiring unknown" — never a clean bill of health.
//   5. Sign-in links come from readLoginLink() (auth-login-link.mjs), per worktree root, so the
//      missing/empty handshake-file cases stay in one place.
//
// Usage:  node scripts/dev-status.mjs      (or `pnpm dev:status` from the repo root)

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { isDirectInvocation, readLoginLink } from './auth-login-link.mjs'

/** The `pnpm dev` defaults — used only to NAME a process whose cwd is uninformative, and to
 *  make the "nothing running" message concrete. Discovery itself is not limited to these. */
export const DEFAULT_PORTS = { 4444: 'api', 5173: 'admin', 4321: 'site' }

/** Field-mode listing of listening TCP sockets. `-sTCP:LISTEN` is not optional: without it the
 *  same port also reports connected clients (browser tabs), which are not servers. */
export const LSOF_LISTEN_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']

/** Wiring env vars we can resolve back to a worktree (set by the root `dev` script). */
const WIRING_VARS = [
  'VITE_SETU_API',
  'VITE_SETU_SITE',
  'SETU_API_URL',
  'SETU_CONTENT_DIR'
]

// ---------------------------------------------------------------------------- parsing (pure)

/** Parse `lsof -Fpn` output into `[{ pid, port }]`, one row per pid+port (a server bound on
 *  both IPv4 and IPv6 reports twice). */
export function parseListeners(out) {
  const rows = []
  const seen = new Set()
  let pid = null
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1))
      if (!Number.isInteger(pid) || pid <= 0) pid = null
    } else if (line.startsWith('n') && pid !== null) {
      const port = Number(line.slice(1).split(':').pop())
      if (!Number.isInteger(port) || port <= 0) continue
      const key = `${pid}:${port}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ pid, port })
    }
  }
  return rows
}

/** Parse `lsof -a -p <pid> -d cwd -Fn` output into the cwd path (or null). */
export function parseCwd(out) {
  for (const line of out.split('\n')) {
    if (line.startsWith('n') && line.length > 1) return line.slice(1)
  }
  return null
}

/** Pick the wiring vars out of `ps eww <pid>` output (KEY=VALUE tokens after the command). */
export function parsePsEnv(out) {
  const env = {}
  for (const key of WIRING_VARS) {
    const m = out.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`))
    if (m) env[key] = m[1]
  }
  return env
}

/** Name the app from its cwd (`apps/<name>`), falling back to the well-known dev ports. */
export function roleFor(cwd, port) {
  const m = cwd && /\/apps\/(api|admin|site)(\/|$)/.exec(cwd)
  if (m) return m[1]
  return DEFAULT_PORTS[port] ?? '?'
}

/** Compact uptime: 45s / 4m / 2h / 2d. `null` when the start time is unknown. */
export function formatUptime(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '?'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const portOf = (url) => {
  try {
    return Number(new URL(url).port) || null
  } catch {
    return null
  }
}

/** Home-relative display path (`~/setu`), so the table stays narrow. */
function displayPath(p, home) {
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

// ---------------------------------------------------------------------------- status (pure)

/** Build the whole report from injected seams — no process, git, clock or fs access here, which
 *  is what makes the staleness and cross-wiring logic testable without a real stack up. */
export function buildStatus({
  listeners,
  cwdOf,
  worktreeOf,
  startedAt,
  commitsSince,
  envOf,
  loginLink,
  home,
  now
}) {
  const rows = []
  for (const { pid, port } of listeners) {
    const cwd = cwdOf(pid)
    if (!cwd) continue
    const wt = worktreeOf(cwd, pid)
    if (!wt) continue // not a Setu worktree — someone else's server
    const started = startedAt(pid)
    const uptimeMs = started ? now.getTime() - started.getTime() : null
    const since = started ? commitsSince(wt.root, started) : null
    rows.push({
      pid,
      port,
      role: roleFor(cwd, port),
      root: wt.root,
      display: displayPath(wt.root, home),
      branch: wt.branch,
      startedAt: started,
      uptimeMs,
      stale: since && since.count > 0 ? { commits: since.count } : null,
      env: envOf(pid)
    })
  }

  // Read as a stack, not as an lsof dump: group by worktree (first-seen order) and order
  // api → admin → site within each, so an incoherent stack is visible at a glance.
  const rootOrder = [...new Set(rows.map((r) => r.root))]
  const roleOrder = ['api', 'admin', 'site']
  rows.sort(
    (a, b) =>
      rootOrder.indexOf(a.root) - rootOrder.indexOf(b.root) ||
      roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) ||
      a.port - b.port
  )

  // Wiring needs the full row set (a target port is resolved to another row's worktree), so it
  // runs as a second pass.
  for (const row of rows) row.wiring = wiringFor(row, rows, home)

  const links = []
  for (const row of rows) {
    if (links.some((l) => l.root === row.root)) continue
    const res = loginLink(row.root)
    const url = res?.url ?? null
    // The api bakes ITS configured admin origin into the handshake URL, so a worktree api
    // started without VITE-side overrides hands out a link to whatever admin owns that port —
    // possibly another worktree's. Say so rather than letting the developer sign in to the
    // wrong UI and blame the token.
    let note = null
    if (url) {
      const target = rows.find((r) => r.port === portOf(url))
      if (target && target.root !== row.root) {
        note = `link opens admin :${target.port} in ${target.display} (${target.branch}) — not this worktree's UI`
      }
    }
    links.push({
      root: row.root,
      display: row.display,
      branch: row.branch,
      url,
      note,
      error: url ? null : (res?.error ?? 'no handshake link found')
    })
  }

  return { rows, links }
}

/** Compare a process's env wiring against its own worktree. Returns
 *  `{ known, issues }` — `known: false` means the env was unreadable, which must render as
 *  "unknown", never as consistent. */
function wiringFor(row, rows, home) {
  if (!row.env) return { known: false, issues: [] }
  const issues = []
  const targetOf = (port) => rows.find((r) => r.port === port && r !== row)

  const checkPort = (url, label) => {
    if (!url) return
    const port = portOf(url)
    if (!port) return
    const target = targetOf(port)
    if (!target) {
      issues.push(`points at ${label} :${port} — nothing listening there`)
      return
    }
    if (target.root !== row.root) {
      issues.push(
        `points at ${label} :${port} in ${target.display} (${target.branch}) — cross-wired stack`
      )
    }
  }

  checkPort(row.env.VITE_SETU_API, 'api')
  checkPort(row.env.SETU_API_URL, 'api')
  checkPort(row.env.VITE_SETU_SITE, 'site')

  const contentDir = row.env.SETU_CONTENT_DIR
  if (contentDir) {
    // Worktrees live UNDER the main checkout (.claude/worktrees/<name>), so "starts with my
    // root" is not enough: main's root is a prefix of every worktree path. Attribute the dir to
    // the DEEPEST root that contains it, then compare that with the process's own.
    const owner = rows
      .map((r) => r)
      .filter((r) => contentDir.startsWith(`${r.root}${path.sep}`))
      .sort((a, b) => b.root.length - a.root.length)[0]
    const mine = owner
      ? owner.root === row.root
      : contentDir.startsWith(`${row.root}${path.sep}`)
    if (!mine) {
      issues.push(
        `serves content from ${displayPath(contentDir, home)}` +
          (owner ? ` (${owner.branch})` : '') +
          ' — cross-wired stack'
      )
    }
  }
  return { known: true, issues }
}

// ---------------------------------------------------------------------------- rendering (pure)

const pad = (s, n) => String(s).padEnd(n)

export function render(status) {
  if (status.rows.length === 0) {
    const ports = Object.entries(DEFAULT_PORTS)
      .map(([p, role]) => `${role} :${p}`)
      .join(', ')
    return [
      'dev:status: nothing running — no Setu dev server is listening.',
      `  Start one with \`pnpm dev\` (defaults: ${ports}).`,
      ''
    ].join('\n')
  }

  const w = {
    role: Math.max(...status.rows.map((r) => r.role.length), 5),
    port: Math.max(...status.rows.map((r) => `:${r.port}`.length), 5),
    dir: Math.max(...status.rows.map((r) => r.display.length), 8),
    branch: Math.max(...status.rows.map((r) => r.branch.length), 6)
  }

  const out = ['RUNNING']
  for (const row of status.rows) {
    out.push(
      `  ${pad(row.role, w.role)}  ${pad(`:${row.port}`, w.port)}  ` +
        `${pad(row.display, w.dir)}  ${pad(row.branch, w.branch)}  ` +
        `up ${formatUptime(row.uptimeMs)}`
    )
    if (row.stale) {
      out.push(
        `      ⚠ started before ${row.stale.commits} commit${row.stale.commits === 1 ? '' : 's'} on this branch — ` +
          'it is serving stale code; restart it'
      )
    }
    for (const issue of row.wiring.issues) out.push(`      ⚠ ${issue}`)
    if (!row.wiring.known) {
      out.push(
        '      · wiring unknown (could not read this process’s env) — cannot confirm which api/content it uses'
      )
    }
  }

  out.push('')
  out.push('SIGN IN')
  const lw = Math.max(...status.links.map((l) => l.branch.length), 6)
  for (const link of status.links) {
    out.push(
      `  → ${pad(link.branch, lw)}  ${link.url ?? `(${firstLine(link.error)})`}`
    )
    if (link.note) out.push(`      ⚠ ${link.note}`)
  }
  out.push('')
  out.push('  (read-only: this command never stops or restarts anything)')
  out.push('')
  return out.join('\n')
}

const firstLine = (s) => String(s).split('\n')[0].trim()

// ---------------------------------------------------------------------------- real seams

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024
    }).toString()
  } catch {
    return '' // lsof/ps/git exit non-zero for "nothing found" — that is a result, not an error
  }
}

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

export function listListeners() {
  return parseListeners(sh('lsof', LSOF_LISTEN_ARGS))
}

export function cwdOf(pid) {
  return parseCwd(sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']))
}

/** cwd → `{ root, branch }` for SETU worktrees only. The Setu marker is the root package.json's
 *  name, which every worktree of this repo shares — so another project's dev server on 5173 is
 *  correctly ignored rather than printed with a bogus branch. */
export function worktreeOf(dir) {
  const root = git(dir, ['rev-parse', '--show-toplevel'])
  if (!root || !isSetuRoot(root)) return null
  const branch =
    git(dir, ['branch', '--show-current']) ||
    `detached@${git(dir, ['rev-parse', '--short', 'HEAD'])}`
  return { root, branch }
}

const setuRootCache = new Map()
function isSetuRoot(root) {
  if (setuRootCache.has(root)) return setuRootCache.get(root)
  let ok = false
  try {
    const pkg = path.join(root, 'package.json')
    ok =
      existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'setu'
  } catch {
    ok = false
  }
  setuRootCache.set(root, ok)
  return ok
}

export function startedAt(pid) {
  const lstart = sh('ps', ['-o', 'lstart=', '-p', String(pid)]).trim()
  if (!lstart) return null
  const d = new Date(lstart)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Commits on this worktree's HEAD that landed after `since` — i.e. how far behind the running
 *  server's code is. */
export function commitsSince(root, since) {
  const n = Number(
    git(root, [
      'rev-list',
      '--count',
      `--since=${since.toISOString()}`,
      'HEAD'
    ]) || '0'
  )
  return { count: Number.isFinite(n) ? n : 0 }
}

/** `ps eww` env for one pid. Returns null when the env is unreadable (restricted, or a platform
 *  without `ps eww`) so the caller renders "unknown" rather than "consistent". */
export function envOf(pid) {
  if (platform() === 'win32') return null
  const out = sh('ps', ['eww', String(pid)])
  if (!out.trim()) return null
  // The command line alone (no env) is indistinguishable from "env hidden", so treat a listing
  // with none of our vars AND no other KEY=VALUE token as unreadable.
  const env = parsePsEnv(out)
  if (Object.keys(env).length > 0) return env
  return /(?:^|\s)[A-Z_][A-Z0-9_]*=/.test(out) ? env : null
}

/** `readLoginLink` (auth-login-link.mjs) for one worktree root, as a result object. Reused
 *  rather than reimplemented: it already handles SETU_REPO_DIR, the dev sandbox and the
 *  missing/empty-file cases. `env` is injectable for tests. */
export function loginLinkFor(root, env = process.env) {
  try {
    // Deliberately NOT this process's SETU_REPO_DIR: we want each worktree's own sandbox.
    const { SETU_REPO_DIR: _ignored, ...rest } = env
    return readLoginLink(root, rest)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function main() {
  if (platform() === 'win32') {
    console.log(
      'dev:status: needs `lsof`/`ps` (macOS or Linux); nothing to report on Windows.'
    )
    return
  }
  const status = buildStatus({
    listeners: listListeners(),
    cwdOf,
    worktreeOf,
    startedAt,
    commitsSince,
    envOf,
    loginLink: (root) => loginLinkFor(root),
    home: homedir(),
    now: new Date()
  })
  process.stdout.write(`${render(status)}\n`)
}

if (isDirectInvocation(process.argv[1], import.meta.url)) main()
