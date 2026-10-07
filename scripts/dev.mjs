// `pnpm dev [lane]` — start one worktree's dev stack (#1055).
//
// Replaces the shell one-liner this script used to be. That one-liner had two problems the
// launcher exists to remove:
//
//   1. Starting a specific worktree meant `cd … && set -a; source .env; set +a; pnpm dev`, and
//      forgetting `set -a` failed SILENTLY — the `${VAR:-default}` fallbacks won and the admin
//      came up pointing at loopback with no error anywhere (#1049, #1051).
//   2. Running two worktrees at once meant hand-allocating ports and hand-registering three
//      Cloudflare hostnames per lane.
//
// Now every per-lane value is DERIVED from the lane name (scripts/dev-lanes.mjs), and a local
// Caddy fronts every lane behind one wildcard tunnel rule, so adding a worktree changes nothing
// outside this repo.
//
// Usage:  pnpm dev                       # the worktree you are standing in
//         pnpm dev <lane>                # a named worktree (`dev` = the main checkout)
//         pnpm dev:stop [lane...]        # free the ports your own servers hold on those lanes
//                                        #   (no lane: every known lane)
//         pnpm dev:stop --force [lane]   # also stop processes this worktree does not own on
//                                        #   that ONE lane's ports (no lane: the lane you are in)
//         pnpm dev:fresh [lane]          # dev:stop for that lane, then pnpm dev

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  MAIN_LANE,
  allocateSlot,
  assertValidLaneName,
  laneEnv,
  preferOperatorSiteUrl,
  laneHostnames,
  portsForSlot,
  renderCaddyfile
} from './dev-lanes.mjs'
import { astroDevPid } from './astro-dev-lock.mjs'
import { seedSandbox } from './content-sandbox.mjs'
import { laneSandbox, mainCheckout, readDotenvAt } from './lane-sandbox.mjs'
import { stopGroups } from './proc-group.mjs'

export { mainCheckout }

const DEFAULT_FRONT_PORT = 8080

/** Sibling scripts resolve against THIS file, never against the main checkout. The lane being
 *  started is the code under test; the main checkout may sit on an entirely different commit, and
 *  reaching for its copy silently runs the wrong version (which is exactly what happened first
 *  time — an older free-ports.mjs with no `--check`). */
const sibling = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url))

/** Lane implied by where you are standing: a worktree under `.claude/worktrees/<name>` is that
 *  name; anywhere else in the repo is the main checkout's lane. */
export function laneForCwd(cwd, root) {
  const worktrees = path.join(root, '.claude', 'worktrees')
  const rel = path.relative(worktrees, cwd)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
    return rel.split(path.sep)[0]
  return MAIN_LANE
}

/** The lane for the checkout you are standing in, given that checkout's own top level (#1200).
 *  laneForCwd alone maps a worktree created OUTSIDE `.claude/worktrees` to the main lane, so
 *  `pnpm dev` there silently ran the main checkout's code. A checkout that is neither the main
 *  one nor under `.claude/worktrees` is refused with the fix. Pinned in scripts/dev.test.mjs. */
export function laneForCheckout(toplevel, root) {
  const lane = laneForCwd(toplevel, root)
  if (lane === MAIN_LANE && path.resolve(toplevel) !== path.resolve(root))
    throw new Error(
      `dev: ${toplevel} is a worktree outside ${path.join(root, '.claude', 'worktrees')}, so ` +
        "`pnpm dev` would run the MAIN checkout's code, not this one's.\n" +
        `     Move it: git worktree move ${toplevel} ${path.join(root, '.claude', 'worktrees', path.basename(toplevel))}`
    )
  return lane
}

export function dirForLane(root, lane) {
  return lane === MAIN_LANE
    ? root
    : path.join(root, '.claude', 'worktrees', lane)
}

const registryPath = (root) => path.join(root, '.claude', 'dev-lanes.json')

function readRegistry(root) {
  const file = registryPath(root)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // A corrupt registry must not wedge the launcher: reallocating slots costs a changed URL,
    // which is visible and recoverable, whereas refusing to start is not.
    console.warn(`dev: ignoring unreadable lane registry at ${file}`)
    return {}
  }
}

