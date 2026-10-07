// Stop a detached child AND everything it spawned (#1198).
//
// `pnpm --filter <pkg> dev` is a wrapper: the real server (vite / astro / tsx) is a grandchild,
// and pnpm (10.x and 11.x) does not forward SIGTERM to it. Signalling the pnpm pid therefore
// leaves the server running, reparented to PID 1 and still holding the lane's port. Ctrl-C only
// ever worked because the terminal signals the whole foreground process GROUP.
//
// So every managed child is spawned `detached: true` — which makes it the leader of its own
// process group — and stopped by signalling the NEGATIVE pid, i.e. the whole group, then
// escalating to SIGKILL for anything still alive after a grace period. `scripts/staging.mjs` and
// `scripts/dev.mjs` both stop their children through this one function. The behaviour is pinned
// by scripts/proc-group.test.mjs (unit) and the real-process "stopping the lane reaps a
// grandchild that ignores its parent" test in scripts/dev.test.mjs.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** True while `pid`'s group (or, failing that, the pid itself) still has a live member. Signal 0
 *  delivers nothing — it only probes. */
export function groupAlive(pid, kill = process.kill) {
  try {
    kill(-pid, 0)
    return true
  } catch {
    try {
      kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}

/** Signal `pid`'s process group; fall back to the bare pid when it is not a group leader (a
 *  child spawned without `detached`). Never throws — a vanished group is the goal state. */
export function signalGroup(pid, sig, kill = process.kill) {
  try {
    kill(-pid, sig)
  } catch {
    try {
      kill(pid, sig)
    } catch {
      /* already gone */
    }
  }
}

/** SIGTERM every group, wait up to `graceMs` for them to exit, then SIGKILL the survivors.
 *  pid <= 1 is refused outright: -1 would mean "every process we may signal" and 0 our own group,
 *  so a bad record must never reach `kill`. Everything process-touching is injectable. */
export async function stopGroups(
  pids,
  {
    kill = process.kill,
    alive = (pid) => groupAlive(pid, kill),
    sleepFn = sleep,
    graceMs = 1200,
    pollMs = 100
  } = {}
) {
  const targets = pids.filter((pid) => Number.isInteger(pid) && pid > 1)
  for (const pid of targets) signalGroup(pid, 'SIGTERM', kill)
  for (let waited = 0; waited < graceMs; waited += pollMs) {
    if (!targets.some(alive)) return { killed: [] }
    await sleepFn(pollMs)
  }
  const survivors = targets.filter(alive)
  for (const pid of survivors) signalGroup(pid, 'SIGKILL', kill)
  return { killed: survivors }
}
