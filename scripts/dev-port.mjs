/** Shared by `apps/admin/vite.config.ts` and `apps/site/astro.config.mjs` to read a dev-server
 *  port from the environment (`SETU_ADMIN_PORT`, `SETU_SITE_PORT`) with the historical default
 *  as the fallback.
 *
 *  Refusing a malformed value rather than falling back is the whole point. `free-ports.mjs`
 *  learned this the hard way (#815): a typo swallowed as "no port" made the tool report a busy
 *  port FREE. The same swallow here would start the dev server on the DEFAULT port while the
 *  operator believes it is on theirs — and behind a reverse proxy pinned to one port, that is a
 *  silent misroute rather than a visible error.
 *
 *  Every claim above is asserted in scripts/dev-port.test.mjs.
 */

/**
 * @param {string | undefined | null} raw the raw env value
 * @param {number} fallback the port to use when `raw` is unset or blank
 * @param {string} [varName] env var name, quoted into the error so the fix is obvious
 * @returns {number} a port in 1–65535
 * @throws {Error} when `raw` is present but is not a valid port
 */
export function parsePort(raw, fallback, varName = 'SETU_*_PORT') {
  if (raw === undefined || raw === null) return fallback
  const trimmed = String(raw).trim()
  if (trimmed === '') return fallback

  // Decimal digits only. Number() alone would accept '0x1000', '1e3' and ' 80.5 '-style inputs
  // that parse to something plausible but are not what the operator wrote.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${varName}: ${JSON.stringify(trimmed)} is not a port — expected a decimal integer 1-65535.`
    )
  }

  const port = Number(trimmed)
  if (port < 1 || port > 65535) {
    throw new Error(
      `${varName}: ${JSON.stringify(trimmed)} is out of range — a port must be 1-65535.`
    )
  }
  return port
}
