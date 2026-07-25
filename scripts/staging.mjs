// Staging-parity local environment (#869): `pnpm staging` / `pnpm staging:stop`.
//
// Simulates the SELF-HOSTED NODE topology on this machine — production builds, real HTTPS,
// secure cross-origin cookies, and real SMTP delivery — the exact class of thing `pnpm dev`
// cannot exercise (it runs dev servers, plain http, and the console email adapter):
//
//   https://setu.localhost           the production-built Astro site (Caddy file_server)
//   https://admin.setu.localhost     the production-built admin SPA  (Caddy file_server)
//   https://api.setu.localhost       the api in self-hosted posture  (Caddy reverse_proxy)
//   https://mailpit.setu.localhost   Mailpit's web UI                (Caddy reverse_proxy)
//
// Two brew-installable binaries (caddy + mailpit), no Docker. Caddy's built-in local CA issues
// the certificates; `*.localhost` resolves to loopback natively in every modern browser, so
// there is zero hosts-file setup. Nothing here ships to production.
//
// Env contract: script defaults (below) < repo-root `.env` (untracked; see the tracked
// `.env.example`). Shell exports are deliberately NOT consulted for the staging knobs so the
// same command always assembles the same stack — override via `.env`, not `export`.
// Enforced by scripts/staging.test.mjs (".env overrides beat every script-owned value").
//
// Stop safety: `staging:stop` kills ONLY pids it recorded at start, after verifying each pid's
// current command still matches what was launched (pid reuse) — never a blind port kill (see
// free-ports.mjs's ownership rationale, #815). Enforced by the planStop tests in
// scripts/staging.test.mjs.
//
// Usage:  node scripts/staging.mjs start
//         node scripts/staging.mjs stop

import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isDirectInvocation } from './auth-login-link.mjs'
import { seedSandbox } from './content-sandbox.mjs'
import { listenersOf } from './free-ports.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Repo root resolved from this file's location — never process.cwd(), so the command behaves
 *  the same from any cwd (the playwright.config.ts precedent). */
const REPO_ROOT = path.resolve(__dirname, '..')

const SANDBOX_NAME = 'staging'

/** A dedicated port block colliding with nothing else the repo runs (dev 4444/5173/4321,
 *  e2e 4446/5175, captcha lane 4447/4449/5176/5177) nor with mailpit's own defaults 1025/8025,
 *  which another tool on this machine may already hold. Caddy fronts 443 (+80 for the
 *  http→https redirect). Enforced by the port test in scripts/staging.test.mjs. */
export const STAGING_PORTS = {
  /** api's internal loopback port; the public face is https://api.setu.localhost */
  api: 4460,
  /** mailpit SMTP sink (loopback only) */
  smtp: 11026,
  /** mailpit web UI + REST API (loopback only; proxied by Caddy) */
  mailpitUi: 18026
}

/** The four origins from #869. Subdomains, deliberately — distinct origins force the honest
 *  problems (Secure/SameSite cookies, CORS allowlist, SETU_ADMIN_ORIGIN) that only surface on
 *  real deployments today. */
export const STAGING_ORIGINS = {
  site: 'https://setu.localhost',
  admin: 'https://admin.setu.localhost',
  api: 'https://api.setu.localhost',
  mailpit: 'https://mailpit.setu.localhost'
}

/** Every filesystem location the staging profile owns, all under the gitignored
 *  `.content-sandbox/staging/` (so `pnpm content:reset staging` is a full factory reset)
 *  plus the two app dist dirs the production builds land in. */
export function stagingPaths(root) {
  const sandbox = path.join(root, '.content-sandbox', SANDBOX_NAME)
  const runtimeDir = path.join(sandbox, '.setu', 'staging')
  return {
    sandbox,
    runtimeDir,
    logsDir: path.join(runtimeDir, 'logs'),
    caddyfile: path.join(runtimeDir, 'Caddyfile'),
    pidsFile: path.join(runtimeDir, 'pids.json'),
    authSecretFile: path.join(runtimeDir, 'auth-secret'),
    mailpitDb: path.join(runtimeDir, 'mailpit.db'),
    adminDist: path.join(root, 'apps', 'admin', 'dist'),
    siteDist: path.join(root, 'apps', 'site', 'dist')
  }
}

/** Minimal KEY=VALUE dotenv parser (node builtins only, like every script here): comments and
 *  blank lines skipped, optional single/double quotes stripped, later keys win, NO expansion —
 *  values are literal. Enforced by the parseDotenv tests in scripts/staging.test.mjs. */
