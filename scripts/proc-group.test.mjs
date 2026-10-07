import { test } from 'node:test'
import assert from 'node:assert/strict'

import { signalGroup, stopGroups } from './proc-group.mjs'

function fakeKill({ groups = new Set(), stubborn = new Set() } = {}) {
  const calls = []
  const kill = (pid, sig) => {
    calls.push([pid, sig])
    const target = Math.abs(pid)
    if (pid < 0 && !groups.has(target)) throw new Error('ESRCH')
    if (sig === 0) {
      if (!groups.has(target)) throw new Error('ESRCH')
      return
    }
    if (sig === 'SIGKILL' || (sig === 'SIGTERM' && !stubborn.has(target)))
      groups.delete(target)
  }
  return { kill, calls, groups }
}

test('signalGroup signals the NEGATIVE pid, so the whole tree is reached (#1198)', () => {
  const { kill, calls } = fakeKill({ groups: new Set([42]) })
  signalGroup(42, 'SIGTERM', kill)
  assert.deepEqual(calls, [[-42, 'SIGTERM']])
})

test('signalGroup falls back to the bare pid when there is no such group', () => {
  const { kill, calls } = fakeKill()
  signalGroup(42, 'SIGTERM', kill)
  assert.deepEqual(calls, [
    [-42, 'SIGTERM'],
    [42, 'SIGTERM']
  ])
})

test('stopGroups escalates to SIGKILL only for a group that outlives the grace period', async () => {
  const fake = fakeKill({ groups: new Set([10, 20]), stubborn: new Set([20]) })
  const { killed } = await stopGroups([10, 20], {
    kill: fake.kill,
    sleepFn: async () => {},
    graceMs: 300,
    pollMs: 100
  })
  assert.deepEqual(killed, [20])
  assert.ok(fake.calls.some(([p, s]) => p === -20 && s === 'SIGKILL'))
  assert.ok(!fake.calls.some(([p, s]) => p === -10 && s === 'SIGKILL'))
  assert.equal(fake.groups.size, 0)
})

test('stopGroups returns as soon as every group is gone — no needless wait', async () => {
  const fake = fakeKill({ groups: new Set([10]) })
  let slept = 0
  await stopGroups([10], {
    kill: fake.kill,
    sleepFn: async () => {
      slept++
    }
  })
  assert.equal(slept, 0)
})

test('stopGroups never signals pid 1, 0, or a negative', async () => {
  const fake = fakeKill()
  await stopGroups([1, 0, -5, 1.5], {
    kill: fake.kill,
    sleepFn: async () => {}
  })
  assert.deepEqual(fake.calls, [])
})
