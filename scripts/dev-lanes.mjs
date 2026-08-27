// Lane maths for the dev launcher (#1055).
//
// A "lane" is one worktree's dev stack: a port triple, three hostnames, and the derived env that
// makes the admin bundle point at the right api. Everything here is PURE — the launcher
// (scripts/dev.mjs) owns the filesystem and the child processes — so the arithmetic that decides
// which port a lane gets, and which origin its bundle is built against, is testable without
// starting anything. Every claim below is asserted in scripts/dev-lanes.test.mjs.
//
// Why derive rather than configure: before this, each worktree carried its own .env with
// hand-written origins. Forgetting to `set -a` before sourcing it failed SILENTLY — the
// `${VAR:-default}` fallbacks in the dev script won and the admin came up pointing at loopback
// with no error anywhere (#1049, #1051). Deriving removes the file, and with it that failure.

/** The main checkout's lane. Named `dev` rather than `main` deliberately: it matches the existing
 *  `.content-sandbox/dev` and the `dev-*` hostnames already in use, so adopting the launcher does
 *  not move anybody's URLs. */
export const MAIN_LANE = 'dev'

/** Slot 0 is exactly what `pnpm dev` used before any of this, so an unconfigured main checkout
 *  behaves identically. */
const BASE_PORTS = { api: 4444, admin: 5173, site: 4321 }
const SLOT_STRIDE = 100

/** Bounded well below the ephemeral range (49152 on both darwin and linux) so a lane can never be
 *  handed a port the kernel may also assign as a source port — the failure that produced the
 *  wedged sockets this tooling exists to avoid. 20 concurrent lanes is far past useful. */
const MAX_SLOTS = 20

/** A lane name reaches THREE hostile surfaces: a filesystem path (the worktree and its sandbox),
 *  a generated Caddy config, and a public DNS label. It is therefore validated as strictly as a
 *  sandbox name — one segment, alphanumeric-led so it can never read as a flag or a dotfile.
 *  The length bound is the DNS label limit (63) minus the longest suffix this derives (`-admin`). */
const LANE_RE = /^[a-z0-9][a-z0-9-]*$/i
const MAX_LANE_LEN = 63 - '-admin'.length

export function assertValidLaneName(name) {
  if (typeof name !== 'string' || !LANE_RE.test(name) || name.includes('..'))
    throw new Error(
      `dev: invalid lane name ${JSON.stringify(name)} — must be a single segment matching ` +
        '/^[a-z0-9][a-z0-9-]*$/ (no separators, no dots, no leading dash).'
    )
  if (name.length > MAX_LANE_LEN)
    throw new Error(
      `dev: lane name ${JSON.stringify(name)} is too long — max ${MAX_LANE_LEN} characters, ` +
        'so the derived hostname label stays within the 63-character DNS limit.'
    )
  return name
}

/** @returns {{api: number, admin: number, site: number}} */
export function portsForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS)
    throw new Error(
      `dev: too many lanes — slot ${slot} is out of range (0-${MAX_SLOTS - 1}). ` +
        'Stop a lane you are not using (`pnpm dev:stop <lane>`).'
    )
  const shift = slot * SLOT_STRIDE
  return {
    api: BASE_PORTS.api + shift,
    admin: BASE_PORTS.admin + shift,
    site: BASE_PORTS.site + shift
  }
}

/** The slot a lane should use: its existing one, or the lowest unused. Pure — the caller persists
 *  the result, so a lane's ports (and therefore its URL) are stable across restarts rather than
 *  depending on the order lanes happened to start in. */
export function allocateSlot(registry, lane) {
  if (Object.prototype.hasOwnProperty.call(registry, lane))
    return registry[lane]
  // Slot 0 is reserved for the main lane so the main checkout always keeps the historical
  // 4444/5173/4321 triple, whichever lane happens to be registered first.
  if (lane === MAIN_LANE) return 0
  const taken = new Set(Object.values(registry))
  for (let slot = 1; slot < MAX_SLOTS; slot++) if (!taken.has(slot)) return slot
  throw new Error(
    `dev: too many lanes — all ${MAX_SLOTS} slots are allocated. ` +
      'Remove one from the lane registry, or stop using it.'
  )
}