export function parseDotenv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/** The zero-secret staging defaults, mirrored by the tracked `.env.example` (kept in lockstep
 *  by the ".env.example stays honest" test in scripts/staging.test.mjs):
 *  - smtp → the mailpit sink this script starts (mailpit needs no auth);
 *  - a from-address (not sensitive — without one the api keeps email disabled, #364);
 *  - Cloudflare's public always-pass Turnstile TEST pair (#868 — documentation values, not
 *    secrets; the api boot line flags them loudly as TEST KEYS).
 *  No SETU_AUTH_SECRET here: that is generated per sandbox at start (never tracked). */
function stagingDefaults() {
  return {
    SETU_EMAIL_ADAPTER: 'smtp',
    SETU_SMTP_HOST: '127.0.0.1',
    SETU_SMTP_PORT: String(STAGING_PORTS.smtp),
    SETU_FORMS_NOTIFY_FROM: 'staging@setu.localhost',
    SETU_CAPTCHA_PROVIDER: 'turnstile',
    SETU_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    SETU_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA'
  }
}

/** defaults < .env — the whole precedence story. */
export function stagingOverlay(dotenv) {
  return { ...stagingDefaults(), ...dotenv }
}

/** The api process env: self-hosted posture (NO SETU_MODE=local — config.ts fails closed to
 *  'self-hosted'; NODE_ENV=production locks the prod-only branches), the staging sandbox as the
 *  content repo, mailpit as the SMTP target, and the cross-origin cookie contract
 *  (SETU_BASE_URL / SETU_ADMIN_ORIGIN / SETU_TRUSTED_ORIGINS — explicit origins, never a
 *  wildcard). Also carries the site-build vars so an admin-triggered Deploy rebuild
 *  (deploy-wiring.ts's makeBuildRunner passes this env through) rebuilds the SAME site Caddy
 *  serves. Every claim here is enforced by the apiEnvFor tests in scripts/staging.test.mjs. */
export function apiEnvFor({ root, overlay, secret }) {
  const p = stagingPaths(root)
  return {
    NODE_ENV: 'production',
    SETU_API_PORT: String(STAGING_PORTS.api),
    SETU_REPO_DIR: p.sandbox,
    SETU_MEDIA_DIR: path.join(p.sandbox, '.setu', 'uploads'),
    SETU_MEDIA_PUBLIC_URL: `${STAGING_ORIGINS.api}/media`,
    SETU_BASE_URL: STAGING_ORIGINS.api,
    SETU_ADMIN_ORIGIN: STAGING_ORIGINS.admin,
    SETU_TRUSTED_ORIGINS: STAGING_ORIGINS.site,
    SETU_AUTH_SECRET: secret,
    // Deploy-rebuild parity (site build env, flowing through makeBuildRunner):
    SETU_CONTENT_DIR: path.join(p.sandbox, 'content'),
    SETU_SITE_URL: STAGING_ORIGINS.site,
    SETU_API_URL: STAGING_ORIGINS.api,
    PUBLIC_SETU_MEDIA: STAGING_ORIGINS.api,
    ...overlay
  }
}

/** Vite build env for the admin SPA — the api/site origins are BAKED IN at build time
 *  (import.meta.env), which is exactly the production shape. */
export function adminBuildEnvFor(overlay) {
  return {
    VITE_SETU_API: STAGING_ORIGINS.api,
    VITE_SETU_SITE: STAGING_ORIGINS.site,
    ...overlay
  }
}

/** Astro build env for the site: read content from the staging sandbox, emit absolute URLs on
 *  the staging origins, and (when captcha is on) bake the PUBLIC captcha pair the contact block
 *  reads at build time (blocks/contact/contact.astro · apps/site/.env.example). */
export function siteBuildEnvFor({ root, overlay }) {
  const p = stagingPaths(root)
  const captcha =
    overlay.SETU_CAPTCHA_PROVIDER === 'turnstile' &&
    overlay.SETU_TURNSTILE_SITE_KEY
      ? {
          PUBLIC_CAPTCHA_PROVIDER: 'turnstile',
          PUBLIC_CAPTCHA_SITE_KEY: overlay.SETU_TURNSTILE_SITE_KEY
        }
      : {}
  return {
    SETU_CONTENT_DIR: path.join(p.sandbox, 'content'),
    SETU_SITE_URL: STAGING_ORIGINS.site,
    SETU_API_URL: STAGING_ORIGINS.api,
    PUBLIC_SETU_MEDIA: STAGING_ORIGINS.api,
    PUBLIC_SETU_API_BASE: STAGING_ORIGINS.api,
    ...captcha,
    ...overlay
  }
}

