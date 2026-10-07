import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  busyPortAdvice,
  dirForLane,
  laneForCheckout,
  laneForCwd,
  mainCheckout,
  parseLaneArgs,
  pruneRegistry,
  siteServerPids,
  stopTargets
} from './dev.mjs'
import { MAIN_LANE } from './dev-lanes.mjs'

const ROOT = '/repo'
const WT = path.join(ROOT, '.claude', 'worktrees')

test('standing in the main checkout means the main lane', () => {
  assert.equal(laneForCwd(ROOT, ROOT), MAIN_LANE)
  assert.equal(laneForCwd(path.join(ROOT, 'apps', 'admin'), ROOT), MAIN_LANE)
})

test('standing anywhere inside a worktree means that worktree', () => {
  assert.equal(laneForCwd(path.join(WT, 'feature-x'), ROOT), 'feature-x')
  assert.equal(
    laneForCwd(path.join(WT, 'feature-x', 'apps', 'site'), ROOT),
    'feature-x',
    'a nested directory still resolves to the lane, so there is no cd-to-the-root rule'
  )
})

test('a path outside the repo falls back to the main lane rather than escaping', () => {
  assert.equal(laneForCwd('/somewhere/else', ROOT), MAIN_LANE)
  assert.equal(laneForCwd(path.join(ROOT, '..', 'sibling'), ROOT), MAIN_LANE)
})

test('dirForLane maps the main lane to the checkout and others under worktrees', () => {
  assert.equal(dirForLane(ROOT, MAIN_LANE), ROOT)
  assert.equal(dirForLane(ROOT, 'feature-x'), path.join(WT, 'feature-x'))
})

