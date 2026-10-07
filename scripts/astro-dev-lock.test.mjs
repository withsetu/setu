import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { astroDevPid } from './astro-dev-lock.mjs'

function withSite(body, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-astrolock-'))
  try {
    if (body !== undefined) {
      mkdirSync(path.join(dir, '.astro'))
      writeFileSync(
        path.join(dir, '.astro', 'dev.json'),
        typeof body === 'string' ? body : JSON.stringify(body)
      )
    }
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('names the live dev server holding the site', () => {
  withSite({ pid: process.pid, port: 4321 }, (dir) =>
    assert.equal(astroDevPid(dir), process.pid)
  )
})

test('degrades open: no lockfile, junk, a non-integer pid, or a dead pid', () => {
  withSite(undefined, (dir) => assert.equal(astroDevPid(dir), null))
  withSite('not json', (dir) => assert.equal(astroDevPid(dir), null))
  withSite({ pid: '123' }, (dir) => assert.equal(astroDevPid(dir), null))
  withSite({ pid: 4242 }, (dir) =>
    assert.equal(
      astroDevPid(dir, () => false),
      null
    )
  )
})

test('never probes pid 0 or a negative — that would aim at our own process group', () => {
  const probed = []
  const alive = (pid) => (probed.push(pid), true)
  withSite({ pid: 0 }, (dir) => assert.equal(astroDevPid(dir, alive), null))
  withSite({ pid: -1 }, (dir) => assert.equal(astroDevPid(dir, alive), null))
  assert.deepEqual(probed, [])
})