/** The generated Caddyfile. `local_certs` = Caddy's built-in local CA (see the README's
 *  "Staging environment" section for what `caddy trust` installs and how to remove it);
 *  `admin off` = no localhost:2019 admin socket, so two Caddy instances can't collide and the
 *  only way to stop this one is the recorded pid — which is how staging:stop works anyway.
 *  Shape enforced by the caddyfileFor tests in scripts/staging.test.mjs. */
export function caddyfileFor(paths) {
  const host = (origin) => origin.replace('https://', '')
  return `{
	admin off
	local_certs
}

${host(STAGING_ORIGINS.site)} {
	root * ${paths.siteDist}
	encode gzip
	file_server
	handle_errors {
		rewrite * /404.html
		file_server
	}
}

${host(STAGING_ORIGINS.admin)} {
	root * ${paths.adminDist}
	encode gzip
	try_files {path} /index.html
	file_server
}

${host(STAGING_ORIGINS.api)} {
	reverse_proxy 127.0.0.1:${STAGING_PORTS.api}
}

${host(STAGING_ORIGINS.mailpit)} {
	reverse_proxy 127.0.0.1:${STAGING_PORTS.mailpitUi}
}
`
}

/** Decide which recorded pids `stop` may signal. A pid is stopped only when it is (a) a sane
 *  pid (>1 — pid 1 is launchd, negatives are group ids), (b) still alive, and (c) its CURRENT
 *  command line still contains the marker recorded at launch — a reused pid belongs to someone
 *  else and is skipped, named, and left alone. Pure planning half, tested without touching real
 *  processes (the free-ports.mjs planPort pattern). Enforced by the planStop tests in
 *  scripts/staging.test.mjs. */
export function planStop(records, { alive, cmdOf }) {
  const stop = []
  const skip = []
  for (const record of records) {
    if (!Number.isInteger(record.pid) || record.pid <= 1) {
      skip.push({ record, reason: 'bad-pid' })
      continue
    }
    if (!alive(record.pid)) {
      skip.push({ record, reason: 'not-running' })
      continue
    }
    if (!cmdOf(record.pid).includes(record.marker)) {
      skip.push({ record, reason: 'command-mismatch' })
      continue
    }
    stop.push(record)
  }
  return { stop, skip }
}

// ---------------------------------------------------------------------------
// Process-touching half — deliberately thin; the logic above is what's tested.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isAlive(pid) {
  try {
    process.kill(pid, 0)
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

/** SIGTERM the child's process GROUP (children are spawned detached as group leaders, so this
 *  reaches pnpm's node grandchildren too), escalate to SIGKILL for survivors. */
async function stopRecorded(records) {
  const signalGroup = (pid, sig) => {
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        process.kill(pid, sig)
      } catch {
        /* already gone */
      }
    }
  }
  for (const r of records) signalGroup(r.pid, 'SIGTERM')
  await sleep(1200)
  for (const r of records) {
    if (isAlive(r.pid)) signalGroup(r.pid, 'SIGKILL')
  }
}

function requireBinary(bin, installHint) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' })
  } catch {
    console.error(
      `staging: \`${bin}\` not found on PATH. Install it with: ${installHint}`
    )
    process.exit(1)
  }
}

function readPidsFile(pidsFile) {
  try {
    const parsed = JSON.parse(readFileSync(pidsFile, 'utf8'))
    return Array.isArray(parsed.records) ? parsed : null
  } catch {
    return null
  }
}

function ensureAuthSecret(paths, overlay) {
  if (overlay.SETU_AUTH_SECRET) return overlay.SETU_AUTH_SECRET
  if (existsSync(paths.authSecretFile)) {
    const existing = readFileSync(paths.authSecretFile, 'utf8').trim()
    if (existing !== '') return existing
  }
  const secret = randomBytes(32).toString('base64url')
  writeFileSync(paths.authSecretFile, secret + '\n', { mode: 0o600 })
  return secret
}

function runBuild(label, filter, extraEnv) {
  console.log(`\n[staging] building ${label} (${filter})…`)
  execFileSync('pnpm', ['--filter', filter, 'build'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  })
}

/** Spawn a managed child: its own process group (detached) so stop can signal the whole tree,
 *  stdout+stderr teed to `<logsDir>/<name>.log` AND echoed with a `[name]` prefix. */