test('mainCheckout resolves the shared checkout from inside a real worktree', () => {
  // Builds an actual git repo + linked worktree rather than asserting something about wherever
  // this suite happens to run: the first version of this test asserted `root !== cwd`, which is
  // only true when the runner sits inside a worktree. It passed locally and failed on CI, which
  // runs from a plain checkout where returning the cwd is the CORRECT answer.
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'setu-mainco-')))
  const repo = path.join(base, 'repo')
  const linked = path.join(base, 'linked')
  const git = (cwd, args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }
    })
  try {
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 't@e.st'])
    git(repo, ['config', 'user.name', 'T'])
    writeFileSync(path.join(repo, 'f'), 'x\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'init'])
    git(repo, ['worktree', 'add', '-q', linked, '-b', 'wt'])

    assert.equal(
      realpathSync(mainCheckout(linked)),
      repo,
      'from a worktree: the main checkout'
    )
    assert.equal(
      realpathSync(mainCheckout(repo)),
      repo,
      'from the checkout itself: itself'
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

// --- process lifecycle (#1198) ----------------------------------------------------------------

/** A role that behaves like `pnpm --filter <pkg> dev`: it spawns the real server as a grandchild
 *  and, on SIGTERM, exits WITHOUT forwarding the signal. Signalling only its pid therefore leaves
 *  the grandchild running — the orphaned-vite bug this test exists to catch. */
const PNPM_LIKE = `
  const { spawn } = require('node:child_process')
  const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  console.log('GRANDCHILD ' + gc.pid)
  process.on('SIGTERM', () => process.exit(0))
  setInterval(() => {}, 1000)
`

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(pred, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await pred()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

test('a SIGTERM to the launcher reaps a grandchild its role did not forward the signal to, and the launcher exits (#1198)', async () => {
  const devUrl = new URL('./dev.mjs', import.meta.url).href
  const harness = `
    const { superviseLane } = await import(${JSON.stringify(devUrl)})
    superviseLane([{ name: 'fake', command: process.execPath, args: ['-e', ${JSON.stringify(PNPM_LIKE)}] }], {
      cwd: process.cwd(), env: {}, log: (line) => console.log(line)
    })
  `
  const launcher = spawn(
    process.execPath,
    ['--input-type=module', '-e', harness],
    {
      stdio: ['ignore', 'pipe', 'inherit']
    }
  )
  let out = ''
  launcher.stdout.on('data', (c) => (out += c))
  const exited = new Promise((r) =>
    launcher.on('exit', (code, sig) => r({ code, sig }))
  )
  let grandchild = null
  try {
    assert.ok(
      await waitFor(() => {
        const m = /GRANDCHILD (\d+)/.exec(out)
        if (m) grandchild = Number(m[1])
        return grandchild !== null
      }),
      `role never started; launcher said: ${out}`
    )
    assert.ok(isAlive(grandchild))

    launcher.kill('SIGTERM') // the launcher pid only — NOT a tty group signal
    const result = await Promise.race([
      exited,
      new Promise((r) => setTimeout(() => r('timeout'), 8000))
    ])
    assert.notEqual(
      result,
      'timeout',
      'the launcher must exit once its children are gone'
    )
    assert.ok(
      await waitFor(() => !isAlive(grandchild), 3000),
      `grandchild ${grandchild} survived the launcher — it would keep the lane's port`
    )
  } finally {
    if (grandchild && isAlive(grandchild)) process.kill(grandchild, 'SIGKILL')
    if (launcher.exitCode === null) launcher.kill('SIGKILL')
  }
})

// --- dev:stop / dev:fresh argument handling (#1198) ---------------------------------------------

test('--force is a flag, never a lane name', () => {
  assert.deepEqual(parseLaneArgs(['--stop', '--force']), {
    mode: 'stop',
    force: true,
    lanes: []
  })
  assert.deepEqual(parseLaneArgs(['--stop', 'a', '-f']), {
    mode: 'stop',
    force: true,
    lanes: ['a']
  })
  assert.deepEqual(parseLaneArgs(['--fresh', 'b']), {
    mode: 'fresh',
    force: false,
    lanes: ['b']
  })
  assert.deepEqual(parseLaneArgs([]), {
    mode: 'start',
    force: false,
    lanes: []
  })
})

test('unknown flags and --force on a plain start are refused, not guessed at', () => {
  assert.throws(() => parseLaneArgs(['--stop', '--frce']), /unknown flag/)
  assert.throws(() => parseLaneArgs(['--force']), /--force/)
  assert.throws(() => parseLaneArgs(['a', 'b']), /one lane/)
})

test('dev:stop --force with no lane is scoped to the lane you are standing in, never every lane', () => {
  const registry = { dev: 0, a: 1, b: 2 }
  const t = stopTargets({ lanes: [], force: true, registry, cwdLane: 'a' })
  assert.deepEqual(t.ports, [4544, 5273, 4421])
})

test('dev:stop without --force still covers every known lane (free-ports keeps it to your own pids)', () => {
  const t = stopTargets({
    lanes: [],
    force: false,
    registry: { dev: 0, a: 1 },
    cwdLane: 'dev'
  })
  assert.deepEqual(t.ports.sort(), [4321, 4421, 4444, 4544, 5173, 5273].sort())
})

test('the main lane is always slot 0, registered or not', () => {
  const t = stopTargets({
    lanes: ['dev'],
    force: true,
    registry: {},
    cwdLane: 'dev'
  })
  assert.deepEqual(t.ports, [4444, 5173, 4321])
})

test('an unregistered lane is reported, not silently skipped', () => {
  const t = stopTargets({
    lanes: ['ghost'],
    force: true,
    registry: {},
    cwdLane: 'dev'
  })
  assert.deepEqual(t.ports, [])
  assert.deepEqual(t.unknown, ['ghost'])
})

test('pruneRegistry drops lanes whose worktree is gone, and never the main lane', () => {
  const live = new Set([path.join(WT, 'a')])
  const { registry, pruned } = pruneRegistry(
    { dev: 0, a: 1, gone: 2, '../x': 3 },
    ROOT,
    (dir) => live.has(dir)
  )
  assert.deepEqual(registry, { dev: 0, a: 1 })
  assert.deepEqual(pruned.sort(), ['../x', 'gone'])
})

test('the busy-port advice names this lane and the force flag, and no longer suggests SETU_ADMIN_PORT', () => {
  const text = busyPortAdvice('feature-x', 'dev')
  assert.match(text, /pnpm dev:stop feature-x/)
  assert.match(text, /pnpm dev:stop --force feature-x/)
  assert.doesNotMatch(text, /SETU_ADMIN_PORT/)
  assert.match(busyPortAdvice('dev', 'dev'), /pnpm dev:stop --force(\s|$)/)
})

test('a worktree outside .claude/worktrees is refused, not silently run as the main lane (#1200)', () => {
  assert.equal(laneForCheckout(ROOT, ROOT), MAIN_LANE)
  assert.equal(laneForCheckout(path.join(WT, 'a'), ROOT), 'a')
  assert.throws(
    () => laneForCheckout('/elsewhere/my-wt', ROOT),
    /outside .*worktrees.*MAIN checkout's code[\s\S]*git worktree move/
  )
})

/** A role that behaves like `astro dev` under an auto-detected AI agent (astro 7): it re-launches
 *  the server DETACHED — in its own process group, out of reach of a group signal — and exits 0
 *  at once, leaving only a lockfile-style pid behind. */
const ASTRO_BACKGROUND_LIKE = `
  const { spawn } = require('node:child_process')
  const bg = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true })
  bg.unref()
  console.log('BACKGROUND ' + bg.pid)
`

test('a server its role re-launched in the background is adopted and stopped too (#1198)', async () => {
  const devUrl = new URL('./dev.mjs', import.meta.url).href
  const harness = `
    const { superviseLane } = await import(${JSON.stringify(devUrl)})
    let bg = null
    superviseLane([
      { name: 'site', command: process.execPath, args: ['-e', ${JSON.stringify(ASTRO_BACKGROUND_LIKE)}] },
      { name: 'api', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }
    ], {
      cwd: process.cwd(), env: {},
      log: (line) => { const m = /BACKGROUND (\\d+)/.exec(line); if (m) bg = Number(m[1]); console.log(line) },
      adopt: () => (bg ? [bg] : [])
    })
  `
  const launcher = spawn(
    process.execPath,
    ['--input-type=module', '-e', harness],
    {
      stdio: ['ignore', 'pipe', 'inherit']
    }
  )
  let out = ''
  launcher.stdout.on('data', (c) => (out += c))
  const exited = new Promise((r) =>
    launcher.on('exit', (code, sig) => r({ code, sig }))
  )
  let bg = null
  try {
    assert.ok(
      await waitFor(() => {
        const m = /BACKGROUND (\d+)/.exec(out)
        if (m) bg = Number(m[1])
        return bg !== null
      }),
      `role never started; launcher said: ${out}`
    )
    await new Promise((r) => setTimeout(r, 200)) // the role leader has exited by now
    launcher.kill('SIGTERM')
    const result = await Promise.race([
      exited,
      new Promise((r) => setTimeout(() => r('timeout'), 8000))
    ])
    assert.notEqual(result, 'timeout', 'the launcher must exit')
    assert.ok(
      await waitFor(() => !isAlive(bg), 3000),
      `background server ${bg} outlived the launcher`
    )
  } finally {
    if (bg && isAlive(bg)) process.kill(bg, 'SIGKILL')
    if (launcher.exitCode === null) launcher.kill('SIGKILL')
  }
})

test('siteServerPids adopts the lockfile pid only while it still runs from this lane', () => {
  const dir = '/repo/.claude/worktrees/a'
  const pidOf = () => 900
  assert.deepEqual(
    siteServerPids(dir, {
      pidOf,
      cmdOf: () => `node ${dir}/node_modules/astro/bin/astro.mjs dev`
    }),
    [900]
  )
  assert.deepEqual(
    siteServerPids(dir, {
      pidOf,
      cmdOf: () => 'node /repo/node_modules/astro dev'
    }),
    [],
    "another lane's (or a reused) pid is not ours"
  )
  assert.deepEqual(
    siteServerPids('/repo', {
      pidOf,
      cmdOf: () => `node ${dir}/node_modules/astro dev`
    }),
    [],
    "the main lane does not adopt a worktree's server just because its path is a prefix"
  )
  assert.deepEqual(
    siteServerPids(dir, { pidOf: () => null, cmdOf: () => '' }),
    []
  )
})
