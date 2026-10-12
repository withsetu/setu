/** Minimal KEY=VALUE dotenv parser (node builtins only, like every script here): comments and
 *  blank lines skipped, optional single/double quotes stripped, later keys win, NO expansion —
 *  values are literal. Enforced by the parseDotenv tests in scripts/staging.test.mjs
 *  (which import it through staging.mjs's re-export). */
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
