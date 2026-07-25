import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STAGING_PORTS,
  STAGING_ORIGINS,
  stagingOriginsFor,
  parseDotenv,
  stagingOverlay,
  stagingPaths,
  apiEnvFor,
  adminBuildEnvFor,
  siteBuildEnvFor,
  caddyfileFor,
  planStop
} from './staging.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const ROOT = '/Users/dev/setu'
const SECRET = 'unit-test-secret'

// ---------------------------------------------------------------------------
// Port block — must collide with nothing else this repo runs.

test('staging ports avoid every other lane the repo uses', () => {
  // dev 4444/5173/4321 · e2e 4446/5175 · captcha lane 4447/4449/5176/5177 ·
  // mailpit's own defaults 1025/8025 (another tool may already run them).
  const taken = [
    4444, 5173, 4321, 4446, 5175, 4447, 4449, 5176, 5177, 1025, 8025
  ]
  const ours = Object.values(STAGING_PORTS)
  assert.equal(
    new Set(ours).size,
    ours.length,
    'staging ports must be distinct'
  )
  for (const p of ours) {
    assert.ok(
      !taken.includes(p),
      `staging port ${p} collides with a known lane`
    )
    assert.ok(Number.isInteger(p) && p > 1024 && p < 65536)
  }
})

test('staging origins are the four subdomain HTTPS origins from #869', () => {
  assert.deepEqual(STAGING_ORIGINS, {
    site: 'https://setu.localhost',
    admin: 'https://admin.setu.localhost',
    api: 'https://api.setu.localhost',
    mailpit: 'https://mailpit.setu.localhost'
  })
})

test('stagingOriginsFor is STAGING_ORIGINS verbatim on the default front port', () => {
  assert.deepEqual(stagingOriginsFor(stagingOverlay({})), STAGING_ORIGINS)
})

test('stagingOriginsFor adds the port suffix when 443 is overridden (Docker/DDEV machines)', () => {
  const overlay = stagingOverlay({ SETU_STAGING_HTTPS_PORT: '8443' })
  assert.deepEqual(stagingOriginsFor(overlay), {
    site: 'https://setu.localhost:8443',
    admin: 'https://admin.setu.localhost:8443',
    api: 'https://api.setu.localhost:8443',
    mailpit: 'https://mailpit.setu.localhost:8443'
  })
})

test('a front-port override flows into api env, build envs, and Caddyfile together', () => {
  const overlay = stagingOverlay({
    SETU_STAGING_HTTPS_PORT: '8443',
    SETU_STAGING_HTTP_PORT: '8480'
  })
  const api = apiEnvFor({ root: ROOT, overlay, secret: SECRET })
  assert.equal(api.SETU_ADMIN_ORIGIN, 'https://admin.setu.localhost:8443')
  assert.equal(api.SETU_BASE_URL, 'https://api.setu.localhost:8443')
  const admin = adminBuildEnvFor(overlay)
  assert.equal(admin.VITE_SETU_API, 'https://api.setu.localhost:8443')
  const caddy = caddyfileFor(stagingPaths(ROOT), overlay)
  assert.ok(caddy.includes('https_port 8443'))
  assert.ok(caddy.includes('http_port 8480'))
  // Addresses stay bare hostnames — the global ports decide where they bind.
  assert.ok(caddy.includes('admin.setu.localhost {'))
})

test('the default Caddyfile sets no port overrides (clean 443/80)', () => {
  const caddy = caddyfileFor(stagingPaths(ROOT), stagingOverlay({}))
  assert.ok(!caddy.includes('https_port'))
  assert.ok(!caddy.includes('http_port'))
})

// ---------------------------------------------------------------------------
// .env parsing

test('parseDotenv reads KEY=VALUE lines, skipping comments and blanks', () => {
  const out = parseDotenv(
    '# comment\n\nFOO=bar\n  BAZ = qux \nQUOTED="a b"\nSINGLE=\'c d\'\n'
  )
  assert.deepEqual(out, {
    FOO: 'bar',
    BAZ: 'qux',
    QUOTED: 'a b',
    SINGLE: 'c d'
  })
})

