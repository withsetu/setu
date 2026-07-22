// Free TCP ports by stopping whatever is LISTENing on them — so a stale dev
// stack never blocks a fresh one. Used by `pnpm dev:fresh` / `pnpm dev:stop`.
//
//   node scripts/free-ports.mjs 4321 4444 5173
//   node scripts/free-ports.mjs --force 4321        # also kill other worktrees' servers
//
// OWNERSHIP (#815): several sessions run dev stacks from different worktrees of this repo, so
// "whoever holds :5173" is not the same question as "my stale server". Each listener's pid is
// resolved to its worktree root (the same pid → cwd → worktree walk `dev:status` uses, imported
// from dev-status.mjs rather than copied), and only listeners owned by the INVOKING worktree are
// signalled. Anything else is printed with its branch and left running unless `--force` is passed.
//
// macOS/Linux only (uses `lsof`); on other platforms it prints a hint and
// no-ops rather than failing the chained `&& pnpm dev`.
import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'
import process from 'node:process'

import { isDirectInvocation } from './auth-login-link.mjs'
import { cwdOf, worktreeOf } from './dev-status.mjs'

/** Look up the PIDs LISTENing on a TCP port via `lsof`. Returns [] when none.
 *  Injectable for tests. */
export function listenersOf(port, run = lsof) {
  const out = run(port)
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
}

function lsof(port) {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString()
  } catch {
    // lsof exits non-zero when nothing is listening — that's "no PIDs", not an error.
    return ''
  }
}

/** argv → `{ ports, invalid, force }`. A port must be a decimal integer in 1–65535: `lsof` fails
 *  on a typo and that failure used to be swallowed as "no PIDs", so `free-ports.mjs 517e` reported
 *  the port FREE (#815). Invalid arguments are collected, not guessed at, and make `run` exit
 *  non-zero. Enforced by the "parsePorts accepts integers 1–65535" and "an invalid port exits
 *  non-zero" tests. */
export function parsePorts(argv) {
  const force = argv.includes('--force') || argv.includes('-f')
  const ports = []
  const invalid = []
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f' || arg === '') continue
    const n = Number(arg)
    if (!/^\d+$/.test(arg) || !Number.isInteger(n) || n < 1 || n > 65535)
      invalid.push(arg)
    else ports.push(n)
  }
  return { ports, invalid, force }
}

/** Decide, for one port, WHICH of its listeners this invocation may signal.
 *  `ownerOf(pid)` returns `{ root, branch }` for a Setu worktree or null; `selfRoot` is the
 *  invoking worktree. Returns `{ port, pids, skipped }` where `skipped` carries the branch so the
 *  caller can name what it left alone. Pure — the planning half, tested without touching real
 *  processes. Enforced by the four planPort tests in free-ports.test.mjs. */
export function planPort(
  port,
  listeners,
  ownerOf,
  selfRoot,
  { force = false } = {}
) {
  const pids = []
  const skipped = []
  for (const pid of listeners) {
    // pid 1 is init/launchd. It cannot be a dev server and signalling it is never right, so it is
    // excluded ahead of --force rather than by it.
    if (pid === 1) {
      skipped.push({ pid, root: null, branch: 'init', reason: 'pid-1' })
      continue
    }
    const owner = ownerOf(pid)
    if (owner && selfRoot && owner.root === selfRoot) {
      pids.push(pid)
      continue
    }
    if (force) {
      pids.push(pid)
      continue
    }
    skipped.push({
      pid,
      root: owner?.root ?? null,
      branch: owner?.branch ?? 'unknown',
      reason: owner ? 'other-worktree' : 'unknown-owner'
    })
  }
  return { port, pids, skipped }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** SIGTERM each PID, wait briefly, then SIGKILL any that survive. `kill`/`sleepFn`
 *  are injectable so the escalation logic is testable without real processes. pid 1 is dropped
 *  here too (last line of defence, enforced by the "stop refuses pid 1" test) — planPort already
 *  excludes it, but this function is exported and a future caller may not go through planPort. */
export async function stop(pids, kill = process.kill, sleepFn = sleep) {
  const targets = pids.filter((pid) => pid !== 1)
  for (const pid of targets) {
    try {
      kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  await sleepFn(400)
  for (const pid of targets) {
    try {
      kill(pid, 0) // throws if the process is gone
      kill(pid, 'SIGKILL')
    } catch {
      /* gone — good */
    }
  }
}

/** pid → owning Setu worktree, or null. Reuses dev-status.mjs's resolution rather than a second
 *  copy of the same `lsof -d cwd` + `git rev-parse` walk. */
export function ownerOfPid(pid) {
  const cwd = cwdOf(pid)
  if (!cwd) return null
  return worktreeOf(cwd)
}

/** The whole command as a pure-ish function returning an exit code, with every process-touching
 *  dependency injected so the decision logic is tested without signalling anything real. */
export async function run({
  argv,
  listenersOf: listeners = listenersOf,
  ownerOf = ownerOfPid,
  selfRoot,
  stopFn = stop,
  log = console.log
} = {}) {
  const { ports, invalid, force } = parsePorts(argv)
  if (invalid.length) {
    log(
      `free-ports: not a valid TCP port: ${invalid.join(', ')} — expected integers in 1–65535.`
    )
    return 1
  }
  if (ports.length === 0) {
    log(
      'free-ports: no ports given (usage: node scripts/free-ports.mjs [--force] 4321 4444 5173)'
    )
    return 0
  }
  for (const port of ports) {
    const { pids, skipped } = planPort(
      port,
      listeners(port),
      ownerOf,
      selfRoot,
      {
        force
      }
    )
    for (const s of skipped) {
      if (s.reason === 'pid-1') {
        log(`port ${port}: skipped pid 1 (init) — never signalled`)
      } else if (s.reason === 'other-worktree') {
        log(
          `port ${port}: skipped pid ${s.pid} — owned by ${s.branch} (${s.root}), not this worktree; pass --force to stop it anyway`
        )
      } else {
        log(
          `port ${port}: skipped pid ${s.pid} — owner unknown (not a Setu worktree, or its cwd is unreadable); pass --force to stop it anyway`
        )
      }
    }
    if (pids.length === 0) {
      log(skipped.length ? `port ${port}: left as is` : `port ${port}: free`)
      continue
    }
    await stopFn(pids)
    log(
      `port ${port}: stopped ${pids.length} listener(s) (pid ${pids.join(', ')})`
    )
  }
  return 0
}

async function main() {
  if (platform() === 'win32') {
    console.log(
      'free-ports: Windows is unsupported; skipping (start your dev stack manually).'
    )
    return
  }
  const selfRoot = worktreeOf(process.cwd())?.root ?? null
  const code = await run({ argv: process.argv.slice(2), selfRoot })
  if (code !== 0) process.exit(code)
}

// Run only as a script, not when imported by tests.
if (isDirectInvocation(process.argv[1], import.meta.url)) {
  await main()
}
