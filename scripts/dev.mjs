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
// Usage:  pnpm dev              # the worktree you are standing in
//         pnpm dev <lane>       # a named worktree (`dev` = the main checkout)
//         pnpm dev:stop [lane]  # one lane, or every known lane

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  MAIN_LANE,
  allocateSlot,
  assertValidLaneName,
  laneEnv,
  laneHostnames,
  portsForSlot,
  renderCaddyfile
} from './dev-lanes.mjs'
import { parseDotenv } from './staging.mjs'
import { seedSandbox } from './content-sandbox.mjs'

const DEFAULT_FRONT_PORT = 8080

/** Sibling scripts resolve against THIS file, never against the main checkout. The lane being
 *  started is the code under test; the main checkout may sit on an entirely different commit, and
 *  reaching for its copy silently runs the wrong version (which is exactly what happened first
 *  time — an older free-ports.mjs with no `--check`). */
const sibling = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url))

/** The main checkout, resolved from ANY worktree. `--git-common-dir` points at the shared `.git`,
 *  whose parent is the main checkout — which is why this works without a "cd to the root" rule. */
export function mainCheckout(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf-8'
  }).trim()
  return path.dirname(path.resolve(cwd, common))
}

/** Lane implied by where you are standing: a worktree under `.claude/worktrees/<name>` is that
 *  name; anywhere else in the repo is the main checkout's lane. */
export function laneForCwd(cwd, root) {
  const worktrees = path.join(root, '.claude', 'worktrees')
  const rel = path.relative(worktrees, cwd)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
    return rel.split(path.sep)[0]
  return MAIN_LANE
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

/** `.env` lives ONCE, at the main checkout, and every lane reads it. Holding it in one place is
 *  what removes the per-worktree copies that used to drift. */
function loadEnvFile(root) {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return {}
  return parseDotenv(readFileSync(file, 'utf8'))
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
  { name: 'api', filter: '@setu/api', colour: '[34m' },
  { name: 'admin', filter: '@setu/admin', colour: '[35m' },
  { name: 'site', filter: '@setu/site', colour: '[32m' }
]

/** Spawn the three servers directly rather than through a shell string. The old `concurrently`
 *  one-liner had to quote every env var into a single command, which is exactly where the silent
 *  `${VAR:-default}` fallbacks hid — passing an env object cannot fail that way. */
function startLane(dir, env) {
  const children = ROLES.map(({ name, filter, colour }) => {
    const child = spawn('pnpm', ['--filter', filter, 'dev'], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const prefix = `${colour}[${name}][0m `
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      let buffered = ''
      stream.on('data', (chunk) => {
        buffered += chunk
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) console.log(prefix + line)
      })
    }
    child.on('exit', (code) => {
      if (code !== 0 && code !== null)
        console.log(`${prefix}exited with code ${code}`)
    })
    return child
  })

  const stop = () => {
    for (const c of children) c.kill('SIGTERM')
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return children
}

async function main(argv) {
  const stopping = argv[0] === '--stop'
  const rest = stopping ? argv.slice(1) : argv
  const root = mainCheckout()
  const registry = readRegistry(root)

  if (stopping) {
    const lanes =
      rest.length > 0 ? rest.map(assertValidLaneName) : Object.keys(registry)
    if (lanes.length === 0) lanes.push(MAIN_LANE)
    const ports = lanes.flatMap((lane) => {
      const slot = registry[lane]
      return slot === undefined ? [] : Object.values(portsForSlot(slot))
    })
    if (ports.length === 0) {
      console.log('dev: no known lanes to stop')
      return
    }
    spawn('node', [sibling('free-ports.mjs'), ...ports.map(String)], {
      stdio: 'inherit'
    })
    return
  }

  const lane = assertValidLaneName(rest[0] ?? laneForCwd(process.cwd(), root))
  const dir = dirForLane(root, lane)
  if (!existsSync(dir))
    throw new Error(
      `dev: no worktree for lane ${JSON.stringify(lane)} at ${dir}\n` +
        `     Known lanes: ${[MAIN_LANE, ...Object.keys(registry)].filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
    )

  const fileEnv = loadEnvFile(root)
  const domain = fileEnv.SETU_DEV_DOMAIN || undefined
  const frontPort = Number(fileEnv.SETU_DEV_CADDY_PORT ?? DEFAULT_FRONT_PORT)

  const slot = allocateSlot(registry, lane)
  if (registry[lane] !== slot) {
    registry[lane] = slot
    writeRegistry(root, registry)
  }

  // Shared by default: one sandbox means the first-account bootstrap (#1053) happens once for
  // every lane rather than once per worktree. `.env` can point elsewhere per operator.
  const ownSandbox = !fileEnv.SETU_REPO_DIR
  const repoDir = ownSandbox
    ? path.join(root, '.content-sandbox', MAIN_LANE)
    : fileEnv.SETU_REPO_DIR
  // Only seed the sandbox this script owns. An operator who pointed SETU_REPO_DIR somewhere else
  // owns that directory, and silently seeding into it would be a surprise write.
  if (ownSandbox) seedSandbox(root, MAIN_LANE)

  const derived = laneEnv({ lane, domain, slot, repoDir })
  // Anything the operator set in .env that this does not derive (secrets, email transport,
  // SETU_AUTH_SECRET) still applies; derived values win so a stale hand-written origin cannot
  // silently override the lane's own.
  const env = { ...fileEnv, ...derived }

  const ports = portsForSlot(slot)
  try {
    execFileSync(
      'node',
      [
        sibling('free-ports.mjs'),
        '--check',
        ...Object.values(ports).map(String)
      ],
      { stdio: 'inherit' }
    )
  } catch {
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

  startLane(dir, env)
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