test('parseDotenv handles CRLF, = in values, and later-wins duplicates', () => {
  const out = parseDotenv('A=1\r\nB=x=y\r\nA=2\r\n')
  assert.deepEqual(out, { A: '2', B: 'x=y' })
})

test('parseDotenv drops malformed keys and lines with no =', () => {
  const out = parseDotenv('not a line\n2BAD=x\n-ALSO=x\nOK=1\n=nokey\n')
  assert.deepEqual(out, { OK: '1' })
})

test('parseDotenv performs no expansion — values are literal', () => {
  const out = parseDotenv('A=$HOME\nB=${A}\n')
  assert.deepEqual(out, { A: '$HOME', B: '${A}' })
})

// ---------------------------------------------------------------------------
// Overlay (defaults < .env)

test('stagingOverlay ships complete zero-secret defaults', () => {
  const o = stagingOverlay({})
  assert.equal(o.SETU_EMAIL_ADAPTER, 'smtp')
  assert.equal(o.SETU_SMTP_HOST, '127.0.0.1')
  assert.equal(o.SETU_SMTP_PORT, String(STAGING_PORTS.smtp))
  assert.equal(o.SETU_FORMS_NOTIFY_FROM, 'staging@setu.localhost')
  // Cloudflare's public always-pass Turnstile test pair (see apps/api/README.md, #868).
  assert.equal(o.SETU_CAPTCHA_PROVIDER, 'turnstile')
  assert.equal(o.SETU_TURNSTILE_SITE_KEY, '1x00000000000000000000AA')
  assert.equal(o.SETU_TURNSTILE_SECRET, '1x0000000000000000000000000000000AA')
  // Never a baked-in auth secret: it is generated per sandbox at start time.
  assert.equal(o.SETU_AUTH_SECRET, undefined)
})

test('stagingOverlay lets .env override any default', () => {
  const o = stagingOverlay({
    SETU_SMTP_PORT: '2025',
    SETU_CAPTCHA_PROVIDER: ''
  })
  assert.equal(o.SETU_SMTP_PORT, '2025')
  assert.equal(o.SETU_CAPTCHA_PROVIDER, '')
  assert.equal(o.SETU_EMAIL_ADAPTER, 'smtp') // untouched defaults survive
})

// ---------------------------------------------------------------------------
// Paths

test('stagingPaths puts everything under .content-sandbox/staging', () => {
  const p = stagingPaths(ROOT)
  assert.equal(p.sandbox, path.join(ROOT, '.content-sandbox', 'staging'))
  assert.ok(p.runtimeDir.startsWith(p.sandbox))
  assert.ok(p.pidsFile.startsWith(p.runtimeDir))
  assert.ok(p.caddyfile.startsWith(p.runtimeDir))
  assert.ok(p.authSecretFile.startsWith(p.runtimeDir))
  assert.equal(p.adminDist, path.join(ROOT, 'apps', 'admin', 'dist'))
  assert.equal(p.siteDist, path.join(ROOT, 'apps', 'site', 'dist'))
})

// ---------------------------------------------------------------------------
// API env — the prod-posture contract

test('apiEnvFor wires the self-hosted posture: no local mode, prod NODE_ENV', () => {
  const env = apiEnvFor({
    root: ROOT,
    overlay: stagingOverlay({}),
    secret: SECRET
  })
  assert.equal(env.SETU_MODE, undefined) // fails closed to self-hosted in config.ts
  assert.equal(env.NODE_ENV, 'production')
  assert.equal(env.SETU_AUTH_SECRET, SECRET)
})

test('apiEnvFor wires the cross-origin cookie contract the issue exists for', () => {
  const env = apiEnvFor({
    root: ROOT,
    overlay: stagingOverlay({}),
    secret: SECRET
  })
  assert.equal(env.SETU_BASE_URL, STAGING_ORIGINS.api)
  assert.equal(env.SETU_ADMIN_ORIGIN, STAGING_ORIGINS.admin)
  // The built site's own origin (forms fetch from site pages) — an explicit
  // allowlist entry, exactly like a real VPS deploy. Never a wildcard.
  assert.equal(env.SETU_TRUSTED_ORIGINS, STAGING_ORIGINS.site)
  assert.ok(!JSON.stringify(env).includes('*'), 'no wildcard origins')
})

