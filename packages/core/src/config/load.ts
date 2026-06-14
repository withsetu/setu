import { createJiti } from 'jiti'
import { resolveConfig } from './resolve'
import type { ResolvedConfig } from './types'

/** Load a saytu.config.ts/js module from disk (TS at runtime via jiti),
 *  take its default export, and resolve it. */
export async function loadConfig(path: string): Promise<ResolvedConfig> {
  const jiti = createJiti(import.meta.url, { interopDefault: false })
  const mod = (await jiti.import(path)) as { default?: unknown }
  if (mod.default === undefined) {
    throw new Error(`saytu config at "${path}" has no default export`)
  }
  return resolveConfig(mod.default)
}
