import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// --- names -----------------------------------------------------------------
// A lane name reaches a filesystem path, a generated Caddy config AND a public
// hostname, so it is validated as strictly as a sandbox name (content-sandbox.mjs).

test('accepts ordinary lane names', () => {
  for (const n of ['dev', 'a', 'feature-x', 'proxy-dev-1049', 'x1'])
    assert.equal(assertValidLaneName(n), n)
})

test('refuses anything that is not a single safe segment', () => {
  for (const n of [
    '',
    '..',
    'a/b',
    '/etc',
    '-rf',
    '.hidden',
    'a b',
    'A_B!',
    '../x'
  ])
    assert.throws(() => assertValidLaneName(n), /lane name/i, JSON.stringify(n))
})

test('refuses a name that would not survive as a hostname label', () => {
  // 63 is the DNS label limit; the derived label is `<lane>-admin`.
  assert.throws(() => assertValidLaneName('x'.repeat(60)), /too long/i)
})

// --- ports -----------------------------------------------------------------

test('slot 0 is exactly the historical default port triple', () => {
  assert.deepEqual(portsForSlot(0), { api: 4444, admin: 5173, site: 4321 })
})

test('each slot is a distinct, stable triple', () => {
  assert.deepEqual(portsForSlot(1), { api: 4544, admin: 5273, site: 4421 })
  assert.deepEqual(portsForSlot(2), { api: 4644, admin: 5373, site: 4521 })
})

test('slots stay clear of the ephemeral range', () => {
  for (let slot = 0; slot <= 19; slot++)
    for (const p of Object.values(portsForSlot(slot)))
      assert.ok(
        p < 49152,
        `slot ${slot} port ${p} must stay below the ephemeral range`
      )
  assert.throws(() => portsForSlot(20), /too many lanes/i)
})

test('allocateSlot is stable for a known lane and fills the lowest gap', () => {
  const registry = { dev: 0, b: 2 }
  assert.equal(allocateSlot(registry, 'dev'), 0, 'known lane keeps its slot')
  assert.equal(
    allocateSlot(registry, 'c'),
    1,
    'new lane takes the lowest free slot'
  )
  assert.deepEqual(registry, { dev: 0, b: 2 }, 'allocateSlot does not mutate')
})

test('slot 0 is reserved for the main lane, whoever registers first', () => {
  // Otherwise a worktree started before the main checkout would take 4444/5173/4321 and move
  // everybody's default URLs.
  assert.equal(allocateSlot({ 'feature-x': 1 }, MAIN_LANE), 0)
  assert.equal(
    allocateSlot({}, 'feature-x'),
    1,
    'a worktree never takes slot 0'
  )
})

// --- hostnames + derived env ----------------------------------------------

test('hostnames are derived from the lane and the base domain', () => {
  assert.deepEqual(laneHostnames('a', 'example.com'), {
    admin: 'a-admin.example.com',
    api: 'a-api.example.com',
    site: 'a-site.example.com'
  })
})

test('with no domain there are no hostnames — loopback only', () => {
  assert.equal(laneHostnames('a', undefined), null)
})

test('laneEnv derives every origin from the lane, so nothing is hand-configured', () => {
  const env = laneEnv({
    lane: 'a',
    domain: 'example.com',
    slot: 1,
    repoDir: '/s/dev',
    checkoutDir: '/s/.claude/worktrees/a'
  })
  assert.equal(env.SETU_ADMIN_PORT, '5273')
  assert.equal(env.SETU_API_PORT, '4544')
  assert.equal(env.SETU_SITE_PORT, '4421')
  assert.equal(env.SETU_ADMIN_ORIGIN, 'https://a-admin.example.com')
  assert.equal(env.VITE_SETU_API, 'https://a-api.example.com')
  assert.equal(env.VITE_SETU_SITE, 'https://a-site.example.com')
  assert.equal(env.SETU_API_URL, 'https://a-api.example.com')
  assert.equal(env.PUBLIC_SETU_MEDIA, 'https://a-api.example.com')
  assert.equal(env.SETU_MEDIA_PUBLIC_URL, 'https://a-api.example.com/media')
  assert.equal(
    env.PUBLIC_SETU_API_BASE,
    'https://a-api.example.com',
    "unset, the contact block posts to http://localhost:4444 — the MAIN lane's api (#1200)"
  )
  assert.equal(
    env.SETU_BASE_URL,
    'https://a-api.example.com',
    'unset, better-auth builds reset links from http://localhost:<port> (#1200)'
  )
  assert.equal(env.SETU_REPO_DIR, '/s/dev')
  assert.equal(
    env.SETU_CONTENT_DIR,
    path.join('/s/dev', 'content'),
    'the site must read the lane sandbox; unset, content.config.ts falls back to the tracked fixtures (#1086)'
  )
  assert.equal(
    env.SETU_CONFIG_PATH,
    path.join('/s/.claude/worktrees/a', 'apps', 'site', 'setu.config.ts'),
    'unset, resolveSetuConfigPath finds no config in the sandbox and the api boots on FALLBACK_CONFIG (#1086)'
  )
  assert.equal(
    env.SETU_DEV_ALLOWED_HOSTS,
    'a-admin.example.com,a-site.example.com',
    'only this lane widens the host check, and only by naming its own hosts'
  )
})