test('apiEnvFor points the api at the staging sandbox and mailpit', () => {
  const env = apiEnvFor({
    root: ROOT,
    overlay: stagingOverlay({}),
    secret: SECRET
  })
  const sandbox = path.join(ROOT, '.content-sandbox', 'staging')
  assert.equal(env.SETU_REPO_DIR, sandbox)
  assert.equal(env.SETU_MEDIA_DIR, path.join(sandbox, '.setu', 'uploads'))
  assert.equal(env.SETU_MEDIA_PUBLIC_URL, `${STAGING_ORIGINS.api}/media`)
  assert.equal(env.SETU_API_PORT, String(STAGING_PORTS.api))
  assert.equal(env.SETU_EMAIL_ADAPTER, 'smtp')
  assert.equal(env.SETU_SMTP_HOST, '127.0.0.1')
  assert.equal(env.SETU_SMTP_PORT, String(STAGING_PORTS.smtp))
  assert.equal(env.SETU_FORMS_NOTIFY_FROM, 'staging@setu.localhost')
})

test('apiEnvFor carries the site-build env so an admin-triggered Deploy rebuild works', () => {
  const env = apiEnvFor({
    root: ROOT,
    overlay: stagingOverlay({}),
    secret: SECRET
  })
  const sandbox = path.join(ROOT, '.content-sandbox', 'staging')
  assert.equal(env.SETU_CONTENT_DIR, path.join(sandbox, 'content'))
  assert.equal(env.SETU_SITE_URL, STAGING_ORIGINS.site)
  assert.equal(env.PUBLIC_SETU_MEDIA, STAGING_ORIGINS.api)
  assert.equal(env.SETU_API_URL, STAGING_ORIGINS.api)
})

test('.env overrides beat every script-owned value (documented contract)', () => {
  const overlay = stagingOverlay({
    SETU_ADMIN_ORIGIN: 'https://cms.example.test'
  })
  const env = apiEnvFor({ root: ROOT, overlay, secret: SECRET })
  assert.equal(env.SETU_ADMIN_ORIGIN, 'https://cms.example.test')
})

// ---------------------------------------------------------------------------
// Build envs

test('adminBuildEnvFor bakes the staging api/site origins into the SPA build', () => {
  const env = adminBuildEnvFor(stagingOverlay({}))
  assert.equal(env.VITE_SETU_API, STAGING_ORIGINS.api)
  assert.equal(env.VITE_SETU_SITE, STAGING_ORIGINS.site)
})

test('siteBuildEnvFor wires content dir, urls, and the public captcha pair', () => {
  const env = siteBuildEnvFor({ root: ROOT, overlay: stagingOverlay({}) })
  assert.equal(
    env.SETU_CONTENT_DIR,
    path.join(ROOT, '.content-sandbox', 'staging', 'content')
  )
  assert.equal(env.SETU_SITE_URL, STAGING_ORIGINS.site)
  assert.equal(env.SETU_API_URL, STAGING_ORIGINS.api)
  assert.equal(env.PUBLIC_SETU_MEDIA, STAGING_ORIGINS.api)
  assert.equal(env.PUBLIC_SETU_API_BASE, STAGING_ORIGINS.api)
  // blocks/contact/contact.astro reads these at build time (apps/site/.env.example).
  assert.equal(env.PUBLIC_CAPTCHA_PROVIDER, 'turnstile')
  assert.equal(env.PUBLIC_CAPTCHA_SITE_KEY, '1x00000000000000000000AA')
})

test('siteBuildEnvFor omits the captcha pair when the provider is disabled', () => {
  const overlay = stagingOverlay({ SETU_CAPTCHA_PROVIDER: '' })
  const env = siteBuildEnvFor({ root: ROOT, overlay })
  assert.equal(env.PUBLIC_CAPTCHA_PROVIDER, undefined)
  assert.equal(env.PUBLIC_CAPTCHA_SITE_KEY, undefined)
})

// ---------------------------------------------------------------------------
// Caddyfile generation