function launch({ name, file, args, cwd, env, logsDir, onLine }) {
  const child = spawn(file, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const log = createWriteStream(path.join(logsDir, `${name}.log`), {
    flags: 'a'
  })
  const tee = (stream) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      log.write(chunk)
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (line.trim() !== '') console.log(`[${name}] ${line}`)
        onLine?.(line)
      }
    })
  }
  tee(child.stdout)
  tee(child.stderr)
  return child
}

async function waitForHttp(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(
    `staging: ${label} did not become ready at ${url} within ${timeoutMs / 1000}s`
  )
}

async function start() {
  requireBinary('caddy', 'brew install caddy')
  requireBinary('mailpit', 'brew install mailpit')

  const paths = stagingPaths(REPO_ROOT)
  const dotenvPath = path.join(REPO_ROOT, '.env')
  const dotenv = existsSync(dotenvPath)
    ? parseDotenv(readFileSync(dotenvPath, 'utf8'))
    : {}
  if (Object.keys(dotenv).length > 0)
    console.log(
      `[staging] loaded ${Object.keys(dotenv).length} override(s) from .env`
    )
  const overlay = stagingOverlay(dotenv)

  // Already running? Refuse — never stack a second instance on the first.
  const existing = readPidsFile(paths.pidsFile)
  if (existing) {
    const { stop } = planStop(existing.records, {
      alive: isAlive,
      cmdOf: commandOf
    })
    if (stop.length > 0) {
      console.error(
        `staging: already running (${stop.map((r) => `${r.name} pid ${r.pid}`).join(', ')}). ` +
          'Run `pnpm staging:stop` first.'
      )
      process.exit(1)
    }
    rmSync(paths.pidsFile, { force: true }) // stale file from a hard kill — safe to clear
  }

  // Port preflight — report, never kill (that is staging:stop's job, and only for OUR pids).
  for (const [name, port] of [
    ['api', STAGING_PORTS.api],
    ['mailpit smtp', STAGING_PORTS.smtp],
    ['mailpit ui', STAGING_PORTS.mailpitUi],
    ['caddy http', 80],
    ['caddy https', 443]
  ]) {
    const pids = listenersOf(port)
    if (pids.length > 0) {
      console.error(
        `staging: port ${port} (${name}) is already in use by pid ${pids.join(', ')} — ` +
          'stop whatever holds it (or `pnpm staging:stop` if it is a leftover staging run).'
      )
      process.exit(1)
    }
  }

  const seeded = seedSandbox(REPO_ROOT, SANDBOX_NAME)
  console.log(
    seeded
      ? `[staging] seeded .content-sandbox/${SANDBOX_NAME} from content/`
      : `[staging] reusing existing .content-sandbox/${SANDBOX_NAME} (users + content persist; ` +
          `\`pnpm content:reset ${SANDBOX_NAME}\` for a factory reset)`
  )
  mkdirSync(paths.logsDir, { recursive: true })

  const secret = ensureAuthSecret(paths, overlay)

  // Production builds, staging origins baked in.
  runBuild('admin SPA', '@setu/admin', adminBuildEnvFor(overlay))
  runBuild('site', '@setu/site', siteBuildEnvFor({ root: REPO_ROOT, overlay }))

  writeFileSync(paths.caddyfile, caddyfileFor(paths))

  // --- spawn the three long-lived processes ---
  let setupToken = null
  let shuttingDown = false
  const children = []
  const records = []

  const shutdown = async (code) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[staging] stopping…')
    await stopRecorded(records)
    rmSync(paths.pidsFile, { force: true })
    process.exit(code)
  }

  const guard = (name) => (child) => {
    child.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(
          `[staging] ${name} exited unexpectedly (code ${code}) — ` +
            `see ${path.join(paths.logsDir, `${name}.log`)}. Stopping the rest.`
        )
        void shutdown(1)
      }
    })
    return child
  }

  const mailpit = guard('mailpit')(
    launch({
      name: 'mailpit',
      file: 'mailpit',
      args: [
        '--smtp',
        `127.0.0.1:${STAGING_PORTS.smtp}`,
        '--listen',
        `127.0.0.1:${STAGING_PORTS.mailpitUi}`,
        '--database',
        paths.mailpitDb
      ],
      cwd: REPO_ROOT,
      env: process.env,
      logsDir: paths.logsDir
    })
  )
  children.push(mailpit)
  records.push({ name: 'mailpit', pid: mailpit.pid, marker: 'mailpit' })

  const api = guard('api')(
    launch({
      name: 'api',
      file: 'pnpm',
      args: ['--filter', '@setu/api', 'start'],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...apiEnvFor({ root: REPO_ROOT, overlay, secret })
      },
      logsDir: paths.logsDir,
      onLine: (line) => {
        const match = line.match(/Setup token: (\S+)/)
        if (match) setupToken = match[1]
      }
    })
  )
  children.push(api)
  records.push({ name: 'api', pid: api.pid, marker: '@setu/api' })

  const caddy = guard('caddy')(
    launch({
      name: 'caddy',
      file: 'caddy',
      args: ['run', '--config', paths.caddyfile, '--adapter', 'caddyfile'],
      cwd: paths.runtimeDir,
      env: process.env,
      logsDir: paths.logsDir
    })
  )
  children.push(caddy)
  records.push({ name: 'caddy', pid: caddy.pid, marker: 'caddy' })

  records.push({ name: 'staging', pid: process.pid, marker: 'staging.mjs' })
  writeFileSync(
    paths.pidsFile,
    JSON.stringify({ startedAt: new Date().toISOString(), records }, null, 2) +
      '\n'
  )

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => void shutdown(0))
  }

  // Readiness: poll the two loopback HTTP surfaces. Caddy has no plain-HTTP health URL here
  // (its cert would need trust to poll over TLS), so its liveness is the exit-guard above.
  const capabilitiesRes = await waitForHttp(
    `http://127.0.0.1:${STAGING_PORTS.api}/api/capabilities`,
    'api'
  )
  await waitForHttp(`http://127.0.0.1:${STAGING_PORTS.mailpitUi}/`, 'mailpit')
  const capabilities = await capabilitiesRes.json().catch(() => null)

  console.log(`
[staging] up — self-hosted Node topology parity (prod builds + HTTPS + SMTP):

    site      ${STAGING_ORIGINS.site}
    admin     ${STAGING_ORIGINS.admin}
    api       ${STAGING_ORIGINS.api}/api/capabilities
    mailpit   ${STAGING_ORIGINS.mailpit}
`)
  if (setupToken) {
    console.log(
      `[staging] FIRST RUN — no users yet. Open ${STAGING_ORIGINS.admin}, and create the owner\n` +
        `[staging] account with this one-time setup token:\n[staging]\n` +
        `[staging]     ${setupToken}\n`
    )
  } else if (capabilities?.auth?.needsSetup === false) {
    console.log(
      `[staging] sign in at ${STAGING_ORIGINS.admin} with your existing staging account.`
    )
  }
  console.log(
    '[staging] If the browser distrusts the certificate, run `caddy trust` once\n' +
      '[staging] (see README.md → "Staging environment"). Stop: Ctrl-C here, or `pnpm staging:stop`.'
  )
}

