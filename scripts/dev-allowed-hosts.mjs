/** Shared by `apps/admin/vite.config.ts` and `apps/site/astro.config.mjs` to turn the
 *  `SETU_DEV_ALLOWED_HOSTS` env var into a Vite `server.allowedHosts` value.
 *
 *  Vite refuses requests whose `Host` header it does not recognise. That check is a real
 *  control — it is what stops a DNS-rebinding attack from pointing an attacker-controlled
 *  name at the dev server and driving it from a page the user visits. Loopback is the only
 *  host the default accepts, which is correct until the browser stops being on the same
 *  machine as the dev servers (a tunnel, a reverse proxy, Codespaces port forwarding, a
 *  container). This lets an operator name the extra hosts WITHOUT switching the check off.
 *
 *  Every claim below is asserted in scripts/dev-allowed-hosts.test.mjs.
 */

/** Values that would switch the host check off entirely rather than widen it. `true` is
 *  Vite's own "allow anything" sentinel; `*` is the shape people reach for expecting a
 *  wildcard. Both are refused — the whole point of this seam is that widening stays
 *  enumerable. A leading-dot entry (`.example.com`, Vite's own subdomain form) is NOT in
 *  here: it is still bounded by a domain the operator controls. */
const UNBOUNDED = new Set(['true', '*'])

/**
 * @param {string | undefined | null} raw the raw `SETU_DEV_ALLOWED_HOSTS` value
 * @returns {string[] | undefined} an explicit host list, or `undefined` to leave the dev
 *   server on its own loopback-only default
 * @throws {Error} when any entry would disable the host check instead of widening it
 */
export function parseAllowedHosts(raw) {
  if (raw === undefined || raw === null) return undefined

  const hosts = String(raw)
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '')

  // All-blank input is indistinguishable from unset, and is treated that way rather than
  // becoming an empty allowlist — an empty array would reject loopback too, breaking the
  // ordinary `pnpm dev` case for anyone who left the var set to ''.
  if (hosts.length === 0) return undefined

  for (const host of hosts) {
    if (UNBOUNDED.has(host.toLowerCase())) {
      throw new Error(
        `SETU_DEV_ALLOWED_HOSTS: refusing ${JSON.stringify(host)} — it disables Vite's ` +
          'host check rather than widening it, which exposes the dev server to DNS ' +
          'rebinding. List the hostnames explicitly instead, comma-separated ' +
          '(e.g. "admin.example.com,site.example.com").'
      )
    }
  }

  return hosts
}