test('caddyfileFor emits all four origins with the right upstreams', () => {
  const text = caddyfileFor(stagingPaths(ROOT))
  for (const origin of Object.values(STAGING_ORIGINS)) {
    assert.ok(
      text.includes(origin.replace('https://', '')),
      `missing ${origin}`
    )
  }
  assert.ok(text.includes(`reverse_proxy 127.0.0.1:${STAGING_PORTS.api}`))
  assert.ok(text.includes(`reverse_proxy 127.0.0.1:${STAGING_PORTS.mailpitUi}`))
})

test('caddyfileFor serves the two production builds from their dist dirs', () => {
  const p = stagingPaths(ROOT)
  const text = caddyfileFor(p)
  assert.ok(text.includes(p.siteDist))
  assert.ok(text.includes(p.adminDist))
})

test('caddyfileFor gives ONLY the admin block an SPA fallback', () => {
  const text = caddyfileFor(stagingPaths(ROOT))
  const adminBlock = text.split(/\n(?=\S)/).find((b) => b.startsWith('admin.'))
  const siteBlock = text.split(/\n(?=\S)/).find((b) => b.startsWith('setu.'))
  assert.ok(adminBlock.includes('try_files {path} /index.html'))
  assert.ok(!siteBlock.includes('try_files'))
})

test('caddyfileFor disables the caddy admin endpoint (no :2019 collisions)', () => {
  const text = caddyfileFor(stagingPaths(ROOT))
  assert.ok(text.includes('admin off'))
  assert.ok(text.includes('local_certs'))
})

// ---------------------------------------------------------------------------
// Stop planning — kills ONLY what it started

const aliveSet = new Set([100, 200])
const commands = {
  100: 'node /opt/homebrew/bin/pnpm --filter @setu/api start',
  200: '/usr/bin/some-random-reused-pid --daemon'
}
const deps = {
  alive: (pid) => aliveSet.has(pid),
  cmdOf: (pid) => commands[pid] ?? ''
}

test('planStop stops a live pid whose command matches its marker', () => {
  const plan = planStop([{ name: 'api', pid: 100, marker: '@setu/api' }], deps)
  assert.deepEqual(
    plan.stop.map((r) => r.pid),
    [100]
  )
  assert.deepEqual(plan.skip, [])
})

test('planStop skips a dead pid instead of erroring', () => {
  const plan = planStop([{ name: 'caddy', pid: 999, marker: 'caddy' }], deps)
  assert.deepEqual(plan.stop, [])
  assert.equal(plan.skip[0].reason, 'not-running')
})

test('planStop refuses a reused pid whose command no longer matches', () => {
  const plan = planStop([{ name: 'api', pid: 200, marker: '@setu/api' }], deps)
  assert.deepEqual(plan.stop, [])
  assert.equal(plan.skip[0].reason, 'command-mismatch')
})

test('planStop never signals pid 1, 0, or negatives, even if recorded', () => {
  const evil = [
    { name: 'a', pid: 1, marker: '' },
    { name: 'b', pid: 0, marker: '' },
    { name: 'c', pid: -5, marker: '' }
  ]
  const plan = planStop(evil, { alive: () => true, cmdOf: () => 'anything' })
  assert.deepEqual(plan.stop, [])
  assert.ok(plan.skip.every((s) => s.reason === 'bad-pid'))
})

// ---------------------------------------------------------------------------
// .env.example stays honest

test('.env.example parses and matches the script defaults exactly', () => {
  const text = readFileSync(path.join(repoRoot, '.env.example'), 'utf8')
  const parsed = parseDotenv(text)
  // Every uncommented key in the example must be a key the overlay defaults —
  // an example var the script never reads would be a lie.
  const defaults = stagingOverlay({})
  for (const [key, value] of Object.entries(parsed)) {
    assert.ok(
      key in defaults,
      `.env.example key ${key} is not a staging default`
    )
    assert.equal(
      value,
      defaults[key],
      `.env.example ${key} drifted from the script default`
    )
  }
  // And the tracked example must never carry an auth secret value.
  assert.equal(parsed.SETU_AUTH_SECRET, undefined)
})