async function stopCommand() {
  const paths = stagingPaths(REPO_ROOT)
  const state = readPidsFile(paths.pidsFile)
  if (!state) {
    console.log('staging: not running (no pid file) — nothing to stop.')
    return
  }
  // The parent (a foreground `pnpm staging`) is stopped LAST: killing it first would fire its
  // own shutdown concurrently with ours. Children first, idempotently; then the parent.
  const children = state.records.filter((r) => r.name !== 'staging')
  const parents = state.records.filter((r) => r.name === 'staging')
  const plan = planStop([...children, ...parents], {
    alive: isAlive,
    cmdOf: commandOf
  })
  for (const { record, reason } of plan.skip) {
    if (reason === 'command-mismatch')
      console.log(
        `staging: skipping pid ${record.pid} (${record.name}) — its command no longer matches; ` +
          'the pid was likely reused by another process. Left alone.'
      )
  }
  if (plan.stop.length === 0) {
    console.log(
      'staging: nothing recorded is still running — clearing the stale pid file.'
    )
    rmSync(paths.pidsFile, { force: true })
    return
  }
  await stopRecorded(plan.stop)
  const survivors = plan.stop.filter((r) => isAlive(r.pid))
  if (survivors.length > 0) {
    console.error(
      `staging: could not stop ${survivors.map((r) => `${r.name} pid ${r.pid}`).join(', ')}`
    )
    process.exit(1)
  }
  rmSync(paths.pidsFile, { force: true })
  console.log(
    `staging: stopped ${plan.stop.map((r) => `${r.name} (pid ${r.pid})`).join(', ')}.`
  )
}

async function main(argv) {
  const cmd = argv[0]
  if (cmd === 'start') return start()
  if (cmd === 'stop') return stopCommand()
  console.error('usage: staging.mjs <start|stop>')
  process.exit(1)
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2))
}