function writeRegistry(root, registry) {
  const file = registryPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`)
}

/** Drop registry entries whose worktree directory no longer exists (#1198). Without this every
 *  deleted worktree kept its slot forever and `pnpm dev` eventually refused "too many lanes".
 *  The main lane is never pruned, and a hand-edited entry that is not a valid lane name is
 *  dropped rather than joined into a path. Pure (`exists` injected); pinned in
 *  scripts/dev.test.mjs. */
export function pruneRegistry(registry, root, exists = existsSync) {
  const kept = {}
  const pruned = []
  for (const [lane, slot] of Object.entries(registry)) {
    let valid = true
    try {
      assertValidLaneName(lane)
    } catch {
      valid = false
    }
    if (lane === MAIN_LANE || (valid && exists(dirForLane(root, lane))))
      kept[lane] = slot
    else pruned.push(lane)
  }
  return { registry: kept, pruned }
}

/** argv → `{ mode, force, lanes }`. `--force`/`-f` is a FLAG: it used to fall through to
 *  assertValidLaneName and be refused as a lane name, so `dev:stop --force` could never force.
 *  Pinned in scripts/dev.test.mjs. */
export function parseLaneArgs(argv) {
  const mode =
    argv[0] === '--stop' ? 'stop' : argv[0] === '--fresh' ? 'fresh' : 'start'
  const rest = mode === 'start' ? argv : argv.slice(1)
  let force = false
  const lanes = []
  for (const arg of rest) {
    if (arg === '--force' || arg === '-f') force = true
    else if (arg.startsWith('-'))
      throw new Error(`dev: unknown flag ${JSON.stringify(arg)}`)
    else lanes.push(assertValidLaneName(arg))
  }
  if (mode === 'start' && force)
    throw new Error(
      'dev: --force only applies to `pnpm dev:stop` / `pnpm dev:fresh`'
    )
  if (mode !== 'stop' && lanes.length > 1)
    throw new Error('dev: start one lane at a time')
  return { mode, force, lanes }
}

const slotFor = (registry, lane) =>
  Object.prototype.hasOwnProperty.call(registry, lane)
    ? registry[lane]
    : lane === MAIN_LANE
      ? 0
      : undefined

/** Which ports `dev:stop` frees. `--force` signals processes this worktree does not own, so it is
 *  always scoped to ONE lane's own ports — the named lane(s), or the lane you are standing in —
 *  never "every known lane". Pure; pinned in scripts/dev.test.mjs. */
export function stopTargets({ lanes, force, registry, cwdLane }) {
  const names =
    lanes.length > 0 ? lanes : force ? [cwdLane] : Object.keys(registry)
  if (names.length === 0) names.push(MAIN_LANE)
  const ports = []
  const unknown = []
  for (const lane of names) {
    const slot = slotFor(registry, lane)
    if (slot === undefined) unknown.push(lane)
    else ports.push(...Object.values(portsForSlot(slot)))
  }
  return { ports, unknown }
}

/** What to tell someone whose lane ports are busy. The old advice (`SETU_ADMIN_PORT=… pnpm dev`)
 *  was a no-op — laneEnv derives every port from the slot and wins over the shell. Pinned in
 *  scripts/dev.test.mjs. */
export function busyPortAdvice(lane, cwdLane) {
  const arg = lane === cwdLane ? '' : ` ${lane}`
  return (
    '\nThe dev servers run with strictPort, so a busy port stops the stack rather than\n' +
    'silently moving to another one (a moved admin would still call the api baked into its\n' +
    'bundle). Either:\n' +
    `  pnpm dev:stop${arg}           free the ports your own servers hold\n` +
    `  pnpm dev:stop --force${arg}   also stop whatever else holds THIS lane's ports\n` +
    '                          (e.g. servers orphaned by a deleted worktree)'
  )
}

