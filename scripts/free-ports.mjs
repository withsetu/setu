// Free TCP ports by stopping whatever is LISTENing on them — so a stale dev
// stack never blocks a fresh one. Used by `pnpm dev:fresh` / `pnpm dev:stop`.
//
//   node scripts/free-ports.mjs 4321 4444 5173
//
// macOS/Linux only (uses `lsof`); on other platforms it prints a hint and
// no-ops rather than failing the chained `&& pnpm dev`.
import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

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

/** Decide, for one port, what to do: the list of PIDs to signal (or none).
 *  Pure — the planning half, tested without touching real processes. */
export function planPort(port, listeners) {
  return { port, pids: listeners }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** SIGTERM each PID, wait briefly, then SIGKILL any that survive. `kill`/`sleepFn`
 *  are injectable so the escalation logic is testable without real processes. */
export async function stop(pids, kill = process.kill, sleepFn = sleep) {
  for (const pid of pids) {
    try {
      kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  await sleepFn(400)
  for (const pid of pids) {
    try {
      kill(pid, 0) // throws if the process is gone
      kill(pid, 'SIGKILL')
    } catch {
      /* gone — good */
    }
  }
}

async function main() {
  const ports = process.argv.slice(2).filter(Boolean)
  if (ports.length === 0) {
    console.log(
      'free-ports: no ports given (usage: node scripts/free-ports.mjs 4321 4444 5173)'
    )
    return
  }
  if (platform() === 'win32') {
    console.log(
      'free-ports: Windows is unsupported; skipping (start your dev stack manually).'
    )
    return
  }
  for (const port of ports) {
    const { pids } = planPort(port, listenersOf(port))
    if (pids.length === 0) {
      console.log(`port ${port}: free`)
      continue
    }
    await stop(pids)
    console.log(
      `port ${port}: stopped ${pids.length} listener(s) (pid ${pids.join(', ')})`
    )
  }
}

// Run only as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