/** @returns {{admin: string, api: string, site: string} | null} null when no base domain is
 *  configured, which is the ordinary loopback-only case. */
export function laneHostnames(lane, domain) {
  if (!domain) return null
  return {
    admin: `${lane}-admin.${domain}`,
    api: `${lane}-api.${domain}`,
    site: `${lane}-site.${domain}`
  }
}

/** The complete environment for one lane. With a domain every origin is an https lane hostname;
 *  without one every origin stays on loopback and nothing is added to the host allowlist. */
export function laneEnv({ lane, domain, slot, repoDir }) {
  const ports = portsForSlot(slot)
  const hosts = laneHostnames(lane, domain)

  const env = {
    SETU_API_PORT: String(ports.api),
    SETU_ADMIN_PORT: String(ports.admin),
    SETU_SITE_PORT: String(ports.site),
    SETU_REPO_DIR: repoDir
  }

  if (!hosts) {
    const api = `http://localhost:${ports.api}`
    return {
      ...env,
      SETU_ADMIN_ORIGIN: `http://localhost:${ports.admin}`,
      VITE_SETU_API: api,
      VITE_SETU_SITE: `http://localhost:${ports.site}`,
      SETU_API_URL: api,
      PUBLIC_SETU_MEDIA: api
    }
  }

  const api = `https://${hosts.api}`
  return {
    ...env,
    SETU_ADMIN_ORIGIN: `https://${hosts.admin}`,
    VITE_SETU_API: api,
    VITE_SETU_SITE: `https://${hosts.site}`,
    SETU_API_URL: api,
    PUBLIC_SETU_MEDIA: api,
    SETU_MEDIA_PUBLIC_URL: `${api}/media`,
    // Only this lane's own two browser-facing hosts. parseAllowedHosts still refuses `true`/`*`
    // (#1049), so nothing on this path can switch the DNS-rebinding guard off.
    SETU_DEV_ALLOWED_HOSTS: `${hosts.admin},${hosts.site}`
  }
}

/** Caddy config fronting every running lane, keyed by hostname.
 *
 *  Caddy listens on loopback and is reached through the tunnel, never directly — `cloudflared`
 *  connects locally, and the firewall stays closed to everything but SSH. Each site address is
 *  written `http://<host>:<port>` so Caddy serves plain HTTP and does NOT try to provision its own
 *  certificate: TLS terminates at Cloudflare's edge, and a Caddy that tried to solve an ACME
 *  challenge here would fail (nothing reaches it on 80/443 from outside).
 *
 *  Caddy's admin API is deliberately left at its default (loopback :2019) so starting a second
 *  lane can `caddy reload` instead of restarting the proxy in front of every lane already
 *  running. Turning it off would make each new lane briefly drop the others.
 *
 *  Upstreams are named (`localhost:<port>`), never a literal `127.0.0.1` (#1057). Vite and Astro
 *  bind `[::1]` only, so a literal IPv4 address left Caddy with no second family to try and 502'd
 *  every lane on a real host. A name lets the dial try every address the resolver returns, and
 *  `localhost` never resolves off-host, so this stays loopback-only. */
export function renderCaddyfile(lanes, domain, frontPort) {
  const header = [
    '# GENERATED by scripts/dev.mjs (#1055) — edits are overwritten on the next `pnpm dev`.',
    '{',
    '\tauto_https off',
    '}',
    ''
  ]
  const blocks = lanes.flatMap(({ lane, slot }) => {
    const ports = portsForSlot(slot)
    const hosts = laneHostnames(lane, domain)
    if (!hosts) return []
    return [
      `# lane: ${lane} (slot ${slot})`,
      ...['admin', 'api', 'site'].map((role) =>
        [
          `http://${hosts[role]}:${frontPort} {`,
          `\treverse_proxy localhost:${ports[role]}`,
          '}'
        ].join('\n')
      ),
      ''
    ]
  })
  return [...header, ...blocks].join('\n')
}
