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

/** The four origins from #869, on the default front port. Subdomains, deliberately — distinct
 *  origins force the honest problems (Secure/SameSite cookies, CORS allowlist,
 *  SETU_ADMIN_ORIGIN) that only surface on real deployments today. */
export const STAGING_ORIGINS = {
  site: 'https://setu.localhost',
  admin: 'https://admin.setu.localhost',
  api: 'https://api.setu.localhost',
  mailpit: 'https://mailpit.setu.localhost'
}

/** The origins for a given overlay: on the default `:443` they are STAGING_ORIGINS verbatim;
 *  with `SETU_STAGING_HTTPS_PORT` overridden (another stack — Docker Desktop, DDEV — may own
 *  443/80 on this machine) every origin gains the explicit port suffix. Derived, never
 *  auto-fallen-back-to: the origins are BAKED into the admin/site builds, so a port that
 *  changed silently between runs would desync builds from the proxy. Enforced by the
 *  stagingOriginsFor tests in scripts/staging.test.mjs. */
export function stagingOriginsFor(overlay) {
  const httpsPort = overlay.SETU_STAGING_HTTPS_PORT ?? '443'
  const suffix = httpsPort === '443' ? '' : `:${httpsPort}`
  return {
    site: `https://setu.localhost${suffix}`,
    admin: `https://admin.setu.localhost${suffix}`,
    api: `https://api.setu.localhost${suffix}`,
    mailpit: `https://mailpit.setu.localhost${suffix}`
  }
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
    SETU_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    // Caddy's front ports. Defaults are the real thing (clean port-less origins); override
    // in .env when another stack (Docker Desktop, DDEV, a local nginx) owns 443/80.
    SETU_STAGING_HTTPS_PORT: '443',
    SETU_STAGING_HTTP_PORT: '80'
  }
}

/** Strict TCP-port shape: decimal digits only, 1–65535. `Number()` is not validation — a typo
 *  like '517e' becomes NaN, `listenersOf(NaN)`'s lsof failure is swallowed as "port free"
 *  (the exact #815 mechanism), and the raw string would flow into the origins and the
 *  generated Caddyfile, surfacing only after two full production builds baked it in. An
 *  injection-shaped value (`8443 } malicious {`) would land verbatim in the Caddyfile.
 *  Enforced by the front-port refusal tests in scripts/staging.test.mjs. */
function assertValidPort(name, value) {
  const n = Number(value)
  if (!/^\d{1,5}$/.test(value) || !Number.isInteger(n) || n < 1 || n > 65535)
    throw new Error(
      `staging: ${name} is not a valid TCP port (got ${JSON.stringify(value)}) — ` +
        'expected an integer in 1–65535.'
    )
}

/** defaults < .env — the whole precedence story. Front ports are validated HERE, at overlay
 *  resolution, so a bad .env value refuses loudly before the sandbox is seeded or any build
 *  starts (see assertValidPort above). */
export function stagingOverlay(dotenv) {
  const overlay = { ...stagingDefaults(), ...dotenv }
  assertValidPort('SETU_STAGING_HTTPS_PORT', overlay.SETU_STAGING_HTTPS_PORT)
  assertValidPort('SETU_STAGING_HTTP_PORT', overlay.SETU_STAGING_HTTP_PORT)
  return overlay
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
  const origins = stagingOriginsFor(overlay)
  return {
    NODE_ENV: 'production',
    SETU_API_PORT: String(STAGING_PORTS.api),
    SETU_REPO_DIR: p.sandbox,
    SETU_MEDIA_DIR: path.join(p.sandbox, '.setu', 'uploads'),
    SETU_MEDIA_PUBLIC_URL: `${origins.api}/media`,
    SETU_BASE_URL: origins.api,
    SETU_ADMIN_ORIGIN: origins.admin,
    SETU_TRUSTED_ORIGINS: origins.site,
    SETU_AUTH_SECRET: secret,
    // Deploy-rebuild parity (site build env, flowing through makeBuildRunner):
    SETU_CONTENT_DIR: path.join(p.sandbox, 'content'),
    SETU_SITE_URL: origins.site,
    SETU_API_URL: origins.api,
    PUBLIC_SETU_MEDIA: origins.api,
    ...overlay
  }
}

/** Vite build env for the admin SPA — the api/site origins are BAKED IN at build time
 *  (import.meta.env), which is exactly the production shape. */
