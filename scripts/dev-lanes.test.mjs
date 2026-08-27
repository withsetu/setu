import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAIN_LANE,
  allocateSlot,
  assertValidLaneName,
  laneEnv,
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
    repoDir: '/s/dev'
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
  assert.equal(env.SETU_REPO_DIR, '/s/dev')
  assert.equal(
    env.SETU_DEV_ALLOWED_HOSTS,
    'a-admin.example.com,a-site.example.com',
    'only this lane widens the host check, and only by naming its own hosts'
  )
})

test('laneEnv without a domain keeps every origin on loopback', () => {
  const env = laneEnv({
    lane: 'dev',
    domain: undefined,
    slot: 0,
    repoDir: '/s/dev'
  })
  assert.equal(env.VITE_SETU_API, 'http://localhost:4444')
  assert.equal(env.SETU_ADMIN_ORIGIN, 'http://localhost:5173')
  assert.equal(
    env.SETU_DEV_ALLOWED_HOSTS,
    undefined,
    'no domain means nothing to allow beyond loopback'
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

test('Caddy listens on loopback only — it is reached through the tunnel, never directly', () => {
  const text = renderCaddyfile([{ lane: 'dev', slot: 0 }], 'example.com', 8080)
  assert.match(text, /http:\/\/dev-admin\.example\.com:8080/)
  assert.doesNotMatch(text, /\n\s*bind\s+0\.0\.0\.0/)
})

test('rendering with no lanes still produces a valid, empty config', () => {
  assert.equal(typeof renderCaddyfile([], 'example.com', 8080), 'string')
})

test('MAIN_LANE is the historical sandbox name, so existing setups do not move', () => {
  assert.equal(MAIN_LANE, 'dev')
})
