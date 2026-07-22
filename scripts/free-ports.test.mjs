import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listenersOf, parsePorts, planPort, run, stop } from './free-ports.mjs'

const SELF = '/Users/dev/setu'
const OTHER = '/Users/dev/setu/.claude/worktrees/other'

/** pid → worktree, the shape dev-status.mjs's `worktreeOf(cwdOf(pid))` returns. */
const owners = {
  10: { root: SELF, branch: 'scripts-guard-814' },
  20: { root: OTHER, branch: 'autosave-782' }
}
const ownerOf = (pid) => owners[pid] ?? null

test('listenersOf parses pids, ignoring blanks and non-numbers', () => {
  const lsofRun = () => '18103\n17866\n\n  18042  \n'
  assert.deepEqual(listenersOf(4444, lsofRun), [18103, 17866, 18042])
})

test('listenersOf returns [] when nothing is listening', () => {
  assert.deepEqual(
    listenersOf(4444, () => ''),
    []
  )
})

test('planPort keeps only listeners owned by the invoking worktree', () => {
  const plan = planPort(5173, [10, 20], ownerOf, SELF)
  assert.deepEqual(plan.pids, [10])
  assert.deepEqual(plan.skipped, [
    { pid: 20, root: OTHER, branch: 'autosave-782', reason: 'other-worktree' }
  ])
  assert.equal(plan.port, 5173)
})

test('planPort skips a listener whose owner cannot be resolved', () => {
  const plan = planPort(5173, [10, 999], ownerOf, SELF)
  assert.deepEqual(plan.pids, [10])
  assert.deepEqual(plan.skipped, [
    { pid: 999, root: null, branch: 'unknown', reason: 'unknown-owner' }
  ])
})

test('--force includes cross-worktree and unknown listeners', () => {
  const plan = planPort(5173, [10, 20, 999], ownerOf, SELF, { force: true })
  assert.deepEqual(plan.pids, [10, 20, 999])
  assert.deepEqual(plan.skipped, [])
})

test('pid 1 is never signalled, not even with --force', () => {
  const plan = planPort(4444, [1, 10], ownerOf, SELF, { force: true })
  assert.deepEqual(plan.pids, [10])
  assert.deepEqual(plan.skipped, [
    { pid: 1, root: null, branch: 'init', reason: 'pid-1' }
  ])
})

test('parsePorts accepts integers 1–65535 and rejects everything else', () => {
  assert.deepEqual(parsePorts(['4321', '4444', '5173']), {
    ports: [4321, 4444, 5173],
    invalid: [],
    force: false
  })
  assert.deepEqual(parsePorts(['--force', '5173']), {
    ports: [5173],
    invalid: [],
    force: true
  })
  assert.deepEqual(parsePorts(['0', '70000', 'abc', '-1', '5173.5', '']), {
    ports: [],
    invalid: ['0', '70000', 'abc', '-1', '5173.5'],
    force: false
  })
})

test('an invalid port exits non-zero instead of reporting "free"', async () => {
  const lines = []
  const code = await run({
    argv: ['abc'],
    listenersOf: () => {
      throw new Error('must not probe an invalid port')
    },
    ownerOf,
    selfRoot: SELF,
    stopFn: async () => {
      throw new Error('must not signal anything')
    },
    log: (l) => lines.push(l)
  })
  assert.equal(code, 1)
  assert.ok(lines.join('\n').includes('abc'), 'the offending argument is named')
  // The #815 bug: `lsof` failed on the typo, the failure was swallowed, and the port was
  // reported FREE. That exact line must never appear for an unparseable argument.
  assert.doesNotMatch(lines.join('\n'), /^port .*: free$/m)
})

test('run stops only its own listeners and names the skipped ones', async () => {
  const lines = []
  const stopped = []
  const code = await run({
    argv: ['5173'],
    listenersOf: () => [10, 20],
    ownerOf,
    selfRoot: SELF,
    stopFn: async (pids) => stopped.push(...pids),
    log: (l) => lines.push(l)
  })
  assert.equal(code, 0)
  assert.deepEqual(stopped, [10])
  const out = lines.join('\n')
  assert.match(out, /skipped pid 20/)
  assert.match(out, /autosave-782/)
  assert.match(out, /--force/)
})

test('stop SIGTERMs every pid, then SIGKILLs only survivors', async () => {
  const signals = []
  const alive = new Set([100, 200]) // 200 ignores SIGTERM (survives)
  const kill = (pid, sig) => {
    signals.push([pid, sig])
    if (sig === 'SIGTERM' && pid === 100) alive.delete(100) // 100 dies on TERM
    if (sig === 0 && !alive.has(pid)) throw new Error('no such process') // probe: gone
  }
  await stop([100, 200], kill, async () => {})
  assert.deepEqual(signals, [
    [100, 'SIGTERM'],
    [200, 'SIGTERM'],
    [100, 0], // probe — throws (gone) → no SIGKILL for 100
    [200, 0], // probe — survives → SIGKILL
    [200, 'SIGKILL']
  ])
})

test('stop refuses pid 1 even if a caller hands it one', async () => {
  const signals = []
  await stop(
    [1, 100],
    (pid, sig) => signals.push([pid, sig]),
    async () => {}
  )
  assert.ok(!signals.some(([pid]) => pid === 1), 'pid 1 was never signalled')
})