function have(bin) {
  try {
    // `sh -c` because `command -v` is a shell builtin. `bin` is a module-local literal, never
    // caller input, so there is nothing here to interpolate hostilely.
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

/** Regenerate the Caddyfile from EVERY registered lane, not just the running one, so starting a
 *  second lane does not tear down the first one's route. A route to a stopped lane simply 502s. */
function syncCaddy(root, registry, domain, frontPort) {
  if (!domain) return null
  if (!have('caddy')) {
    console.warn(
      'dev: SETU_DEV_DOMAIN is set but `caddy` is not installed — lane hostnames will not resolve.\n' +
        '     Install caddy, or unset SETU_DEV_DOMAIN to run on loopback ports only.'
    )
    return null
  }
  const lanes = Object.entries(registry).map(([lane, slot]) => ({ lane, slot }))
  const file = path.join(root, '.claude', 'Caddyfile')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, renderCaddyfile(lanes, domain, frontPort))

  // Reload if Caddy is already fronting other lanes; otherwise start it. Reload keeps every
  // running lane's proxy up — see the admin-API note in dev-lanes.mjs.
  try {
    execFileSync(
      'caddy',
      ['reload', '--config', file, '--adapter', 'caddyfile'],
      {
        stdio: 'ignore'
      }
    )
    console.log(`dev: caddy reloaded (${lanes.length} lane(s))`)
  } catch {
    const child = spawn(
      'caddy',
      ['run', '--config', file, '--adapter', 'caddyfile'],
      {
        stdio: 'ignore',
        detached: true
      }
    )
    child.unref()
    console.log(`dev: caddy started on :${frontPort} (${lanes.length} lane(s))`)
  }
  return file
}

const ROLES = [
  { name: 'api', filter: '@setu/api', colour: '\u001b[34m' },
  { name: 'admin', filter: '@setu/admin', colour: '\u001b[35m' },
  { name: 'site', filter: '@setu/site', colour: '\u001b[32m' }
]

/** Spawn every role as the leader of its OWN process group (`detached`) and supervise them (#1198).
 *
 *  `pnpm --filter <pkg> dev` does not forward SIGTERM to the server it runs, so signalling the
 *  pnpm pid alone left vite/astro/tsx running, reparented to PID 1, still holding the lane's
 *  ports. Stopping therefore signals each whole group via scripts/proc-group.mjs (SIGTERM, then
 *  SIGKILL for survivors). Because the children are no longer in the terminal's foreground group,
 *  Ctrl-C reaches only this process — the handlers below forward it. Once every role has exited
 *  the launcher reaps any straggler in their groups and exits itself.
 *
 *  `adopt()` names servers a role re-launched OUTSIDE its group. astro 7's `astro dev` does that
 *  whenever it auto-detects an AI agent (macOS/Linux): it starts the server detached in the
 *  background and exits 0, so no group signal reaches it. The launcher adopts it through Astro's
 *  dev lockfile (scripts/astro-dev-lock.mjs) — see siteServerPids below.
 *
 *  Spawned directly rather than through a shell string: the old `concurrently` one-liner had to
 *  quote every env var into a single command, which is exactly where the silent
 *  `${VAR:-default}` fallbacks hid — passing an env object cannot fail that way.
 *
 *  Pinned by the real-process "a SIGTERM to the launcher reaps a grandchild" test in
 *  scripts/dev.test.mjs. */
export function superviseLane(
  roles,
  { cwd, env, log = console.log, adopt = () => [] }
) {
  const children = roles.map(({ name, command, args, colour = '' }) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const prefix = `${colour}[${name}]\u001b[0m `
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      let buffered = ''
      stream.on('data', (chunk) => {
        buffered += chunk
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) log(prefix + line)
      })
    }
    child.on('error', (err) => log(`${prefix}failed to start: ${err.message}`))
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) log(`${prefix}exited with code ${code}`)
    })
    return child
  })

  const rolePids = children.map((c) => c.pid).filter((pid) => pid !== undefined)
  // `adopt` is asked at stop time, not spawn time: a server that re-launches itself in the
  // background only exists (and only has a pid) after its role has started.
  const targets = () => [...new Set([...rolePids, ...adopt()])]
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await stopGroups(targets())
  }

  const done = Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve()
          child.once('exit', resolve)
          child.once('error', resolve)
        })
    )
  ).then(async () => {
    // A role's leader can exit while its group lives on (a crashed pnpm leaves its server). Reap
    // the groups before the launcher goes, so nothing outlives it holding a port.
    await stopGroups(targets())
  })

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(sig, () => {
      void stop()
    })
  void done.then(() => process.exit(stopping ? 0 : 1))
  return { children, stop, done }
}

/** The lane's `astro dev` server, from its own lockfile (`<dir>/apps/site/.astro/dev.json`) — but
 *  only while that pid's command line still runs from THIS lane's checkout, so a stale lockfile
 *  whose pid was reused can never aim the stop at somebody else's process. */
export function siteServerPids(
  dir,
  { pidOf = astroDevPid, cmdOf = commandOf } = {}
) {
  const pid = pidOf(path.join(dir, 'apps', 'site'))
  if (pid === null) return []
  const ownModules = path.join(dir, 'node_modules') + path.sep
  return cmdOf(pid).includes(ownModules) ? [pid] : []
}

/** Free a set of lane ports via free-ports.mjs and wait for it — `dev:fresh` chains a start on
 *  the result, so this must not return before the ports are actually free. */
function freePorts(ports, force) {
  const res = spawnSync(
    'node',
    [
      sibling('free-ports.mjs'),
      ...(force ? ['--force'] : []),
      ...ports.map(String)
    ],
    { stdio: 'inherit' }
  )
  return res.status ?? 1
}

function cwdLane(root) {
  const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  }).trim()
  return laneForCheckout(toplevel, root)
}

