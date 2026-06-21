import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listenersOf, planPort, stop } from './free-ports.mjs'

test('listenersOf parses pids, ignoring blanks and non-numbers', () => {
  const run = () => '18103\n17866\n\n  18042  \n'
  assert.deepEqual(listenersOf(4444, run), [18103, 17866, 18042])
})

test('listenersOf returns [] when nothing is listening', () => {
  assert.deepEqual(listenersOf(4444, () => ''), [])
})

test('planPort carries the port and its pids', () => {
  assert.deepEqual(planPort(5173, [1, 2]), { port: 5173, pids: [1, 2] })
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
    [200, 'SIGKILL'],
  ])
})