test('laneEnv takes setu.config.ts from the lane checkout, and content from the sandbox', () => {
  // The two paths have DIFFERENT roots on purpose: the sandbox is shared across lanes (#1053)
  // while the config file belongs to the worktree being run, so a worktree that edits it gets
  // its own rather than the main checkout's.
  const env = laneEnv({
    lane: 'b',
    domain: undefined,
    slot: 2,
    repoDir: '/s/.content-sandbox/dev',
    checkoutDir: '/s/.claude/worktrees/b'
  })
  assert.equal(
    env.SETU_CONTENT_DIR,
    path.join('/s/.content-sandbox/dev', 'content')
  )
  assert.equal(
    env.SETU_CONFIG_PATH,
    path.join('/s/.claude/worktrees/b', 'apps', 'site', 'setu.config.ts')
  )
})

test('laneEnv without a domain keeps every origin on loopback', () => {
  const env = laneEnv({
    lane: 'dev',
    domain: undefined,
    slot: 0,
    repoDir: '/s/dev',
    checkoutDir: '/s'
  })
  assert.equal(env.VITE_SETU_API, 'http://localhost:4444')
  assert.equal(env.SETU_ADMIN_ORIGIN, 'http://localhost:5173')
  assert.equal(env.PUBLIC_SETU_API_BASE, 'http://localhost:4444')
  assert.equal(
    laneEnv({
      lane: 'b',
      domain: undefined,
      slot: 1,
      repoDir: '/s/dev',
      checkoutDir: '/s'
    }).PUBLIC_SETU_API_BASE,
    'http://localhost:4544',
    "a non-main lane's contact form posts to its OWN api (#1200)"
  )
  assert.equal(
    env.SETU_DEV_ALLOWED_HOSTS,
    undefined,
    'no domain means nothing to allow beyond loopback'
  )
})

test('laneEnv gives the build its own lane site origin as SETU_SITE_URL (#1183)', () => {
  // Since #1118 `astro build` refuses to run without SETU_SITE_URL, and the api's Rebuild child
  // inherits the lane env — unset, Publish from a dev admin always failed.
  const loopback = laneEnv({
    lane: 'dev',
    domain: undefined,
    slot: 0,
    repoDir: '/s/dev',
    checkoutDir: '/s'
  })
  assert.equal(loopback.SETU_SITE_URL, 'http://localhost:4321')
  assert.equal(loopback.SETU_SITE_URL, loopback.VITE_SETU_SITE)

  const tunnelled = laneEnv({
    lane: 'a',
    domain: 'example.com',
    slot: 1,
    repoDir: '/s/dev',
    checkoutDir: '/s/.claude/worktrees/a'
  })
  assert.equal(tunnelled.SETU_SITE_URL, 'https://a-site.example.com')
  assert.equal(tunnelled.SETU_SITE_URL, tunnelled.VITE_SETU_SITE)
})

test('an operator-set SETU_SITE_URL is never overridden by the derived one (#1183)', () => {
  const derived = { SETU_SITE_URL: 'http://localhost:4321', OTHER: 'x' }
  // Shell env first, then .env — the first non-blank value wins.
  assert.deepEqual(
    preferOperatorSiteUrl(
      derived,
      { SETU_SITE_URL: 'https://shell.example' },
      { SETU_SITE_URL: 'https://dotenv.example' }
    ),
    { SETU_SITE_URL: 'https://shell.example', OTHER: 'x' }
  )
  assert.equal(
    preferOperatorSiteUrl(
      derived,
      {},
      { SETU_SITE_URL: 'https://dotenv.example' }
    ).SETU_SITE_URL,
    'https://dotenv.example'
  )
  // Blank counts as unset: an empty value would only make the build refuse again.
  assert.equal(
    preferOperatorSiteUrl(derived, { SETU_SITE_URL: '  ' }, {}).SETU_SITE_URL,
    'http://localhost:4321'
  )
  assert.equal(
    preferOperatorSiteUrl(derived, {}, {}).SETU_SITE_URL,
    'http://localhost:4321'
  )
  assert.equal(
    derived.SETU_SITE_URL,
    'http://localhost:4321',
    'input not mutated'
  )
})

// --- caddy -----------------------------------------------------------------