async function main(argv) {
  const { mode, force, lanes } = parseLaneArgs(argv)
  const root = mainCheckout()
  const read = readRegistry(root)
  const { registry, pruned } = pruneRegistry(read, root)
  if (pruned.length > 0) {
    writeRegistry(root, registry)
    console.log(
      `dev: pruned ${pruned.length} lane(s) whose worktree no longer exists: ${pruned.join(', ')}`
    )
  }

  if (mode === 'stop' || mode === 'fresh') {
    // Ports come from the registry AS READ, so a lane pruned just now (its worktree is gone but
    // its servers may still be running) can still be stopped by name.
    // `dev:fresh` stops one lane — the named one, or the one you are standing in — then starts it.
    const here = lanes.length > 0 ? lanes[0] : cwdLane(root)
    const { ports, unknown } = stopTargets({
      lanes: mode === 'fresh' ? [here] : lanes,
      force,
      registry: read,
      cwdLane: here
    })
    for (const lane of unknown)
      console.log(
        `dev: lane ${JSON.stringify(lane)} has no slot — nothing to stop`
      )
    if (ports.length > 0) {
      const code = freePorts(ports, force)
      if (code !== 0) process.exit(code)
    } else if (mode === 'stop') console.log('dev: no known lanes to stop')
    if (mode === 'stop') return
  }

  const lane = lanes[0] ?? cwdLane(root)
  const dir = dirForLane(root, lane)
  if (!existsSync(dir))
    throw new Error(
      `dev: no worktree for lane ${JSON.stringify(lane)} at ${dir}\n` +
        `     Known lanes: ${[MAIN_LANE, ...Object.keys(registry)].filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
    )

  const fileEnv = readDotenvAt(root)
  const domain = fileEnv.SETU_DEV_DOMAIN || undefined
  const frontPort = Number(fileEnv.SETU_DEV_CADDY_PORT ?? DEFAULT_FRONT_PORT)

  const slot = allocateSlot(registry, lane)
  if (registry[lane] !== slot) {
    registry[lane] = slot
    writeRegistry(root, registry)
  }

  // Shared by default: one sandbox means the first-account bootstrap (#1053) happens once for
  // every lane rather than once per worktree. `.env` can point elsewhere per operator, and only
  // the sandbox this script owns is seeded — silently seeding an operator's directory would be a
  // surprise write. Resolved by scripts/lane-sandbox.mjs, the one rule every sandbox tool uses.
  const sandbox = laneSandbox(root, fileEnv)
  const repoDir = sandbox.dir
  if (sandbox.owned) seedSandbox(root, MAIN_LANE)

  // `dir` (the lane's own worktree), not `root`: setu.config.ts belongs to the checkout being
  // run, while the sandbox above is shared (#1086).
  const derived = laneEnv({
    lane,
    domain,
    slot,
    repoDir,
    checkoutDir: dir,
    mediaDir: fileEnv.SETU_MEDIA_DIR
  })
  // Anything the operator set in .env that this does not derive (secrets, email transport,
  // SETU_AUTH_SECRET) still applies; derived values win so a stale hand-written origin cannot
  // silently override the lane's own.
  const env = preferOperatorSiteUrl(
    { ...fileEnv, ...derived },
    process.env,
    fileEnv
  )

  const ports = portsForSlot(slot)
  const check = spawnSync(
    'node',
    [sibling('free-ports.mjs'), '--check', ...Object.values(ports).map(String)],
    { stdio: 'inherit' }
  )
  if (check.status !== 0) {
    let here = MAIN_LANE
    try {
      here = cwdLane(root)
    } catch {
      /* advice falls back to naming the lane explicitly */
    }
    console.error(busyPortAdvice(lane, here))
    process.exit(1)
  }

  syncCaddy(root, registry, domain, frontPort)

  const hosts = laneHostnames(lane, domain)
  console.log(`\ndev: lane ${lane}  (slot ${slot})  ${dir}`)
  console.log(`     sandbox ${repoDir}`)
  for (const role of ['admin', 'api', 'site'])
    console.log(
      `     ${role.padEnd(5)} ${hosts ? `https://${hosts[role]}` : `http://localhost:${ports[role]}`}  ->  :${ports[role]}`
    )
  console.log('')

  superviseLane(
    ROLES.map(({ name, filter, colour }) => ({
      name,
      colour,
      command: 'pnpm',
      args: ['--filter', filter, 'dev']
    })),
    {
      cwd: dir,
      env: { ...process.env, ...env },
      adopt: () => siteServerPids(dir)
    }
  )
}

/** True when this module is what node was launched with — same path-comparing pattern as
 *  apps/api/src/scripts/reset-password.ts, never a string-built file:// template. */
export function isDirectInvocation(argv1, metaUrl) {
  if (!argv1) return false
  return path.resolve(argv1) === fileURLToPath(metaUrl)
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