export function adminBuildEnvFor(overlay) {
  const origins = stagingOriginsFor(overlay)
  return {
    VITE_SETU_API: origins.api,
    VITE_SETU_SITE: origins.site,
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
  const origins = stagingOriginsFor(overlay)
  return {
    SETU_CONTENT_DIR: path.join(p.sandbox, 'content'),
    SETU_SITE_URL: origins.site,
    SETU_API_URL: origins.api,
    PUBLIC_SETU_MEDIA: origins.api,
    PUBLIC_SETU_API_BASE: origins.api,
    ...captcha,
    ...overlay
  }
}

/** The generated Caddyfile. `local_certs` = Caddy's built-in local CA (see the README's
 *  "Staging environment" section for what `caddy trust` installs and how to remove it);
 *  `admin off` = no localhost:2019 admin socket, so two Caddy instances can't collide and the
 *  only way to stop this one is the recorded pid — which is how staging:stop works anyway.
 *  Shape enforced by the caddyfileFor tests in scripts/staging.test.mjs. */
export function caddyfileFor(paths, overlay = stagingOverlay({})) {
  // Addresses are bare hostnames; the global http_port/https_port options decide where they
  // bind, so a custom front port changes ONE place and every site follows.
  const host = (origin) => origin.replace('https://', '').replace(/:\d+$/, '')
  const origins = stagingOriginsFor(overlay)
  const httpsPort = overlay.SETU_STAGING_HTTPS_PORT ?? '443'
  const httpPort = overlay.SETU_STAGING_HTTP_PORT ?? '80'
  const portLines =
    httpsPort === '443' && httpPort === '80'
      ? ''
      : `\n	http_port ${httpPort}\n	https_port ${httpsPort}`
  return `{
	admin off
	local_certs${portLines}
}

${host(origins.site)} {
	root * ${paths.siteDist}
	encode gzip
	file_server
	handle_errors {
		rewrite * /404.html
		file_server
	}
}

${host(origins.admin)} {
	root * ${paths.adminDist}
	encode gzip
	try_files {path} /index.html
	file_server
}

${host(origins.api)} {
	reverse_proxy 127.0.0.1:${STAGING_PORTS.api}
}

${host(origins.mailpit)} {
	reverse_proxy 127.0.0.1:${STAGING_PORTS.mailpitUi}
}
`
}

/** Per-child stop markers. caddy and mailpit get SANDBOX-UNIQUE paths their spawned command
 *  lines carry (`--config <…>/Caddyfile`, `--database <…>/mailpit.db`) rather than the binary
 *  names — a generic 'caddy' marker would match ANY caddy on a reused pid (#884 review
 *  Finding 3c). The api's pnpm command line carries no unique path, so its workspace filter is
 *  the tightest marker available there. Enforced by the marker tests in
 *  scripts/staging.test.mjs. */
export function stagingMarkers(paths) {
  return {
    mailpit: paths.mailpitDb,
    api: '@setu/api',
    caddy: paths.caddyfile,
    staging: 'staging.mjs'
  }
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
  let overlay
  try {
    overlay = stagingOverlay(dotenv) // refuses invalid front ports BEFORE seeding or building
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const origins = stagingOriginsFor(overlay)

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
  // The Caddy front ports get a tailored message: 443/80 being owned by another stack
  // (Docker Desktop, DDEV, a local nginx) is common, and the fix is a .env line, not a kill.
  const httpsPort = Number(overlay.SETU_STAGING_HTTPS_PORT ?? '443')
  const httpPort = Number(overlay.SETU_STAGING_HTTP_PORT ?? '80')
  for (const [name, port, isFront] of [
    ['api', STAGING_PORTS.api, false],
    ['mailpit smtp', STAGING_PORTS.smtp, false],
    ['mailpit ui', STAGING_PORTS.mailpitUi, false],
    ['caddy http', httpPort, true],
    ['caddy https', httpsPort, true]
  ]) {
    const pids = listenersOf(port)
    if (pids.length > 0) {
      console.error(
        `staging: port ${port} (${name}) is already in use by pid ${pids.join(', ')} — ` +
          'stop whatever holds it (or `pnpm staging:stop` if it is a leftover staging run).'
      )
      if (isFront)
        console.error(
          'staging: if another stack permanently owns 443/80 on this machine, pick free front ' +
            'ports in .env instead, e.g.:\n' +
            '  SETU_STAGING_HTTPS_PORT=8443\n  SETU_STAGING_HTTP_PORT=8480\n' +
            'The staging origins then carry the port suffix (https://admin.setu.localhost:8443).'
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

  writeFileSync(paths.caddyfile, caddyfileFor(paths, overlay))

  // --- spawn the three long-lived processes ---
  const markers = stagingMarkers(paths)
  let setupToken = null
  let shuttingDown = false
  const children = []
  const records = []

  const shutdown = async (code) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[staging] stopping…')
    // Children only — the 'staging' record is THIS process (recorded for staging:stop's
    // benefit); group-signalling ourselves here would kill this handler before the pid-file
    // cleanup below ever ran. Markers are re-verified immediately before signalling (#884
    // review Finding 3b): even our own child pids can in principle have died and been reused
    // by the time a guard-triggered shutdown runs.
    const verified = planStop(
      records.filter((r) => r.name !== 'staging'),
      { alive: isAlive, cmdOf: commandOf }
    ).stop
    await stopRecorded(verified)
    rmSync(paths.pidsFile, { force: true })
    process.exit(code)
  }

  const guard = (name) => (child) => {
    // A spawn failure (EACCES, vanished binary) emits 'error', often with NO 'exit' — without
    // this handler the failure would orphan the children already spawned before it.
    child.on('error', (err) => {
      if (!shuttingDown) {
        console.error(
          `[staging] ${name} failed to start: ${err.message}. Stopping the rest.`
        )
        void shutdown(1)
      }
    })
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
  records.push({ name: 'mailpit', pid: mailpit.pid, marker: markers.mailpit })

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
  records.push({ name: 'api', pid: api.pid, marker: markers.api })

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
  records.push({ name: 'caddy', pid: caddy.pid, marker: markers.caddy })

  records.push({ name: 'staging', pid: process.pid, marker: markers.staging })
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
  // A readiness timeout tears the whole stack down (shutdown), never throws past it — an
  // uncaught throw here would exit this process and leave all three children running.
  let capabilities = null
  try {
    const capabilitiesRes = await waitForHttp(
      `http://127.0.0.1:${STAGING_PORTS.api}/api/capabilities`,
      'api'
    )
    await waitForHttp(`http://127.0.0.1:${STAGING_PORTS.mailpitUi}/`, 'mailpit')
    capabilities = await capabilitiesRes.json().catch(() => null)
  } catch (err) {
    console.error(`[staging] ${err instanceof Error ? err.message : err}`)
    await shutdown(1)
    return
  }

  console.log(`
[staging] up — self-hosted Node topology parity (prod builds + HTTPS + SMTP):

    site      ${origins.site}
    admin     ${origins.admin}
    api       ${origins.api}/api/capabilities
    mailpit   ${origins.mailpit}
`)
  if (setupToken) {
    console.log(
      `[staging] FIRST RUN — no users yet. Open ${origins.admin}, and create the owner\n` +
        `[staging] account with this one-time setup token:\n[staging]\n` +
        `[staging]     ${setupToken}\n`
    )
  } else if (capabilities?.auth?.needsSetup === false) {
    console.log(
      `[staging] sign in at ${origins.admin} with your existing staging account.`
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
  // Split so the parent (a foreground `pnpm staging`) can be signalled FIRST — see the
  // ordering comment below the plan.
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
  const stopChildren = plan.stop.filter((r) => r.name !== 'staging')
  const stopParents = plan.stop.filter((r) => r.name === 'staging')
  // Parent FIRST, with a plain SIGTERM (never a group kill): its own handler flips its
  // shuttingDown flag and cascades to the children itself. Signalling children first made the
  // parent's exit-guard see caddy die "unexpectedly" and exit 1 mid-teardown; escalating on the
  // parent at stopRecorded's tempo SIGKILLed it before its pid-file cleanup. Both observed on
  // the first live stop cycle of #869.
  for (const r of stopParents) {
    try {
      process.kill(r.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  if (stopParents.length > 0) await sleep(1500)
  // Orphan net: whatever is still alive (parent already dead, or no parent recorded). The
  // liveness AND marker check is re-run immediately before signalling (#884 review Finding 3a):
  // during the 1.5s parent grace a child pid can die and be reused, and a plan from before that
  // window is stale.
  await stopRecorded(
    planStop(stopChildren, { alive: isAlive, cmdOf: commandOf }).stop
  )
  const deadline = Date.now() + 6000
  let survivors = plan.stop.filter((r) => isAlive(r.pid))
  while (survivors.length > 0 && Date.now() < deadline) {
    await sleep(300)
    survivors = plan.stop.filter((r) => isAlive(r.pid))
  }
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
