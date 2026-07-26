import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultConfig, resolveConfig } from '@setu/core'
import type { ResolvedConfig } from '@setu/core'

/** The built-in collections (`post`, `page`) — what the API validates against when no
 *  `setu.config` can be loaded. Their fields are all optional, so the #253 field gate
 *  becomes a no-op rather than a lockout. */
export const FALLBACK_CONFIG: ResolvedConfig = resolveConfig(defaultConfig)

/**
 * Where the site's `setu.config.ts` lives, or `null` when there is none to load.
 *
 * `SETU_CONFIG_PATH` wins; otherwise `<repo dir>/setu.config.ts`. Today the file actually
 * lives under `apps/site/`, which is why `pnpm dev` sets the env var explicitly — the API
 * has no business reaching into the site app's directory on its own. Consolidating the
 * config's location is #975.
 */
export function resolveSetuConfigPath(
  env: NodeJS.ProcessEnv,
  repoDir: string
): string | null {
  const explicit = env.SETU_CONFIG_PATH
  if (explicit) return resolve(explicit)
  const conventional = resolve(repoDir, 'setu.config.ts')
  return existsSync(conventional) ? conventional : null
}

/**
 * Load the site's resolved config for the write-path field gate.
 *
 * Never throws. A missing or broken config degrades to `FALLBACK_CONFIG` with a loud
 * console error, rather than taking the process down — same posture as `resolveAuthSecret`
 * (apps/api/src/config.ts): the server must still boot and serve, and an operator should be
 * able to see *why* something is degraded. The cost of degrading is that declared field
 * schemas stop being enforced until the config is fixed; the gate is a data-shape check, not
 * a permission check, and `requireWrite` is untouched by this.
 *
 * Behaviour is covered by apps/api/test/setu-config.test.ts.
 */
export async function loadSetuConfig(
  path: string | null
): Promise<ResolvedConfig> {
  if (path === null) {
    console.warn(
      '[config] no setu.config found — using the built-in post/page collections; ' +
        'declared field schemas will not be enforced'
    )
    return FALLBACK_CONFIG
  }
  try {
    const { loadConfig } = await import('@setu/core/node')
    return await loadConfig(path)
  } catch (err) {
    console.error(
      `[config] failed to load ${path} — falling back to the built-in post/page collections; ` +
        'declared field schemas will NOT be enforced until this is fixed:',
      err
    )
    return FALLBACK_CONFIG
  }
}