test('the Caddyfile routes each lane hostname to its own port', () => {
  const text = renderCaddyfile(
    [
      { lane: 'dev', slot: 0 },
      { lane: 'b', slot: 1 }
    ],
    'example.com',
    8080
  )
  assert.match(text, /dev-admin\.example\.com/)
  assert.match(text, /reverse_proxy localhost:5173/)
  assert.match(text, /b-admin\.example\.com/)
  assert.match(text, /reverse_proxy localhost:5273/)
  assert.match(text, /b-api\.example\.com/)
  assert.match(text, /reverse_proxy localhost:4544/)
})

test('upstreams are named, not literal IPv4 — vite and astro bind [::1] only', () => {
  // #1057: `reverse_proxy 127.0.0.1:<port>` 502'd every lane on a real host, because Vite listens
  // on [::1] and a literal address gives Caddy no second family to try. A name lets the dial try
  // every address the resolver returns, and `localhost` is still loopback-only.
  const text = renderCaddyfile([{ lane: 'dev', slot: 0 }], 'example.com', 8080)
  assert.doesNotMatch(
    text,
    /reverse_proxy\s+\d+\.\d+\.\d+\.\d+:/,
    'no literal IPv4 upstream — it cannot reach an IPv6-only dev server'
  )
  assert.match(text, /reverse_proxy localhost:\d+/)
})

test('Caddy listens on loopback only — it is reached through the tunnel, never directly (#1199)', () => {
  const text = renderCaddyfile([{ lane: 'dev', slot: 0 }], 'example.com', 8080)
  assert.match(text, /http:\/\/dev-admin\.example\.com:8080/)
  // The global default_bind is what keeps every generated site off the LAN; without it Caddy
  // listens on all interfaces. Asserted positively — the previous check (no `bind 0.0.0.0`)
  // passed against a config that bound everything.
  assert.match(text, /^\{[^}]*\n\tdefault_bind 127\.0\.0\.1 \[::1\]\n[^}]*\}/m)
  assert.doesNotMatch(
    text,
    /\n\s*bind\s/,
    'no per-site bind overriding the default'
  )
})

test('the generated config pins the lane Caddy to its own admin endpoint (#1199)', () => {
  const text = renderCaddyfile(
    [{ lane: 'dev', slot: 0 }],
    'example.com',
    8080,
    '127.0.0.1:2119'
  )
  assert.match(text, /^\{[^}]*\n\tadmin 127\.0\.0\.1:2119\n[^}]*\}/m)
  assert.doesNotMatch(text, /2019/)
})

test('real Caddy adapts the generated config to loopback-only listeners (skipped without caddy)', (t) => {
  let adapted
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-caddy-'))
  try {
    const file = path.join(dir, 'Caddyfile')
    writeFileSync(
      file,
      renderCaddyfile(
        [{ lane: 'dev', slot: 0 }],
        'example.com',
        8080,
        '127.0.0.1:2119'
      )
    )
    try {
      adapted = JSON.parse(
        execFileSync(
          'caddy',
          ['adapt', '--config', file, '--adapter', 'caddyfile'],
          {
            stdio: ['ignore', 'pipe', 'ignore']
          }
        ).toString()
      )
    } catch (err) {
      if (err.code === 'ENOENT') return t.skip('caddy not installed')
      throw err
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(adapted.admin.listen, '127.0.0.1:2119')
  const listen = Object.values(adapted.apps.http.servers).flatMap(
    (s) => s.listen
  )
  assert.deepEqual(listen.sort(), ['127.0.0.1:8080', '[::1]:8080'])
})

test('rendering with no lanes still produces a valid, empty config', () => {
  assert.equal(typeof renderCaddyfile([], 'example.com', 8080), 'string')
})

test('MAIN_LANE is the historical sandbox name, so existing setups do not move', () => {
  assert.equal(MAIN_LANE, 'dev')
})

// --- media dir (#1161) -----------------------------------------------------

test('laneEnv exports the sandbox media dir, so the site reads the manifests the api writes', () => {
  // Without SETU_MEDIA_DIR the site's manifest reader returns null and every image renders with
  // no srcset/<picture>/dimensions, silently. The api's default is per-sandbox; this is the same
  // value (parity with resolveMediaDir is held by apps/api/test/media-dir-parity.test.ts).
  const env = laneEnv({
    lane: 'b',
    domain: undefined,
    slot: 2,
    repoDir: '/s/.content-sandbox/dev',
    checkoutDir: '/s/.claude/worktrees/b'
  })
  assert.equal(
    env.SETU_MEDIA_DIR,
    path.join('/s/.content-sandbox/dev', '.setu', 'uploads')
  )
})

test('laneEnv keeps an operator-chosen media dir from .env', () => {
  const env = laneEnv({
    lane: 'dev',
    domain: 'example.com',
    slot: 0,
    repoDir: '/s/dev',
    checkoutDir: '/s',
    mediaDir: '/var/media'
  })
  assert.equal(env.SETU_MEDIA_DIR, '/var/media')
})
